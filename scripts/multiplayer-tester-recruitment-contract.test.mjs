import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractPath = path.join(root, 'config', 'multiplayer-tester-recruitment.json');
const draftPath = path.join(root, 'marketing', 'MULTIPLAYER_TESTER_RECRUITMENT_DRAFT.md');
const issueTemplatePath = path.join(root, '.github', 'ISSUE_TEMPLATE', 'multiplayer_session.yml');
const packagePath = path.join(root, 'package.json');

const requiredDimensions = ['operatingSystem', 'networkRoute', 'controllerTopology', 'controllerFamily', 'regionBand', 'displayMode'];
const requiredForbiddenFragments = ['game content', 'bios', 'save', 'absolute file', 'ip address', 'invite code', 'session token', 'account identifier', 'email', 'phone', 'precise location', 'raw controller'];
const requiredReviewers = ['General Orchestrator', 'QA Evidence Reviewer', 'Privacy Reviewer'];

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function includesFragment(values, fragment) {
  return values.some((value) => String(value).toLowerCase().includes(fragment));
}

function validate(contract) {
  assert.equal(contract.schemaVersion, 1, 'schemaVersion must remain 1');
  assert.equal(contract.status, 'draft', 'recruitment contract must remain draft until a separate publication chain');
  assert.equal(contract.publicationGate?.required, true, 'publication gate must be required');
  for (const reviewer of requiredReviewers) {
    assert.ok(contract.publicationGate.approvedByRoles.includes(reviewer), 'missing required reviewer: ' + reviewer);
  }
  assert.ok(includesFragment(contract.publicationGate.conditions, 'qa-approved route'), 'publication gate must bind claims to QA-approved routes');
  assert.ok(includesFragment(contract.publicationGate.conditions, 'privacy warning'), 'publication gate must preserve privacy copy');
  assert.ok(includesFragment(contract.publicationGate.conditions, 'separate approval'), 'external side effects must require separate approval');
  assert.ok(includesFragment(contract.publicationGate.conditions, 'remain unknown'), 'unknown evidence must remain unknown');

  assert.equal(contract.cta?.type, 'github-issue-template', 'CTA must use the repository issue template');
  assert.equal(contract.cta.repository, 'B11-Health/gamedeck', 'CTA repository mismatch');
  assert.equal(contract.cta.template, '.github/ISSUE_TEMPLATE/multiplayer_session.yml', 'CTA template mismatch');
  assert.equal(contract.cta.url, 'https://github.com/B11-Health/gamedeck/issues/new?template=multiplayer_session.yml', 'CTA URL mismatch');
  assert.ok(fs.existsSync(issueTemplatePath), 'multiplayer session issue template is missing');

  const dimensionIds = contract.cohortDimensions.map((item) => item.id);
  assert.deepEqual([...dimensionIds].sort(), [...requiredDimensions].sort(), 'cohort dimensions changed unexpectedly');
  for (const item of contract.cohortDimensions) {
    assert.ok(Array.isArray(item.coverage) && item.coverage.length >= 2, item.id + ' must define useful coverage');
    assert.ok(typeof item.collection === 'string' && item.collection.length >= 12, item.id + ' must define bounded collection guidance');
  }

  assert.ok(contract.allowedReportFields.length >= 10, 'allowed report fields are incomplete');
  for (const fragment of requiredForbiddenFragments) {
    assert.ok(includesFragment(contract.forbiddenData, fragment), 'forbidden data is missing: ' + fragment);
  }
  assert.ok(includesFragment(contract.claims.forbidden, 'any game'), 'universal game claim must be forbidden');
  assert.ok(includesFragment(contract.claims.forbidden, 'universal online play'), 'universal online-play claim must be forbidden');
  assert.ok(includesFragment(contract.claims.forbidden, 'zero-latency'), 'zero-latency claim must be forbidden');

  assert.equal(contract.measurement.telemetryImplementation, false, 'telemetry implementation is not authorized');
  assert.equal(contract.measurement.baseline, null, 'missing response evidence must remain unknown, not zero');
  assert.ok(contract.measurement.minimumPublicCohort >= 20, 'public cohorts must respect the privacy-safe minimum');
  assert.ok(String(contract.measurement.responseState).toLowerCase().includes('unknown'), 'response state must remain unknown before publication');
  assert.ok(contract.stopConditions.length >= 4, 'stop conditions are incomplete');
}

const contract = loadJson(contractPath);
validate(contract);

const draft = fs.readFileSync(draftPath, 'utf8').replace(/\r\n/g, '\n');
assert.match(draft, /Draft only\. Do not publish/i, 'draft must open with a publication warning');
assert.match(draft, /Coverage counts are \*\*unknown\*\*/i, 'draft must preserve unknown coverage');
assert.match(draft, /issues\/new\?template=multiplayer_session\.yml/, 'draft CTA must resolve to the multiplayer issue form');
assert.match(draft, /No product telemetry is authorized\./, 'draft must prohibit telemetry');
assert.match(draft, /Do not upload ROMs, BIOS files, keys, saves, invitations, private paths, IP addresses, session tokens/i, 'privacy copy is incomplete');
assert.match(draft, /separate custody chain for publication or account mutation/i, 'publication must require a separate custody chain');

const issueTemplate = fs.readFileSync(issueTemplatePath, 'utf8').toLowerCase();
for (const fragment of ['roms', 'bios files', 'ip addresses', 'invite codes', 'session tokens', 'account identifiers']) {
  assert.ok(issueTemplate.includes(fragment), 'issue template privacy boundary is missing: ' + fragment);
}

const pkg = loadJson(packagePath);
assert.match(String(pkg.scripts?.check || ''), /node scripts\/multiplayer-tester-recruitment-contract\.test\.mjs/, 'full repository gate must run the recruitment contract test');

const mutations = [
  ['published status', (copy) => { copy.status = 'published'; }],
  ['disabled publication gate', (copy) => { copy.publicationGate.required = false; }],
  ['invented zero baseline', (copy) => { copy.measurement.baseline = 0; }],
  ['telemetry enabled', (copy) => { copy.measurement.telemetryImplementation = true; }],
  ['IP-address boundary removed', (copy) => { copy.forbiddenData = copy.forbiddenData.filter((item) => !item.toLowerCase().includes('ip address')); }],
  ['small public cohort', (copy) => { copy.measurement.minimumPublicCohort = 1; }],
  ['external CTA substituted', (copy) => { copy.cta.url = 'https://example.com/signup'; }]
];

for (const [name, mutate] of mutations) {
  const copy = structuredClone(contract);
  mutate(copy);
  assert.throws(() => validate(copy), undefined, name + ' mutation must be rejected');
}

console.log('Multiplayer tester recruitment contract passed: 6 dimensions and ' + mutations.length + ' safety mutations rejected.');
