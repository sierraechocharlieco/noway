const els = {
  dot: document.getElementById('status-dot'),
  status: document.getElementById('status-text'),
  site: document.getElementById('current-site'),
  grant: document.getElementById('grant-access'),
  training: document.getElementById('training-toggle'),
  protection: document.getElementById('protection-toggle'),
  allowOnce: document.getElementById('allow-once-toggle'),
  debug: document.getElementById('debug-toggle'),
  ruleCount: document.getElementById('rule-count'),
  openRules: document.getElementById('open-rules'),
  exportRules: document.getElementById('export-rules'),
  importRules: document.getElementById('import-rules'),
  importFile: document.getElementById('import-file'),
  message: document.getElementById('message'),
  syncStatus: document.getElementById('sync-status'),
};

let currentTab = null;
let currentState = null;
let busy = false;

init();

async function init() {
  currentTab = await getActiveTab();
  await refresh();

  els.grant.addEventListener('click', async () => {
    const granted = await requestAccess();
    if (granted) await syncCurrentFlags();
    await refresh();
  });

  els.training.addEventListener('change', async () => {
    await setFlags({ trainingEnabled: els.training.checked });
  });

  els.protection.addEventListener('change', async () => {
    await setFlags({ protectionEnabled: els.protection.checked });
  });

  els.allowOnce.addEventListener('change', async () => {
    await setFlags({ protectionAllowOnce: els.allowOnce.checked });
  });

  els.debug.addEventListener('change', async () => {
    await setDebugFlag(els.debug.checked);
  });

  els.openRules.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  els.exportRules.addEventListener('click', () => {
    // Export selection lives in the rule manager where there's room for a chooser.
    chrome.runtime.openOptionsPage();
  });
  els.importRules.addEventListener('click', () => els.importFile.click());
  els.importFile.addEventListener('change', importRules);
}

