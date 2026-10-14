"""Exercise archive boundaries, relocatable resources and provider isolation."""
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from sync_gemini_skills import sync_skills
from sync_standalone_skills import SKILLS, snapshot as standalone_snapshot, sync_skills as sync_standalone, validate_links
spec = importlib.util.spec_from_file_location('package_distribution', ROOT / 'scripts/package-distribution.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DistributionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ('plugin', 'skills', '.claude-plugin', 'distribution/clients', 'distribution/standalone-skills'):
            shutil.copytree(ROOT / name, self.root / name)
        for name in ('gemini-extension.json', 'server.json'):
            shutil.copy2(ROOT / name, self.root / name)

    def change(self, path, mutation):
        file = self.root / path
        data = json.loads(file.read_text())
        mutation(data)
        file.write_text(json.dumps(data))

    def test_sidecar_symlinks_refused_before_any_archive_or_write(self):
        for name in ('kiro.mcp.json', 'server.json', 'release-manifest.json'):
            with self.subTest(name=name):
                output = self.root / ('output-' + name)
                output.mkdir()
                outside = self.root / ('sentinel-' + name)
                outside.write_bytes(b'UNCHANGED OUTSIDE OUTPUT')
                (output / name).symlink_to(outside)
                with self.assertRaisesRegex(ValueError, 'Symlink in distribution output'):
                    module.build(self.root, output)
                self.assertEqual(outside.read_bytes(), b'UNCHANGED OUTSIDE OUTPUT')
                self.assertEqual([p.name for p in output.iterdir()], [name])

    def test_complete_reproducible_packages_exclude_unlisted_files(self):
        (self.root / '.env').write_text('EXAMPLE_NOT_A_CREDENTIAL=never-package-this')
        (self.root / 'plugin/private-notes.md').write_text('Never package arbitrary extra files')
        folder, first = module.build(self.root)
        _, second = module.build(self.root, self.root / 'second-build')
        self.assertEqual(first['artifacts'], second['artifacts'])
        self.assertFalse(first['published'])
        self.assertEqual(len(first['artifacts']), 9)
        for record in first['artifacts']:
            with ZipFile(folder / record['file']) as archive:
                names = archive.namelist()
                self.assertNotIn('private-notes.md', names)
                self.assertNotIn('.env', names)
                if record['format'] == 'agent-skill':
                    self.assertEqual(set(names), set(SKILLS[record['skill']]))
                    self.assertIn('SKILL.md', names)
                    validate_links({name: archive.read(name) for name in names})
                    continue
                self.assertIn('skills/vpsnet-deploy/SKILL.md', names)
                self.assertIn('LICENSE', names)
                if record['format'] == 'agent-plugins':
                    mcp = json.loads(archive.read('mcp.json'))
                    self.assertEqual(set(mcp['mcpServers']['vpsnet']), {'type', 'url'})
                    self.assertNotIn('extensions', json.loads(archive.read('plugin.json')))
                elif record['format'] == 'openai-claude':
                    auth = json.loads(archive.read('mcp.json'))['mcpServers']['vpsnet']['extensions']['com.openai']['auth']
                    self.assertEqual(auth['baseScopes'], ['services:read'])
                elif record['format'] == 'gemini-cli-extension':
                    gemini = json.loads(archive.read('gemini-extension.json'))
                    self.assertEqual(gemini['contextFileName'], 'GEMINI.md')
                    self.assertIn(gemini['contextFileName'], names)

    def test_mismatched_native_version(self):
        self.change('gemini-extension.json', lambda d: d.update(version='99.0.0'))
        with self.assertRaisesRegex(ValueError, 'version differs'):
            module.build(self.root)

    def test_git_install_skills_match_canonical_release_skills(self):
        folder, manifest = module.build(self.root)
        record = next(item for item in manifest['artifacts'] if item['format'] == 'gemini-cli-extension')
        with ZipFile(folder / record['file']) as archive:
            for name in module.SKILL_FILES:
                self.assertEqual((self.root / name).read_bytes(), archive.read(name))

    def test_single_skill_imports_preserve_canonical_content_and_dependencies(self):
        folder, manifest = module.build(self.root)
        records = [record for record in manifest['artifacts'] if record['format'] == 'agent-skill']
        self.assertEqual({record['skill'] for record in records}, set(SKILLS))
        execution = (self.root / 'plugin/skills/vpsnet-operations/references/execution.md').read_bytes()
        for record in records:
            name = record['skill']
            canonical = (self.root / f'plugin/skills/{name}/SKILL.md').read_bytes()
            expected = canonical.replace(b'../vpsnet-operations/references/execution.md', b'references/execution.md')
            with ZipFile(folder / record['file']) as archive:
                self.assertEqual(archive.read('SKILL.md'), expected)
                self.assertEqual(archive.read('references/execution.md'), execution)
                for filename in archive.namelist():
                    self.assertEqual(archive.read(filename), (self.root / f'distribution/standalone-skills/{name}/{filename}').read_bytes())
                    self.assertEqual(archive.getinfo(filename).external_attr >> 16, 0o100644)
            if name == 'vpsnet-operations':
                with ZipFile(folder / record['file']) as archive:
                    self.assertEqual(archive.read('references/use-cases.md'), (self.root / 'plugin/skills/vpsnet-operations/references/use-cases.md').read_bytes())

    def test_single_skill_sources_ignore_unreviewed_extra_files(self):
        (self.root / 'plugin/skills/vpsnet-functions/private.txt').write_text('DO_NOT_INCLUDE')
        (self.root / 'plugin/skills/vpsnet-operations/references/unreviewed.md').write_text('DO_NOT_INCLUDE')
        entries = standalone_snapshot(self.root)
        self.assertEqual(set(entries['vpsnet-functions']), {'SKILL.md', 'references/execution.md'})
        self.assertEqual(set(entries['vpsnet-operations']), {'SKILL.md', 'references/execution.md', 'references/use-cases.md'})

    def test_single_skill_mirror_rejects_stale_and_extra_files(self):
        path = self.root / 'distribution/standalone-skills/vpsnet-functions/references/execution.md'
        path.write_text('Stale instructions')
        with self.assertRaisesRegex(ValueError, 'Standalone skills mirror differs'):
            module.build(self.root)
        sync_standalone(self.root)
        (self.root / 'distribution/standalone-skills/extra.env').write_text('DO_NOT_INCLUDE')
        with self.assertRaisesRegex(ValueError, 'Standalone skills mirror differs'):
            module.build(self.root)

    def test_single_skill_mirror_rejects_symlink_files_and_directories(self):
        path = self.root / 'distribution/standalone-skills/vpsnet-functions/references/execution.md'
        path.unlink()
        path.symlink_to(self.root / 'plugin/skills/vpsnet-operations/references/execution.md')
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            module.build(self.root)
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            sync_standalone(self.root)
        path.unlink()
        shutil.rmtree(self.root / 'distribution/standalone-skills')
        (self.root / 'distribution/standalone-skills').symlink_to(self.root / 'skills', target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            module.build(self.root)

    def test_single_skill_source_symlinks_and_nonpublic_content_rejected(self):
        path = self.root / 'plugin/skills/vpsnet-operations/references/execution.md'
        path.unlink()
        path.symlink_to(self.root / 'skills/vpsnet-operations/references/execution.md')
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            standalone_snapshot(self.root)
        path.unlink()
        path.write_text('-----BEGIN PRIVATE KEY-----\nDO_NOT_PACKAGE')
        with self.assertRaisesRegex(ValueError, 'Non-public content'):
            standalone_snapshot(self.root)

    def test_single_skill_unknown_reference_never_includes_extra_source(self):
        path = self.root / 'plugin/skills/vpsnet-functions/SKILL.md'
        path.write_text(path.read_text() + '\nRead [extra](references/unreviewed.md).\n')
        (path.parent / 'references').mkdir()
        (path.parent / 'references/unreviewed.md').write_text('Not reviewed for distribution')
        with self.assertRaisesRegex(ValueError, 'Missing standalone skill reference'):
            standalone_snapshot(self.root)

    def test_single_skill_links_cannot_escape_or_depend_on_repository(self):
        for target in ('../outside.md', '/outside.md', '%2e%2e/outside.md', 'file:///outside.md', '//outside.invalid/file', 'references\\outside.md', 'missing.md', '../vpsnet-operations/references/execution.md'):
            with self.subTest(target=target), self.assertRaises(ValueError):
                validate_links({'SKILL.md': f'Read [details]({target}).'.encode()})
        for text in ('[guide][ref]\n\n[ref]: ../outside.md', '<a href="../outside.md">details</a>', '![image](../outside.png)'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                validate_links({'SKILL.md': text.encode()})
        validate_links({'SKILL.md': b'[local](references/execution.md#oauth-reconnect) [web](https://www.vpsnet.com/) [heading](#details)', 'references/execution.md': b'# OAuth reconnect'})

    def test_single_skill_asset_names_follow_current_plugin_version(self):
        for filename in ('plugin/plugin.json', 'plugin/.claude-plugin/plugin.json', 'plugin/.cursor-plugin/plugin.json', 'gemini-extension.json', 'distribution/clients/kimi-code/kimi.plugin.json', 'server.json'):
            self.change(filename, lambda d: d.update(version='8.9.10'))
        self.change('.claude-plugin/marketplace.json', lambda d: d['plugins'][0].update(version='8.9.10'))
        _, manifest = module.build(self.root)
        for record in manifest['artifacts']:
            if record['format'] == 'agent-skill':
                self.assertEqual(record['file'], record['skill'] + '-8.9.10.zip')
                self.assertEqual(record['version'], '8.9.10')

    def test_archive_output_cannot_follow_existing_symlink(self):
        output = self.root / 'output'
        output.mkdir()
        outside = self.root / 'outside.txt'
        outside.write_text('Untouched')
        (output / 'example.zip').symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'Symlink in archive output'):
            module.archive(output, 'example.zip', {'SKILL.md': b'Example'})
        self.assertEqual(outside.read_text(), 'Untouched')
        with self.assertRaisesRegex(ValueError, 'Invalid archive filename'):
            module.archive(output, '../outside.zip', {'SKILL.md': b'Example'})

    def test_git_install_rejects_stale_or_extra_skills(self):
        path = self.root / 'skills/vpsnet-deploy/SKILL.md'
        path.write_text(path.read_text() + '\nStale generated content.\n')
        with self.assertRaisesRegex(ValueError, 'Gemini skills mirror differs'):
            module.build(self.root)
        sync_skills(self.root)
        (self.root / 'skills/extra.md').write_text('Not selected for publication')
        with self.assertRaisesRegex(ValueError, 'Gemini skills mirror differs'):
            module.build(self.root)

    def test_git_install_rejects_symlinked_mirror(self):
        shutil.rmtree(self.root / 'skills')
        (self.root / 'skills').symlink_to(self.root / 'plugin/skills', target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'must not be a symlink'):
            module.build(self.root)

    def test_native_nested_credentials(self):
        self.change('gemini-extension.json', lambda d: d['mcpServers']['vpsnet'].update(oauth={'clientSecret': 'example-test-value'}))
        with self.assertRaisesRegex(ValueError, 'Embedded credentials'):
            module.build(self.root)

    def test_missing_native_reference(self):
        self.change('plugin/.cursor-plugin/plugin.json', lambda d: d.update(logo='assets/missing.png'))
        with self.assertRaisesRegex(ValueError, 'Missing referenced bundle file'):
            module.build(self.root)

    def test_context_cannot_escape_source_root(self):
        self.change('gemini-extension.json', lambda d: d.update(contextFileName='../outside.md'))
        with self.assertRaisesRegex(ValueError, 'Invalid source path'):
            module.build(self.root)

    def test_directory_symlink_rejected(self):
        path = self.root / 'distribution/clients/gemini-cli'
        shutil.move(path, self.root / 'external-context')
        path.symlink_to(self.root / 'external-context', target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'Symlink in public source'):
            module.build(self.root)

    def test_kiro_scope_cannot_silently_expand(self):
        self.change('distribution/clients/kiro/kiro.mcp.json', lambda d: d['mcpServers']['vpsnet']['oauth'].update(oauthScopes=['services:read', 'vm:exec']))
        with self.assertRaisesRegex(ValueError, 'Kiro scope configuration differs'):
            module.build(self.root)

    def test_directory_skill_cannot_reintroduce_purchase_workflow(self):
        path = self.root / 'plugin/skills/vpsnet-operations/SKILL.md'
        path.write_text(path.read_text() + '\nCall quote_service_order before confirmation.\n')
        with self.assertRaisesRegex(ValueError, 'Purchase workflow in directory package'):
            module.build(self.root)

    def test_directory_reference_cannot_include_private_environment(self):
        path = self.root / 'plugin/skills/vpsnet-operations/references/execution.md'
        path.write_text(path.read_text() + '\nExample: https://api.staging.invalid/mcp\n')
        with self.assertRaisesRegex(ValueError, 'Non-public content'):
            module.build(self.root)

    def test_native_client_context_cannot_reintroduce_purchase_workflow(self):
        path = self.root / 'distribution/clients/gemini-cli/GEMINI.md'
        path.write_text(path.read_text() + '\nCall quote_service_order before confirmation.\n')
        with self.assertRaisesRegex(ValueError, 'Purchase workflow in directory package'):
            module.build(self.root)


if __name__ == '__main__':
    unittest.main()
