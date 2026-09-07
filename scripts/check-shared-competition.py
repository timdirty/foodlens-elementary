"""Read-only, fail-closed checks for the three-project submission register.

Run with the bundled Python runtime (pypdf, pdfplumber and lxml). No OCR,
LibreOffice, network, project builds, register edits, or approval writes occur.
Exit: 0 = automated checks passed; 1 = observed failure; 2 = unknown/configuration.
Neither exit 0 nor a report grants student/school approval or submission readiness.

Each project needs ``document_contract`` with:
  abstract: {text: str, max_characters: 300, page: 2}
  entry_abstract: {text: str, max_characters: 100}
  required_text: [{text: str, page: int, role: title|heading|body|main_heading}]
The required_text list must cover title, heading and body. Only scamlens may
declare allow_16pt_main_headings: {reason: str, texts: [exact heading strings]}.
This is a documented existing-document exception, not a new official rule.
Exact text matching is whitespace-normalized, never OCR-reconstructed. Abstract
character counts use NFC and remove only CR/LF, retaining spaces/punctuation.
Visual QA remains a
separate human review of the exact resulting PDF hash.
"""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import struct
import sys
import unicodedata
from zipfile import BadZipFile, ZipFile

import pdfplumber
from lxml import etree
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REGISTER = ROOT / "docs/competition/shared/submission-register.json"
REPORT_ROOT = ROOT / "output/shared-competition"
PROJECT_IDS = {"foodlens", "scamlens", "soundscape"}
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
      "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"}
BOUNDARY = ("Automated integrity/format checks only; not visual QA, student review, "
            "school approval, product/field validation, eligibility, upload or receipt.")


