import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');
test('MAIN and ISOLATED policy entry points stay identical', () => {
  assert.equal(source('shared/auto-main.js'), source('shared/auto.js'));
});
function policyContext() {
  const context = vm.createContext({ console, AbortController, DOMException, setTimeout, clearTimeout });
  vm.runInContext(source('shared/auto.js'), context);
  return context;
}
const evidence = (label, extra = {}) => ({ eventKind: 'activate', tag: 'button', role: '', inputType: '',
  label, language: 'en', attributes: { 'data-testid': 'control' }, context: [],
  truncated: false, disabled: false, pressed: '', checked: '', expanded: '', ...extra });

test('only consistent constrained decisions can affect policy', () => {
  const { NoWayAuto: a } = policyContext();
  for (const value of [null, 'safe', { decision: 'safe', actionKey: 'follow', reasonCode: 'read_only' },
    { decision: 'risky', actionKey: 'none', reasonCode: 'publication' },
    { decision: 'safe', actionKey: 'none', reasonCode: 'read_only', selector: '*' }]) {
    assert.equal(a.validateDecision(value).decision, 'uncertain');
  }
  assert.equal(a.validateDecision({ decision: 'risky', actionKey: 'follow', reasonCode: 'relationship_change' }).decision, 'risky');
});

test('unfamiliar actions create narrow reusable rules without selectors from the model', () => {
  const { NoWayAuto: a } = policyContext();
  const e = evidence('Track updates');
  const result = { decision: 'risky', actionKey: 'follow', reasonCode: 'relationship_change' };
  const rule = a.candidate(e, result, 'fingerprint');
  assert.equal(rule.label, 'Follow');
  assert.equal(rule.match.selectors.length, 0);
  assert.equal(a.matchesEvidence(rule.match.autoEvidence, e), true);
  assert.equal(a.matchesEvidence(rule.match.autoEvidence, evidence('Browse history')), false);
  assert.equal(a.matchesEvidence(rule.match.autoEvidence, evidence('Track updates', { expanded: 'true' })), true);
  assert.equal(a.key(e) === a.key(evidence('Track updates', { expanded: 'true' })), false, 'safe-cache evidence must include interaction state');
  const reordered = Object.fromEntries(Object.entries(e).reverse());
  assert.equal(a.key(reordered), a.key(e), 'Chrome storage property ordering must not invalidate evidence');
});

test('known actions generalize and generic confirmations do not auto-learn broadly', () => {
  const { NoWayAuto: a } = policyContext();
  const rule = a.candidate(evidence('Follow Jane Doe'), { actionKey: 'follow' }, 'fp');
  assert.equal(rule.label, 'Follow');
  assert.equal(rule.match.autoEvidence, undefined);
  assert.equal(a.directAction('Open follow menu'), '');
  assert.equal(a.directAction('Unfollow Jane Doe'), 'follow');
  assert.equal(a.candidate(evidence('Continue', { attributes: {} }), { actionKey: 'other-mutation' }, 'fp'), null);
  assert.equal(a.candidate(evidence('', { attributes: {} }), { actionKey: 'other-mutation' }, 'fp'), null);
  assert.equal(a.validateEvidence(evidence('x', { attributes: { onclick: 'alert(1)' } })), false);
});

test('independent model clones validate output and do not retain previous page prompts', async () => {
  const context = policyContext();
  let clones = 0;
  let destroys = 0;
  const api = { create: async () => ({ destroy() {}, clone: async () => {
    clones++;
    return { destroy() { destroys++; }, prompt: async (input) => JSON.parse(input).label === 'Bad JSON'
      ? 'not JSON' : JSON.stringify({ decision: 'safe', actionKey: 'none', reasonCode: 'read_only' }) };
  } }) };
  vm.runInContext(source('ai/classifier.js'), context);
  const model = new context.NoWayClassifier(api);
  await model.setup();
  assert.equal((await model.classify(evidence('Browse history'))).decision, 'safe');
  assert.equal((await model.classify(evidence('Bad JSON'))).decision, 'uncertain');
  const count = clones;
  assert.equal((await model.classify(evidence('Seguir', { language: 'es' }))).decision, 'uncertain');
  assert.equal(clones, count, 'unsupported text does not enter a model session');
  assert.equal(clones, destroys);
  model.destroy();
});

