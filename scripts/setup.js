const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const envExample = path.join(root, '.env.example');
const envFile = path.join(root, '.env');
const dataDir = path.join(root, 'data');

if (!fs.existsSync(envFile)) {
  fs.copyFileSync(envExample, envFile);
  console.log('Created .env from .env.example. Add your OpenRouter API key before chatting.');
}
fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

const result = spawnSync(process.execPath, ['-e', "require('dotenv').config(); require('./src/db').closeDatabase(); console.log('SQLite database is ready.')"], {
  cwd: root,
  stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status || 1);
console.log('Setup complete. Start the app with: npm start');