async function refresh() {
  setBusy(true);
  try {
    currentTab = await getActiveTab();
    currentState = await chrome.runtime.sendMessage({
      type: 'NOWAY_GET_POPUP_STATE',
      tabUrl: tabUrl(currentTab),
    });
    render();
  } catch (error) {
    setMessage(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

async function getActiveTab() {
  const queries = [
    { active: true, lastFocusedWindow: true },
    { active: true, currentWindow: true },
  ];

  for (const query of queries) {
    const tabs = await chrome.tabs.query(query);
    const tab = tabs.find((item) => isSupportedUrl(tabUrl(item))) || tabs[0];
    if (tab) return tab;
  }

  return null;
}

function tabUrl(tab) {
  return tab?.url || tab?.pendingUrl || '';
}

function isSupportedUrl(urlText) {
  try {
    const url = new URL(urlText || '');
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function render() {
  const supported = Boolean(currentState?.supported);
  const originState = currentState?.originState || { rules: [] };
  const hasAccess = Boolean(currentState?.permissionGranted);
  const training = Boolean(originState.trainingEnabled);
  const protection = Boolean(originState.protectionEnabled);

  els.site.textContent = currentState?.hostname || '-';
  els.ruleCount.textContent = String(originState.rules?.length || 0);

  els.dot.className = 'status-dot';
  if (!supported) {
    els.status.textContent = 'Unsupported page';
  } else if (!hasAccess) {
    els.status.textContent = 'Access needed';
  } else if (training) {
    els.dot.classList.add('training');
    els.status.textContent = 'Training active';
  } else if (protection) {
    els.dot.classList.add('active');
    els.status.textContent = 'Protection active';
  } else {
    els.status.textContent = 'Access granted';
  }

  els.grant.hidden = !supported || hasAccess;
  els.training.checked = training;
  els.protection.checked = protection;
  els.allowOnce.checked = Boolean(originState.protectionAllowOnce);
  els.debug.checked = Boolean(currentState?.debugEnabled);
  els.training.disabled = !supported || !hasAccess || busy;
  els.protection.disabled = !supported || !hasAccess || busy;
  els.allowOnce.disabled = !supported || !hasAccess || busy || !protection;
  els.debug.disabled = busy;
  els.grant.disabled = !supported || busy;
  els.exportRules.disabled = busy;
  els.importRules.disabled = busy;
  els.openRules.disabled = busy;

  if (!supported) {
    setMessage('Open an http or https site to train No Way!.');
  } else if (!hasAccess) {
    setMessage('Grant this origin before enabling training or protection.');
  } else {
    setMessage('');
  }
}

async function setFlags(flags) {
  if (!currentState?.origin) return;

  if ((flags.trainingEnabled || flags.protectionEnabled) && !currentState.permissionGranted) {
    const granted = await requestAccess();
    if (!granted) {
      await refresh();
      return;
    }
  }

  // Optimistically update local state so render() never snaps toggles back to old values
  if (typeof flags.trainingEnabled === 'boolean') {
    currentState.originState = { ...(currentState.originState || {}), trainingEnabled: flags.trainingEnabled };
  }
  if (typeof flags.protectionEnabled === 'boolean') {
    currentState.originState = { ...(currentState.originState || {}), protectionEnabled: flags.protectionEnabled };
  }
  if (typeof flags.protectionAllowOnce === 'boolean') {
    currentState.originState = { ...(currentState.originState || {}), protectionAllowOnce: flags.protectionAllowOnce };
  }

  setBusy(true);
  els.syncStatus.textContent = 'Syncing…';
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'NOWAY_SET_ORIGIN_FLAGS',
      origin: currentState.origin,
      tabId: currentTab?.id,
      ...flags,
    });
    if (!response?.ok) throw new Error(response?.error || 'Could not update site state');
    currentState.originState = response.originState;
    currentState.permissionGranted = response.permissionGranted;

    const anyFailed = Array.isArray(response.tabSyncResults)
      && response.tabSyncResults.some((r) => !r.ok);
    if (anyFailed) {
      els.syncStatus.textContent = 'Some tabs may need a refresh.';
    } else {
      els.syncStatus.textContent = '';
    }

    render();
  } catch (error) {
    els.syncStatus.textContent = '';
    setMessage(error.message || String(error));
    await refresh();
  } finally {
    setBusy(false);
  }
}

async function setDebugFlag(enabled) {
  setBusy(true);
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'NOWAY_SET_DEBUG_FLAG',
      enabled,
    });
    if (!response?.ok) throw new Error(response?.error || 'Could not update debug flag');
    if (currentState) currentState.debugEnabled = Boolean(response.debugEnabled);
  } catch (error) {
    setMessage(error.message || String(error));
    await refresh();
  } finally {
    setBusy(false);
  }
}

async function requestAccess() {
  if (!currentState?.origin) return false;
  const pattern = `${currentState.origin}/*`;
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) setMessage('Site access was not granted.');
  return granted;
}

async function syncCurrentFlags() {
  if (!currentState?.origin) return;
  const originState = currentState.originState || {};
  await chrome.runtime.sendMessage({
    type: 'NOWAY_SET_ORIGIN_FLAGS',
    origin: currentState.origin,
    tabId: currentTab?.id,
    trainingEnabled: Boolean(originState.trainingEnabled),
    protectionEnabled: Boolean(originState.protectionEnabled),
    protectionAllowOnce: Boolean(originState.protectionAllowOnce),
  });
}

async function importRules() {
  const file = els.importFile.files?.[0];
  els.importFile.value = '';
  if (!file) return;

  try {
    const payload = JSON.parse(await file.text());
    const response = await chrome.runtime.sendMessage({ type: 'NOWAY_IMPORT_RULES', payload });
    if (!response?.ok) throw new Error(response?.error || 'Import failed');
    setMessage('Rules imported.');
    await refresh();
  } catch (error) {
    setMessage(error.message || String(error));
  }
}

function setBusy(nextBusy) {
  busy = nextBusy;
  // Only re-render when becoming non-busy; becoming busy is handled by optimistic updates.
  if (!busy && currentState) render();
}

function setMessage(text) {
  els.message.textContent = text || '';
}
