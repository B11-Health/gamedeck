import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8').replace(/\r\n/g, '\n');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function jobBlock(name, nextName = '') {
  const startMarker = `  ${name}:\n`;
  const start = workflow.indexOf(startMarker);
  assert.notEqual(start, -1, `${name} job is missing`);
  if (!nextName) return workflow.slice(start);
  const end = workflow.indexOf(`  ${nextName}:\n`, start + startMarker.length);
  assert.notEqual(end, -1, `${nextName} job boundary is missing`);
  return workflow.slice(start, end);
}

const jobsStart = workflow.indexOf('\njobs:\n');
assert.notEqual(jobsStart, -1, 'jobs section is missing');
const workflowHeader = workflow.slice(0, jobsStart);
const build = jobBlock('build', 'release');
const release = jobBlock('release');

assert.match(workflowHeader, /\npermissions:\n  contents: read\n/, 'workflow default must be contents: read');
assert.doesNotMatch(workflowHeader, /contents: write/, 'workflow-level write permission is forbidden');
assert.doesNotMatch(build, /GH_TOKEN|github\.token|secrets\.GITHUB_TOKEN/, 'build job must not receive a GitHub write token');
assert.doesNotMatch(build, /\n    permissions:\n(?:      .+\n)*      contents: write\n/, 'build job must not grant contents: write');
assert.match(release, /\n    permissions:\n      contents: write\n/, 'release job must explicitly grant contents: write');
assert.match(release, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/, 'release publisher must receive the scoped GitHub token');
assert.match(release, /gh release create/, 'release job must be the only publishing path');

for (const name of ['dist:win', 'dist:mac', 'dist:linux']) {
  assert.match(String(pkg.scripts?.[name] || ''), /--publish never/, `${name} must not publish from a build job`);
}

console.log('Release workflow least-privilege test passed.');
