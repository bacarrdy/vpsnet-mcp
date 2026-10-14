#!/usr/bin/env python3
"""Generate the installed plugin version reference from release-config.json."""
import argparse
import json
from pathlib import Path

from update_status import decode, version
from validate_plugin import require

REFERENCE = 'skills/vpsnet-operations/references/plugin-version.json'
CANONICAL = 'plugin/' + REFERENCE


def safe_path(root, relative):
    path = root
    require(not path.is_symlink(), 'Plugin version root must not be a symlink')
    for part in Path(relative).parts:
        path /= part
        require(not path.is_symlink(), 'Symlink in plugin version path: ' + relative)
    return path


def expected(root):
    data = decode(safe_path(root, 'release-config.json').read_bytes())
    require(isinstance(data, dict) and set(data) == {'schema_version', 'plugin_version', 'mcp_version'}
            and type(data['schema_version']) is int and data['schema_version'] == 1,
            'Invalid release config for plugin version reference')
    version(data['plugin_version'])
    return (json.dumps({'schema_version': 1, 'plugin_version': data['plugin_version']}, indent=2) + '\n').encode()


def check_version(root):
    raw = expected(root)
    path = safe_path(root, CANONICAL)
    require(path.is_file() and path.read_bytes() == raw,
            'Plugin version reference differs; run python3 scripts/sync_plugin_version.py')
    return json.loads(raw)['plugin_version']


def sync_version(root):
    raw = expected(root)
    path = safe_path(root, CANONICAL)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    check_version(root)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Reject a missing or stale installed-version reference')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    check_version(root) if args.check else sync_version(root)
