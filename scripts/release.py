#!/usr/bin/env python3
"""Plan, prepare, validate and build independent releases. No publication or deployment."""
import argparse
import hashlib
import io
import json
import re
import subprocess
import tarfile
import urllib.request
from pathlib import Path
from zipfile import ZipFile

from update_status import artifact_url, decode, require, validate_feed, version
from validate_plugin import validate_package

ROOT = Path(__file__).resolve().parents[1]
MANIFESTS = (
    'plugin/plugin.json', 'plugin/.claude-plugin/plugin.json',
    'plugin/.cursor-plugin/plugin.json', '.claude-plugin/marketplace.json',
    'gemini-extension.json', 'distribution/clients/kimi-code/kimi.plugin.json', 'server.json',
)


def read(path):
    require(not path.is_symlink(), 'Release input cannot be a symlink')
    return json.loads(path.read_text())


def config(root):
    data = read(root / 'release-config.json')
    require(set(data) == {'schema_version', 'plugin_version', 'mcp_version'} and type(data['schema_version']) is int and data['schema_version'] == 1, 'Invalid release config')
    version(data['plugin_version'])
    version(data['mcp_version'])
    return data


def manifest_version(data, name):
    return data['plugins'][0]['version'] if name == '.claude-plugin/marketplace.json' else data['version']


def validate_versions(root):
    data = config(root)
    for name in MANIFESTS:
        require(manifest_version(read(root / name), name) == data['plugin_version'], 'Plugin version differs: ' + name)
    package, lock = read(root / 'package.json'), read(root / 'package-lock.json')
    require(package['version'] == lock['version'] == lock['packages']['']['version'] == data['mcp_version'], 'MCP package/lock versions differ')
    return data


def plan(root, component, target=None):
    data = validate_versions(root)
    current = data['plugin_version' if component == 'plugin' else 'mcp_version']
    if target is not None:
        require(version(target) > version(current), 'A prepared release must increase the selected component version')
    paths = list(MANIFESTS) if component == 'plugin' else ['package.json', 'package-lock.json']
    return {'component': component, 'current_version': current, 'target_version': target,
            'files': ['release-config.json', *paths], 'publishes': False, 'deploys': False,
            'other_component_unchanged': True}


def prepare(root, component, target):
    result = plan(root, component, target)
    old = result['current_version']
    paths = result['files'][1:]
    replacements = {}
    for name in paths:
        path = root / name
        raw = path.read_text()
        pattern = r'("version"\s*:\s*")' + re.escape(old) + r'(")'
        expected = 2 if name == 'package-lock.json' else 1
        updated, count = re.subn(pattern, lambda m: m[1] + target + m[2], raw)
        require(count == expected, 'Unexpected version layout: ' + name)
        replacements[path] = updated
    data = config(root)
    data['plugin_version' if component == 'plugin' else 'mcp_version'] = target
    replacements[root / 'release-config.json'] = json.dumps(data, indent=2) + '\n'
    for path, raw in replacements.items():
        path.write_text(raw)
    validate_versions(root)
    return result


def validate(root):
    data = validate_versions(root)
    validate_package(root / 'plugin')
    mirror = root / 'scripts/sync_gemini_skills.py'
    if mirror.is_file():
        subprocess.run(['python3', str(mirror), '--check'], cwd=root, check=True)
    validate_feed(decode((root / 'distribution/releases/published.json').read_bytes()))
    return {'valid': True, **data, 'publication_verified_by_this_command': False}


