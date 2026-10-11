#!/usr/bin/env python3
"""Build an inspectable, credential-free plugin ZIP from an explicit file allowlist."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
package = root / 'plugin'
files = ['plugin.json', 'mcp.json', '.claude-plugin/plugin.json', '.mcp.json', 'skills/vpsnet-operations/SKILL.md']
for filename in files:
    source = package / filename
    if source.is_symlink() or not source.is_file():
        raise ValueError(f'Missing regular package file: {filename}')
    if source.suffix == '.json':
        json.loads(source.read_text())
out = root / 'artifacts' / 'vpsnet-plugin-0.1.0.zip'
out.parent.mkdir(exist_ok=True)
with ZipFile(out, 'w', ZIP_DEFLATED) as archive:
    for filename in files:
        archive.write(package / filename, filename)
print(out)
