from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional

class AttachmentSchema(BaseModel):
    id: str
    attachment_id: str
    filename: str
    mime_type: str
    file_size_bytes: int
    extracted_text: Optional[str] = None
    image_data: Optional[str] = None  # Base64 image string for inline preview
    processing_status: str
    created_at: datetime

    class Config:
        from_attributes = True


class EmailListSchema(BaseModel):
    id: str
    message_id: str
    sender: str
    recipient: str
    subject: str
    received_at: datetime
    processing_status: str
    summary: Optional[str] = None
    attachment_count: int

    class Config:
        from_attributes = True


class EmailDetailSchema(BaseModel):
    id: str
    message_id: str
    sender: str
    recipient: str
    subject: str
    body: str
    summary: Optional[str] = None
    received_at: datetime
    processing_status: str
    created_at: datetime
    attachments: List[AttachmentSchema] = []

    class Config:
        from_attributes = True


class DashboardMetricsSchema(BaseModel):
    total_emails_processed: int
    failed_emails: int
    success_rate_percentage: float
    processing_by_mime: dict
    timeline: List[dict]

    class Config:
        from_attributes = True
