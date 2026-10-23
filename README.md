# Employee Leave & WFH Dashboard

This project keeps the frontend and backend as sibling folders:

- `backend/` — Express API, admin authentication, Neon PostgreSQL integration
- `frontend/` — React frontend (to be implemented next)

## Start with the backend

1. Open a terminal in `backend/`.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and configure your Neon `DATABASE_URL`, `SESSION_SECRET`, and admin credentials.
4. Run `npm run dev`.

See `backend/README.md` for full details. Do not share or commit `.env`.
