"""Check the exact blank form and require three-page visual review to publish."""

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import unicodedata
from zipfile import ZipFile

from docx import Document
from lxml import etree
import pdfplumber
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "output/competition/work/field-record-v01"
STEM = "FoodLens_單餐量測紀錄表_v0.1"
SOURCE = ROOT / "docs/competition/field-record-v0.1.json"
DOCX = ROOT / "output/competition" / (STEM + ".docx")
PDF = WORK / "render" / (STEM + ".pdf")
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compact(text):
    return re.sub(r"\s+", "", unicodedata.normalize("NFC", text))


def verify():
    ledger = json.loads((WORK / "source-ledger.json").read_text(encoding="utf-8"))
    assert ledger["source_sha256"] == sha(SOURCE), "Source changed after build"
    assert ledger["docx_sha256"] == sha(DOCX), "DOCX changed after build"
    assert ledger["builder_sha256"] == sha(ROOT / "scripts/build-field-record.py"), "Builder changed after build"
    for source in ledger["sources"]:
        assert sha(ROOT / source["path"]) == source["sha256"], "Referenced source drift: " + source["path"]
    reader = PdfReader(PDF)
    assert not reader.is_encrypted
    assert len(reader.pages) == 3, "Print first two pages duplex; guide must remain page three"
    assert not reader.get_fields(), "Print form must not be mislabeled as AcroForm"
    text_pages = [compact(p.extract_text()) for p in reader.pages]
    for item in ledger["paragraphs"]:
        assert compact(item["text"]) in text_pages[item["page"] - 1], "Missing or wrong-page text: " + item["text"]
    with ZipFile(DOCX) as archive:
        assert archive.testzip() is None
        document = etree.fromstring(archive.read("word/document.xml"))
        styles = etree.fromstring(archive.read("word/styles.xml"))
        assert not styles.xpath(".//w:style[@w:styleId='Title']//w:pBdr", namespaces=NS)
        assert not document.xpath(".//w:trHeight[@w:hRule='exact']", namespaces=NS)
        assert not document.xpath(".//w:drawing|.//w:object|.//w:altChunk", namespaces=NS)
        for table in document.xpath(".//w:tbl", namespaces=NS):
            assert table.xpath("./w:tr[1]/w:trPr/w:tblHeader", namespaces=NS)
        paras = ["".join(p.xpath(".//w:t/text()", namespaces=NS)) for p in document.xpath(".//w:p", namespaces=NS)]
        assert all(compact(p) in "".join(text_pages) for p in paras if compact(p))
    tables = Document(DOCX).tables
    assert len(tables) == 4
    assert len(tables[0].rows) == 6
    for row in tables[0].rows[1:]:
        assert all(cell.text == "" for cell in row.cells[1:6]), "Weighing cells must remain blank, never prefilled with zero"
    for row in tables[1].rows[1:]:
        assert row.cells[1].text == row.cells[3].text == "", "No synthetic reason votes"
    assert all(c.text == "" for c in tables[2].rows[1].cells), "No synthetic satisfaction scores"
    spec = importlib.util.spec_from_file_location("shared_fonts", ROOT / "scripts/check-shared-competition.py")
    gate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gate)
    assert not gate.dangerous_pdf_objects(reader.trailer["/Root"])
    metrics = []
    with pdfplumber.open(PDF) as pdf:
        for index, page in enumerate(pdf.pages, 1):
            assert abs(page.width - 595.276) < 1 and abs(page.height - 841.89) < 1
            assert page.chars and not page.images
            fonts = sorted({c["fontname"] for c in page.chars})
            assert all(gate.approved_font(name) for name in fonts), fonts
            sizes = sorted({round(c["size"], 1) for c in page.chars})
            assert all(s in [12, 14, 24] for s in sizes), sizes
            assert min(c["x0"] for c in page.chars) > 48
            assert max(c["x1"] for c in page.chars) < 548
            assert min(c["top"] for c in page.chars) > 30
            assert max(c["bottom"] for c in page.chars) < 827
            for _, resource in gate.resource_fonts(reader.pages[index - 1]["/Resources"]):
                bad, unknown, _ = gate.inspect_font(resource)
                assert not bad and not unknown, (bad, unknown)
            metrics.append({"page": index, "native_characters": len(page.chars), "fonts": fonts, "sizes_pt": sizes})
    return {"status": "automated-checks-passed", "checked_on": "2026-09-06", "pages": 3,
            "native_ledger_items": len(ledger["paragraphs"]), "source_sha256": sha(SOURCE),
            "docx": {"path": str(DOCX), "sha256": sha(DOCX), "byte_size": DOCX.stat().st_size},
            "pdf": {"path": str(PDF), "sha256": sha(PDF), "byte_size": PDF.stat().st_size},
            "metrics": metrics, "boundary": "Blank research aid, not field data, school approval, official application or interactive PDF."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--finalize", action="store_true")
    args = parser.parse_args()
    result = verify()
    if args.finalize:
        review = json.loads((WORK / "visual-review.json").read_text(encoding="utf-8"))
        assert review["status"] == "passed" and review["pages"] == [1, 2, 3]
        assert review["pdf_sha256"] == result["pdf"]["sha256"], "Must visually review this exact PDF"
        destination = ROOT / "output/pdf" / (STEM + ".pdf")
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(PDF, destination)
        assert sha(destination) == result["pdf"]["sha256"]
        result["reading_pdf"] = str(destination)
    (WORK / "artifact-check.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "metrics"}, ensure_ascii=False, indent=2))
