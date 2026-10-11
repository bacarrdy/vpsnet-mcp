#!/usr/bin/env python3
"""Offline directory-package checks. Portal scans and live acceptance remain separate.

Limits checked against OpenAI submission-errors and Claude's plugin
pre-submission-checklist on 2026-10-11. No network or publisher credentials.
"""
import json
import re
import sys
import unicodedata
from pathlib import Path
from urllib.parse import urlsplit


def require(condition, message):
    if not condition:
        raise ValueError(message)


def text(value, limit, label, multiline=False):
    require(isinstance(value, str) and bool(value.strip()) and len(value) <= limit, label)
    require(not any(unicodedata.category(c) in ('Cc', 'Cf', 'Zl', 'Zp')
                    and not (multiline and c in '\n\r\t') for c in value), label + ': unsupported characters')


def https(value, label):
    text(value, 1024, label)
    url = urlsplit(value)
    require(url.scheme == 'https' and url.hostname and not url.username and not url.password, label)


def validate_package(package):
    files = list(package.rglob('*'))
    require(len(files) <= 512, 'Plugin exceeds Claude file limit')
    names = set()
    for file in files:
        require(not file.is_symlink(), 'Symlink: ' + str(file))
        name = file.relative_to(package).as_posix()
        require(name.lower() not in names, 'Case-colliding filename: ' + name)
        names.add(name.lower())
        require(not any(p.endswith((' ', '.')) or ':' in p or re.fullmatch(r'(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?', p, re.I)
                        or p in ('.DS_Store', 'Thumbs.db', 'desktop.ini', '__MACOSX') for p in file.relative_to(package).parts), 'Invalid filename: ' + name)
        if file.is_file():
            require(file.stat().st_size < (5 * 1024 * 1024 if file.suffix == '.png' else 256 * 1024), 'Oversized file: ' + name)
            if file.suffix != '.png':
                file.read_text()  # No opaque executable/archive content in this plugin.
    portable = json.loads((package / 'plugin.json').read_text())
    claude = json.loads((package / '.claude-plugin/plugin.json').read_text())
    for manifest in (portable, claude):
        require(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?', manifest['name']), 'Invalid plugin name')
        require(re.fullmatch(r'\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?', manifest['version']), 'Invalid version')
        require('hooks' not in manifest and 'apps' not in manifest, 'Public package must not contain hooks or app references')
    require(portable['version'] == claude['version'], 'Provider versions differ')
    readme = (package / 'README.md').read_text()
    require(len(re.sub(r'```.*?```', '', readme, flags=re.S).split()) >= 40, 'README needs at least 40 words')
    require((package / 'LICENSE').is_file(), 'LICENSE missing')
    interface = portable['extensions']['com.openai']['interface']
    for key, limit in [('displayName', 30), ('shortDescription', 30), ('developerName', 80)]:
        text(interface[key], limit, key)
    text(interface['longDescription'], 4000, 'longDescription', multiline=True)
    require(interface['category'] == 'Developer Tools', 'Review category for this plugin')
    for key in ('websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL'):
        https(interface[key], key)
    prompts = interface.get('defaultPrompt', [])
    if isinstance(prompts, str):
        prompts = [prompts]
    require(isinstance(prompts, list) and len(prompts) <= 3, 'At most three starter prompts')
    normalized = set()
    for prompt in prompts:
        text(prompt, 128, 'starter prompt')
        canonical = ' '.join(unicodedata.normalize('NFKC', prompt).split())
        require(canonical not in normalized and '@' not in prompt, 'Duplicate or @mention in starter prompt')
        normalized.add(canonical)
    capabilities = interface.get('capabilities', [])
    require(len(capabilities) <= 20, 'Too many capabilities')
    for capability in capabilities:
        text(capability, 120, 'capability')
    for key, background in [('brandColor', 1), ('brandColorDark', 0.01520851442291271)]:
        if key not in interface:
            continue
        color = interface[key]
        require(isinstance(color, str) and re.fullmatch('#[0-9a-fA-F]{6}', color), key)
        channels = [int(color[i:i+2], 16) / 255 for i in (1, 3, 5)]
        linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
        light = sum(a*b for a, b in zip(linear, [0.2126, 0.7152, 0.0722]))
        require((max(light, background) + 0.05) / (min(light, background) + 0.05) >= 2, key + ': contrast below 2:1')
    for key in ('composerIcon', 'logo'):
        path = interface[key]
        require(path.startswith('./') and '..' not in Path(path).parts, key + ': path')
        require((package / path).read_bytes().startswith(b'\x89PNG\r\n\x1a\n'), key + ': PNG')
    review = portable['extensions']['com.openai']['review']
    for kind, size in [('positive', 5), ('negative', 3)]:
        cases = review['test_cases'][kind]
        require(len(cases) == size, 'Review case count: ' + kind)
        for case in cases:
            for key in (['description', 'prompt', 'tools_triggered', 'expected_behavior'] if kind == 'positive' else ['description', 'prompt']):
                text(case[key], 4000, 'review.' + key, multiline=True)
    for key in ('test_credentials', 'reviewer_instructions'):
        require(key not in review, 'Private review field in public package: ' + key)
    for filename, transport in [('mcp.json', 'streamable-http'), ('.mcp.json', 'http')]:
        servers = json.loads((package / filename).read_text())['mcpServers']
        require(list(servers) == ['vpsnet'], 'Exactly one VPSnet MCP server is expected')
        server = servers['vpsnet']
        require(server['type'] == transport and server['url'] == 'https://mcp.vpsnet.com/mcp', 'Incorrect production MCP configuration')
        require('command' not in server and 'headers' not in server, 'No launchers or embedded credentials')
    return portable['version']


if __name__ == '__main__':
    package = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / 'plugin'
    print('Offline package validation passed:', validate_package(package))
    print('Pending separately: provider logins, production activation, portal validation, domain verification, reviewer access and demo video.')