function worker() {
  const db = {};
  const event = () => ({ addListener() {} });
  const chrome = {
    runtime: { id: 'test', getURL: (p) => `chrome-extension://test/${p}`, sendMessage: async () => {}, onConnect: event(), onMessage: event(), onInstalled: event(), onStartup: event() },
    storage: { local: { get: async (key) => structuredClone({ [key]: db[key] }),
      set: async (values) => Object.assign(db, JSON.parse(JSON.stringify(values, (_name, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value))), setAccessLevel: async () => {} }, onChanged: event() },
    permissions: { contains: async ({ origins }) => origins.every((o) => o.startsWith('https://frame.example') || o.startsWith('https://www.linkedin.com')), onAdded: event(), onRemoved: event() },
    scripting: { getRegisteredContentScripts: async () => [], unregisterContentScripts: async () => {}, registerContentScripts: async () => {} },
    tabs: { query: async () => [], get: async () => ({ windowId: 7 }), sendMessage: async () => ({ ok: true }), onActivated: event(), onUpdated: event() },
  };
  const context = vm.createContext({ chrome, console, URL, crypto: webcrypto, setTimeout, clearTimeout, structuredClone });
  context.importScripts = (...files) => files.forEach((p) => vm.runInContext(source(p.startsWith('../') ? p.slice(3) : `background/${p}`), context));
  vm.runInContext(source('background/service_worker.js'), context);
  const frame = { id: 'test', url: 'https://frame.example/form', tab: { id: 1, windowId: 7, url: 'https://ungranted.example/' }, frameId: 2, documentId: 'frame-document' };
  const ui = { id: 'test', url: 'chrome-extension://test/popup/popup.html' };
  return { context, db, frame, ui };
}

test('frame origin owns rules and content scripts cannot enable Auto or edit unrelated origins', async () => {
  const { context: c, db, frame, ui } = worker();
  await assert.rejects(c.handleMessage({ type: 'NOWAY_SET_AUTO', origin: 'https://frame.example', enabled: true }, frame), /Extension UI/);
  await c.handleMessage({ type: 'NOWAY_SET_AUTO', origin: 'https://frame.example', enabled: true }, ui);
  const state = await c.handleMessage({ type: 'NOWAY_GET_PAGE_STATE' }, frame);
  assert.equal(state.origin, 'https://frame.example');
  assert.equal(state.auto.strategy, 'auto');
  const candidate = c.NoWayAuto.candidate(evidence('Follow Jane Doe'), { actionKey: 'follow' }, 'fp');
  await c.handleMessage({ type: 'NOWAY_CREATE_RULE', candidate }, frame);
  assert.equal(db.noWayRulesV1.origins['https://frame.example'].rules[0].label, 'Follow');
  assert.equal(db.noWayRulesV1.origins['https://ungranted.example'], undefined);
});

test('failed preference persistence cannot leave Auto enabled in memory', async () => {
  const { context: c, frame, ui } = worker();
  await c.handleMessage({ type: 'NOWAY_GET_PAGE_STATE' }, frame);
  const save = c.chrome.storage.local.set;
  c.chrome.storage.local.set = async () => { throw new Error('Storage full'); };
  await assert.rejects(c.handleMessage({ type: 'NOWAY_SET_AUTO', origin: 'https://frame.example', enabled: true }, ui), /Storage full/);
  c.chrome.storage.local.set = save;
  assert.equal((await c.handleMessage({ type: 'NOWAY_GET_PAGE_STATE' }, frame)).auto.strategy, 'manual');
});

test('v1 import preserves exact evidence, disables Auto, and deletion suppresses recreation', async () => {
  const { context: c, db, frame, ui } = worker();
  await c.handleMessage({ type: 'NOWAY_SET_AUTO', origin: 'https://frame.example', enabled: true }, ui);
  const candidate = c.NoWayAuto.candidate(evidence('Track updates'), { actionKey: 'follow' }, 'fp');
  await c.handleMessage({ type: 'NOWAY_CREATE_RULE', candidate }, frame);
  const exported = (await c.handleMessage({ type: 'NOWAY_EXPORT_RULES' }, ui)).payload;
  assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.origins['https://frame.example'].auto, undefined);
  await c.handleMessage({ type: 'NOWAY_IMPORT_RULES', payload: exported }, ui);
  assert.equal((await c.handleMessage({ type: 'NOWAY_GET_PAGE_STATE' }, frame)).auto.strategy, 'manual');
  const rule = db.noWayRulesV1.origins['https://frame.example'].rules[0];
  assert.equal(c.NoWayAuto.matchesEvidence(rule.match.autoEvidence, evidence('Track updates')), true);
  await c.handleMessage({ type: 'NOWAY_DELETE_RULE', origin: 'https://frame.example', ruleId: rule.id }, ui);
  assert.equal(db.noWayAutoTrainingV1.origins['https://frame.example'].suppressedEvidenceKeys.length, 1);
  await c.handleMessage({ type: 'NOWAY_RETRAIN_AUTO', origin: 'https://frame.example' }, ui);
  assert.equal(db.noWayAutoTrainingV1.origins['https://frame.example'].suppressedEvidenceKeys.length, 0);
});

