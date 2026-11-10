#!/usr/bin/env python3
"""判定批阅技能测试结果，并把结论写入流水线状态。

输入是浏览器脚本导出的紧凑 JSON（samples 为每个学生样本的实测分与教师分）。
教师样本按百分比分差判定：|实测-教师| ≤ --max-diff（默认 8 分）且 MAE ≤ --max-mae（默认 5 分）。
模拟样本按段位判定：好 ≥ 85，中 70–84，差 < 70。
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

from pipeline_state import load, save


def to_float(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def percent(score, full):
    score, full = to_float(score), to_float(full)
    if score is None or full is None or full <= 0:
        return None
    return round(score / full * 100, 2)


def classify_simulated(pct, good_min, mid_min):
    if pct is None:
        return None
    if pct >= good_min:
        return "good"
    if pct >= mid_min:
        return "mid"
    return "bad"


def compact_sample(sample, args):
    status = str(sample.get("status") or "").upper()
    pct = percent(sample.get("score"), sample.get("full"))
    teacher_pct = percent(sample.get("teacherScore"), sample.get("teacherFull"))
    kind = sample.get("kind") or ("teacher" if teacher_pct is not None else "simulated")
    item_diffs = []
    for item in sample.get("teacherItems") or []:
        name = str(item.get("name") or "").strip()
        teacher_item = to_float(item.get("score"))
        matched = next(
            (hit for hit in sample.get("items") or [] if str(hit.get("name") or "").strip() == name),
            None,
        )
        model_item = to_float((matched or {}).get("score"))
        item_diffs.append(
            {
                "name": name,
                "teacherScore": teacher_item,
                "modelScore": model_item,
                "diff": None if teacher_item is None or model_item is None else round(model_item - teacher_item, 2),
                "matched": matched is not None,
            }
        )

    result = {
        "id": sample.get("id") or sample.get("file") or "",
        "file": sample.get("file") or "",
        "kind": kind,
        "level": sample.get("level") or "",
        "status": status or "UNKNOWN",
        "taskId": sample.get("taskId") or sample.get("reportTaskId") or "",
        "teacherScore": to_float(sample.get("teacherScore")),
        "teacherFull": to_float(sample.get("teacherFull")),
        "teacherPct": teacher_pct,
        "score": to_float(sample.get("score")),
        "full": to_float(sample.get("full")),
        "pct": pct,
        "diff": None if pct is None or teacher_pct is None else round(pct - teacher_pct, 2),
        "note": sample.get("note") or "",
        "itemDiffs": item_diffs,
    }
    if kind == "simulated":
        result["expectedBand"] = result["level"] or ""
    return result


def evaluate(samples, args):
    reasons, warnings = [], []
    teacher = [s for s in samples if s["kind"] == "teacher"]
    simulated = [s for s in samples if s["kind"] == "simulated"]

    if not samples:
        return "inconclusive", None, None, ["没有任何测试样本"], warnings

    unresolved = [s for s in samples if s["status"] != "SUCCESS" or s["pct"] is None]
    if unresolved:
        for s in unresolved:
            warnings.append(f"{s['id'] or s['file']}：状态 {s['status']}，分数不可用")
        return "inconclusive", None, None, ["存在未完成或失败的测试样本"], warnings

    mae = max_diff = None
    if teacher:
        diffs = [abs(s["diff"]) for s in teacher if s["diff"] is not None]
        if len(diffs) != len(teacher):
            return "inconclusive", None, None, ["教师样本缺少教师分或实测分"], warnings
        mae = round(sum(diffs) / len(diffs), 2)
        max_diff = round(max(diffs), 2)
        if max_diff > args.max_diff:
            reasons.append(f"单份最大分差 {max_diff} 分 > 阈值 {args.max_diff} 分")
        if mae > args.max_mae:
            reasons.append(f"平均分差 {mae} 分 > 阈值 {args.max_mae} 分")

    for s in simulated:
        expected = s.get("expectedBand") or s.get("level")
        actual = classify_simulated(s["pct"], args.good_min, args.mid_min)
        s["actualBand"] = actual
        if not expected:
            warnings.append(f"{s['id'] or s['file']}：模拟样本未给 level，已跳过档位校验")
        elif actual != expected:
            reasons.append(f"{s['id'] or s['file']}：期望 {expected} 档，实测 {s['pct']} 分（{actual} 档）")

    if not teacher and not simulated:
        return "inconclusive", mae, max_diff, ["没有可判定的样本类型"], warnings

    return ("passed" if not reasons else "failed"), mae, max_diff, reasons, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--slug", required=True)
    parser.add_argument("--results", type=Path, help="浏览器导出的测试结果 JSON")
    parser.add_argument("--skill-nid", default="")
    parser.add_argument("--skill-version-id", default="")
    parser.add_argument("--model", default="")
    parser.add_argument("--round", type=int, default=0, help="第几轮测试，默认按已有轮次数 +1")
    parser.add_argument("--max-diff", type=float, default=8.0)
    parser.add_argument("--max-mae", type=float, default=5.0)
    parser.add_argument("--good-min", type=float, default=85.0)
    parser.add_argument("--mid-min", type=float, default=70.0)
    parser.add_argument("--skip", action="store_true", help="标记本轮不做测试")
    parser.add_argument("--reason", default="", help="跳过原因")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    state = load(args.state)
    item = next((s for s in state.get("skills", []) if s.get("slug") == args.slug), None)
    if item is None:
        raise SystemExit(f"状态里没有技能：{args.slug}")
    test = item.setdefault(
        "test",
        {
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
    )

    now = datetime.now().isoformat(timespec="seconds")

    if args.skip:
        if not args.reason.strip():
            raise SystemExit("--skip 需要同时给 --reason")
        test.update(
            {"status": "skipped", "approved": False, "skippedReason": args.reason.strip(), "note": args.reason.strip()}
        )
        test.setdefault("rounds", []).append(
            {
                "round": len(test.get("rounds") or []) + 1,
                "at": now,
                "status": "skipped",
                "reason": args.reason.strip(),
            }
        )
        state.setdefault("log", []).append(
            {"ts": now, "stage": "test", "skill": args.slug, "result": "skipped", "note": args.reason.strip()}
        )
        save(args.state, state)
        print(f"{args.slug} 测试跳过：{args.reason.strip()}")
        return 0

    if not args.results or not args.results.is_file():
        raise SystemExit("缺少 --results（浏览器导出的测试结果 JSON）")
    try:
        payload = json.loads(args.results.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"测试结果不是合法 JSON：{exc}")

    raw_samples = payload.get("samples") or []
    samples = [compact_sample(sample, args) for sample in raw_samples]
    status, mae, max_diff, reasons, warnings = evaluate(samples, args)

    skill_nid = args.skill_nid or payload.get("skillNid") or item.get("upload", {}).get("skillNid", "")
    version_id = (
        args.skill_version_id
        or payload.get("skillVersionId")
        or item.get("finalize", {}).get("skillVersionId", "")
    )
    round_no = args.round or len(test.get("rounds") or []) + 1
    model = args.model or payload.get("modelName") or ""

    test.update(
        {
            "status": status,
            "approved": False,
            "mae": mae,
            "maxDiff": max_diff,
            "skillNid": skill_nid or test.get("skillNid", ""),
            "skillVersionId": version_id or test.get("skillVersionId", ""),
            "samples": samples,
            "note": "；".join(reasons) if reasons else ("通过" if status == "passed" else ""),
        }
    )
    test.setdefault("rounds", []).append(
        {
            "round": round_no,
            "at": now,
            "status": status,
            "model": model,
            "skillNid": skill_nid,
            "skillVersionId": version_id,
            "mae": mae,
            "maxDiff": max_diff,
            "reasons": reasons,
            "sampleCount": len(samples),
            "teacherCount": len([s for s in samples if s["kind"] == "teacher"]),
            "simulatedCount": len([s for s in samples if s["kind"] == "simulated"]),
        }
    )
    candidates = test.setdefault("candidates", [])
    candidates.append(
        {
            "round": round_no,
            "at": now,
            "skillNid": skill_nid,
            "skillVersionId": version_id,
            "status": status,
            "mae": mae,
            "maxDiff": max_diff,
        }
    )
    state.setdefault("log", []).append(
        {
            "ts": now,
            "stage": "test",
            "skill": args.slug,
            "result": status,
            "note": f"mae={mae} maxDiff={max_diff} samples={len(samples)}",
        }
    )
    save(args.state, state)

    if args.json:
        print(json.dumps({"status": status, "mae": mae, "maxDiff": max_diff, "samples": samples,
                          "reasons": reasons, "warnings": warnings}, ensure_ascii=False, indent=2))
    else:
        print(f"{'样本':<28} {'类型':<10} {'实测':>20} {'教师':>14} {'分差':>7} {'状态'}")
        for s in samples:
            actual = f"{s['score'] if s['score'] is not None else '-'} / {s['full'] if s['full'] is not None else '-'}"
            if s["pct"] is not None:
                actual += f" ({s['pct']}%)"
            teacher = f"{s['teacherScore']} ({s['teacherPct']}%)" if s["teacherPct"] is not None else "-"
            diff = f"{s['diff']:+.2f}" if s["diff"] is not None else "-"
            print(f"{s['id'][:26]:<28} {s['kind']:<10} {actual:>20} {teacher:>14} {diff:>7} {s['status']}")
        for msg in reasons:
            print("! " + msg)
        for msg in warnings:
            print("~ " + msg)
        print(f"测试结论：{status}  MAE={mae}  最大分差={max_diff}  写入 {args.state}")

    return 0 if status == "passed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
