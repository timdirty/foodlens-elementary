"""Document gate regressions, using temporary copies only (not app databases)."""

import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pypdf import PdfReader, PdfWriter

MODULE_PATH = Path(__file__).with_name("check-competition-proposal.py")
SPEC = importlib.util.spec_from_file_location("foodlens_document_gate", MODULE_PATH)
GATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GATE)


class DocumentGateTest(unittest.TestCase):
    def test_delivered_draft_passes_native_content_and_typography(self):
        result = GATE.verify()
        self.assertEqual(result["page_count"], 10)
        self.assertEqual(result["docx_paragraphs_checked"], 146)
        self.assertEqual(result["abstract_characters"], 286)
        self.assertEqual(result["entry_characters"], 95)

    def test_changed_source_cannot_reuse_old_docx(self):
        with tempfile.TemporaryDirectory(prefix="foodlens-doc-gate-") as tmp:
            changed = Path(tmp) / "changed-source.json"
            changed.write_bytes(GATE.SOURCE.read_bytes() + b"\n")
            with patch.object(GATE, "SOURCE", changed):
                with self.assertRaisesRegex(AssertionError, "Content changed"):
                    GATE.verify()

    def test_edited_docx_cannot_reuse_old_ledger(self):
        with tempfile.TemporaryDirectory(prefix="foodlens-doc-gate-") as tmp:
            changed = Path(tmp) / "edited.docx"
            changed.write_bytes(GATE.DOCX.read_bytes() + b"\n")
            with patch.object(GATE, "DOCX", changed):
                with self.assertRaisesRegex(AssertionError, "DOCX changed"):
                    GATE.verify()

    def test_eleven_pages_cannot_pass(self):
        with tempfile.TemporaryDirectory(prefix="foodlens-doc-gate-") as tmp:
            changed = Path(tmp) / "eleven.pdf"
            reader, writer = PdfReader(GATE.PDF), PdfWriter()
            for page in reader.pages:
                writer.add_page(page)
            writer.add_blank_page(width=595.3, height=841.89)
            with changed.open("wb") as output:
                writer.write(output)
            with patch.object(GATE, "PDF", changed):
                with self.assertRaisesRegex(AssertionError, "10頁"):
                    GATE.verify()


if __name__ == "__main__":
    unittest.main()
