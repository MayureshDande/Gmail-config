class pytest:
    class raises:
        def __init__(self, expected_exception):
            self.expected_exception = expected_exception
        def __enter__(self):
            return self
        def __exit__(self, exc_type, exc_val, exc_tb):
            if exc_type is None:
                raise AssertionError(f"Exception {self.expected_exception.__name__} was not raised")
            if not issubclass(exc_type, self.expected_exception):
                raise AssertionError(f"Expected {self.expected_exception.__name__}, got {exc_type.__name__}")
            return True

import io
import zipfile
from unittest.mock import patch, MagicMock
from app.services.parser.exceptions import EmptyFileError, CorruptedFileError, UnsupportedFormatError
from app.services.parser.pdf_parser import PDFParser
from app.services.parser.docx_parser import DocxParser
from app.services.parser.txt_parser import TxtParser
from app.services.parser.factory import ParserFactory
from app.services.parser.utils import normalize_text, structure_to_json
from app.services.parser_service import ParserService

# Helper to generate a valid in-memory DOCX file
def generate_mock_docx(text: str) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as docx:
        xml_content = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
            <w:body>
                <w:p>
                    <w:t>{text}</w:t>
                </w:p>
            </w:body>
        </w:document>
        """
        docx.writestr('word/document.xml', xml_content)
    return buffer.getvalue()


# 1. Text Normalization Tests
def test_normalize_text():
    raw_text = "\r\n  Hello World   \r\n\n\n\nNew Line  \r\n"
    expected = "Hello World\n\nNew Line"
    assert normalize_text(raw_text) == expected
    assert normalize_text("") == ""
    assert normalize_text(None) == ""


# 2. TxtParser Tests
def test_txt_parser_success():
    parser = TxtParser()
    assert parser.parse(b"Hello world") == "Hello world"
    # UTF-8 and Latin-1 characters
    assert "café" in parser.parse("café".encode("utf-8"))
    assert "café" in parser.parse("café".encode("latin-1"))

def test_txt_parser_empty():
    parser = TxtParser()
    with pytest.raises(EmptyFileError):
        parser.parse(b"")

def test_txt_parser_binary_corrupted():
    parser = TxtParser()
    # Null bytes indicate binary content
    with pytest.raises(CorruptedFileError):
        parser.parse(b"Hello\x00world")


# 3. DocxParser Tests
def test_docx_parser_success():
    parser = DocxParser()
    docx_bytes = generate_mock_docx("This is a parsed docx file.")
    assert parser.parse(docx_bytes) == "This is a parsed docx file."

def test_docx_parser_empty():
    parser = DocxParser()
    with pytest.raises(EmptyFileError):
        parser.parse(b"")

def test_docx_parser_not_zip():
    parser = DocxParser()
    with pytest.raises(CorruptedFileError):
        parser.parse(b"This is not a zip file.")

def test_docx_parser_missing_xml():
    parser = DocxParser()
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as invalid_zip:
        invalid_zip.writestr('some_other_file.txt', 'hello')
    with pytest.raises(CorruptedFileError):
        parser.parse(buffer.getvalue())


# 4. PDFParser Tests
@patch('pdfplumber.open')
def test_pdf_parser_success(mock_open):
    # Set up mock pdf structure
    mock_pdf = MagicMock()
    mock_page = MagicMock()
    mock_page.extract_text.return_value = "Extracted PDF contents"
    mock_pdf.pages = [mock_page]
    mock_open.return_value.__enter__.return_value = mock_pdf

    parser = PDFParser()
    # Must start with %PDF
    pdf_bytes = b"%PDF-1.4\ncontent"
    result = parser.parse(pdf_bytes)
    assert "Extracted PDF contents" in result
    mock_open.assert_called_once()

def test_pdf_parser_empty():
    parser = PDFParser()
    with pytest.raises(EmptyFileError):
        parser.parse(b"")

def test_pdf_parser_invalid_header():
    parser = PDFParser()
    with pytest.raises(CorruptedFileError):
        parser.parse(b"Invalid PDF content without header")

@patch('pdfplumber.open')
def test_pdf_parser_read_error(mock_open):
    mock_open.side_effect = Exception("Internal PDF render error")
    parser = PDFParser()
    with pytest.raises(CorruptedFileError):
        parser.parse(b"%PDF-1.4\ncontent")


# 5. ParserFactory Tests
def test_parser_factory_extensions():
    assert isinstance(ParserFactory.get_parser("test.pdf", ""), PDFParser)
    assert isinstance(ParserFactory.get_parser("test.docx", ""), DocxParser)
    assert isinstance(ParserFactory.get_parser("test.txt", ""), TxtParser)
    assert isinstance(ParserFactory.get_parser("test.csv", ""), TxtParser)

def test_parser_factory_mimes():
    assert isinstance(ParserFactory.get_parser("test", "application/pdf"), PDFParser)
    assert isinstance(ParserFactory.get_parser("test", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), DocxParser)
    assert isinstance(ParserFactory.get_parser("test", "text/plain"), TxtParser)

def test_parser_factory_unsupported():
    with pytest.raises(UnsupportedFormatError):
        ParserFactory.get_parser("test.mp3", "audio/mpeg")


# 6. ParserService Integration Tests
import json

def test_structure_to_json():
    # Test valid text invoice extraction
    invoice_text = "INVOICE NUMBER: INV-999\nINVOICE DATE: 2026-06-04\nTOTAL AMOUNT: $2,500.00\nEMAIL: info@company.com"
    res = structure_to_json("invoice.txt", "text/plain", invoice_text)
    assert res["metadata"]["filename"] == "invoice.txt"
    assert res["metadata"]["status"] == "success"
    assert res["structured_data"]["invoice_number"] == "INV-999"
    assert res["structured_data"]["invoice_date"] == "2026-06-04"
    assert res["structured_data"]["total_amount"] == "$2,500.00"
    assert "info@company.com" in res["structured_data"]["emails"]
    assert "2026-06-04" in res["structured_data"]["dates"]

def test_parser_service_image_mock():
    # Images should trigger mock OCR
    result = ParserService.extract_text("invoice.png", "image/png", b"some bytes")
    res_dict = json.loads(result)
    assert res_dict["metadata"]["filename"] == "invoice.png"
    assert "MOCK OCR EXTRACTED TEXT FROM IMAGE" in res_dict["raw_text"]
    assert res_dict["structured_data"]["invoice_number"] == "INV-2026-089"
    assert res_dict["structured_data"]["total_amount"] == "$1,450.00"

@patch('pdfplumber.open')
def test_parser_service_pdf_success(mock_open):
    mock_pdf = MagicMock()
    mock_page = MagicMock()
    mock_page.extract_text.return_value = "INVOICE NUMBER : INV-882\nTOTAL AMOUNT DUE : $320.00\nPage content text"
    mock_pdf.pages = [mock_page]
    mock_open.return_value.__enter__.return_value = mock_pdf

    result = ParserService.extract_text("invoice.pdf", "application/pdf", b"%PDF-1.4\ncontent")
    res_dict = json.loads(result)
    assert "Page content text" in res_dict["raw_text"]
    assert res_dict["structured_data"]["invoice_number"] == "INV-882"
    assert res_dict["structured_data"]["total_amount"] == "$320.00"

def test_parser_service_unsupported():
    result = ParserService.extract_text("song.mp3", "audio/mpeg", b"bytes")
    res_dict = json.loads(result)
    assert res_dict["metadata"]["status"] == "unsupported"
    assert "Unsupported MIME format" in res_dict["raw_text"]

def test_parser_service_error_handling():
    # Empty file should fail with warning / error message rather than throwing uncaught exceptions
    result = ParserService.extract_text("invoice.txt", "text/plain", b"")
    res_dict = json.loads(result)
    assert res_dict["metadata"]["status"] == "failed"
    assert "Error occurred during text extraction" in res_dict["raw_text"]


if __name__ == "__main__":
    print("Running manual test runner...")
    tests = [
        test_normalize_text,
        test_structure_to_json,
        test_txt_parser_success,
        test_txt_parser_empty,
        test_txt_parser_binary_corrupted,
        test_docx_parser_success,
        test_docx_parser_empty,
        test_docx_parser_not_zip,
        test_docx_parser_missing_xml,
        test_pdf_parser_success,
        test_pdf_parser_empty,
        test_pdf_parser_invalid_header,
        test_pdf_parser_read_error,
        test_parser_factory_extensions,
        test_parser_factory_mimes,
        test_parser_factory_unsupported,
        test_parser_service_image_mock,
        test_parser_service_pdf_success,
        test_parser_service_unsupported,
        test_parser_service_error_handling,
    ]
    
    passed = 0
    failed = 0
    for test in tests:
        try:
            test()
            print(f"PASS: {test.__name__}")
            passed += 1
        except Exception as e:
            print(f"FAIL: {test.__name__} - {str(e)}")
            import traceback
            traceback.print_exc()
            failed += 1
            
    print(f"\nTest Summary: {passed} passed, {failed} failed.")
    import sys
    sys.exit(failed)

