#!/usr/bin/env python3
"""Regenerate test/fixtures/backend-spec-routes.json from a backend checkout's spec/*.yml.

Usage: python3 scripts/sync-backend-spec-routes.py /path/to/vpsnet_backend [commit]

Only the customer networking routes are kept, with the API-key scopes, access level and query
parameters the backend spec declares. The fixture lets test/backend-spec-routes.test.mjs fail
when a registered tool names a route, query parameter or scope the backend spec does not have.
"""
import glob
import json
import re
import subprocess
import sys
from pathlib import Path

import yaml

root = Path(sys.argv[1])
commit = sys.argv[2] if len(sys.argv) > 2 else subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
docs = {Path(f).name: yaml.safe_load(open(f)) for f in sorted(glob.glob(str(root / 'spec' / '*.yml')))}


def resolve(ref, current):
    file, _, pointer = ref.partition('#')
    node = docs[Path(file).name] if file else docs[current]
    for part in pointer.lstrip('/').split('/'):
        node = node[part.replace('~1', '/').replace('~0', '~')]
    return node


routes = {}
for name, doc in docs.items():
    for path, item in (doc.get('paths') or {}).items():
        home = name
        if isinstance(item, dict) and '$ref' in item:
            home = Path(item['$ref'].partition('#')[0]).name or name
            item = resolve(item['$ref'], name)
        if not path.startswith('/account/networking') or not isinstance(item, dict):
            continue
        shared = item.get('parameters', [])
        for method, op in item.items():
            if method not in ('get', 'post', 'put', 'delete', 'patch') or not isinstance(op, dict):
                continue
            query = []
            for param in shared + op.get('parameters', []):
                if isinstance(param, dict) and '$ref' in param:
                    param = resolve(param['$ref'], home)
                if isinstance(param, dict) and param.get('in') == 'query':
                    query.append(param['name'])
            key = method.upper() + ' ' + re.sub(r'\{[^}]+\}', '{}', path)
            routes[key] = {'scopes': op.get('x-api-key-scopes') or [], 'access': op.get('x-api-key-access') or [],
                           'query': sorted(set(query))}
out = Path(__file__).resolve().parents[1] / 'test/fixtures/backend-spec-routes.json'
out.write_text(json.dumps({'backend_commit': commit, 'routes': dict(sorted(routes.items()))}, indent=1) + '\n')
print(f'{len(routes)} networking routes from backend {commit[:9]}')
