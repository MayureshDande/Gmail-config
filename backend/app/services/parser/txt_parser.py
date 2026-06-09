from app.services.parser.base import BaseParser
from app.services.parser.exceptions import EmptyFileError, CorruptedFileError

class TxtParser(BaseParser):
    def parse(self, file_bytes: bytes) -> str:
        if not file_bytes:
            raise EmptyFileError("TXT file is empty (0 bytes).")
            
        # Heuristic: if file contains null bytes in the first 1KB, it's likely binary/corrupted
        if b'\x00' in file_bytes[:1024]:
            raise CorruptedFileError("Invalid TXT format: File contains binary null bytes.")
            
        try:
            return file_bytes.decode('utf-8')
        except UnicodeDecodeError:
            try:
                return file_bytes.decode('latin-1')
            except Exception as e:
                raise CorruptedFileError(f"Failed to decode TXT file: {str(e)}")
