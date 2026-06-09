let debugEnabled = false;

function debugLog(entry) {
  if (!debugEnabled) return;
  const record = { source: 'sw', time: Date.now(), ...entry };
  console.log('[No Way!]', JSON.stringify(record));
}

const STORE_KEY = 'noWayRulesV1';
const DEBUG_KEY = 'noWayDebug';
const SCHEMA_VERSION = 1;
const MAIN_SCRIPT = 'content/guard-main.js';
const CONTROLLER_SCRIPT = 'content/guard-controller.js';
const SCRIPT_PREFIX = 'noway';

const LINKEDIN_STARTER_RULES = [
  {
    id: 'starter-linkedin-reactions',
    actionKey: 'like',
    label: 'LinkedIn reactions',
    confidence: 0.95,
    match: {
      selectors: [
        'button[aria-label*="React Like"]',
        'button[aria-label*="React "]',
        'button[aria-label*="React"]',
        'button[aria-label*="Reaction"]',
        'button[aria-label*="Like" i]',
        'button[aria-label*="Unlike" i]',
        'button[aria-label*="Unreact" i]',
        '[role="button"][aria-label*="React "]',
        '[role="button"][aria-label*="React"]',
        '[role="button"][aria-label*="Reaction"]',
        '[role="button"][aria-label*="Like" i]',
        '[role="button"][aria-label*="Unlike" i]',
        '[role="button"][aria-label*="Unreact" i]',
        '[role="menuitem"][aria-label*="React "]',
        '[role="menuitem"][aria-label*="React"]',
        '[role="menuitem"][aria-label*="Reaction"]',
        '[role="menuitem"][aria-label*="Like" i]',
        '[role="menuitem"][aria-label*="Unlike" i]',
        '[role="menuitem"][aria-label*="Unreact" i]',
        'button[aria-label*="Reaction button state"]',
        '[role="button"][aria-label*="Reaction button state"]',
        '[role="menuitem"][aria-label*="Reaction button state"]',
        'svg[aria-label*="Reaction button state"]',
        'button[aria-label="Open reactions menu"]',
        '[role="button"][aria-label="Open reactions menu"]',
        'button[aria-label*="Unreact"]',
        '[role="button"][aria-label*="Unreact"]',
        'button.reactions-react-button',
        'button[aria-label="Like"]',
        'button[aria-label="Celebrate"]',
        'button[aria-label="Support"]',
        'button[aria-label="Love"]',
        'button[aria-label="Insightful"]',
        'button[aria-label="Funny"]',
        '[role="button"][aria-label="Like"]',
        '[role="button"][aria-label="Celebrate"]',
        '[role="button"][aria-label="Support"]',
        '[role="button"][aria-label="Love"]',
        '[role="button"][aria-label="Insightful"]',
        '[role="button"][aria-label="Funny"]',
        '[role="menuitem"][aria-label="Like"]',
        '[role="menuitem"][aria-label="Celebrate"]',
        '[role="menuitem"][aria-label="Support"]',
        '[role="menuitem"][aria-label="Love"]',
        '[role="menuitem"][aria-label="Insightful"]',
        '[role="menuitem"][aria-label="Funny"]',
        'button[aria-label*="Like"][aria-label*="comment"]',
        'button[aria-label*="React"][aria-label*="comment"]',
        'button[aria-label*="Reaction"][aria-label*="comment"]',
      ],
      textLabels: [
        'like',
        'unlike',
        'react',
        'unreact',
        'reaction',
        'celebrate',
        'support',
        'love',
        'insightful',
        'funny',
        'favorite',
        'favourite',
        'heart',
        'star',
        'upvote',
        'downvote',
        'clap',
        'applaud',
        'cheer',
      ],
    },
  },
  {
    id: 'starter-linkedin-comments',
    actionKey: 'comment',
    label: 'LinkedIn comments and replies',
    confidence: 0.95,
    match: {
      selectors: [
        'button[aria-label="Comment"]',
        'button[aria-label="Post comment"]',
        'button[aria-label="Add comment"]',
        'button.comments-comment-box__submit-button',
        'button[aria-label*="Reply"]',
      ],
      textLabels: ['comment', 'post comment', 'add comment', 'reply'],
    },
  },
  {
    id: 'starter-linkedin-sharing',
    actionKey: 'share',
    label: 'LinkedIn reposts and shares',
    confidence: 0.95,
    match: {
      selectors: [
        'button[aria-label*="Repost"]',
        'button[aria-label="Share via other options"]',
        '.social-reshare-button',
      ],
      textLabels: ['repost', 'share'],
    },
  },
  {
    id: 'starter-linkedin-messages',
    actionKey: 'message',
    label: 'LinkedIn private messages',
    confidence: 0.95,
    match: {
      selectors: [
        'button[aria-label="Send in a private message"]',
        'button[aria-label*="Send in a private"]',
        'button.msg-form__send-button',
        'button[aria-label="Send"]',
        '.msg-form [contenteditable="true"]',
        '.msg-form__contenteditable',
        '[contenteditable="true"][aria-label*="message" i]',
        '[contenteditable="true"][aria-label*="Write a message" i]',
        'form.msg-form',
        'form[class*="msg-form"]',
      ],
      textLabels: ['send', 'message'],
    },
  },
  {
    id: 'starter-linkedin-network',
    actionKey: 'connect',
    label: 'LinkedIn network changes',
    confidence: 0.95,
    match: {
      selectors: [
        'button[aria-label*="Connect"]',
        'button[aria-label*="Follow"]',
        '[role="button"][aria-label*="Follow"]',
      ],
      textLabels: ['connect', 'follow'],
    },
  },
  {
    id: 'starter-linkedin-profile-actions',
    actionKey: 'profile-action',
    label: 'LinkedIn profile actions',
    confidence: 0.9,
    match: {
      selectors: [
        'button[aria-label="Message"]',
        'button[aria-label*=" Message"]',
        'a[aria-label="Message"]',
        '[role="button"][aria-label="Message"]',
        'button[aria-label*="Endorse"]',
        'button[aria-label*="Send InMail"]',
        'button[aria-label*="Send now"]',
        'button[aria-label="Save"]',
        '[role="button"][aria-label="Save"]',
      ],
      textLabels: ['message', 'endorse', 'save'],
    },
  },
];

