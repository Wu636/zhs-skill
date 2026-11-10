#!/usr/bin/env python3
"""读写流水线状态、开关闸门、按阶段校验前置条件。"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

SKILL_FIELDS = {
    "displayName": "str",
    "desc": "str",
    "requirement": "str",
    "zip": "str",
    "build.status": "str",
    "build.note": "str",
    "upload.status": "str",
    "upload.skillNid": "str",
    "upload.httpStatus": "int",
    "upload.msg": "str",
    "test.status": "str",
    "test.approved": "bool",
    "test.mae": "float",
    "test.maxDiff": "float",
    "test.skillNid": "str",
    "test.skillVersionId": "str",
    "test.rounds": "json",
    "test.samples": "json",
    "test.candidates": "json",
    "test.note": "str",
    "test.skippedReason": "str",
    "finalize.status": "str",
    "finalize.version": "str",
    "finalize.skillVersionId": "str",
    "finalize.attempts": "int",
    "finalize.msg": "str",
    "publishCourse.status": "str",
    "publishCourse.boundCount": "int",
    "publishCourse.msg": "str",
    "agent.status": "str",
    "agent.instanceNid": "str",
    "agent.verified": "bool",
    "agent.descChars": "int",
    "agent.reqChars": "int",
    "agent.skillsBound": "list",
    "agent.online": "bool",
    "agent.msg": "str",
}

COURSE_FIELDS = {
    "course.name": "str",
    "course.school": "str",
    "course.query": "str",
    "course.courseId": "str",
    "course.folderId": "str",
    "course.term": "int",
    "course.agentId": "str",
}

TRUTHY = {"1", "true", "yes", "y", "是", "已确认", "确认"}
FALSY = {"0", "false", "no", "n", "否", "未确认"}


def now():
    return datetime.now().isoformat(timespec="seconds")


def load(path: Path):
    path = path.expanduser()
    if not path.is_file():
        raise SystemExit(f"状态文件不存在：{path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"状态文件损坏：{path}（{exc}）")


def save(path: Path, state):
    path = path.expanduser()
    state["updatedAt"] = now()
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def find_skill(state, slug):
    for item in state.get("skills", []):
        if item.get("slug") == slug:
            return item
    raise SystemExit(f"状态里没有技能：{slug}")


def coerce(value, kind, path):
    if kind == "str":
        return value
    if kind == "int":
        try:
            return int(value)
        except (TypeError, ValueError):
            raise SystemExit(f"{path} 需要整数，收到 {value!r}")
    if kind == "float":
        try:
            return float(value)
        except (TypeError, ValueError):
            raise SystemExit(f"{path} 需要数字，收到 {value!r}")
    if kind == "json":
        try:
            return json.loads(value)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"{path} 不是合法 JSON：{exc}")
    if kind == "bool":
        text = str(value).strip().lower()
        if text in TRUTHY:
            return True
        if text in FALSY:
            return False
        raise SystemExit(f"{path} 需要布尔值，收到 {value!r}")
    if kind == "list":
        text = value.strip()
        if text.startswith("["):
            try:
                data = json.loads(text)
            except json.JSONDecodeError as exc:
                raise SystemExit(f"{path} 不是合法 JSON 数组：{exc}")
            if not isinstance(data, list):
                raise SystemExit(f"{path} 需要数组")
            return data
        return [part.strip() for part in text.split(",") if part.strip()]
    raise SystemExit(f"未知类型：{kind}")


def cmd_set(args):
    state = load(args.state)
    if args.path not in SKILL_FIELDS and args.path not in COURSE_FIELDS:
        raise SystemExit(
            f"不允许写字段 {args.path}；可用字段：\n  "
            + "\n  ".join(sorted(list(SKILL_FIELDS) + list(COURSE_FIELDS)))
        )
    raw = args.value
    if args.value_file:
        raw = Path(args.value_file).expanduser().read_text(encoding="utf-8").strip()
    if raw is None:
        raise SystemExit("缺少 --value 或 --value-file")

    if args.path in COURSE_FIELDS:
        kind = COURSE_FIELDS[args.path]
        value = coerce(raw, kind, args.path)
        state.setdefault("course", {})[args.path.split(".", 1)[1]] = value
        target = "course"
    else:
        if not args.slug:
            raise SystemExit("写入技能字段需要 --slug")
        item = find_skill(state, args.slug)
        kind = SKILL_FIELDS[args.path]
        value = coerce(raw, kind, args.path)
        parts = args.path.split(".")
        if len(parts) == 1:
            item[parts[0]] = value
        else:
            item.setdefault(parts[0], {})[parts[1]] = value
        target = args.slug

    state.setdefault("log", []).append(
        {
            "ts": now(),
            "stage": args.path.split(".")[0],
            "skill": target,
            "result": "set",
            "note": f"{args.path}={value if not isinstance(value, str) or len(value) < 60 else value[:57] + '…'}",
        }
    )
    save(args.state, state)
    print(f"{target} {args.path} = {value}")


def cmd_gate(args):
    state = load(args.state)
    gates = state.setdefault("gates", {})
    if args.name not in {"buildApproved", "uploadApproved", "testApproved", "onlineApproved"}:
        raise SystemExit("未知闸门")
    gates[args.name] = bool(args.yes)
    state.setdefault("log", []).append(
        {"ts": now(), "stage": "gate", "skill": "*", "result": "approve" if args.yes else "revoke", "note": args.name}
    )
    save(args.state, state)
    print("闸门：" + "  ".join(f"{k}={'✓' if v else '✗'}" for k, v in gates.items()))


def cmd_status(args):
    state = load(args.state)
    if args.json:
        print(json.dumps(state, ensure_ascii=False, indent=2))
        return 0
    course = state.get("course", {})
    gates = state.get("gates", {})
    print(f"课程：{course.get('name', '')}（{course.get('school', '')}）  courseId={course.get('courseId', '')}  term={course.get('term', '')}")
    print("闸门：" + "  ".join(f"{k}={'✓' if v else '✗'}" for k, v in gates.items()))
    print()
    header = f"{'技能':<34} {'上传':<11} {'测试':<10} {'定稿':<14} {'发布':<9} {'智能体':<9} {'要求':>4}"
    print(header)
    print("-" * len(header))
    for item in state.get("skills", []):
        upload = item.get("upload", {})
        finalize = item.get("finalize", {})
        publish = item.get("publishCourse", {})
        agent = item.get("agent", {})
        fin = finalize.get("status", "pending")
        if finalize.get("version"):
            fin += f"({finalize['version']})"
        test = item.get("test") or {}
        print(
            f"{item.get('slug', '')[:32]:<34} {upload.get('status', 'pending'):<11} "
            f"{test.get('status', '-'):<10} {fin:<14} "
            f"{publish.get('status', 'pending'):<9} {agent.get('status', 'pending'):<9} "
            f"{len(item.get('requirement', '')):>4}"
        )
    return 0


def invariants(state):
    errors, warnings = [], []
    skills = state.get("skills", [])
    gates = state.get("gates", {})
    if not skills:
        errors.append("状态里没有技能")

    seen = {}
    for item in skills:
        slug = item.get("slug", "?")
        sha = item.get("sha256", "")
        if sha and sha in seen:
            errors.append(f"{slug}：sha256 与 {seen[sha]} 相同")
        elif sha:
            seen[sha] = slug

        upload = item.get("upload", {})
        finalize = item.get("finalize", {})
        publish = item.get("publishCourse", {})
        agent = item.get("agent", {})

        test = item.get("test")
        if test is None:
            warnings.append(f"{slug}：状态里没有 test 字段（旧运行），无法校验定稿前测试环")
        if finalize.get("status") == "done":
            if not upload.get("skillNid"):
                errors.append(f"{slug}：已定稿但缺少 upload.skillNid")
            if not finalize.get("skillVersionId"):
                errors.append(f"{slug}：已定稿但缺少 skillVersionId")
            if (
                test is not None
                and test.get("status") not in ("passed", "skipped")
                and not gates.get("testApproved")
            ):
                errors.append(
                    f"{slug}：定稿前测试未通过（test.status={test.get('status')}），"
                    "且闸门 testApproved 未确认"
                )
            if (
                test is not None
                and test.get("status") == "passed"
                and test.get("skillVersionId")
                and test.get("skillVersionId") != finalize.get("skillVersionId")
            ):
                errors.append(
                    f"{slug}：定稿版本 {finalize.get('skillVersionId')} 不是通过测试的版本 "
                    f"{test.get('skillVersionId')}"
                )
        if publish.get("status") == "done":
            if upload.get("status") not in ("uploaded", "duplicate"):
                errors.append(f"{slug}：已发布但上传状态是 {upload.get('status')}")
            if finalize.get("status") not in ("done", "skipped"):
                errors.append(f"{slug}：已发布但定稿状态是 {finalize.get('status')}")
        if agent.get("status") == "created":
            if not agent.get("instanceNid"):
                errors.append(f"{slug}：智能体已创建但缺少 instanceNid")
            if publish.get("status") != "done":
                errors.append(f"{slug}：智能体已创建但技能未发布到课程")
            if not item.get("requirement", "").strip():
                errors.append(f"{slug}：智能体已创建但学生提交要求为空")
            bound = agent.get("skillsBound") or []
            version = finalize.get("skillVersionId")
            if version and version not in bound:
                errors.append(f"{slug}：绑定版本 {version} 不在 agent.skillsBound 中")
        if upload.get("status") != "pending":
            if not gates.get("buildApproved"):
                errors.append(f"{slug}：已上传但闸门 buildApproved 未确认")
            if not gates.get("uploadApproved"):
                errors.append(f"{slug}：已上传但闸门 uploadApproved 未确认")
        if agent.get("online"):
            if not gates.get("onlineApproved"):
                errors.append(f"{slug}：智能体已上线但闸门 onlineApproved 未确认")
            if not agent.get("verified"):
                errors.append(f"{slug}：智能体已上线但未回查通过")
    return errors, warnings


def stage_checks(state, target):
    errors, warnings = [], []
    skills = state.get("skills", [])
    gates = state.get("gates", {})
    if target == "upload":
        if not gates.get("buildApproved"):
            errors.append("闸门 buildApproved 未确认")
        for item in skills:
            slug = item.get("slug")
            if not item.get("valid"):
                errors.append(f"{slug}：ZIP 预检未通过")
            if not Path(item.get("zip", "")).is_file():
                errors.append(f"{slug}：ZIP 不存在 {item.get('zip', '')}")
            if not item.get("requirement", "").strip():
                warnings.append(f"{slug}：学生提交要求为空（阶段 4 前必须补齐）")
    elif target == "agent":
        if not gates.get("uploadApproved"):
            errors.append("闸门 uploadApproved 未确认")
        for item in skills:
            slug = item.get("slug")
            if item.get("publishCourse", {}).get("status") != "done":
                errors.append(f"{slug}：未发布到课程")
            if not item.get("finalize", {}).get("skillVersionId"):
                errors.append(f"{slug}：缺少 skillVersionId")
            if not item.get("requirement", "").strip():
                errors.append(f"{slug}：学生提交要求为空")
            if item.get("upload", {}).get("status") == "failed":
                errors.append(f"{slug}：上传失败，不能建智能体")
            test = item.get("test")
            if (
                test is not None
                and test.get("status") not in ("passed", "skipped")
                and not gates.get("testApproved")
            ):
                errors.append(f"{slug}：批阅测试未通过，不能建智能体")
    elif target == "online":
        if not gates.get("onlineApproved"):
            errors.append("闸门 onlineApproved 未确认")
        for item in skills:
            slug = item.get("slug")
            agent = item.get("agent", {})
            if agent.get("status") != "created":
                errors.append(f"{slug}：智能体未创建")
            if not agent.get("verified"):
                errors.append(f"{slug}：智能体未回查通过")
    elif target == "final":
        for stage in ("upload", "agent", "online"):
            sub_errors, sub_warnings = stage_checks(state, stage)
            errors.extend(sub_errors)
            warnings.extend(sub_warnings)
    return errors, warnings


def cmd_check(args):
    state = load(args.state)
    errors, warnings = invariants(state)
    if args.target:
        sub_errors, sub_warnings = stage_checks(state, args.target)
        errors.extend(sub_errors)
        warnings.extend(sub_warnings)

    for msg in errors:
        print("! " + msg)
    for msg in warnings:
        print("~ " + msg)
    label = f"--for {args.target}" if args.target else "不变式"
    if errors:
        print(f"校验失败（{label}）：{len(errors)} 个问题，{len(warnings)} 个提醒")
        return 1
    print(f"校验通过（{label}）" + (f"，{len(warnings)} 个提醒" if warnings else ""))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_set = sub.add_parser("set", help="写入单个字段")
    p_set.add_argument("--state", type=Path, required=True)
    p_set.add_argument("--slug")
    p_set.add_argument("--path", required=True)
    p_set.add_argument("--value")
    p_set.add_argument("--value-file")
    p_set.set_defaults(func=cmd_set)

    p_gate = sub.add_parser("gate", help="开关教师确认闸门")
    p_gate.add_argument("--state", type=Path, required=True)
    p_gate.add_argument("--name", required=True)
    group = p_gate.add_mutually_exclusive_group(required=True)
    group.add_argument("--yes", action="store_true")
    group.add_argument("--no", dest="yes", action="store_false")
    p_gate.set_defaults(func=cmd_gate)

    p_status = sub.add_parser("status", help="查看进度")
    p_status.add_argument("--state", type=Path, required=True)
    p_status.add_argument("--json", action="store_true")
    p_status.set_defaults(func=cmd_status)

    p_check = sub.add_parser("check", help="校验不变式与阶段前置条件")
    p_check.add_argument("--state", type=Path, required=True)
    p_check.add_argument("--for", dest="target", choices=["upload", "agent", "online", "final"])
    p_check.set_defaults(func=cmd_check)

    args = parser.parse_args()
    return args.func(args) or 0


if __name__ == "__main__":
    raise SystemExit(main())
