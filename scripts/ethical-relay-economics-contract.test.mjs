import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultModelPath = path.join(root, 'config', 'ethical-relay-economics.json');
const modelPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultModelPath;
const doc = fs.readFileSync(path.join(root, 'docs', 'ETHICAL_REVENUE_MODEL.md'), 'utf8');
const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

function validate(model) {
  assert.equal(model.schemaVersion, 1, 'schema version must remain 1');
  assert.equal(model.status, 'design-only', 'model must remain design-only');
  for (const key of ['spendingAuthorized', 'pricingAuthorized', 'paymentAccountAuthorized', 'sponsorCommitmentAuthorized', 'publicationAuthorized', 'telemetryImplemented']) {
    assert.equal(model.decisionBoundary?.[key], false, key + ' must remain false');
  }
  assert.equal(model.decisionBoundary?.ownerApprovalRequired, true, 'owner approval must remain required');

  const protectedRoutes = new Set(model.trustConstraints?.freeRoutesProtected || []);
  for (const route of ['local-couch-play', 'direct-peer-to-peer-play', 'user-owned-network-remote-play']) {
    assert.ok(protectedRoutes.has(route), 'protected free route missing: ' + route);
  }
  const prohibited = (model.trustConstraints?.prohibitedPractices || []).join(' | ').toLowerCase();
  for (const phrase of ['sell or license user data', 'personalized advertising', 'paywall local play', 'degrade or throttle the free direct route']) {
    assert.ok(prohibited.includes(phrase), 'prohibited practice missing: ' + phrase);
  }

  assert.deepEqual(model.scenarios?.map((scenario) => scenario.id), ['low', 'base', 'high'], 'low/base/high scenarios are required');
  for (const scenario of model.scenarios) {
    assert.equal(scenario.evidenceClass, 'assumption', scenario.id + ' must remain an assumption');
    const input = scenario.inputs;
    const egress = round2(input.relayedMinutes * 60 * input.averageBitrateMbps / 8 / 1000);
    const hours = round2(input.relayedMinutes / 60);
    const cost = round2(egress * input.egressUsdPerGb + hours * input.computeUsdPerHour + input.fixedMonthlyUsd);
    const revenue = round2(input.supporterCount * input.supporterMonthlyUsd + input.sponsorCount * input.sponsorMonthlyUsd + input.grantMonthlyEquivalentUsd);
    assert.equal(scenario.outputs.relayEgressGb, egress, scenario.id + ' egress output is stale');
    assert.equal(scenario.outputs.relayComputeHours, hours, scenario.id + ' compute output is stale');
    assert.equal(scenario.outputs.monthlyRelayCostUsd, cost, scenario.id + ' cost output is stale');
    assert.equal(scenario.outputs.monthlyHypotheticalRevenueUsd, revenue, scenario.id + ' revenue output is stale');
    assert.equal(scenario.outputs.monthlyGapUsd, round2(revenue - cost), scenario.id + ' gap output is stale');
  }

  assert.ok(Array.isArray(model.unknowns) && model.unknowns.length >= 6, 'material unknowns must be explicit');
  for (const unknown of model.unknowns) {
    assert.equal(unknown.status, 'unknown', unknown.id + ' status must remain unknown');
    assert.equal(unknown.measuredValue, 'unknown', unknown.id + ' must not be replaced with invented zero or evidence');
    assert.ok(String(unknown.measurement || '').length >= 30, unknown.id + ' needs a bounded measurement plan');
  }

  assert.ok(model.decisionGates?.minimumQualifiedDemandSignals >= 20, 'public demand decisions require at least 20 qualified signals');
  for (const role of ['General Orchestrator', 'Trust and Product Reviewer', 'Privacy Reviewer', 'Owner financial authority']) {
    assert.ok(model.decisionGates.requiredApprovals.includes(role), 'required approval missing: ' + role);
  }
  assert.equal(model.stopLoss?.pilotSpendCapUsd, 'unknown', 'pilot cap must remain unknown until owner approval');
  const rollback = (model.stopLoss?.rollback || []).join(' | ').toLowerCase();
  assert.ok(rollback.includes('preserve local couch, direct peer-to-peer, and user-owned-network routes'), 'rollback must preserve free routes');
  assert.ok(rollback.includes('no player-level relay history'), 'rollback must not retain player-level history');

  assert.match(doc, /design-only decision aid/i);
  assert.match(doc, /does not authorize pricing, spending/i);
  assert.match(doc, /measure first, commit later/i);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectRejected(name, mutate, model) {
  const changed = clone(model);
  mutate(changed);
  assert.throws(() => validate(changed), undefined, name + ' mutation must be rejected');
}

try {
  const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
  validate(model);
  if (modelPath === defaultModelPath) {
    const mutations = [
      ['authorize spending', (m) => { m.decisionBoundary.spendingAuthorized = true; }],
      ['authorize pricing', (m) => { m.decisionBoundary.pricingAuthorized = true; }],
      ['remove direct route protection', (m) => { m.trustConstraints.freeRoutesProtected = m.trustConstraints.freeRoutesProtected.filter((x) => x !== 'direct-peer-to-peer-play'); }],
      ['remove data-sale prohibition', (m) => { m.trustConstraints.prohibitedPractices = m.trustConstraints.prohibitedPractices.filter((x) => !x.includes('sell or license user data')); }],
      ['forge verified scenario', (m) => { m.scenarios[0].evidenceClass = 'verified'; }],
      ['corrupt cost math', (m) => { m.scenarios[1].outputs.monthlyRelayCostUsd = 0; }],
      ['invent unknown as zero', (m) => { m.unknowns[0].measuredValue = 0; }],
      ['lower demand threshold', (m) => { m.decisionGates.minimumQualifiedDemandSignals = 1; }],
      ['authorize telemetry', (m) => { m.decisionBoundary.telemetryImplemented = true; }],
      ['remove rollback preservation', (m) => { m.stopLoss.rollback = ['disable optional hosted relay']; }]
    ];
    for (const [name, mutate] of mutations) expectRejected(name, mutate, model);
    console.log('Ethical relay economics contract passed: 3 scenarios and ' + mutations.length + ' safety mutations rejected.');
  } else {
    console.log('Ethical relay economics contract passed for ' + modelPath + '.');
  }
} catch (error) {
  console.error('Ethical relay economics contract failed: ' + error.message);
  process.exitCode = 1;
}