def build(root, component):
    data = validate(root)
    output = root / 'artifacts'
    output.mkdir(exist_ok=True)
    if component == 'plugin':
        subprocess.run(['python3', 'scripts/package-distribution.py'], cwd=root, check=True)
        manifest = read(output / ('distribution-' + data['plugin_version']) / 'release-manifest.json')
        return {'component': component, 'built': True, 'published': False, 'artifacts': manifest['artifacts']}
    subprocess.run(['npm', 'run', 'build'], cwd=root, check=True)
    result = subprocess.run(['npm', 'pack', '--ignore-scripts', '--json', '--pack-destination', str(output)], cwd=root, check=True, capture_output=True, text=True)
    record = json.loads(result.stdout)[0]
    path = output / record['filename']
    return {'component': component, 'built': True, 'published': False,
            'artifacts': [{'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size}]}


class ArtifactRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        from urllib.parse import urlsplit
        url = urlsplit(newurl)
        require(url.scheme == 'https' and url.hostname == 'release-assets.githubusercontent.com' and not url.username and not url.password, 'Unexpected artifact redirect')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url, limit=32 * 1024 * 1024):
    opener = urllib.request.build_opener(ArtifactRedirect())
    accept = 'application/vnd.github+json' if url.startswith('https://api.github.com/') else 'application/octet-stream'
    with opener.open(urllib.request.Request(url, headers={'Accept': accept, 'User-Agent': 'vpsnet-release-verify/1'}), timeout=20) as response:
        require(response.status == 200, 'Published artifact unavailable')
        raw = response.read(limit + 1)
    require(len(raw) <= limit, 'Published artifact too large')
    return raw


def verify_artifact(component, entry, raw):
    require(hashlib.sha256(raw).hexdigest() == entry['sha256'], 'Published artifact SHA256 differs')
    if component == 'plugin':
        with ZipFile(io.BytesIO(raw)) as archive:
            require(archive.testzip() is None, 'Invalid plugin ZIP')
            for name in ('plugin.json', '.claude-plugin/plugin.json'):
                require(json.loads(archive.read(name))['version'] == entry['version'], 'Published plugin manifest version differs')
    else:
        with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
            require(json.load(archive.extractfile('package/package.json'))['version'] == entry['version'], 'Published npm version differs')


def published_from_receipt(component, receipt, ci_run=None):
    require(receipt.get('sha256') and receipt.get('verified_at'), 'Missing verified receipt')
    if component == 'plugin':
        require(receipt.get('public_download_verified') is True and receipt.get('manifest_versions_verified') is True, 'Plugin receipt is not verified')
        number, commit = receipt['plugin_version'], receipt['source_commit']
        require(receipt['asset_url'] == artifact_url(component, number), 'Unexpected receipt URL')
        run = receipt['github_ci_run']
        require(receipt.get('github_ci_conclusion') == 'success', 'Plugin CI did not pass')
    else:
        require(receipt.get('exact_reviewed_artifact_match') is True, 'npm receipt is not verified')
        number, commit = receipt['version'], receipt['reviewed_source_commit']
        require(receipt.get('package') == 'vpsnet-mcp' and receipt['tarball_url'] == artifact_url(component, number), 'Unexpected npm receipt')
        run = ci_run
    return {'version': number, 'source_commit': commit, 'verified_at': receipt['verified_at'],
            'url': artifact_url(component, number), 'sha256': receipt['sha256'], 'ci_run': run, 'ci_conclusion': 'success'}


def record_published(root, component, receipt, ci_run=None):
    path = root / 'distribution/releases/published.json'
    feed = decode(path.read_bytes())
    previous = validate_feed(feed)[component]
    entry = published_from_receipt(component, receipt, ci_run)
    feed[component] = entry
    validate_feed(feed)
    require(version(entry['version']) >= version(previous['version']), 'Published feed cannot move backwards')
    if entry['version'] == previous['version']:
        require(all(entry[key] == previous[key] for key in ('source_commit', 'url', 'sha256', 'ci_run')), 'Published version identity is immutable')
    # Validate public artifact bytes and exact successful CI head before recording.
    verify_artifact(component, entry, download(entry['url']))
    ci = json.loads(download(f'https://api.github.com/repos/bacarrdy/vpsnet-mcp/actions/runs/{entry["ci_run"]}', 1024 * 1024))
    require(ci.get('head_sha') == entry['source_commit'] and ci.get('conclusion') == 'success'
            and ci.get('status') == 'completed' and ci.get('path') == '.github/workflows/test.yml', 'Published receipt contract CI head did not pass')
    path.write_text(json.dumps(feed, indent=2) + '\n')
    return {'component': component, 'published_bytes_verified': True, 'ci_head_verified': True, 'published_feed_updated': True, 'publishes': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('plan', 'prepare', 'build', 'record-published'):
        command = commands.add_parser(name)
        command.add_argument('--component', choices=['plugin', 'mcp'], required=True)
        if name in ('plan', 'prepare'):
            command.add_argument('--version', required=name == 'prepare')
        if name == 'record-published':
            command.add_argument('--receipt', required=True, type=Path)
            command.add_argument('--ci-run', type=int, help='Exact MCP CI run; validated against the receipt source commit')
    commands.add_parser('validate')
    args = parser.parse_args()
    if args.command == 'plan': result = plan(ROOT, args.component, args.version)
    elif args.command == 'prepare': result = prepare(ROOT, args.component, args.version)
    elif args.command == 'validate': result = validate(ROOT)
    elif args.command == 'build': result = build(ROOT, args.component)
    else: result = record_published(ROOT, args.component, read(args.receipt), args.ci_run)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
