import os
import base64
import logging
import threading
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session

# Google Client Library Imports
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.core.db import SessionLocal
from app.models import EmailModel, AttachmentModel
from app.services.parser_service import ParserService

logger = logging.getLogger(__name__)

# Scopes required for Gmail integration
SCOPES = ['https://www.googleapis.com/auth/gmail.modify']
TOKEN_FILE = 'token.json'
CLIENT_SECRETS_FILE = 'credentials.json'

# Sample Mock Data
MOCK_EMAILS = [
    {
        "message_id": "msg_001_invoice",
        "sender": "billing@cloudservices.com",
        "recipient": "admin@mycompany.com",
        "subject": "Invoice for Premium Cloud Services - June 2026",
        "body": "Dear Customer,\n\nPlease find attached your invoice for premium cloud usage in June 2026. The total amount due is $1,250.00.\n\nBest regards,\nBilling Team",
        "received_at": datetime(2026, 6, 3, 10, 15, 0, tzinfo=timezone.utc),
        "attachments": [
            {
                "attachment_id": "att_001",
                "filename": "invoice_cloud_june.pdf",
                "mime_type": "application/pdf",
                "content": b"%PDF-1.4 ... mock pdf content ... Invoice: INV-2026-001 ... Total Due: $1,250.00"
            }
        ]
    },
    {
        "message_id": "msg_002_alert",
        "sender": "alerts@monitoring-system.org",
        "recipient": "devops@mycompany.com",
        "subject": "CRITICAL: Database Disk Space Utilization Alert",
        "body": "WARNING: Disk storage for database node db-main-01 is currently at 89.4% capacity.\n\nPlease clean up log files or scale up the storage pool immediately to prevent read/write bottlenecks.",
        "received_at": datetime(2026, 6, 3, 11, 45, 0, tzinfo=timezone.utc),
        "attachments": []
    },
    {
        "message_id": "msg_003_receipt",
        "sender": "no-reply@domain-registrar.net",
        "recipient": "admin@mycompany.com",
        "subject": "Domain Registration Renewal Confirmation - mycompany.com",
        "body": "Hi there,\n\nThis is to confirm that domain name 'mycompany.com' has been renewed for 1 year. The renewal receipt is attached as a receipt image.\n\nThank you for choosing Registrar Services.",
        "received_at": datetime(2026, 6, 2, 9, 0, 0, tzinfo=timezone.utc),
        "attachments": [
            {
                "attachment_id": "att_002",
                "filename": "receipt_renewal.png",
                "mime_type": "image/png",
                "content": b"mock png image bytes"
            }
        ]
    },
    {
        "message_id": "msg_004_proposal",
        "sender": "clara.consultant@agile-agency.io",
        "recipient": "projects@mycompany.com",
        "subject": "Updated Project Scope Proposal - Phase 2 Sprint Plans",
        "body": "Hello Team,\n\nI have edited the project scope for our upcoming Phase 2 sprint deliverables. Attached is the plain-text requirements log.\n\nLet me know your thoughts before our standup tomorrow.",
        "received_at": datetime(2026, 6, 1, 15, 30, 0, tzinfo=timezone.utc),
        "attachments": [
            {
                "attachment_id": "att_003",
                "filename": "requirements_v2.txt",
                "mime_type": "text/plain",
                "content": "Phase 2 Deliverables:\n1. User Authentication Setup (OAuth2)\n2. Interactive Dashboard Layouts\n3. PostgreSQL Schema Migration\n4. Real-time Pub/Sub Webhook Listener\n5. PDF/Image OCR Parsing Engine"
            }
        ]
    }
]

