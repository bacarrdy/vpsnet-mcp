#!/usr/bin/env python3
"""Build native client bundles from shared, explicitly selected public sources.

No network, publisher credentials, account creation or submission is performed.
The resulting manifest records package validation, not live client acceptance.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from validate_plugin import require, validate_package, validate_directory_text
from sync_gemini_skills import SKILL_FILES, check_skills
from sync_standalone_skills import check_skills as check_standalone_skills, snapshot as standalone_skills

ENDPOINT = 'https://mcp.vpsnet.com/mcp'
SHARED = ('LICENSE', 'assets/icon.png') + SKILL_FILES
PORTABLE = SHARED + ('plugin.json', 'mcp.json', '.claude-plugin/plugin.json', '.mcp.json', 'README.md')


def encode(data):
    return (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode()


def source(root, relative):
    parts = PurePosixPath(relative).parts
    require(parts and '..' not in parts and not PurePosixPath(relative).is_absolute(), 'Invalid source path')
    path = root
    for part in parts:
        path = path / part
        require(not path.is_symlink(), 'Symlink in public source: ' + relative)
    require(path.is_file(), 'Missing public source: ' + relative)
    raw = path.read_bytes()
    if path.suffix != '.png':
        text = raw.decode('utf-8')
        validate_directory_text(text, relative)
        if path.suffix == '.json':
            json.loads(text)
    return raw


def json_source(root, relative):
    return json.loads(source(root, relative))


def remote_server(manifest, url_key='url'):
    servers = manifest.get('mcpServers', {})
    require(list(servers) == ['vpsnet'], 'Expected one VPSnet MCP connection')
    server = servers['vpsnet']
    require(server.get(url_key) == ENDPOINT, 'Incorrect public MCP endpoint')
    require(not any(k in server for k in ('headers', 'env', 'command', 'args', 'apiKey', 'token', 'clientSecret')), 'Embedded credentials or launcher in client configuration')
    def no_credentials(value):
        if isinstance(value, dict):
            for key, item in value.items():
                require(key.lower().replace('_', '') not in ('clientsecret', 'accesstoken', 'refreshtoken', 'authorization', 'apikey', 'password'), 'Embedded credentials in client configuration')
                no_credentials(item)
        elif isinstance(value, list):
            for item in value:
                no_credentials(item)
    no_credentials(server)
    return server


def versioned(data, version):
    require(data.get('name') == 'vpsnet' and data.get('version') == version, 'Client manifest version differs')


def reference(entries, path):
    require(isinstance(path, str), 'Expected a bundled path')
    name = path.removeprefix('./').rstrip('/')
    require(name and '..' not in PurePosixPath(name).parts and not PurePosixPath(name).is_absolute(), 'Invalid bundled path')
    require(name in entries or any(n.startswith(name + '/') for n in entries), 'Missing referenced bundle file: ' + name)


def archive(output, filename, entries):
    require(PurePosixPath(filename).name == filename and '\\' not in filename, 'Invalid archive filename')
    path = output / filename
    require(not any(parent.is_symlink() for parent in (path, *path.parents)), 'Symlink in archive output')
    with ZipFile(path, 'w', ZIP_DEFLATED) as zipped:
        for name, raw in sorted(entries.items()):
            require(not name.startswith('/') and '..' not in PurePosixPath(name).parts, 'Invalid archive path')
            info = ZipInfo(name, (2020, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = ZIP_DEFLATED
            zipped.writestr(info, raw)
    with ZipFile(path) as zipped:
        require(zipped.testzip() is None, 'Archive integrity failed')
    return {'file': filename, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size}


def build(root, output=None):
    version = validate_package(root / 'plugin')
    check_skills(root)
    check_standalone_skills(root)
    registry = json_source(root, 'server.json')
    require(registry['version'] == version, 'Registry version differs')
    require(registry['remotes'] == [{'type': 'streamable-http', 'url': ENDPOINT}], 'Registry endpoint differs')
    marketplace = json_source(root, '.claude-plugin/marketplace.json')
    require(marketplace['plugins'][0]['version'] == version, 'Claude marketplace version differs')
    output = output or root / 'artifacts' / ('distribution-' + version)
    require(not any(path.is_symlink() for path in (output, *output.parents)), 'Symlink in distribution output path')
    if output.exists():
        # Check all destinations before the first archive or sidecar is written.
        require(not any(path.is_symlink() for path in output.rglob('*')), 'Symlink in distribution output')
    output.mkdir(parents=True, exist_ok=True)
    shared = {name: source(root, 'plugin/' + name) for name in SHARED}
    records = []

    portable = {name: source(root, 'plugin/' + name) for name in PORTABLE}
    remote_server(json.loads(portable['mcp.json']))
    remote_server(json.loads(portable['.mcp.json']))
    records.append({**archive(output, f'vpsnet-plugin-{version}.zip', portable), 'format': 'openai-claude'})

    # OpenAI declares its authentication extension in mcp.json. The core Agent
    # Plugins schema does not allow that extension, so build a portable view.
    generic = dict(shared)
    manifest = json.loads(portable['plugin.json'])
    manifest.pop('extensions', None)
    generic['plugin.json'] = encode(manifest)
    generic['mcp.json'] = encode({'$schema': 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', 'mcpServers': {'vpsnet': {'type': 'streamable-http', 'url': ENDPOINT}}})
    generic['README.md'] = source(root, 'distribution/clients/kiro/README.md')
    records.append({**archive(output, f'vpsnet-agent-plugin-{version}.zip', generic), 'format': 'agent-plugins', 'acceptance': 'Kiro native OAuth scopes require client verification'})

    gemini = json_source(root, 'gemini-extension.json')
    versioned(gemini, version)
    remote_server(gemini, 'httpUrl')
    entries = dict(shared)
    entries['GEMINI.md'] = source(root, gemini['contextFileName'])
    gemini['contextFileName'] = 'GEMINI.md'
    entries['gemini-extension.json'] = encode(gemini)
    entries['README.md'] = source(root, 'distribution/clients/gemini-cli/README.md')
    reference(entries, gemini['contextFileName'])
    records.append({**archive(output, f'vpsnet-gemini-cli-{version}.zip', entries), 'format': 'gemini-cli-extension'})

    cursor = json_source(root, 'plugin/.cursor-plugin/plugin.json')
    versioned(cursor, version)
    cursor_mcp_path = cursor['mcpServers'].removeprefix('./')
    entries = dict(shared)
    entries['.cursor-plugin/plugin.json'] = encode(cursor)
    entries[cursor_mcp_path] = source(root, 'plugin/' + cursor_mcp_path)
    remote_server(json.loads(entries[cursor_mcp_path]))
    for prop in ('mcpServers', 'skills', 'logo'):
        reference(entries, cursor[prop])
    entries['README.md'] = source(root, 'distribution/clients/cursor/README.md')
    records.append({**archive(output, f'vpsnet-cursor-{version}.zip', entries), 'format': 'cursor-plugin', 'submission': 'Official marketplace reads the public Git repository, plugin path'})

    kimi = json_source(root, 'distribution/clients/kimi-code/kimi.plugin.json')
    versioned(kimi, version)
    remote_server(kimi)
    entries = dict(shared)
    entries['kimi.plugin.json'] = encode(kimi)
    entries['README.md'] = source(root, 'distribution/clients/kimi-code/README.md')
    reference(entries, kimi['skills'])
    records.append({**archive(output, f'vpsnet-kimi-code-{version}.zip', entries), 'format': 'kimi-code-plugin', 'submission': 'Kimi Work marketplace requires its Plugin Builder import and review'})

    for skill, entries in standalone_skills(root).items():
        records.append({**archive(output, f'{skill}-{version}.zip', entries),
                        'format': 'agent-skill', 'skill': skill, 'version': version,
                        'acceptance': 'Skill import and native MCP connection require separate client verification'})

    kiro = json_source(root, 'distribution/clients/kiro/kiro.mcp.json')
    server = remote_server(kiro)
    require(server.get('oauth', {}).get('oauthScopes') == ['services:read'], 'Kiro scope configuration differs')
    (output / 'kiro.mcp.json').write_bytes(encode(kiro))
    (output / 'server.json').write_bytes(encode(registry))
    result = {'plugin_version': version, 'endpoint': ENDPOINT, 'validation': 'offline-packaging-only', 'published': False, 'artifacts': records}
    (output / 'release-manifest.json').write_bytes(encode(result))
    return output, result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    destination, result = build(Path(__file__).resolve().parent.parent, args.output)
    print(destination)
    for record in result['artifacts']:
        print(record['file'], record['sha256'])
