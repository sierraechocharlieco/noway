(async () => {
  'use strict';

  if (window.__NOWAY_CONTROLLER_INSTALLED__) {
    try {
      await chrome.runtime.sendMessage({ type: 'NOWAY_PING' });
      return;
    } catch (_) {
      window.__NOWAY_CONTROLLER_INSTALLED__ = false;
    }
  }
  window.__NOWAY_CONTROLLER_INSTALLED__ = true;

  // Import the shared policy instead of registering its path in both worlds.
  // Chrome deduplicates registered file paths across worlds on fresh navigation.
  try {
    await import(chrome.runtime.getURL('shared/auto.js'));
  } catch (error) {
    window.__NOWAY_CONTROLLER_INSTALLED__ = false;
    console.error('[No Way!] Could not load action policy:', error);
    return;
  }

  NoWayBrand.loadFonts();

  const SOURCE_MAIN = 'NOWAY_MAIN';
  const SOURCE_CONTROLLER = 'NOWAY_CONTROLLER';
  const BADGE_ID = 'noway-badge';
  const PROMPT_ID = 'noway-training-prompt';
  const TOAST_HIDE_DELAY_MS = 5200;

  let currentState = {
    origin: location.origin,
    trainingEnabled: false,
    protectionEnabled: false,
    protectionAllowOnce: false,
    rules: [],
  };
  let autoEpoch = 0;
  let autoObserver = null;
  let autoDiscoveryTimer = null;
  const autoChecks = new Map();
  const autoCache = new Map();
  const speculativeChecks = new Set();
  let discoveryRunning = false;
  let lastActivationElements = [];
  let activeAutoRequest = null;
  let visiblePrompt = null;
  // Window capture runs before MAIN's document guard and gives ISOLATED its own references,
  // including controls inside open shadow roots. A bridge token alone is not authority.
  for (const type of ['pointerdown', 'mousedown', 'touchstart', 'click', 'dblclick', 'keydown', 'submit', 'auxclick']) {
    window.addEventListener(type, (event) => {
      lastActivationElements = [event.submitter, ...(event.composedPath?.() || [event.target])]
        .filter((el) => el?.nodeType === Node.ELEMENT_NODE).slice(0, 50);
    }, { capture: true, passive: true });
  }
  let stateInitialized = false;
  const activeToasts = [];
  const toastObserver = new ResizeObserver(() => arrangeToasts());
  // Declared before teardown() can run; it may be called before the timers below are set up.
  let refreshRetryTimer = null;
  let navTimeout = null;
  let periodicRefreshId = null;

  function debugLog(entry) {
    if (!currentState.debugEnabled) return;
    const record = { source: 'controller', time: Date.now(), ...entry };
    console.log('[No Way!]', JSON.stringify(record));
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || !data || data.source !== SOURCE_MAIN) return;

    if (data.type === 'NOWAY_READY') {
      if (stateInitialized) pushStateToMain();
    } else if (data.type === 'NOWAY_NAVIGATED') {
      invalidateAuto();
      removePrompt();
    } else if (data.type === 'NOWAY_AUTO_CHECK') {
      checkAutoAction(data.payload);
    } else if (data.type === 'NOWAY_PROMPT') {
      // Keep review and rule writes inside the originating authorized frame.
      showPrompt(data.payload?.candidate, data.payload?.mode, data.payload?.matchingRule);
    } else if (data.type === 'NOWAY_BLOCKED') {
      showToast(`Action stopped: ${data.payload?.label || 'Blocked action'}`, 'blocked');
    } else if (data.type === 'NOWAY_RULE_HIT') {
      recordRuleHit(data.payload?.ruleId);
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'NOWAY_AUTO_VALIDATE') {
      const el = autoTarget(message.token);
      const check = autoChecks.get(message.token);
      sendResponse({ ok: Boolean(el && check?.requestId === message.requestId && check.epoch === autoEpoch
        && currentState.auto?.revision === message.revision
        && NoWayAuto.key(NoWayAuto.snapshot(el, message.eventKind)) === message.evidenceKey) });
      return;
    }
    if (message?.type === 'NOWAY_PING') {
      sendResponse({ type: 'NOWAY_PONG' });
      return true;
    }
    if (message?.type !== 'NOWAY_STATE_CHANGED') return;
    if (message.changedOrigin && message.changedOrigin !== location.origin) return;
    if (message.state?.ok && message.state.origin === location.origin) {
      applyPageState(message.state);
    } else {
      refreshState();
    }
  });

  function isExtensionContextValid() {
    return Boolean(chrome.runtime?.id);
  }

  function teardown(reason) {
    debugLog({ stage: 'teardown', reason });
    clearTimeout(refreshRetryTimer);
    clearTimeout(navTimeout);
    clearInterval(periodicRefreshId);
    invalidateAuto();
    toastObserver.disconnect();
    for (const toast of activeToasts.splice(0)) toast.remove();
    removePrompt();
    const badge = document.getElementById(BADGE_ID);
    badge?.remove();
    currentState.trainingEnabled = false;
    currentState.protectionEnabled = false;
    pushStateToMain();
  }

  if (!isExtensionContextValid()) {
    teardown('context-invalid-on-load');
    return;
  }

  refreshState();

  // SPA navigation detection: re-fetch state after route changes
  function onNav() {
    invalidateAuto();
    removePrompt();
    clearTimeout(navTimeout);
    navTimeout = setTimeout(() => {
      debugLog({ stage: 'navigation', reason: 'spa-nav' });
      refreshState();
    }, 300);
  }

  if (!window.__NOWAY_CTRL_HISTORY_PATCHED__) {
    window.__NOWAY_CTRL_HISTORY_PATCHED__ = true;
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      onNav();
    };
    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      onNav();
    };
    window.addEventListener('popstate', onNav);
  }

  // Re-sync when tab becomes visible (handles suspension / SW wake-up)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      debugLog({ stage: 'visibility', reason: 'visible' });
      refreshState();
    }
  });

  // Periodic refresh for long-lived tabs
  periodicRefreshId = setInterval(() => {
    if (!isExtensionContextValid()) {
      clearInterval(periodicRefreshId);
      teardown('context-invalidated');
      return;
    }
    refreshState();
  }, 30000);

  async function refreshState() {
    if (!isExtensionContextValid()) {
      teardown('context-invalidated');
      return;
    }
    try {
      const response = await chrome.runtime.sendMessage({ type: 'NOWAY_GET_PAGE_STATE' });
      if (!response?.ok) throw new Error(response?.error || 'State unavailable');
      applyPageState(response);
    } catch (error) {
      const msg = error?.message || '';
      const contextGone = msg.includes('Extension context invalidated') || msg.includes('context invalidated');
      if (contextGone || !isExtensionContextValid()) {
        teardown('context-invalidated');
        return;
      }
      // Retry in 1s so transient SW startup delays don't leave the page unprotected.
      clearTimeout(refreshRetryTimer);
      refreshRetryTimer = setTimeout(refreshState, 1000);
    }
  }

  function applyPageState(response) {
    const changed = currentState.auto?.revision !== response.auto?.revision;
    if (changed) { invalidateAuto(); removePrompt(); }
    currentState = response;
    stateInitialized = true;
    debugLog({ stage: 'state', trainingEnabled: currentState.trainingEnabled, protectionEnabled: currentState.protectionEnabled, protectionAllowOnce: currentState.protectionAllowOnce, ruleCount: currentState.rules?.length || 0 });
    pushStateToMain();
    renderBadge();
    syncAutoDiscovery();
    if (!shouldShowPrompts()) removePrompt();

    // If both modes are off, tell the main-world script to tear down capture listeners
    if (!currentState.trainingEnabled && !currentState.protectionEnabled) {
      postToMain('NOWAY_SHUTDOWN', {});
    }
  }

  function autoTarget(token) {
    return /^[a-f0-9-]{36}$/.test(token || '')
      ? lastActivationElements.find((el) => el.isConnected && el.getAttribute('data-noway-auto-target') === token)
        || document.querySelector(`[data-noway-auto-target="${token}"]`) : null;
  }

  function invalidateAuto() {
    autoEpoch++;
    activeAutoRequest = null;
    autoChecks.clear();
    autoCache.clear();
    postToMain('NOWAY_AUTO_INVALIDATE', {});
    clearTimeout(autoDiscoveryTimer);
    autoObserver?.disconnect();
    autoObserver = null;
  }

  async function checkAutoAction(payload) {
    const el = autoTarget(payload?.token);
    if (!el || !currentState.trainingEnabled || currentState.auto?.strategy !== 'auto') return;
    const evidence = NoWayAuto.snapshot(el, payload.eventKind);
    if (NoWayAuto.key(evidence) !== payload.evidenceKey || payload.revision !== currentState.auto.revision) return;
    const epoch = autoEpoch;
    for (const [token, check] of autoChecks) {
      if (token !== payload.token) {
        postToMain('NOWAY_AUTO_RESULT', { ...check.payload, decision: 'uncertain' });
        autoChecks.delete(token);
      }
    }
    autoChecks.set(payload.token, { requestId: payload.requestId, epoch, payload });
    activeAutoRequest = payload.requestId;
    const valid = () => autoChecks.get(payload.token)?.requestId === payload.requestId && epoch === autoEpoch && el.isConnected
      && currentState.auto?.revision === payload.revision
      && NoWayAuto.key(NoWayAuto.snapshot(el, payload.eventKind)) === payload.evidenceKey;
    const finish = (decision) => {
      postToMain('NOWAY_AUTO_RESULT', { ...payload, decision });
      if (autoChecks.get(payload.token)?.requestId === payload.requestId) autoChecks.delete(payload.token);
    };
    if (currentState.auto.ready) showChecking(payload.token);
    try {
      const cached = autoCache.get(payload.token);
      const response = cached?.key === payload.evidenceKey && cached.expires > Date.now() && cached.response.decision === 'safe'
        ? cached.response : await chrome.runtime.sendMessage({ type: 'NOWAY_AUTO_CLASSIFY', evidence, revision: payload.revision, attempt: true });
      if (!valid()) { finish('uncertain'); if (activeAutoRequest === payload.requestId) removePrompt(); return; }
      if (response?.ok && response.decision === 'safe' && !NoWayAuto.actionFor(evidence)) {
        finish('safe'); removePrompt(); showToast('Click again within 10 seconds to continue.', 'allowed'); return;
      }
      if (response?.ok && response.decision === 'risky' && response.proof) {
        const candidate = NoWayAuto.candidate(evidence, response, payload.fingerprint);
        if (candidate) {
          const saved = await chrome.runtime.sendMessage({ type: 'NOWAY_AUTO_COMMIT', proof: response.proof,
            evidence, fingerprint: payload.fingerprint, token: payload.token, requestId: payload.requestId });
          if (saved?.ok) { applyPageState(saved); removePrompt(); showToast(`Rule saved: ${saved.label}`, 'blocked'); return; }
          showToast(saved?.error || 'Couldn’t save the rule. Try again.', 'error');
        }
      }
      finish('uncertain');
      const review = NoWayAuto.candidate(evidence, null, payload.fingerprint, true);
      removePrompt();
      if (review) showPrompt(review, 'auto-review');
      else showToast('Action blocked. Switch to manual training to review it.', 'error');
    } catch (_) {
      if (!valid()) return;
      finish('uncertain'); removePrompt();
      const review = NoWayAuto.candidate(evidence, null, payload.fingerprint, true);
      if (review) showPrompt(review, 'auto-review');
      else showToast('Action blocked. Start the model to use Auto.', 'error');
    }
  }

  function showChecking(token) {
    removePrompt();
    visiblePrompt = { kind: 'checking', token };
    const theme = getTheme('training');
    const panel = document.createElement('div');
    panel.id = PROMPT_ID;
    panel.setAttribute('data-noway-ui', '');
    panel.setAttribute('role', 'status');
    panel.style.cssText = `all:initial;box-sizing:border-box;position:fixed;top:16px;right:16px;z-index:2147483647;padding:20px;border-radius:12px;width:360px;max-width:calc(100vw - 32px);background:${theme.background};border:1px solid ${theme.border};color:${theme.text};font:16px/1.5 ${theme.font};box-shadow:${theme.shadow};display:flex;flex-direction:column;gap:12px`;
    const label = document.createElement('span');
    label.textContent = 'Checking…';
    label.style.cssText = `all:initial;color:${theme.text};font:16px/1.5 ${theme.font}`;
    const content = NoWayBrand.shadow(panel);
    content.appendChild(label);
    const cancel = promptButton('Cancel', theme, false);
    cancel.addEventListener('click', () => { autoChecks.delete(token); invalidateAuto(); removePrompt(); syncAutoDiscovery(); });
    content.appendChild(cancel);
    document.documentElement.appendChild(panel);
  }

  function syncAutoDiscovery() {
    if (!currentState.trainingEnabled || currentState.auto?.strategy !== 'auto' || !currentState.auto.ready) {
      autoObserver?.disconnect(); autoObserver = null; return;
    }
    if (autoObserver) return;
    autoObserver = new MutationObserver((mutations) => {
      const isUi = (node) => node.nodeType === 1 && node.closest?.('#noway-training-prompt,#noway-badge,[data-noway-ui],[data-noway-toast]');
      if (mutations.some((m) => !isUi(m.target) && (m.type !== 'childList'
        || [...m.addedNodes, ...m.removedNodes].some((node) => !isUi(node))))) scheduleDiscovery();
    });
    autoObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true,
      attributeFilter: ['aria-label', 'aria-labelledby', 'aria-pressed', 'aria-checked', 'aria-expanded', 'disabled', 'title', 'role', 'type', 'lang'] });
    scheduleDiscovery();
  }

  function scheduleDiscovery() {
    clearTimeout(autoDiscoveryTimer);
    autoDiscoveryTimer = setTimeout(discoverControls, 300);
  }

  async function preclassify(el) {
    if (!el?.isConnected || document.hidden || !currentState.trainingEnabled || !currentState.auto?.ready
      || currentState.auto.strategy !== 'auto' || el.closest('#noway-training-prompt,#noway-badge,[data-noway-ui]')) return;
    const evidence = NoWayAuto.snapshot(el, 'activate');
    if (evidence.disabled || !evidence.label || NoWayAuto.actionFor(evidence)) return;
    let token = el.getAttribute('data-noway-auto-target');
    if (!/^[a-f0-9-]{36}$/.test(token || '')) { token = NoWayAuto.uuid(); el.setAttribute('data-noway-auto-target', token); }
    const evidenceKey = NoWayAuto.key(evidence);
    const existing = autoCache.get(token);
    if (existing?.key === evidenceKey && existing.expires > Date.now()) return;
    if (autoChecks.has(token)) return;
    if (speculativeChecks.size) return;
    const epoch = autoEpoch;
    const speculativeKey = `${epoch}|${token}`;
    speculativeChecks.add(speculativeKey);
    const revision = currentState.auto.revision;
    autoCache.set(token, { key: evidenceKey, expires: Date.now() + 300000, response: NoWayAuto.uncertain() });
    if (autoCache.size > 200) autoCache.delete(autoCache.keys().next().value);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'NOWAY_AUTO_CLASSIFY', evidence, revision });
      if (epoch !== autoEpoch || !el.isConnected || NoWayAuto.key(NoWayAuto.snapshot(el, 'activate')) !== evidenceKey) return;
      autoCache.set(token, { key: evidenceKey, expires: Date.now() + 300000, response });
      if (response?.ok && response.decision === 'safe') postToMain('NOWAY_AUTO_PREFETCH', { token, evidenceKey, revision, decision: 'safe' });
    } catch (_) {} finally { speculativeChecks.delete(speculativeKey); }
  }

  async function discoverControls() {
    if (discoveryRunning || document.hidden || !currentState.auto?.ready || !currentState.trainingEnabled || currentState.auto.strategy !== 'auto') return;
    discoveryRunning = true;
    const epoch = autoEpoch;
    // Serial speculation leaves room for user-attempt checks and bounds page work.
    try {
      for (const el of [...document.querySelectorAll(NoWayAuto.selector)].slice(0, 100)) {
        if (epoch !== autoEpoch || document.hidden) break;
        if (el.getClientRects().length) await preclassify(el);
      }
    } finally { discoveryRunning = false; if (epoch !== autoEpoch) scheduleDiscovery(); }
  }
  document.addEventListener('pointerover', (event) => preclassify(event.target.closest?.(NoWayAuto.selector)), true);
  document.addEventListener('focusin', (event) => preclassify(event.target.closest?.(NoWayAuto.selector)), true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleDiscovery(); });

  function shouldShowPrompts() {
    return currentState.trainingEnabled || (currentState.protectionEnabled && currentState.protectionAllowOnce);
  }

  async function showPrompt(candidate, mode = 'training', matchingRule = null) {
    if (!candidate?.fingerprint || !shouldShowPrompts()) {
      debugLog({ stage: 'prompt', decision: 'skip', reason: !candidate?.fingerprint ? 'no-fingerprint' : 'prompts-disabled' });
      removePrompt();
      return;
    }

    debugLog({ stage: 'prompt', decision: 'show', label: candidate.label, actionKey: candidate.actionKey, fingerprint: candidate.fingerprint, mode });
    removePrompt();
    visiblePrompt = { kind: 'review', candidate, mode, matchingRule };
    const theme = getTheme();
    const prompt = document.createElement('div');
    prompt.id = PROMPT_ID;
    prompt.setAttribute('data-noway-ui', '');
    prompt.setAttribute('role', 'dialog');
    prompt.tabIndex = -1;
    prompt.setAttribute('aria-label', 'No Way! Review action');
    prompt.addEventListener('keydown', (event) => { if (event.key === 'Escape') removePrompt(); });
    prompt.style.cssText = [
      'all:initial',
      'position:fixed',
      'top:16px',
      'right:16px',
      'z-index:2147483647',
      `background:${theme.background}`,
      `border:1px solid ${theme.border}`,
      `color:${theme.text}`,
      `font-family:${theme.font}`,
      'font-size:16px',
      'line-height:1.5',
      'padding:20px',
      'border-radius:12px',
      `box-shadow:${theme.shadow}`,
      'box-sizing:border-box',
      'max-height:calc(100vh - 32px)',
      'overflow:auto',
      'width:360px',
      'max-width:calc(100vw - 32px)',
      'display:flex',
      'flex-direction:column',
      'gap:12px',
    ].join(';');

    const content = NoWayBrand.shadow(prompt);
    const header = document.createElement('div');
    header.style.cssText = 'all:initial;display:flex;gap:12px;align-items:center;margin-bottom:12px';

    const title = document.createElement('div');
    title.style.cssText = [
      'all:initial',
      `color:${theme.text}`,
      `font-family:${theme.headingFont}`,
      'font-size:16px',
      'font-weight:760',
      'letter-spacing:0',
    ].join(';');
    title.textContent = 'Review action';
    const mark = document.createElement('img');
    mark.src = chrome.runtime.getURL('assets/betta-mark.png');
    mark.alt = '';
    mark.style.cssText = 'all:initial;width:32px;height:32px;object-fit:contain';
    header.appendChild(mark);
    header.appendChild(title);

    content.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText = [
      'all:initial',
      `color:${theme.text}`,
      `font-family:${theme.font}`,
      'font-size:16px',
      'font-weight:700',
      'line-height:1.35',
      'overflow-wrap:anywhere',
    ].join(';');
    body.textContent = candidate.label || 'Action';

    const meta = document.createElement('div');
    meta.style.cssText = [
      'all:initial',
      `color:${theme.muted}`,
      `font-family:${theme.font}`,
      'font-size:14px',
      'line-height:1.45',
      'overflow-wrap:anywhere',
    ].join(';');
    meta.textContent = mode === 'auto-review' ? 'Action paused. Choose a rule for this site.' : mode === 'training'
      ? 'Choose a rule for this site.'
      : 'This action is blocked by a rule.';

    const actions = document.createElement('div');
    actions.style.cssText = 'all:initial;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap';

    const dismiss = promptButton('Cancel', theme, false);
    dismiss.addEventListener('click', () => { invalidateAuto(); removePrompt(); });
    actions.appendChild(dismiss);
    if (mode === 'training' || mode === 'auto-review') {
      const alwaysAllow = promptButton('Always Allow', theme, false);
      alwaysAllow.addEventListener('click', async () => {
        alwaysAllow.disabled = true;
        block.disabled = true;
        await allowRule(candidate);
      });

      const block = promptButton('Block', theme, true);
      block.addEventListener('click', async () => {
        block.disabled = true;
        alwaysAllow.disabled = true;
        await createRule(candidate);
      });

      actions.appendChild(alwaysAllow);
      actions.appendChild(block);
    } else {
      const allowOnce = promptButton('Allow Once', theme, false);
      allowOnce.addEventListener('click', () => {
        postToMain('NOWAY_ALLOW_ONCE', { fingerprint: candidate.fingerprint });
        removePrompt();
        showToast('Allowed once. Click again within 10 seconds.', 'allowed');
      });

      const block = promptButton('Block', theme, true);
      block.addEventListener('click', async () => {
        block.disabled = true;
        allowOnce.disabled = true;
        if (mode === 'protection-allow-once' && matchingRule?.id) {
          await confirmBlock(matchingRule);
        } else {
          await createRule(candidate);
        }
      });

      actions.appendChild(allowOnce);
      actions.appendChild(block);
    }
    content.appendChild(body);
    content.appendChild(meta);
    content.appendChild(actions);
    document.documentElement.appendChild(prompt);
    prompt.focus({ preventScroll: true });
  }

  async function confirmBlock(matchingRule) {
    debugLog({ stage: 'confirmBlock', ruleId: matchingRule.id, label: matchingRule.label });
    try {
      await chrome.runtime.sendMessage({ type: 'NOWAY_RECORD_HIT', ruleId: matchingRule.id });
    } catch (error) {
      debugLog({ stage: 'confirmBlock', result: 'hit-error', error: error.message });
    }
    removePrompt();
    showToast(`Blocked: ${matchingRule.label || 'Action'}`, 'blocked');
  }

  async function createRule(candidate) {
    debugLog({ stage: 'createRule', label: candidate.label, actionKey: candidate.actionKey });
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'NOWAY_CREATE_RULE',
        candidate,
      });
      if (!response?.ok) throw new Error(response?.error || 'Rule was not saved');
      debugLog({ stage: 'createRule', result: 'saved', ruleCount: response.originState?.rules?.length || 0 });

      applyPageState(response);
      removePrompt();
      showToast(`Rule saved: ${candidate.label || 'Interaction'}`, 'blocked');
    } catch (error) {
      debugLog({ stage: 'createRule', result: 'error', error: error.message });
      removePrompt();
      showToast(`Could not save rule: ${error.message}`, 'error');
    }
  }

  async function allowRule(candidate) {
    debugLog({ stage: 'allowRule', label: candidate.label, actionKey: candidate.actionKey });
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'NOWAY_ALWAYS_ALLOW_RULE',
        candidate,
      });
      if (!response?.ok) throw new Error(response?.error || 'Rule was not saved');
      debugLog({ stage: 'allowRule', result: 'saved', ruleCount: response.originState?.rules?.length || 0 });

      applyPageState(response);
      removePrompt();
      showToast(`Always allowed: ${candidate.label || 'Interaction'}`, 'allowed');
    } catch (error) {
      debugLog({ stage: 'allowRule', result: 'error', error: error.message });
      removePrompt();
      showToast(`Could not save allow rule: ${error.message}`, 'error');
    }
  }

  async function recordRuleHit(ruleId) {
    if (!ruleId) return;
    try {
      await chrome.runtime.sendMessage({ type: 'NOWAY_RECORD_HIT', ruleId });
    } catch (_) {}
  }

  function renderBadge() {
    // Only show the badge in the top-level window.
    if (window !== window.top) return;

    const active = currentState.trainingEnabled || currentState.protectionEnabled;
    const existing = document.getElementById(BADGE_ID);
    if (!active) {
      existing?.remove();
      return;
    }

    const badge = existing || document.createElement('div');
    badge.id = BADGE_ID;
    const paused = currentState.trainingEnabled && currentState.auto?.strategy === 'auto' && !currentState.auto.ready;
    const theme = getTheme(paused ? 'error' : 'training');
    badge.style.cssText = [
      'all:initial',
      'position:fixed',
      'bottom:16px',
      'right:16px',
      'z-index:2147483647',
      `background:${theme.badgeBackground}`,
      `color:${theme.badgeText}`,
      `font-family:${theme.font}`,
      'font-size:14px',
      'font-weight:760',
      'letter-spacing:0',
      'padding:7px 10px',
      `border:1px solid ${theme.border}`,
      'border-radius:999px',
      'box-sizing:border-box',
      'max-width:calc(100vw - 32px)',
      'pointer-events:none',
      'user-select:none',
      'display:flex',
      'align-items:center',
      'gap:6px',
    ].join(';');

    const label = document.createElement('span');
    label.textContent = currentState.trainingEnabled
      ? currentState.auto?.strategy === 'auto'
        ? (currentState.auto.ready ? 'No Way! · Auto training' : 'No Way! · Auto paused')
        : 'No Way! · Training'
      : 'No Way! · Protection';
    
    label.style.cssText = `all:initial;color:${theme.badgeText};font:650 14px/1.4 ${theme.font}`;
    NoWayBrand.shadow(badge).replaceChildren(label);

    if (!existing) document.documentElement.appendChild(badge);
  }

  function showToast(message, kind) {
    debugLog({ stage: 'toast', kind, message });
    const theme = getTheme(kind);

    const toast = document.createElement('div');
    toast.setAttribute('data-noway-toast', kind || 'info');
    toast.setAttribute('role', 'status');
    toast.style.cssText = [
      'all:initial',
      'position:fixed',
      'bottom:64px',
      'right:16px',
      'z-index:2147483647',
      `background:${theme.background}`,
      `border:1px solid ${theme.border}`,
      `color:${theme.text}`,
      `font-family:${theme.font}`,
      'font-size:14px',
      'line-height:1.4',
      'padding:11px 12px',
      'border-radius:8px',
      `box-shadow:${theme.shadow}`,
      'box-sizing:border-box',
      'width:max-content',
      'max-width:min(360px, calc(100vw - 32px))',
      'overflow-wrap:anywhere',
      `border-left:3px solid ${theme.accent}`,
      'max-height:calc(100dvh - 96px)',
      'overflow:auto',
      'pointer-events:none',
    ].join(';');
    const text = document.createElement('span');
    text.style.cssText = `all:initial;color:${theme.text};font:14px/1.5 ${theme.font};overflow-wrap:anywhere`;
    text.textContent = message;
    NoWayBrand.shadow(toast).appendChild(text);
    document.documentElement.appendChild(toast);
    activeToasts.push(toast);
    toastObserver.observe(toast);
    while (activeToasts.length > 3) removeToast(activeToasts[0]);
    arrangeToasts();
    setTimeout(() => {
      removeToast(toast);
      arrangeToasts();
    }, TOAST_HIDE_DELAY_MS);
  }

  function removeToast(toast) {
    toastObserver.unobserve(toast);
    toast.remove();
    const index = activeToasts.indexOf(toast);
    if (index >= 0) activeToasts.splice(index, 1);
  }

  function arrangeToasts() {
    let bottom = 64;
    for (const toast of [...activeToasts].reverse()) {
      if (bottom + toast.getBoundingClientRect().height > innerHeight - 16 && activeToasts.length > 1) {
        removeToast(toast); continue;
      }
      toast.style.setProperty('bottom', `${bottom}px`, 'important');
      bottom += toast.getBoundingClientRect().height + 8;
    }
  }

  function promptButton(label, theme, primary) {
    const button = document.createElement('button');
    button.type = 'button';
    button.style.cssText = [
      'all:initial',
      'box-sizing:border-box',
      'cursor:pointer',
      `font-family:${theme.font}`,
      'font-size:14px',
      'font-weight:720',
      'padding:8px 11px',
      'border-radius:8px',
      `border:1px solid ${primary ? theme.accent : theme.controlBorder}`,
      `background:${primary ? theme.accent : theme.buttonBackground}`,
      `color:${primary ? theme.onAccent : theme.text}`,
      'min-width:80px',
      'min-height:44px',
      'text-align:center',
    ].join(';');
    button.addEventListener('focus', () => { button.style.outline = `2px solid ${theme.text}`; button.style.outlineOffset = '3px'; });
    button.addEventListener('blur', () => { button.style.outline = 'none'; });
    button.textContent = label;
    return button;
  }

  function removePrompt() {
    document.getElementById(PROMPT_ID)?.remove();
    visiblePrompt = null;
  }

  function pushStateToMain() {
    postToMain('NOWAY_STATE', currentState);
  }

  function postToMain(type, payload) {
    window.postMessage({ source: SOURCE_CONTROLLER, type, payload }, '*');
  }

  function getTheme(kind = 'blocked') {
    return NoWayBrand.theme(isDarkMode(), kind);
  }

  function isDarkMode() {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    renderBadge();
    const shown = visiblePrompt;
    if (shown?.kind === 'checking') showChecking(shown.token);
    else if (shown) showPrompt(shown.candidate, shown.mode, shown.matchingRule);
    for (const toast of activeToasts) {
      const theme = getTheme(toast.getAttribute('data-noway-toast'));
      toast.style.setProperty('background', theme.background, 'important');
      toast.style.setProperty('border-color', theme.border, 'important');
      toast.style.setProperty('border-left-color', theme.accent, 'important');
      toast.shadowRoot.querySelector('span').style.color = theme.text;
    }
  });
})();
