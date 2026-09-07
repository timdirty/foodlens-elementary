"""Shared document gate regressions. Synthetic temporary fixtures only.

The PDF parser/rendering boundaries are mocked for controlled font/size/content
cases. One real pypdf-generated blank PDF verifies native-text fail-closed
behavior; no test modifies the real register, DOCX, PDF, or other repositories.
"""

import contextlib
from copy import deepcopy
import importlib.util
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
from xml.sax.saxutils import escape
from zipfile import ZipFile

from pypdf import PdfWriter

SPEC = importlib.util.spec_from_file_location("shared_competition_gate", Path(__file__).with_name("check-shared-competition.py"))
GATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GATE)


class FontProgram:
    def __init__(self, name="BiauKaiTC-Regular"):
        self.name = name

    def get_data(self):
        return f"%!FontType1-1.0\n/FontName /{self.name} def".encode("ascii")


def font(name="BiauKaiTC-Regular", embedded=True):
    descriptor = {"/FontName": f"/AAAAAA+{name}"}
    if embedded:
        descriptor["/FontFile"] = FontProgram(name)
    return {"/BaseFont": f"/AAAAAA+{name}", "/FontDescriptor": descriptor}


class NativePage(dict):
    def __init__(self, lines, font_name="BiauKaiTC-Regular", embedded=True):
        super().__init__({"/Resources": {"/Font": {"/F1": font(font_name, embedded)}}})
        self.lines = lines

    def extract_text(self):
        return "\n".join(text for text, _ in self.lines)


class DrawnPage:
    def __init__(self, lines, font_name="BiauKaiTC-Regular", width=595.276, height=841.89):
        self.width, self.height, self.images = width, height, []
        self.chars = [{"text": char, "size": size, "fontname": f"AAAAAA+{font_name}"}
                      for text, size in lines for char in text]


class Reader:
    def __init__(self, pages):
        self.pages, self.is_encrypted = pages, False
        self.trailer = {"/Root": {"/Pages": pages}}


