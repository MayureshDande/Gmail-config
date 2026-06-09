import io
import pdfplumber
from app.services.parser.base import BaseParser
from app.services.parser.exceptions import EmptyFileError, CorruptedFileError

class PDFParser(BaseParser):
    def parse(self, file_bytes: bytes) -> str:
        if not file_bytes:
            raise EmptyFileError("PDF file is empty (0 bytes).")
            
        # Check PDF header signature (usually within first few bytes)
        if b'%PDF' not in file_bytes[:1024]:
            raise CorruptedFileError("Invalid PDF format: Missing %PDF signature.")
            
        try:
            text_content = []
            with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
                for i, page in enumerate(pdf.pages):
                    page_text = page.extract_text()
                    if page_text:
                        text_content.append(f"--- Page {i+1} ---\n{page_text}")
            
            if not text_content:
                return "[PDF structure read successfully, but no text could be extracted. It might be scanned/image-only.]"
                
            return "\n\n".join(text_content)
        except Exception as e:
            raise CorruptedFileError(f"Failed to parse PDF file: {str(e)}")
