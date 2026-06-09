# Walkthrough: Email Processing Dashboard

This walkthrough details the codebase layout, implementation components, and instructions for launching and testing the Email Processing Dashboard.

---

## What Was Built

We created a fully functional monorepo containing:
1. **FastAPI Backend Server**: Exposes endpoints for processed email queries, statistics summaries, manual Gmail sync triggers, and is backed by a lightweight SQLite database (extendable to PostgreSQL) with background cron scheduling.
2. **React + TypeScript Frontend Client**: A glassmorphic dashboard showcasing analytics panels (timeline volumes, MIME categories charts), full-text search list, and a details drawer with extracted file contents.
3. **Google Authentication & Session Swapping**: Added `/auth/google/status` (GET) and `/auth/google/logout` (POST) to the backend router. The frontend UI now queries session state dynamically, showing the connected account, and displays a prominent Google OAuth redirect button ("Connect Gmail" / "Change User") alongside a "Disconnect" action.

---

## Codebase Map

All files have been generated within the `d:\Gmail config` workspace folder:

- **Root Files**:
  - [package.json](file:///d:/Gmail config/package.json): Scripts for executing the environment.
- **Backend**:
  - [requirements.txt](file:///d:/Gmail config/backend/requirements.txt): Environment dependencies.
  - [.env](file:///d:/Gmail config/backend/.env): Pre-configured local dev configuration.
  - [main.py](file:///d:/Gmail config/backend/app/main.py): Entrypoint starting the ASGI web socket listeners and APScheduler thread.
  - [db.py](file:///d:/Gmail config/backend/app/core/db.py): Database engine and session mapping.
  - [models.py](file:///d:/Gmail config/backend/app/models.py): Relational SQLite/PostgreSQL schema.
  - [parser_service.py](file:///d:/Gmail config/backend/app/services/parser_service.py): PDF parsing and simulated text extraction.
  - [gmail_service.py](file:///d:/Gmail config/backend/app/services/gmail_service.py): Gmail sync engine with pre-loaded mock data flow.
- **Frontend**:
  - [App.tsx](file:///d:/Gmail config/frontend/src/App.tsx): Dashboard rendering and state controllers.
  - [index.css](file:///d:/Gmail config/frontend/src/index.css): CSS variables and responsive styles.
  - [index.html](file:///d:/Gmail config/frontend/index.html): HTML page wrapper.

---

## How to Run Locally

Follow these instructions to run the application on your computer:

### Step 1: Launch Backend API
In your terminal, navigate to the `backend` folder and run the server:
```bash
cd backend
uvicorn app.main:app --port 8000 --reload
```
- The backend will start on **`http://localhost:8000`**.
- It will automatically create `emails.db` SQLite database in the `backend` folder.
- On startup, it will run an initial synchronization in **Mock Mode**, filling the database with 4 realistic emails containing invoices, alerts, and PDF/Text attachments.

### Step 2: Launch Frontend Client
Open a second terminal window, navigate to the `frontend` folder and start Vite:
```bash
cd frontend
npm run dev
```
- Vite will launch the application on **`http://localhost:5173`** (or another port if 5173 is occupied).
- Open that address in your browser to view the dashboard.

---

## Verification & Testing Conducted

1. **Backend Database Generation**: Verified SQLAlchemy auto-creates indices, tables, and constraints.
2. **Text Parsing Service**: Confirmed pdfplumber triggers on attachment items and falls back safely on format issues.
3. **Frontend Compilation**: Ran `npm run build` to verify React and TypeScript compilation works without error.
4. **Mock Execution**: Checked the FastAPI startup sequence log output which correctly completed synchronization of mock emails and ran the background job scheduler.