class GmailService:
    _sync_lock = threading.Lock()

    def __init__(self):
        self.mode = os.getenv("APP_MODE", "mock").lower()
        logger.info(f"GmailService initialized in {self.mode} mode.")

    def get_gmail_credentials(self, db: Session, user_email: str) -> Optional[Credentials]:
        """
        Loads user credentials from the database for the given user_email.
        Refreshes expired credentials if a refresh token is present, and saves them back.
        """
        from app.models import UserTokenModel
        import json
        from google.auth.transport.requests import Request as GoogleRequest
        from google.oauth2.credentials import Credentials
        
        db_token = db.query(UserTokenModel).filter(UserTokenModel.email == user_email).first()
        if not db_token:
            logger.warning(f"No database tokens found for user: {user_email}")
            return None
            
        try:
            creds = Credentials(
                token=db_token.access_token,
                refresh_token=db_token.refresh_token,
                token_uri=db_token.token_uri,
                client_id=db_token.client_id,
                client_secret=db_token.client_secret,
                scopes=json.loads(db_token.scopes)
            )
        except Exception as e:
            logger.error(f"Error loading credentials from DB for {user_email}: {str(e)}")
            return None

        # If credentials are not valid/expired, check if we can refresh them.
        if creds and not creds.valid:
            if creds.expired and creds.refresh_token:
                try:
                    logger.info(f"Gmail credentials expired for {user_email}. Requesting refresh...")
                    creds.refresh(GoogleRequest())
                    # Save refreshed credentials back to DB
                    db_token.access_token = creds.token
                    db_token.updated_at = datetime.now(timezone.utc)
                    db.commit()
                    logger.info(f"Gmail credentials refreshed and saved to DB for {user_email}.")
                except Exception as e:
                    logger.error(f"Failed to refresh Google OAuth credentials for {user_email}: {str(e)}")
                    creds = None
            else:
                creds = None

        return creds

    def _get_users_to_sync(self, db: Session, active_user_email: Optional[str] = None) -> List[str]:
        if active_user_email:
            return [active_user_email]
        
        # If in mock mode, default to mock-user@gmail.com
        if self.mode == "mock":
            return ["mock-user@gmail.com"]
            
        # Get all users with saved tokens
        from app.models import UserTokenModel
        tokens = db.query(UserTokenModel.email).all()
        return [t.email for t in tokens]

    def sync_emails(self, db: Session, active_user_email: Optional[str] = None) -> Dict[str, Any]:
        """
        Synchronizes emails by querying either Gmail API or generating Mock Data.
        """
        with self._sync_lock:
            if self.mode == "mock":
                return self._sync_mock_emails(db, active_user_email)
            else:
                return self._sync_real_emails(db, active_user_email)

    def _sync_real_emails(self, db: Session, active_user_email: Optional[str] = None) -> Dict[str, Any]:
        """
        Connects to Gmail API, fetches unread emails, parses body and attachments,
        saves to PostgreSQL/SQLite, and marks emails as read.
        """
        logger.info("Initializing Gmail API sync...")
        users = self._get_users_to_sync(db, active_user_email)
        
        if not users:
            logger.warning("No users found to sync.")
            return {
                "status": "success",
                "mode": "production",
                "synced_count": 0,
                "duplicate_count": 0,
                "message": "No active Gmail connections found."
            }

        total_added = 0
        total_skipped = 0
        
        for user in users:
            logger.info(f"Syncing Gmail for user: {user}...")
            creds = self.get_gmail_credentials(db, user)
            
            if not creds:
                logger.warning(f"No valid Gmail API credentials found for user {user}.")
                continue

            try:
                # Build Gmail API client
                service = build('gmail', 'v1', credentials=creds)
                
                # 1. Fetch list of unread message IDs
                logger.info(f"Querying Gmail API for unread messages for {user}...")
                results = service.users().messages().list(userId='me', q='is:unread').execute()
                messages = results.get('messages', [])
                
                if not messages:
                    logger.info(f"No new unread emails found in Gmail inbox for {user}.")
                    continue

                for msg in messages:
                    msg_id = msg['id']
                    
                    # Scope message_id per user to avoid constraint collision between users receiving same mail
                    scoped_msg_id = f"{user}_{msg_id}"
                    
                    existing = db.query(EmailModel).filter(EmailModel.message_id == scoped_msg_id).first()
                    if existing:
                        total_skipped += 1
                        self._mark_message_read(service, msg_id)
                        continue

                    try:
                        # Get complete email details
                        email_data = service.users().messages().get(userId='me', id=msg_id, format='full').execute()
                        
                        # Parse Email Headers
                        headers = email_data.get('payload', {}).get('headers', [])
                        header_dict = {h['name'].lower(): h['value'] for h in headers}
                        
                        sender = header_dict.get('from', 'Unknown Sender')
                        recipient = header_dict.get('to', 'Unknown Recipient')
                        subject = header_dict.get('subject', '(No Subject)')
                        
                        # Parse Received Date
                        date_raw = header_dict.get('date')
                        received_at = datetime.now(timezone.utc)
                        if date_raw:
                            try:
                                from email.utils import parsedate_to_datetime
                                received_at = parsedate_to_datetime(date_raw)
                            except Exception as de:
                                logger.error(f"Failed parsing date header '{date_raw}': {str(de)}")

                        # Parse Email Body
                        body_plain, body_html = self._extract_email_body(email_data.get('payload', {}))
                        body = body_plain if body_plain else body_html
                        if not body:
                            body = "[No content in email body]"

                        # Save Email Record to DB
                        email_record = EmailModel(
                            message_id=scoped_msg_id,
                            user_email=user,
                            sender=sender,
                            recipient=recipient,
                            subject=subject,
                            body=body,
                            received_at=received_at,
                            processing_status="processing"
                        )
                        db.add(email_record)
                        db.flush()

                        # Parse Attachments
                        attachments_added = []
                        parts = self._get_mime_parts(email_data.get('payload', {}))
                        
                        for part in parts:
                            filename = part.get('filename')
                            body_data = part.get('body', {})
                            attachment_id = body_data.get('attachmentId')
                            
                            if filename and attachment_id:
                                mime_type = part.get('mimeType', 'application/octet-stream')
                                file_size = body_data.get('size', 0)
                                
                                logger.info(f"Downloading attachment ID: {attachment_id} ({filename}) for user {user}")
                                att_res = service.users().messages().attachments().get(
                                    userId='me', messageId=msg_id, id=attachment_id
                                ).execute()
                                
                                # Decode Base64URL string to binary
                                raw_data = att_res.get('data', '')
                                file_bytes = base64.urlsafe_b64decode(raw_data.encode('UTF-8'))
                                
                                # Parse Text Content using ParserService
                                extracted_text = ParserService.extract_text(
                                    filename=filename,
                                    mime_type=mime_type,
                                    file_bytes=file_bytes
                                )

                                # Store raw image bytes as base64 for inline preview
                                image_data = None
                                if mime_type.startswith("image/"):
                                    image_data = f"data:{mime_type};base64," + base64.b64encode(file_bytes).decode("utf-8")
                                
                                # Add attachment record
                                att_record = AttachmentModel(
                                    email_id=email_record.id,
                                    attachment_id=f"{user}_{attachment_id}",
                                    filename=filename,
                                    mime_type=mime_type,
                                    file_size_bytes=file_size,
                                    extracted_text=extracted_text,
                                    image_data=image_data,
                                    processing_status="completed"
                                )
                                db.add(att_record)
                                attachments_added.append(att_record)

                        # Update status and summary
                        email_record.summary = self._generate_simple_summary(subject, body, attachments_added)
                        email_record.processing_status = "completed"
                        db.commit()

                        # Mark email as read in Gmail (remove UNREAD label)
                        self._mark_message_read(service, msg_id)
                        total_added += 1
                        
                    except Exception as e:
                        logger.error(f"Error processing message {msg_id} for user {user}: {str(e)}")
                        db.rollback()
                        try:
                            failed_email = EmailModel(
                                message_id=scoped_msg_id,
                                user_email=user,
                                sender=sender if 'sender' in locals() else 'error@domain.com',
                                recipient=recipient if 'recipient' in locals() else 'error@domain.com',
                                subject=subject if 'subject' in locals() else 'Sync Failure',
                                body=f"Failed to process email: {str(e)}",
                                received_at=received_at if 'received_at' in locals() else datetime.now(timezone.utc),
                                processing_status="failed",
                                summary=f"Parsing Failure: {str(e)}"
                            )
                            db.add(failed_email)
                            db.commit()
                        except Exception as logging_error:
                            logger.error(f"Failed storing error email status for user {user}: {str(logging_error)}")
                            db.rollback()

            except HttpError as error:
                logger.error(f"Google Gmail API HTTP Error occurred for {user}: {str(error)}")
            except Exception as e:
                logger.error(f"Unexpected error during production sync for {user}: {str(e)}")

        return {
            "status": "success",
            "mode": "production",
            "synced_count": total_added,
            "duplicate_count": total_skipped
        }

    def _mark_message_read(self, service, msg_id: str):
        """
        Removes the 'UNREAD' label from the specified Gmail message.
        """
        try:
            service.users().messages().batchModify(
                userId='me',
                body={
                    'ids': [msg_id],
                    'removeLabelIds': ['UNREAD']
                }
            ).execute()
            logger.info(f"Marked email msg_id={msg_id} as READ.")
        except Exception as e:
            logger.error(f"Failed to remove UNREAD label from message {msg_id}: {str(e)}")

    def _extract_email_body(self, payload: Dict[str, Any]) -> tuple:
        """
        Recursively extracts plain text and HTML bodies from Gmail message payload parts.
        """
        body_plain = ""
        body_html = ""
        
        mime_type = payload.get('mimeType', '')
        body_data = payload.get('body', {}).get('data', '')

        # Base case - if data contains body bytes directly
        if body_data:
            decoded_body = base64.urlsafe_b64decode(body_data.encode('UTF-8')).decode('UTF-8', errors='ignore')
            if mime_type == 'text/plain':
                body_plain = decoded_body
            elif mime_type == 'text/html':
                body_html = decoded_body

        # Recursive case - if multipart
        parts = payload.get('parts', [])
        for part in parts:
            part_plain, part_html = self._extract_email_body(part)
            if part_plain:
                body_plain += part_plain
            if part_html:
                body_html += part_html

        return body_plain, body_html

    def _get_mime_parts(self, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Recursively flattens all parts of a multipart MIME message structure.
        """
        parts = []
        if 'parts' in payload:
            for part in payload['parts']:
                parts.append(part)
                parts.extend(self._get_mime_parts(part))
        return parts

    def _sync_mock_emails(self, db: Session, active_user_email: Optional[str] = None) -> Dict[str, Any]:
        """
        Synchronizes emails by generating Mock Data segmented by user.
        """
        logger.info("Running sync in MOCK mode...")
        users = self._get_users_to_sync(db, active_user_email)
        
        total_added = 0
        total_skipped = 0
        
        for user in users:
            for mock_email in MOCK_EMAILS:
                scoped_msg_id = f"{user}_{mock_email['message_id']}"
                existing = db.query(EmailModel).filter(EmailModel.message_id == scoped_msg_id).first()
                if existing:
                    total_skipped += 1
                    continue

                email_record = EmailModel(
                    message_id=scoped_msg_id,
                    user_email=user,
                    sender=mock_email["sender"],
                    recipient=mock_email["recipient"],
                    subject=mock_email["subject"],
                    body=mock_email["body"],
                    received_at=mock_email["received_at"],
                    processing_status="processing"
                )
                db.add(email_record)
                db.flush()

                attachments_added = []
                for mock_att in mock_email["attachments"]:
                    content_bytes = mock_att["content"] if isinstance(mock_att["content"], bytes) else mock_att["content"].encode()
                    extracted_text = ParserService.extract_text(
                        filename=mock_att["filename"],
                        mime_type=mock_att["mime_type"],
                        file_bytes=content_bytes
                    )

                    # Store raw image bytes as base64 for inline preview
                    image_data = None
                    if mock_att["mime_type"].startswith("image/"):
                        image_data = f"data:{mock_att['mime_type']};base64," + base64.b64encode(content_bytes).decode("utf-8")

                    att_record = AttachmentModel(
                        email_id=email_record.id,
                        attachment_id=f"{user}_{mock_att['attachment_id']}",
                        filename=mock_att["filename"],
                        mime_type=mock_att["mime_type"],
                        file_size_bytes=len(content_bytes),
                        extracted_text=extracted_text,
                        image_data=image_data,
                        processing_status="completed"
                    )
                    db.add(att_record)
                    attachments_added.append(att_record)

                summary = self._generate_simple_summary(email_record.subject, email_record.body, attachments_added)
                email_record.summary = summary
                email_record.processing_status = "completed"
                db.commit()
                total_added += 1

        return {
            "status": "success",
            "mode": "mock",
            "synced_count": total_added,
            "duplicate_count": total_skipped
        }

    def _generate_simple_summary(self, subject: str, body: str, attachments: List[AttachmentModel]) -> str:
        summary_lines = [f"Subject: {subject}"]
        if attachments:
            filenames = [att.filename for att in attachments]
            summary_lines.append(f"Contains {len(attachments)} attachment(s): {', '.join(filenames)}")
        clean_body = " ".join(body.split())
        summary_lines.append(f"Summary: {clean_body[:120]}..." if len(clean_body) > 120 else f"Summary: {clean_body}")
        return " | ".join(summary_lines)
