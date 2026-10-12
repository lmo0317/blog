// Visitor count for the seller admin page: one beacon per page view with a random id this browser
// keeps, plus one per installer download and purchase-button click. The utm_source / utm_campaign of
// the link that brought the visitor are remembered, so later pages and clicks count for that campaign.
(() => {
  const page = document.currentScript?.dataset.page || '';
  const store = (key, value) => {
    try {
      if (value === undefined) return localStorage.getItem(key) || '';
      localStorage.setItem(key, value);
    } catch {}
    return value || '';
  };
  let visitor = store('nm-visitor');
  if (!visitor && window.crypto?.randomUUID) visitor = store('nm-visitor', crypto.randomUUID());

  const params = new URLSearchParams(location.search);
  if (params.get('utm_source')) {
    store('nm-utm', JSON.stringify({ source: params.get('utm_source'), campaign: params.get('utm_campaign') || '' }));
  }
  let utm = {};
  try { utm = JSON.parse(store('nm-utm') || '{}'); } catch {}

  const send = (name) => fetch('/license/api/visit', {
    method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitor, page: name, referrer: document.referrer, source: utm.source, campaign: utm.campaign })
  }).catch(() => {});

  if (page) send(page);
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a');
    if (!link) return;
    if (link.href.includes('NeighborMate-Setup')) send('download');
    else if (link.hasAttribute('data-buy')) send('buy');
  });
})();
