from typing import Dict, Type
from app.services.parser.base import BaseParser
from app.services.parser.pdf_parser import PDFParser
from app.services.parser.docx_parser import DocxParser
from app.services.parser.txt_parser import TxtParser
from app.services.parser.exceptions import UnsupportedFormatError

class ParserFactory:
    _parsers: Dict[str, Type[BaseParser]] = {
        'pdf': PDFParser,
        'docx': DocxParser,
        'txt': TxtParser,
    }

    @classmethod
    def get_parser(cls, filename: str, mime_type: str) -> BaseParser:
        filename_lower = filename.lower()
        mime_type_lower = mime_type.lower()

        # Resolve by file extension first
        if filename_lower.endswith('.pdf'):
            return cls._parsers['pdf']()
        if filename_lower.endswith('.docx'):
            return cls._parsers['docx']()
        if filename_lower.endswith(('.txt', '.csv', '.json', '.xml', '.log')):
            return cls._parsers['txt']()

        # Resolve by MIME type
        if mime_type_lower == 'application/pdf':
            return cls._parsers['pdf']()
        if mime_type_lower == 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
            return cls._parsers['docx']()
        if mime_type_lower.startswith('text/'):
            return cls._parsers['txt']()

        raise UnsupportedFormatError(f"Unsupported format or MIME type: {mime_type} ({filename})")
