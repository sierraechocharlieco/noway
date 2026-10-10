(() => {
  'use strict';

  if (window.__NOWAY_MAIN_INSTALLED__) {
    window.postMessage({ source: 'NOWAY_MAIN', type: 'NOWAY_READY', payload: { origin: location.origin } }, '*');
    return;
  }
  window.__NOWAY_MAIN_INSTALLED__ = true;

  const SOURCE_MAIN = 'NOWAY_MAIN';
  const SOURCE_CONTROLLER = 'NOWAY_CONTROLLER';
  const ACTION_SELECTOR = [
    'button',
    'a[href]',
    '[role="button"]',
    '[role="menuitem"]',
    '[role="switch"]',
    '[role="checkbox"]',
    '[role="link"]',
    'input',
    'textarea',
    'select',
    'summary',
    '[contenteditable="true"]',
  ].join(',');
  const ALLOW_ONCE_MS = 10000;
  const PROMPT_DEDUPE_MS = 900;
  const HIT_DEDUPE_MS = 1000;
  const RAPID_CLICK_MS = 600;

  let lastMediaClick = null;

  const autoRecords = new Map();
  const autoTokens = new WeakMap();
  const stoppedAutoGestures = new WeakSet();
  const state = {
    origin: location.origin,
    trainingEnabled: false,
    protectionEnabled: false,
    protectionAllowOnce: false,
    debugEnabled: false,
    rules: [],
    auto: { strategy: 'manual', ready: false },
  };

  // Debug ring buffer: last 50 internal decisions for easy DevTools inspection.
  // Writes pause when debug mode is off.
  const DEBUG_MAX_EVENTS = 50;
  window.__NOWAY_DEBUG__ = window.__NOWAY_DEBUG__ || { events: [] };
  function debugLog(entry) {
    if (!state.debugEnabled) return;
    const record = { time: Date.now(), ...entry };
    const buf = window.__NOWAY_DEBUG__.events;
    buf.push(record);
    if (buf.length > DEBUG_MAX_EVENTS) buf.shift();
    // Also emit to console with a consistent prefix so CDP/ action-monitor can capture it
    console.log('[No Way!]', JSON.stringify(record));
  }
  const allowUntilByFingerprint = new Map();
  const recentPromptAtByFingerprint = new Map();
  const recentBlockAtByFingerprint = new Map();
  const recentHitAtByRuleId = new Map();
  const listenerRefs = [];
  let isMainActive = false;

  const REACTION_TERMS = [
    'Like',
    'Liked',
    'Unlike',
    'Unliked',
    'React',
    'Reacted',
    'Unreact',
    'Reaction',
    'Love',
    'Loved',
    'Heart',
    'Hearted',
    'Favorite',
    'Favorites',
    'Favourite',
    'Favourites',
    'Favorited',
    'Favourited',
    'Unfavorite',
    'Unfavourite',
    'Star',
    'Starred',
    'Unstar',
    'Unstarred',
    'Upvote',
    'Upvoted',
    'Up vote',
    'Up-vote',
    'Downvote',
    'Downvoted',
    'Down vote',
    'Down-vote',
    'Clap',
    'Clapped',
    'Applaud',
    'Applauded',
    'Cheer',
    'Cheered',
    'Celebrate',
    'Celebrated',
    'Support',
    'Insightful',
    'Funny',
    'Kudos',
    'Thumbs up',
    'Thumbs down',
    'Plus one',
  ];

  const AMPLIFY_TERMS = [
    'Boost',
    'Boosted',
    'Promote',
    'Promoted',
    'Amplify',
    'Amplified',
    'Sponsor',
    'Sponsored',
  ];

  const ENDORSE_TERMS = [
    'Endorse',
    'Endorsed',
    'Endorsement',
    'Recommend',
    'Recommended',
    'Recommendation',
    'Review',
    'Rate',
  ];

  const ACTION_LABELS = {
    like: 'Reaction/favourite',
    follow: 'Follow',
    connect: 'Connect',
    comment: 'Comment',
    share: 'Share',
    amplify: 'Boost/promote',
    message: 'Message',
    post: 'Post/publish',
    delete: 'Delete/remove',
    purchase: 'Purchase',
    endorse: 'Endorse/review',
    save: 'Save',
  };

  const ACTION_SELECTOR_TERMS = {
    like: REACTION_TERMS,
    follow: ['Follow', 'Unfollow', 'Subscribe', 'Unsubscribe'],
    connect: ['Connect', 'Invite', 'Add connection', 'Send invite'],
    comment: ['Comment', 'Reply'],
    share: ['Share', 'Repost', 'Retweet', 'Quote', 'Duet', 'Stitch'],
    amplify: AMPLIFY_TERMS,
    message: ['Message', 'Send', 'DM', 'Direct message', 'InMail'],
    post: ['Post', 'Publish', 'Submit', 'Upload', 'Send now'],
    delete: ['Delete', 'Remove', 'Discard', 'Report', 'Block user', 'Mute'],
    purchase: ['Buy', 'Purchase', 'Checkout', 'Order', 'Bid', 'Donate', 'Tip', 'Pay'],
    endorse: ENDORSE_TERMS,
    save: ['Save', 'Bookmark', 'Collect'],
  };

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || !data || data.source !== SOURCE_CONTROLLER) return;

    if (data.type === 'NOWAY_STATE') {
      applyState(data.payload);
      if (!isMainActive && (state.trainingEnabled || state.protectionEnabled)) {
        installGuards();
      } else if (isMainActive && !state.trainingEnabled && !state.protectionEnabled) {
        uninstallGuards();
      }
    } else if (data.type === 'NOWAY_AUTO_PREFETCH') {
      acceptAutoPrefetch(data.payload);
    } else if (data.type === 'NOWAY_AUTO_RESULT') {
      acceptAutoResult(data.payload);
    } else if (data.type === 'NOWAY_AUTO_INVALIDATE') {
      autoRecords.clear();
    } else if (data.type === 'NOWAY_ALLOW_ONCE') {
      allowOnce(data.payload?.fingerprint);
    } else if (data.type === 'NOWAY_SHUTDOWN') {
      uninstallGuards();
    }
  });

  function installGuards() {
    if (isMainActive) return;
    isMainActive = true;
    window.__NOWAY_MAIN_ACTIVE__ = true;

    const onPointerDown = (event) => handleActivation(event, 'pointer');
    const onMouseDown = (event) => handleActivation(event, 'pointer');
    const onTouchStart = (event) => handleActivation(event, 'pointer');
    const onClick = (event) => handleActivation(event, 'click');
    const onDblclick = (event) => handleActivation(event, 'dblclick');
    const onAuxclick = (event) => handleActivation(event, 'click');
    const onKeydown = (event) => handleKeydown(event);
    const onSubmit = (event) => handleSubmit(event);

    listenerRefs.push(
      { type: 'pointerdown', listener: onPointerDown, capture: true },
      { type: 'mousedown', listener: onMouseDown, capture: true },
      { type: 'touchstart', listener: onTouchStart, capture: true },
      { type: 'click', listener: onClick, capture: true },
      { type: 'dblclick', listener: onDblclick, capture: true },
      { type: 'auxclick', listener: onAuxclick, capture: true },
      { type: 'keydown', listener: onKeydown, capture: true },
      { type: 'submit', listener: onSubmit, capture: true },
    );

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
    document.addEventListener('dblclick', onDblclick, true);
    document.addEventListener('auxclick', onAuxclick, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('submit', onSubmit, true);

    post('NOWAY_READY', { origin: location.origin });
  }

  function uninstallGuards() {
    if (!isMainActive) return;
    isMainActive = false;
    window.__NOWAY_MAIN_ACTIVE__ = false;
    for (const { type, listener, capture } of listenerRefs) {
      document.removeEventListener(type, listener, capture);
    }
    listenerRefs.length = 0;
    autoRecords.clear();
    allowUntilByFingerprint.clear();
    recentPromptAtByFingerprint.clear();
    recentBlockAtByFingerprint.clear();
    recentHitAtByRuleId.clear();
    debugLog({ stage: 'lifecycle', action: 'uninstall' });
  }

  // SPA navigation sync: tell controller to re-fetch state after route changes
  let mainNavTimeout = null;
  function onMainNav() {
    autoRecords.clear();
    post('NOWAY_NAVIGATED', {});
    clearTimeout(mainNavTimeout);
    mainNavTimeout = setTimeout(() => {
      post('NOWAY_READY', { origin: location.origin });
    }, 300);
  }

  installGuards();

  // Monkey-patch history only once, even if the script is re-injected.
  if (!window.__NOWAY_HISTORY_PATCHED__) {
    window.__NOWAY_HISTORY_PATCHED__ = true;
    const _originalPushState = history.pushState;
    const _originalReplaceState = history.replaceState;
    history.pushState = function (...args) {
      _originalPushState.apply(this, args);
      onMainNav();
    };
    history.replaceState = function (...args) {
      _originalReplaceState.apply(this, args);
      onMainNav();
    };
    window.addEventListener('popstate', onMainNav);
  }

  function applyState(nextState = {}) {
    if (state.auto?.revision !== nextState.auto?.revision) autoRecords.clear();
    state.auto = nextState.auto || { strategy: 'manual', ready: false };
    state.origin = nextState.origin || location.origin;
    state.trainingEnabled = Boolean(nextState.trainingEnabled);
    state.protectionEnabled = Boolean(nextState.protectionEnabled);
    state.protectionAllowOnce = Boolean(nextState.protectionAllowOnce);
    state.debugEnabled = Boolean(nextState.debugEnabled);
    state.rules = Array.isArray(nextState.rules) ? nextState.rules : [];
    debugLog({
      stage: 'state',
      trainingEnabled: state.trainingEnabled,
      protectionEnabled: state.protectionEnabled,
      ruleCount: state.rules.length,
      origin: state.origin,
    });
  }

  function allowOnce(fingerprint) {
    if (!fingerprint) return;
    allowUntilByFingerprint.set(fingerprint, Date.now() + ALLOW_ONCE_MS);
  }

  function handleActivation(event, eventKind) {
    const target = event.target;
    const candidate = candidateFromEvent(event, eventKind);
    debugLog({
      stage: 'activation',
      eventKind,
      targetTag: target?.tagName?.toLowerCase?.() || '',
      targetAria: target?.getAttribute?.('aria-label') || '',
      targetText: (target?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      candidateFound: !!candidate,
    });
    handleCandidate(event, candidate);
  }

  function handleKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;

    const candidate = candidateFromEvent(event, 'keyboard');
    if (!candidate) return;

    if (event.key === ' ' && !isButtonLike(candidate.target)) return;
    handleCandidate(event, candidate);
  }

  function handleSubmit(event) {
    const form = event.target?.closest?.('form') || event.target;
    if (!form) return;

    const auto = state.trainingEnabled && state.auto.strategy === 'auto';
    const candidate = buildCandidate(event.submitter || form, 'submit', { forceRisk: auto ? false : isRiskyForm(form) });
    handleCandidate(event, candidate);
  }

  function handleCandidate(event, candidate) {
    if (!candidate || candidate.target?.closest?.('#noway-training-prompt,#noway-badge,[data-noway-ui],[data-noway-toast]')) return;

    if (isAllowed(candidate.fingerprint)) {
      debugLog({ stage: 'decision', decision: 'allow-once', fingerprint: candidate.fingerprint });
      return;
    }

    const matchingRule = findMatchingRule(candidate);
    debugLog({
      stage: 'candidate',
      label: candidate.label,
      actionKey: candidate.actionKey,
      risky: candidate.risky,
      fingerprint: candidate.fingerprint,
      matchingRuleId: matchingRule?.id || null,
      matchingRuleLabel: matchingRule?.label || null,
      selectors: candidate.match?.selectors || [],
    });

    if (state.trainingEnabled && state.auto.strategy === 'auto') {
      if (isExplicitlyAllowed(candidate)) return;
      if (matchingRule) {
        blockEvent(event);
        if (isRecentBlock(candidate.fingerprint)) return;
        recentBlockAtByFingerprint.set(candidate.fingerprint, Date.now());
        if (state.protectionEnabled && state.protectionAllowOnce) {
          post('NOWAY_PROMPT', { candidate: serializeCandidate(candidate), mode: 'protection-allow-once', matchingRule: { id: matchingRule.id, label: matchingRule.label } });
        } else {
          post('NOWAY_BLOCKED', { label: matchingRule.label, ruleId: matchingRule.id });
          recordRuleHit(matchingRule.id);
        }
        return;
      }
      handleAutoCandidate(event, candidate);
      return;
    }

    // Early gesture events must be stopped for sites that mutate on
    // pointerdown/mousedown, including LinkedIn reactions. Weak fallback
    // candidates still defer to click so modal backdrops and overlays do not
    // inherit a hidden Like/Follow action from their descendants.
    if (candidate.eventKind === 'pointer' && !shouldHandleEarlyPointer(candidate, matchingRule)) {
      debugLog({ stage: 'decision', decision: 'defer-to-click', eventKind: candidate.eventKind, fingerprint: candidate.fingerprint });
      return;
    }

    // Explicit allow rules win over everything (starter rules, block rules,
    // training prompts). Check first so users never get re-prompted for an
    // action they have already chosen to always allow.
    if ((candidate.risky || matchingRule) && isExplicitlyAllowed(candidate)) {
      debugLog({ stage: 'decision', decision: 'always-allow', fingerprint: candidate.fingerprint });
      return;
    }

    if (state.trainingEnabled && (candidate.risky || matchingRule)) {
      blockEvent(event);
      if (isRecentPrompt(candidate.fingerprint)) {
        debugLog({ stage: 'decision', decision: 'dedupe', fingerprint: candidate.fingerprint });
        return;
      }

      // Enrich minimal candidates with matching rule info so the controller
      // can create a learned rule even when the candidate itself is sparse.
      if (matchingRule && !candidate.actionKey) {
        candidate.actionKey = matchingRule.actionKey;
        candidate.label = matchingRule.label;
        candidate.match = {
          ...candidate.match,
          actionKey: matchingRule.actionKey,
          label: matchingRule.label,
          labelNorm: normalizeText(matchingRule.label),
        };
      }

      recentPromptAtByFingerprint.set(candidate.fingerprint, Date.now());
      debugLog({ stage: 'decision', decision: 'prompt', label: candidate.label, actionKey: candidate.actionKey });
      post('NOWAY_PROMPT', {
        candidate: serializeCandidate(candidate),
        mode: 'training',
      });
      return;
    }

    if (matchingRule && state.protectionEnabled) {
      // When 'allow once in protection' is enabled, prompt the user instead of
      // silently blocking, so intentional actions can still proceed.
      if (state.protectionAllowOnce) {
        blockEvent(event);
        if (isRecentPrompt(candidate.fingerprint)) {
          debugLog({ stage: 'decision', decision: 'dedupe', fingerprint: candidate.fingerprint });
          return;
        }
        recentPromptAtByFingerprint.set(candidate.fingerprint, Date.now());
        debugLog({ stage: 'decision', decision: 'prompt-protection', label: candidate.label, ruleId: matchingRule.id });
        post('NOWAY_PROMPT', {
          candidate: serializeCandidate(candidate),
          mode: 'protection-allow-once',
          matchingRule: { id: matchingRule.id, label: matchingRule.label },
        });
        return;
      }

      blockEvent(event);
      if (isRecentBlock(candidate.fingerprint)) {
        debugLog({ stage: 'decision', decision: 'dedupe-block', fingerprint: candidate.fingerprint });
        return;
      }
      recentBlockAtByFingerprint.set(candidate.fingerprint, Date.now());
      debugLog({ stage: 'decision', decision: 'block', ruleId: matchingRule.id, label: matchingRule.label });
      post('NOWAY_BLOCKED', {
        label: matchingRule.label || candidate.label,
        ruleId: matchingRule.id,
      });
      recordRuleHit(matchingRule.id);
      return;
    }

    debugLog({ stage: 'decision', decision: 'pass', risky: candidate.risky, actionKey: candidate.actionKey });
  }

  function autoEventFamily(el, eventKind) {
    if (eventKind === 'submit' && el.localName !== 'form') return 'activate';
    if (eventKind === 'keyboard' && !el.matches?.('textarea,input:not([type="button"]):not([type="submit"]),[contenteditable="true"]')) return 'activate';
    return ['keyboard', 'submit', 'dblclick'].includes(eventKind) ? eventKind : 'activate';
  }

  function handleAutoCandidate(event, candidate) {
    const el = candidate.target;
    if (!el?.isConnected || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    // Focus and ordinary typing are not activation. Enter in a composer is covered separately.
    if (el.matches('textarea,input:not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]),[contenteditable="true"]')
      && candidate.eventKind !== 'keyboard' && candidate.eventKind !== 'submit') return;
    const eventKind = autoEventFamily(el, candidate.eventKind);
    const evidence = NoWayAuto.snapshot(el, eventKind);
    if (evidence.navigation === 'profile' && eventKind === 'activate') return;
    let token = autoTokens.get(el) || el.getAttribute('data-noway-auto-target');
    if (token && !/^[a-f0-9-]{36}$/.test(token)) token = null;
    if (!token) {
      token = NoWayAuto.uuid();
      autoTokens.set(el, token);
      el.setAttribute('data-noway-auto-target', token);
    }
    autoTokens.set(el, token);
    let record = autoRecords.get(token);
    const evidenceKey = NoWayAuto.key(evidence);
    if (!record || record.key !== evidenceKey || record.expires < Date.now()) {
      record = { el, key: evidenceKey, evidence, expires: Date.now() + 300000, decision: null, pending: false, blockedGesture: false };
      autoRecords.set(token, record);
      if (autoRecords.size > 200) autoRecords.delete(autoRecords.keys().next().value);
    }
    const freshGesture = event.type === 'pointerdown' || (event.type === 'keydown' && !event.repeat)
      || (!window.PointerEvent && ['mousedown', 'touchstart'].includes(event.type));
    if (freshGesture) stoppedAutoGestures.delete(el);
    record.blockedGesture = stoppedAutoGestures.has(el);
    const known = NoWayAuto.actionFor(evidence);
    debugLog({ stage: 'auto', event: event.type, label: evidence.label, decision: record.decision,
      pending: record.pending, blockedGesture: record.blockedGesture, ready: state.auto.ready });
    if (record.decision === 'safe' && state.auto.ready && !known && !record.blockedGesture) return;
    blockEvent(event);
    stoppedAutoGestures.add(el);
    record.blockedGesture = true;
    if (record.pending || isRecentPrompt(candidate.fingerprint)) return;
    recentPromptAtByFingerprint.set(candidate.fingerprint, Date.now());
    record.pending = true;
    record.requestId = NoWayAuto.uuid();
    record.fingerprint = candidate.fingerprint;
    post('NOWAY_AUTO_CHECK', { token, requestId: record.requestId, evidenceKey, eventKind,
      fingerprint: candidate.fingerprint, revision: state.auto.revision });
  }

  function acceptAutoPrefetch(payload) {
    if (!state.trainingEnabled || state.auto.strategy !== 'auto' || !state.auto.ready
      || payload?.revision !== state.auto.revision || payload.decision !== 'safe'
      || !/^[a-f0-9-]{36}$/.test(payload.token)) return;
    const el = document.querySelector(`[data-noway-auto-target="${payload.token}"]`);
    if (!el) return;
    const evidence = NoWayAuto.snapshot(el, 'activate');
    if (NoWayAuto.key(evidence) !== payload.evidenceKey || NoWayAuto.actionFor(evidence)) return;
    const prior = autoRecords.get(payload.token);
    if (prior?.pending || prior?.blockedGesture || stoppedAutoGestures.has(el)) return;
    autoRecords.set(payload.token, { el, evidence, key: payload.evidenceKey, decision: 'safe',
      expires: Date.now() + 300000, pending: false, blockedGesture: false });
    autoTokens.set(el, payload.token);
    if (autoRecords.size > 200) autoRecords.delete(autoRecords.keys().next().value);
  }

  function acceptAutoResult(payload) {
    const record = autoRecords.get(payload?.token);
    if (!record || payload.requestId !== record.requestId || !record.el.isConnected
      || payload.revision !== state.auto.revision
      || NoWayAuto.key(NoWayAuto.snapshot(record.el, record.evidence.eventKind)) !== record.key) return;
    record.pending = false;
    record.decision = payload.decision === 'safe' ? 'safe' : 'uncertain';
    // A checked-safe retry still needs a NEW physical gesture; the stopped gesture stays stopped.
    if (payload.decision === 'safe') record.expires = Date.now() + 10000;
  }

  function candidateFromEvent(event, eventKind) {
    const targets = eventTargets(event);
    if (targets.some((target) => target.matches?.('#noway-training-prompt,#noway-badge,[data-noway-ui],[data-noway-toast]'))) return null;

    // Instagram (and similar sites) implement double-tap/click like via click
    // counting OR the native dblclick event. We handle both paths.
    if (eventKind === 'dblclick') {
      const mediaLike = findNearbyMedia(event.target, targets);
      if (mediaLike) {
        const candidate = buildCandidate(mediaLike, 'dblclick', { forceRisk: true, ruleActionKey: 'like', ruleLabel: 'Like (double-click)' });
        if (candidate) {
          debugLog({ stage: 'dblclick', decision: 'media-like', tag: mediaLike.tagName?.toLowerCase?.() });
          return candidate;
        }
      }
    }

    // Detect a rapid second click on a media element and treat it as a like gesture.
    if (eventKind === 'click') {
      const mediaLike = findNearbyMedia(event.target, targets);

      if (mediaLike) {
        const now = Date.now();
        const src = mediaLike.currentSrc || mediaLike.src || mediaLike.getAttribute?.('src') || '';
        const parent = mediaLike.parentElement;
        const parentKey = parent
          ? (parent.getAttribute?.('id') || parent.className || parent.tagName?.toLowerCase?.() || '')
          : '';

        // Match by src (stable across React re-renders) OR by parent container
        // (handles React replacing the <img> node AND changing the src).
        const isRapid = lastMediaClick
          && (now - lastMediaClick.time) < RAPID_CLICK_MS
          && (src.length > 0 || parentKey.length > 0)
          && (lastMediaClick.src === src || lastMediaClick.parentKey === parentKey);

        debugLog({
          stage: 'rapidClick',
          tag: mediaLike.tagName?.toLowerCase?.(),
          src: src.slice(0, 80),
          parentKey: parentKey.slice(0, 60),
          isRapid,
          timeSinceLast: lastMediaClick ? now - lastMediaClick.time : null,
          hasLast: !!lastMediaClick,
        });

        if (isRapid) {
          lastMediaClick = null;
          const candidate = buildCandidate(mediaLike, 'dblclick', { forceRisk: true, ruleActionKey: 'like', ruleLabel: 'Like (double-click)' });
          if (candidate) return candidate;
        }
        lastMediaClick = { el: mediaLike, src, parentKey, time: now };
      }
    }

    for (const target of targets) {
      const action = closestAction(target);
      if (!action) continue;

      if (eventKind === 'keyboard' && target !== action && !action.contains(target)) continue;

      const candidate = buildCandidate(action, eventKind);
      if (candidate) return candidate;
    }

    // Fallback: if no generic action element was found, check each target against
    // active rule selectors. This catches non-semantic clickable elements (e.g.
    // LinkedIn divs with obfuscated classes) that the generic ACTION_SELECTOR misses.
    for (const target of targets) {
      const matchedByRule = closestActionFromRules(target);
      if (!matchedByRule) continue;

      const candidate = buildCandidate(matchedByRule.el, eventKind, { forceRisk: true, ruleActionKey: matchedByRule.actionKey, ruleLabel: matchedByRule.label });
      if (candidate) return candidate;
    }

    // Last resort: use the deepest element in the path if it looks interactive
    // (has onclick, cursor:pointer, or is a known clickable tag).
    const deepest = targets[0];
    if (deepest && looksInteractive(deepest)) {
      const candidate = buildCandidate(deepest, eventKind, { forceRisk: true });
      if (candidate) return candidate;
    }

    return null;
  }

  function buildCandidate(el, eventKind, options = {}) {
    const label = accessibleLabel(el);
    const labelNorm = normalizeText(label);
    const actionKey = NoWayAuto.actionFor(NoWayAuto.snapshot(el, autoEventFamily(el, eventKind))) || (options.ruleActionKey || '');
    const tag = el.tagName?.toLowerCase() || '';
    const role = normalizeText(el.getAttribute?.('role') || '');
    const inputType = normalizeText(el.getAttribute?.('type') || '');
    const selectors = stableSelectors(el, label, actionKey);
    const formLabel = formContextLabel(el);
    const forceRisk = Boolean(options.forceRisk);
    const risky = forceRisk || isRiskyElement(el, { labelNorm, actionKey, tag, role, inputType, eventKind, formLabel });
    const fallbackKey = fallbackActionKey(eventKind, tag, inputType);
    const effectiveActionKey = actionKey || fallbackKey;
    const canonicalLabel = actionLabel(actionKey) || options.ruleLabel || fallbackLabel(eventKind, tag, inputType);
    const effectiveLabel = actionKey ? canonicalLabel : (label || canonicalLabel);
    const effectiveLabelNorm = actionKey ? normalizeText(canonicalLabel) : labelNorm;
    const textLabels = actionKey
      ? unique([actionKey, effectiveLabelNorm, ...selectorTermsForAction(actionKey, labelNorm).map(normalizeText)])
      : [];

    // Allow action elements to generate minimal candidates so starter-rule
    // selectors can still be evaluated in matchesRule against candidate.target.
    if (!label && !selectors.length && !forceRisk) {
      if (!el.matches?.(ACTION_SELECTOR)) return null;
    }

    const fingerprint = [
      location.origin,
      effectiveActionKey,
      effectiveLabelNorm || labelNorm,
      tag,
      role,
      inputType,
      selectors[0] || '',
      normalizeText(formLabel),
    ].join('|');

    debugLog({
      stage: 'build',
      tag,
      role,
      label: effectiveLabel,
      labelNorm: effectiveLabelNorm,
      actionKey: effectiveActionKey,
      risky,
      selectors,
      fingerprint,
    });

    return {
      target: el,
      eventKind,
      actionKey: effectiveActionKey,
      label: effectiveLabel,
      risky,
      forceRisk,
      confidence: risky ? confidenceFor(el, selectors, labelNorm) : 0.2,
      fingerprint,
      match: {
        selectors,
        textLabels,
        actionKey: effectiveActionKey,
        label: effectiveLabel,
        labelNorm: effectiveLabelNorm,
        role,
        tag,
        inputType,
        testId: testIdLabelFor(el),
        stableId: stableIdFor(el),
        formLabel,
      },
    };
  }

  function isRiskyElement(el, detail) {
    if (isReadOnlyControl(el, detail)) return false;
    if (detail.actionKey) return true;
    if (detail.eventKind === 'submit') return isRiskyForm(el);
    if (detail.eventKind === 'keyboard' && isComposerLike(el, detail)) return true;
    if (isJavaScriptActionLink(el) && detail.actionKey) return true;
    return false;
  }

  function shouldHandleEarlyPointer(candidate, matchingRule) {
    if (matchingRule) return isDirectActionControl(candidate.target) || hasStableActionEvidence(candidate);
    if (!candidate.risky) return false;
    if (!candidate.actionKey || candidate.actionKey === 'interaction' || candidate.actionKey === 'link-action') return false;
    if (candidate.forceRisk && !hasStableActionEvidence(candidate)) return false;
    return isDirectActionControl(candidate.target);
  }

  function hasStableActionEvidence(candidate) {
    const selectors = candidate.match?.selectors || [];
    return selectors.some((selector) => (
      selector.includes('aria-label')
      || selector.includes('data-test')
      || selector.includes('data-action')
      || selector.startsWith('#')
    ));
  }

  function isDirectActionControl(el) {
    if (!el?.matches) return false;
    return el.matches([
      'button',
      'input[type="button"]',
      'input[type="submit"]',
      '[role="button"]',
      '[role="menuitem"]',
      '[role="switch"]',
      '[role="checkbox"]',
      'summary',
    ].join(','));
  }

  function isReadOnlyControl(el, detail) {
    if (el.disabled || el.getAttribute?.('aria-disabled') === 'true') return true;

    if (detail.tag === 'a' && !isJavaScriptActionLink(el) && !detail.actionKey) return true;

    const type = detail.inputType;
    if (detail.tag === 'input' && [
      'text',
      'search',
      'email',
      'url',
      'tel',
      'number',
      'password',
      'date',
      'time',
    ].includes(type)) {
      return true;
    }

    return false;
  }

  function isRiskyForm(form) {
    const label = normalizeText([
      form.getAttribute?.('aria-label'),
      form.getAttribute?.('name'),
      form.getAttribute?.('id'),
    ].filter(Boolean).join(' '));

    if (/\b(search|filter|find|sign in|log in|login)\b/i.test(label)) return false;
    if (actionKeyFor(label)) return true;

    return false;
  }

  function isComposerLike(el, detail) {
    if (!el.matches?.('[contenteditable="true"],textarea,input')) return false;
    const combined = normalizeText(`${detail.labelNorm} ${detail.formLabel}`);
    return /\b(message|comment|reply|post|chat|write|send)\b/i.test(combined);
  }

  function findMatchingRule(candidate) {
    return state.rules.find((rule) => (
      rule.enabled !== false
      && (rule.kind || 'block') === 'block'
      && matchesRule(rule, candidate)
    ));
  }

  function matchesRule(rule, candidate) {
    const match = rule.match || {};
    if (match.autoEvidence) {
      const family = autoEventFamily(candidate.target, candidate.eventKind);
      return NoWayAuto.matchesEvidence(match.autoEvidence, NoWayAuto.snapshot(candidate.target, family));
    }
    const target = candidate.target;
    // Starter rules describe mutations, not the menus/composers that precede them.
    if ((rule.source === 'starter' || (rule.source === 'learned' && NoWayAuto.categories.includes(rule.actionKey)))
      && !candidate.risky && (accessibleLabel(target) || !isDirectActionControl(target))) return false;

    if (Array.isArray(match.selectors)) {
      for (const selector of match.selectors) {
        if (!selector) continue;
        if (selector.includes('aria-label*=') && !candidate.risky) continue;
        try {
          if (target.matches?.(selector) || target.closest?.(selector)) {
            // If it's a weak selector (like div[role="button"]), we require a
            // text label match if the rule has text labels. This prevents
            // broad rules from "stealing" unrelated interactions.
            if (isWeakSelector(selector) && Array.isArray(match.textLabels) && match.textLabels.length > 0) {
              if (match.textLabels.some((textLabel) => labelsCompatible(normalizeText(textLabel), candidate.match.labelNorm))) {
                return true;
              }
              // If text labels are present but don't match, this weak selector match is rejected.
              continue;
            }
            return true;
          }
        } catch (_) {}
      }
    }

    if (candidate.risky && Array.isArray(match.textLabels)) {
      for (const textLabel of match.textLabels) {
        if (labelsCompatible(normalizeText(textLabel), candidate.match.labelNorm)) return true;
      }
    }

    if (match.actionKey && match.actionKey === candidate.actionKey) {
      const ruleLabel = normalizeText(match.labelNorm || match.label || rule.label);
      if (!ruleLabel) return true;
      if (sameRiskAction(match.actionKey, ruleLabel, candidate.match.labelNorm)) return true;
      return labelsCompatible(ruleLabel, candidate.match.labelNorm);
    }

    return false;
  }

  function labelsCompatible(ruleLabel, candidateLabel) {
    if (!ruleLabel || !candidateLabel) return false;
    if (ruleLabel === candidateLabel) return true;
    const action = NoWayAuto.directAction(ruleLabel);
    return Boolean(action && action === NoWayAuto.directAction(candidateLabel));
  }

  function blockEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  // Media must be the actual target or an ancestor in the event path. A backdrop
  // must never borrow the action of a hidden image or button in its descendants.
  function findNearbyMedia(target, targets) {
    if (!target || !/(^|\.)instagram\.com$/.test(location.hostname) || target.closest?.('a[href]')) return null;
    return targets.find((el) => ['img', 'video', 'canvas'].includes(el.localName)) || null;
  }

  function recordRuleHit(ruleId) {
    if (!ruleId) return;
    const now = Date.now();
    if (now - (recentHitAtByRuleId.get(ruleId) || 0) < HIT_DEDUPE_MS) return;
    recentHitAtByRuleId.set(ruleId, now);
    post('NOWAY_RULE_HIT', { ruleId });
  }

  function isAllowed(fingerprint) {
    const allowUntil = allowUntilByFingerprint.get(fingerprint) || 0;
    if (Date.now() <= allowUntil) return true;
    allowUntilByFingerprint.delete(fingerprint);
    return false;
  }

  function isRecentPrompt(fingerprint) {
    return Date.now() - (recentPromptAtByFingerprint.get(fingerprint) || 0) < PROMPT_DEDUPE_MS;
  }

  function isRecentBlock(fingerprint) {
    return Date.now() - (recentBlockAtByFingerprint.get(fingerprint) || 0) < HIT_DEDUPE_MS;
  }

  function isExplicitlyAllowed(candidate) {
    return state.rules.some((rule) => {
      if (rule.enabled === false) return false;
      if (rule.kind !== 'allow') return false;
      return matchesRule(rule, candidate);
    });
  }

  function closestAction(target) {
    if (!target?.closest) return null;
    return target.closest(ACTION_SELECTOR);
  }

  function closestActionFromRules(target) {
    if (!target?.matches || !target?.closest) return null;
    for (const rule of state.rules) {
      if (rule.enabled === false) continue;
      if ((rule.kind || 'block') !== 'block') continue;
      const selectors = rule.match?.selectors || [];
      for (const selector of selectors) {
        if (!selector) continue;
        try {
          if (target.matches(selector)) {
            return { el: target, actionKey: rule.actionKey, label: rule.label };
          }
          const ancestor = target.closest(selector);
          if (ancestor) {
            return { el: ancestor, actionKey: rule.actionKey, label: rule.label };
          }
        } catch (_) {}
      }
    }
    return null;
  }

  function looksInteractive(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const tag = el.tagName?.toLowerCase?.() || '';
    if (['button', 'a', 'input', 'textarea', 'select', 'summary'].includes(tag)) return true;
    if (el.getAttribute?.('onclick')) return true;
    if (el.getAttribute?.('role') === 'button' || el.getAttribute?.('role') === 'link' || el.getAttribute?.('role') === 'menuitem') return true;
    const style = window.getComputedStyle?.(el);
    if (style && style.cursor === 'pointer') return true;
    return false;
  }

  function eventTargets(event) {
    return (event.composedPath?.() || [event.target])
      .filter((target) => target?.nodeType === Node.ELEMENT_NODE);
  }

  function isButtonLike(el) {
    const tag = el.tagName?.toLowerCase();
    return tag === 'button'
      || el.getAttribute?.('role') === 'button'
      || el.getAttribute?.('role') === 'menuitem'
      || el.matches?.('input[type="button"],input[type="submit"]');
  }

  function isWeakSelector(selector) {
    if (!selector) return true;
    const s = selector.toLowerCase().trim();
    return s === 'button'
      || s === 'a'
      || s === '[role="button"]'
      || s === 'div[role="button"]'
      || s === 'span[role="button"]'
      || s === 'a[role="link"]'
      || s === 'span[role="link"]'
      || s === 'svg[role="img"]';
  }

  function accessibleLabel(el) {
    return NoWayAuto.snapshot(el, 'activate').label.slice(0, 140);
  }

  function formContextLabel(el) {
    const form = el.closest?.('form');
    if (!form) return '';
    return [
      form.getAttribute('aria-label'),
      form.getAttribute('name'),
      form.getAttribute('id'),
    ].filter(Boolean).join(' ').slice(0, 120);
  }

  function actionKeyFor(labelNorm) {
    return NoWayAuto.directAction(labelNorm);
  }

  function actionLabel(actionKey) {
    return ACTION_LABELS[actionKey] || '';
  }

  function sameRiskAction(actionKey, ruleLabel, candidateLabel) {
    if (!actionKey) return false;
    return labelHasActionTerm(actionKey, ruleLabel) && labelHasActionTerm(actionKey, candidateLabel);
  }

  function labelHasActionTerm(actionKey, labelNorm) {
    if (!labelNorm) return false;
    if (normalizeText(actionKey) && labelNorm.includes(normalizeText(actionKey))) return true;
    return selectorTermsForAction(actionKey, labelNorm).some((term) => labelNorm.includes(normalizeText(term)));
  }

  function fallbackActionKey(eventKind, tag, inputType) {
    if (eventKind === 'submit' || inputType === 'submit') return 'submit';
    if (tag === 'a') return 'link-action';
    return 'interaction';
  }

  function fallbackLabel(eventKind, tag, inputType) {
    if (eventKind === 'submit' || inputType === 'submit') return 'Submit form';
    if (tag === 'a') return 'Link action';
    return 'Interaction';
  }

  function confidenceFor(el, selectors, labelNorm) {
    if (selectors.some((selector) => selector.includes('data-test') || selector.includes('aria-label'))) return 0.82;
    if (stableIdFor(el)) return 0.72;
    if (labelNorm) return 0.62;
    return 0.45;
  }

  function stableSelectors(el, label, actionKey = '') {
    const selectors = [];
    const tag = el.tagName?.toLowerCase();
    if (!tag) return selectors;

    const testId = testIdFor(el);
    if (testId) selectors.push(`${tag}[${testId.name}="${cssAttr(testId.value)}"]`);

    let aria = el.getAttribute?.('aria-label');
    const role = el.getAttribute?.('role');

    if (aria && actionKey) {
      for (const term of selectorTermsForAction(actionKey, normalizeText(label || aria))) {
        selectors.push(`${tag}[aria-label*="${cssAttr(term)}" i]`);
        if (role) selectors.push(`[role="${cssAttr(role)}"][aria-label*="${cssAttr(term)}" i]`);
      }
    }

    if (aria) selectors.push(`${tag}[aria-label="${cssAttr(aria)}"]`);

    if (role && aria) selectors.push(`[role="${cssAttr(role)}"][aria-label="${cssAttr(aria)}"]`);

    const stableId = stableIdFor(el);
    if (stableId) selectors.push(`#${cssEscape(stableId)}`);

    const name = el.getAttribute?.('name');
    if (name && isStableToken(name)) selectors.push(`${tag}[name="${cssAttr(name)}"]`);

    const type = el.getAttribute?.('type');
    if (tag === 'button' && type && aria) selectors.push(`button[type="${cssAttr(type)}"][aria-label="${cssAttr(aria)}"]`);

    if (!selectors.length && label && role) {
      selectors.push(`${tag}[role="${cssAttr(role)}"]`);
    }

    return unique(selectors).slice(0, 6);
  }

  function selectorTermsForAction(actionKey, labelNorm = '') {
    const terms = ACTION_SELECTOR_TERMS[actionKey] || [];
    const matched = terms.filter((term) => labelNorm.includes(normalizeText(term)));
    return matched.length ? matched : terms.slice(0, 1);
  }

  function testIdFor(el) {
    const attrs = ['data-testid', 'data-test-id', 'data-test', 'data-control-name', 'data-action'];
    for (const name of attrs) {
      const value = el.getAttribute?.(name);
      if (value && value.length <= 120) return { name, value };
    }
    return null;
  }

  function testIdLabelFor(el) {
    const testId = testIdFor(el);
    return testId ? `${testId.name}=${testId.value}` : '';
  }

  function stableIdFor(el) {
    const id = el.getAttribute?.('id') || '';
    return isStableToken(id) ? id : '';
  }

  function isStableToken(value) {
    if (!value || value.length > 80) return false;
    if (/^[a-f0-9-]{16,}$/i.test(value)) return false;
    if (/\d{5,}/.test(value)) return false;
    return /^[a-zA-Z][\w:.-]*$/.test(value);
  }

  function isJavaScriptActionLink(el) {
    if (el.tagName?.toLowerCase() !== 'a') return false;
    const href = el.getAttribute('href') || '';
    return href === '#'
      || href.startsWith('javascript:')
      || el.getAttribute('role') === 'button'
      || el.hasAttribute('onclick');
  }

  function serializeCandidate(candidate) {
    return {
      eventKind: candidate.eventKind,
      actionKey: candidate.actionKey,
      label: candidate.label,
      risky: candidate.risky,
      confidence: candidate.confidence,
      fingerprint: candidate.fingerprint,
      match: candidate.match,
    };
  }

  function post(type, payload) {
    window.postMessage({ source: SOURCE_MAIN, type, payload }, '*');
  }

  function normalizeText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function cssAttr(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
  }
})();
