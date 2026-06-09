# Implementation Plan: Email Processing Dashboard

This plan details the step-by-step execution to build the **Email Processing Dashboard** locally in the `d:\Gmail config` workspace directory.

---

## User Review Required

> [!IMPORTANT]
> - **Google Credentials File**: To integrate with Gmail, we need a `credentials.json` file from the Google Cloud Console. During implementation, we will mock the Gmail API endpoints first or use a local mock mode so the application runs without needing immediate production credentials.
> - **Local PostgreSQL & Redis**: We assume PostgreSQL and Redis services are available locally for development, or we can use SQLite for local database debugging and mock queues to speed up setup.

---

## Open Questions

> [!WARNING]
> - **Database preference for local development**: Should we use SQLite for rapid local testing first, or go straight to connecting a local PostgreSQL instance?
> - **Mock Gmail Data**: Would you like us to generate mock email data (with invoices/attachments) so you can see it working immediately without setting up Google API developer accounts right away?

---

## Proposed Changes

We will construct a monorepo setup within the workspace.

### 1. Project Initialization & Configuration

#### [NEW] [package.json](file:///d:/Gmail config/package.json)
Workspace-level script settings to easily launch both backend and frontend.

---

### 2. Backend (FastAPI + Celery/APScheduler)

#### [NEW] [requirements.txt](file:///d:/Gmail config/backend/requirements.txt)
Define dependencies including `fastapi`, `uvicorn`, `sqlalchemy`, `psycopg2-binary`, `pydantic`, `google-api-python-client`, `google-auth-oauthlib`, `pdfplumber`, `cryptography`, and `apscheduler` or `celery`.

#### [NEW] [.env.example](file:///d:/Gmail config/backend/.env.example)
Define backend configuration templates (DB URL, Google Client credentials).

#### [NEW] [main.py](file:///d:/Gmail config/backend/app/main.py)
Initialize FastAPI app, middleware, routes, and background scheduler startup sequence.

#### [NEW] [db.py](file:///d:/Gmail config/backend/app/core/db.py)
Database engine session helper (SQLAlchemy).

#### [NEW] [models.py](file:///d:/Gmail config/backend/app/models.py)
SQLAlchemy models matching database design specifications.

#### [NEW] [gmail_service.py](file:///d:/Gmail config/backend/app/services/gmail_service.py)
Gmail API connection client with mock capabilities and attachment extractor pipeline.

#### [NEW] [parser_service.py](file:///d:/Gmail config/backend/app/services/parser_service.py)
Code to parse PDF and text attachments using `pdfplumber`.

#### [NEW] [routes](file:///d:/Gmail config/backend/app/api/)
API handlers for email search, statistics, manual sync triggers, and authentication.

---

### 3. Frontend (React + TypeScript + Vite)

#### [NEW] [Vite Initializer](file:///d:/Gmail%20config/frontend/)
Scaffold the client application.

#### [NEW] [index.css](file:///d:/Gmail config/frontend/src/index.css)
Establish styling palette, dark mode styles, animations, and typography variables.

#### [NEW] [Dashboard views](file:///d:/Gmail config/frontend/src/pages/)
- **Dashboard.tsx**: Main charts and statistics indicators.
- **Emails.tsx**: Email lists, search bars, attachment drawers, and extracted text viewers.
- **Settings.tsx**: Gmail API watch status and manual trigger utilities.

---

## Verification Plan

### Automated Tests
- Run database migrations and test model insert/query consistency.
- Test PDF text extraction service with a sample file.

### Manual Verification
1. Launch backend using: `uvicorn app.main:app --reload`
2. Launch frontend using: `npm run dev`
3. Verify that the React dashboard properly loads mock emails, renders statistical counts, and displays extracted texts from PDF attachments.
