#!/usr/bin/env python3
"""Build paste-ready entry text from the explicit shared source; no form writes."""

import hashlib
import json
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHARED = ROOT / "docs/competition/shared"
OUTPUT = ROOT / "output/shared-competition/三案_報名表貼用稿_v0.1.md"


def count(text):
    return len(unicodedata.normalize("NFC", text).replace("\r", "").replace("\n", ""))


def main():
    register = json.loads((SHARED / "submission-register.json").read_text(encoding="utf-8"))
    copy = json.loads((SHARED / "registration-copy.v0.1.json").read_text(encoding="utf-8"))
    indexed = {p["project_id"]: p for p in register["projects"]}
    ids = [p["project_id"] for p in copy["projects"]]
    assert len(ids) == len(set(ids)) == 3 and set(ids) == set(indexed)
    lines = [
        "# 三案報名表貼用稿 v0.1",
        "",
        "更新：2026-09-06。這是待師生覆核的文字整理，不是已填完、已簽章或已送出的報名表。",
        "",
        f"官方空白附表一：[原附件第 6 頁原樣單頁 PDF]({ROOT / copy['official_blank_form']})。原表不是互動式 PDF，可列印填寫；不得把此貼用稿當成正式報名附件。",
        "",
        "## 先確認這四件事",
        "",
        "1. 由各隊確認提案名稱、類別、學校、組別與 2–4 名成員。不要把系統代理名字或模擬班級填成學生。",
        "2. 生成工具已參與製作，AI 欄依實際使用如實勾選。短欄用途只是摘要，完整揭露保留於各案提案及素材台帳；欄位不足的補充方式由承辦確認。",
        "3. 初選短影音為選繳。只有實際成片且核准上架後才填 YouTube 網址；目前沒有成片／網址就按實際狀態填，不勾『是』配假網址。簡報只在晉級後依通知繳交。",
        "4. 先完成內容與成員核對，再依官方要求由本人簽名、學校核章及掃描。原表沒有另設家長簽名欄；研究的家長告知及校方程序另按實際適用情況辦理。",
        "",
        f"計數：{copy['count_method']}修改隊名、標點、空白或學校全名後重新計算。",
        "",
    ]
    evidence = []
    for draft in copy["projects"]:
        project = indexed[draft["project_id"]]
        text = project["document_contract"]["entry_abstract"]["text"]
        characters = count(text)
        assert 0 < characters <= 100
        assert draft["named_review"] == "pending"
        lines += [
            f"## {project['name']}", "",
            f"主題名稱草案：{draft['entry_title_draft']}", "",
            f"評選類別草案：{project['category_draft']}", "",
            f"### 提案理念（{characters} 字）", "", text, "",
            "### AI 創作／編輯欄", "",
            f"是否使用 AI：{'是' if draft['ai_used'] else '否'}。", "",
            f"工具名稱：{draft['ai_tools_short']}", "",
            f"使用方式：{draft['ai_use_short']}", "",
            "完整說明／團隊覆核參考：", "", draft["ai_use_expanded"], "",
            f"版本界線：{draft['revision_note']}", "",
            f"目前登錄提案：{project['artifact_version']}；具名師生覆核待完成。", "",
            "來源：", "",
        ]
        for source in draft["source_refs"]:
            path = Path(source["path"])
            if not path.is_absolute():
                path = ROOT / path
            if not path.is_file():
                raise FileNotFoundError(path)
            lines += [f"- [{path.name}]({path})：{source['locator']}。"]
            evidence.append({"project_id": draft["project_id"], "source": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
        lines += [""]
    lines += [
        "## 尚待本人／校方填寫", "",
        "學校名稱、人數、班級、姓名、本人簽名、適用指導教師、承辦處室、校長及學校核章，均未代填。三案各自提交，不把三主題合併為同一團隊成果。", "",
        "既有網站曾公開的事實應如實向承辦確認『未經刊登』適用方式；noindex、Preview 或未列出網址不是未公開的證明。本稿不代寄、發布、核准或送件。", "",
        f"機器可讀來源：[文案來源]({SHARED / 'registration-copy.v0.1.json'})、[當前版本登錄]({SHARED / 'submission-register.json'})。此 Markdown 由腳本產生，修改來源後再建置，不只改輸出。", "",
    ]
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text("\n".join(lines), encoding="utf-8")
    (OUTPUT.parent / "registration-copy-evidence.json").write_text(json.dumps({
        "status": "draft-not-submitted",
        "count_method": copy["count_method"],
        "entries": [{"project_id": i, "characters": count(indexed[i]["document_contract"]["entry_abstract"]["text"])} for i in ids],
        "source_snapshots": evidence,
        "output": {"path": str(OUTPUT), "sha256": hashlib.sha256(OUTPUT.read_bytes()).hexdigest()},
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    index_lines = [
        "# 三案送件文件總入口", "",
        "2026-09-06｜初選待填稿，尚未送件。以下連結由中央登錄生成；各案仍使用自己的母稿、資料及學生工作紀錄。", "",
        "## 1. 先閱讀各案提案", "",
        "| 主題 | 目前登錄版本 | 閱讀 PDF | 可編輯 DOCX | 文件狀態 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for project in register["projects"]:
        files = {a["kind"]: a for a in project["artifacts"]}
        pending_format = any(a["validation_status"] == "official-format-alignment-pending" for a in project["artifacts"])
        status = "歷史稿；官方格式新版待交接" if pending_format else "格式檢查已有紀錄；具名覆核待完成"
        index_lines.append(f"| {project['name']} | {project['artifact_version']} | [閱讀稿]({files['reading-pdf']['path']}) | [母稿]({files['editable-master']['path']}) | {status} |")
    index_lines += [
        "", "## 2. 官方初選要完成的三件事", "",
        "依官方附件第 3 頁，由[臺北市科技教育網](https://techpro.tp.edu.tw/)本次活動公告進入報名，填寫參選人資料；上傳親簽、學校核章後的附表一掃描 PDF；再上傳不超過 10 頁的提案 PDF。這三件事要一起備齊，空白表或待填稿不是已完成報名。", "",
        "網站目前需 JavaScript 載入；本入口未登入、未驗證最終上傳畫面，也未代填或提交。請由指定人員核對本次 115 學年度活動及截止時間。官方第 5 頁明定截止後不得補件或抽換，勿把先送錯稿、之後補件當作策略。", "",
        "## 3. 填報名表前先核對文字", "",
        f"- [三案報名文字與 AI 揭露貼用稿]({OUTPUT})：理念 95／90／98 字；空白和標點計入。", 
        f"- [官方空白報名表]({ROOT / copy['official_blank_form']})：官方附件第 6 頁原樣抽出，未填、未簽章。",
        f"- [具名覆核清單]({SHARED / 'REVIEW-CHECKLIST.md'})：學生貢獻、AI／素材、學校與承辦確認事項。", "",
        "## 4. 可以交接不等於可以直接送件", "",
        "學生姓名、班級、學校、隊伍、本人簽名與學校核章仍未填。填寫後須重新轉 PDF、核對頁數／字數／字型並逐頁看過。網站曾公開的參賽資格疑義需如實向承辦確認，不能代替你們取得核准。", "",
        "短影音是選繳，簡報只在晉級後依通知繳交。本資料夾沒有完成影片、正式簽章、研究成效或送件回執。", "",
        "## 5. 研究操作輔具", "",
        f"[FoodLens 單餐量測紀錄表與最新回填補充]({ROOT / 'docs/competition/field-record-handoff-v0.3.md'})提供 v0.1 PDF／Word 與逐餐安全觀察更新說明。第 1–2 頁每餐雙面填寫，第 3 頁為舊版網站快照，請搭配 v0.3 補充。這是研究輔具，不是官方初選必繳附件，也不表示已獲准蒐集。", "",
        f"維護來源：[三案登錄]({SHARED / 'submission-register.json'})、[18 條主張與來源對照]({SHARED / 'claim-ledger.v0.2.json'})、[共用文書標準]({SHARED / 'README.md'})。", "",
    ]
    (OUTPUT.parent / "README.md").write_text("\n".join(index_lines), encoding="utf-8")
    print(str(OUTPUT))
    print(json.dumps({i: count(indexed[i]["document_contract"]["entry_abstract"]["text"]) for i in ids}, ensure_ascii=False))


if __name__ == "__main__":
    main()
