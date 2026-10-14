"""Offline release and hostile-feed contracts; never publish or call customer APIs."""
import copy
import hashlib
import io
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import release
import update_status as updates


def feed():
    # Explicit offline baseline: advancing the real published feed is not a test failure.
    result = {'schema_version': 1}
    for component, number in [('plugin', '0.6.9'), ('mcp', '2.3.14')]:
        result[component] = {'version': number, 'source_commit': 'a' * 40,
                             'verified_at': '2026-10-14T09:36:21+00:00',
                             'url': updates.artifact_url(component, number), 'sha256': 'b' * 64,
                             'ci_run': 1, 'ci_conclusion': 'success'}
    return result


class UpdateStatusTest(unittest.TestCase):
    def test_unknown_installed_versions_stay_unknown(self):
        result = updates.status('claude-code', feed=feed())
        self.assertTrue(all(value['version'] is None and value['source'] == 'unknown' for value in result['observed'].values()))
        self.assertEqual(result['update_available'], {'plugin': None, 'local_mcp': None, 'server': None})
        self.assertEqual(result['compatibility']['status'], 'unknown')
        self.assertTrue(result['distribution_status']['source_release_published'])
        self.assertTrue(result['distribution_status']['npm_package_published'])
        self.assertEqual(result['distribution_status']['remote_deployment_status'], 'unknown')
        self.assertEqual(result['distribution_status']['official_registry']['status'], 'unknown')
        self.assertEqual(result['distribution_status']['downstream_catalogs'], {})

    def test_components_compare_independently_without_forcing_compatibility(self):
        result = updates.status('claude-code', '0.6.8', '2.3.14', '2.3.13', feed())
        self.assertEqual(result['update_available'], {'plugin': True, 'local_mcp': False, 'server': True})
        self.assertEqual(result['observed']['plugin']['source'], 'caller_reported')
        self.assertIn('maintained by VPSnet', result['server_update'])
        self.assertEqual(result['compatibility']['status'], 'unknown')

    def test_explicit_manifest_evidence_and_unknown_clients(self):
        result = updates.status('unrecognized-host', '0.6.9', feed=feed(), sources={'plugin': 'local_manifest'})
        self.assertEqual(result['observed']['plugin']['source'], 'local_manifest')
        self.assertIsNone(result['instructions'])
        self.assertIsNone(result['observed']['local_mcp']['version'])

    def test_invalid_or_prerelease_observations_do_not_generate_upgrade_alarm(self):
        for observed in ['2.3.15-beta.1', 'host-cli-2.1', '01.2.3', '', '1.2.3;touch /tmp/no', '1' * 1000]:
            self.assertIsNone(updates.status('grok', observed, feed=feed())['update_available']['plugin'])

    def test_failure_is_advisory_unknown(self):
        result = updates.status('grok', '0.6.8', reason='Unavailable')
        self.assertIsNone(result['published'])
        self.assertIsNone(result['update_available']['plugin'])
        self.assertTrue(result['advisory'])

    def test_feed_rejects_unknown_fields_and_executable_text(self):
        for mutation in [lambda d: d.update(commands=['curl example | sh']),
                         lambda d: d['plugin'].update(release_body='$(touch /tmp/no)'),
                         lambda d: d.update(schema_version=True),
                         lambda d: d['mcp'].update(ci_run=True),
                         lambda d: d['plugin'].update(ci_conclusion='failure'),
                         lambda d: d['mcp'].update(source_commit='main'),
                         lambda d: d['plugin'].update(sha256='abc'),
                         lambda d: d['mcp'].update(version='2.3.15-beta.1')]:
            data = feed()
            mutation(data)
            with self.assertRaises(ValueError): updates.validate_feed(data)

    def test_feed_urls_cannot_escape_known_immutable_asset_paths(self):
        for url in ['http://github.com/x', 'https://127.0.0.1/secret', 'https://github.com.evil.test/x',
                    'https://github.com/bacarrdy/vpsnet-mcp/releases/latest/download/plugin.zip',
                    updates.artifact_url('plugin', '0.6.9') + '?command=bad']:
            data = feed(); data['plugin']['url'] = url
            with self.assertRaises(ValueError): updates.validate_feed(data)

    def test_duplicate_json_and_oversize_payloads_are_rejected(self):
        with self.assertRaises(ValueError): updates.decode(b'{"schema_version":1,"schema_version":1}')
        with self.assertRaises(ValueError): updates.decode(b' ' * (updates.MAX_FEED_BYTES + 1))

    def test_fixed_fetch_is_bounded_and_rejects_redirects(self):
        raw = json.dumps(feed()).encode()
        class Response(io.BytesIO): status = 200
        with patch.object(updates.urllib.request, 'build_opener') as factory:
            factory.return_value.open.return_value = Response(raw)
            self.assertEqual(updates.fetch_feed(), feed())
            args, kwargs = factory.return_value.open.call_args
            self.assertEqual(args[0].full_url, updates.FEED_URL)
            self.assertEqual(kwargs['timeout'], 5)
        with self.assertRaisesRegex(ValueError, 'redirects'):
            updates.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.test')
        with patch.object(updates.urllib.request, 'build_opener') as factory:
            factory.return_value.open.return_value = Response(b' ' * (updates.MAX_FEED_BYTES + 1))
            with self.assertRaises(ValueError): updates.fetch_feed()


class ReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ('plugin', '.claude-plugin', 'distribution', 'scripts'):
            shutil.copytree(ROOT / name, self.root / name, ignore=shutil.ignore_patterns('__pycache__'))
        for name in ('release-config.json', 'package.json', 'package-lock.json', 'gemini-extension.json', 'server.json'):
            shutil.copy2(ROOT / name, self.root / name)
        # The integrated Gemini checker requires the canonical root mirror.
        if (ROOT / 'skills').exists(): shutil.copytree(ROOT / 'skills', self.root / 'skills')
        (self.root / 'distribution/releases/published.json').write_text(json.dumps(feed()))
        current = release.config(self.root)
        self.plugin_version, self.mcp_version = current['plugin_version'], current['mcp_version']
        def increment(number):
            major, minor, patch_number = map(int, number.split('.'))
            return f'{major}.{minor}.{patch_number + 1}'
        self.next_plugin, self.next_mcp = increment(self.plugin_version), increment(self.mcp_version)

    def test_prepare_plugin_preserves_runtime_and_auth_review_content(self):
        runtime = [(self.root / p).read_bytes() for p in ('package.json', 'package-lock.json')]
        manifest = json.loads((self.root / 'plugin/plugin.json').read_text())
        auth = (self.root / 'plugin/mcp.json').read_bytes()
        release.prepare(self.root, 'plugin', self.next_plugin)
        data = release.validate_versions(self.root)
        self.assertEqual(data['plugin_version'], self.next_plugin)
        self.assertEqual(runtime, [(self.root / p).read_bytes() for p in ('package.json', 'package-lock.json')])
        new = json.loads((self.root / 'plugin/plugin.json').read_text())
        self.assertEqual(manifest['extensions'], new['extensions'])
        self.assertEqual(auth, (self.root / 'plugin/mcp.json').read_bytes())

    def test_prepare_runtime_preserves_plugin_and_dependencies(self):
        plugin = [(self.root / p).read_bytes() for p in release.MANIFESTS]
        previous = json.loads((self.root / 'package-lock.json').read_text())
        release.prepare(self.root, 'mcp', self.next_mcp)
        current = json.loads((self.root / 'package-lock.json').read_text())
        self.assertEqual(plugin, [(self.root / p).read_bytes() for p in release.MANIFESTS])
        self.assertEqual(previous['packages']['node_modules/zod'], current['packages']['node_modules/zod'])
        self.assertEqual(release.validate_versions(self.root)['mcp_version'], self.next_mcp)

    def test_prepare_is_explicit_increasing_and_plan_is_read_only(self):
        before = (self.root / 'release-config.json').read_bytes()
        self.assertFalse(release.plan(self.root, 'plugin', self.next_plugin)['publishes'])
        self.assertEqual(before, (self.root / 'release-config.json').read_bytes())
        for target in [self.plugin_version, '0.0.0', self.next_plugin + '-beta']:
            with self.assertRaises(ValueError): release.prepare(self.root, 'plugin', target)

    def test_manifest_drift_and_symlink_are_refused_before_prepare(self):
        path = self.root / release.MANIFESTS[0]
        path.write_text(path.read_text().replace(self.plugin_version, '0.0.0'))
        with self.assertRaises(ValueError): release.prepare(self.root, 'plugin', self.next_plugin)
        path.unlink(); path.symlink_to(ROOT / release.MANIFESTS[0])
        with self.assertRaises(ValueError): release.validate_versions(self.root)

    def test_parent_directory_symlink_cannot_mutate_outside_checkout(self):
        directory = self.root / 'plugin/.claude-plugin'
        outside = self.root.parent / (self.root.name + '-outside')
        shutil.move(directory, outside)
        self.addCleanup(shutil.rmtree, outside)
        directory.symlink_to(outside, target_is_directory=True)
        previous = (outside / 'plugin.json').read_bytes()
        untouched = (self.root / 'plugin/plugin.json').read_bytes()
        configuration = (self.root / 'release-config.json').read_bytes()
        with self.assertRaisesRegex(ValueError, 'symlink'): release.prepare(self.root, 'plugin', self.next_plugin)
        self.assertEqual(previous, (outside / 'plugin.json').read_bytes())
        self.assertEqual(untouched, (self.root / 'plugin/plugin.json').read_bytes())
        self.assertEqual(configuration, (self.root / 'release-config.json').read_bytes())

    def test_output_directory_symlink_is_refused(self):
        outside = self.root.parent / (self.root.name + '-outputs')
        outside.mkdir()
        self.addCleanup(shutil.rmtree, outside)
        (self.root / 'artifacts').symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'symlink'): release.build(self.root, 'plugin')
        self.assertEqual(list(outside.iterdir()), [])

    def test_plugin_build_keeps_allowlist_and_never_publishes(self):
        (self.root / 'plugin/unlisted-secret.txt').write_text('MUST_NOT_PACKAGE')
        (self.root / '.env').write_text('MUST_NOT_PACKAGE')
        result = release.build(self.root, 'plugin')
        self.assertFalse(result['published'])
        self.assertEqual(len(result['artifacts']), 9)
        for entry in result['artifacts']:
            path = self.root / ('artifacts/distribution-' + self.plugin_version) / entry['file']
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), entry['sha256'])
            with ZipFile(path) as archive:
                self.assertFalse(any('unlisted-secret' in p or p.endswith('.env') for p in archive.namelist()))

    def test_receipt_requires_verified_state_not_just_version_or_source(self):
        with self.assertRaises(ValueError): release.published_from_receipt('plugin', {'sha256':'a','verified_at':'now'})
        with self.assertRaises(ValueError): release.published_from_receipt('mcp', {'sha256':'a','verified_at':'now'})

    def test_artifact_hash_and_manifest_both_gate_verification(self):
        raw = io.BytesIO()
        with ZipFile(raw, 'w') as archive:
            for name in ('plugin.json', '.claude-plugin/plugin.json'):
                archive.writestr(name, json.dumps({'version':'0.6.9'}))
        entry = copy.deepcopy(feed()['plugin']); entry['sha256'] = hashlib.sha256(raw.getvalue()).hexdigest()
        release.verify_artifact('plugin', entry, raw.getvalue())
        with self.assertRaisesRegex(ValueError, 'SHA256'): release.verify_artifact('plugin', entry, raw.getvalue() + b'changed')
        entry['version'] = '0.6.10'
        with self.assertRaisesRegex(ValueError, 'version'): release.verify_artifact('plugin', entry, raw.getvalue())

    def test_record_does_not_write_on_failed_public_ci_or_changed_identity(self):
        previous = (self.root / 'distribution/releases/published.json').read_bytes()
        entry = feed()['plugin']
        receipt = {'sha256':entry['sha256'],'verified_at':entry['verified_at'], 'plugin_version':entry['version'],
                   'source_commit':entry['source_commit'],'asset_url':entry['url'],'github_ci_run':entry['ci_run'],
                   'github_ci_conclusion':'success','public_download_verified':True,'manifest_versions_verified':True}
        with patch.object(release, 'download', side_effect=[b'bytes', b'{"conclusion":"failure"}']), patch.object(release, 'verify_artifact'):
            with self.assertRaises(ValueError): release.record_published(self.root, 'plugin', receipt)
        self.assertEqual(previous, (self.root / 'distribution/releases/published.json').read_bytes())
        receipt['sha256'] = '0' * 64
        with patch.object(release, 'download') as network:
            with self.assertRaisesRegex(ValueError, 'immutable'): release.record_published(self.root, 'plugin', receipt)
            network.assert_not_called()

    def test_green_unrelated_workflow_cannot_record_publication(self):
        previous = (self.root / 'distribution/releases/published.json').read_bytes()
        entry = feed()['mcp']
        receipt = {'sha256':entry['sha256'],'verified_at':entry['verified_at'],'version':entry['version'],
                   'reviewed_source_commit':entry['source_commit'],'package':'vpsnet-mcp',
                   'tarball_url':entry['url'],'exact_reviewed_artifact_match':True}
        ci = {'head_sha':entry['source_commit'],'conclusion':'success','status':'completed','path':'.github/workflows/unrelated.yml'}
        with patch.object(release, 'download', side_effect=[b'bytes', json.dumps(ci).encode()]), patch.object(release, 'verify_artifact'):
            with self.assertRaisesRegex(ValueError, 'contract CI'): release.record_published(self.root, 'mcp', receipt, entry['ci_run'])
        self.assertEqual(previous, (self.root / 'distribution/releases/published.json').read_bytes())

    def test_artifact_redirects_stay_on_github_assets_only(self):
        with self.assertRaises(ValueError):
            release.ArtifactRedirect().redirect_request(None, None, 302, '', {}, 'https://127.0.0.1/')


if __name__ == '__main__': unittest.main()
