# AI Customer Support Assistant — Express Edition

This is the same customer-support chat app and frontend, with an Express.js backend and SQLite full-text search. It uses OpenRouter for answer generation; no local model server is needed. The demo support knowledge base is indexed automatically the first time the app starts.

## Requirements

- Node.js 22.13 or newer (includes npm)
- An OpenRouter API key and a model ID available to your OpenRouter account

## Windows setup (PowerShell)

Run these commands from the project folder. This matters: running setup from `C:\Users\pc` will not find this project's files.

```powershell
cd E:\temp\AI-Powered-Full-Stack-Applications-Express
node --version
npm install
npm run setup
notepad .env
```

In `.env`, set your OpenRouter credentials, then save and close Notepad:

```dotenv
OPENROUTER_API_KEY=your_openrouter_api_key
OPENROUTER_MODEL=provider/model-id
```

Use the exact model ID shown in your OpenRouter account. Then start the app:

```powershell
npm start
```

Open [http://localhost:8000](http://localhost:8000). Keep the terminal open while you use the app; press `Ctrl+C` there to stop it.

For the demo login, enter `admin` (document upload) or `agent` (chat). This demo keeps the original username-only login and does not use account passwords. The sample NexusPlay support knowledge base is ready on first startup, so questions like “I forgot my password” can be answered. The example company and policies are fictional.

## Useful commands

```powershell
npm run dev    # restart the server when source files change
npm test       # run the local checks
npm run setup  # create .env if needed and initialize/check SQLite
```

Documents in PDF, TXT, or Markdown format can be uploaded by the `admin` demo user. Indexed text is stored in `data/app.db`; original uploads are stored under `data/uploads`. Both are created automatically and remain on your computer.

## Troubleshooting

- `npm` or `node` is not recognized: install Node.js 22.13+ and open a new PowerShell window.
- `Cannot find module ...`: confirm the current directory is this project, then run `npm install` again.
- OpenRouter setup error: check that `.env` is in the project root and both OpenRouter values are filled in, then restart `npm start`.
- “I don't have enough information to answer that”: ask about the indexed support knowledge base or upload a relevant document as `admin`.
- Port 8000 is busy: set `PORT=8001` in `.env`, restart, then open `http://localhost:8001`.

## Project layout

```text
frontend/                 Existing chat interface
src/index.js              Express API and static frontend server
src/db.js                 SQLite schema, demo users, and starter knowledge base
src/rag.js                SQLite FTS5 retrieval and grounded prompt
src/openrouter.js         OpenRouter streaming client
seed/knowledge_base.json  Small starter dataset extracted from the source project
data/                     SQLite database and uploaded documents (created at runtime)
artifacts/                Original project specifications and workshop materials
```