test('model proofs expire on a mode change and cannot write a rule into another document', async () => {
  const { context: c, frame, ui } = worker();
  await c.handleMessage({ type: 'NOWAY_SET_AUTO', origin: 'https://frame.example', enabled: true }, ui);
  vm.runInContext("autoHosts.set(7, {status:'ready', generation:'test-host'})", c);
  const state = await c.handleMessage({ type: 'NOWAY_GET_PAGE_STATE' }, frame);
  const e = evidence('Follow Jane Doe');
  const result = await c.handleMessage({ type: 'NOWAY_AUTO_CLASSIFY', evidence: e, revision: state.auto.revision }, frame);
  assert.equal(result.decision, 'risky');
  await assert.rejects(c.handleMessage({ type: 'NOWAY_AUTO_COMMIT', proof: result.proof, evidence: e }, { ...frame, documentId: 'new-document' }), /Action changed/);
  const result2 = await c.handleMessage({ type: 'NOWAY_AUTO_CLASSIFY', evidence: e, revision: state.auto.revision }, frame);
  await c.handleMessage({ type: 'NOWAY_SET_ORIGIN_FLAGS', origin: 'https://frame.example', trainingEnabled: false }, ui);
  await assert.rejects(c.handleMessage({ type: 'NOWAY_AUTO_COMMIT', proof: result2.proof, evidence: e }, frame), /no longer enabled/);
});

test('an abort frees the inference queue even when Chrome ignores the signal', async () => {
  const c = policyContext();
  let destroyed = 0;
  const safe = JSON.stringify({ decision: 'safe', actionKey: 'none', reasonCode: 'read_only' });
  const api = { create: async () => ({ destroy() {}, clone: async () => ({
    destroy() { destroyed++; }, prompt: async (input) => JSON.parse(input).label === 'Stalled' ? new Promise(() => {}) : safe,
  }) }) };
  vm.runInContext(source('ai/classifier.js'), c);
  const model = new c.NoWayClassifier(api);
  await model.setup();
  const controller = new AbortController();
  const stalled = model.classify(evidence('Stalled'), controller.signal);
  await new Promise((r) => setTimeout(r, 0));
  const next = model.classify(evidence('Browse history'));
  controller.abort();
  assert.equal((await stalled).decision, 'uncertain');
  assert.equal((await next).decision, 'safe');
  assert.equal(destroyed, 3, 'probe, cancelled clone, and next clone are all destroyed');
});

test('a cancelled setup probe cannot destroy a replacement model', async () => {
  const c = policyContext();
  let created = 0;
  const bases = [];
  const api = { create: async () => {
    const first = created++ === 0;
    const base = { destroyed: false, destroy() { this.destroyed = true; }, clone: async () => ({ destroy() {},
      prompt: async () => first ? new Promise(() => {}) : JSON.stringify({ decision: 'safe', actionKey: 'none', reasonCode: 'read_only' }),
    }) };
    bases.push(base); return base;
  } };
  vm.runInContext(source('ai/classifier.js'), c);
  const model = new c.NoWayClassifier(api);
  const first = model.setup();
  const cancelled = assert.rejects(first, /cancelled/i);
  await new Promise((r) => setTimeout(r, 0));
  model.destroy();
  await model.setup();
  await cancelled;
  assert.equal(model.base, bases[1]);
  assert.equal(bases[1].destroyed, false);
});

test('closing the model during final document validation prevents a saved rule', async () => {
  const { context: c, frame, ui, db } = worker();
  await c.handleMessage({ type: 'NOWAY_SET_AUTO', origin: 'https://frame.example', enabled: true }, ui);
  vm.runInContext("autoHosts.set(7, {status:'ready', generation:'test-host'})", c);
  const state = await c.handleMessage({ type: 'NOWAY_GET_PAGE_STATE' }, frame);
  const e = evidence('Follow Jane Doe');
  const result = await c.handleMessage({ type: 'NOWAY_AUTO_CLASSIFY', evidence: e, revision: state.auto.revision }, frame);
  c.chrome.tabs.sendMessage = async () => { vm.runInContext('autoHosts.delete(7)', c); return { ok: true }; };
  await assert.rejects(c.handleMessage({ type: 'NOWAY_AUTO_COMMIT', proof: result.proof, evidence: e }, frame), /Auto state changed/);
  assert.equal(db.noWayRulesV1.origins['https://frame.example'].rules.length, 0);
});

