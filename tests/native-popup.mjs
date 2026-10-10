// Check the toolbar container itself: opening popup.html in a tab cannot
// reproduce Chrome's content-based popup sizing.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

export async function checkNativePopup(endpoint, extensionId) {
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  try {
    const targets = (await send('Target.getTargets')).targetInfos;
    const worker = targets.find((target) => target.url === `chrome-extension://${extensionId}/background/service_worker.js`);
    assert.ok(worker, 'Extension worker is running');
    const workerSession = (await send('Target.attachToTarget', { targetId: worker.targetId, flatten: true })).sessionId;
    await send('Runtime.evaluate', { expression: 'chrome.action.openPopup()', awaitPromise: true }, workerSession);
    const popup = (await send('Target.getTargets')).targetInfos.find((target) =>
      target.url === `chrome-extension://${extensionId}/popup/popup.html` && !targets.some((old) => old.targetId === target.targetId));
    assert.ok(popup, 'Native toolbar popup opened');
    const session = (await send('Target.attachToTarget', { targetId: popup.targetId, flatten: true })).sessionId;
    const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session)).result.value;
    await evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true)))))');
    const metrics = await evaluate('({width:innerWidth,bodyWidth:document.body.getBoundingClientRect().width,native:document.documentElement.classList.contains("toolbar-popup"),overflow:document.documentElement.scrollWidth>innerWidth,exportBottom:document.getElementById("export-rules").getBoundingClientRect().bottom})');
    assert.equal(metrics.native, true);
    assert.equal(metrics.bodyWidth, 380);
    assert.ok(metrics.width >= 380 && metrics.width <= 400, 'Chrome preserves the content width, allowing for a native scrollbar');
    assert.equal(metrics.overflow, false);
    assert.ok(metrics.exportBottom <= 600, 'Toolbar file actions remain in view');
    for (const theme of ['light', 'dark']) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }, session);
      const screenshot = await send('Page.captureScreenshot', {}, session);
      await writeFile(`/tmp/noway-native-popup-${theme}.png`, Buffer.from(screenshot.data, 'base64'));
    }
    await evaluate('window.close();true');
  } finally {
    for (const request of pending.values()) clearTimeout(request.timer);
    socket.close();
  }
}
