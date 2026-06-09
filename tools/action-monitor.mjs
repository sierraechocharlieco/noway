#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const profile = resolve(args.profile || '.harness/accounts');
const match = new RegExp(args.match || 'https://www\\.linkedin\\.com/');
const port = args.port || await readPort(profile);
const json = Boolean(args.json);
const attachedTargets = new Map();

if (!port) {
  console.error(`No DevTools port found. Pass --port, or launch a harness using profile: ${profile}`);
  process.exit(1);
}

await attachMatchingTargets();
console.error('Interact with the page. Press Ctrl+C to stop the monitor.');

setInterval(() => {
  attachMatchingTargets().catch((error) => {
    console.error(`Target refresh failed: ${error.message}`);
  });
}, 2000);

process.on('SIGINT', () => {
  for (const target of attachedTargets.values()) target.ws.close();
  process.exit(0);
});

function parseArgs(argv) {
  const parsed = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const readValue = () => {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error(`${arg} requires a value`);
      i += 1;
      return next;
    };

    if (arg === '--profile') parsed.profile = readValue();
    else if (arg === '--port') parsed.port = readValue();
    else if (arg === '--match') parsed.match = readValue();
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

async function readPort(profileDir) {
  const activePortPath = resolve(profileDir, 'DevToolsActivePort');
  if (!existsSync(activePortPath)) return null;
  const [activePort] = (await readFile(activePortPath, 'utf8')).trim().split(/\r?\n/);
  return activePort;
}

async function findTargets(activePort, urlPattern) {
  const targets = await getJson(activePort, '/json/list');
  return targets.filter((item) => item.type === 'page'
    && urlPattern.test(item.url)
    && !item.url.startsWith('devtools://'));
}

function getJson(activePort, path) {
  return new Promise((resolveGet, rejectGet) => {
    http.get({ host: '127.0.0.1', port: activePort, path }, (response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          resolveGet(JSON.parse(body));
        } catch (error) {
          rejectGet(error);
        }
      });
    }).on('error', rejectGet);
  });
}

async function attachMatchingTargets() {
  const targets = await findTargets(port, match);
  if (targets.length === 0 && attachedTargets.size === 0) {
    console.error(`No page target matched ${match} on DevTools port ${port}`);
  }

  for (const target of targets) {
    if (attachedTargets.has(target.id)) continue;
    await attachTarget(target);
  }
}

async function attachTarget(target) {
  const state = {
    id: 0,
    pending: new Map(),
    target,
    ws: new WebSocket(target.webSocketDebuggerUrl),
  };

  attachedTargets.set(target.id, state);

  state.ws.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (_) {
      return;
    }

    if (message.id && state.pending.has(message.id)) {
      state.pending.get(message.id)(message);
      state.pending.delete(message.id);
      return;
    }

    if (message.method === 'Runtime.consoleAPICalled') {
      const args = message.params.args || [];
      const first = args[0];
      if (first?.value === '[No Way!]') {
        const raw = args[1]?.value || '{}';
        try {
          const payload = JSON.parse(raw);
          payload.targetUrl = target.url;
          if (json) {
            console.log(JSON.stringify(payload));
          } else {
            printInternalDecision(payload);
          }
        } catch (_) {}
      }
      return;
    }

    if (message.method === 'Runtime.bindingCalled' && message.params.name === '__noWayActionMonitor') {
      try {
        const payload = JSON.parse(message.params.payload);
        payload.targetUrl = target.url;
        if (json) {
          console.log(JSON.stringify(payload));
        } else {
          printEvent(payload);
        }
      } catch (_) {}
    }
  });

  state.ws.addEventListener('close', () => {
    attachedTargets.delete(target.id);
  });

  state.ws.addEventListener('error', () => {
    console.error(`DevTools connection error for ${target.url}; will reattach if the page is still open.`);
  });

  await new Promise((resolveOpen, rejectOpen) => {
    state.ws.addEventListener('open', resolveOpen, { once: true });
    state.ws.addEventListener('error', rejectOpen, { once: true });
  });

  await send(state, 'Runtime.enable');
  await send(state, 'Page.enable');
  await send(state, 'Console.enable');
  await send(state, 'Runtime.addBinding', { name: '__noWayActionMonitor' });
  await send(state, 'Page.addScriptToEvaluateOnNewDocument', { source: monitorSource() });
  await send(state, 'Runtime.evaluate', { expression: monitorSource(), awaitPromise: true });

  console.error(`Monitoring ${target.url}`);
}

function send(state, method, params = {}) {
  return new Promise((resolveSend) => {
    const message = { id: ++state.id, method, params };
    state.pending.set(message.id, resolveSend);
    state.ws.send(JSON.stringify(message));
  });
}

function printEvent(event) {
  const parts = [
    `[${event.time}]`,
    event.kind,
    event.tag,
    event.role ? `role=${event.role}` : '',
    event.ariaLabel ? `aria="${event.ariaLabel}"` : '',
    event.text ? `text="${event.text}"` : '',
    event.href ? `href=${event.href}` : '',
    `defaultPrevented=${event.defaultPrevented}`,
    event.blocked ? 'blocked=true' : 'blocked=false',
  ].filter(Boolean);

  console.log(parts.join(' '));
  if (event.selectors.length > 0) {
    console.log(`  selectors: ${event.selectors.slice(0, 4).join(' | ')}`);
  }
}

