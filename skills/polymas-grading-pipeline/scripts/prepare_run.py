#!/usr/bin/env python3
"""预检 ZIP、抽取技能元数据、建立或合并流水线状态文件。

预检复用 polymas-skill-batch-upload/scripts/preflight_zips.py，不重复实现。
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import zipfile
from datetime import datetime
from pathlib import Path

REQUIREMENT_FILE = "references/submission-requirements.md"
DEFAULT_SKILLS_ROOT = Path(__file__).resolve().parents[2]


def collect_zips(paths):
    zips = []
    for raw in paths:
        path = Path(raw).expanduser()
        if path.is_dir():
            zips.extend(sorted(p for p in path.glob("*.zip") if p.is_file()))
        elif path.is_file() and path.suffix.lower() == ".zip":
            zips.append(path)
        else:
            raise SystemExit(f"不是目录或 ZIP：{path}")
    unique = []
    seen = set()
    for path in zips:
        key = path.resolve()
        if key not in seen:
            seen.add(key)
            unique.append(path)
    return unique


def run_preflight(script: Path, zips):
    proc = subprocess.run(
        [sys.executable, str(script), *map(str, zips), "--json"],
        capture_output=True,
        text=True,
    )
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:
        raise SystemExit(
            "预检脚本输出无法解析：\n"
            + (proc.stderr.strip() or proc.stdout.strip() or "无输出")
        )
    return payload


def parse_frontmatter(text):
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    meta = {}
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        meta[key.strip()] = value
    return meta


def read_meta(zip_path: Path, root: str | None):
    info = {"displayName": "", "desc": "", "requirement": "", "requirementSource": ""}
    try:
        archive = zipfile.ZipFile(zip_path)
    except zipfile.BadZipFile:
        return info
    with archive:
        names = set(archive.namelist())
        if not root:
            candidates = [n for n in names if n.endswith("/SKILL.md")]
            if not candidates:
                return info
            root = candidates[0].split("/", 1)[0]
        skill_path = f"{root}/SKILL.md"
        if skill_path in names:
            text = archive.read(skill_path).decode("utf-8", "replace")
            meta = parse_frontmatter(text)
            info["desc"] = meta.get("description", "").strip()
            for line in text.splitlines():
                if line.startswith("# "):
                    info["displayName"] = line[2:].strip()
                    break
        req_path = f"{root}/{REQUIREMENT_FILE}"
        if req_path in names:
            info["requirement"] = archive.read(req_path).decode("utf-8", "replace").strip()
            info["requirementSource"] = REQUIREMENT_FILE
    return info


def blank_skill(slug):
    return {
        "slug": slug,
        "displayName": "",
        "desc": "",
        "requirement": "",
        "requirementSource": "",
        "zip": "",
        "sha256": "",
        "size": 0,
        "valid": False,
        "errors": [],
        "warnings": [],
        "build": {"status": "pending", "note": ""},
        "upload": {"status": "pending", "skillNid": "", "httpStatus": None, "msg": ""},
        "test": {
            "status": "pending",
            "approved": False,
            "mae": None,
            "maxDiff": None,
            "skillNid": "",
            "skillVersionId": "",
            "rounds": [],
            "samples": [],
            "candidates": [],
            "note": "",
            "skippedReason": "",
        },
        "finalize": {"status": "pending", "version": "", "skillVersionId": "", "attempts": 0, "msg": ""},
        "publishCourse": {"status": "pending", "boundCount": 0, "msg": ""},
        "agent": {
            "status": "pending",
            "instanceNid": "",
            "verified": False,
            "skillsBound": [],
            "descChars": 0,
            "reqChars": 0,
            "online": False,
            "msg": "",
        },
    }


def legacy_test_block(slug):
    block = blank_skill(slug)["test"]
    block["status"] = "skipped"
    block["skippedReason"] = "旧运行迁移：本次流水线未执行批阅测试"
    block["note"] = block["skippedReason"]
    return block


def slug_from_zip(path: Path):
    return path.stem


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", help="技能 ZIP、ZIP 目录或两者混合")
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--course-name", default="")
    parser.add_argument("--school", default="")
    parser.add_argument("--course-query", default="")
    parser.add_argument("--course-id", default="")
    parser.add_argument("--folder-id", default="")
    parser.add_argument("--term", type=int, default=None)
    parser.add_argument("--agent-id", default="")
    parser.add_argument(
        "--skills-root", type=Path, default=DEFAULT_SKILLS_ROOT,
        help="技能根目录，默认取本脚本解析后所在技能目录的父目录（适用于暂存与共享安装树）",
    )
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    zips = collect_zips(args.paths)
    if not zips:
        raise SystemExit("没有找到 .zip 文件")

    preflight = (args.skills_root.expanduser() / "polymas-skill-batch-upload" / "scripts" / "preflight_zips.py")
    if not preflight.is_file():
        raise SystemExit(f"缺少预检脚本：{preflight}（先跑 check_deps.py）")

    result = run_preflight(preflight, zips)
    state_path = args.state.expanduser().resolve()
    existing = {}
    if state_path.is_file():
        try:
            existing = json.loads(state_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise SystemExit(f"状态文件损坏：{state_path}（{exc}）")

    old_by_slug = {s.get("slug"): s for s in existing.get("skills", []) if s.get("slug")}
    conflicts = []
    new_skills = []

    for item in result["items"]:
        slug = item.get("root") or slug_from_zip(Path(item["file"]))
        meta = read_meta(Path(item["file"]), item.get("root"))
        old = old_by_slug.get(slug)
        sha = item.get("sha256", "")

        if old and old.get("sha256") and old.get("sha256") != sha:
            if old.get("upload", {}).get("status", "pending") != "pending":
                conflicts.append(
                    {
                        "slug": slug,
                        "message": "ZIP 内容已变化，但该技能已上传；不能沿用旧记录",
                        "oldSha": old.get("sha256"),
                        "newSha": sha,
                        "skillNid": old.get("upload", {}).get("skillNid", ""),
                    }
                )
                new_skills.append(old)
                continue

        entry = blank_skill(slug) if not old else old
        entry.setdefault("test", legacy_test_block(slug))
        entry["zip"] = item["file"]
        entry["sha256"] = sha
        entry["size"] = item.get("size", 0)
        entry["valid"] = item.get("status") == "ok"
        entry["errors"] = item.get("errors", [])
        entry["warnings"] = item.get("warnings", [])
        if meta["displayName"]:
            entry["displayName"] = meta["displayName"]
        elif not entry.get("displayName"):
            entry["displayName"] = item.get("name") or slug
        entry["desc"] = meta["desc"] or entry.get("desc", "")
        if meta["requirement"]:
            entry["requirement"] = meta["requirement"]
            entry["requirementSource"] = meta["requirementSource"]
        if not entry["requirement"]:
            entry["requirementSource"] = entry.get("requirementSource") or "missing"
            entry["warnings"] = sorted(set(entry["warnings"] + ["缺少学生提交要求，阶段 4 前必须补齐"]))
        new_skills.append(entry)

    present = {s["slug"] for s in new_skills}
    for slug, old in old_by_slug.items():
        if slug not in present:
            old.setdefault("test", legacy_test_block(slug))
            new_skills.append(old)
            note = "本次输入未包含该 ZIP，保留旧记录"
            if note not in old.setdefault("warnings", []):
                old["warnings"].append(note)

    now = datetime.now().isoformat(timespec="seconds")
    course = existing.get("course", {})
    for key, value in {
        "name": args.course_name,
        "school": args.school,
        "query": args.course_query,
        "courseId": args.course_id,
        "folderId": args.folder_id,
        "agentId": args.agent_id,
    }.items():
        if value:
            course[key] = value
    if args.term is not None:
        course["term"] = args.term

    gates = existing.get("gates") or {}
    for name in ("buildApproved", "uploadApproved", "onlineApproved", "testApproved"):
        gates.setdefault(name, False)

    state = {
        "runId": existing.get("runId") or datetime.now().strftime("%Y%m%d-%H%M%S"),
        "createdAt": existing.get("createdAt") or now,
        "updatedAt": now,
        "course": course,
        "gates": gates,
        "skills": new_skills,
        "log": existing.get("log", []),
    }
    state["log"].append(
        {
            "ts": now,
            "stage": "prepare",
            "skill": "*",
            "result": "conflict" if conflicts else "ok",
            "note": f"预检 {len(result['items'])} 个 ZIP，通过 {result['ok']}",
        }
    )

    state_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = state_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(state_path)

    failed = result["failed"] + len(conflicts)
    if args.json:
        print(
            json.dumps(
                {
                    "state": str(state_path),
                    "preflight": {"total": result["total"], "ok": result["ok"], "failed": result["failed"]},
                    "skills": [
                        {
                            "slug": s["slug"],
                            "displayName": s["displayName"],
                            "valid": s["valid"],
                            "sha256": s["sha256"],
                            "descChars": len(s["desc"]),
                            "reqChars": len(s["requirement"]),
                            "requirementSource": s["requirementSource"],
                        }
                        for s in new_skills
                    ],
                    "conflicts": conflicts,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        if course.get("name"):
            print(f"课程：{course['name']}（{course.get('school', '')}）  term={course.get('term', '')}")
        print(f"状态文件：{state_path}")
        print()
        header = f"{'技能名':<28} {'预检':<5} {'大小':>7} {'sha256':<12} {'描述':>5} {'要求':>5}  ZIP"
        print(header)
        print("-" * len(header))
        for s in new_skills:
            mark = "OK" if s["valid"] else "FAIL"
            print(
                f"{s['displayName'][:26]:<28} {mark:<5} {s['size'] / 1024:>6.1f}K "
                f"{s['sha256'][:12]:<12} {len(s['desc']):>5} {len(s['requirement']):>5}  {Path(s['zip']).name}"
            )
            for msg in s["errors"]:
                print("      ! " + msg)
            for msg in s["warnings"]:
                print("      ~ " + msg)
        for item in conflicts:
            print(f"      ! {item['slug']}：{item['message']}（旧 {item['oldSha'][:12]} → 新 {item['newSha'][:12]}）")
        print()
        print(f"合计 {len(new_skills)}，预检通过 {result['ok']}，预检失败 {result['failed']}，冲突 {len(conflicts)}")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
