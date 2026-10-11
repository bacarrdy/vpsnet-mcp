#!/usr/bin/env python3
"""Build an inspectable, credential-free plugin ZIP from an explicit file allowlist."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from validate_plugin import validate_package

root = Path(__file__).resolve().parent.parent
package = root / 'plugin'
version = validate_package(package)
files = ['plugin.json', 'mcp.json', '.claude-plugin/plugin.json', '.mcp.json', 'skills/vpsnet-operations/SKILL.md', 'skills/vpsnet-operations/references/use-cases.md', 'skills/vpsnet-operations/references/execution.md', 'skills/vpsnet-deploy/SKILL.md', 'skills/vpsnet-troubleshoot/SKILL.md', 'skills/vpsnet-functions/SKILL.md', 'README.md', 'LICENSE', 'assets/icon.png']
for filename in files:
    source = package / filename
    if source.is_symlink() or not source.is_file():
        raise ValueError(f'Missing regular package file: {filename}')
    if source.suffix == '.json':
        json.loads(source.read_text())
out = root / 'artifacts' / f'vpsnet-plugin-{version}.zip'
out.parent.mkdir(exist_ok=True)
with ZipFile(out, 'w', ZIP_DEFLATED) as archive:
    for filename in files:
        archive.write(package / filename, filename)
print(out)
