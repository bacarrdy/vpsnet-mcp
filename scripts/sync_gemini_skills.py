#!/usr/bin/env python3
"""Maintain Gemini's repository-root skills from the canonical plugin sources."""
import argparse
from pathlib import Path
import shutil

SKILL_FILES = (
    'skills/vpsnet-operations/SKILL.md',
    'skills/vpsnet-operations/references/use-cases.md',
    'skills/vpsnet-operations/references/execution.md',
    'skills/vpsnet-operations/references/plugin-version.json',
    'skills/vpsnet-deploy/SKILL.md',
    'skills/vpsnet-troubleshoot/SKILL.md',
    'skills/vpsnet-functions/SKILL.md',
)


def snapshot(root):
    result = {}
    for name in SKILL_FILES:
        path = root / 'plugin'
        for part in Path(name).parts:
            path /= part
            if path.is_symlink():
                raise ValueError('Symlink in canonical Gemini skill: ' + name)
        result[name] = path.read_bytes()
    return result


def check_skills(root):
    expected = snapshot(root)
    directory = root / 'skills'
    if directory.is_symlink():
        raise ValueError('Gemini skills mirror must not be a symlink')
    actual = set()
    for path in directory.rglob('*'):
        if path.is_symlink():
            raise ValueError('Symlink in Gemini skills mirror')
        if path.is_file():
            actual.add(path.relative_to(root).as_posix())
    if actual != set(expected) or any((root / name).read_bytes() != raw for name, raw in expected.items()):
        raise ValueError('Gemini skills mirror differs; run python3 scripts/sync_gemini_skills.py')


def sync_skills(root):
    expected = snapshot(root)
    directory = root / 'skills'
    if directory.is_symlink():
        raise ValueError('Gemini skills mirror must not be a symlink')
    if directory.exists():
        shutil.rmtree(directory)
    for name, raw in expected.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
    check_skills(root)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Fail if the committed mirror differs; do not write files')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    if args.check:
        check_skills(root)
    else:
        sync_skills(root)
