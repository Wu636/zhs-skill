#!/usr/bin/env python3
"""Package a standard educational expert Skill from its manifest."""

import argparse
import json
import os
import re
import tempfile
from pathlib import Path, PurePosixPath
from zipfile import ZIP_DEFLATED, ZipFile


CORE_FILES = {"SKILL.md", "EXPERT_CUSTOM.md", "README.md", "manifest.json"}
NAME_PATTERN = r"[a-z0-9]+(?:-[a-z0-9]+)*"


def check_file(root, path):
    """Check a portable relative file path before including it."""
    if not isinstance(path, str):
        raise ValueError("Manifest paths must be strings.")
    parts = path.split("/")
    if not all(parts) or any(
        part.startswith(".") or ":" in part or "\\" in part for part in parts
    ):
        raise ValueError(f"Invalid or hidden resource path: {path}")
    candidate = root
    for part in parts:
        candidate = candidate / part
        if candidate.is_symlink():
            raise ValueError(f"Symbolic links are not allowed: {path}")
    if not candidate.is_file():
        raise ValueError(f"Missing file: {path}")
    return candidate


def get_files(root):
    if len(root.name) > 64 or not re.fullmatch(NAME_PATTERN, root.name):
        raise ValueError(f"Invalid Skill folder name: {root.name}")
    files = {path: check_file(root, path) for path in CORE_FILES}
    manifest = json.loads(files["manifest.json"].read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise ValueError("manifest.json must contain an object.")
    for field, expected in {
        "name": root.name,
        "entrypoint": "SKILL.md",
        "expert_custom": "EXPERT_CUSTOM.md",
    }.items():
        if manifest.get(field) != expected:
            raise ValueError(f"manifest.json {field} must be {expected}.")

    skill = files["SKILL.md"].read_text(encoding="utf-8")
    frontmatter = re.match(r"\A---\n(.*?)\n---(?:\n|\Z)", skill, re.DOTALL)
    if not frontmatter:
        raise ValueError("SKILL.md must begin with YAML frontmatter.")
    fields = frontmatter.group(1)
    name = re.search(r"^name:[ \t]*(.+)$", fields, re.MULTILINE)
    description = re.search(r"^description:[ \t]*\S", fields, re.MULTILINE)
    if not name or name.group(1).strip().strip("\"'") != root.name or not description:
        raise ValueError("SKILL.md needs a matching name and a description.")

    resources = manifest.get("resources")
    if not isinstance(resources, dict):
        raise ValueError("manifest.json needs a resources object.")
    for group in ("references", "templates", "examples"):
        entries = resources.get(group)
        if not isinstance(entries, list) or not entries:
            raise ValueError(f"List at least one {group} resource.")
    for group, entries in resources.items():
        if not isinstance(entries, list):
            raise ValueError(f"Resource group must be a list: {group}")
        for path in entries:
            file = check_file(root, path)
            if group in ("references", "templates", "examples"):
                if not path.startswith(group + "/"):
                    raise ValueError(f"Place {path} inside {group}/.")
            files[path] = file
    if "examples/test_cases.md" not in resources["examples"]:
        raise ValueError("List examples/test_cases.md in resources.examples.")
    return files


def pack(root, destination, replace):
    if destination.suffix.lower() != ".zip" or root in destination.parents:
        raise ValueError("Choose a .zip destination outside the Skill folder.")
    files = get_files(root)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent) as temp:
        archive = Path(temp) / "package.zip"
        names = [str(PurePosixPath(root.name, path)) for path in sorted(files)]
        with ZipFile(archive, "w", compression=ZIP_DEFLATED) as bundle:
            for path, name in zip(sorted(files), names):
                bundle.write(files[path], name)
        with ZipFile(archive) as bundle:
            if bundle.namelist() != names or bundle.testzip() is not None:
                raise ValueError("ZIP verification failed.")
        if replace:
            archive.replace(destination)
        else:
            os.link(archive, destination)
    return len(files)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Skill root folder")
    parser.add_argument("destination", type=Path, help="Output ZIP outside the root")
    parser.add_argument("--replace", action="store_true", help="Replace an existing ZIP")
    args = parser.parse_args()
    try:
        root = args.source.resolve(strict=True)
        destination = args.destination.parent.resolve() / args.destination.name
        count = pack(root, destination, args.replace)
    except (OSError, ValueError) as error:
        parser.exit(1, f"Packaging failed: {error}\n")
    print(f"Packaged {count} files: {destination}")


if __name__ == "__main__":
    main()
