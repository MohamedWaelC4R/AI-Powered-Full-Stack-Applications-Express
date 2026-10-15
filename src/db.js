const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const databasePath = path.resolve(process.env.DATABASE_PATH || './data/app.db');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'agent' CHECK(role IN ('agent', 'admin'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    original_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    storage_name TEXT NOT NULL,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    uploaded_by TEXT NOT NULL REFERENCES users(id),
    uploaded_at INTEGER NOT NULL,
    indexed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    token_count INTEGER NOT NULL,
    page_number INTEGER,
    UNIQUE(document_id, chunk_index)
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    chunk_text, document_id UNINDEXED, chunk_id UNINDEXED,
    source_name UNINDEXED, page_number UNINDEXED, chunk_index UNINDEXED,
    tokenize='unicode61'
  );
`);

const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
if (userCount === 0) {
  const insertUser = db.prepare('INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)');
  transaction(() => {
    insertUser.run('admin-user', 'admin', 'Admin User', 'admin');
    insertUser.run('agent-user', 'agent', 'Support Agent', 'agent');
  });
}

const documentCount = db.prepare('SELECT COUNT(*) AS count FROM documents').get().count;
const seedPath = path.join(__dirname, '..', 'seed', 'knowledge_base.json');
if (documentCount === 0 && fs.existsSync(seedPath)) {
  const knowledgeBase = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const documentId = 'sample-nexusplay-support-kb';
  const insertDocument = db.prepare(`
    INSERT INTO documents
    (id, original_name, file_type, file_size_bytes, storage_name, chunk_count, status, uploaded_by, uploaded_at, indexed_at)
    VALUES (?, ?, 'pdf', 0, '', ?, 'indexed', 'admin-user', ?, ?)
  `);
  const insertChunk = db.prepare(`
    INSERT INTO chunks (id, document_id, chunk_index, chunk_text, token_count, page_number)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertFts = db.prepare(`
    INSERT INTO chunks_fts (chunk_text, document_id, chunk_id, source_name, page_number, chunk_index)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  transaction(() => {
    insertDocument.run(documentId, knowledgeBase.source_name, knowledgeBase.chunks.length, now, now);
    knowledgeBase.chunks.forEach((chunk, index) => {
      const chunkId = `sample-nexusplay-chunk-${index}`;
      const page = chunk.page_number || null;
      insertChunk.run(chunkId, documentId, index, chunk.text, chunk.text.split(/\s+/).length, page);
      insertFts.run(chunk.text, documentId, chunkId, knowledgeBase.source_name, page, index);
    });
  });
}

function closeDatabase() {
  if (db.isOpen) db.close();
}

function transaction(callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = { db, closeDatabase, databasePath, transaction };
