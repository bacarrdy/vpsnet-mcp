#!/usr/bin/env python3
"""Build the ZIP for OpenAI's plugin portal (Agent Plugins layout: plugin.json, mcp.json, skills/, assets/).

Checks every rule of https://developers.openai.com/plugins/deploy/submission that the package itself can break, then
writes artifacts/vpsnet-plugin-openai-<version>.zip with fixed timestamps (the same input gives the same bytes).
No credential is read or written; the ZIP never carries reviewer credentials, client secrets or server headers.
Usage: python3 scripts/package-openai-plugin.py [--check]   (--check validates without writing)
"""
import json
import re
import struct
import sys
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from validate_plugin import validate_package

root = Path(__file__).resolve().parent.parent
package = root / 'plugin'
ERRORS = []


def need(condition, message):
    if not condition:
        ERRORS.append(message)


def https(value, label, limit=1024):
    need(isinstance(value, str) and value.startswith('https://') and len(value) <= limit and '@' not in value.split('/')[2], f'{label}: HTTPS address up to {limit} characters without credentials')


def text(value, label, limit, required=True):
    if value is None and not required:
        return
    need(isinstance(value, str) and value.strip() != '' and len(value) <= limit, f'{label}: required text up to {limit} characters')


def png_size(path):
    data = path.read_bytes()[:24]
    need(data[:8] == b'\x89PNG\r\n\x1a\n', f'{path.name}: PNG expected')
    return struct.unpack('>II', data[16:24])


def hosted_tools():
    """The tool names the hosted directory profile serves (the reviewed contract snapshot)."""
    path = root / 'test/fixtures/tool-contracts/directory.json'
    if not path.is_file():  # a packaging-only copy without the test fixtures: the repository test run checks the names
        return None
    snapshot = json.loads(path.read_text())
    return set(snapshot.get('included') or snapshot.get('tools') or [])


def build_openai_zip(out=None, check_only=False):
    """Validate the OpenAI package rules; write the ZIP to `out` (default artifacts/) unless check_only. Returns (path, version, files)."""
    ERRORS.clear()
    version = validate_package(package)
    manifest = json.loads((package / 'plugin.json').read_text())
    mcp = json.loads((package / 'mcp.json').read_text())
    openai = manifest.get('extensions', {}).get('com.openai', {})
    listing = openai.get('interface', {})

    need(re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', manifest.get('name', '')) and len(manifest['name']) <= 64, 'name: lowercase letters, numbers and single hyphens, up to 64')
    need(re.fullmatch(r'\d+\.\d+\.\d+', str(manifest.get('version'))), 'version: explicit semantic version')
    text(manifest.get('description'), 'description', 4000)
    text(manifest.get('author', {}).get('name'), 'author.name', 120)
    https(manifest.get('author', {}).get('url'), 'author.url', 2048)
    text(listing.get('displayName'), 'interface.displayName', 30)
    text(listing.get('shortDescription'), 'interface.shortDescription', 30)
    text(listing.get('longDescription'), 'interface.longDescription', 4000)
    text(listing.get('developerName'), 'interface.developerName', 80)
    text(listing.get('category'), 'interface.category', 120)
    for field in ('websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL'):
        https(listing.get(field), f'interface.{field}')
    capabilities = listing.get('capabilities', [])
    need(isinstance(capabilities, list) and 0 < len(capabilities) <= 20 and all(isinstance(c, str) and 0 < len(c) <= 120 for c in capabilities), 'interface.capabilities: 1-20 items up to 120 characters')
    prompts = listing.get('defaultPrompt', [])
    need(isinstance(prompts, list) and len(prompts) <= 3 and len(set(prompts)) == len(prompts) and all(isinstance(p, str) and 0 < len(p) <= 128 and '@' not in p for p in prompts), 'interface.defaultPrompt: up to three unique prompts up to 128 characters, no @mentions')
    for field in ('composerIcon', 'logo'):
        value = listing.get(field)
        need(isinstance(value, str) and value.startswith('./') and (package / value[2:]).is_file(), f'interface.{field}: ./ path to a bundled file')
    width, height = png_size(package / listing['logo'][2:])
    need(width == height and 48 <= width <= 4096, 'logo: square PNG from 48 to 4096 pixels')

    review = openai.get('review', {})
    cases = review.get('test_cases', {})
    tools = hosted_tools()
    positive, negative = cases.get('positive', []), cases.get('negative', [])
    need(len(positive) == 5 and len(negative) == 3, 'review.test_cases: five positive and three negative cases')
    for case in positive:
        need(all(isinstance(case.get(k), str) and case[k].strip() for k in ('description', 'prompt', 'tools_triggered', 'expected_behavior')), 'positive case: description, prompt, tools_triggered and expected_behavior')
        for name in [n.strip() for n in case.get('tools_triggered', '').split(',') if n.strip()]:
            need(tools is None or name in tools, f'positive case names {name}, which the hosted connector does not serve')
    for case in negative:
        need(all(isinstance(case.get(k), str) and case[k].strip() for k in ('description', 'prompt')), 'negative case: description and prompt')
    https(review.get('demo_recording_url'), 'review.demo_recording_url', 2048)
    need(isinstance(review.get('commerce'), bool), 'review.commerce: true or false')
    serialized = json.dumps(manifest)
    for forbidden in ('test_credentials', 'reviewer_instructions', 'clientSecret', 'password'):
        need(forbidden not in serialized and forbidden not in json.dumps(mcp), f'{forbidden} must stay out of the ZIP (entered in the dashboard)')

    servers = mcp.get('mcpServers', {})
    need(len(servers) == 1, 'mcp.json: exactly one MCP server (only one can be connected per plugin)')
    for name, server in servers.items():
        https(server.get('url'), f'mcp.json {name}.url', 2048)
        need(server.get('type') == 'streamable-http', f'mcp.json {name}: streamable-http')
        need(not server.get('headers'), f'mcp.json {name}: no server headers (public submission rejects them)')
        auth = server.get('extensions', {}).get('com.openai', {}).get('auth', {})
        need(auth.get('type') == 'oauth', f'mcp.json {name}: OAuth (the server is protected; never type none)')

    files = ['plugin.json', 'mcp.json', 'README.md', 'LICENSE', listing['logo'][2:]]
    files += sorted(str(p.relative_to(package)) for p in (package / 'skills').rglob('*') if p.is_file())
    for name in files:
        path = package / name
        need(path.is_file() and not path.is_symlink(), f'missing package file {name}')
    if ERRORS:
        raise ValueError('OpenAI package check failed:\n' + '\n'.join(ERRORS))
    if check_only:
        return None, version, files
    out = out or root / 'artifacts' / f'vpsnet-plugin-openai-{version}.zip'
    out.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(out, 'w', ZIP_DEFLATED) as archive:
        for name in sorted(files):
            info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.external_attr = 0o644 << 16
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, (package / name).read_bytes())
    return out, version, files


if __name__ == '__main__':
    try:
        path, version, files = build_openai_zip(check_only='--check' in sys.argv)
    except ValueError as error:
        print(error, file=sys.stderr)
        sys.exit(1)
    print(json.dumps({'version': version, 'files': files, 'pass': True}) if path is None else path)
