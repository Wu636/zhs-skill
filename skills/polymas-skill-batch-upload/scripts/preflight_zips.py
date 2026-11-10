#!/usr/bin/env python3
"""Preflight skill ZIPs before uploading to Polymas. Prints JSON, exits 1 on any failure."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import zipfile
from pathlib import Path

ALLOWED_ROOT_FILES = {"README.md", "SKILL.md"}
ALLOWED_ROOT_DIRS = {"references", "scripts"}
FORBIDDEN_PARTS = {"__MACOSX", "__pycache__"}
FORBIDDEN_SUFFIXES = {".pyc", ".pyo", ".ds_store"}


def read_frontmatter(text: str):
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None, "SKILL.md 缺少 YAML frontmatter（首行应为 ---）"
    meta = {}
    for line in lines[1:]:
        if line.strip() == "---":
            return meta, None
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = value.strip().strip('"').strip("'")
    return None, "SKILL.md frontmatter 未闭合（缺少结尾 ---）"


def inspect(path: Path):
    item = {"file": str(path), "status": "error", "errors": [], "warnings": []}
    if not path.exists():
        item["errors"].append("路径不存在")
        return item
    if not path.is_file() or path.suffix.lower() != ".zip":
        item["errors"].append("不是 .zip 文件")
        return item
    item["size"] = path.stat().st_size
    item["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    try:
        archive = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        item["errors"].append("ZIP 无法打开（文件损坏或不是 ZIP）")
        return item

    with archive:
        names = [n for n in archive.namelist() if n and not n.endswith("/")]
        if not names:
            item["errors"].append("ZIP 为空")
            return item

        roots = {Path(n).parts[0] for n in names}
        if len(roots) != 1:
            item["errors"].append("根目录不唯一：%s" % ", ".join(sorted(roots)))
            return item
        root = roots.pop()
        item["root"] = root
        if any(len(Path(n).parts) == 1 for n in names):
            item["errors"].append("缺少唯一根目录：SKILL.md 等文件直接位于压缩包根，应放在以技能名命名的目录下")
            return item

        for name in names:
            parts = Path(name).parts
            if any(part in FORBIDDEN_PARTS for part in parts):
                item["errors"].append("含系统垃圾条目：%s" % name)
            if name.lower().endswith(tuple(FORBIDDEN_SUFFIXES)):
                item["errors"].append("含缓存文件：%s" % name)
            if len(parts) == 1:
                if parts[0] not in ALLOWED_ROOT_FILES:
                    item["errors"].append("根目录出现模板外文件：%s" % name)
            elif len(parts) == 2:
                if parts[1] not in ALLOWED_ROOT_FILES:
                    item["errors"].append("根目录出现模板外条目：%s" % name)
            elif parts[1] not in ALLOWED_ROOT_DIRS:
                item["errors"].append("出现模板外目录：%s" % name)

        skill_md = "%s/SKILL.md" % root
        readme = "%s/README.md" % root
        if skill_md not in names:
            item["errors"].append("缺少 %s" % skill_md)
            return item
        if readme not in names:
            item["warnings"].append("缺少 %s" % readme)

        try:
            text = archive.read(skill_md).decode("utf-8")
        except UnicodeDecodeError:
            item["errors"].append("SKILL.md 不是 UTF-8")
            return item

    meta, error = read_frontmatter(text)
    if error:
        item["errors"].append(error)
        return item

    name = meta.get("name", "")
    description = meta.get("description", "")
    item["name"] = name
    item["description"] = description
    if not name:
        item["errors"].append("frontmatter 缺少 name")
    elif name != root:
        item["errors"].append("name（%s）与根目录（%s）不一致" % (name, root))
    if not description:
        item["errors"].append("frontmatter 缺少 description")
    elif len(description) < 20:
        item["warnings"].append("description 偏短（%d 字）" % len(description))

    item["status"] = "ok" if not item["errors"] else "error"
    return item


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--json", action="store_true", help="只输出 JSON")
    args = parser.parse_args()

    targets = []
    for path in args.paths:
        path = path.expanduser()
        if path.is_dir():
            targets.extend(sorted(path.glob("*.zip")))
        else:
            targets.append(path)
    if not targets:
        parser.error("没有找到 .zip 文件")

    items = [inspect(path) for path in targets]
    seen = {}
    for item in items:
        digest = item.get("sha256")
        if digest and digest in seen:
            item["warnings"].append("与 %s 内容完全相同" % Path(seen[digest]).name)
        elif digest:
            seen[digest] = item["file"]

    summary = {
        "total": len(items),
        "ok": sum(1 for i in items if i["status"] == "ok"),
        "failed": sum(1 for i in items if i["status"] != "ok"),
        "items": items,
    }
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        for item in items:
            mark = "OK  " if item["status"] == "ok" else "FAIL"
            print("%s %s  %s" % (mark, item.get("name") or "-", Path(item["file"]).name))
            for message in item["errors"]:
                print("     ! " + message)
            for message in item["warnings"]:
                print("     ~ " + message)
        print("合计 %d，通过 %d，失败 %d" % (summary["total"], summary["ok"], summary["failed"]))
    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
