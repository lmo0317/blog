// Visitor count for the seller admin page: one beacon per page view with a random id this browser
// keeps, plus one per installer download, purchase-button click and video play. The utm_source / campaign /
// content of the link that brought the visitor are remembered, so later pages and clicks count for that
// campaign. When the page is left (or the tab hidden) it reports how long it was read, how far it was
// scrolled and which sections passed the middle of the screen, so the admin can see how far a visitor got.
(() => {
  const page = document.currentScript?.dataset.page || '';
  const store = (key, value) => {
    try {
      if (value === undefined) return localStorage.getItem(key) || '';
      localStorage.setItem(key, value);
    } catch {}
    return value || '';
  };
  const newId = () => (window.crypto?.randomUUID ? crypto.randomUUID() : `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
  let visitor = store('nm-visitor');
  if (!visitor) visitor = store('nm-visitor', newId());

  const params = new URLSearchParams(location.search);
  if (params.get('utm_source')) {
    store('nm-utm', JSON.stringify({ source: params.get('utm_source'), campaign: params.get('utm_campaign') || '', content: params.get('utm_content') || '' }));
  }
  let utm = {};
  try { utm = JSON.parse(store('nm-utm') || '{}'); } catch {}

  const post = (body) => fetch('/license/api/visit', {
    method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitor, ...body })
  }).catch(() => {});
  const send = (name) => post({ page: name, referrer: document.referrer, source: utm.source, campaign: utm.campaign, content: utm.content });

  if (page) send(page);
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a');
    if (!link) return;
    if (link.href.includes('NeighborMate-Setup')) send('download');
    else if (link.hasAttribute('data-buy')) send('buy');
  });
  let played = false;
  document.addEventListener('play', () => { if (!played) { played = true; send('video'); } }, true);

  if (!page) return;
  // Reading: visible time, deepest scroll, sections seen.
  const view = newId();
  let visibleMs = 0;
  let shownAt = document.visibilityState === 'visible' ? Date.now() : 0;
  let depth = 0;
  const seen = new Set();
  const measure = () => {
    const doc = document.documentElement;
    const total = Math.max(1, doc.scrollHeight - window.innerHeight);
    depth = Math.max(depth, Math.min(100, Math.round((window.scrollY / total) * 100)));
  };
  window.addEventListener('scroll', measure, { passive: true });
  measure();
  if ('IntersectionObserver' in window) {
    const watch = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) seen.add(entry.target.dataset.trackName);
    }, { rootMargin: '-45% 0px -45% 0px' });
    document.querySelectorAll('section, #video').forEach((el) => {
      const name = (el.id || el.classList[0] || '').toLowerCase();
      if (!/^[a-z0-9-]{1,20}$/.test(name)) return;
      el.dataset.trackName = name;
      watch.observe(el);
    });
  }
  const report = () => {
    if (shownAt) { visibleMs += Date.now() - shownAt; shownAt = 0; }
    measure();
    const seconds = Math.round(visibleMs / 1000);
    if (seconds < 1) return;
    const body = { visitor, page: 'leave', view, seconds, depth, seen: [...seen].join(',') };
    // A fetch can be cut off while the page unloads; the browser finishes a beacon on its own.
    const sent = navigator.sendBeacon?.('/license/api/visit', new Blob([JSON.stringify(body)], { type: 'application/json' }));
    if (!sent) post(body);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') report();
    else shownAt = Date.now();
  });
  window.addEventListener('pagehide', report);
})();
