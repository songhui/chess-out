# chess-out
A python-based chess interface

## Quick start

Build and run the containers:

```bash
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend: http://localhost:8000/api/health

## What it does

- Paste PGN notes into the editor.
- Use the Back/Forward buttons to step through each move.
- The board stays in sync with the selected move.
- Optional: click **Best Move** to ask Stockfish for a suggestion.
- The status card explains draw/checkmate results when available.
- The analysis card shows Stockfish evaluation and top 5 replies for the side to move.

## Local development

Backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` to `http://localhost:8000`.
