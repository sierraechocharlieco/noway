/* global NoWayAuto */
const AUTO_STORE_KEY = 'noWayAutoTrainingV1';
let autoStore = null;
let persistedAutoStore = null;
let autoStoreLoading = null;
const autoHosts = new Map();
const autoProofs = new Map();
const autoPending = new Map();
let writeQueue = Promise.resolve();

function serializeWork(work) {
  const result = writeQueue.then(work, work);
  writeQueue = result.catch(() => {});
  return result;
}

async function loadAutoStore() {
  if (autoStore) return autoStore;
  if (autoStoreLoading) return autoStoreLoading;
  autoStoreLoading = (async () => {
    const data = (await chrome.storage.local.get(AUTO_STORE_KEY))[AUTO_STORE_KEY];
    autoStore = data?.schemaVersion === 1 && data.origins && data.ruleProvenance
      ? data : { schemaVersion: 1, origins: {}, ruleProvenance: {} };
    persistedAutoStore = structuredClone(autoStore);
    return autoStore;
  })();
  try { return await autoStoreLoading; } finally { autoStoreLoading = null; }
}

async function saveAutoStore() {
  const snapshot = structuredClone(autoStore);
  try {
    await chrome.storage.local.set({ [AUTO_STORE_KEY]: snapshot });
    persistedAutoStore = snapshot;
  } catch (error) {
    autoStore = structuredClone(persistedAutoStore);
    throw error;
  }
}

function autoSettings(origin) {
  const saved = autoStore?.origins?.[origin];
  return { strategy: saved?.strategy === 'auto' ? 'auto' : 'manual',
    suppressedEvidenceKeys: Array.isArray(saved?.suppressedEvidenceKeys) ? saved.suppressedEvidenceKeys.slice(0, 500) : [] };
}

function autoRuntimeState(origin, originState, windowId) {
  const settings = autoSettings(origin);
  const host = autoHosts.get(windowId);
  return { ...settings, ready: host?.status === 'ready', status: host?.status || 'closed',
    generation: host?.generation || '',
    revision: NoWayAuto.key([originState.trainingEnabled, originState.protectionEnabled, originState.protectionAllowOnce,
      settings, originState.rules.map((r) => [r.id, r.enabled, r.kind, r.actionKey, r.match]), host?.generation, host?.status]),
  };
}

function trustedExtensionSender(sender) {
  return sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));
}

async function setAutoStrategy(origin, enabled, tabId) {
  assertOrigin(origin);
  if (!await hasHostPermission(origin)) throw new Error('Grant site access before enabling Auto.');
  await loadAutoStore();
  autoStore.origins[origin] = { ...autoSettings(origin), strategy: enabled ? 'auto' : 'manual' };
  await saveAutoStore();
  // Selecting Auto also starts training; disabling Auto keeps Manual training selected.
  return setOriginFlags(origin, { ...(enabled ? { trainingEnabled: true } : {}) }, tabId);
}

async function retrainAuto(origin) {
  assertOrigin(origin);
  await loadAutoStore();
  autoStore.origins[origin] = { ...autoSettings(origin), suppressedEvidenceKeys: [] };
  await saveAutoStore();
  await refreshOriginTabs(origin);
  return getRulesView();
}

async function suppressAutoRule(origin, rule, removeProvenance = false) {
  await loadAutoStore();
  const settings = autoSettings(origin);
  const keys = new Set(settings.suppressedEvidenceKeys);
  keys.add(NoWayAuto.suppressionKey(rule.match, rule.actionKey));
  if (rule.source === 'starter') {
    for (const label of rule.match?.textLabels || []) {
      const category = NoWayAuto.directAction(label);
      if (category) keys.add(`action:${category}`);
    }
  }
  autoStore.origins[origin] = { ...settings, suppressedEvidenceKeys: [...keys].slice(-500) };
  if (removeProvenance) delete autoStore.ruleProvenance[`${origin}|${rule.id}`];
  await saveAutoStore();
}

async function autoContext(sender) {
  const page = parsePageUrl(sender.url);
  if (!sender.tab?.id || !page || !await hasHostPermission(page.origin)) throw new Error('No access to the originating frame.');
  const store = await getStore();
  const state = store.origins[page.origin];
  if (!state?.trainingEnabled || autoSettings(page.origin).strategy !== 'auto') throw new Error('Auto training is no longer enabled.');
  return { origin: page.origin, state, auto: autoRuntimeState(page.origin, state, sender.tab.windowId),
    identity: `${sender.tab.id}|${sender.frameId}|${sender.documentId || sender.url}` };
}

