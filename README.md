# Employee Leave & WFH Dashboard

This project keeps the frontend and backend as sibling folders:

- `backend/` — Express API, admin authentication, Neon PostgreSQL integration
- `frontend/` — React frontend (to be implemented next)

## AI Agent (Conversational Agentic HR Assistant)

The backend exposes a conversational agent at `POST /api/agent/chat` (frontend chat: `frontend/src/pages/AgentChat.jsx`).

- **LLM reasoning layer**: Google Gemini via `@google/genai` function calling (`backend/src/agent/engine.js`). Model: `gemini-3-flash-preview` with fallbacks (`gemini-3.8-flash`, `gemini-3.1-flash-lite`, `gemini-flash-latest`).
- **Tools**: `backend/src/agent/tools.js` allowlisted tools (employee lookup, leave/WFH analytics, department comparison, write proposals). Write tools never execute directly — they return confirmation proposals.
- **Database**: `backend/src/db/index.js` parameterized queries against Neon PostgreSQL.

### Required environment variables

- `DATABASE_URL` — Neon PostgreSQL connection string.
- `GOOGLE_API_KEY` or `GEMINI_API_KEY` — Gemini API key (backend only). Without it the agent runs a rule-based fallback.

## Start with the backend

1. Open a terminal in `backend/`.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and configure your Neon `DATABASE_URL`, `SESSION_SECRET`, and admin credentials.
4. Run `npm run dev`.

See `backend/README.md` for full details. Do not share or commit `.env`.
