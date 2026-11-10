#!/usr/bin/env python3
"""从状态文件生成批次报告与待决事项。只读状态，不发请求。"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

UPLOAD_LABEL = {
    "uploaded": "成功",
    "duplicate": "已存在",
    "failed": "失败",
    "pending": "未执行",
}
FINALIZE_LABEL = {"done": "已定稿", "skipped": "跳过", "failed": "失败", "pending": "未执行"}
PUBLISH_LABEL = {"done": "已发布", "failed": "失败", "pending": "未发布"}
AGENT_LABEL = {"created": "成功", "failed": "失败", "pending": "未创建"}
TEST_LABEL = {
    "passed": "通过",
    "failed": "未通过",
    "inconclusive": "待定",
    "skipped": "跳过",
    "pending": "未执行",
}


def short(text, limit=40):
    text = (text or "").replace("\n", " ").strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def summarize(state):
    rows = []
    for item in state.get("skills", []):
        upload = item.get("upload", {})
        finalize = item.get("finalize", {})
        publish = item.get("publishCourse", {})
        agent = item.get("agent", {})
        test = item.get("test") or {}
        rounds = test.get("rounds") or []
        rows.append(
            {
                "displayName": item.get("displayName") or item.get("slug", ""),
                "slug": item.get("slug", ""),
                "zip": Path(item.get("zip", "")).name,
                "sha12": (item.get("sha256", "") or "")[:12],
                "upload": UPLOAD_LABEL.get(upload.get("status"), upload.get("status", "")),
                "uploadMsg": upload.get("msg", ""),
                "skillNid": upload.get("skillNid", ""),
                "test": TEST_LABEL.get(test.get("status"), test.get("status", "") or "未执行"),
                "testRounds": len(rounds),
                "testMae": test.get("mae"),
                "testMaxDiff": test.get("maxDiff"),
                "testVersion": test.get("skillVersionId", ""),
                "testNote": test.get("note") or test.get("skippedReason", ""),
                "finalize": FINALIZE_LABEL.get(finalize.get("status"), finalize.get("status", "")),
                "version": finalize.get("version", ""),
                "skillVersionId": finalize.get("skillVersionId", ""),
                "publish": PUBLISH_LABEL.get(publish.get("status"), publish.get("status", "")),
                "boundCount": publish.get("boundCount", 0),
                "instanceNid": agent.get("instanceNid", ""),
                "agent": AGENT_LABEL.get(agent.get("status"), agent.get("status", "")),
                "verified": bool(agent.get("verified")),
                "online": "已上线" if agent.get("online") else "待确认",
            }
        )
    return rows


def decisions(state, rows):
    items = []
    gates = state.get("gates", {})
    if not gates.get("buildApproved"):
        items.append("闸门 A（造包结果）尚未确认")
    if not gates.get("uploadApproved"):
        items.append("闸门 B（上传与上架计划）尚未确认")
    for row, skill in zip(rows, state.get("skills", [])):
        slug = row["slug"]
        if not skill.get("requirement", "").strip():
            items.append(f"{slug}：缺少学生提交要求，阶段 4 前补齐")
        if row["upload"] == "失败":
            items.append(f"{slug}：上传失败（{row['uploadMsg'] or '无 msg'}），该技能不进入阶段 4")
        if row["publish"] == "失败":
            items.append(f"{slug}：发布到课程失败，去技能详情人工确认")
        if row["publish"] == "已发布" and not row["boundCount"]:
            items.append(f"{slug}：boundCount 为 0，发布可能未生效")
        if row["upload"] in ("成功", "已存在") and row["agent"] == "未创建":
            items.append(f"{slug}：智能体尚未创建")
        if row["agent"] == "成功" and not row["verified"]:
            items.append(f"{slug}：智能体已创建但未回查通过")
        if row["agent"] == "成功" and not skill.get("agent", {}).get("online"):
            items.append(f"{slug}：智能体仍是草稿，待确认是否上线")
        if row["finalize"] == "失败":
            items.append(f"{slug}：定稿失败（{skill.get('finalize', {}).get('msg', '') or '无 msg'}）")
        test = skill.get("test") or {}
        tested = test.get("status")
        if row["upload"] in ("成功", "已存在") and tested in ("pending", "failed", "inconclusive"):
            if not gates.get("testApproved"):
                detail = row["testNote"] or tested
                items.append(f"{slug}：批阅测试未通过/未执行（{detail}），确认前不得定稿发布")
        if tested == "passed" and row["testVersion"] and row["testVersion"] != row["skillVersionId"]:
            items.append(f"{slug}：定稿版本与通过测试的版本不一致，需改绑或重新测试")
        if tested == "failed":
            items.append(f"{slug}：测试未通过，按失分点优化后作为新候选重传；失败候选保留为草稿，勿定稿")
        if tested == "skipped":
            items.append(f"{slug}：测试已跳过（{row['testNote'] or '未写原因'}），发布后建议补一次抽样复核")
    return items


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    path = args.state.expanduser()
    if not path.is_file():
        print(f"状态文件不存在：{path}", file=sys.stderr)
        return 2
    state = json.loads(path.read_text(encoding="utf-8"))
    rows = summarize(state)
    course = state.get("course", {})
    todo = decisions(state, rows)

    success = sum(1 for r in rows if r["agent"] == "成功" and r["verified"])
    skipped = sum(1 for r in rows if r["upload"] == "已存在" and r["agent"] == "未创建")
    failed = len(rows) - success - skipped

    if args.json:
        print(
            json.dumps(
                {
                    "course": course,
                    "runId": state.get("runId"),
                    "gates": state.get("gates"),
                    "rows": rows,
                    "totals": {"total": len(rows), "success": success, "skipped": skipped, "failed": failed},
                    "decisions": todo,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    print(f"批次：{course.get('name', '')}（{course.get('school', '')}）  运行 {state.get('runId', '')}")
    print(f"课程 id：{course.get('courseId', '')}  学期：{course.get('term', '')}")
    print()
    header = (
        f"{'批阅名称':<26} {'上传':<5} {'skillNid':<12} {'测试':<6} {'定稿':<5} {'版本':<7} "
        f"{'发布':<5} {'instanceNid':<12} {'保存':<5} {'上线':<5}"
    )
    print(header)
    print("-" * len(header))
    for row in rows:
        print(
            f"{short(row['displayName'], 24):<26} {row['upload']:<5} {row['skillNid'][:12]:<12} "
            f"{row['test']:<6} {row['finalize']:<5} {(row['version'] or '-'):<7} {row['publish']:<5} "
            f"{row['instanceNid'][:12]:<12} {row['agent']:<5} {row['online']:<5}"
        )
        if row["uploadMsg"]:
            print(f"      上传备注：{row['uploadMsg']}")
        if row["testRounds"] or row["test"] not in ("未执行",):
            mae = "-" if row["testMae"] is None else row["testMae"]
            diff = "-" if row["testMaxDiff"] is None else row["testMaxDiff"]
            print(f"      测试：{row['test']}（{row['testRounds']} 轮，MAE={mae}，最大分差={diff}）{row['testNote']}")
    print()
    print(f"合计 {len(rows)}：成功 {success}、跳过 {skipped}、失败 {failed}")
    if todo:
        print()
        print("待决事项：")
        for index, item in enumerate(todo, 1):
            print(f"{index}. {item}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