addChromeListener(chrome.runtime.onInstalled, () => {
  bootExtension().catch((error) => console.error('[No Way!]', error));
});

addChromeListener(chrome.runtime.onStartup, () => {
  bootExtension().catch((error) => console.error('[No Way!]', error));
});

addChromeListener(chrome.permissions?.onAdded, (permissions) => {
  if (!permissions.origins?.length) return;
  syncRegisteredContentScripts().catch((error) => console.error('[No Way!]', error));
});

addChromeListener(chrome.permissions?.onRemoved, (permissions) => {
  if (!permissions.origins?.length) return;
  handleRemovedHostPermissions(permissions.origins).catch((error) => console.error('[No Way!]', error));
});

addChromeListener(chrome.tabs?.onActivated, (activeInfo) => {
  if (!activeInfo?.tabId) return;
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    const page = parsePageUrl(tab.url);
    if (!page) return;
    syncTabState(activeInfo.tabId, page.origin).catch((error) => console.error('[No Way!]', error));
  });
});

addChromeListener(chrome.tabs?.onUpdated, (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const page = parsePageUrl(tab.url);
  if (!page) return;
  const storePromise = getStore();
  storePromise.then((store) => {
    const originState = store.origins[page.origin];
    if (!originState) return;
    if (!originState.trainingEnabled && !originState.protectionEnabled) return;
    syncTabState(tabId, page.origin).catch((error) => console.error('[No Way!]', error));
  }).catch((error) => console.error('[No Way!]', error));
});


addChromeListener(chrome.runtime.onMessage, (message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error('[No Way!]', error);
      sendResponse({ ok: false, error: error.message || String(error) });
    });
  return true;
});

function addChromeListener(event, handler) {
  if (event && typeof event.addListener === 'function') {
    event.addListener(handler);
  }
}

async function bootExtension() {
  await restrictStorageToTrustedContexts();
  await loadDebugFlag();
  await ensureStore();
  await syncRegisteredContentScripts();
}

async function loadDebugFlag() {
  try {
    const data = await chrome.storage.local.get(DEBUG_KEY);
    debugEnabled = Boolean(data[DEBUG_KEY]);
  } catch (_) {
    debugEnabled = false;
  }
}

addChromeListener(chrome.storage?.onChanged, (changes, area) => {
  if (area !== 'local') return;
  if (Object.prototype.hasOwnProperty.call(changes, DEBUG_KEY)) {
    debugEnabled = Boolean(changes[DEBUG_KEY].newValue);
  }
});

