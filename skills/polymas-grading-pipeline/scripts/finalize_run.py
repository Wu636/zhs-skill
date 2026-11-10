#!/usr/bin/env python3
"""归集批阅流水线的最终交付物，并清理运行目录里的中间文件。

默认只保留：
- 技能包（zips/*.zip）
- 批阅技能介绍.md（名称/描述/学生提交要求）
- 学生作业（测试过的学生原文件）
- 平台批阅报告（PDF / PDF 批次 ZIP）

用法：
  python3 scripts/finalize_run.py --run <运行目录> [--out-dir <交付根目录>] [--keep-evidence] [--force]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

STATE_NAMES = ("pipeline-state.json", "pipeline_state.json")
STUDENT_SUFFIXES = {".doc", ".docx", ".wps", ".odt", ".rtf"}
PLATFORM_MARKERS = ("平台", "platform-pdf", "platform_pdf", "批阅报告", "批阅报告pdf")


def die(message: str) -> None:
    print(f"[error] {message}", file=sys.stderr)
    raise SystemExit(1)


def warn(message: str) -> None:
    print(f"[warn] {message}", file=sys.stderr)


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        die(f"无法读取 {path}: {exc}")


def safe_name(text: str, fallback: str = "交付") -> str:
    value = re.sub(r'[\\/:*?"<>|\r\n\t]+', "-", str(text or ""))
    value = re.sub(r"\s+", " ", value).strip(" .")
    return value[:80] or fallback


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_state(run_dir: Path) -> tuple[Path, dict]:
    for name in STATE_NAMES:
        candidate = run_dir / name
        if candidate.exists():
            return candidate, read_json(candidate)
    die(f"运行目录缺少 pipeline-state.json: {run_dir}")


def resolve(value: str | None, base: Path) -> Path | None:
    if not value:
        return None
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = base / path
    return path.resolve()


def unique_target(folder: Path, name: str) -> Path:
    target = folder / name
    if not target.exists():
        return target
    stem, suffix = target.stem, target.suffix
    index = 2
    while True:
        candidate = folder / f"{stem}-{index}{suffix}"
        if not candidate.exists():
            return candidate
        index += 1


def copy_file(source: Path, folder: Path, *, name: str | None = None) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    target = unique_target(folder, name or source.name)
    shutil.copy2(source, target)
    if target.stat().st_size != source.stat().st_size:
        die(f"交付文件校验失败: {target}")
    print(f"  + {target}")
    return target


def collect_zip_paths(state: dict, run_dir: Path) -> list[Path]:
    seen: set[Path] = set()
    result: list[Path] = []
    for skill in state.get("skills") or []:
        candidate = resolve(skill.get("zip"), run_dir)
        if candidate and candidate.exists() and candidate.suffix.lower() == ".zip":
            if candidate not in seen:
                seen.add(candidate)
                result.append(candidate)
    zip_dir = run_dir / "zips"
    if zip_dir.is_dir():
        for candidate in sorted(zip_dir.glob("*.zip")):
            resolved = candidate.resolve()
            if resolved not in seen:
                seen.add(resolved)
                result.append(resolved)
    return result


def collect_student_files(state: dict, run_dir: Path) -> list[tuple[Path, str]]:
    seen: set[Path] = set()
    result: list[tuple[Path, str]] = []

    def add(candidate: Path | None, preferred: str | None = None) -> None:
        if candidate and candidate.is_file() and candidate.suffix.lower() in STUDENT_SUFFIXES:
            resolved = candidate.resolve()
            if resolved not in seen:
                seen.add(resolved)
                result.append((resolved, preferred or candidate.name))

    def add_sample(sample: dict, base: Path) -> None:
        preferred = sample.get("sourceFile") or sample.get("fileName")
        for key in ("localFile", "sourceFile", "file"):
            add(resolve(sample.get(key), base), preferred)
            preferred = None

    for skill in state.get("skills") or []:
        test = skill.get("test") or {}
        manifests = [test.get("manifest")]
        for round_item in test.get("rounds") or []:
            manifests.append(round_item.get("manifest"))
        for manifest_value in manifests:
            manifest = resolve(manifest_value, run_dir)
            if not manifest or not manifest.exists():
                continue
            manifest_dir = manifest.parent
            try:
                data = read_json(manifest)
            except SystemExit:
                data = {}
            for sample in data.get("samples") or []:
                add_sample(sample, manifest_dir)
            for candidate in manifest_dir.iterdir():
                if candidate.is_file() and candidate.suffix.lower() in STUDENT_SUFFIXES:
                    add(candidate)

    for sample in state.get("samples") or []:
        add_sample(sample, run_dir)

    return result


def is_platform_report(path: Path, run_dir: Path) -> bool:
    try:
        relative = path.relative_to(run_dir)
    except ValueError:
        relative = path
    haystack = str(relative).lower()
    return any(marker in haystack for marker in PLATFORM_MARKERS)


def collect_platform_reports(run_dir: Path) -> tuple[list[Path], list[Path]]:
    pdfs: list[Path] = []
    zips: list[Path] = []
    for path in sorted(run_dir.rglob("*")):
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        if suffix == ".pdf" and is_platform_report(path, run_dir):
            pdfs.append(path)
        elif suffix == ".zip" and "pdf" in path.name.lower() and is_platform_report(path, run_dir):
            zips.append(path)
    return pdfs, zips


def clean_requirement(text: str) -> str:
    value = str(text or "").strip()
    lines = value.splitlines()
    if lines and re.match(r"^#\s*学生提交作业要求\s*$", lines[0].strip()):
        lines = lines[1:]
    return "\n".join(lines).strip() or "（未记录）"


def build_intro(state: dict, run_dir: Path, zip_map: dict[str, str]) -> str:
    course = state.get("course") or {}
    course_name = course.get("name") or run_dir.name
    lines = [f"# {course_name} 批阅技能介绍", ""]
    lines.append(f"- 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}")
    if state.get("runId"):
        lines.append(f"- 运行批次：{state.get('runId')}")
    if course.get("courseId"):
        lines.append(f"- 课程 ID：{course.get('courseId')}")
    lines.append("")

    skills = state.get("skills") or []
    if skills:
        for index, skill in enumerate(skills, start=1):
            slug = skill.get("slug") or f"skill-{index}"
            name = skill.get("displayName") or slug
            lines.append(f"## {index}. {name}")
            lines.append("")
            if zip_map.get(slug):
                lines.append(f"- 技能包：{zip_map[slug]}")
            upload = skill.get("upload") or {}
            finalize = skill.get("finalize") or {}
            if upload.get("skillNid"):
                lines.append(f"- 平台技能 ID：{upload.get('skillNid')}")
            if finalize.get("skillVersionId"):
                lines.append(f"- 定稿版本：{finalize.get('skillVersionId')}")
            lines.append("")
            lines.append("### 批阅描述")
            lines.append("")
            lines.append(str(skill.get("desc") or "（未记录）").strip())
            lines.append("")
            lines.append("### 学生提交作业要求")
            lines.append("")
            lines.append(clean_requirement(skill.get("requirement")))
            lines.append("")
    else:
        grouped: dict[str, list[dict]] = {}
        for sample in state.get("samples") or []:
            grouped.setdefault(sample.get("agentName") or "批阅智能体", []).append(sample)
        for index, (name, samples) in enumerate(grouped.items(), start=1):
            lines.append(f"## {index}. {name}")
            lines.append("")
            first = samples[0]
            if first.get("skillNid"):
                lines.append(f"- 平台技能 ID：{first.get('skillNid')}")
            if first.get("version"):
                lines.append(f"- 版本：{first.get('version')}")
            lines.append("")
            lines.append("### 学生提交作业要求")
            lines.append("")
            lines.append(clean_requirement(first.get("submissionRequirement")))
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def pending_stages(state: dict) -> list[str]:
    pending: list[str] = []
    skills = state.get("skills") or []
    if not skills:
        return pending
    for skill in skills:
        slug = skill.get("slug") or "未命名技能"
        zip_path = skill.get("zip")
        build = (skill.get("build") or {}).get("status")
        if not zip_path and build not in ("done", "completed"):
            pending.append(f"{slug}: 技能包未构建")
        if not (skill.get("upload") or {}).get("skillNid"):
            pending.append(f"{slug}: 未上传到平台")
        if not (skill.get("agent") or {}).get("instanceNid"):
            pending.append(f"{slug}: 未创建/绑定智能体")
    return pending


def main() -> int:
    parser = argparse.ArgumentParser(description="归集批阅交付物并清理运行目录")
    parser.add_argument("--run", required=True, help="运行目录（含 pipeline-state.json）")
    parser.add_argument("--out-dir", default="", help="交付根目录，默认 <当前目录>/交付")
    parser.add_argument("--keep-evidence", action="store_true", help="保留运行目录，只导出交付物")
    parser.add_argument("--force", action="store_true", help="流水线未完成时仍允许清理")
    args = parser.parse_args()

    run_dir = Path(args.run).expanduser().resolve()
    if not run_dir.is_dir():
        die(f"运行目录不存在: {run_dir}")
    state_path, state = resolve_state(run_dir)

    course = state.get("course") or {}
    course_name = safe_name(course.get("name") or run_dir.name, "批阅交付")
    run_id = safe_name(state.get("runId") or run_dir.name, "run")
    out_root = Path(args.out_dir).expanduser().resolve() if args.out_dir else Path.cwd() / "交付"
    out_dir = out_root / f"{course_name}-{run_id}"
    if out_dir == run_dir or run_dir in out_dir.parents:
        die("交付目录不能位于运行目录内部，否则会随清理一起删除")

    pending = pending_stages(state)
    if pending and not args.force:
        for item in pending:
            warn(item)
        die("流水线仍有未完成阶段，暂不清理。确认要导出并删除运行目录时加 --force。")

    print(f"[finalize] 运行目录: {run_dir}")
    print(f"[finalize] 交付目录: {out_dir}")

    zip_paths = collect_zip_paths(state, run_dir)
    zip_map: dict[str, str] = {}
    zip_folder = out_dir / "技能包"
    for zip_path in zip_paths:
        target = copy_file(zip_path, zip_folder)
        for skill in state.get("skills") or []:
            skill_zip = resolve(skill.get("zip"), run_dir)
            if skill_zip and skill_zip == zip_path:
                zip_map[skill.get("slug") or ""] = target.name
    if not zip_paths:
        warn("未找到技能压缩包，只导出介绍与测试材料")

    intro = build_intro(state, run_dir, zip_map)
    out_dir.mkdir(parents=True, exist_ok=True)
    intro_path = out_dir / "批阅技能介绍.md"
    intro_path.write_text(intro, encoding="utf-8")
    print(f"  + {intro_path}")

    student_files = collect_student_files(state, run_dir)
    for source, preferred in student_files:
        copy_file(source, out_dir / "学生作业", name=preferred)
    if not student_files:
        print("  · 没有检测到学生作业文件（可能未做批阅测试）")

    pdfs, pdf_zips = collect_platform_reports(run_dir)
    report_hashes: dict[str, Path] = {}
    for source in pdfs + pdf_zips:
        digest = sha256(source)
        if digest in report_hashes:
            print(f"  = 跳过重复报告: {source.name}")
            continue
        report_hashes[digest] = copy_file(source, out_dir / "平台批阅报告")
    if not pdfs and not pdf_zips:
        print("  · 没有检测到平台 PDF 批阅报告（可能未做批阅测试）")

    if args.keep_evidence:
        print("[finalize] 已按 --keep-evidence 保留运行目录")
        return 0

    cwd = Path.cwd().resolve()
    if run_dir == cwd or run_dir in cwd.parents:
        die("运行目录包含当前工作目录，拒绝清理；请切到其他目录后重试")
    shutil.rmtree(run_dir)
    print("[finalize] 运行目录已清理，只保留上述交付文件")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
