#!/usr/bin/env python3
"""Validate an assignment grading skill against the supplied platform template."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.S)
NAME_RE = re.compile(r"^name:\s*[\"']?([a-z0-9]+(?:-[a-z0-9]+)*)[\"']?\s*$", re.M)
DESC_RE = re.compile(r"^description:\s*(.+)$", re.M)
FULL_RE = re.compile(r"`full_score`\s*:\s*`?(\d+)`?")
LOCAL_LINK_RE = re.compile(r"\[[^\]]+\]\((?!https?://|#)([^)]+)\)")
ALLOWED_TOP_LEVEL = {"README.md", "SKILL.md", "references", "scripts"}


def table_rows(section: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for line in section.splitlines():
        if not line.lstrip().startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if cells and not all(re.fullmatch(r":?-+:?", cell or "-") for cell in cells):
            rows.append(cells)
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("skill_dir", type=Path)
    args = parser.parse_args()
    root = args.skill_dir.expanduser().resolve()
    skill_file = root / "SKILL.md"
    errors: list[str] = []
    warnings: list[str] = []
    checks: dict = {}

    if not root.is_dir():
        parser.error(f"Skill directory does not exist: {root}")

    top_level = {path.name for path in root.iterdir()}
    unexpected = sorted(top_level - ALLOWED_TOP_LEVEL)
    if unexpected:
        errors.append("template-external top-level entries: " + ", ".join(unexpected))
    if not (root / "README.md").is_file():
        errors.append("README.md is missing")
    else:
        readme = (root / "README.md").read_text(encoding="utf-8")
        if "批阅技能 · 文件结构说明" not in readme:
            errors.append("README.md does not contain the supplied template structure heading")

    if not skill_file.is_file():
        errors.append("SKILL.md is missing")
        text = ""
    else:
        text = skill_file.read_text(encoding="utf-8")

    frontmatter = FRONTMATTER_RE.search(text)
    if not frontmatter:
        errors.append("YAML frontmatter is missing or malformed")
        name = None
    else:
        name_match = NAME_RE.search(frontmatter.group(1))
        desc_match = DESC_RE.search(frontmatter.group(1))
        name = name_match.group(1) if name_match else None
        if not name:
            errors.append("frontmatter name is missing or invalid")
        elif name != root.name:
            errors.append(f"directory name {root.name!r} does not match skill name {name!r}")
        if not desc_match or len(desc_match.group(1).strip(" \"'")) < 30:
            errors.append("frontmatter description is missing or too short")

    placeholders = [token for token in ["TODO", "【技能名称】", "【满分值】", "<skill-name>"] if token in text]
    if placeholders:
        errors.append("template placeholders remain: " + ", ".join(placeholders))

    for heading in ["## 批阅对象", "## 批阅流程", "## 1. 评分项（score）", "## 2. 评价项（evaluations）"]:
        if heading not in text:
            errors.append(f"required template section is missing: {heading}")

    score_types = [kind for kind in ["dimension", "gradient", "item"] if re.search(rf"`score_type`\s*:\s*`{kind}`", text)]
    if len(score_types) != 1:
        errors.append(f"expected exactly one score_type declaration, found {score_types}")
    score_type = score_types[0] if len(score_types) == 1 else None
    checks["score_type"] = score_type

    full_match = FULL_RE.search(text)
    full_score = int(full_match.group(1)) if full_match else None
    if full_score is None:
        errors.append("full_score declaration is missing")
    checks["full_score"] = full_score

    score_section_match = re.search(r"## 1\. 评分项（score）(.*?)## 2\. 评价项（evaluations）", text, re.S)
    score_section = score_section_match.group(1) if score_section_match else ""
    rows = table_rows(score_section)

    if score_type == "dimension" and full_score is not None:
        scores = [int(row[1]) for row in rows if len(row) >= 4 and re.fullmatch(r"\d+", row[1])]
        if not scores:
            errors.append("dimension configuration rows were not detected")
        elif sum(scores) != full_score:
            errors.append(f"dimension scores sum to {sum(scores)}, expected {full_score}")
        checks["dimension_scores"] = scores
    elif score_type == "gradient":
        data_rows = [row for row in rows if len(row) >= 3 and row[0] not in {"梯度标签", "分值区间"}]
        if not data_rows:
            errors.append("gradient configuration rows were not detected")
    elif score_type == "item":
        if not re.search(r"`item_split`\s*:", score_section) or not re.search(r"`item_count`\s*:\s*`?\d+`?", score_section):
            errors.append("item_split or item_count is missing")
        data_rows = [row for row in rows if len(row) >= 5 and re.fullmatch(r"\d+", row[0])]
        if not data_rows:
            errors.append("item configuration rows were not detected")

    if '"score"' not in text or '"evaluations"' not in text:
        errors.append("JSON output examples must contain score and evaluations")
    if "综合评语" not in text or ("改进建议" not in text and "优先修改建议" not in text):
        errors.append("evaluations must include 综合评语 and 改进建议")

    missing_links = []
    for raw in LOCAL_LINK_RE.findall(text):
        target = raw.split("#", 1)[0]
        if target and not (root / target).exists():
            missing_links.append(raw)
    if missing_links:
        errors.append("missing local references: " + ", ".join(sorted(set(missing_links))))

    if len(text.splitlines()) > 700:
        warnings.append("SKILL.md is long; move detailed rules to references")

    checks["top_level"] = sorted(top_level)
    result = {"valid": not errors, "errors": errors, "warnings": warnings, "checks": checks}
    sys.stdout.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
