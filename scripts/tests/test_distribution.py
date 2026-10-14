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
spec = importlib.util.spec_from_file_location('package_distribution', ROOT / 'scripts/package-distribution.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DistributionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ('plugin', 'skills', '.claude-plugin', 'distribution/clients'):
            shutil.copytree(ROOT / name, self.root / name)
        for name in ('gemini-extension.json', 'server.json'):
            shutil.copy2(ROOT / name, self.root / name)

    def change(self, path, mutation):
        file = self.root / path
        data = json.loads(file.read_text())
        mutation(data)
        file.write_text(json.dumps(data))

    def test_complete_reproducible_packages_exclude_unlisted_files(self):
        (self.root / '.env').write_text('EXAMPLE_NOT_A_CREDENTIAL=never-package-this')
        (self.root / 'plugin/private-notes.md').write_text('Never package arbitrary extra files')
        folder, first = module.build(self.root)
        _, second = module.build(self.root, self.root / 'second-build')
        self.assertEqual(first['artifacts'], second['artifacts'])
        self.assertFalse(first['published'])
        self.assertEqual(len(first['artifacts']), 5)
        for record in first['artifacts']:
            with ZipFile(folder / record['file']) as archive:
                names = archive.namelist()
                self.assertNotIn('private-notes.md', names)
                self.assertNotIn('.env', names)
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
