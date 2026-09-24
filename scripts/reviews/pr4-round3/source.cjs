'use strict';
/** Pinned, read-only source extraction for the component review probes. */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const HEAD = 'b7bbbaf3bd5f0880733c96cbce106f1c66c81088';
function resolveHead() {
  const index = process.argv.indexOf('--head');
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return HEAD;
}
const ACTIVE_HEAD = resolveHead();
const BASE = '9a6c9e1fb3846855bd919116c01fb6abb4d0c240';
const files = {
  safety: 'src/cli/safety.ts',
  'write-functions': 'src/cli/write-call.ts',
  screenshots: 'src/mcp/tools/versions/screenshots.ts',
  pagination: 'src/programs/api-client/client.ts',
  'error-routing': 'src/cli/run.ts',
  mock: 'src/cli/test-support/apple-spec-mock.ts',
  policy: 'src/programs/api-client/policy.ts',
  'cpp-manager': 'src/programs/cpp/cpp-manager.ts',
  'main-client': 'src/programs/api-client/client.ts',
};

function extract(name, source, ts) {
  if (['policy', 'cpp-manager', 'main-client'].includes(name)) return source;
  const tree = ts.createSourceFile(files[name], source, ts.ScriptTarget.Latest, true);
  const findFunction = (label) => {
    const found = tree.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === label);
    assert.equal(found.length, 1, `Expected one function ${label}`);
    return found[0];
  };
  if (name === 'pagination') {
    const klass = tree.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === 'AppStoreConnectClient');
    assert.ok(klass, 'AppStoreConnectClient is missing');
    const methods = ['getAllPages', 'followPages'].map((label) => {
      const node = klass.members.find((member) => ts.isMethodDeclaration(member) && member.name.getText(tree) === label);
      assert.ok(node, `Missing pagination method ${label}`);
      return node.getText(tree);
    });
    return `export class PaginationProbe {\n${methods.join('\n')}\n}\n`;
  }
  if (name === 'error-routing') {
    const run = findFunction('runCli');
    const block = run.body.statements.find(ts.isTryStatement)?.catchClause?.block;
    assert.ok(block, 'runCli top-level catch is missing');
    return `export function routeError(error: unknown, toolName: string) ${block.getText(tree)}\n`;
  }
  const selections = {
    safety: {
      constants: ['USER_ID_TOOLS', 'REVIEW_TOOLS', 'VERSION_TOOLS', 'PHASED_TOOLS', 'EVENT_TOOLS', 'CANCEL_REVIEW_UNSUPPORTED', 'deny'],
      functions: ['id', 'relId', 'sameText', 'decideSafety', 'bindConfirm'],
      exports: ['decideSafety', 'bindConfirm', 'CANCEL_REVIEW_UNSUPPORTED'],
    },
    'write-functions': {
      functions: ['defined', 'enc', 'patchBody', 'createBody', 'read', 'write', 'plannedUploadStep', 'isNotFound', 'respondToReview', 'deleteReviewResponse', 'uploadScreenshots', 'createCpp', 'runBatch'],
      classes: ['PartialBatch'],
      exports: ['respondToReview', 'deleteReviewResponse', 'uploadScreenshots', 'createCpp', 'runBatch', 'PartialBatch'],
    },
    screenshots: {
      functions: ['md5File', 'assertReadableFiles', 'screenshotSetBody', 'reserveScreenshotBody', 'commitScreenshotBody', 'uploadScreenshot'],
      exports: ['assertReadableFiles', 'screenshotSetBody', 'reserveScreenshotBody', 'commitScreenshotBody', 'uploadScreenshot'],
    },
    mock: {
      constants: ['API'],
      functions: ['error', 'matchSpec', 'specViolation', 'appleTransport'],
      exports: ['matchSpec', 'specViolation', 'appleTransport'],
    },
  };
  const selection = selections[name];
  assert.ok(selection, `Unknown source selection ${name}`);
  const nodes = [];
  for (const label of selection.constants || []) {
    const matches = tree.statements.filter((node) => ts.isVariableStatement(node) &&
      node.declarationList.declarations.some((decl) => ts.isIdentifier(decl.name) && decl.name.text === label));
    assert.equal(matches.length, 1, `Expected one constant ${label}`);
    nodes.push(matches[0]);
  }
  const functionLabels = [...(selection.functions || [])];
  if (name === 'write-functions' && ACTIVE_HEAD === HEAD) {
    const extra = functionLabels.indexOf('plannedUploadStep');
    if (extra >= 0) functionLabels.splice(extra, 1);
  }
  for (const label of functionLabels) nodes.push(findFunction(label));
  for (const label of selection.classes || []) {
    const matches = tree.statements.filter((node) => ts.isClassDeclaration(node) && node.name?.text === label);
    assert.equal(matches.length, 1, `Expected one class ${label}`);
    nodes.push(matches[0]);
  }
  // Source text inside each declaration is preserved. Only export visibility changes.
  return nodes.map((node) => node.getText(tree).replace(/^export\s+/, '')).join('\n') +
    `\nexport { ${selection.exports.join(', ')} };\n`;
}

function readSource(name, ts) {
  assert.ok(Object.hasOwn(files, name), `Unknown source ${name}`);
  // Explicit historical snapshot mode, used in the credential-free review environment.
  // The snapshot directory is from the separately supplied original review archive.
  if (process.env.ASCLI_REVIEW_SNAPSHOT_DIR) {
    return fs.readFileSync(path.join(process.env.ASCLI_REVIEW_SNAPSHOT_DIR, name + '.ts'), 'utf8');
  }
  const repo = process.env.ASCLI_REVIEW_REPO || path.resolve(__dirname, '../../..');
  const ref = name === 'main-client' ? BASE : ACTIVE_HEAD;
  const source = cp.execFileSync('git', ['-C', repo, 'show', `${ref}:${files[name]}`], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  return extract(name, source, ts);
}
module.exports = { HEAD, BASE, ACTIVE_HEAD, readSource, extract };