test('wildcard permission removal disables every origin that lost access', async () => {
  const { context: c, ui, db } = worker();
  await c.handleMessage({ type: 'NOWAY_SET_AUTO', origin: 'https://frame.example', enabled: true }, ui);
  c.chrome.permissions.contains = async () => false;
  await c.handleRemovedHostPermissions(['https://*/*']);
  assert.equal(db.noWayRulesV1.origins['https://frame.example'].trainingEnabled, false);
  assert.equal(db.noWayRulesV1.origins['https://frame.example'].protectionEnabled, false);
  assert.equal(db.noWayAutoTrainingV1.origins['https://frame.example'].strategy, 'manual');
});

test('rejected JSON edits leave the original rule and automatic suppression intact', async () => {
  const { context: c, frame, ui, db } = worker();
  await c.handleMessage({ type: 'NOWAY_SET_AUTO', origin: 'https://frame.example', enabled: true }, ui);
  await c.handleMessage({ type: 'NOWAY_CREATE_RULE', candidate: c.NoWayAuto.candidate(evidence('Follow Jane Doe'), { actionKey: 'follow' }, 'fp') }, frame);
  const rule = db.noWayRulesV1.origins['https://frame.example'].rules[0];
  await assert.rejects(c.handleMessage({ type: 'NOWAY_UPDATE_RULE', origin: 'https://frame.example', ruleId: rule.id,
    changes: { enabled: false, match: { autoEvidence: { tag: 'button' } } } }, ui), /Invalid automatic rule evidence/);
  assert.equal(db.noWayRulesV1.origins['https://frame.example'].rules[0].enabled, true);
  assert.equal(db.noWayAutoTrainingV1.origins['https://frame.example'].suppressedEvidenceKeys.length, 0);
  await assert.rejects(c.handleMessage({ type: 'NOWAY_UPDATE_RULE', origin: 'https://frame.example', ruleId: rule.id, changes: null }, ui), /JSON object/);
});

test('starter rules apply only to the documented LinkedIn origin', async () => {
  const { context: c, ui } = worker();
  const expected = await c.handleMessage({ type: 'NOWAY_GET_POPUP_STATE', tabUrl: 'https://www.linkedin.com/feed' }, ui);
  assert.ok(expected.originState.rules.length > 0);
  for (const origin of ['http://www.linkedin.com', 'https://www.linkedin.com:8443', 'https://linkedin.com']) {
    const state = await c.handleMessage({ type: 'NOWAY_GET_POPUP_STATE', tabUrl: origin }, ui);
    assert.equal(state.originState.rules.length, 0);
  }
});


test('action verbs must describe the control, not a name or a later step', () => {
  const { NoWayAuto: a } = policyContext();
  for (const label of ['Jane Love', 'Taylor Post', 'View likes', 'Open follow menu', 'Comment', 'Reply', 'Message', 'Share', 'Connect', 'Support center', 'Follow up tasks']) {
    assert.equal(a.directAction(label), '', label);
  }
  for (const [label, action] of [['Like', 'like'], ['Unlike', 'like'], ['Follow Jane Doe', 'follow'], ['Send', 'message'], ['Post comment', 'comment'], ['Delete saved search', 'delete'], ['Save changes and close', 'save']]) {
    assert.equal(a.directAction(label), action, label);
  }
  assert.equal(a.actionFor(evidence('Love Jane', { tag: 'a', navigation: 'profile' })), '');
  assert.equal(a.actionFor(evidence('Like', { truncated: true })), '');
  assert.equal(a.validateDecision({ decision: 'risky', actionKey: 'follow', reasonCode: 'reaction' }).decision, 'uncertain');
});


test('model guesses cannot authorize unknown actions or auto-learn preparatory controls', () => {
  const { NoWayAuto: a } = policyContext();
  const safe = { decision: 'safe', actionKey: 'none', reasonCode: 'read_only' };
  const risky = { decision: 'risky', actionKey: 'message', reasonCode: 'communication' };
  assert.equal(a.adjudicate(evidence('Track updates'), safe).decision, 'uncertain');
  assert.equal(a.adjudicate(evidence('Message'), risky).decision, 'uncertain');
  assert.equal(a.adjudicate(evidence('Connect'), safe).decision, 'uncertain');
  assert.equal(a.adjudicate(evidence('Open message composer'), risky).decision, 'uncertain');
  assert.equal(a.adjudicate(evidence('View profile'), safe).decision, 'safe');
  assert.equal(a.adjudicate(evidence('Unlike'), risky).actionKey, 'like');
  assert.equal(a.adjudicate(evidence('Save post'), safe).actionKey, 'save');
});
