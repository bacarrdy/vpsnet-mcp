#!/usr/bin/env python3
"""Generate self-contained single-skill imports from reviewed canonical files.

Only the explicit dependency map below selects files. Links validate the result;
they never select additional source files or fetch external content.
"""
import argparse
from pathlib import Path, PurePosixPath
import re
import shutil
from urllib.parse import unquote, urlsplit

from validate_plugin import require, validate_directory_text

DIRECTORY = 'distribution/standalone-skills'
EXECUTION = 'plugin/skills/vpsnet-operations/references/execution.md'
SIBLING_EXECUTION = '../vpsnet-operations/references/execution.md'
SKILLS = {
    'vpsnet-operations': {
        'SKILL.md': 'plugin/skills/vpsnet-operations/SKILL.md',
        'references/execution.md': EXECUTION,
        'references/use-cases.md': 'plugin/skills/vpsnet-operations/references/use-cases.md',
    },
    'vpsnet-deploy': {
        'SKILL.md': 'plugin/skills/vpsnet-deploy/SKILL.md',
        'references/execution.md': EXECUTION,
    },
    'vpsnet-troubleshoot': {
        'SKILL.md': 'plugin/skills/vpsnet-troubleshoot/SKILL.md',
        'references/execution.md': EXECUTION,
    },
    'vpsnet-functions': {
        'SKILL.md': 'plugin/skills/vpsnet-functions/SKILL.md',
        'references/execution.md': EXECUTION,
    },
}


def safe_path(root, relative):
    parts = PurePosixPath(relative).parts
    require(parts and not PurePosixPath(relative).is_absolute() and '..' not in parts,
            'Invalid standalone skill path')
    path = root
    require(not path.is_symlink(), 'Standalone skill root must not be a symlink')
    for part in parts:
        path /= part
        require(not path.is_symlink(), 'Symlink in standalone skill path: ' + relative)
    return path


def validate_links(entries):
    """Check Markdown inline/reference links and HTML href/src without includes."""
    patterns = (
        r'\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+[\'\"][^\n]*[\'\"])?\s*\)',
        r'^\s{0,3}\[[^\]]+\]:\s*(<[^>]+>|\S+)',
        r'\b(?:href|src)=[\'\"]([^\'\"]+)[\'\"]',
    )
    for name, raw in entries.items():
        for pattern in patterns:
            for match in re.finditer(pattern, raw.decode('utf-8'), re.M):
                target = match[1].removeprefix('<').removesuffix('>')
                url = urlsplit(target)
                if url.scheme in ('https', 'http', 'mailto'):
                    continue  # Informational public URLs remain exactly as authored.
                require(not url.scheme and not url.netloc and not url.query,
                        'Unsupported standalone skill link: ' + target)
                if not url.path:
                    continue  # A heading in the same file is not a file dependency.
                path = unquote(url.path)
                parts = PurePosixPath(path).parts
                require(not PurePosixPath(path).is_absolute() and '..' not in parts
                        and '\\' not in path and not any(ord(c) < 32 for c in path),
                        'Standalone skill link escapes package: ' + target)
                bundled = (PurePosixPath(name).parent / path).as_posix()
                require(bundled in entries, 'Missing standalone skill reference: ' + bundled)


def snapshot(root):
    packages = {}
    for skill, files in SKILLS.items():
        entries = {}
        for target, original in files.items():
            path = safe_path(root, original)
            require(path.is_file(), 'Missing canonical standalone skill source: ' + original)
            raw = path.read_bytes()
            validate_directory_text(raw.decode('utf-8'), original)
            if target == 'SKILL.md' and skill != 'vpsnet-operations':
                old = SIBLING_EXECUTION.encode()
                require(raw.count(old) == 1, 'Expected one known sibling execution link: ' + skill)
                raw = raw.replace(old, b'references/execution.md')
            entries[target] = raw
        validate_links(entries)
        packages[skill] = entries
    return packages


def expected_files(root):
    return {f'{skill}/{name}': raw for skill, entries in snapshot(root).items()
            for name, raw in entries.items()}


def check_skills(root):
    expected = expected_files(root)
    directory = safe_path(root, DIRECTORY)
    actual = set()
    for path in directory.rglob('*'):
        require(not path.is_symlink(), 'Symlink in standalone skills mirror')
        if path.is_file():
            actual.add(path.relative_to(directory).as_posix())
    require(actual == set(expected)
            and all((directory / name).read_bytes() == raw for name, raw in expected.items()),
            'Standalone skills mirror differs; run python3 scripts/sync_standalone_skills.py')


def sync_skills(root):
    expected = expected_files(root)
    directory = safe_path(root, DIRECTORY)
    require(not any(path.is_symlink() for path in directory.rglob('*')),
            'Symlink in standalone skills mirror')
    if directory.exists():
        shutil.rmtree(directory)
    for name, raw in expected.items():
        path = directory / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
    check_skills(root)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Check generated imports without writing files')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    check_skills(root) if args.check else sync_skills(root)
