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
  let stateInitialized = false;
  let toastOffset = 16;
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
    if (!data || data.source !== SOURCE_MAIN) return;

    if (data.type === 'NOWAY_READY') {
      if (stateInitialized) pushStateToMain();
    } else if (data.type === 'NOWAY_NAVIGATED') {
      removePrompt();
    } else if (data.type === 'NOWAY_PROMPT') {
      if (window !== window.top) {
        window.top.postMessage({ source: SOURCE_CONTROLLER, type: 'NOWAY_DELEGATE_UI', payload: data }, '*');
      } else {
        showPrompt(data.payload?.candidate, data.payload?.mode, data.payload?.matchingRule);
      }
    } else if (data.type === 'NOWAY_BLOCKED') {
      if (window !== window.top) {
        window.top.postMessage({ source: SOURCE_CONTROLLER, type: 'NOWAY_DELEGATE_UI', payload: data }, '*');
      } else {
        showToast(`Action stopped: ${data.payload?.label || 'Blocked action'}`, 'blocked');
      }
    } else if (data.type === 'NOWAY_RULE_HIT') {
      recordRuleHit(data.payload?.ruleId);
    }
  });

  // Handle delegated UI requests from iframes
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== SOURCE_CONTROLLER || data.type !== 'NOWAY_DELEGATE_UI') return;
    if (window !== window.top) return; // Only the top window handles delegates

    const original = data.payload;
    if (original.type === 'NOWAY_PROMPT') {
      showPrompt(original.payload?.candidate, original.payload?.mode, original.payload?.matchingRule);
    } else if (original.type === 'NOWAY_BLOCKED') {
      showToast(`Action stopped: ${original.payload?.label || 'Blocked action'}`, 'blocked');
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'NOWAY_PING') {
      sendResponse({ type: 'NOWAY_PONG' });
      return true;
    }
    if (message?.type !== 'NOWAY_STATE_CHANGED') return;
    if (message.state?.ok) {
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
    clearTimeout(navTimeout);
    navTimeout = setTimeout(() => {
      debugLog({ stage: 'navigation', reason: 'spa-nav' });
      removePrompt();
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
    currentState = response;
    stateInitialized = true;
    debugLog({ stage: 'state', trainingEnabled: currentState.trainingEnabled, protectionEnabled: currentState.protectionEnabled, protectionAllowOnce: currentState.protectionAllowOnce, ruleCount: currentState.rules?.length || 0 });
    pushStateToMain();
    renderBadge();
    if (!shouldShowPrompts()) removePrompt();

    // If both modes are off, tell the main-world script to tear down capture listeners
    if (!currentState.trainingEnabled && !currentState.protectionEnabled) {
      postToMain('NOWAY_SHUTDOWN', {});
    }
  }

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

    const theme = getTheme();
    const prompt = document.createElement('div');
    prompt.id = PROMPT_ID;
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
      'font-size:13px',
      'line-height:1.45',
      'padding:14px',
      'border-radius:8px',
      `box-shadow:${theme.shadow}`,
      'width:360px',
      'max-width:calc(100vw - 32px)',
      'display:flex',
      'flex-direction:column',
      'gap:12px',
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = 'all:initial;display:flex;justify-content:space-between;align-items:center';

    const title = document.createElement('div');
    title.style.cssText = [
      'all:initial',
      `color:${theme.text}`,
      `font-family:${theme.font}`,
      'font-size:13px',
      'font-weight:760',
      'letter-spacing:0',
    ].join(';');
    title.textContent = 'Review action';
    header.appendChild(title);

    prompt.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText = [
      'all:initial',
      `color:${theme.text}`,
      `font-family:${theme.font}`,
      'font-size:14px',
      'font-weight:700',
      'line-height:1.35',
    ].join(';');
    body.textContent = candidate.label || 'Potentially risky action';

    const meta = document.createElement('div');
    meta.style.cssText = [
      'all:initial',
      `color:${theme.muted}`,
      `font-family:${theme.font}`,
      'font-size:12px',
      'line-height:1.45',
    ].join(';');
    meta.textContent = mode === 'training'
      ? 'Block to learn this rule, or always allow to stop prompting.'
      : 'Blocked by rule. Allow once to retry within 10 s, or block to keep blocking.';

    const actions = document.createElement('div');
    actions.style.cssText = 'all:initial;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap';

    if (mode === 'training') {
      const alwaysAllow = promptButton('Always allow', theme, false);
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
      const allowOnce = promptButton('Allow once', theme, false);
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
    prompt.appendChild(body);
    prompt.appendChild(meta);
    prompt.appendChild(actions);
    document.documentElement.appendChild(prompt);
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

      currentState = response;
      pushStateToMain();
      renderBadge();
      removePrompt();
      showToast(`Blocked and learned: ${candidate.label || 'Interaction'}`, 'blocked');
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

      currentState = response;
      pushStateToMain();
      renderBadge();
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
    const theme = getTheme(currentState.trainingEnabled ? 'training' : 'blocked');
    badge.style.cssText = [
      'all:initial',
      'position:fixed',
      'bottom:16px',
      'right:16px',
      'z-index:2147483647',
      `background:${theme.badgeBackground}`,
      `color:${theme.badgeText}`,
      `font-family:${theme.font}`,
      'font-size:12px',
      'font-weight:760',
      'letter-spacing:0',
      'padding:7px 10px',
      `border:1px solid ${theme.border}`,
      'border-radius:999px',
      'pointer-events:none',
      'user-select:none',
      `box-shadow:${theme.shadow}`,
      'display:flex',
      'align-items:center',
      'gap:6px',
    ].join(';');

    const label = document.createElement('span');
    label.textContent = currentState.trainingEnabled ? 'NO WAY TRAINING' : 'NO WAY MODE';
    
    badge.replaceChildren(label);

    if (!existing) document.documentElement.appendChild(badge);
  }

  function showToast(message, kind) {
    debugLog({ stage: 'toast', kind, message });
    const top = toastOffset;
    toastOffset += 78;
    const theme = getTheme(kind);

    const toast = document.createElement('div');
    toast.setAttribute('data-noway-toast', '');
    toast.style.cssText = [
      'all:initial',
      'position:fixed',
      `top:${top}px`,
      'right:16px',
      'z-index:2147483647',
      `background:${theme.background}`,
      `border:1px solid ${theme.border}`,
      `color:${theme.text}`,
      `font-family:${theme.font}`,
      'font-size:13px',
      'line-height:1.4',
      'padding:11px 12px',
      'border-radius:8px',
      `box-shadow:${theme.shadow}`,
      'max-width:360px',
      'pointer-events:none',
    ].join(';');
    toast.textContent = message;
    document.documentElement.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => {
        toast.remove();
        toastOffset = Math.max(16, toastOffset - 78);
      }, 260);
    }, TOAST_HIDE_DELAY_MS);
  }

  function promptButton(label, theme, primary) {
    const button = document.createElement('button');
    button.type = 'button';
    button.style.cssText = [
      'all:initial',
      'box-sizing:border-box',
      'cursor:pointer',
      `font-family:${theme.font}`,
      'font-size:13px',
      'font-weight:720',
      'padding:8px 11px',
      'border-radius:8px',
      `border:1px solid ${primary ? theme.accent : theme.border}`,
      `background:${primary ? theme.accent : theme.buttonBackground}`,
      `color:${primary ? theme.onAccent : theme.text}`,
      'min-width:96px',
      'text-align:center',
    ].join(';');
    button.textContent = label;
    return button;
  }

  function removePrompt() {
    document.getElementById(PROMPT_ID)?.remove();
  }

  function pushStateToMain() {
    postToMain('NOWAY_STATE', currentState);
  }

  function postToMain(type, payload) {
    window.postMessage({ source: SOURCE_CONTROLLER, type, payload }, '*');
  }

  function getTheme(kind = 'blocked') {
    const dark = isDarkMode();
    const accent = kind === 'allowed' ? '#167a45'
      : kind === 'error' ? '#b56a00'
      : kind === 'training' ? '#d97706'
      : '#c93352';
    const darkAccent = kind === 'allowed' ? '#64d18a'
      : kind === 'error' ? '#f6bd60'
      : kind === 'training' ? '#f59e0b'
      : '#ff6f8d';

    if (dark) {
      return {
        background: '#1b1f24',
        buttonBackground: '#252b32',
        badgeBackground: darkAccent,
        badgeText: '#111315',
        border: '#333b45',
        accent: darkAccent,
        onAccent: '#111315',
        text: '#f3f6f8',
        muted: '#a9b4c0',
        shadow: '0 18px 38px rgba(0,0,0,0.34)',
        font: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      };
    }

    return {
      background: '#ffffff',
      buttonBackground: '#f8fafc',
      badgeBackground: accent,
      badgeText: '#ffffff',
      border: '#dbe4ee',
      accent,
      onAccent: '#ffffff',
      text: '#17202a',
      muted: '#64748b',
      shadow: '0 12px 32px rgba(15,23,42,0.14)',
      font: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    };
  }

  function isDarkMode() {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  }
})();
