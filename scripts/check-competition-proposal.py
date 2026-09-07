"""Fail closed on content drift, pagination, substituted fonts and missing text.

Automated checks never stand in for student sign-off. --finalize additionally
requires an explicit visual review of this exact PDF before making a reading copy.
"""

import argparse
import hashlib
import json
import re
import shutil
import unicodedata
from pathlib import Path
from zipfile import ZipFile

import pdfplumber
from lxml import etree
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "output/competition/work/foodlens-v01"
STEM = "FoodLens_初選提案_官方格式待填稿_v0.1"
DOCX = ROOT / "output/competition" / (STEM + ".docx")
PDF = WORK / "render" / (STEM + ".pdf")
SOURCE = ROOT / "docs/competition/foodlens-proposal-v0.1.json"
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
      "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"}
W = "{" + NS["w"] + "}"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compact(text):
    return re.sub(r"\s+", "", unicodedata.normalize("NFC", text))


def verify():
    content = json.loads(SOURCE.read_text())
    ledger = json.loads((WORK / "source-ledger.json").read_text())
    assert ledger["docx_sha256"] == sha(DOCX), "DOCX changed after source build"
    assert ledger["content_sha256"] == sha(SOURCE), "Content changed; rebuild first"
    assert ledger["builder_sha256"] == sha(ROOT / "scripts/build-competition-proposal.py")
    assert len(content["abstract"]) == ledger["abstract_characters"] <= 300
    assert len(content["abstract_short"]) == ledger["entry_characters"] <= 100
    with ZipFile(DOCX) as archive:
        assert archive.testzip() is None
        body = etree.fromstring(archive.read("word/document.xml"))
        styles = etree.fromstring(archive.read("word/styles.xml"))
        assert not styles.xpath(".//w:style[@w:styleId='Title']//w:pBdr", namespaces=NS)
        paragraphs = ["".join(p.xpath(".//w:t/text()", namespaces=NS))
                      for p in body.xpath(".//w:p", namespaces=NS)]
        paragraphs = [p for p in paragraphs if p.strip()]
        props = body.xpath(".//wp:docPr", namespaces=NS)
        assert len(props) == len(ledger["assets"]) == 2
        assert all(p.get("descr") for p in props)
        assert all(t.xpath("./w:tr[1]/w:trPr/w:tblHeader", namespaces=NS)
                   for t in body.xpath(".//w:tbl", namespaces=NS))
        assert not body.xpath(".//w:altChunk", namespaces=NS)
        for run in body.xpath(".//w:r[w:t]", namespaces=NS):
            fonts = run.find(W + "rPr").find(W + "rFonts")
            assert fonts.get(W + "eastAsia") == "BiauKaiTC"
            size = run.find(W + "rPr").find(W + "sz")
            assert size.get(W + "val") in ("24", "28", "48")

    reader = PdfReader(PDF)
    assert len(reader.pages) == 10, "含封面及附件不得超過10頁"
    assert not reader.is_encrypted
    root = reader.trailer["/Root"]
    assert "/JavaScript" not in root.get("/Names", {})
    assert "/OpenAction" not in root and "/AA" not in root
    assert root.get("/MarkInfo", {}).get("/Marked")
    texts = [compact(p.extract_text()) for p in reader.pages]
    all_text = "".join(texts)
    missing_docx = [p for p in paragraphs if compact(p) not in all_text]
    assert not missing_docx, ("Missing DOCX paragraphs in PDF", missing_docx)
    missing_pages = [p for p in ledger["paragraphs"]
                     if compact(p["text"]) not in texts[p["page"] - 1]]
    assert not missing_pages, ("Page content lost or on wrong page", missing_pages)
    assert compact(content["abstract"]) in texts[1]
    assert "27.1%" in texts[8] and "19.0%" in texts[8] and "29.7%" in texts[8]
    for incorrect in ("29.6%", "332項", "243項", "照片原則上留在校內", "第一週與第四週"):
        assert incorrect not in all_text, incorrect
    for asset in ledger["assets"]:
        assert sha(ROOT / asset["source"]) == asset["sha256"], "Screenshot source drift"

    metrics = []
    with pdfplumber.open(PDF) as pdf:
        for index, page in enumerate(pdf.pages):
            assert abs(page.width - 595.3) < 1 and abs(page.height - 841.89) < 1
            fonts = sorted({c["fontname"] for c in page.chars})
            assert fonts and all("BiauKaiTC-Regular" in f for f in fonts), fonts
            sizes = sorted({round(c["size"], 1) for c in page.chars})
            assert all(s in (12.0, 14.0, 24.0) for s in sizes), sizes
            assert min(c["x0"] for c in page.chars) >= 60
            assert max(c["x1"] for c in page.chars) < 549
            assert min(c["top"] for c in page.chars) > 49
            assert max(c["bottom"] for c in page.chars) < 832
            assert len(page.images) == (1 if index in (5, 6) else 0)
            for img in page.images:
                assert 60 <= img["x0"] < img["x1"] < 549
                assert 49 < img["top"] < img["bottom"] < 800
                assert abs(img["width"] - 165 * 72 / 25.4) < 1
            metrics.append({"page": index + 1, "font_sizes_pt": sizes, "fonts": fonts,
                            "images": len(page.images), "native_characters": len(page.chars)})
    for page in reader.pages:
        for resource in page["/Resources"]["/Font"].values():
            font = resource.get_object()
            for child in font.get("/DescendantFonts", [font]):
                descriptor = child.get_object()["/FontDescriptor"].get_object()
                assert any(k in descriptor for k in ("/FontFile", "/FontFile2", "/FontFile3"))
    assert PDF.stat().st_size < 5_000_000
    result = {"status": "automated-checks-passed", "checked_on": "2026-09-06",
              "page_count": 10, "abstract_characters": len(content["abstract"]),
              "entry_characters": len(content["abstract_short"]),
              "docx_paragraphs_checked": len(paragraphs),
              "page_ledger_entries_checked": len(ledger["paragraphs"]),
              "image_alt_count": 2, "pdf_bytes": PDF.stat().st_size,
              "docx_sha256": sha(DOCX), "pdf_sha256": sha(PDF),
              "source_sha256": sha(SOURCE), "metrics": metrics,
              "boundary": "Not student review, school approval, PDF/UA certification or submission"}
    (WORK / "artifact-check.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--finalize", action="store_true")
    args = parser.parse_args()
    result = verify()
    if args.finalize:
        review = json.loads((WORK / "visual-review.json").read_text())
        assert review["pdf_sha256"] == result["pdf_sha256"], "Must review this exact PDF"
        assert review["reviewed_pages"] == list(range(1, 11))
        assert review["status"] == "passed"
        output = ROOT / "output/pdf" / (STEM + ".pdf")
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(PDF, output)
        assert sha(output) == result["pdf_sha256"]
        result["reading_copy"] = str(output)
        result["visual_review"] = str(WORK / "visual-review.json")
    print(json.dumps({k: v for k, v in result.items() if k != "metrics"}, ensure_ascii=False, indent=2))