function printInternalDecision(event) {
  const time = event.time ? new Date(event.time).toISOString() : new Date().toISOString();
  const parts = [
    `[${time}]`,
    `[${event.source || 'main'}]`,
    event.stage,
    event.decision ? `decision=${event.decision}` : '',
    event.actionKey ? `action=${event.actionKey}` : '',
    event.label ? `label="${event.label}"` : '',
    event.ruleCount !== undefined ? `rules=${event.ruleCount}` : '',
    event.matchingRuleId ? `matchedRule=${event.matchingRuleId}` : '',
    event.risky !== undefined ? `risky=${event.risky}` : '',
    event.selectors?.length ? `selectors=[${event.selectors.length}]` : '',
    event.error ? `error="${event.error}"` : '',
  ];
  console.log(parts.filter(Boolean).join(' '));
}

function monitorSource() {
  return String.raw`
(() => {
  'use strict';

  if (window.__NOWAY_ACTION_MONITOR_INSTALLED__) return;
  window.__NOWAY_ACTION_MONITOR_INSTALLED__ = true;

  const ATTRS = [
    'aria-label',
    'data-test-id',
    'data-testid',
    'data-test',
    'data-control-name',
    'data-view-name',
    'name',
    'title',
    'role',
    'type',
  ];

  function cssEscape(value) {
    if (window.CSS?.escape) return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function actionSelector() {
    return [
      'button',
      'a[href]',
      'input',
      'select',
      'textarea',
      '[role="button"]',
      '[role="link"]',
      '[role="menuitem"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="switch"]',
      '[contenteditable="true"]',
      '[aria-label]',
    ].join(',');
  }

  function eventElements(event) {
    return (event.composedPath?.() ?? [event.target])
      .filter((item) => item?.nodeType === Node.ELEMENT_NODE);
  }

  function nearestActionElement(event) {
    const selector = actionSelector();

    for (const item of eventElements(event)) {
      const closest = item.closest?.(selector);
      if (closest) return closest;
    }

    return event.target;
  }

  function eventPathPreview(event) {
    return eventElements(event).slice(0, 8).map((el) => {
      const tag = el.tagName.toLowerCase();
      const id = el.id ? '#' + el.id : '';
      const className = typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.')
        : '';
      const role = el.getAttribute('role') ? '[role="' + el.getAttribute('role') + '"]' : '';
      const aria = el.getAttribute('aria-label') ? '[aria="' + cleanText(el.getAttribute('aria-label')).slice(0, 48) + '"]' : '';

      return tag + id + className + role + aria;
    });
  }

  function selectorCandidates(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return [];

    const tag = el.tagName.toLowerCase();
    const candidates = [];

    if (el.id) candidates.push('#' + cssEscape(el.id));

    for (const attr of ATTRS) {
      const value = el.getAttribute(attr);
      if (value) candidates.push(tag + '[' + attr + '="' + cssEscape(value) + '"]');
    }

    const aria = el.getAttribute('aria-label');
    if (aria) {
      const firstWord = aria.trim().split(/\s+/)[0];
      if (firstWord && firstWord.length > 2) {
        candidates.push(tag + '[aria-label*="' + cssEscape(firstWord) + '"]');
      }
    }

    return [...new Set(candidates)];
  }

  function currentBlockedState() {
    const toasts = [...document.querySelectorAll('[data-noway-toast]')];
    const latestToast = toasts.at(-1);
    return {
      blocked: Boolean(latestToast),
      blockedLabel: cleanText(latestToast?.textContent),
    };
  }

  function emit(kind, event) {
    const el = nearestActionElement(event);
    const rect = el?.getBoundingClientRect?.();
    const blockedState = currentBlockedState();
    const payload = {
      kind,
      time: new Date().toISOString(),
      url: location.href,
      tag: el?.tagName?.toLowerCase?.() || '',
      role: el?.getAttribute?.('role') || '',
      ariaLabel: el?.getAttribute?.('aria-label') || '',
      text: cleanText(el?.innerText || el?.textContent).slice(0, 160),
      href: el?.getAttribute?.('href') || '',
      type: el?.getAttribute?.('type') || '',
      rect: rect ? {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      } : null,
      selectors: selectorCandidates(el),
      path: eventPathPreview(event),
      defaultPrevented: event.defaultPrevented,
      blocked: blockedState.blocked,
      blockedLabel: blockedState.blockedLabel,
    };

    window.__noWayActionMonitor(JSON.stringify(payload));
  }

  document.addEventListener('pointerdown', (event) => {
    setTimeout(() => emit('pointerdown', event), 0);
  }, true);

  document.addEventListener('mousedown', (event) => {
    setTimeout(() => emit('mousedown', event), 0);
  }, true);

  document.addEventListener('touchstart', (event) => {
    setTimeout(() => emit('touchstart', event), 0);
  }, true);

  document.addEventListener('submit', (event) => {
    setTimeout(() => emit('submit', event), 0);
  }, true);

  document.addEventListener('click', (event) => {
    setTimeout(() => emit('click', event), 0);
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      setTimeout(() => emit('enter', event), 0);
    }
  }, true);

  console.info('[No Way!] Action monitor installed.');
})();
`;
}

function printHelp() {
  console.log(`
No Way! action monitor

Usage:
  node tools/action-monitor.mjs [options]

Options:
  --profile DIR      Harness profile with DevToolsActivePort. Default: .harness/accounts
  --port PORT        DevTools port to connect to.
  --match REGEX      Page URL regex. Default: https://www\\.linkedin\\.com/
  --json             Print newline-delimited JSON events.
`);
}
