/* global NoWayAuto, NoWayClassifier */
'use strict';
const classifier = new NoWayClassifier();
const requests = new Map();
const setup = document.getElementById('setup-model');
const cancel = document.getElementById('cancel-setup');
const statusText = document.getElementById('model-status');
const progress = document.getElementById('download-progress');
let port;
let windowId;
let status = 'idle';
let shuttingDown = false;
let setupEpoch = 0;

function setStatus(next, text) {
  status = next;
  statusText.textContent = text;
  document.getElementById('model-dot').classList.toggle('ready', next === 'ready');
  setup.disabled = next === 'loading' || next === 'unavailable' || next === 'ready';
  setup.hidden = next === 'ready';
  cancel.hidden = next !== 'loading';
  try { port?.postMessage({ type: 'status', status }); } catch (_) {}
  updateSite();
}

async function connect() {
  if (shuttingDown) return;
  windowId = (await chrome.windows.getCurrent()).id;
  const connection = chrome.runtime.connect({ name: 'noway-model' });
  port = connection;
  connection.onMessage.addListener(async (message) => {
    if (message.type === 'registered') connection.postMessage({ type: 'status', status });
    if (message.type === 'cancel') requests.get(message.id)?.abort();
    if (message.type !== 'classify') return;
    const controller = new AbortController();
    requests.set(message.id, controller);
    const deadline = setTimeout(() => controller.abort(), 2000);
    try {
      const result = await classifier.classify(message.evidence, controller.signal);
      if (!controller.signal.aborted) connection.postMessage({ type: 'result', id: message.id, result });
    } catch (_) {
      try { connection.postMessage({ type: 'result', id: message.id, result: NoWayAuto.uncertain() }); } catch (_) {}
    } finally { clearTimeout(deadline); requests.delete(message.id); }
  });
  connection.onDisconnect.addListener(() => {
    if (port !== connection) return;
    for (const controller of requests.values()) controller.abort();
    requests.clear();
    port = null;
    if (!shuttingDown) setTimeout(() => connect().catch(() => {}), 1000);
  });
  connection.postMessage({ type: 'register', windowId });
}

setup.addEventListener('click', async () => {
  const epoch = ++setupEpoch;
  document.getElementById('panel-error').textContent = '';
  setStatus('loading', 'Starting…');
  progress.hidden = true;
  try {
    await classifier.setup((loaded) => {
      if (epoch !== setupEpoch) return;
      progress.hidden = false;
      progress.value = Number.isFinite(loaded) ? loaded : 0;
      statusText.textContent = `Downloading · ${Math.round(progress.value * 100)}%`;
    });
    if (epoch === setupEpoch) setStatus('ready', 'Ready');
  } catch (error) {
    if (epoch === setupEpoch) {
      classifier.destroy();
      setStatus('error', 'Couldn’t start the model.');
      document.getElementById('panel-error').textContent = error.message || 'Try again.';
    }
  } finally { if (epoch === setupEpoch) progress.hidden = true; }
});
cancel.addEventListener('click', () => {
  setupEpoch++;
  classifier.destroy();
  progress.hidden = true;
  setStatus('idle', 'Setup cancelled.');
});
document.getElementById('manage-rules').addEventListener('click', () => chrome.runtime.openOptionsPage());

async function updateSite() {
  if (!Number.isInteger(windowId)) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    const state = await chrome.runtime.sendMessage({ type: 'NOWAY_GET_POPUP_STATE', tabUrl: tab?.url, tabId: tab?.id });
    document.getElementById('current-site').textContent = state.hostname || 'Open a web page';
    document.getElementById('site-status').textContent = !state.permissionGranted ? 'Open No Way! to allow site access.'
      : !state.originState?.trainingEnabled || state.auto?.strategy !== 'auto' ? 'Open No Way! and turn on Auto.'
      : status === 'ready' ? 'Auto is on.' : 'Review actions manually until the model is ready.';
  } catch (_) {}
}
chrome.tabs.onActivated.addListener(updateSite);
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.status === 'complete') updateSite(); });
const siteTimer = setInterval(updateSite, 5000);
window.addEventListener('pagehide', () => {
  shuttingDown = true;
  setupEpoch++;
  clearInterval(siteTimer);
  for (const controller of requests.values()) controller.abort();
  classifier.destroy();
  port?.disconnect();
});
(async () => {
  await connect();
  try {
    const available = await classifier.availability();
    if (available === 'unavailable') {
      setStatus('unavailable', 'Auto isn’t available on this device. Use manual training.');
    } else {
      setup.textContent = available === 'available' ? 'Start Model' : available === 'unknown' ? 'Set Up Model' : 'Download Model';
      setStatus('idle', available === 'available' ? 'Ready to start.'
        : available === 'unknown' ? 'Check availability by setting up the model.'
          : 'Download the model to use Auto.');
    }
  } catch (_) { setStatus('unavailable', 'Auto isn’t available in this browser. Use manual training.'); }
})();
