#!/usr/bin/env python3
"""Explicit read-only check; never installs, executes, reconnects or changes consent."""
import argparse
import json
from pathlib import Path
from update_status import MAX_FEED_BYTES, decode, fetch_feed, status, version

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--client', default='generic')
plugin = parser.add_mutually_exclusive_group()
plugin.add_argument('--plugin-version')
plugin.add_argument('--plugin-manifest', type=Path, help='Explicit local VPSnet plugin manifest to read')
local = parser.add_mutually_exclusive_group()
local.add_argument('--local-mcp-version')
local.add_argument('--local-mcp-manifest', type=Path, help='Explicit local vpsnet-mcp package.json to read')
parser.add_argument('--server-version', help='Optional caller-reported gateway version, not an installed plugin version')
args = parser.parse_args()
sources = {}
for component, path, expected_name in [('plugin', args.plugin_manifest, 'vpsnet'), ('local_mcp', args.local_mcp_manifest, 'vpsnet-mcp')]:
    if path is not None:
        value = None
        try:
            with path.open('rb') as file:
                manifest = decode(file.read(MAX_FEED_BYTES + 1))
            if manifest.get('name') == expected_name:
                version(manifest.get('version'))
                value = manifest['version']
                sources[component] = 'local_manifest'
        except Exception:
            pass
        if component == 'plugin': args.plugin_version = value
        else: args.local_mcp_version = value
try:
    feed, reason = fetch_feed(), None
except Exception:
    # A remote error may carry untrusted response text or URLs. Do not echo it.
    feed, reason = None, 'Published release information is unavailable or invalid; installed software is unchanged.'
print(json.dumps(status(args.client, args.plugin_version, args.local_mcp_version, args.server_version, feed, reason, sources), indent=2))
