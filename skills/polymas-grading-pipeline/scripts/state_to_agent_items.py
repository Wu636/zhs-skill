#!/usr/bin/env python3
"""从状态文件生成 window.__agentItems 注入片段，避免手抄长文本。"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def build_items(state):
    items, errors = [], []
    for skill in state.get("skills", []):
        slug = skill.get("slug", "")
        if skill.get("publishCourse", {}).get("status") != "done":
            errors.append(f"{slug}：未发布到课程，不能建智能体")
            continue
        if skill.get("agent", {}).get("instanceNid"):
            errors.append(f"{slug}：已有 instanceNid={skill['agent']['instanceNid']}，只能补存，不能新建")
            continue
        version = skill.get("finalize", {}).get("skillVersionId", "")
        if not version:
            errors.append(f"{slug}：缺少 skillVersionId")
            continue
        requirement = skill.get("requirement", "").strip()
        if not requirement:
            errors.append(f"{slug}：学生提交要求为空")
            continue
        name = skill.get("displayName", "").strip()
        if not name:
            errors.append(f"{slug}：批阅名称为空")
            continue
        items.append(
            {
                "name": name,
                "desc": skill.get("desc", "").strip(),
                "requirement": requirement,
                "skillName": slug,
                "skillVersionId": version,
            }
        )
    return items, errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, required=True)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--js", action="store_true", help="输出可执行函数体")
    group.add_argument("--json", action="store_true", help="输出 JSON 数组")
    args = parser.parse_args()

    path = args.state.expanduser()
    if not path.is_file():
        print(f"状态文件不存在：{path}", file=sys.stderr)
        return 2
    state = json.loads(path.read_text(encoding="utf-8"))
    items, errors = build_items(state)

    for msg in errors:
        print("! " + msg, file=sys.stderr)
    if not items:
        print("没有可创建的智能体条目", file=sys.stderr)
        return 1

    payload = json.dumps(items, ensure_ascii=False, indent=2)
    payload = payload.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")

    if args.js:
        print("() => {")
        print("  window.__agentItems = " + payload.replace("\n", "\n  ") + ";")
        print("  return window.__agentItems.length;")
        print("}")
    else:
        print(payload)

    if not args.json and not args.js:
        print(f"\n共 {len(items)} 条；用 --js 生成 evaluate_script 函数体", file=sys.stderr)
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
