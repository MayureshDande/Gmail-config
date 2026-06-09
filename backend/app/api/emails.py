from fastapi import APIRouter, Depends, HTTPException, Query, Cookie
from sqlalchemy.orm import Session
from sqlalchemy import desc, or_
from typing import List, Dict, Any, Optional
import os
from app.core.db import get_db
from datetime import datetime, timezone
from app.models import EmailModel, AttachmentModel
from app.schemas import EmailListSchema, EmailDetailSchema
from app.services.gmail_service import GmailService

router = APIRouter(prefix="/emails", tags=["Emails"])
gmail_service = GmailService()

def get_current_user_email(active_user_email: Optional[str] = Cookie(None)) -> str:
    mode = os.getenv("APP_MODE", "mock").lower()
    if mode == "mock":
        return active_user_email or "mock-user@gmail.com"
    if not active_user_email:
        raise HTTPException(status_code=401, detail="Unauthorized: Gmail account not connected.")
    return active_user_email

@router.get("", response_model=Dict[str, Any])
def get_emails(
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    status: Optional[str] = None,
    search: Optional[str] = None,
    sender: Optional[str] = None,
    attachment_type: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user_email: str = Depends(get_current_user_email)
):
    """
    Get a paginated list of processed emails with optional keyword search and status filtering.
    """
    query = db.query(EmailModel).filter(EmailModel.user_email == current_user_email)
    
    # 1. Apply status filter
    if status:
        query = query.filter(EmailModel.processing_status == status)
        
    # 2. Apply text search
    if search:
        search_filter = or_(
            EmailModel.subject.ilike(f"%{search}%"),
            EmailModel.sender.ilike(f"%{search}%"),
            EmailModel.body.ilike(f"%{search}%")
        )
        query = query.filter(search_filter)

    # 3. Apply sender filter
    if sender:
        query = query.filter(EmailModel.sender.ilike(f"%{sender}%"))

    # 4. Apply attachment type filter
    if attachment_type:
        if attachment_type == 'none':
            query = query.filter(~EmailModel.attachments.any())
        elif attachment_type == 'any':
            query = query.filter(EmailModel.attachments.any())
        elif attachment_type == 'pdf':
            query = query.filter(EmailModel.attachments.any(AttachmentModel.mime_type.ilike("%pdf%")))
        elif attachment_type == 'image':
            query = query.filter(EmailModel.attachments.any(AttachmentModel.mime_type.ilike("%image%")))
        elif attachment_type == 'text':
            query = query.filter(EmailModel.attachments.any(AttachmentModel.mime_type.ilike("%text%")))
        elif attachment_type == 'other':
            query = query.filter(EmailModel.attachments.any(
                ~AttachmentModel.mime_type.ilike("%pdf%") & 
                ~AttachmentModel.mime_type.ilike("%image%") & 
                ~AttachmentModel.mime_type.ilike("%text%")
            ))

    # 5. Apply date range filter
    if start_date:
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            query = query.filter(EmailModel.received_at >= start_dt)
        except ValueError:
            pass
            
    if end_date:
        try:
            end_dt = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59, microsecond=999999, tzinfo=timezone.utc)
            query = query.filter(EmailModel.received_at <= end_dt)
        except ValueError:
            pass
        
    total = query.count()
    
    # 3. Order and Paginate
    emails = query.order_by(desc(EmailModel.received_at))\
                  .offset((page - 1) * limit)\
                  .limit(limit)\
                  .all()
                  
    # Transform to schema listing with attachment counts
    items = []
    for email in emails:
        items.append(
            EmailListSchema(
                id=email.id,
                message_id=email.message_id,
                sender=email.sender,
                recipient=email.recipient,
                subject=email.subject,
                received_at=email.received_at,
                processing_status=email.processing_status,
                summary=email.summary,
                attachment_count=len(email.attachments)
            )
        )
        
    return {
        "items": items,
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit
    }

@router.get("/{email_id}", response_model=EmailDetailSchema)
def get_email_details(
    email_id: str, 
    db: Session = Depends(get_db),
    current_user_email: str = Depends(get_current_user_email)
):
    """
    Retrieve details of a single email, including its attachment data.
    """
    email = db.query(EmailModel).filter(
        EmailModel.id == email_id,
        EmailModel.user_email == current_user_email
    ).first()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    return email

@router.post("/sync")
def trigger_manual_sync(
    db: Session = Depends(get_db),
    current_user_email: str = Depends(get_current_user_email)
):
    """
    Manually triggers email sync.
    """
    try:
        result = gmail_service.sync_emails(db, active_user_email=current_user_email)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Manual sync failed: {str(e)}")
