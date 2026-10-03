// Same preference key and modes as the mobile/web appearance system; no credentials.
(() => {
  const system = matchMedia('(prefers-color-scheme: dark)');
  const valid = value => ['system','light','dark'].includes(value) ? value : 'system';
  let mode = 'system';
  try { mode = valid(localStorage.getItem('mapmarket.appearance')); } catch {}
  function apply(value) {
    mode = valid(value);
    const theme = mode === 'system' ? (system.matches ? 'dark' : 'light') : mode;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.style.colorScheme = theme;
    for (const select of document.querySelectorAll('[data-site-theme]')) select.value = mode;
  }
  apply(mode);
  system.addEventListener('change', () => apply(document.documentElement.dataset.themeMode || mode));
  window.addEventListener('storage', e => { if (e.key === 'mapmarket.appearance') apply(e.newValue); });
  document.addEventListener('DOMContentLoaded', () => apply(mode));
  document.addEventListener('change', e => {
    if (e.target.matches('input[name="appearance"]')) { apply(e.target.value); return; }
    if (!e.target.matches('[data-site-theme]')) return;
    apply(e.target.value);
    try { localStorage.setItem('mapmarket.appearance', mode); } catch {}
  });
})();
