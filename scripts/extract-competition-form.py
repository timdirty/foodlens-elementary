#!/usr/bin/env python3
"""Extract the unchanged official application page; never fill or sign it."""

import hashlib
import json
from pathlib import Path

from pypdf import PdfReader, PdfWriter


ROOT = Path(__file__).resolve().parents[1]
REGISTER = ROOT / "docs/competition/shared/submission-register.json"
OUTPUT = ROOT / "output/pdf/115_跨域創新素養競賽_官方報名空白表.pdf"
EVIDENCE = ROOT / "output/shared-competition/official-form-evidence.json"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    register = json.loads(REGISTER.read_text(encoding="utf-8"))
    source_entry = next(
        item for item in register["official_sources"] if item["path"].endswith(".pdf")
    )
    source = Path(source_entry["path"])
    if digest(source) != source_entry["sha256"]:
        raise ValueError("官方來源指紋已變；停止輸出，請先重新核對原附件。")
    reader = PdfReader(source)
    if reader.is_encrypted or len(reader.pages) != 10 or reader.get_fields():
        raise ValueError("來源不是已核對的 10 頁非互動官方附件。")
    page = reader.pages[5]
    source_text = page.extract_text()
    required = ["附表一", "報名表", "學校名稱", "簽名", "提案理念", "100字", "校長"]
    if any(text not in source_text for text in required):
        raise ValueError("第 6 頁報名表內容不符；不猜測頁次。")
    writer = PdfWriter()
    writer.add_page(page)
    writer.add_metadata({
        "/Title": "115學年度跨域創新素養競賽：官方附表一（空白）",
        "/Subject": "原附件實體第6頁原樣抽出；未填資料、未簽章，非已完成報名。",
    })
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    writer.write(OUTPUT)
    extracted = PdfReader(OUTPUT)
    if len(extracted.pages) != 1 or extracted.get_fields():
        raise ValueError("輸出須為一頁原生文字空白表，不能新增互動欄位。")
    output_page = extracted.pages[0]
    text_identical = output_page.extract_text() == source_text
    stream_identical = output_page.get_contents().get_data() == page.get_contents().get_data()
    boxes_identical = (
        list(output_page.mediabox) == list(page.mediabox)
        and list(output_page.cropbox) == list(page.cropbox)
        and output_page.rotation == page.rotation
    )
    if not all([text_identical, stream_identical, boxes_identical]):
        raise ValueError("抽出頁的文字、繪製內容或頁面邊界改變；不可交付。")
    evidence = {
        "schema_version": 1,
        "source": {"path": str(source), "sha256": digest(source), "physical_page": 6},
        "output": {"path": str(OUTPUT), "sha256": digest(OUTPUT), "byte_size": OUTPUT.stat().st_size},
        "checks": {"text_identical": text_identical, "content_stream_identical": stream_identical, "page_boxes_identical": boxes_identical},
        "status": "blank-official-page-not-submitted",
        "visual_check": "pending-render-and-review",
        "notice": "原表不是可填式 PDF；可列印填寫。未替使用者勾選、填名、簽署、核章或送出。",
    }
    EVIDENCE.parent.mkdir(parents=True, exist_ok=True)
    EVIDENCE.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
