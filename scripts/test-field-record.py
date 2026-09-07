"""Blank measurement-form gate regressions; mutate temporary copies only."""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pypdf import PdfReader, PdfWriter

MODULE_PATH = Path(__file__).with_name("check-field-record.py")
SPEC = importlib.util.spec_from_file_location("foodlens_field_record_gate", MODULE_PATH)
GATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GATE)


class FieldRecordGateTest(unittest.TestCase):
    def test_current_form_passes_native_content_and_frozen_ledger(self):
        ledger = json.loads((GATE.WORK / "source-ledger.json").read_text(encoding="utf-8"))
        result = GATE.verify()
        self.assertEqual(result["status"], "automated-checks-passed")
        self.assertEqual(result["pages"], 3)
        self.assertEqual(result["native_ledger_items"], len(ledger["paragraphs"]))
        self.assertEqual(result["source_sha256"], ledger["source_sha256"])
        self.assertEqual(result["docx"]["sha256"], ledger["docx_sha256"])
        self.assertEqual(result["pdf"]["sha256"], GATE.sha(GATE.PDF))

    def test_changed_source_cannot_reuse_frozen_form(self):
        with tempfile.TemporaryDirectory(prefix="foodlens-field-gate-") as tmp:
            changed = Path(tmp) / "changed-source.json"
            changed.write_bytes(GATE.SOURCE.read_bytes() + b"\n")
            with patch.object(GATE, "SOURCE", changed):
                with self.assertRaisesRegex(AssertionError, "Source changed after build"):
                    GATE.verify()

    def test_edited_docx_cannot_reuse_old_ledger(self):
        with tempfile.TemporaryDirectory(prefix="foodlens-field-gate-") as tmp:
            changed = Path(tmp) / "changed.docx"
            changed.write_bytes(GATE.DOCX.read_bytes() + b"\n")
            with patch.object(GATE, "DOCX", changed):
                with self.assertRaisesRegex(AssertionError, "DOCX changed after build"):
                    GATE.verify()

    def test_fourth_blank_page_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix="foodlens-field-gate-") as tmp:
            changed = Path(tmp) / "four-pages.pdf"
            reader, writer = PdfReader(GATE.PDF), PdfWriter()
            for page in reader.pages:
                writer.add_page(page)
            writer.add_blank_page(width=595.276, height=841.89)
            with changed.open("wb") as output:
                writer.write(output)
            with patch.object(GATE, "PDF", changed):
                with self.assertRaisesRegex(AssertionError, "guide must remain page three"):
                    GATE.verify()


if __name__ == "__main__":
    unittest.main()
