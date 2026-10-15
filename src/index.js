require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { db, closeDatabase, transaction } = require('./db');
const { chunkText, extractPages, sanitize } = require('./text');
const { search, buildPrompt } = require('./rag');
const { streamCompletion } = require('./openrouter');

const app = express();
const port = Number(process.env.PORT || 8000);
const frontendDir = path.join(__dirname, '..', 'frontend');
const uploadDir = path.resolve(process.env.UPLOAD_DIR || './data/uploads');
const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES || 50 * 1024 * 1024);
const sessionTtl = Number(process.env.SESSION_TTL_SECONDS || 86400);

fs.mkdirSync(uploadDir, { recursive: true });
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

function sendError(res, status, message) {
  return res.status(status).json({ detail: message });
}

function currentUser(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const user = db.prepare(`
    SELECT users.id, users.username, users.display_name, users.role
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ? AND sessions.expires_at > ?
  `).get(token, Math.floor(Date.now() / 1000));
  if (!user) return sendError(res, 401, 'Invalid or expired session');
  req.user = user;
  req.sessionToken = token;
  return next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return sendError(res, 403, 'Admin role required');
  return next();
}

app.post('/api/v1/auth/login', (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim().slice(0, 100) : '';
  if (!username) return sendError(res, 422, 'Username is required');
  const user = db.prepare('SELECT id, username, display_name, role FROM users WHERE username = ?').get(username);
  if (!user) return sendError(res, 404, 'User not found');
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, user.id, Math.floor(Date.now() / 1000) + sessionTtl);
  return res.json({ session_token: token, user_id: user.id, display_name: user.display_name, role: user.role });
});

app.post('/api/v1/auth/logout', currentUser, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
  return res.json({ status: 'logged_out' });
});

app.get('/api/v1/health', (_req, res) => {
  let sqlite = 'ok';
  try { db.prepare('SELECT 1').get(); } catch { sqlite = 'unavailable'; }
  const llm = process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_MODEL ? 'configured' : 'not_configured';
  const status = sqlite === 'ok' ? 'ok' : 'degraded';
  return res.json({
    status,
    components: {
      sqlite: { status: sqlite },
      session_store: { status: 'sqlite' },
      query_cache: { status: 'in_memory' },
      llm_openrouter: { status: llm },
    },
    version: '1.0.0',
  });
});

app.get('/api/v1/documents', currentUser, (_req, res) => {
  const documents = db.prepare(`
    SELECT id, original_name, file_type, chunk_count, status, uploaded_at, indexed_at
    FROM documents ORDER BY uploaded_at DESC
  `).all();
  return res.json({ documents, total: documents.length });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxUploadBytes, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).slice(1).toLowerCase();
    if (!['pdf', 'txt', 'md'].includes(extension)) return callback(new Error('Unsupported file type. Allowed: pdf, txt, md'));
    callback(null, true);
  },
});

