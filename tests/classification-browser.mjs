import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercise the actual capture-phase guard, including old broad stored rules.
export async function checkClassification(context, root, starterRules) {
  const page = await context.newPage();
  try {
    await page.setContent('<html lang="en"><body></body></html>');
    await page.addScriptTag({ content: await readFile(`${root}/shared/auto.js`, 'utf8') });
    await page.addScriptTag({ content: await readFile(`${root}/content/guard-main.js`, 'utf8') });
    const rules = [...starterRules, { source: 'learned', enabled: true, kind: 'block', actionKey: 'like', label: 'Reaction/favourite',
      match: { actionKey: 'like', labelNorm: 'reaction/favourite', textLabels: ['like', 'reaction/favourite'], selectors: ['button[aria-label*="Like" i]'] } }];
    await page.evaluate((rules) => window.postMessage({ source: 'NOWAY_CONTROLLER', type: 'NOWAY_STATE', payload: {
      trainingEnabled: true, protectionEnabled: true, rules, auto: { strategy: 'manual' },
    } }, '*'), rules);
    await page.waitForTimeout(20);
    const safe = ['Jane Love', 'Taylor Post', 'View likes', 'Show reactions', 'View profile', 'Open follow menu',
      'Comment', 'Reply', 'Message', 'Share', 'Connect', 'Search', 'Support center', 'Follow up tasks'];
    const risky = ['Like', 'Liked', 'Unlike', 'React Like', 'Reaction button state: no reaction', 'Follow Jane Doe', 'Unfollow Jane Doe', 'Send', 'Send message',
      'Post comment', 'Send reply', 'Post', 'Save post', 'Delete saved search', 'Save changes and close', 'Place order'];
    for (const [labels, allowed] of [[safe, true], [risky, false]]) {
      for (const label of labels) {
        await page.evaluate((label) => {
          document.body.replaceChildren(); window.fired = 0;
          const button = document.createElement('button'); button.setAttribute('aria-label', label); button.textContent = label;
          button.addEventListener('pointerdown', () => window.fired++);
          button.addEventListener('click', () => window.fired++); document.body.append(button);
        }, label);
        await page.locator('button').click();
        assert.equal(await page.evaluate(() => window.fired), allowed ? 2 : 0, label);
      }
    }
    await page.evaluate((rules) => {
      document.body.innerHTML = '<a href="https://www.linkedin.com/in/love-jane/">Love Jane</a>';
      window.fired = 0;
      document.querySelector('a').addEventListener('click', (event) => { event.preventDefault(); window.fired++; });
      window.postMessage({ source: 'NOWAY_CONTROLLER', type: 'NOWAY_STATE', payload: {
        trainingEnabled: true, protectionEnabled: true, rules, auto: { strategy: 'auto', ready: false },
      } }, '*');
    }, rules);
    await page.locator('a').click();
    assert.equal(await page.evaluate(() => window.fired), 1, 'Profile navigation needs no model');
    await page.evaluate(() => {
      document.body.innerHTML = '<a href="https://www.linkedin.com/in/jane/" role="button">Like</a>';
      window.fired = 0;
      document.querySelector('a').addEventListener('click', (event) => { event.preventDefault(); window.fired++; });
    });
    await page.locator('a').click();
    assert.equal(await page.evaluate(() => window.fired), 0, 'A button is not a read-only profile link');
    await page.evaluate(() => {
      document.body.innerHTML = '<a href="https://www.linkedin.com/in/jane/"><svg aria-label="Profile" width="30" height="30"><rect width="30" height="30"/></svg>Jane Love</a>';
      window.fired = 0;
      const a = document.querySelector('a');
      a.addEventListener('pointerdown', () => { a.href += '?lipi=tracking-value'; });
      a.addEventListener('click', (event) => { event.preventDefault(); window.fired++; });
    });
    await page.locator('svg').click();
    assert.equal(await page.evaluate(() => window.fired), 1, 'Tracking added mid-gesture preserves profile navigation through an SVG');
    for (const [label, query] of [['Send', ''], ['Like', ''], ['Jane Love', '?action=delete']]) {
      await page.evaluate(({label, query}) => {
        const a = document.querySelector('a'); a.textContent = label;
        a.href = `https://www.linkedin.com/in/jane/${query}`;
      }, {label, query});
      assert.equal(await page.locator('a').evaluate(el => NoWayAuto.profileLink(el)), false, 'Mutation labels and unknown query parameters do not bypass checks');
    }
    return safe.length + risky.length + 6;
  } finally { await page.close(); }
}
