import os
import sqlite3
from sqlalchemy import create_engine, inspect
from dotenv import load_dotenv
from app.core.db import Base, DATABASE_URL, engine
from app.models import UserTokenModel, EmailModel, AttachmentModel

load_dotenv()

def migrate():
    print(f"Connecting to database at: {DATABASE_URL}")
    
    # 1. Create tables if they do not exist (UserTokenModel will be created)
    print("Creating any missing tables...")
    Base.metadata.create_all(bind=engine)
    
    # 2. Check if emails table has user_email column
    inspector = inspect(engine)
    columns = [col['name'] for col in inspector.get_columns('emails')]
    
    if 'user_email' not in columns:
        print("Column 'user_email' is missing in 'emails' table. Adding it...")
        if DATABASE_URL.startswith("sqlite"):
            # SQLite migration
            db_path = DATABASE_URL.replace("sqlite:///", "")
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            try:
                cursor.execute("ALTER TABLE emails ADD COLUMN user_email VARCHAR(320);")
                cursor.execute("CREATE INDEX IF NOT EXISTS ix_emails_user_email ON emails (user_email);")
                cursor.execute("CREATE INDEX IF NOT EXISTS ix_emails_user_email_received_at ON emails (user_email, received_at);")
                cursor.execute("CREATE INDEX IF NOT EXISTS ix_emails_user_email_processing_status ON emails (user_email, processing_status);")
                conn.commit()
                print("SQLite migration successful!")
            except Exception as e:
                print(f"SQLite migration failed: {e}")
            finally:
                conn.close()
        else:
            # PostgreSQL migration
            import psycopg2
            from urllib.parse import urlparse
            try:
                conn = psycopg2.connect(DATABASE_URL)
                cursor = conn.cursor()
                cursor.execute("ALTER TABLE emails ADD COLUMN IF NOT EXISTS user_email VARCHAR(320);")
                cursor.execute("CREATE INDEX IF NOT EXISTS ix_emails_user_email ON emails (user_email);")
                cursor.execute("CREATE INDEX IF NOT EXISTS ix_emails_user_email_received_at ON emails (user_email, received_at);")
                cursor.execute("CREATE INDEX IF NOT EXISTS ix_emails_user_email_processing_status ON emails (user_email, processing_status);")
                conn.commit()
                print("PostgreSQL migration successful!")
            except Exception as e:
                print(f"PostgreSQL migration failed: {e}")
            finally:
                if 'conn' in locals():
                    conn.close()
    else:
        print("Column 'user_email' already exists in 'emails' table. No migration needed.")

if __name__ == "__main__":
    migrate()
