"""Read-only release comparison. Remote data is never an instruction or command."""
import datetime
import json
import re
import urllib.request
from pathlib import Path

FEED_URL = 'https://raw.githubusercontent.com/bacarrdy/vpsnet-mcp/main/distribution/releases/published.json'
MAX_FEED_BYTES = 65536
TIMEOUT_SECONDS = 5
VERSION = re.compile(r'^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')
COMMIT = re.compile(r'^[0-9a-f]{40}$')
DIGEST = re.compile(r'^[0-9a-f]{64}$')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def version(value):
    require(isinstance(value, str) and len(value) < 64 and VERSION.fullmatch(value), 'Invalid stable version')
    return tuple(map(int, value.split('.')))


def pairs(items):
    value = {}
    for key, item in items:
        require(key not in value, 'Duplicate JSON key')
        value[key] = item
    return value


def decode(raw):
    require(len(raw) <= MAX_FEED_BYTES, 'Release feed too large')
    return json.loads(raw, object_pairs_hook=pairs)


def timestamp(value):
    require(isinstance(value, str) and len(value) <= 40, 'Invalid verification time')
    parsed = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(parsed.tzinfo is not None, 'Verification time needs timezone')


def artifact_url(component, number):
    version(number)
    if component == 'plugin':
        return f'https://github.com/bacarrdy/vpsnet-mcp/releases/download/plugin-{number}/vpsnet-plugin-{number}.zip'
    require(component == 'mcp', 'Unknown component')
    return f'https://registry.npmjs.org/vpsnet-mcp/-/vpsnet-mcp-{number}.tgz'


def validate_feed(value):
    require(isinstance(value, dict) and set(value) == {'schema_version', 'plugin', 'mcp'}, 'Invalid release feed fields')
    require(type(value['schema_version']) is int and value['schema_version'] == 1, 'Unsupported release feed schema')
    for component in ('plugin', 'mcp'):
        entry = value[component]
        keys = {'version', 'source_commit', 'verified_at', 'url', 'sha256'}
        keys |= {'ci_run', 'ci_conclusion'}
        require(isinstance(entry, dict) and set(entry) == keys, 'Invalid published component fields')
        version(entry['version'])
        require(isinstance(entry['source_commit'], str) and COMMIT.fullmatch(entry['source_commit']), 'Invalid source commit')
        require(isinstance(entry['sha256'], str) and DIGEST.fullmatch(entry['sha256']), 'Invalid SHA256')
        require(entry['url'] == artifact_url(component, entry['version']), 'Unexpected artifact URL')
        timestamp(entry['verified_at'])
        require(type(entry['ci_run']) is int and entry['ci_run'] > 0 and entry['ci_conclusion'] == 'success', 'Missing successful CI receipt')
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Release feed redirects are not allowed')


def fetch_feed():
    opener = urllib.request.build_opener(NoRedirect())
    request = urllib.request.Request(FEED_URL, headers={'Accept': 'application/json', 'User-Agent': 'vpsnet-release-check/1'})
    with opener.open(request, timeout=TIMEOUT_SECONDS) as response:
        require(response.status == 200, 'Release feed unavailable')
        raw = response.read(MAX_FEED_BYTES + 1)
    return validate_feed(decode(raw))


def observed(value, source='caller_reported'):
    if value is not None:
        try:
            version(value)
            require(source in ('caller_reported', 'local_manifest', 'runtime'), 'Invalid version evidence')
            return {'version': value, 'source': source}
        except ValueError:
            pass
    return {'version': None, 'source': 'unknown'}


def status(client, plugin_version=None, local_mcp_version=None, server_version=None, feed=None, reason=None, sources=None):
    sources = sources or {}
    observations = {'plugin': observed(plugin_version, sources.get('plugin', 'caller_reported')),
                    'local_mcp': observed(local_mcp_version, sources.get('local_mcp', 'caller_reported')),
                    'server': observed(server_version, sources.get('server', 'caller_reported'))}
    published = None
    available = dict.fromkeys(observations)
    if feed is not None:
        feed = validate_feed(feed)
        published = {key: feed[key] for key in ('plugin', 'mcp')}
        for key, observation in observations.items():
            if observation['version'] is not None:
                target = published['plugin' if key == 'plugin' else 'mcp']['version']
                available[key] = version(observation['version']) < version(target)
    instructions = json.loads((Path(__file__).parent / 'update-clients.json').read_text()).get(client)
    return {'schema_version': 1, 'client': client,
            'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'published': published, 'observed': observations, 'update_available': available,
            'compatibility': {'status': 'unknown', 'reason': 'No version-specific acceptance evidence is supplied by this checker.'},
            'distribution_status': {'source_release_published': True if feed is not None else None,
                                    'npm_package_published': True if feed is not None else None,
                                    'remote_deployment_status': 'unknown',
                                    'official_registry': {'status': 'unknown', 'version': None, 'checked_at': None},
                                    'downstream_catalogs': {}},
            'instructions': instructions, 'server_update': 'The hosted gateway is maintained by VPSnet. Updating a local npm package does not update it.',
            'advisory': True, 'reason': reason}