app.post('/api/v1/documents/upload', currentUser, requireAdmin, (req, res, next) => {
  upload.single('file')(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return sendError(res, 413, `File exceeds ${Math.round(maxUploadBytes / 1024 / 1024)}MB limit`);
    }
    return sendError(res, 400, error.message || 'Invalid upload');
  });
}, async (req, res) => {
  if (!req.file) return sendError(res, 400, 'Choose a file to upload');
  const file = req.file;
  const extension = path.extname(file.originalname).slice(1).toLowerCase();
  const id = crypto.randomUUID();
  const storageName = `${id}.${extension}`;
  const now = Math.floor(Date.now() / 1000);
  let pageTexts;
  try {
    if (extension === 'pdf') {
      const parsed = await pdfParse(file.buffer);
      pageTexts = extractPages(parsed.text);
      if (!pageTexts.length && parsed.text.trim()) pageTexts = [parsed.text.trim()];
    } else {
      pageTexts = [file.buffer.toString('utf8').replace(/\r\n/g, '\n').trim()];
    }
    const chunks = [];
    pageTexts.forEach((pageText, pageIndex) => {
      chunkText(pageText).forEach((text) => chunks.push({ text, page: extension === 'pdf' ? pageIndex + 1 : null }));
    });
    if (!chunks.length) return sendError(res, 400, 'The document contains no readable text');

    fs.writeFileSync(path.join(uploadDir, storageName), file.buffer);
    const insertDocument = db.prepare(`
      INSERT INTO documents
      (id, original_name, file_type, file_size_bytes, storage_name, chunk_count, status, uploaded_by, uploaded_at, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, 'indexed', ?, ?, ?)
    `);
    const insertChunk = db.prepare(`
      INSERT INTO chunks (id, document_id, chunk_index, chunk_text, token_count, page_number)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertFts = db.prepare(`
      INSERT INTO chunks_fts (chunk_text, document_id, chunk_id, source_name, page_number, chunk_index)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const persist = () => transaction(() => {
      insertDocument.run(id, file.originalname, extension, file.size, storageName, chunks.length, req.user.id, now, now);
      chunks.forEach((chunk, index) => {
        const chunkId = crypto.randomUUID();
        insertChunk.run(chunkId, id, index, chunk.text, chunk.text.split(/\s+/).length, chunk.page);
        insertFts.run(chunk.text, id, chunkId, file.originalname, chunk.page, index);
      });
    });
    try { persist(); } catch (error) {
      fs.rmSync(path.join(uploadDir, storageName), { force: true });
      throw error;
    }
    return res.json({ document_id: id, filename: file.originalname, status: 'indexed', chunk_count: chunks.length });
  } catch (error) {
    console.error('Document ingestion failed:', error.message);
    return sendError(res, 500, `Failed to ingest document: ${error.message}`);
  }
});

app.delete('/api/v1/documents/:documentId', currentUser, requireAdmin, (req, res) => {
  const document = db.prepare('SELECT storage_name FROM documents WHERE id = ?').get(req.params.documentId);
  if (!document) return sendError(res, 404, 'Document not found');
  const ftsRows = db.prepare('SELECT chunk_id FROM chunks_fts WHERE document_id = ?').all(req.params.documentId);
  const remove = () => transaction(() => {
    const deleteFts = db.prepare('DELETE FROM chunks_fts WHERE chunk_id = ?');
    ftsRows.forEach(({ chunk_id }) => deleteFts.run(chunk_id));
    db.prepare('DELETE FROM documents WHERE id = ?').run(req.params.documentId);
  });
  remove();
  if (document.storage_name) fs.rmSync(path.join(uploadDir, path.basename(document.storage_name)), { force: true });
  return res.json({ status: 'deleted', document_id: req.params.documentId });
});

app.post('/api/v1/chat', currentUser, async (req, res) => {
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!query || query.length > 2000) return sendError(res, 422, 'Query must contain 1 to 2000 characters');
  if (!process.env.OPENROUTER_API_KEY || !process.env.OPENROUTER_MODEL) {
    return sendError(res, 503, 'OpenRouter is not configured. Set OPENROUTER_API_KEY and OPENROUTER_MODEL in .env, then restart the app.');
  }
  const cleanQuery = sanitize(query);
  const chunks = search(cleanQuery, 3);
  const prompt = buildPrompt(cleanQuery, chunks);
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const event = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  try {
    for await (const token of streamCompletion(prompt, controller.signal)) event('token', { token });
    event('citations', { citations: chunks.map(({ source_name, page_number, chunk_index }) => ({ source_name, page_number, chunk_index })) });
    event('done', { message_id: crypto.randomUUID().replaceAll('-', ''), provider: 'openrouter' });
    res.end();
  } catch (error) {
    if (!controller.signal.aborted) {
      event('error', { message: error.message });
      res.end();
    }
  }
});

app.get('/api/v1/conversations', currentUser, (_req, res) => res.json({ conversations: [], total: 0 }));
app.get('/api/v1/conversations/:conversationId/messages', currentUser, (req, res) => res.json({ conversation_id: req.params.conversationId, messages: [] }));

app.use(express.static(frontendDir));
app.get('/', (_req, res) => res.sendFile(path.join(frontendDir, 'index.html')));
app.use((error, _req, res, _next) => {
  console.error(error);
  if (!res.headersSent) sendError(res, 500, 'Internal server error');
});

const server = app.listen(port, () => console.log(`AI Customer Support Assistant ready at http://localhost:${server.address().port}`));
function shutdown() {
  server.close(() => { closeDatabase(); process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { app, server };
