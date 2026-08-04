import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractPath = path.join(root, 'config', 'multiplayer-metrics.json');
const docPath = path.join(root, 'docs', 'MULTIPLAYER_METRICS.md');
const packagePath = path.join(root, 'package.json');
const requiredStages = new Set(['awareness', 'activation', 'readiness', 'connection', 'gameplay', 'retention', 'contribution', 'cost']);
const allowedEvidence = new Set(['hard', 'directional', 'unknown']);
const consentBySource = new Map([
  ['public-platform-aggregate', 'public-aggregate'],
  ['local-aggregate', 'local-only'],
  ['explicit-opt-in-diagnostic', 'explicit-opt-in'],
  ['user-submitted', 'explicit-opt-in'],
  ['operational-aggregate', 'service-operation']
]);
const maxRetentionBySource = new Map([
  ['public-platform-aggregate', 90],
  ['local-aggregate', 30],
  ['explicit-opt-in-diagnostic', 7],
  ['user-submitted', 90],
  ['operational-aggregate', 90]
]);

function readContract() {
  return JSON.parse(fs.readFileSync(contractPath, 'utf8'));
}

function validate(contract) {
  const errors = [];
  const fail = (condition, message) => {
    if (!condition) errors.push(message);
  };

  fail(contract?.schemaVersion === 1, 'schemaVersion must be 1');
  fail(contract?.status === 'design-only', 'status must remain design-only');

  const boundary = contract?.measurementBoundary || {};
  fail(boundary.telemetryImplemented === false, 'telemetryImplemented must be false');
  fail(boundary.requiresPlayerIdentity === false, 'player identity must not be required');
  fail(boundary.rawEventUpload === false, 'raw event upload must be disabled');

  const allowedDimensions = new Set(boundary.allowedDimensions || []);
  const permittedSources = new Set(boundary.permittedSources || []);
  for (const source of consentBySource.keys()) {
    fail(permittedSources.has(source), `missing permitted source: ${source}`);
  }

  const requiredProhibited = [
    'persistent installation identifier',
    'IP address',
    'invite code',
    'session token',
    'game-library inventory',
    'absolute file path',
    'raw controller input'
  ];
  for (const field of requiredProhibited) {
    fail((boundary.prohibitedData || []).includes(field), `missing prohibited data category: ${field}`);
  }

  fail(Array.isArray(contract?.metrics) && contract.metrics.length >= 12, 'at least 12 metrics are required');

  const ids = new Set();
  const seenStages = new Set();
  for (const metric of contract?.metrics || []) {
    const prefix = metric?.id || '<missing-id>';
    fail(/^[a-z1][a-z0-9_]+$/.test(prefix), `${prefix}: invalid metric id`);
    fail(!ids.has(prefix), `${prefix}: duplicate metric id`);
    ids.add(prefix);
    seenStages.add(metric.stage);

    for (const field of ['name', 'question', 'numerator', 'denominator', 'calculation', 'decisionUse', 'caveats']) {
      fail(typeof metric[field] === 'string' && metric[field].trim().length > 0, `${prefix}: missing ${field}`);
    }

    fail(requiredStages.has(metric.stage), `${prefix}: unknown stage`);
    fail(allowedEvidence.has(metric.evidenceClass), `${prefix}: invalid evidenceClass`);
    fail(permittedSources.has(metric.source), `${prefix}: unapproved source`);
    fail(metric.aggregation === 'aggregate-only', `${prefix}: aggregation must be aggregate-only`);
    fail(metric.consent === consentBySource.get(metric.source), `${prefix}: consent does not match source`);
    fail(metric.requiresIdentity === false, `${prefix}: identity requirement is forbidden`);
    fail(metric.baseline === 'unknown', `${prefix}: baseline must remain explicitly unknown`);
    fail(Array.isArray(metric.dimensions), `${prefix}: dimensions must be an array`);

    for (const dimension of metric.dimensions || []) {
      fail(allowedDimensions.has(dimension), `${prefix}: forbidden dimension ${dimension}`);
    }

    fail(metric?.retention?.rawEvents === false, `${prefix}: raw events must not be retained`);
    fail(Number.isInteger(metric?.retention?.days) && metric.retention.days >= 0, `${prefix}: invalid retention days`);
    fail(metric?.retention?.days <= maxRetentionBySource.get(metric.source), `${prefix}: retention exceeds source maximum`);
  }

  for (const stage of requiredStages) {
    fail(seenStages.has(stage), `missing stage: ${stage}`);
  }

  const publication = contract?.publicationRules || {};
  fail(Number.isInteger(publication.minimumCohortSize) && publication.minimumCohortSize >= 20, 'minimum cohort must be at least 20');
  fail(publication.smallCellAction === 'suppress', 'small cells must be suppressed');
  fail(publication.comparisonsRequireSameEvidenceVersion === true, 'comparisons must require the same evidence version');
  fail(publication.claimsRequireQaApproval === true, 'public claims must require QA approval');

  return errors;
}

const contract = readContract();
assert.deepEqual(validate(contract), [], 'canonical multiplayer metric contract must validate');

const doc = fs.readFileSync(docPath, 'utf8');
assert.match(doc, /Status: design-only measurement contract/i);
assert.match(doc, /does not enable telemetry/i);
assert.match(doc, /config\/multiplayer-metrics\.json/);
assert.match(doc, /minimum cohort/i);
for (const metric of contract.metrics) {
  assert.ok(doc.includes('`' + metric.id + '`'), `documentation missing ${metric.id}`);
}

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const check = String(pkg.scripts?.check || '');
const registration = 'node scripts/multiplayer-metrics-contract.test.mjs';
assert.equal(check.split(registration).length - 1, 1, 'metrics contract test must be registered exactly once');

function mutated(change) {
  const copy = structuredClone(contract);
  change(copy);
  return validate(copy);
}

assert.ok(mutated(c => { c.measurementBoundary.requiresPlayerIdentity = true; }).length, 'identity requirement muust fail');
assert.ok(mutated(c => { delete c.metrics[0].denominator; }).length, 'missing denominator mutation must fail');
assert.ok(mutated(c => { c.metrics[0].dimensions.push('gameTitle'); }).length, 'forbidden dimension mutation must fail');
assert.ok(mutated(c => { c.metrics[0].retention.rawEvents = true; }).length, 'raw event retention mutation must fail');
assert.ok(mutated(c => { c.metrics[0].baseline = 0; }).length, 'invented zero baseline mutation must fail');
assert.ok(mutated(c => { c.publicationRules.minimumCohortSize = 1; }).length, 'small cohort publication mutation must fail');

console.log(`Multiplayer metrics contract passed: ${contract.metrics.length} metrics and 6 privacy mutations rejected.`);
