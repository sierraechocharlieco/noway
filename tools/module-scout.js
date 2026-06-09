(() => {
  'use strict';

  const INTERACTIVE_SELECTOR = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[tabindex]',
    '[aria-label]',
    '[contenteditable="true"]',
  ].join(',');

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

  function text(el) {
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function attrSelector(name, value, tag = '') {
    return `${tag}[${name}="${cssEscape(value)}"]`;
  }

  function selectorCandidates(el) {
    const tag = el.tagName.toLowerCase();
    const candidates = [];

    if (el.id) candidates.push(`#${cssEscape(el.id)}`);

    for (const attr of ATTRS) {
      const value = el.getAttribute(attr);
      if (value) candidates.push(attrSelector(attr, value, tag));
    }

    let aria = el.getAttribute('aria-label');
    if (!aria) {
      const labeledChild = el.querySelector('[aria-label]');
      if (labeledChild) aria = labeledChild.getAttribute('aria-label');
    }

    if (aria) {
      const firstWord = aria.trim().split(/\s+/)[0];
      if (firstWord.length > 2) {
        candidates.push(`${tag}[aria-label*="${cssEscape(firstWord)}" i]`);
        const role = el.getAttribute('role');
        if (role) {
          candidates.push(`[role="${cssEscape(role)}"][aria-label*="${cssEscape(firstWord)}" i]`);
        }
      }
      candidates.push(attrSelector('aria-label', aria, tag));
    }

    const labelText = text(el);
    if (labelText && labelText.length <= 80) {
      candidates.push(`${tag} /* text: ${labelText} */`);
    }

    return [...new Set(candidates)];
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0
      && rect.height > 0
      && style.visibility !== 'hidden'
      && style.display !== 'none'
      && Number(style.opacity) !== 0;
  }

  function describe(el, index) {
    const rect = el.getBoundingClientRect();
    let ariaLabel = el.getAttribute('aria-label') || '';
    if (!ariaLabel) {
      const labeledChild = el.querySelector('[aria-label]');
      if (labeledChild) ariaLabel = `(child) ${labeledChild.getAttribute('aria-label')}`;
    }

    return {
      index,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || '',
      ariaLabel,
      text: text(el).slice(0, 140),
      href: el.getAttribute('href') || '',
      type: el.getAttribute('type') || '',
      visible: isVisible(el),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      selectors: selectorCandidates(el),
    };
  }

  function scan(options = {}) {
    const { visibleOnly = true, limit = 500 } = options;
    const elements = [...document.querySelectorAll(INTERACTIVE_SELECTOR)]
      .filter((el) => !visibleOnly || isVisible(el))
      .slice(0, limit);

    const rows = elements.map(describe);
    console.table(rows.map((row) => ({
      index: row.index,
      tag: row.tag,
      role: row.role,
      ariaLabel: row.ariaLabel,
      text: row.text,
      selector: row.selectors[0] || '',
    })));
    console.log(rows);
    return rows;
  }

  function blockedSelectorDraft(patterns = []) {
    const rows = scan();
    const regexes = patterns.map((pattern) => new RegExp(pattern, 'i'));
    const matches = rows.filter((row) => {
      const haystack = `${row.ariaLabel} ${row.text}`;
      return regexes.length === 0 || regexes.some((regex) => regex.test(haystack));
    });

    const selectors = matches
      .flatMap((row) => row.selectors.slice(0, 2))
      .filter((selector) => selector && !selector.includes('/* text:'))
      .map((selector) => `    '${selector}',`);

    console.log([...new Set(selectors)].join('\n'));
    return matches;
  }

  function copyJson(rows = scan()) {
    const json = JSON.stringify(rows, null, 2);
    navigator.clipboard?.writeText(json);
    return json;
  }

  window.NoWayModuleScout = {
    scan,
    copyJson,
    blockedSelectorDraft,
    selectorCandidates,
  };

  console.log('NoWayModuleScout ready. Try: NoWayModuleScout.scan() or NoWayModuleScout.blockedSelectorDraft(["like", "follow", "comment", "share", "send"])');
})();
