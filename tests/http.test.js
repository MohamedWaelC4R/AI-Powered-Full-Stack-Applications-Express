const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'support-assistant-'));
process.env.DATABASE_PATH = path.join(tempDir, 'test.db');
process.env.UPLOAD_DIR = path.join(tempDir, 'uploads');
process.env.PORT = '0';
process.env.OPENROUTER_API_KEY = '';
process.env.OPENROUTER_MODEL = '';

const { server } = require('../src/index');
const { closeDatabase } = require('../src/db');
const listening = new Promise((resolve) => server.once('listening', resolve));

test('serves the app, authenticates a demo user, and retrieves the starter knowledge base', async (t) => {
  await listening;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /AI Customer Support Assistant/);

  const health = await fetch(`${base}/api/v1/health`).then((response) => response.json());
  assert.equal(health.components.sqlite.status, 'ok');

  const loginResponse = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin' }),
  });
  assert.equal(loginResponse.status, 200);
  const login = await loginResponse.json();
  assert.equal(login.role, 'admin');

  const headers = { Authorization: `Bearer ${login.session_token}` };
  const documents = await fetch(`${base}/api/v1/documents`, { headers }).then((response) => response.json());
  assert.equal(documents.total, 1);
  assert.equal(documents.documents[0].original_name, 'NexusPlay_Gaming_Support_Knowledge_Base.pdf');

  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(path.join(__dirname, '..', 'artifacts', '1-Requirements.pdf'))]), 'test.pdf');
  const upload = await fetch(`${base}/api/v1/documents/upload`, { method: 'POST', headers, body: form });
  assert.equal(upload.status, 200, await upload.clone().text());
  const uploaded = await upload.json();
  assert.ok(uploaded.chunk_count > 0);
  const deleted = await fetch(`${base}/api/v1/documents/${uploaded.document_id}`, { method: 'DELETE', headers });
  assert.equal(deleted.status, 200);

  const noKeyChat = await fetch(`${base}/api/v1/chat`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'I forgot my password', session_id: login.session_token }),
  });
  assert.equal(noKeyChat.status, 503);
  assert.match((await noKeyChat.json()).detail, /OpenRouter is not configured/);
});
