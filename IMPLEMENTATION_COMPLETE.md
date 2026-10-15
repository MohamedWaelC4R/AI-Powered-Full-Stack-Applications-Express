# Express Edition

The Express edition preserves the original browser interface and project specifications while replacing the Python/FastAPI, Alembic, and ChromaDB backend with Node.js, Express, and SQLite FTS5.

## Included

- The original chat interface and API routes, served by Express.
- SQLite schema setup on first run, persistent demo sessions, documents, and chunks.
- Full-text document retrieval with duplicate-chunk removal.
- PDF, TXT, and Markdown ingestion, admin-only uploads, and citations.
- OpenRouter streaming; there is no local-model dependency.
- A starter support knowledge base seeded automatically into a fresh database.
- A Windows-first setup guide and Node.js tests.

See [README.md](README.md) for installation and startup instructions.
