from fastapi import APIRouter, Depends, Cookie, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta, timezone
from typing import Optional
import os
from app.core.db import get_db
from app.models import EmailModel, AttachmentModel
from app.schemas import DashboardMetricsSchema

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

def get_current_user_email(active_user_email: Optional[str] = Cookie(None)) -> str:
    mode = os.getenv("APP_MODE", "mock").lower()
    if mode == "mock":
        return active_user_email or "mock-user@gmail.com"
    if not active_user_email:
        raise HTTPException(status_code=401, detail="Unauthorized: Gmail account not connected.")
    return active_user_email

@router.get("/metrics", response_model=DashboardMetricsSchema)
def get_metrics(
    db: Session = Depends(get_db),
    current_user_email: str = Depends(get_current_user_email)
):
    """
    Computes real-time analytical metrics to populate the dashboard cards and charts.
    """
    # 1. Total processed & failed emails
    total = db.query(EmailModel).filter(EmailModel.user_email == current_user_email).count()
    completed = db.query(EmailModel).filter(EmailModel.user_email == current_user_email, EmailModel.processing_status == "completed").count()
    failed = db.query(EmailModel).filter(EmailModel.user_email == current_user_email, EmailModel.processing_status == "failed").count()
    
    success_rate = 100.0
    if total > 0:
        success_rate = round((completed / total) * 100.0, 1)

    # 2. Group by MIME types (joined with EmailModel to scope by user_email)
    mime_groups = db.query(
        AttachmentModel.mime_type, 
        func.count(AttachmentModel.id)
    ).join(EmailModel).filter(
        EmailModel.user_email == current_user_email
    ).group_by(AttachmentModel.mime_type).all()
    
    processing_by_mime = {mime: count for mime, count in mime_groups}

    # 3. Create Timeline stats (last 7 days volume)
    timeline = []
    today = datetime.now(timezone.utc).date()
    
    for i in range(6, -1, -1):
        target_date = today - timedelta(days=i)
        
        # Count items received on target_date
        # In SQL, we cast received_at to Date
        emails_on_day = db.query(EmailModel).filter(
            EmailModel.user_email == current_user_email,
            func.date(EmailModel.received_at) == target_date
        )
        
        day_completed = emails_on_day.filter(EmailModel.processing_status == "completed").count()
        day_failed = emails_on_day.filter(EmailModel.processing_status == "failed").count()
        
        timeline.append({
            "date": target_date.strftime("%Y-%m-%d"),
            "processed": day_completed,
            "failed": day_failed
        })

    return {
        "total_emails_processed": total,
        "failed_emails": failed,
        "success_rate_percentage": success_rate,
        "processing_by_mime": processing_by_mime,
        "timeline": timeline
    }
