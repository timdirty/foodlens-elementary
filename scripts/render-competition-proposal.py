"""Task-local font setup for the bundled DOCX renderer; no system font changes."""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "output/competition/work/foodlens-v01"
STEM = "FoodLens_初選提案_官方格式待填稿_v0.1"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--renderer", type=Path, required=True,
                        help="Packaged documents skill render_docx.py")
    parser.add_argument("--font-dir", type=Path,
                        help="Directory containing legally installed BiauKai.ttc")
    args = parser.parse_args()
    if not args.renderer.is_file():
        raise SystemExit("找不到文件技能的 render_docx.py；不改用其他轉檔器。")
    if args.font_dir:
        font = args.font_dir / "BiauKai.ttc"
    else:
        found = sorted(Path("/System/Library/AssetsV2/com_apple_MobileAsset_Font8").glob(
            "*.asset/AssetData/BiauKai.ttc"))
        if not found:
            raise SystemExit("找不到合法安裝的標楷體。請以 --font-dir 指定，勿接受字型替代。")
        font = found[0]
    if not font.is_file():
        raise SystemExit("字型檔不存在：" + str(font))
    WORK.mkdir(parents=True, exist_ok=True)
    config = WORK / "fonts.conf"
    config.write_text('<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n'
        '<fontconfig>\n<dir>' + escape(str(font.parent)) + '</dir>\n'
        '<cachedir>' + escape(str(WORK / "font-cache")) + '</cachedir>\n</fontconfig>\n')
    env = os.environ.copy()
    env["FONTCONFIG_FILE"] = str(config)
    command = [sys.executable, str(args.renderer.resolve()),
        str(ROOT / "output/competition" / (STEM + ".docx")),
        "--output_dir", str(WORK / "render"), "--emit_pdf", "--dpi", "140"]
    subprocess.run(command, env=env, check=True)
    (WORK / "render-provenance.json").write_text(json.dumps({
        "runtime": sys.executable, "renderer": str(args.renderer.resolve()),
        "font_file": str(font), "fontconfig": str(config), "command": command,
        "font_files_distributed": False,
        "note": "僅使用本機合法安裝字型；PDF嵌入子集，DOCX不嵌入字型。"
    }, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
