(() => {
  const publicPage = document.getElementById('sellerLanding');
  const dashboard = document.getElementById('sellerDashboardMount');
  const status = document.getElementById('sellerSiteStatus');
  const config = String(window.MAPMARKET_CONFIG?.PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
  for (const link of document.querySelectorAll('[data-legal]')) {
    link.href = link.dataset.legal === 'support' ? 'https://t.me/yaqintop_support_bot' : `${config}/legal/seller/${link.dataset.legal}`;
  }
  const menu = document.querySelector('.menu-toggle');
  menu.addEventListener('click', () => {
    const expanded = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(expanded));
    document.getElementById('siteNav').classList.toggle('is-open', expanded);
  });
  document.getElementById('siteNav').addEventListener('click', () => {
    menu.setAttribute('aria-expanded', 'false');
    document.getElementById('siteNav').classList.remove('is-open');
  });
  let modulePromise;
  function stylesheet(path) {
    if (document.querySelector(`link[data-dashboard-css="${path}"]`)) return;
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = path; link.dataset.dashboardCss = path;
    document.head.insertBefore(link, document.getElementById('sellerStyles'));
  }
  async function loadDashboard() {
    if (modulePromise) return modulePromise;
    for (const path of ['shared/design.css','shared/appearance.css']) stylesheet(path);
    modulePromise = (async () => {
      return import('./web-app.js');
    })().catch(error => { modulePromise = null; throw error; });
    return modulePromise;
  }
  async function begin(mode) {
    status.hidden = true;
    const buttons = [...document.querySelectorAll('[data-seller-auth]')]; buttons.forEach(b => b.disabled = true);
    let timer;
    try {
      const module = await Promise.race([loadDashboard(),new Promise((_,reject) => { timer = setTimeout(() => reject(new Error('Кабинет загружается слишком долго. Проверьте соединение и повторите.')),20000); })]);
      module.beginSellerLogin(mode);
    } catch (error) {
      status.querySelector('span').textContent = `Не удалось открыть кабинет. ${error.message}`;
      status.hidden = false;
    } finally { clearTimeout(timer); buttons.forEach(b => b.disabled = false); }
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-seller-auth]');
    if (button) begin(button.dataset.sellerAuth);
  });
  window.addEventListener('seller-authenticated', () => {
    publicPage.hidden = true; dashboard.hidden = false; status.hidden = true; window.scrollTo(0,0);
  });
  window.addEventListener('seller-signed-out', () => {
    publicPage.hidden = false; dashboard.hidden = true;
    history.replaceState(null,'',location.pathname+location.search); window.scrollTo(0,0);
    document.title = 'YAQINTOP SELLER для продавцов — привлекайте покупателей рядом';
  });
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.remove('is-entering'); observer.unobserve(entry.target); }
    }, {threshold:.05});
    for (const section of document.querySelectorAll('.reveal')) { section.classList.add('is-entering'); observer.observe(section); }
  }
  // A dashboard deep link still starts with an explicit authentication gate.
  if (['dashboard','products','catalog','imports','chats','reviews','analytics','plan','store','profile','team','qr','branches'].includes(location.hash.slice(1))) begin('login');
})();
