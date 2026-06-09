import logging
import socket
import os

# Force IPv4 resolution to prevent IPv6 connection timeouts (WinError 10060) in httplib2 on Windows
orig_getaddrinfo = socket.getaddrinfo
def getaddrinfo_ipv4_only(host, port, family=0, type=0, proto=0, flags=0):
    if family == socket.AF_UNSPEC:
        family = socket.AF_INET
    return orig_getaddrinfo(host, port, family, type, proto, flags)
socket.getaddrinfo = getaddrinfo_ipv4_only

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.background import BackgroundScheduler
from app.core.db import engine, Base, SessionLocal
from app.api import emails, dashboard, auth
from app.services.gmail_service import GmailService

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger(__name__)

# Initialize database schemas dynamically on startup
logger.info("Initializing database schemas...")
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Email Processing Dashboard API",
    description="Backend API supporting Gmail sync, attachment parsing, and analytics visualizations.",
    version="1.0.0"
)

# Enable CORS for local development and production with credentials support
frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
origins = [
    frontend_url,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(emails.router, prefix="/api/v1")
app.include_router(dashboard.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1")

@app.get("/health")
def health_check():
    return {"status": "healthy", "service": "email-processor-api"}

# Background Scheduler for Auto-Sync
def auto_sync_job():
    logger.info("Triggering background automatic sync job...")
    db = SessionLocal()
    try:
        gmail_service = GmailService()
        result = gmail_service.sync_emails(db)
        logger.info(f"Auto sync completed: {result}")
    except Exception as e:
        logger.error(f"Auto sync job encountered error: {str(e)}")
    finally:
        db.close()

# APScheduler Start
scheduler = BackgroundScheduler()

@app.on_event("startup")
def startup_event():
    # Schedule to run every 30 seconds
    scheduler.add_job(auto_sync_job, "interval", seconds=30)
    scheduler.start()
    logger.info("Background scheduler initialized and running.")
    
    # Run the initial sync in a background thread to prevent blocking Uvicorn startup
    import threading
    threading.Thread(target=auto_sync_job, name="initial_sync_thread", daemon=True).start()
    logger.info("Initial sync triggered in background thread.")

@app.on_event("shutdown")
def shutdown_event():
    scheduler.shutdown()
    logger.info("Background scheduler shut down successfully.")