async function classifyAuto(message, sender) {
  await loadAutoStore();
  const context = await autoContext(sender);
  const evidence = message.evidence;
  if (!NoWayAuto.validateEvidence(evidence) || message.revision !== context.auto.revision) return { ok: false, error: 'Action evidence changed.' };
  if (evidence.navigation === 'profile' && evidence.eventKind === 'activate') return { ok: true, decision: 'safe', actionKey: 'none', reasonCode: 'read_only' };
  if (!context.auto.ready) return { ok: true, ...NoWayAuto.uncertain(), reason: 'model-unavailable' };
  if (message.attempt) {
    // A real interaction must not wait behind speculative page discovery.
    for (const [id, pending] of autoPending) {
      if (pending.speculative && pending.host.windowId === sender.tab.windowId) {
        try { pending.host.port.postMessage({ type: 'cancel', id }); } catch (_) {}
        pending.finish(NoWayAuto.uncertain());
      }
    }
  }
  // Rate limit a document independently of the bounded host queue.
  if ([...autoPending.values()].filter((p) => p.identity === context.identity).length >= 20) return { ok: true, ...NoWayAuto.uncertain() };
  let result;
  let detector = 'nano';
  const known = NoWayAuto.actionFor(evidence);
  if (known && !evidence.truncated && /^en(?:-|$)/.test(evidence.language)) {
    result = { decision: 'risky', actionKey: known, reasonCode: NoWayAuto.reasonFor(known) };
    detector = 'heuristic';
  } else {
    const host = autoHosts.get(sender.tab.windowId);
    const id = crypto.randomUUID();
    result = await new Promise((resolve) => {
      const finish = (value) => {
        clearTimeout(timer);
        autoPending.delete(id);
        resolve(value);
      };
      const timer = setTimeout(() => {
        try { host.port.postMessage({ type: 'cancel', id }); } catch (_) {}
        finish(NoWayAuto.uncertain());
      }, 2000);
      autoPending.set(id, { identity: context.identity, host, finish, speculative: !message.attempt });
      try { host.port.postMessage({ type: 'classify', id, evidence }); }
      catch (_) { finish(NoWayAuto.uncertain()); }
    });
  }
  const latest = await autoContext(sender);
  if (latest.auto.revision !== context.auto.revision) return { ok: false, error: 'Auto state changed.' };
  result = NoWayAuto.adjudicate(evidence, result);
  if (NoWayAuto.suppressed(autoSettings(context.origin), evidence, result.actionKey)) return { ok: true, ...NoWayAuto.uncertain(), reason: 'suppressed' };
  if (result.decision !== 'risky') return { ok: true, ...result };
  const proof = crypto.randomUUID();
  // Proofs stay in worker memory, are bound to the originating document, and expire quickly.
  for (const [id, p] of autoProofs) if (p.expires < Date.now()) autoProofs.delete(id);
  if (autoProofs.size >= 500) autoProofs.delete(autoProofs.keys().next().value);
  autoProofs.set(proof, { ...context, evidence, result, detector, expires: Date.now() + 10000 });
  return { ok: true, ...result, proof };
}

async function commitAuto(message, sender) {
  const proof = autoProofs.get(message.proof);
  autoProofs.delete(message.proof);
  const context = await autoContext(sender);
  if (!proof || proof.identity !== context.identity || proof.expires < Date.now()
    || proof.auto.revision !== context.auto.revision || NoWayAuto.key(message.evidence) !== NoWayAuto.key(proof.evidence)) {
    throw new Error('Action changed. Review it again.');
  }
  if (NoWayAuto.suppressed(autoSettings(context.origin), proof.evidence, proof.result.actionKey)) throw new Error('Review this action manually.');
  const candidate = NoWayAuto.candidate(proof.evidence, proof.result, message.fingerprint);
  if (!candidate) throw new Error('This action needs a manual rule.');
  const validation = await chrome.tabs.sendMessage(sender.tab.id, { type: 'NOWAY_AUTO_VALIDATE',
    token: message.token, requestId: message.requestId, eventKind: proof.evidence.eventKind,
    evidenceKey: NoWayAuto.key(proof.evidence), revision: context.auto.revision,
  }, sender.documentId ? { documentId: sender.documentId } : { frameId: sender.frameId });
  if (!validation?.ok || !await hasHostPermission(context.origin)) throw new Error('The action is no longer current.');
  const latest = await autoContext(sender);
  if (!latest.auto.ready || latest.auto.revision !== proof.auto.revision) throw new Error('Auto state changed. Review this action again.');
  // Do not overwrite an analyst's explicit allow or silently revive a disabled rule.
  const duplicate = findDuplicateRule(context.state.rules, normalizeCandidate(candidate));
  if (duplicate && (duplicate.kind === 'allow' || duplicate.enabled === false)) throw new Error('An analyst override already exists.');
  const response = await createRuleForSender(sender, candidate);
  if (response.savedRuleId) {
    autoStore.ruleProvenance[`${context.origin}|${response.savedRuleId}`] = { createdBy: 'auto', detector: proof.detector,
      promptVersion: NoWayAuto.promptVersion, reasonCode: proof.result.reasonCode };
    // Losing optional provenance must never undo a committed block rule.
    try { await saveAutoStore(); } catch (_) {}
  }
  return { ...response, label: candidate.label };
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'noway-model' || !trustedExtensionSender(port.sender)
    || port.sender.url !== chrome.runtime.getURL('ai/sidepanel.html')) return;
  let host = null;
  port.onMessage.addListener((message) => {
    if (message.type === 'register' && !host && Number.isInteger(message.windowId)) {
      host = { port, generation: crypto.randomUUID(), status: 'idle', windowId: message.windowId };
      const old = autoHosts.get(message.windowId);
      if (old) old.port.disconnect();
      autoHosts.set(message.windowId, host);
      port.postMessage({ type: 'registered', generation: host.generation });
    } else if (message.type === 'status' && host && autoHosts.get(host.windowId) === host) {
      host.status = ['ready', 'loading', 'unavailable', 'idle', 'error'].includes(message.status) ? message.status : 'error';
      serializeWork(async () => { await loadAutoStore(); await broadcastStateToAllGuardedTabs(); }).catch(() => {});
    } else if (message.type === 'result' && host) {
      const pending = autoPending.get(message.id);
      if (pending?.host === host) pending.finish(NoWayAuto.validateDecision(message.result));
    }
  });
  port.onDisconnect.addListener(() => {
    if (host && autoHosts.get(host.windowId) === host) autoHosts.delete(host.windowId);
    for (const pending of autoPending.values()) if (pending.host === host) pending.finish(NoWayAuto.uncertain());
    serializeWork(async () => { await loadAutoStore(); await broadcastStateToAllGuardedTabs(); }).catch(() => {});
  });
});
