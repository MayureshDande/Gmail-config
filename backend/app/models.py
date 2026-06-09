import uuid
from sqlalchemy import Column, String, Text, ForeignKey, DateTime, Integer, func, Index
from sqlalchemy.orm import relationship
from app.core.db import Base

class UserTokenModel(Base):
    __tablename__ = "user_tokens"

    email = Column(String(320), primary_key=True, index=True)
    access_token = Column(Text, nullable=False)
    refresh_token = Column(Text, nullable=True)
    token_uri = Column(String(255), nullable=False)
    client_id = Column(String(255), nullable=False)
    client_secret = Column(String(255), nullable=False)
    scopes = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    def __repr__(self) -> str:
        return f"<UserToken(email='{self.email}')>"


class EmailModel(Base):
    __tablename__ = "emails"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_email = Column(String(320), nullable=True, index=True)
    message_id = Column(String(255), unique=True, nullable=False, index=True)
    sender = Column(String(320), nullable=False, index=True)
    recipient = Column(String(320), nullable=False)
    subject = Column(String(998), nullable=False)
    body = Column(Text, nullable=False)
    summary = Column(Text, nullable=True)
    received_at = Column(DateTime(timezone=True), nullable=False, index=True)
    processing_status = Column(String(50), default="pending", nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    attachments = relationship("AttachmentModel", back_populates="email", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_emails_user_email_received_at", "user_email", "received_at"),
        Index("ix_emails_user_email_processing_status", "user_email", "processing_status"),
    )

    def __repr__(self) -> str:
        return f"<Email(id={self.id}, message_id='{self.message_id}', sender='{self.sender}', status='{self.processing_status}')>"


class AttachmentModel(Base):
    __tablename__ = "attachments"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email_id = Column(String(36), ForeignKey("emails.id", ondelete="CASCADE"), nullable=False, index=True)
    attachment_id = Column(Text, nullable=False)
    filename = Column(String(255), nullable=False)
    mime_type = Column(String(100), nullable=False)
    file_size_bytes = Column(Integer, nullable=False)
    extracted_text = Column(Text, nullable=True)
    image_data = Column(Text, nullable=True)  # Base64-encoded image for preview (image/* mime types only)
    processing_status = Column(String(50), default="pending", nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    email = relationship("EmailModel", back_populates="attachments")

    def __repr__(self) -> str:
        return f"<Attachment(id={self.id}, filename='{self.filename}', mime_type='{self.mime_type}', status='{self.processing_status}')>"