async function restrictStorageToTrustedContexts() {
  try {
    await chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch (error) {
    console.warn('[No Way!] Could not restrict storage access:', error.message);
  }
}

async function handleMessage(message = {}, sender = {}) {
  switch (message.type) {
    case 'NOWAY_GET_POPUP_STATE':
      return getPopupState(message.tabUrl);
    case 'NOWAY_SET_ORIGIN_FLAGS':
      return setOriginFlags(message.origin, {
        trainingEnabled: message.trainingEnabled,
        protectionEnabled: message.protectionEnabled,
        protectionAllowOnce: message.protectionAllowOnce,
      }, message.tabId);
    case 'NOWAY_GET_PAGE_STATE':
      return getPageStateForSender(sender);
    case 'NOWAY_CREATE_RULE':
      return createRuleForSender(sender, message.candidate);
    case 'NOWAY_ALWAYS_ALLOW_RULE':
      return allowRuleForSender(sender, message.candidate);
    case 'NOWAY_RECORD_HIT':
      return recordRuleHitForSender(sender, message.ruleId);
    case 'NOWAY_EXPORT_RULES':
      return exportRules(message.origins);
    case 'NOWAY_IMPORT_RULES':
      return importRules(message.payload);
    case 'NOWAY_GET_RULES':
      return getRulesView();
    case 'NOWAY_UPDATE_RULE':
      return updateRule(message.origin, message.ruleId, message.changes);
    case 'NOWAY_DELETE_RULE':
      return deleteRule(message.origin, message.ruleId);
    case 'NOWAY_DELETE_RULES':
      return deleteRules(message.items);
    case 'NOWAY_SET_DEBUG_FLAG':
      return setDebugFlag(Boolean(message.enabled));
    default:
      return { ok: false, error: `Unknown message type: ${String(message.type || '')}` };
  }
}

async function setDebugFlag(enabled) {
  debugEnabled = enabled;
  await chrome.storage.local.set({ [DEBUG_KEY]: enabled });
  await broadcastStateToAllGuardedTabs();
  return { ok: true, debugEnabled };
}

async function broadcastStateToAllGuardedTabs() {
  try {
    const store = await getStore();
    const origins = Object.entries(store.origins).filter(([, originState]) => (
      originState.trainingEnabled || originState.protectionEnabled
    ));
    await Promise.all(origins.map(([origin]) => refreshOriginTabs(origin)));
  } catch (_) {}
}

async function getPopupState(tabUrl) {
  const page = parsePageUrl(tabUrl);
  if (!page) {
    return { ok: true, supported: false, origin: '', hostname: '', permissionGranted: false };
  }

  const store = await getStore();
  let originState = store.origins[page.origin];
  if (!originState && hasStarterRules(page.origin)) {
    originState = ensureOriginState(store, page.origin);
    applyStarterRules(originState, page.origin);
    await setStore(store);
  }

  return {
    ok: true,
    supported: true,
    origin: page.origin,
    hostname: page.hostname,
    permissionGranted: await hasHostPermission(page.origin),
    originState: sanitizeOriginState(originState || createOriginState()),
    debugEnabled,
  };
}

async function setOriginFlags(origin, flags, tabId) {
  assertOrigin(origin);

  if ((flags.trainingEnabled || flags.protectionEnabled) && !await hasHostPermission(origin)) {
    throw new Error(`No Way! does not have access to ${origin}`);
  }

  const store = await getStore();
  const originState = ensureOriginState(store, origin);
  applyStarterRules(originState, origin);

  if (typeof flags.trainingEnabled === 'boolean') {
    originState.trainingEnabled = flags.trainingEnabled;
  }
  if (typeof flags.protectionEnabled === 'boolean') {
    originState.protectionEnabled = flags.protectionEnabled;
  }
  if (typeof flags.protectionAllowOnce === 'boolean') {
    originState.protectionAllowOnce = flags.protectionAllowOnce;
  }
  originState.updatedAt = nowIso();

  await setStore(store);
  await syncOriginContentScripts(origin, originState);
  const tabSyncResults = await refreshOriginTabs(origin, {
    fallbackTabId: tabId,
  });

  return {
    ok: true,
    originState: sanitizeOriginState(originState),
    permissionGranted: await hasHostPermission(origin),
    tabSyncResults,
  };
}

async function getPageStateForSender(sender) {
  const page = parsePageUrl(sender.tab?.url || sender.url);
  if (!page || !await hasHostPermission(page.origin)) {
    debugLog({ stage: 'pageState', origin: page?.origin || '', granted: false });
    return pageState(null, null);
  }
  debugLog({ stage: 'pageState', origin: page.origin, granted: true });

  const store = await getStore();
  const originState = ensureOriginState(store, page.origin);
  const changed = applyStarterRules(originState, page.origin);
  if (changed) await setStore(store);

  return pageState(page.origin, originState);
}

async function createRuleForSender(sender, candidate) {
  const page = parsePageUrl(sender.tab?.url || sender.url);
  if (!page || !await hasHostPermission(page.origin)) {
    throw new Error('Cannot create a rule without page access.');
  }
  debugLog({ stage: 'createRule', origin: page.origin, actionKey: candidate?.actionKey, label: candidate?.label });

  const normalized = normalizeCandidate(candidate);
  if (!normalized) throw new Error('Invalid training candidate.');

  const store = await getStore();
  const originState = ensureOriginState(store, page.origin);
  applyStarterRules(originState, page.origin);

  const duplicate = findDuplicateRule(originState.rules, normalized);
  const timestamp = nowIso();
  if (duplicate) {
    duplicate.kind = 'block';
    duplicate.enabled = true;
    duplicate.updatedAt = timestamp;
    duplicate.hitCount = duplicate.hitCount || 0;
  } else {
    originState.rules.push({
      id: createRuleId(),
      source: 'learned',
      kind: 'block',
      enabled: true,
      actionKey: normalized.actionKey,
      label: normalized.label,
      match: normalized.match,
      confidence: normalized.confidence,
      createdAt: timestamp,
      updatedAt: timestamp,
      hitCount: 0,
    });
  }

  originState.updatedAt = timestamp;
  await setStore(store);
  await refreshOriginTabs(page.origin);

  return pageState(page.origin, originState);
}

async function allowRuleForSender(sender, candidate) {
  const page = parsePageUrl(sender.tab?.url || sender.url);
  if (!page || !await hasHostPermission(page.origin)) {
    throw new Error('Cannot create a rule without page access.');
  }
  debugLog({ stage: 'allowRule', origin: page.origin, actionKey: candidate?.actionKey, label: candidate?.label });

  const normalized = normalizeCandidate(candidate);
  if (!normalized) throw new Error('Invalid training candidate.');

  const store = await getStore();
  const originState = ensureOriginState(store, page.origin);
  applyStarterRules(originState, page.origin);

  const duplicate = findDuplicateRule(originState.rules, normalized);
  const timestamp = nowIso();
  if (duplicate) {
    duplicate.kind = 'allow';
    duplicate.enabled = true;
    duplicate.updatedAt = timestamp;
  } else {
    originState.rules.push({
      id: createRuleId(),
      source: 'learned',
      kind: 'allow',
      enabled: true,
      actionKey: normalized.actionKey,
      label: normalized.label,
      match: normalized.match,
      confidence: normalized.confidence,
      createdAt: timestamp,
      updatedAt: timestamp,
      hitCount: 0,
    });
  }

  originState.updatedAt = timestamp;
  await setStore(store);
  await refreshOriginTabs(page.origin);

  return pageState(page.origin, originState);
}

async function recordRuleHitForSender(sender, ruleId) {
  const page = parsePageUrl(sender.tab?.url || sender.url);
  if (!page || !ruleId) return { ok: true };

  const store = await getStore();
  const originState = store.origins[page.origin];
  const rule = originState?.rules?.find((item) => item.id === ruleId);
  if (!rule) return { ok: true };

  rule.hitCount = (rule.hitCount || 0) + 1;
  rule.updatedAt = nowIso();
  await setStore(store);
  return { ok: true };
}

async function exportRules(originsFilter) {
  const store = await getStore();
  let origins = store.origins;

  if (Array.isArray(originsFilter) && originsFilter.length) {
    const wanted = new Set(originsFilter);
    origins = Object.fromEntries(
      Object.entries(store.origins).filter(([origin]) => wanted.has(origin))
    );
    if (!Object.keys(origins).length) {
      throw new Error('No matching origins to export.');
    }
  }

  return {
    ok: true,
    payload: {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: nowIso(),
      origins,
    },
  };
}

async function importRules(payload) {
  const imported = normalizeImportPayload(payload);
  const store = await getStore();
  const touchedOrigins = new Set();

  for (const [origin, incomingState] of Object.entries(imported.origins)) {
    const originState = ensureOriginState(store, origin);
    originState.trainingEnabled = Boolean(incomingState.trainingEnabled);
    originState.protectionEnabled = Boolean(incomingState.protectionEnabled);
    originState.protectionAllowOnce = Boolean(incomingState.protectionAllowOnce);
    originState.deletedStarterRuleIds = incomingState.deletedStarterRuleIds;
    originState.updatedAt = nowIso();

    const existingById = new Map(originState.rules.map((rule) => [rule.id, rule]));
    for (const incomingRule of incomingState.rules) {
      existingById.set(incomingRule.id, incomingRule);
    }
    originState.rules = [...existingById.values()];
    removeDeletedStarterRules(originState);
    applyStarterRules(originState, origin);
    touchedOrigins.add(origin);
  }

  await setStore(store);
  await syncRegisteredContentScripts();
  await Promise.all([...touchedOrigins].map((origin) => refreshOriginTabs(origin)));
  return getRulesView();
}

async function getRulesView() {
  const store = await getStore();
  const origins = {};
  for (const [origin, originState] of Object.entries(store.origins)) {
    origins[origin] = {
      ...sanitizeOriginState(originState),
      permissionGranted: await hasHostPermission(origin),
    };
  }

  return { ok: true, schemaVersion: SCHEMA_VERSION, origins };
}

async function updateRule(origin, ruleId, changes = {}) {
  assertOrigin(origin);
  const store = await getStore();
  const rule = store.origins[origin]?.rules?.find((item) => item.id === ruleId);
  if (!rule) throw new Error('Rule not found.');

  if (typeof changes.enabled === 'boolean') rule.enabled = changes.enabled;
  if (changes.kind === 'allow' || changes.kind === 'block') {
    if (rule.source === 'starter' && changes.kind !== 'block') {
      throw new Error('Starter rules can only be Block. Delete the starter or add a learned Allow rule.');
    }
    rule.kind = changes.kind;
  }
  if (changes.label) rule.label = cleanString(changes.label, 120);
  if (changes.actionKey) rule.actionKey = cleanString(changes.actionKey, 60);
  if (changes.match && typeof changes.match === 'object') {
    rule.match = sanitizeMatch(changes.match);
  }
  if (typeof changes.confidence === 'number') {
    rule.confidence = clamp(changes.confidence, 0.1, 0.99);
  }

  rule.updatedAt = nowIso();

  await setStore(store);
  await refreshOriginTabs(origin);
  return getRulesView();
}

async function deleteRule(origin, ruleId) {
  return deleteRules([{ origin, ruleId }]);
}

async function deleteRules(items = []) {
  if (!Array.isArray(items) || !items.length) throw new Error('No rules selected.');

  const store = await getStore();
  const touchedOrigins = new Set();
  const timestamp = nowIso();
  let deletedCount = 0;

  for (const item of items) {
    const origin = item?.origin;
    const ruleId = item?.ruleId;
    assertOrigin(origin);

    const originState = store.origins[origin];
    if (!originState) continue;
    if (!removeRuleFromOrigin(originState, ruleId)) continue;

    originState.updatedAt = timestamp;
    touchedOrigins.add(origin);
    deletedCount += 1;
  }

  if (!deletedCount) throw new Error('Rule not found.');

  await setStore(store);
  await Promise.all([...touchedOrigins].map((origin) => refreshOriginTabs(origin)));
  return getRulesView();
}

async function handleRemovedHostPermissions(origins) {
  const store = await getStore();
  let changed = false;

  for (const pattern of origins) {
    const origin = originFromMatchPattern(pattern);
    if (!origin || !store.origins[origin]) continue;

    store.origins[origin].trainingEnabled = false;
    store.origins[origin].protectionEnabled = false;
    store.origins[origin].protectionAllowOnce = false;
    store.origins[origin].updatedAt = nowIso();
    changed = true;
  }

  if (changed) await setStore(store);
  await syncRegisteredContentScripts();
}

async function syncRegisteredContentScripts() {
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const ids = registered
    .map((script) => script.id)
    .filter((id) => id.startsWith(`${SCRIPT_PREFIX}-`));

  if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });

  const store = await getStore();
  for (const [origin, originState] of Object.entries(store.origins)) {
    await syncOriginContentScripts(origin, originState);
  }
}

