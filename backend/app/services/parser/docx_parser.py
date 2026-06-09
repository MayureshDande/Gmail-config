import io
import zipfile
import xml.etree.ElementTree as ET
from app.services.parser.base import BaseParser
from app.services.parser.exceptions import EmptyFileError, CorruptedFileError

class DocxParser(BaseParser):
    def parse(self, file_bytes: bytes) -> str:
        if not file_bytes:
            raise EmptyFileError("DOCX file is empty (0 bytes).")
            
        if not zipfile.is_zipfile(io.BytesIO(file_bytes)):
            raise CorruptedFileError("Invalid DOCX format: Not a valid ZIP archive.")
            
        try:
            with zipfile.ZipFile(io.BytesIO(file_bytes)) as docx:
                if 'word/document.xml' not in docx.namelist():
                    raise CorruptedFileError("Invalid DOCX format: Missing word/document.xml structure.")
                
                xml_content = docx.read('word/document.xml')
                root = ET.fromstring(xml_content)
                
                p_tag = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'
                t_tag = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t'
                
                paragraphs = []
                for p in root.iter(p_tag):
                    texts = []
                    for t in p.iter(t_tag):
                        if t.text:
                            texts.append(t.text)
                    paragraphs.append("".join(texts))
                
                return "\n".join(paragraphs)
        except CorruptedFileError:
            raise
        except Exception as e:
            raise CorruptedFileError(f"Failed to parse DOCX file: {str(e)}")