class Drawing:
    def __init__(self, pages):
        self.pages = pages

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class SharedGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="foodlens-shared-gate-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.register_path = self.root / "register.json"
        self.lines = [[("測試提案", 24), ("研究方法", 14), ("這是原生內文。", 12)], [("這是摘要。", 12)]]
        self.reader = Reader([NativePage(lines) for lines in self.lines])
        self.drawing = Drawing([DrawnPage(lines) for lines in self.lines])
        official = self.root / "official.pdf"
        official.write_bytes(b"synthetic official source bytes, not a rendered proposal")
        self.register = {"schema_version": 1, "official_sources": [self.file_spec(official)],
                         "policy": {"internal_pdf_size_exclusive_limit_bytes": 5_000_000}, "projects": []}
        for pid in sorted(GATE.PROJECT_IDS):
            workspace = self.root / pid
            workspace.mkdir()
            docx, pdf = workspace / "proposal.docx", workspace / "proposal.pdf"
            self.write_docx(docx)
            pdf.write_bytes(f"synthetic {pid} PDF bytes; parser boundary mocked".encode())
            self.register["projects"].append({"project_id": pid, "workspace": str(workspace),
                "artifacts": [{**self.file_spec(docx), "kind": "editable-master"},
                              {**self.file_spec(pdf), "kind": "reading-pdf", "page_count": 2}],
                "document_contract": {"abstract": {"text": "這是摘要。", "max_characters": 300, "page": 2},
                    "entry_abstract": {"text": "這是報名摘要。", "max_characters": 100},
                    "required_text": [{"text": text, "page": 1, "role": role}
                                      for (text, _), role in zip(self.lines[0], ("title", "heading", "body"))]},
                "source_snapshot": {"status": "frozen-named-review-pending"},
                "pending_review": ["學生具名覆核", "校方核章"],
                "submission": {"status": "not-submitted", "receipt": None}})

    def file_spec(self, path):
        return {"path": str(path), "sha256": GATE.sha(path), "byte_size": path.stat().st_size, "generation_status": "exists"}

    def write_docx(self, path, extra="", alt=None):
        paragraphs = "".join(f"<w:p><w:r><w:t>{escape(text)}</w:t></w:r></w:p>" for lines in self.lines for text, _ in lines)
        image = "" if alt is None else f'<w:p><wp:docPr id="1" name="Image" descr="{escape(alt)}"/></w:p>'
        xml = f'<w:document xmlns:w="{GATE.NS["w"]}" xmlns:wp="{GATE.NS["wp"]}"><w:body>{paragraphs}{image}{extra}</w:body></w:document>'
        with ZipFile(path, "w") as archive:
            archive.writestr("[Content_Types].xml", "<Types/>")
            archive.writestr("word/styles.xml", "<styles/>")
            archive.writestr("word/document.xml", xml)

    def save(self):
        self.register_path.write_text(json.dumps(self.register, ensure_ascii=False), encoding="utf-8")

    def run_gate(self):
        self.save()
        with patch.object(GATE, "PdfReader", return_value=self.reader), patch.object(GATE.pdfplumber, "open", return_value=self.drawing):
            return GATE.verify(self.register_path)

    def finding(self, result, code, status="failed"):
        return any(c["code"] == code and c["status"] == status for c in result["checks"])

    def test_complete_automated_fixture_still_has_no_approval(self):
        result = self.run_gate()
        self.assertEqual(result["exit_code"], 0, result["checks"])
        self.assertEqual(result["readiness"], "not-assessed-no-approval")
        for pending in result["pending"].values():
            self.assertEqual(pending["reviews"], ["學生具名覆核", "校方核章"])
            self.assertEqual(pending["submission"]["status"], "not-submitted")
            self.assertEqual(pending["visual_qa"], "not-assessed-by-this-tool")

    def test_duplicate_project_ids_and_missing_id_are_rejected(self):
        self.register["projects"][2]["project_id"] = "foodlens"
        result = self.run_gate()
        self.assertTrue(self.finding(result, "exact-project-set"))
        self.assertTrue(self.finding(result, "unique-project-ids"))
        self.assertEqual(result["exit_code"], 1)

    def test_non_string_id_does_not_crash_collection(self):
        self.register["projects"][0]["project_id"] = ["foodlens"]
        result = self.run_gate()
        self.assertTrue(self.finding(result, "exact-project-set"))
        self.assertEqual(len(result["pending"]), 3)

    def test_hash_and_size_drift_both_collected_with_other_projects(self):
        artifact = self.register["projects"][0]["artifacts"][0]
        Path(artifact["path"]).write_bytes(b"changed invalid DOCX")
        result = self.run_gate()
        self.assertTrue(self.finding(result, "sha256"))
        self.assertTrue(self.finding(result, "byte-size"))
        self.assertTrue(self.finding(result, "docx-readable-package"))
        self.assertIn("soundscape", result["pending"])

    def test_official_source_drift_is_not_ignored(self):
        Path(self.register["official_sources"][0]["path"]).write_bytes(b"different official revision")
        self.assertTrue(self.finding(self.run_gate(), "sha256"))

    def test_missing_expected_metadata_is_unknown_not_backfilled(self):
        del self.register["projects"][0]["artifacts"][0]["byte_size"]
        del self.register["projects"][0]["document_contract"]
        result = self.run_gate()
        self.assertEqual(result["exit_code"], 2)
        self.assertTrue(self.finding(result, "byte-size", "unknown"))
        self.assertTrue(self.finding(result, "document-contract", "unknown"))
        self.assertNotIn("byte_size", self.register["projects"][0]["artifacts"][0])

    def test_pending_path_is_unknown_but_declared_missing_file_fails(self):
        artifact = self.register["projects"][0]["artifacts"][0]
        artifact["path"] = None
        self.assertEqual(self.run_gate()["exit_code"], 2)
        artifact["path"] = str(self.root / "foodlens" / "missing.docx")
        self.assertTrue(self.finding(self.run_gate(), "file-exists"))

    def test_missing_planned_file_is_unknown(self):
        artifact = self.register["projects"][0]["artifacts"][0]
        artifact["path"] = str(self.root / "foodlens" / "planned.docx")
        artifact["generation_status"] = "pending"
        result = self.run_gate()
        self.assertEqual(result["exit_code"], 2)
        self.assertTrue(self.finding(result, "file-exists", "unknown"))

    def test_workspace_escape_is_refused(self):
        self.register["projects"][0]["artifacts"][0]["path"] = self.register["projects"][1]["artifacts"][0]["path"]
        self.assertTrue(self.finding(self.run_gate(), "path-boundary"))

    def test_duplicate_artifact_kind_is_rejected(self):
        self.register["projects"][0]["artifacts"].append(deepcopy(self.register["projects"][0]["artifacts"][0]))
        result = self.run_gate()
        self.assertTrue(self.finding(result, "required-artifact-pair"))
        self.assertTrue(self.finding(result, "unique-artifact-path"))

    def test_missing_image_alt_fails(self):
        artifact = self.register["projects"][0]["artifacts"][0]
        path = Path(artifact["path"])
        self.write_docx(path, alt="")
        artifact.update(self.file_spec(path))
        self.assertTrue(self.finding(self.run_gate(), "docx-image-alts"))

    def test_native_paragraph_missing_from_pdf_fails(self):
        self.reader.pages[0].lines = [("測試提案", 24), ("研究方法", 14)]
        self.assertTrue(self.finding(self.run_gate(), "native-docx-pdf-paragraph-parity"))

    def test_scan_only_pdf_fails_native_check_without_ocr(self):
        self.reader.pages[0].lines = []
        self.drawing.pages[0].chars = []
        result = self.run_gate()
        self.assertTrue(self.finding(result, "pdf-native-text"))
        self.assertTrue(self.finding(result, "pdf-rendered-font"))

    def test_eleven_pages_and_non_a4_fail(self):
        self.reader.pages = self.reader.pages + [NativePage([("extra", 12)])] * 9
        self.drawing.pages = self.drawing.pages + [DrawnPage([("extra", 12)], width=612)] * 9
        result = self.run_gate()
        self.assertTrue(self.finding(result, "pdf-page-limit"))
        self.assertTrue(self.finding(result, "pdf-a4"))

    def test_font_substitution_even_when_basefont_lies_fails(self):
        actual = self.reader.pages[0]["/Resources"]["/Font"]["/F1"]
        actual["/FontDescriptor"]["/FontFile"] = FontProgram("NotoSansCJKtc-Regular")
        self.assertTrue(self.finding(self.run_gate(), "pdf-embedded-program"))

    def test_rendered_fallback_font_fails(self):
        self.drawing.pages[0].chars[0]["fontname"] = "AAAAAA+NotoSansCJKtc-Regular"
        self.assertTrue(self.finding(self.run_gate(), "pdf-rendered-font"))

    def test_unembedded_font_fails(self):
        self.reader.pages[0]["/Resources"]["/Font"]["/F1"] = font(embedded=False)
        self.assertTrue(self.finding(self.run_gate(), "pdf-embedded-program"))

    def test_unknown_embedded_program_cannot_pass(self):
        program = FontProgram()
        program.get_data = lambda: b"unrecognized font binary"
        self.reader.pages[0]["/Resources"]["/Font"]["/F1"]["/FontDescriptor"]["/FontFile"] = program
        result = self.run_gate()
        self.assertEqual(result["exit_code"], 2)
        self.assertTrue(self.finding(result, "pdf-embedded-program", "unknown"))

    def test_small_body_font_and_wrong_title_size_fail(self):
        self.drawing.pages[0].chars[-1]["size"] = 10.6
        self.drawing.pages[0].chars[0]["size"] = 12
        result = self.run_gate()
        self.assertTrue(self.finding(result, "pdf-font-sizes"))
        self.assertTrue(self.finding(result, "expected-text-and-role-size"))

    def test_font_size_tolerance_is_consistent(self):
        for page in self.drawing.pages:
            for char in page.chars:
                char["size"] += 0.08
        self.assertEqual(self.run_gate()["exit_code"], 0)

    def test_16pt_exception_cannot_be_enabled_for_foodlens(self):
        self.register["projects"][0]["document_contract"]["allow_16pt_main_headings"] = {"reason": "existing", "texts": ["測試提案"]}
        self.assertTrue(self.finding(self.run_gate(), "16pt-existing-exception"))

    def test_scamlens_16pt_scope_is_exact_not_blanket(self):
        project = next(p for p in self.register["projects"] if p["project_id"] == "scamlens")
        project["document_contract"]["allow_16pt_main_headings"] = {"reason": "Existing main heading exception", "texts": ["研究方法"]}
        result = {"checks": [], "documents": {}}
        project["document_contract"]["required_text"] = [t for t in project["document_contract"]["required_text"] if t["role"] != "heading"] + [{"text": "研究方法", "role": "main_heading", "page": 1}]
        # A rogue 16pt body character is never licensed by the heading exception.
        self.drawing.pages[0].chars[-1]["size"] = 16
        with patch.object(GATE, "PdfReader", return_value=self.reader), patch.object(GATE.pdfplumber, "open", return_value=self.drawing):
            spec = project["artifacts"][1]
            GATE.inspect_pdf(result, Path(spec["path"]), "scamlens/pdf", spec, project, 5_000_000)
        self.assertTrue(self.finding(result, "16pt-scope"))

    def test_nested_javascript_and_open_action_are_detected(self):
        self.reader.trailer["/Root"]["/Names"] = {"nested": {"/JavaScript": [], "/OpenAction": {"/S": "/JavaScript", "/JS": "alert(1)"}}}
        self.assertTrue(self.finding(self.run_gate(), "pdf-passive"))

    def test_encrypted_pdf_is_refused_without_password_attempt(self):
        self.reader.is_encrypted = True
        self.assertTrue(self.finding(self.run_gate(), "pdf-unencrypted"))

    def test_abstract_count_retains_spaces_and_punctuation(self):
        self.assertEqual(GATE.character_count("AI 協作。\r\n"), 6)
        self.assertEqual(GATE.character_count("e\u0301 "), 2)
        self.register["projects"][0]["document_contract"]["entry_abstract"]["text"] = "字" * 99 + "  "
        self.assertTrue(self.finding(self.run_gate(), "entry_abstract-length"))

    def test_abstract_must_remain_on_expected_page(self):
        self.register["projects"][0]["document_contract"]["abstract"]["text"] = "這是原生內文。"
        self.assertTrue(self.finding(self.run_gate(), "expected-text-and-role-size"))

    def test_written_reports_preserve_pending_and_register(self):
        self.save()
        original = self.register_path.read_bytes()
        reports = self.root / "reports"
        with patch.object(GATE, "REPORT_ROOT", reports), patch.object(GATE, "PdfReader", return_value=self.reader), patch.object(GATE.pdfplumber, "open", return_value=self.drawing), contextlib.redirect_stdout(io.StringIO()):
            code = GATE.main(["--register", str(self.register_path), "--json", str(reports / "checks.json"), "--markdown", str(reports / "checks.md")])
        self.assertEqual(code, 0)
        self.assertEqual(self.register_path.read_bytes(), original)
        report = json.loads((reports / "checks.json").read_text())
        self.assertEqual(report["pending"]["foodlens"]["reviews"], ["學生具名覆核", "校方核章"])
        self.assertIn("不授予送件資格", (reports / "checks.md").read_text())
        self.assertNotEqual(report["readiness"], "ready")

    def test_report_outside_allowlist_is_refused_before_inspection(self):
        with patch.object(GATE, "verify") as verify, contextlib.redirect_stderr(io.StringIO()):
            code = GATE.main(["--json", str(self.root / "outside.json")])
        self.assertEqual(code, 2)
        verify.assert_not_called()

    def test_report_cannot_overwrite_register(self):
        self.save()
        original = self.register_path.read_bytes()
        with patch.object(GATE, "REPORT_ROOT", self.root), contextlib.redirect_stderr(io.StringIO()):
            code = GATE.main(["--register", str(self.register_path), "--json", str(self.register_path)])
        self.assertEqual(code, 2)
        self.assertEqual(self.register_path.read_bytes(), original)

    def test_symlink_report_refused(self):
        reports = self.root / "reports"
        reports.mkdir()
        target = self.root / "actual.json"
        target.write_text("protected")
        link = reports / "alias.json"
        link.symlink_to(target)
        with patch.object(GATE, "REPORT_ROOT", reports), self.assertRaises(ValueError):
            GATE.report_path(str(link), ".json")
        self.assertEqual(target.read_text(), "protected")

    def test_invalid_register_returns_unknown_instead_of_traceback(self):
        self.register_path.write_text("not json")
        self.assertEqual(GATE.verify(self.register_path)["exit_code"], 2)

    def test_real_blank_pdf_is_never_certified_as_native_document(self):
        path = self.root / "blank.pdf"
        writer = PdfWriter()
        writer.add_blank_page(width=595.276, height=841.89)
        with path.open("wb") as stream:
            writer.write(stream)
        result = {"checks": [], "documents": {}}
        GATE.inspect_pdf(result, path, "synthetic/blank", {"page_count": 1}, self.register["projects"][0], 5_000_000)
        self.assertTrue(self.finding(result, "pdf-native-text"))
        self.assertTrue(self.finding(result, "pdf-rendered-font"))

    def test_font_alias_and_font_program_parsers(self):
        self.assertTrue(GATE.approved_font("AAAAAA+BiauKaiTC-Regular"))
        self.assertTrue(GATE.approved_font("DFKai-SB"))
        self.assertFalse(GATE.approved_font("BiauKaiTC-Regular-Fake"))
        self.assertFalse(GATE.approved_font("Kaiti TC"))
        name = "DFKai-SB".encode("utf-16-be")
        name_table = struct.pack(">HHH", 0, 1, 18) + struct.pack(">HHHHHH", 3, 1, 0, 6, len(name), 0) + name
        sfnt = b"\x00\x01\x00\x00" + struct.pack(">HHHH", 1, 0, 0, 0) + struct.pack(">4sIII", b"name", 0, 28, len(name_table)) + name_table
        self.assertEqual(GATE.font_program_names(sfnt, "/FontFile2"), ["DFKai-SB"])

    def test_recursive_form_xobject_font_is_inspected(self):
        resources = {"/XObject": {"/Form1": {"/Subtype": "/Form", "/Resources": {"/Font": {"/Hidden": font("NotoSansCJKtc-Regular")}}}}}
        discovered = list(GATE.resource_fonts(resources))
        self.assertEqual(discovered[0][0], "/Form1//Hidden")
        self.assertTrue(GATE.inspect_font(discovered[0][1])[0])


if __name__ == "__main__":
    unittest.main()