async function syncOriginContentScripts(origin, originState) {
  const ids = contentScriptIds(origin);
  try {
    await chrome.scripting.unregisterContentScripts({ ids });
  } catch (_) {}

  if (!originState.trainingEnabled && !originState.protectionEnabled) return;
  if (!await hasHostPermission(origin)) return;

  await chrome.scripting.registerContentScripts([
    {
      id: ids.main,
      matches: [matchPatternFromOrigin(origin)],
      js: [MAIN_SCRIPT],
      runAt: 'document_start',
      world: 'MAIN',
      allFrames: true,
      persistAcrossSessions: true,
    },
    {
      id: ids.controller,
      matches: [matchPatternFromOrigin(origin)],
      js: [CONTROLLER_SCRIPT],
      runAt: 'document_start',
      world: 'ISOLATED',
      allFrames: true,
      persistAcrossSessions: true,
    },
  ]);
}

async function injectIntoTab(tabId) {
  try {
    debugLog({ stage: 'inject', tabId });
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [MAIN_SCRIPT],
      world: 'MAIN',
    });
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [CONTROLLER_SCRIPT],
      world: 'ISOLATED',
    });
    debugLog({ stage: 'inject', tabId, result: 'ok' });
  } catch (error) {
    debugLog({ stage: 'inject', tabId, result: 'error', error: error.message });
    console.warn('[No Way!] Could not inject into current tab:', error.message);
  }
}

