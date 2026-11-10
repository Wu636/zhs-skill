#!/usr/bin/env python3
"""检查流水线依赖的三个子技能与脚本是否齐全。"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REQUIRED = {
    "assignment-grading-skill-builder": [
        "SKILL.md",
        "scripts/inventory_materials.py",
        "scripts/validate_grading_skill.py",
        "scripts/package_skill.py",
    ],
    "polymas-skill-batch-upload": [
        "SKILL.md",
        "scripts/preflight_zips.py",
        "scripts/check_login.js",
        "scripts/find_course.js",
        "scripts/find_skill.js",
        "scripts/inject_upload_input.js",
        "scripts/get_draft_version.js",
        "scripts/finalize_skill.js",
        "scripts/publish_to_course.js",
        "scripts/verify_skill.js",
        "scripts/cleanup.js",
    ],
    "polymas-grading-agent-create": [
        "SKILL.md",
        "scripts/ensure_login.js",
        "scripts/check_page.js",
        "scripts/api_ctx.js",
        "scripts/api_skill_map.js",
        "scripts/list_agents.js",
        "scripts/api_create_agents.js",
        "scripts/api_verify_agents.js",
        "scripts/api_publish_agent.js",
        "scripts/cleanup.js",
    ],
}


def inspect(root: Path):
    result = []
    for name, files in REQUIRED.items():
        skill_dir = root / name
        missing = [f for f in files if not (skill_dir / f).is_file()]
        result.append(
            {
                "skill": name,
                "path": str(skill_dir),
                "ok": not missing,
                "missing": missing,
            }
        )
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--skills-root",
        type=Path,
        default=Path(__file__).resolve().parents[2],
        help="技能根目录，默认取本脚本解析后所在技能目录的父目录（适用于暂存与共享安装树）",
    )
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    root = args.skills_root.expanduser().resolve()
    if not root.is_dir():
        print(f"技能目录不存在：{root}", file=sys.stderr)
        return 2

    items = inspect(root)
    if args.json:
        print(json.dumps({"root": str(root), "items": items}, ensure_ascii=False, indent=2))
    else:
        for item in items:
            print(("OK   " if item["ok"] else "FAIL ") + item["skill"])
            for name in item["missing"]:
                print("      ! 缺少 " + name)
        print(f"合计 {len(items)}，通过 {sum(1 for i in items if i['ok'])}")
    return 0 if all(i["ok"] for i in items) else 1


if __name__ == "__main__":
    raise SystemExit(main())
