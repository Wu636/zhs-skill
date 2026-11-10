#!/usr/bin/env python3
"""Package only files allowed by the supplied assignment-grading template."""

from __future__ import annotations

import argparse
import zipfile
from pathlib import Path


ALLOWED_ROOT_FILES = {"README.md", "SKILL.md"}
ALLOWED_ROOT_DIRS = {"references", "scripts"}
EXCLUDED_NAMES = {".DS_Store", "__MACOSX", "__pycache__"}
EXCLUDED_SUFFIXES = {".pyc", ".pyo"}


def include(path: Path, root: Path, output: Path) -> bool:
    if path.resolve() == output.resolve() or not path.is_file():
        return False
    relative = path.relative_to(root)
    if any(part in EXCLUDED_NAMES for part in relative.parts):
        return False
    if path.suffix.lower() in EXCLUDED_SUFFIXES:
        return False
    if len(relative.parts) == 1:
        return relative.name in ALLOWED_ROOT_FILES
    return relative.parts[0] in ALLOWED_ROOT_DIRS


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("skill_dir", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = args.skill_dir.expanduser().resolve()
    output = args.output.expanduser().resolve()
    if not (root / "README.md").is_file() or not (root / "SKILL.md").is_file():
        parser.error(f"README.md or SKILL.md not found in {root}")
    output.parent.mkdir(parents=True, exist_ok=True)

    files = sorted(path for path in root.rglob("*") if include(path, root, output))
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, Path(root.name) / path.relative_to(root))

    with zipfile.ZipFile(output) as archive:
        names = archive.namelist()
        roots = {Path(name).parts[0] for name in names if name}
        if roots != {root.name}:
            raise RuntimeError(f"Unexpected ZIP roots: {sorted(roots)}")
        required = {f"{root.name}/README.md", f"{root.name}/SKILL.md"}
        if not required.issubset(names):
            raise RuntimeError("ZIP does not contain root README.md and SKILL.md")
        unexpected = []
        for name in names:
            parts = Path(name).parts[1:]
            if not parts:
                continue
            if len(parts) == 1 and parts[0] not in ALLOWED_ROOT_FILES:
                unexpected.append(name)
            elif len(parts) > 1 and parts[0] not in ALLOWED_ROOT_DIRS:
                unexpected.append(name)
        if unexpected:
            raise RuntimeError(f"Template-external ZIP entries: {unexpected}")
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