async function syncTabState(tabId, origin, retries = 3) {
  const store = await getStore();
  const state = pageState(origin, store.origins[origin] || createOriginState());
  let injected = false;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const pong = await pingTab(tabId);
    if (!pong) {
      debugLog({ stage: 'syncTabState', tabId, attempt, result: 'ping-miss' });
      try {
        await injectIntoTab(tabId);
        injected = true;
        // Give scripts a moment to initialise before pushing state
        await new Promise((r) => setTimeout(r, 120));
      } catch (error) {
        debugLog({ stage: 'syncTabState', tabId, attempt, result: 'inject-error', error: error.message });
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        return { tabId, ok: false, injected };
      }
    }

    try {
      await chrome.tabs.sendMessage(tabId, { type: 'NOWAY_STATE_CHANGED', state });
      debugLog({ stage: 'syncTabState', tabId, attempt, result: 'ok', injected });
      return { tabId, ok: true, injected };
    } catch (error) {
      debugLog({ stage: 'syncTabState', tabId, attempt, result: 'send-error', error: error.message });
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      return { tabId, ok: false, injected };
    }
  }

  return { tabId, ok: false, injected };
}

async function pingTab(tabId, timeoutMs = 400) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    chrome.tabs.sendMessage(tabId, { type: 'NOWAY_PING' }, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        resolve(false);
      } else {
        resolve(Boolean(response?.type === 'NOWAY_PONG'));
      }
    });
  });
}

