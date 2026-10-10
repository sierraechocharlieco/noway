// SEC tokens for page-injected UI. Keep semantic values aligned with brand.css.
(() => {
  'use strict';
  if (globalThis.NoWayBrand) return;
  const light = { background: '#ffffff', buttonBackground: '#ecf1f0', text: '#0b1113', muted: '#56696f',
    border: '#cad6d3', controlBorder: '#56696f', primary: '#176a61', danger: '#9a311f', warning: '#805500', onAccent: '#ffffff' };
  const dark = { background: '#0b1113', buttonBackground: '#121b1e', text: '#f5f8f7', muted: '#a7b5b9',
    border: '#28383d', controlBorder: '#7c8e94', primary: '#3fb4a7', danger: '#ee8872', warning: '#e0a235', onAccent: '#070b0d' };
  const font = '"No Way Hanken", "Hanken Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif';
  const headingFont = '"No Way Schibsted", "Schibsted Grotesk", system-ui, sans-serif';
  let fonts;
  function loadFonts() {
    if (fonts) return fonts;
    fonts = Promise.allSettled([['No Way Hanken', 'hanken-grotesk'], ['No Way Schibsted', 'schibsted-grotesk']].map(([name, file]) => {
      const face = new FontFace(name, `url("${chrome.runtime.getURL(`assets/fonts/${file}.woff2`)}")`, { weight: '100 900', display: 'swap' });
      document.fonts.add(face);
      return face.load();
    }));
    return fonts;
  }
  function theme(isDark, kind = 'blocked') {
    const palette = isDark ? dark : light;
    const accent = kind === 'training' || kind === 'allowed' ? palette.primary : kind === 'error' ? palette.warning : palette.danger;
    return { ...palette, accent, badgeBackground: accent, badgeText: palette.onAccent,
      font, headingFont, shadow: '0 8px 24px #0002', isDark };
  }
  function shadow(host) {
    // A host page's !important rules cannot restyle our controls or fonts.
    // Capture values first: promoting the `all` shorthand through CSSOM can
    // reset later declarations before they have been read.
    const declarations = [...host.style].map((name) => `${name}:${host.style.getPropertyValue(name)}!important`);
    host.style.cssText = declarations.join(';');
    if (host.shadowRoot) return host.shadowRoot;
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `button:disabled{opacity:.55!important;cursor:not-allowed!important}
      @media(forced-colors:active){button{border:1px solid ButtonText!important;background:ButtonFace!important;color:ButtonText!important}}
      @media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}`;
    root.appendChild(style);
    return root;
  }
  globalThis.NoWayBrand = Object.freeze({ theme, shadow, loadFonts });
})();
