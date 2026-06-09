from abc import ABC, abstractmethod

class BaseParser(ABC):
    @abstractmethod
    def parse(self, file_bytes: bytes) -> str:
        """
        Parses binary file bytes and extracts text.
        
        :param file_bytes: Binary contents of the file.
        :return: Extracted plain text content.
        :raises EmptyFileError: If the file is 0 bytes.
        :raises CorruptedFileError: If the file is corrupted/invalid.
        :raises ParserError: For generic parsing failures.
        """
        pass
