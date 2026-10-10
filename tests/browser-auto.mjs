// Requires Playwright on NODE_PATH. Uses the existing headed Chrome harness.
// Only the temporary test copy receives a mandatory localhost host permission.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { checkClassification } from './classification-browser.mjs';
import { checkNativePopup } from './native-popup.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const chromePath = process.env.NOWAY_TEST_CHROME;
if (!chromePath) throw new Error('Set NOWAY_TEST_CHROME to a Chrome for Testing executable.');
const testRoot = await mkdtemp(join(tmpdir(), 'noway-auto-test-'));
const fixture = `<!doctype html><html lang="en"><meta charset="utf-8"><title>No Way fixture</title>
<style>body{font:16px system-ui;padding:40px}button{padding:16px;margin:8px}#backdrop{padding:40px;background:#eee;margin:16px}</style>
<button data-testid="follow">Follow Jane Doe</button><button data-testid="track">Track updates</button>
<button data-testid="browse">Browse history</button><button data-testid="uncertain">Ambiguous control</button>
<button data-testid="timeout">Slow control</button><button data-testid="change">Change during check</button>
<div id="backdrop"><button hidden>Like hidden content</button><span>Backdrop</span></div>
<div id="nested-control" role="button" tabindex="0"><span>Browse overview</span><button hidden>Follow hidden person</button></div>
<script>window.mutations={};for(const button of document.querySelectorAll('button'))for(const type of ['pointerdown','click'])button.addEventListener(type,()=>{let id=button.dataset.testid;window.mutations[id]=(window.mutations[id]||0)+1});</script></html>`;
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(fixture); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const origin = new URL(url).origin;
for (const path of ['ai', 'assets', 'shared', 'background', 'content', 'popup', 'options', 'icons', 'tools/harness.mjs']) {
  await cp(join(root, path), join(testRoot, path), { recursive: true });
}
const harnessPath = join(testRoot, 'tools/harness.mjs');
await writeFile(harnessPath, (await readFile(harnessPath, 'utf8')).replace('const chromeArgs = [', "const chromeArgs = ['--disable-background-timer-throttling',"));
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://127.0.0.1/*'];
await writeFile(join(testRoot, 'manifest.json'), JSON.stringify(manifest));
const harness = spawn(process.execPath, [join(testRoot, 'tools/harness.mjs'), '--chrome', resolve(chromePath), '--url', url, '--no-profile-source', '--no-devtools'], { stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
let harnessLog = '';
const endpoint = await new Promise((resolveEndpoint, reject) => {
  const timer = setTimeout(() => reject(new Error(`Harness did not start: ${harnessLog}`)), 20000);
  const onData = (chunk) => {
    harnessLog += chunk;
    const match = harnessLog.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (match) { clearTimeout(timer); resolveEndpoint(match[1]); }
  };
  harness.stdout.on('data', onData); harness.stderr.on('data', onData);
  harness.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Harness exited ${code}: ${harnessLog}`)); });
});
let checks = 0;
const checked = (label) => { checks++; console.log(`PASS ${label}`); };
try {
  console.log('Harness connected; locating the No Way! worker.');
  browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 });
  const context = browser.contexts()[0];
  context.on('weberror', (error) => console.error('Browser error:', error.error().stack));
  let worker = context.serviceWorkers().find((w) => w.url().endsWith('/background/service_worker.js'));
  if (!worker) worker = await context.waitForEvent('serviceworker', { predicate: (w) => w.url().endsWith('/background/service_worker.js'), timeout: 20000 });
  const id = new URL(worker.url()).host;
  console.log('No Way! worker loaded.');
  const page = context.pages().find((p) => p.url().startsWith(origin)) || await context.newPage();
  await page.goto(url);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  console.log('Popup loaded.');
  const send = (message) => popup.evaluate((m) => chrome.runtime.sendMessage(m), message);
  const nativeModel = await popup.evaluate(async () => {
    if (!globalThis.LanguageModel) return 'API absent';
    try { return await Promise.race([LanguageModel.availability({ expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] }), new Promise((resolve) => setTimeout(() => resolve('availability timed out'), 3000))]); }
    catch (e) { return e.name; }
  });
  console.log(`Native Prompt API availability: ${nativeModel}`);
  const model = await context.newPage();
  await model.addInitScript(() => {
    // The model answers with one effect for a control card (see NoWayAuto.card).
    const effect = (label) => /Track updates/.test(label) ? 'follow' : /Ambiguous|Slow|Change during/.test(label) ? 'unknown' : 'local-view';
    const base = { destroy() {}, async clone() { return { destroy() {}, prompt(input, { signal }) {
      const label = JSON.parse(input.match(/^Label: (".*")$/m)?.[1] || '""');
      const ms = /Slow/.test(label) ? 3000 : /View foreground safe/.test(label) ? 700 : /Change during/.test(label) ? 600 : 80;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(JSON.stringify(effect(label))), ms);
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
      });
    } }; } };
    Object.defineProperty(globalThis, 'LanguageModel', { configurable: true, value: { availability: async () => 'available', create: async () => base } });
  });
  await model.goto(`chrome-extension://${id}/ai/sidepanel.html`);
  await model.getByRole('button', { name: 'Start Model' }).click();
  await model.getByText('Ready').waitFor();
  await model.setViewportSize({ width: 360, height: 960 });
  await model.screenshot({ path: '/tmp/noway-auto-panel-light.png', fullPage: true });
  let response = await send({ type: 'NOWAY_SET_AUTO', origin, enabled: true });
  assert.equal(response.ok, true);
  await send({ type: 'NOWAY_SET_ORIGIN_FLAGS', origin, protectionEnabled: true });
  await page.bringToFront();
  await page.getByText('No Way! · Auto training', { exact: true }).waitFor();
  const count = (key) => page.evaluate((k) => window.mutations[k] || 0, key);
  await page.locator('[data-testid=follow]').click();
  await page.getByText('Rule saved: Follow', { exact: true }).waitFor();
  assert.equal(await count('follow'), 0);
  checked('Auto learns a mutation before pointerdown/click handlers run');
  await send({ type: 'NOWAY_SET_DEBUG_FLAG', enabled: true });
  await page.evaluate(() => { window.__NOWAY_DEBUG__.events = []; });
  await page.locator('[data-testid=follow]').click();
  const activationCount = await page.evaluate(() => window.__NOWAY_DEBUG__.events.filter((e) => e.stage === 'activation').length);
  await popup.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url: `${new URL(url).origin}/*` });
    for (let repeat = 0; repeat < 2; repeat++) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['shared/auto.js', 'content/guard-main.js'], world: 'MAIN' });
  }, url);
  await page.evaluate(() => { window.__NOWAY_DEBUG__.events = []; });
  await page.locator('[data-testid=follow]').click();
  assert.equal(await page.evaluate(() => window.__NOWAY_DEBUG__.events.filter((e) => e.stage === 'activation').length), activationCount);
  checked('Repeated MAIN-world injection does not duplicate guard listeners');
  await page.evaluate(() => { window.testMessages=[]; window.addEventListener('message', e=>{ if(e.data?.source?.startsWith('NOWAY')) window.testMessages.push(e.data); }); });
  await page.locator('[data-testid=track]').click();
  await page.waitForTimeout(500);
  const interim = await send({ type: 'NOWAY_GET_RULES' });
  if (interim.origins[origin].rules.length !== 2) {
    console.log('Track diagnostic:', await page.locator('#noway-training-prompt').allTextContents());
    console.log('Bridge:', JSON.stringify(await page.evaluate(() => window.testMessages)));
    console.log('Decisions:', JSON.stringify(await page.evaluate(() => window.__NOWAY_DEBUG__)));
    console.log('Stored state:', JSON.stringify(interim.origins[origin]));
    console.log('Worker pending:', await worker.evaluate(() => ({ pending: autoPending.size, proofs: autoProofs.size })));
  }
  await popup.waitForTimeout(400);
  assert.equal(await count('track'), 0);
  const rules = await send({ type: 'NOWAY_GET_RULES' });
  assert.equal(rules.origins[origin].rules.length, 2);
  assert.equal(rules.origins[origin].rules.some((r) => r.match.autoEvidence?.label === 'Track updates' && r.autoLearned), true);
  checked('Unfamiliar wording creates a narrow rule with model provenance');
  await page.locator('#backdrop').click({ position: { x: 10, y: 10 } });
  assert.equal(await page.locator('#noway-training-prompt').count(), 0);
  checked('Backdrop does not inherit a hidden descendant action');
  await page.locator('#nested-control').click({ position: { x: 2, y: 2 } });
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#noway-training-prompt').count(), 0);
  assert.equal((await send({ type: 'NOWAY_GET_RULES' })).origins[origin].rules.length, 2);
  assert.equal(await page.evaluate(() => NoWayAuto.snapshot(document.querySelector('#nested-control'), 'activate').label), 'Browse overview');
  checked('Control labels exclude hidden nested actions');
  // Force a foreground uncached safe check and hold the physical mouse gesture open.
  await page.evaluate(() => {
    const button = document.createElement('button'); button.dataset.testid = 'safe-new'; button.textContent = 'View foreground safe';
    for (const type of ['pointerdown', 'click']) button.addEventListener(type, () => { window.mutations['safe-new'] = (window.mutations['safe-new'] || 0) + 1; });
    document.body.appendChild(button);
  });
  const box = await page.locator('[data-testid=safe-new]').boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  try { await page.waitForFunction(() => window.testMessages.some((m) => m.type === 'NOWAY_AUTO_RESULT'
    && m.payload.decision === 'safe' && m.payload.evidenceKey.includes('View foreground safe')), undefined, { timeout: 5000 }); } catch (error) {
    console.log('Safe check mutations:', await count('safe-new'));
    console.log('Safe check UI:', await page.locator('#noway-training-prompt').allTextContents());
    console.log('Safe bridge:', JSON.stringify(await page.evaluate(()=>window.testMessages)));
    throw error;
  }
  await page.mouse.up();
  assert.equal(await count('safe-new'), 0);
  await page.locator('[data-testid=safe-new]').click();
  if (!await count('safe-new')) {
    console.log('Retry decisions:', JSON.stringify(await page.evaluate(() => window.__NOWAY_DEBUG__.events.slice(-20))));
    console.log('Retry messages:', JSON.stringify(await page.evaluate(() => window.testMessages.slice(-12))));
  }
  assert.ok(await count('safe-new') > 0);
  checked('A safe result cannot release the original gesture; a fresh click proceeds');
  const beforeNavigation = await count('safe-new');
  await page.evaluate(() => {
    history.pushState({}, '', '/?route=next');
    document.querySelector('[data-testid=safe-new]').click();
  });
  assert.equal(await count('safe-new'), beforeNavigation);
  checked('SPA navigation clears a safe cache synchronously before another activation');
  await page.locator('[data-testid=uncertain]').click();
  await page.getByRole('dialog', { name: 'No Way! Review action' }).waitFor();
  const fontFaces = await popup.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url: `${new URL(url).origin}/*` });
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED',
      func: async () => (await NoWayBrand.loadFonts()).map((r) => ({ status: r.status, family: r.value?.family, loaded: r.value?.status, error: r.reason?.message })) });
    return result.result;
  }, url);
  assert.ok(fontFaces.every((f) => f.loaded === 'loaded'), JSON.stringify(fontFaces));
  await page.addStyleTag({ content: 'button, span, div { color: magenta !important; background: yellow !important; font-family: serif !important; }' });
  const reviewButton = page.getByRole('dialog', { name: 'No Way! Review action' }).getByRole('button', { name: 'Block', exact: true });
  assert.equal(await reviewButton.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(154, 49, 31)');
  assert.ok((await reviewButton.evaluate((el) => getComputedStyle(el).fontFamily)).includes('No Way Hanken'));
  await page.setViewportSize({ width: 320, height: 850 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const toastBoxes = (await page.locator('[data-noway-toast]').evaluateAll((els) => els.map((el) => {
    const { y, height } = el.getBoundingClientRect(); return { y, height };
  }))).sort((a, b) => a.y - b.y);
  for (let i = 1; i < toastBoxes.length; i++) assert.ok(toastBoxes[i - 1].y + toastBoxes[i - 1].height <= toastBoxes[i].y);
  await page.screenshot({ path: '/tmp/noway-review-prompt-light.png', fullPage: true });
  assert.ok((await page.getByRole('dialog', { name: 'No Way! Review action' }).boundingBox()).width <= 288);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.screenshot({ path: '/tmp/noway-review-prompt-dark.png', fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.locator('style').last().evaluate((el) => el.remove());
  await page.setViewportSize({ width: 1280, height: 900 });
  checked('Injected SEC fonts and prompt styles withstand hostile page CSS at compact widths');
  await page.getByRole('button', { name: 'Always Allow', exact: true }).click();
  await page.getByText('Always allowed: Ambiguous control', { exact: true }).waitFor();
  await page.locator('[data-testid=uncertain]').click();
  assert.ok(await count('uncertain') > 0);
  checked('Manual Always Allow remains usable inside Auto and overrides future checks');
  await page.locator('[data-testid=timeout]').click();
  await page.getByRole('dialog', { name: 'No Way! Review action' }).waitFor();
  assert.equal(await count('timeout'), 0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  checked('Model timeout stays stopped and opens manual review');
  const before = (await send({ type: 'NOWAY_GET_RULES' })).origins[origin].rules.length;
  await page.locator('[data-testid=change]').click();
  await page.evaluate(() => { document.querySelector('[data-testid=change]').textContent = 'Changed target'; });
  await page.waitForTimeout(750);
  assert.equal((await send({ type: 'NOWAY_GET_RULES' })).origins[origin].rules.length, before);
  assert.equal(await count('change'), 0);
  checked('Changed evidence cannot produce a late saved rule');
  await send({ type: 'NOWAY_SET_ORIGIN_FLAGS', origin, trainingEnabled: false });
  await page.locator('[data-testid=track]').click();
  assert.equal(await count('track'), 0);
  checked('Model-learned rule enforces synchronously in Protection without Auto');
  const secondPage = await context.newPage();
  await secondPage.goto(url);
  await secondPage.getByText('No Way! · Protection', { exact: true }).waitFor();
  assert.equal(await secondPage.evaluate(() => typeof NoWayAuto), 'object');
  const worldPolicies = await popup.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({ url: `${new URL(url).origin}/*` });
    const tab = tabs.find((tab) => tab.active);
    if (!tab) throw new Error('Fresh test tab not found');
    return Promise.all(['MAIN', 'ISOLATED'].map(async (world) => {
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world,
        func: () => ({ loaded: typeof globalThis.NoWayAuto === 'object', version: globalThis.NoWayAuto?.promptVersion }) });
      return result;
    }));
  }, url);
  assert.equal(worldPolicies.every((policy) => policy.loaded), true);
  assert.equal(worldPolicies[0].version, worldPolicies[1].version);
  await secondPage.locator('[data-testid=follow]').focus();
  await secondPage.keyboard.press('Enter');
  assert.equal(await secondPage.evaluate(() => window.mutations.follow || 0), 0);
  const manualStrategy = await send({ type: 'NOWAY_SET_AUTO', origin, enabled: false });
  const manualFlags = await send({ type: 'NOWAY_SET_ORIGIN_FLAGS', origin, trainingEnabled: true });
  try { await secondPage.getByText('No Way! · Training', { exact: true }).waitFor({ timeout: 3000 }); }
  catch (error) { console.log('Manual sync:', JSON.stringify({ manualStrategy, manualFlags }), await secondPage.locator('#noway-badge').textContent()); throw error; }
  await secondPage.locator('[data-testid=follow]').click();
  await secondPage.getByRole('dialog', { name: 'No Way! Review action' }).waitFor();
  await secondPage.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await secondPage.evaluate(() => window.mutations.follow || 0), 0);
  await secondPage.locator('#nested-control').click({ position: { x: 2, y: 2 } });
  await secondPage.locator('#backdrop').dblclick({ position: { x: 10, y: 10 } });
  assert.equal(await secondPage.getByRole('dialog', { name: 'No Way! Review action' }).count(), 0);
  checked('Keyboard enforcement and live same-origin Manual training retain their semantics');
  await secondPage.close();
  await send({ type: 'NOWAY_SET_AUTO', origin, enabled: true });
  const trackRule = (await send({ type: 'NOWAY_GET_RULES' })).origins[origin].rules.find((r) => r.match.autoEvidence?.label === 'Track updates');
  await send({ type: 'NOWAY_DELETE_RULE', origin, ruleId: trackRule.id });
  await page.locator('[data-testid=track]').click();
  await page.getByRole('dialog', { name: 'No Way! Review action' }).waitFor();
  assert.equal((await send({ type: 'NOWAY_GET_RULES' })).origins[origin].rules.some((r) => r.match.autoEvidence?.label === 'Track updates'), false);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  checked('Deleting an auto rule suppresses recreation');
  await model.close();
  await page.getByText('No Way! · Auto paused', { exact: true }).waitFor();
  await page.locator('[data-testid=browse]').click();
  await page.getByRole('dialog', { name: 'No Way! Review action' }).waitFor();
  checked('Host closure invalidates safe caches and enables manual review');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  // Product UI screenshots at both themes, compact width, and enlarged text.
  await page.bringToFront();
  const currentTab = await send({ type: 'NOWAY_GET_POPUP_STATE', tabUrl: url });
  assert.equal(currentTab.auto.strategy, 'auto');
  await popup.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({ url: `${new URL(url).origin}/*` });
    currentTab = tabs[0];
    await refresh();
  }, url);
  await popup.setViewportSize({ width: 380, height: 600 });
  await popup.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await popup.bringToFront();
  const exportAction = await popup.getByRole('button', { name: 'Export', exact: true }).boundingBox();
  await popup.screenshot({ path: '/tmp/noway-auto-popup-light.png', fullPage: true });
  assert.ok(exportAction.y + exportAction.height <= 600, `Primary popup actions fit Chrome’s popup height (${exportAction.y + exportAction.height}px)`);
  await popup.getByRole('button', { name: 'About Auto training' }).focus();
  assert.equal(await popup.locator('#auto-tooltip').isVisible(), true);
  await popup.keyboard.press('Escape');
  assert.equal(await popup.locator('#auto-tooltip').isVisible(), false);
  await popup.getByRole('button', { name: 'About Auto training' }).blur();
  await popup.getByRole('button', { name: 'About Auto training' }).focus();
  await popup.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await popup.screenshot({ path: '/tmp/noway-auto-popup-dark.png', fullPage: true });
  await popup.setViewportSize({ width: 320, height: 1000 });
  await popup.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options/rules.html`);
  await options.setViewportSize({ width: 1080, height: 900 });
  await options.getByRole('button', { name: 'Edit JSON for Follow', exact: true }).click();
  await options.getByRole('textbox', { name: 'Rule JSON' }).fill('{bad json');
  await options.getByRole('button', { name: 'Save Changes' }).click();
  assert.equal(await options.getByRole('dialog', { name: 'Edit Rule JSON' }).isVisible(), true);
  assert.equal(await options.locator('#raw-json').getAttribute('aria-invalid'), 'true');
  await options.screenshot({ path: '/tmp/noway-review-editor-light.png', fullPage: true });
  await options.keyboard.press('Escape');
  assert.equal(await options.getByRole('dialog').count(), 0);
  assert.equal(await options.getByRole('button', { name: 'Edit JSON for Follow', exact: true }).evaluate((el) => el === document.activeElement), true);
  await options.getByRole('button', { name: 'Export', exact: true }).click();
  await options.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await options.screenshot({ path: '/tmp/noway-review-export-dark.png', fullPage: true });
  const primary = options.getByRole('button', { name: 'Download' });
  assert.equal(await primary.evaluate((el) => getComputedStyle(el).color), 'rgb(7, 11, 13)');
  await options.keyboard.press('Escape');
  await options.getByRole('checkbox', { name: 'Select Follow', exact: true }).check();
  await options.getByRole('button', { name: 'Delete Selected', exact: true }).click();
  await options.getByRole('dialog', { name: 'Delete selected rules?' }).waitFor();
  assert.equal(await options.getByRole('button', { name: 'Cancel', exact: true }).evaluate((el) => el === document.activeElement), true);
  await options.getByRole('button', { name: 'Cancel', exact: true }).click();
  await options.screenshot({ path: '/tmp/noway-review-rules-dark.png', fullPage: true });
  await options.setViewportSize({ width: 320, height: 900 });
  assert.equal(await options.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await options.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  assert.equal(await options.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await options.getByRole('button', { name: 'Export', exact: true }).click();
  const exportBox = await options.getByRole('dialog', { name: 'Export Rules' }).boundingBox();
  assert.ok(exportBox.width <= 288);
  await options.screenshot({ path: '/tmp/noway-review-export-large-text.png', fullPage: true });
  checked('Rules dialogs support inline errors, keyboard dismissal, safe focus, and large-text layouts');
  checked('Popup tooltip supports keyboard focus; compact surfaces reflow in both themes');
  await page.bringToFront();
  const classificationCases = await checkClassification(context, root, await worker.evaluate(() => LINKEDIN_STARTER_RULES.map((rule) => ({ ...rule, source: 'starter', enabled: true }))));
  checked(`${classificationCases} classification cases distinguish browsing from mutation despite broad legacy rules`);
  await page.bringToFront();
  await checkNativePopup(endpoint, id);
  checked('Native toolbar popup opens at a stable width with its file actions in view');
  console.log(`${checks} browser checks passed. Screenshots: /tmp/noway-auto-popup-{light,dark}.png`);
} catch (error) {
  console.error(error);
  throw error;
} finally {
  if (browser) {
    try { const session = await browser.newBrowserCDPSession(); await Promise.race([session.send('Browser.close'), new Promise((r) => setTimeout(r, 3000))]); harness.kill('SIGTERM'); } catch (_) {}
  } else harness.kill('SIGTERM');
  server.close();
  await new Promise((r) => { if (harness.exitCode !== null) r(); else { harness.once('exit', r); setTimeout(r, 7000).unref(); } });
  await rm(testRoot, { recursive: true, force: true });
}
