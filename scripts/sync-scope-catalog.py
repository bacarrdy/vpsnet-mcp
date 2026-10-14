#!/usr/bin/env python3
"""Vendor the descriptive catalog from the backend; never change scope policy here."""
import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--backend-catalog', required=True, type=Path)
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
catalog = json.loads(args.backend_catalog.read_text())
output = Path(__file__).resolve().parents[1] / 'src' / 'scope-catalog.ts'
expected = ('// Generated from backend app/Services/Mcp/scope-catalog.json.\n'
            '// Update with scripts/sync-scope-catalog.py; OAuth policy is enforced separately.\n'
            'export const scopeCatalog: Record<string, { label: Record<string, string>; description: Record<string, string>; implies: string[]; billing: string; legacy: boolean }> = '
            + json.dumps(catalog, ensure_ascii=False, indent=2) + ';\n\n'
            'export function scopeDescriptions(scopes: readonly string[]): Record<string, string> {\n'
            '  return Object.fromEntries(scopes.map(scope => [scope, scopeCatalog[scope].description.en]));\n'
            '}\n')
if args.check:
    if output.read_text() != expected:
        raise SystemExit('Scope catalog differs from the authoritative backend catalog; run this script without --check.')
else:
    output.write_text(expected)
