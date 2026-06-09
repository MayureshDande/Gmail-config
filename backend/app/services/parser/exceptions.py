class ParserError(Exception):
    """Base exception for all parsing errors."""
    pass

class EmptyFileError(ParserError):
    """Raised when the file content is empty (0 bytes)."""
    pass

class CorruptedFileError(ParserError):
    """Raised when the file structure is invalid or corrupt."""
    pass

class UnsupportedFormatError(ParserError):
    """Raised when the file format or MIME type is not supported."""
    pass