def compact(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFC", str(value or "")))


def character_count(value):
    return len(unicodedata.normalize("NFC", value).replace("\r", "").replace("\n", ""))


def sha(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def check(result, area, target, code, status, detail):
    result["checks"].append({"area": area, "target": target, "code": code,
                             "status": status, "detail": detail})


def observed(result, area, target, code, condition, detail):
    check(result, area, target, code, "passed" if condition else "failed", detail)


def record_file(result, spec, target, workspace=None):
    """Verify even incomplete metadata, but never infer a missing expected value."""
    if not isinstance(spec, dict):
        check(result, "metadata", target, "file-spec", "unknown", "File metadata is absent/invalid")
        return None
    name = spec.get("path")
    if not isinstance(name, str) or not name.strip() or name.startswith("pending"):
        check(result, "metadata", target, "path", "unknown", "Artifact/source path is pending")
        return None
    path = Path(name)
    if not path.is_absolute():
        check(result, "metadata", target, "path", "unknown", "Expected an absolute path")
        return None
    if workspace and not path.resolve().is_relative_to(workspace.resolve()):
        check(result, "integrity", target, "path-boundary", "failed", "Artifact escapes its registered workspace")
        return None
    if not path.is_file():
        pending = spec.get("generation_status") in {"pending", "planned", "not-generated"}
        check(result, "integrity", target, "file-exists", "unknown" if pending else "failed", str(path))
        return None
    try:
        actual = {"path": str(path), "sha256": sha(path), "byte_size": path.stat().st_size}
    except OSError as exc:
        check(result, "integrity", target, "file-readable", "failed", str(exc))
        return None
    result["files"][target] = actual
    expected_hash = spec.get("sha256")
    if not isinstance(expected_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_hash):
        check(result, "metadata", target, "sha256", "unknown", "Expected SHA-256 missing/invalid")
    else:
        observed(result, "integrity", target, "sha256", actual["sha256"] == expected_hash,
                 {"expected": expected_hash, "actual": actual["sha256"]})
    expected_bytes = spec.get("byte_size")
    if type(expected_bytes) is not int or expected_bytes <= 0:
        check(result, "metadata", target, "byte-size", "unknown", "Expected byte_size missing/invalid")
    else:
        observed(result, "integrity", target, "byte-size", actual["byte_size"] == expected_bytes,
                 {"expected": expected_bytes, "actual": actual["byte_size"]})
    return path


def inspect_docx(result, path, target):
    try:
        with ZipFile(path) as archive:
            names = archive.namelist()
            if len(names) != len(set(names)):
                raise ValueError("Duplicate ZIP members")
            if len(names) > 10000 or sum(x.file_size for x in archive.infolist()) > 100_000_000:
                raise ValueError("DOCX ZIP exceeds inspection safety bounds")
            if any(n.startswith("/") or ".." in Path(n).parts for n in names):
                raise ValueError("Unsafe ZIP member path")
            if archive.testzip() is not None:
                raise ValueError("ZIP CRC failure")
            for required in ("[Content_Types].xml", "word/document.xml", "word/styles.xml"):
                if required not in names:
                    raise ValueError(f"Missing required OOXML part: {required}")
            parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False)
            parts = ["word/document.xml"] + [n for n in names if re.fullmatch(r"word/(?:header|footer)\d+\.xml", n)]
            documents = [etree.fromstring(archive.read(part), parser) for part in parts]
            if any(d.getroottree().docinfo.doctype for d in documents):
                raise ValueError("Unexpected XML DTD")
            paragraphs = ["".join(p.xpath(".//w:t/text()", namespaces=NS))
                          for document in documents for p in document.xpath(".//w:p", namespaces=NS)]
            paragraphs = [p for p in paragraphs if compact(p)]
            props = [p for document in documents for p in document.xpath(".//wp:docPr", namespaces=NS)]
            alts = [{"id": p.get("id"), "name": p.get("name"), "text": p.get("descr", "")}
                    for p in props]
            unsupported = any(document.xpath(".//w:altChunk|.//w:object|.//w:pict", namespaces=NS) for document in documents)
            macros = any("vbaproject" in n.lower() for n in names)
        observed(result, "format", target, "docx-native-text", bool(paragraphs),
                 {"native_paragraphs_and_cells": len(paragraphs)})
        observed(result, "format", target, "docx-image-alts", all(compact(a["text"]) for a in alts), alts)
        observed(result, "format", target, "docx-supported-content", not unsupported and not macros,
                 "Embedded object, legacy image, altChunk and macro content cannot silently bypass native/alt checks")
        result["documents"][target] = {"native_paragraphs_and_cells": len(paragraphs), "image_alt_texts": alts}
        return paragraphs
    except (OSError, BadZipFile, KeyError, ValueError, etree.XMLSyntaxError) as exc:
        check(result, "format", target, "docx-readable-package", "failed", str(exc))
        return None


def approved_font(name):
    """Do not accept generic Kai/Noto substitutions or misleading suffixes."""
    name = str(name).lstrip("/")
    name = re.sub(r"^[A-Z]{6}\+", "", name)
    return bool(re.fullmatch(r"(?:BiauKaiTC(?:-Regular)?|DFKai[-_]SB(?:-Regular)?)", name))


def font_program_names(data, key):
    """Read real embedded program names, rather than trust a PDF BaseFont alias."""
    if key == "/FontFile":
        return [m.decode("ascii", errors="replace") for m in re.findall(rb"/FontName\s*/([^\s]+)", data[:65536])]
    if data[:4] in (b"\x00\x01\x00\x00", b"OTTO", b"true"):
        names = []
        count = struct.unpack_from(">H", data, 4)[0]
        for i in range(count):
            tag, _, offset, _ = struct.unpack_from(">4sIII", data, 12 + i * 16)
            if tag != b"name":
                continue
            _, entries, string_offset = struct.unpack_from(">HHH", data, offset)
            for j in range(entries):
                platform, _, _, name_id, length, start = struct.unpack_from(">HHHHHH", data, offset + 6 + j * 12)
                if name_id != 6:
                    continue
                raw = data[offset + string_offset + start:offset + string_offset + start + length]
                names.append(raw.decode("utf-16-be" if platform in (0, 3) else "mac_roman"))
        return names
    # CFF 1 Name INDEX follows its header; CFF 2 has no name and is unverified.
    if key == "/FontFile3" and len(data) >= 4 and data[0] == 1:
        start = data[2]
        count = int.from_bytes(data[start:start + 2], "big")
        if not count:
            return []
        width = data[start + 2]
        if width not in (1, 2, 3, 4) or count > 1000:
            return []
        offsets = [int.from_bytes(data[start + 3 + i * width:start + 3 + (i + 1) * width], "big")
                   for i in range(count + 1)]
        base = start + 3 + (count + 1) * width - 1
        return [data[base + offsets[i]:base + offsets[i + 1]].decode("ascii") for i in range(count)]
    return []


def inspect_font(resource):
    font = resource.get_object() if hasattr(resource, "get_object") else resource
    bad, unknown, details = [], [], []
    if not approved_font(font.get("/BaseFont", "")):
        bad.append("Unapproved PDF BaseFont")
    for child_ref in font.get("/DescendantFonts", [font]):
        child = child_ref.get_object() if hasattr(child_ref, "get_object") else child_ref
        descriptor = child.get("/FontDescriptor")
        descriptor = descriptor.get_object() if hasattr(descriptor, "get_object") else descriptor
        if not descriptor:
            bad.append("Missing font descriptor/embedded program")
            continue
        if not approved_font(descriptor.get("/FontName", "")):
            bad.append("Unapproved font descriptor name")
        embedded = [(key, descriptor[key]) for key in ("/FontFile", "/FontFile2", "/FontFile3") if key in descriptor]
        if not embedded:
            bad.append("Font program is not embedded")
        for key, program in embedded:
            try:
                program = program.get_object() if hasattr(program, "get_object") else program
                data = program.get_data()
                names = font_program_names(data, key)
                details.append({"type": key, "program_names": names, "embedded_bytes": len(data)})
                if not data:
                    bad.append("Embedded font program is empty")
                elif not names:
                    unknown.append("Cannot verify embedded program's actual PostScript name")
                elif not all(approved_font(n) for n in names):
                    bad.append("Embedded font program is a substituted font")
            except (ValueError, UnicodeError, IndexError, struct.error, KeyError) as exc:
                bad.append(f"Malformed embedded font: {exc}")
    return bad, unknown, details


def dangerous_pdf_objects(root):
    """Inspect nested actions too, not just the catalog's immediate names."""
    seen, forbidden, stack = set(), set(), [(root, 0)]
    while stack:
        obj, depth = stack.pop()
        if depth > 80 or len(seen) > 100_000:
            raise ValueError("PDF object graph exceeds inspection safety bounds")
        if hasattr(obj, "get_object"):
            obj = obj.get_object()
        if not isinstance(obj, (dict, list, tuple)) or id(obj) in seen:
            continue
        seen.add(id(obj))
        if isinstance(obj, dict):
            forbidden.update(str(k) for k in obj if str(k) in {"/JS", "/JavaScript", "/OpenAction", "/AA"})
            if str(obj.get("/S", "")) in {"/JavaScript", "/Launch", "/SubmitForm", "/ImportData", "/GoToR"}:
                forbidden.add(str(obj["/S"]))
            stack.extend((v, depth + 1) for v in obj.values())
        else:
            stack.extend((v, depth + 1) for v in obj)
    return sorted(forbidden)


def matching_chars(chars, text):
    haystack, offsets = "", []
    for index, char in enumerate(chars):
        value = compact(char.get("text", ""))
        haystack += value
        offsets.extend([index] * len(value))
    needle = compact(text)
    start = haystack.find(needle)
    return [] if start < 0 else [chars[i] for i in dict.fromkeys(offsets[start:start + len(needle)])]


def resource_fonts(resources, seen=None):
    """Include fonts inside Form XObjects as well as immediate page fonts."""
    seen = set() if seen is None else seen
    resources = resources.get_object() if hasattr(resources, "get_object") else resources
    if not isinstance(resources, dict) or id(resources) in seen:
        return
    seen.add(id(resources))
    fonts = resources.get("/Font", {})
    fonts = fonts.get_object() if hasattr(fonts, "get_object") else fonts
    yield from fonts.items()
    xobjects = resources.get("/XObject", {})
    xobjects = xobjects.get_object() if hasattr(xobjects, "get_object") else xobjects
    for name, ref in xobjects.items():
        obj = ref.get_object() if hasattr(ref, "get_object") else ref
        if obj.get("/Subtype") == "/Form":
            for child_name, font in resource_fonts(obj.get("/Resources", {}), seen):
                yield f"{name}/{child_name}", font


def contract_for(result, project, target):
    contract = project.get("document_contract")
    if not isinstance(contract, dict):
        check(result, "metadata", target, "document-contract", "unknown", "Missing explicit document_contract")
        return None, []
    targets = []
    for key, ceiling in (("abstract", 300), ("entry_abstract", 100)):
        item = contract.get(key)
        if not isinstance(item, dict) or not isinstance(item.get("text"), str) or not compact(item["text"]):
            check(result, "metadata", target, key, "unknown", "Missing expected native text")
            continue
        maximum = item.get("max_characters")
        valid = type(maximum) is int and 0 < maximum <= ceiling
        observed(result, "metadata", target, key + "-limit", valid, {"maximum": maximum, "official_ceiling": ceiling})
        if valid:
            observed(result, "format", target, key + "-length", character_count(item["text"]) <= maximum,
                     {"characters_nfc_including_spaces_punctuation_excluding_cr_lf": character_count(item["text"]), "maximum": maximum})
        if key == "abstract":
            if item.get("page") != 2:
                check(result, "metadata", target, "abstract-page", "unknown", "Expected abstract page must be 2")
            else:
                targets.append({**item, "role": "body"})
    required = contract.get("required_text")
    roles = set()
    if not isinstance(required, list):
        check(result, "metadata", target, "required-text", "unknown", "Missing expected title, heading and body samples")
    else:
        for item in required:
            if (not isinstance(item, dict) or not isinstance(item.get("text"), str) or not compact(item["text"])
                    or type(item.get("page")) is not int or not 1 <= item["page"] <= 10
                    or item.get("role") not in {"title", "heading", "body", "main_heading"}):
                check(result, "metadata", target, "required-text-item", "unknown", "Invalid text/page/role target")
                continue
            roles.add(item["role"])
            targets.append(item)
        if not {"title", "heading", "body"}.issubset(roles):
            check(result, "metadata", target, "required-roles", "unknown", "Required title/heading/body samples not all declared")
    allowance = contract.get("allow_16pt_main_headings")
    allowed = []
    if allowance is not None:
        valid = (project.get("project_id") == "scamlens" and isinstance(allowance, dict)
                 and isinstance(allowance.get("reason"), str) and bool(compact(allowance["reason"]))
                 and isinstance(allowance.get("texts"), list) and bool(allowance["texts"])
                 and all(isinstance(t, str) and compact(t) for t in allowance["texts"]))
        observed(result, "metadata", target, "16pt-existing-exception", valid,
                 allowance if valid else "Only explicitly documented existing ScamLens main headings may use 16pt")
        if valid:
            allowed = allowance["texts"]
    return targets, allowed


def inspect_pdf(result, path, target, spec, project, size_limit):
    targets, sixteen_headings = contract_for(result, project, target)
    try:
        reader = PdfReader(path, strict=True)
        observed(result, "format", target, "pdf-unencrypted", not reader.is_encrypted, "Encrypted PDFs are refused")
        if reader.is_encrypted:
            return None
        forbidden = dangerous_pdf_objects(reader.trailer["/Root"])
        observed(result, "format", target, "pdf-passive", not forbidden, forbidden)
        pages = len(reader.pages)
        observed(result, "format", target, "pdf-page-limit", 1 <= pages <= 10, {"pages": pages, "maximum": 10})
        if type(spec.get("page_count")) is int:
            observed(result, "integrity", target, "pdf-declared-pages", spec["page_count"] == pages,
                     {"expected": spec["page_count"], "actual": pages})
        else:
            check(result, "metadata", target, "pdf-declared-pages", "unknown", "Missing expected page_count")
        if size_limit is not None:
            observed(result, "format", target, "pdf-internal-size-limit", path.stat().st_size < size_limit,
                     {"actual_bytes": path.stat().st_size, "exclusive_limit": size_limit, "official_unit_not_interpreted": "50Mb"})
        texts = [compact(page.extract_text() or "") for page in reader.pages]
        observed(result, "format", target, "pdf-native-text", all(texts),
                 {"characters_by_page": [len(t) for t in texts], "method": "native extraction; no OCR"})
        metrics, inspected_fonts = [], set()
        with pdfplumber.open(path) as pdf:
            for index, page in enumerate(pdf.pages, 1):
                page_target = f"{target}/page-{index}"
                observed(result, "format", page_target, "pdf-a4", abs(page.width - 595.276) < 1 and abs(page.height - 841.89) < 1,
                         {"width_pt": page.width, "height_pt": page.height})
                fonts = sorted({c["fontname"] for c in page.chars})
                observed(result, "format", page_target, "pdf-rendered-font", bool(fonts) and all(approved_font(f) for f in fonts), fonts)
                sizes = sorted({round(float(c["size"]), 1) for c in page.chars})
                allowed_sizes = {12.0, 14.0, 24.0} | ({16.0} if sixteen_headings else set())
                observed(result, "format", page_target, "pdf-font-sizes", bool(sizes) and all(any(abs(s - expected) < .15 for expected in allowed_sizes) for s in sizes), sizes)
                if sixteen_headings:
                    allowed_chars = {id(c) for heading in sixteen_headings for c in matching_chars(page.chars, heading)}
                    rogue = [c.get("text", "") for c in page.chars if abs(float(c["size"]) - 16) < .15 and id(c) not in allowed_chars]
                    observed(result, "format", page_target, "16pt-scope", not rogue, {"unapproved_16pt_text": "".join(rogue)})
                metrics.append({"page": index, "native_characters": len(page.chars), "fonts": fonts,
                                "font_sizes_pt": sizes, "images": len(page.images)})
                if targets is not None:
                    for item in [t for t in targets if t["page"] == index]:
                        chars = matching_chars(page.chars, item["text"])
                        role = item["role"]
                        expected_size = {"title": 24, "heading": 14, "body": 12, "main_heading": 16}[role]
                        matched = bool(chars) and all(abs(float(c["size"]) - expected_size) < .15 for c in chars)
                        observed(result, "format", page_target, "expected-text-and-role-size", matched,
                                 {"text": item["text"], "role": role, "expected_pt": expected_size,
                                  "native_text_present": compact(item["text"]) in texts[index - 1]})
                for name, resource in resource_fonts(reader.pages[index - 1].get("/Resources", {})):
                    identity = (getattr(resource, "idnum", None), getattr(resource, "generation", None))
                    if identity[0] is not None and identity in inspected_fonts:
                        continue
                    inspected_fonts.add(identity)
                    bad, unknown, detail = inspect_font(resource)
                    status = "failed" if bad else "unknown" if unknown else "passed"
                    check(result, "format", page_target, "pdf-embedded-program", status,
                          {"resource": str(name), "failures": bad, "unknown": unknown, "programs": detail})
        if targets is not None:
            for item in targets:
                if item["page"] > pages:
                    check(result, "format", target, "expected-page-missing", "failed", item)
        result["documents"][target] = {"page_count": pages, "metrics": metrics,
                                       "visual_qa": "not-assessed-by-this-tool"}
        return texts
    except Exception as exc:  # A bad project must not stop examination of other projects.
        check(result, "format", target, "pdf-inspection", "failed", f"{type(exc).__name__}: {exc}")
        return None


def verify(register_path=DEFAULT_REGISTER):
    result = {"schema_version": 1, "checked_at": datetime.now(timezone.utc).isoformat(),
              "register": str(register_path), "checks": [], "files": {}, "documents": {},
              "pending": {}, "boundary": BOUNDARY, "readiness": "not-assessed-no-approval"}
    try:
        register = json.loads(Path(register_path).read_text(encoding="utf-8"))
        if not isinstance(register, dict):
            raise ValueError("Register root must be an object")
    except (OSError, ValueError) as exc:
        check(result, "metadata", "register", "readable-register", "unknown", str(exc))
        return finish(result)
    result["register_sha256"] = sha(Path(register_path))
    observed(result, "metadata", "register", "schema-version", register.get("schema_version") == 1, register.get("schema_version"))
    sources = register.get("official_sources")
    if not isinstance(sources, list) or not sources:
        check(result, "metadata", "register", "official-sources", "unknown", "Official source metadata missing")
    else:
        for index, source in enumerate(sources):
            record_file(result, source, f"official-source/{index + 1}")
    policy = register.get("policy", {})
    size_limit = policy.get("internal_pdf_size_exclusive_limit_bytes") if isinstance(policy, dict) else None
    if type(size_limit) is not int or not 0 < size_limit <= 5_000_000:
        check(result, "metadata", "register", "internal-size-limit", "unknown", "Expected internal exclusive limit at most 5,000,000 bytes")
        size_limit = None
    projects = register.get("projects")
    if not isinstance(projects, list):
        check(result, "metadata", "register", "projects", "unknown", "Project list missing/invalid")
        return finish(result)
    ids = [p.get("project_id") if isinstance(p, dict) else None for p in projects]
    valid_ids = all(isinstance(i, str) for i in ids)
    observed(result, "metadata", "register", "exact-project-set", valid_ids and len(ids) == 3 and set(ids) == PROJECT_IDS,
             {"expected": sorted(PROJECT_IDS), "actual": ids})
    counts = Counter(i for i in ids if isinstance(i, str))
    observed(result, "metadata", "register", "unique-project-ids", all(n == 1 for n in counts.values()), dict(counts))
    paths_seen = set()
    for index, project in enumerate(projects):
        if not isinstance(project, dict):
            check(result, "metadata", f"project-{index + 1}", "project-shape", "unknown", "Project must be an object")
            continue
        pid = project.get("project_id")
        pid = pid if isinstance(pid, str) else f"invalid-project-{index + 1}"
        target = f"{pid}[{index + 1}]" if counts.get(pid, 0) > 1 else str(pid)
        workspace = project.get("workspace")
        workspace = Path(workspace) if isinstance(workspace, str) and Path(workspace).is_absolute() else None
        if workspace is None:
            check(result, "metadata", target, "workspace", "unknown", "Absolute workspace missing; boundary not verifiable")
        result["pending"][target] = {"document_status": project.get("source_snapshot", {}).get("status") if isinstance(project.get("source_snapshot"), dict) else None,
                                      "reviews": project.get("pending_review", []),
                                      "submission": project.get("submission", {"status": "unknown"}),
                                      "visual_qa": "not-assessed-by-this-tool",
                                      "approval": "not-granted-by-this-tool"}
        artifacts = project.get("artifacts")
        if not isinstance(artifacts, list):
            check(result, "metadata", target, "artifacts", "unknown", "Artifact list missing/invalid")
            continue
        result["pending"][target]["artifact_statuses"] = [{"kind": a.get("kind"), "generation_status": a.get("generation_status"), "validation_status": a.get("validation_status")} for a in artifacts if isinstance(a, dict)]
        kinds = [a.get("kind") for a in artifacts if isinstance(a, dict)]
        observed(result, "metadata", target, "required-artifact-pair", kinds.count("editable-master") == 1 and kinds.count("reading-pdf") == 1,
                 {"required_once": ["editable-master", "reading-pdf"], "actual": kinds})
        docx_paragraphs, pdf_texts = None, None
        for number, artifact in enumerate(artifacts):
            kind = artifact.get("kind", "unknown") if isinstance(artifact, dict) else "unknown"
            file_target = f"{target}/{kind}/{number + 1}"
            path = record_file(result, artifact, file_target, workspace)
            if path is None:
                continue
            real = str(path.resolve())
            observed(result, "integrity", file_target, "unique-artifact-path", real not in paths_seen, real)
            paths_seen.add(real)
            if kind == "editable-master":
                observed(result, "metadata", file_target, "docx-extension", path.suffix.lower() == ".docx", str(path))
                docx_paragraphs = inspect_docx(result, path, file_target)
            elif kind == "reading-pdf":
                observed(result, "metadata", file_target, "pdf-extension", path.suffix.lower() == ".pdf", str(path))
                pdf_texts = inspect_pdf(result, path, file_target, artifact, project, size_limit)
        if docx_paragraphs is not None and pdf_texts is not None:
            joined = "".join(pdf_texts)
            missing = [p for p in docx_paragraphs if compact(p) not in joined]
            observed(result, "format", target, "native-docx-pdf-paragraph-parity", not missing,
                     {"paragraphs_checked": len(docx_paragraphs), "missing": missing})
        else:
            check(result, "format", target, "native-docx-pdf-paragraph-parity", "unknown", "Both readable native documents are required")
    return finish(result)


def finish(result):
    counts = Counter(c["status"] for c in result["checks"])
    result["summary"] = {key: counts[key] for key in ("passed", "failed", "unknown")}
    result["areas"] = {}
    for area in ("integrity", "format", "metadata"):
        statuses = {c["status"] for c in result["checks"] if c["area"] == area}
        result["areas"][area] = "failed" if "failed" in statuses else "unknown" if "unknown" in statuses or not statuses else "passed"
    result["exit_code"] = 1 if counts["failed"] else 2 if counts["unknown"] else 0
    result["status"] = {0: "automated-checks-passed", 1: "automated-checks-failed", 2: "automated-checks-unknown"}[result["exit_code"]]
    return result


def report_path(raw, extension):
    path = Path(raw)
    if not path.is_absolute():
        path = ROOT / path
    if path.suffix.lower() != extension or path.is_symlink() or not path.resolve().is_relative_to(REPORT_ROOT.resolve()):
        raise ValueError(f"Report must be a non-symlink {extension} file inside {REPORT_ROOT}")
    # A symlinked ancestor may resolve inside the directory yet overwrite a file
    # through an alias; refuse it as well, rather than infer an intended target.
    if any(p.is_symlink() for p in [path.parent, *path.parent.parents] if p != ROOT.parent):
        raise ValueError("Symlinked report directories are refused")
    return path


def markdown(result):
    lines = ["# 三案文件自動檢查", "", f"結果：`{result['status']}`（exit {result['exit_code']}）。",
             "", "此報告只檢查檔案完整性及可機器判斷的格式；不授予送件資格，不替代逐頁目視、學生具名覆核、校方核准或上傳回執。",
             "", f"登錄 SHA-256：`{result.get('register_sha256', 'unknown')}`", "",
             "## 分項結果", "", "|範圍|結果|", "|---|---|"]
    lines.extend(f"|{key}|{value}|" for key, value in result["areas"].items())
    lines.extend(["", "## 失敗或待確認", ""])
    for item in result["checks"]:
        if item["status"] != "passed":
            detail = json.dumps(item["detail"], ensure_ascii=False) if not isinstance(item["detail"], str) else item["detail"]
            lines.append(f"- **{item['status']}** `{item['target']}` / `{item['code']}`：{detail}")
    if not any(c["status"] != "passed" for c in result["checks"]):
        lines.append("自動檢查未發現失敗；下列人工待辦仍保留，並非已送件。")
    lines.extend(["", "## 各案原有待辦（未由工具批准）", ""])
    for pid, pending in result["pending"].items():
        lines.extend([f"### {pid}", "", f"文件狀態：{pending['document_status'] or 'unknown'}；送件狀態：{pending['submission'].get('status', 'unknown') if isinstance(pending['submission'], dict) else 'unknown'}。", ""])
        reviews = pending["reviews"] if isinstance(pending["reviews"], list) else [pending["reviews"]]
        lines.extend(f"- {item}" for item in reviews)
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--register", type=Path, default=DEFAULT_REGISTER)
    parser.add_argument("--json", dest="json_path", help="Explicit report path within FoodLens output/shared-competition")
    parser.add_argument("--markdown", dest="markdown_path", help="Explicit report path within FoodLens output/shared-competition")
    args = parser.parse_args(argv)
    try:
        json_path = report_path(args.json_path, ".json") if args.json_path else None
        md_path = report_path(args.markdown_path, ".md") if args.markdown_path else None
        if any(p and p.resolve() == args.register.resolve() for p in (json_path, md_path)):
            raise ValueError("Reports must not overwrite the register")
    except (OSError, ValueError) as exc:
        print(f"Configuration refused: {exc}", file=sys.stderr)
        return 2
    result = verify(args.register)
    try:
        for path, content in ((json_path, json.dumps(result, ensure_ascii=False, indent=2) + "\n"), (md_path, markdown(result))):
            if path:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
    except OSError as exc:
        print(f"Cannot write requested report: {exc}", file=sys.stderr)
        return 2
    print(f"{result['status']}: {result['summary']['passed']} passed; {result['summary']['failed']} failed; {result['summary']['unknown']} unknown")
    print("Integrity / format / metadata: " + " / ".join(result["areas"].values()))
    print(BOUNDARY)
    for item in [c for c in result["checks"] if c["status"] != "passed"][:12]:
        print(f"- {item['status']}: {item['target']} / {item['code']}")
    if sum(c["status"] != "passed" for c in result["checks"]) > 12:
        print("Additional findings retained in explicitly requested JSON/Markdown reports.")
    return result["exit_code"]


if __name__ == "__main__":
    sys.exit(main())
