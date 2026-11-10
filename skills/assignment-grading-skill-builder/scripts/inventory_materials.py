#!/usr/bin/env python3
"""Inventory course requirements, teacher labels, samples, and templates."""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree


AUTHORITATIVE_RE = re.compile(r"完善|优化|最终|final|题目要求|评分|rubric", re.I)
TEACHER_LABEL_RE = re.compile(r"优秀|中等|较差|(?<!\d)(100|[1-9]?\d)\s*分")
SAMPLE_RE = re.compile(r"样本|作业|学生|优秀|中等|较差|\d+\s*分")

GROUPS = {
    "document": {".pdf", ".docx", ".doc", ".txt", ".md", ".rtf"},
    "image": {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff"},
    "audio": {".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg"},
    "video": {".mp4", ".mov", ".mkv", ".webm", ".avi"},
    "spreadsheet": {".xlsx", ".xls", ".csv", ".tsv"},
    "archive": {".zip"},
}


def group_for(path: Path) -> str:
    for group, suffixes in GROUPS.items():
        if path.suffix.lower() in suffixes:
            return group
    return "other"


def docx_preview(path: Path, limit: int = 1200) -> str:
    try:
        with zipfile.ZipFile(path) as archive:
            xml = archive.read("word/document.xml")
        root = ElementTree.fromstring(xml)
        text = " ".join(node.text or "" for node in root.iter() if node.tag.endswith("}t"))
        return " ".join(text.split())[:limit]
    except Exception:
        return ""


def pdf_info(path: Path) -> tuple[int | None, str]:
    try:
        from pypdf import PdfReader  # type: ignore

        reader = PdfReader(str(path))
        preview = " ".join((page.extract_text() or "") for page in reader.pages[:2])
        return len(reader.pages), " ".join(preview.split())[:1200]
    except Exception:
        return None, ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("materials", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    root = args.materials.expanduser().resolve()
    if not root.exists():
        parser.error(f"Path does not exist: {root}")

    paths = [root] if root.is_file() else sorted(p for p in root.rglob("*") if p.is_file())
    paths = [p for p in paths if p.name != ".DS_Store" and "__MACOSX" not in p.parts]
    items = []
    for path in paths:
        rel = path.name if root.is_file() else str(path.relative_to(root))
        label_match = TEACHER_LABEL_RE.search(rel)
        record: dict = {
            "path": rel,
            "group": group_for(path),
            "bytes": path.stat().st_size,
            "possible_authoritative": bool(AUTHORITATIVE_RE.search(path.name)),
            "possible_sample": bool(SAMPLE_RE.search(rel)),
            "teacher_label_from_path": label_match.group(0) if label_match else None,
        }
        if path.suffix.lower() == ".docx":
            record["text_preview"] = docx_preview(path)
        elif path.suffix.lower() == ".pdf":
            pages, preview = pdf_info(path)
            record["pages"] = pages
            record["text_preview"] = preview
        elif path.suffix.lower() in {".txt", ".md"}:
            record["text_preview"] = path.read_text(encoding="utf-8", errors="replace")[:1200]
        items.append(record)

    payload = {
        "root": str(root),
        "items": items,
        "notes": [
            "Authoritative and sample flags are candidates for human review, not final decisions.",
            "Teacher labels from paths may be used only while building calibration anchors.",
            "Render DOCX/PDF and inspect images/audio/video before deriving course rules.",
        ],
    }
    rendered = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    else:
        sys.stdout.write(rendered + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
