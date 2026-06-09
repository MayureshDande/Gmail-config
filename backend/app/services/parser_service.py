import logging
import json
from app.services.parser import ParserFactory, normalize_text, structure_to_json
from app.services.parser.exceptions import ParserError, UnsupportedFormatError

logger = logging.getLogger(__name__)

class ParserService:
    @staticmethod
    def extract_text(filename: str, mime_type: str, file_bytes: bytes) -> str:
        """
        Parses the binary attachment payload using the appropriate parser,
        normalizes the output, formats it to JSON, and returns it as a JSON string.
        """
        filename_lower = filename.lower()
        
        # Keep mock OCR for demo images
        if mime_type.startswith("image/") or filename_lower.endswith((".png", ".jpg", ".jpeg")):
            logger.info(f"Parsing Image attachment (Mock OCR): {filename}")
            mock_text = (
                
            )
            raw_text = normalize_text(mock_text)
            structured = structure_to_json(filename, mime_type, raw_text)
            return json.dumps(structured)
            
        try:
            logger.info(f"Resolving parser for attachment: {filename} ({mime_type})")
            parser = ParserFactory.get_parser(filename, mime_type)
            extracted_raw = parser.parse(file_bytes)
            raw_text = normalize_text(extracted_raw)
            structured = structure_to_json(filename, mime_type, raw_text)
            return json.dumps(structured)
            
        except UnsupportedFormatError as e:
            logger.warning(f"Unsupported attachment format: {str(e)}")
            structured = {
                "metadata": {
                    "filename": filename,
                    "mime_type": mime_type,
                    "status": "unsupported",
                    "error": str(e)
                },
                "raw_text": f"[Unsupported MIME format ({mime_type}). No text content could be extracted.]",
                "structured_data": {}
            }
            return json.dumps(structured)
            
        except ParserError as e:
            logger.error(f"Parser failed for attachment {filename}: {str(e)}")
            structured = {
                "metadata": {
                    "filename": filename,
                    "mime_type": mime_type,
                    "status": "failed",
                    "error": str(e)
                },
                "raw_text": f"[Error occurred during text extraction: {str(e)}]",
                "structured_data": {}
            }
            return json.dumps(structured)
            
        except Exception as e:
            logger.error(f"Unexpected error parsing attachment {filename}: {str(e)}")
            structured = {
                "metadata": {
                    "filename": filename,
                    "mime_type": mime_type,
                    "status": "failed",
                    "error": str(e)
                },
                "raw_text": f"[Unexpected error occurred during text extraction: {str(e)}]",
                "structured_data": {}
            }
            return json.dumps(structured)
