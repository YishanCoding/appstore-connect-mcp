#!/usr/bin/env python3
"""Trim Apple's App Store Connect OpenAPI spec into the per-path facts the CLI tests' mock enforces.

Usage:
  curl -sSL -o /tmp/spec.zip https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip
  unzip -o -q /tmp/spec.zip -d /tmp/asc-spec
  python3 scripts/apple-spec-paths.py /tmp/asc-spec/openapi.oas.json > src/cli/test-support/apple-openapi-paths.json
"""
import json
import sys

spec = json.load(open(sys.argv[1]))
paths = {}
for path, item in sorted(spec['paths'].items()):
    if not path.startswith('/v1/'):
        continue
    entry = {'methods': sorted(m.upper() for m in item if m in ('get', 'post', 'patch', 'delete'))}
    get = item.get('get')
    if get:
        params = [p for p in get.get('parameters', []) if isinstance(p, dict)]
        include = [p for p in params if p.get('name') == 'include']
        if include:
            entry['include'] = include[0]['schema']['items']['enum']
        filters = [p['name'][len('filter['):-1] for p in params if p.get('name', '').startswith('filter[')]
        if filters:
            entry['filter'] = filters
    paths[path[len('/v1'):]] = entry
json.dump({'specVersion': spec['info']['version'], 'paths': paths}, sys.stdout, indent=0, separators=(',', ':'))
sys.stdout.write('\n')
