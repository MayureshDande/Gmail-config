import os
import json
import urllib.request
import urllib.parse
import logging
from typing import Optional, List
from fastapi import APIRouter, Request, HTTPException, Depends, Cookie, Response
from fastapi.responses import RedirectResponse
from dotenv import load_dotenv
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.core.db import get_db
from app.models import UserTokenModel, EmailModel

load_dotenv()

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/google", tags=["Authentication"])

SCOPES = ['https://www.googleapis.com/auth/gmail.modify']
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000").rstrip("/")
REDIRECT_URI = f"{BACKEND_URL}/api/v1/auth/google/callback"

# In production, VITE frontend home page
FRONTEND_HOME = os.getenv("FRONTEND_URL", "http://localhost:5173")

def get_google_client_config() -> dict:
    """
    Constructs Google client configuration dictionary from environment variables.
    """
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=500, 
            detail="Google Client credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) are not configured in your .env file."
        )
        
    return {
        "web": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "redirect_uris": [REDIRECT_URI]
        }
    }

@router.get("/login")
def login():
    """
    Generates the Google OAuth authorization Consent URL manually to avoid PKCE constraints.
    """
    try:
        client_config = get_google_client_config()
        
        # Build query parameters manually to prevent google-auth-oauthlib PKCE challenge defaults
        params = urllib.parse.urlencode({
            'response_type': 'code',
            'client_id': client_config['web']['client_id'],
            'redirect_uri': REDIRECT_URI,
            'scope': ' '.join(SCOPES),
            'access_type': 'offline',
            'prompt': 'consent',
            'state': 'inbox_parser_state_123'
        })
        
        authorization_url = f"https://accounts.google.com/o/oauth2/v2/auth?{params}"
        return RedirectResponse(authorization_url)
    except Exception as e:
        logger.error(f"OAuth login redirect URL construction failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"OAuth Flow initialization failed: {str(e)}")

def clear_user_data(email: str, db: Session):
    """
    Deletes all emails and cascading attachments from the database for a specific user.
    """
    try:
        logger.info(f"Clearing database tables for email and attachments for user {email}...")
        db.query(EmailModel).filter(EmailModel.user_email == email).delete(synchronize_session=False)
        db.commit()
    except Exception as e:
        logger.error(f"Failed to clear database for user {email}: {str(e)}")
        db.rollback()
        raise e

@router.get("/callback")
def callback(request: Request, response: Response, db: Session = Depends(get_db)):
    """
    Google OAuth Callback endpoint. Receives code, exchanges it for tokens,
    retrieves Gmail email address, and writes to database.
    """
    code = request.query_params.get("code")
    error = request.query_params.get("error")
    
    if error:
        raise HTTPException(status_code=400, detail=f"Google OAuth authorization rejected: {error}")
        
    if not code:
        raise HTTPException(status_code=400, detail="Missing Google OAuth authorization code in parameters.")
        
    try:
        client_config = get_google_client_config()
        
        # 1. Exchange authorization code for tokens directly via HTTP POST
        token_url = "https://oauth2.googleapis.com/token"
        post_data = urllib.parse.urlencode({
            'code': code,
            'client_id': client_config['web']['client_id'],
            'client_secret': client_config['web']['client_secret'],
            'redirect_uri': REDIRECT_URI,
            'grant_type': 'authorization_code'
        }).encode('utf-8')
        
        req = urllib.request.Request(
            token_url,
            data=post_data,
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )
        
        with urllib.request.urlopen(req) as response_raw:
            token_response = json.loads(response_raw.read().decode('utf-8'))
            
        # 2. Extract tokens and retrieve user profile to identify account owner
        access_token = token_response.get('access_token')
        refresh_token = token_response.get('refresh_token')
        
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
        
        creds = Credentials(
            token=access_token,
            refresh_token=refresh_token,
            token_uri=token_url,
            client_id=client_config['web']['client_id'],
            client_secret=client_config['web']['client_secret'],
            scopes=SCOPES
        )
        
        service = build('gmail', 'v1', credentials=creds)
        profile = service.users().getProfile(userId='me').execute()
        email = profile.get('emailAddress')
        
        if not email:
            raise HTTPException(status_code=500, detail="Failed to retrieve email address from Google profile.")
            
        # 3. Store/Update token in database
        db_token = db.query(UserTokenModel).filter(UserTokenModel.email == email).first()
        if db_token:
            db_token.access_token = access_token
            if refresh_token:
                db_token.refresh_token = refresh_token
            db_token.token_uri = token_url
            db_token.client_id = client_config['web']['client_id']
            db_token.client_secret = client_config['web']['client_secret']
            db_token.scopes = json.dumps(SCOPES)
            db_token.updated_at = func.now()
        else:
            db_token = UserTokenModel(
                email=email,
                access_token=access_token,
                refresh_token=refresh_token,
                token_uri=token_url,
                client_id=client_config['web']['client_id'],
                client_secret=client_config['web']['client_secret'],
                scopes=json.dumps(SCOPES)
            )
            db.add(db_token)
        db.commit()
        
        # Clear database records of this user for a clean sync
        clear_user_data(email, db)
        
        # 4. Set session cookie
        mode = os.getenv("APP_MODE", "mock").lower()
        is_prod = mode == "production"
        
        redirect_res = RedirectResponse(FRONTEND_HOME)
        redirect_res.set_cookie(
            key="active_user_email",
            value=email,
            httponly=True,
            samesite="none" if is_prod else "lax",
            secure=is_prod,
            max_age=30 * 24 * 60 * 60
        )
        
        # Trigger an immediate sync for the new user in a background task/thread to avoid blocking Redirect
        try:
            from app.services.gmail_service import GmailService
            gmail_service = GmailService()
            # We run it synchronously here since Uvicorn handles async redirect, or let's do it in background. 
            # Actually, standard callback did it synchronously, but since we want fast redirect let's run in a thread
            import threading
            def run_sync():
                from app.core.db import SessionLocal
                sync_db = SessionLocal()
                try:
                    gmail_service.sync_emails(sync_db, active_user_email=email)
                except Exception as sync_err:
                    logger.error(f"Async sync error in callback thread: {sync_err}")
                finally:
                    sync_db.close()
            threading.Thread(target=run_sync, name=f"initial_sync_{email}", daemon=True).start()
        except Exception as se:
            logger.error(f"Failed to start immediate sync in callback: {str(se)}")
            
        return redirect_res
    except urllib.error.HTTPError as he:
        error_body = he.read().decode('utf-8')
        logger.error(f"Google token exchange HTTPError: {he.code} - {error_body}")
        raise HTTPException(
            status_code=he.code, 
            detail=f"Google Token Exchange Failed: {error_body}"
        )
    except Exception as e:
        logger.error(f"Failed exchanging token credentials: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed exchanging token credentials: {str(e)}")

@router.get("/status")
def get_auth_status(
    response: Response,
    active_user_email: Optional[str] = Cookie(None),
    db: Session = Depends(get_db)
):
    """
    Checks if Google OAuth token exists and retrieves active Gmail account profile.
    """
    mode = os.getenv("APP_MODE", "mock").lower()
    
    if mode == "mock":
        email = active_user_email or "mock-user@gmail.com"
        if not active_user_email:
            is_prod = mode == "production"
            response.set_cookie(
                key="active_user_email",
                value=email,
                httponly=True,
                samesite="none" if is_prod else "lax",
                secure=is_prod,
                max_age=30 * 24 * 60 * 60
            )
        return {
            "authenticated": True,
            "email": email,
            "mode": "mock"
        }
        
    if not active_user_email:
        return {
            "authenticated": False,
            "email": None,
            "mode": mode
        }
        
    db_token = db.query(UserTokenModel).filter(UserTokenModel.email == active_user_email).first()
    if not db_token:
        return {
            "authenticated": False,
            "email": None,
            "mode": mode
        }
        
    try:
        from google.auth.transport.requests import Request as GoogleRequest
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
        
        creds = Credentials(
            token=db_token.access_token,
            refresh_token=db_token.refresh_token,
            token_uri=db_token.token_uri,
            client_id=db_token.client_id,
            client_secret=db_token.client_secret,
            scopes=json.loads(db_token.scopes)
        )
        
        if creds and not creds.valid:
            if creds.expired and creds.refresh_token:
                creds.refresh(GoogleRequest())
                db_token.access_token = creds.token
                db_token.updated_at = func.now()
                db.commit()
            else:
                return {
                    "authenticated": False,
                    "email": None,
                    "mode": mode
                }
                
        service = build('gmail', 'v1', credentials=creds)
        profile = service.users().getProfile(userId='me').execute()
        email = profile.get('emailAddress', db_token.email)
        
        return {
            "authenticated": True,
            "email": email,
            "mode": mode
        }
    except Exception as e:
        logger.error(f"Error fetching Gmail auth status: {str(e)}")
        return {
            "authenticated": False,
            "email": None,
            "mode": mode,
            "error": str(e)
        }

@router.post("/logout")
def logout(
    response: Response,
    active_user_email: Optional[str] = Cookie(None),
    db: Session = Depends(get_db)
):
    """
    Disconnects the active Google account by removing its token DB record and clearing user data.
    """
    mode = os.getenv("APP_MODE", "mock").lower()
    
    response.delete_cookie(key="active_user_email")
    
    if not active_user_email:
        return {"status": "success", "message": "No active Google account connected."}
        
    try:
        # Clear the database email logs for this user
        clear_user_data(active_user_email, db)
        
        if mode != "mock":
            db.query(UserTokenModel).filter(UserTokenModel.email == active_user_email).delete(synchronize_session=False)
            db.commit()
            
        return {"status": "success", "message": f"Successfully disconnected Google account ({active_user_email}) and cleared data."}
    except Exception as e:
        logger.error(f"Failed to disconnect account {active_user_email}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to disconnect account: {str(e)}")
