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


def resolve(node):
    while isinstance(node, dict) and '$ref' in node:
        node = spec['components']['schemas'][node['$ref'].split('/')[-1]]
    return node


def required_relationships(op):
    """Relationship names a POST body must carry, per the request schema's `required` lists."""
    body = resolve(op.get('requestBody', {}).get('content', {}).get('application/json', {}).get('schema'))
    data = resolve((body or {}).get('properties', {}).get('data'))
    if not isinstance(data, dict) or 'relationships' not in data.get('required', []):
        return []
    rels = resolve(data['properties']['relationships'])
    return sorted(rels.get('required', []))


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
    post = item.get('post')
    if post:
        rels = required_relationships(post)
        if rels:
            entry['relationships'] = rels
    paths[path[len('/v1'):]] = entry
json.dump({'specVersion': spec['info']['version'], 'paths': paths}, sys.stdout, indent=0, separators=(',', ':'))
sys.stdout.write('\n')
