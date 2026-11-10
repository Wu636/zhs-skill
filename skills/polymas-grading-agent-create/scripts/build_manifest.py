#!/usr/bin/env python3
"""从批阅技能包生成批阅智能体创建清单。

输入：一个目录，里面每个子目录是一个批阅技能包（含 SKILL.md）。
输出：JSON，每个技能一条 {label, agentName, agentDesc, requirement, skillName}。

批阅名称取 SKILL.md 的一级标题，批阅描述取 frontmatter description，
学生提交要求取“必交成果 / 可选成果 / 支持格式”三段。
"""
import argparse
import json
import re
import sys
from pathlib import Path

DESC_LIMIT = 2000
REQ_LIMIT = 5000


def parse_frontmatter(text):
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end < 0:
        return {}, text
    data = {}
    for line in text[3:end].strip("\n").split("\n"):
        m = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if not m:
            continue
        key, val = m.group(1), m.group(2).strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        data[key] = val
    return data, text[end + 4:]


def between(text, start_pat, end_pats):
    m = re.search(start_pat, text, re.M)
    if not m:
        return ""
    rest = text[m.end():]
    stop = len(rest)
    for pat in end_pats:
        m2 = re.search(pat, rest, re.M)
        if m2 and m2.start() < stop:
            stop = m2.start()
    return rest[:stop].strip()


def clean_block(block):
    lines = [ln.rstrip() for ln in block.strip().split("\n")]
    return "\n".join(ln for ln in lines if ln.strip())


def build_requirement(text):
    required = clean_block(between(text, r"^\*\*必交成果[^\n]*\*\*\s*$", [r"^\*\*可选成果", r"^\*\*支持格式"]))
    optional = clean_block(between(text, r"^\*\*可选成果[^\n]*\*\*\s*$", [r"^\*\*支持格式"]))
    fmt = clean_block(between(text, r"^\*\*支持格式[^\n]*\*\*\s*", [r"^\*\*", r"^---"]))

    parts = []
    if required:
        parts.append("必交成果：\n" + required)
    if optional:
        parts.append("可选成果：\n" + optional)
    if fmt:
        parts.append("提交格式：\n" + fmt.split("**", 1)[-1].lstrip("：: ").strip())
    return "\n\n".join(parts)


def trim(text, limit, label, warnings, name):
    if len(text) <= limit:
        return text
    warnings.append(f"{name}: {label} 超长（{len(text)} > {limit}），已截断")
    return text[: limit - 1] + "…"


def load_package(path):
    skill_md = path / "SKILL.md"
    if not skill_md.is_file():
        return None, None
    text = skill_md.read_text(encoding="utf-8")
    meta, body = parse_frontmatter(text)
    name = meta.get("name", "").strip()
    desc = meta.get("description", "").strip()
    h1 = re.search(r"^#\s+(.+)$", body, re.M)
    if not name:
        return None, f"{path.name}: frontmatter 缺少 name"
    if not desc:
        return None, f"{path.name}: frontmatter 缺少 description"
    if not h1:
        return None, f"{path.name}: 缺少一级标题"

    title = h1.group(1).strip()
    requirement = build_requirement(body)
    if not requirement:
        return None, f"{path.name}: 没解析出“必交成果/支持格式”"

    num = re.search(r"实训\s*(\d+)", title)
    return {
        "label": f"实训{num.group(1)}" if num else title,
        "order": int(num.group(1)) if num else 999,
        "agentName": title,
        "agentDesc": desc,
        "requirement": requirement,
        "skillName": name,
        "source": str(path),
    }, None


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("directory", help="包含若干批阅技能包的目录")
    ap.add_argument("--json", action="store_true", help="输出 JSON（默认也是 JSON）")
    ap.add_argument("--out", help="写入文件，缺省打印到 stdout")
    args = ap.parse_args()

    root = Path(args.directory).expanduser().resolve()
    if not root.is_dir():
        sys.exit(f"不是目录：{root}")

    items, errors, warnings = [], [], []
    for child in sorted(root.iterdir()):
        if not child.is_dir() or child.name.startswith("."):
            continue
        item, err = load_package(child)
        if err:
            errors.append(err)
            continue
        if not item:
            continue
        item["agentDesc"] = trim(item["agentDesc"], DESC_LIMIT, "批阅描述", warnings, item["label"])
        item["requirement"] = trim(item["requirement"], REQ_LIMIT, "学生提交要求", warnings, item["label"])
        items.append(item)

    items.sort(key=lambda x: x["order"])
    payload = {
        "root": str(root),
        "total": len(items),
        "items": items,
        "errors": errors,
        "warnings": warnings,
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(text + "\n", encoding="utf-8")
        print(json.dumps({"out": args.out, "total": len(items), "errors": errors, "warnings": warnings}, ensure_ascii=False))
    else:
        print(text)


if __name__ == "__main__":
    main()