async function refreshOriginTabs(origin, options = {}) {
  try {
    const store = await getStore();
    const state = pageState(origin, store.origins[origin] || createOriginState());
    const tabs = await chrome.tabs.query({ url: matchPatternFromOrigin(origin) });
    const tabIds = new Set(tabs.map((tab) => tab.id).filter(Boolean));
    if (options.fallbackTabId) tabIds.add(options.fallbackTabId);

    const results = await Promise.all([...tabIds].map((tabId) => syncTabState(tabId, origin)));
    return results;
  } catch (_) {
    return [];
  }
}

function pageState(origin, originState) {
  if (!origin || !originState) {
    return {
      ok: true,
      origin: '',
      trainingEnabled: false,
      protectionEnabled: false,
      protectionAllowOnce: false,
      rules: [],
      debugEnabled,
    };
  }

  const rules = originState.rules
    .filter((rule) => rule.enabled && (originState.trainingEnabled || originState.protectionEnabled))
    .map(sanitizeRuleForContent);

  return {
    ok: true,
    origin,
    trainingEnabled: Boolean(originState.trainingEnabled),
    protectionEnabled: Boolean(originState.protectionEnabled),
    protectionAllowOnce: Boolean(originState.protectionAllowOnce),
    rules,
    debugEnabled,
  };
}

function sanitizeRuleForContent(rule) {
  return {
    id: rule.id,
    enabled: Boolean(rule.enabled),
    kind: rule.kind === 'allow' ? 'allow' : 'block',
    actionKey: String(rule.actionKey || ''),
    label: String(rule.label || 'Blocked action'),
    match: sanitizeMatch(rule.match),
  };
}

function sanitizeOriginState(originState) {
  const rules = Array.isArray(originState.rules) ? originState.rules : [];
  return {
    trainingEnabled: Boolean(originState.trainingEnabled),
    protectionEnabled: Boolean(originState.protectionEnabled),
    protectionAllowOnce: Boolean(originState.protectionAllowOnce),
    deletedStarterRuleIds: sanitizeStringArray(originState.deletedStarterRuleIds, 200, 120),
    rules: rules.map((rule) => ({
      id: rule.id,
      source: rule.source || 'learned',
      kind: rule.kind === 'allow' ? 'allow' : 'block',
      enabled: Boolean(rule.enabled),
      actionKey: rule.actionKey || '',
      label: rule.label || 'Blocked action',
      match: sanitizeMatch(rule.match),
      confidence: Number(rule.confidence || 0),
      createdAt: rule.createdAt || '',
      updatedAt: rule.updatedAt || '',
      hitCount: Number(rule.hitCount || 0),
    })),
    updatedAt: originState.updatedAt || '',
  };
}

function ensureOriginState(store, origin) {
  assertOrigin(origin);
  if (!store.origins[origin] || typeof store.origins[origin] !== 'object') {
    store.origins[origin] = createOriginState();
  }
  const originState = store.origins[origin];
  originState.trainingEnabled = Boolean(originState.trainingEnabled);
  originState.protectionEnabled = Boolean(originState.protectionEnabled);
  originState.protectionAllowOnce = Boolean(originState.protectionAllowOnce);
  originState.rules = Array.isArray(originState.rules) ? originState.rules : [];
  for (const rule of originState.rules) inflateRuleKind(rule);
  originState.deletedStarterRuleIds = sanitizeStringArray(originState.deletedStarterRuleIds, 200, 120);
  originState.updatedAt = originState.updatedAt || nowIso();
  return originState;
}

// Backfill kind on rules that pre-date the field. Any learned rule that was
// stored as disabled was the old broken "Always allow" path; revive it as an
// enabled allow rule so the user's intent is honoured. Also strips legacy
// metadata so rules remain pattern-only.
function inflateRuleKind(rule) {
  if (!rule || typeof rule !== 'object') return;
  if (rule.kind !== 'allow' && rule.kind !== 'block') {
    if (rule.source !== 'starter' && rule.enabled === false) {
      rule.kind = 'allow';
      rule.enabled = true;
    } else {
      rule.kind = 'block';
    }
  }
  if ('classifier' in rule) delete rule.classifier;
}

function createOriginState() {
  return {
    trainingEnabled: false,
    protectionEnabled: false,
    protectionAllowOnce: false,
    rules: [],
    deletedStarterRuleIds: [],
    updatedAt: nowIso(),
  };
}

function hasStarterRules(origin) {
  return new URL(origin).hostname === 'www.linkedin.com';
}

function applyStarterRules(originState, origin) {
  if (!hasStarterRules(origin)) return false;

  let changed = false;
  const existing = new Set(originState.rules.map((rule) => rule.id));
  const deleted = new Set(sanitizeStringArray(originState.deletedStarterRuleIds, 200, 120));
  originState.deletedStarterRuleIds = [...deleted];
  for (const template of LINKEDIN_STARTER_RULES) {
    if (deleted.has(template.id)) continue;
    if (existing.has(template.id)) continue;
    const timestamp = nowIso();
    originState.rules.push({
      ...template,
      source: 'starter',
      kind: 'block',
      enabled: true,
      match: sanitizeMatch(template.match),
      createdAt: timestamp,
      updatedAt: timestamp,
      hitCount: 0,
    });
    changed = true;
  }

  return changed;
}

function removeRuleFromOrigin(originState, ruleId) {
  const id = cleanString(ruleId, 120);
  if (!id) return false;

  originState.rules = Array.isArray(originState.rules) ? originState.rules : [];
  const rule = originState.rules.find((item) => item.id === id);
  if (!rule) return false;

  if (rule.source === 'starter') {
    const deleted = new Set(sanitizeStringArray(originState.deletedStarterRuleIds, 200, 120));
    deleted.add(id);
    originState.deletedStarterRuleIds = [...deleted].slice(0, 200);
  }

  originState.rules = originState.rules.filter((item) => item.id !== id);
  return true;
}

function removeDeletedStarterRules(originState) {
  const deleted = new Set(sanitizeStringArray(originState.deletedStarterRuleIds, 200, 120));
  originState.deletedStarterRuleIds = [...deleted];
  originState.rules = originState.rules.filter((rule) => rule.source !== 'starter' || !deleted.has(rule.id));
}

function findDuplicateRule(rules, candidate) {
  return rules.find((rule) => {
    if (rule.source === 'starter') return false;
    if (rule.actionKey !== candidate.actionKey) return false;
    if (normalizeText(rule.match?.label || rule.label) !== normalizeText(candidate.match.label)) return false;
    return true;
  });
}

function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;

  const actionKey = cleanString(candidate.actionKey || 'interaction', 60);
  const label = cleanString(candidate.label || 'Interaction', 120);
  const match = sanitizeMatch(candidate.match || {});
  match.actionKey = actionKey;
  match.label = label;
  match.labelNorm = normalizeText(match.labelNorm || label);

  if (!match.selectors.length && !match.labelNorm) return null;

  return {
    actionKey,
    label,
    match,
    confidence: clamp(Number(candidate.confidence || 0.55), 0.1, 0.99),
  };
}

function sanitizeMatch(match = {}) {
  return {
    selectors: sanitizeStringArray(match.selectors, 20, 240),
    textLabels: sanitizeStringArray(match.textLabels, 30, 120).map(normalizeText),
    actionKey: cleanString(match.actionKey || '', 60),
    label: cleanString(match.label || '', 120),
    labelNorm: normalizeText(match.labelNorm || match.label || ''),
    role: cleanString(match.role || '', 60),
    tag: cleanString(match.tag || '', 30),
    inputType: cleanString(match.inputType || '', 40),
    testId: cleanString(match.testId || '', 120),
    stableId: cleanString(match.stableId || '', 120),
    formLabel: cleanString(match.formLabel || '', 120),
  };
}

function normalizeImportPayload(payload) {
  if (!payload || payload.schemaVersion !== SCHEMA_VERSION || typeof payload.origins !== 'object') {
    throw new Error('Unsupported or invalid No Way! rules file.');
  }

  const origins = {};
  for (const [origin, rawState] of Object.entries(payload.origins)) {
    assertOrigin(origin);
    const rules = Array.isArray(rawState.rules) ? rawState.rules : [];
    origins[origin] = {
      trainingEnabled: Boolean(rawState.trainingEnabled),
      protectionEnabled: Boolean(rawState.protectionEnabled),
      protectionAllowOnce: Boolean(rawState.protectionAllowOnce),
      deletedStarterRuleIds: sanitizeStringArray(rawState.deletedStarterRuleIds, 200, 120),
      rules: rules.map((rule) => normalizeImportedRule(rule)).filter(Boolean),
    };
  }

  return { schemaVersion: SCHEMA_VERSION, origins };
}

function normalizeImportedRule(rule) {
  if (!rule || typeof rule !== 'object') return null;
  const id = cleanString(rule.id || createRuleId(), 120);
  const label = cleanString(rule.label || 'Imported rule', 120);
  const actionKey = cleanString(rule.actionKey || 'interaction', 60);
  const match = sanitizeMatch(rule.match || {});
  if (!match.selectors.length && !match.labelNorm && !match.textLabels.length) return null;

  const source = rule.source === 'starter' ? 'starter' : 'learned';
  let kind = rule.kind === 'allow' ? 'allow' : (rule.kind === 'block' ? 'block' : null);
  let enabled = rule.enabled !== false;
  if (!kind) {
    if (source !== 'starter' && rule.enabled === false) {
      kind = 'allow';
      enabled = true;
    } else {
      kind = 'block';
    }
  }
  return {
    id,
    source,
    kind,
    enabled,
    actionKey,
    label,
    match,
    confidence: clamp(Number(rule.confidence || 0.5), 0.1, 0.99),
    createdAt: cleanString(rule.createdAt || nowIso(), 40),
    updatedAt: cleanString(rule.updatedAt || nowIso(), 40),
    hitCount: Math.max(0, Number.parseInt(rule.hitCount || 0, 10) || 0),
  };
}

async function ensureStore() {
  const store = await getStore();
  await setStore(store);
  return store;
}

async function getStore() {
  const data = await chrome.storage.local.get(STORE_KEY);
  const store = data[STORE_KEY];
  if (!store || store.schemaVersion !== SCHEMA_VERSION || typeof store.origins !== 'object') {
    return { schemaVersion: SCHEMA_VERSION, origins: {} };
  }
  stripLegacyRuleMetadata(store);
  return store;
}

async function setStore(store) {
  stripLegacyRuleMetadata(store);
  store.schemaVersion = SCHEMA_VERSION;
  store.updatedAt = nowIso();
  await chrome.storage.local.set({ [STORE_KEY]: store });
}

function stripLegacyRuleMetadata(store) {
  if (!store?.origins || typeof store.origins !== 'object') return;
  for (const originState of Object.values(store.origins)) {
    const rules = Array.isArray(originState?.rules) ? originState.rules : [];
    for (const rule of rules) {
      if (rule && typeof rule === 'object' && 'classifier' in rule) {
        delete rule.classifier;
      }
    }
  }
}

async function hasHostPermission(origin) {
  return chrome.permissions.contains({ origins: [matchPatternFromOrigin(origin)] });
}

function parsePageUrl(urlText) {
  try {
    const url = new URL(urlText || '');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return { origin: url.origin, hostname: url.hostname };
  } catch (_) {
    return null;
  }
}

function assertOrigin(origin) {
  const page = parsePageUrl(origin);
  if (!page || page.origin !== origin) throw new Error(`Unsupported origin: ${origin}`);
}

function matchPatternFromOrigin(origin) {
  assertOrigin(origin);
  return `${origin}/*`;
}

function originFromMatchPattern(pattern) {
  if (!pattern?.endsWith('/*')) return null;
  return parsePageUrl(pattern.slice(0, -2))?.origin || null;
}

function contentScriptIds(origin) {
  const key = stableHash(origin);
  return {
    main: `${SCRIPT_PREFIX}-main-${key}`,
    controller: `${SCRIPT_PREFIX}-controller-${key}`,
  };
}

function stableHash(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) + text.charCodeAt(i);
    hash >>>= 0;
  }
  return hash.toString(36);
}

function createRuleId() {
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function cleanString(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function sanitizeStringArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const output = [];
  for (const item of value) {
    const text = cleanString(item, maxLength);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
    if (output.length >= maxItems) break;
  }
  return output;
}

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
