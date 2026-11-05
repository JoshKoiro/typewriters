// Gallery filtering: status chips (show any selected status), tag chips (must have all
// selected tags) and free-text search. The current filters are kept in the URL, so a link like
//   .../?status=for-sale        shows only machines for sale
//   .../?tag=ultra-portable     shows only ultra-portables
// can be shared directly.
(function () {
  const cards = Array.from(document.querySelectorAll('.card'));
  const statusChips = Array.from(document.querySelectorAll('.chip[data-status]'));
  const tagChips = Array.from(document.querySelectorAll('.chip[data-tag]'));
  const search = document.getElementById('search');
  const count = document.getElementById('result-count');
  const empty = document.getElementById('empty-state');

  const params = new URLSearchParams(window.location.search);
  const listParam = (name) => (params.get(name) || '').split(',').map(s => s.trim()).filter(Boolean);

  // Initial state: statuses from URL, otherwise every status not hidden by default.
  let statuses = new Set(listParam('status'));
  if (statuses.size === 0) {
    statusChips.forEach(c => { if (c.dataset.defaultHidden !== 'true') statuses.add(c.dataset.status); });
  }
  let tags = new Set(listParam('tag'));
  search.value = params.get('q') || '';

  function render() {
    const q = search.value.trim().toLowerCase();
    let shown = 0;

    cards.forEach(card => {
      const cardTags = card.dataset.tags ? card.dataset.tags.split('|') : [];
      const ok =
        statuses.has(card.dataset.status) &&
        [...tags].every(t => cardTags.includes(t)) &&
        (q === '' || card.dataset.search.includes(q));
      card.hidden = !ok;
      if (ok) shown++;
    });

    statusChips.forEach(c => c.setAttribute('aria-pressed', statuses.has(c.dataset.status)));
    tagChips.forEach(c => c.setAttribute('aria-pressed', tags.has(c.dataset.tag)));

    count.textContent = shown === 1 ? '1 machine' : shown + ' machines';
    empty.hidden = shown !== 0;

    // Keep the URL in sync (without adding browser history entries).
    const next = new URLSearchParams();
    const defaults = statusChips.filter(c => c.dataset.defaultHidden !== 'true').map(c => c.dataset.status);
    const isDefault = statuses.size === defaults.length && defaults.every(s => statuses.has(s));
    if (!isDefault) next.set('status', [...statuses].join(','));
    if (tags.size) next.set('tag', [...tags].join(','));
    if (q) next.set('q', q);
    const qs = next.toString();
    history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs.replace(/%2C/g, ',') : ''));
  }

  function toggle(set, value) {
    set.has(value) ? set.delete(value) : set.add(value);
    render();
  }

  statusChips.forEach(c => c.addEventListener('click', () => toggle(statuses, c.dataset.status)));
  tagChips.forEach(c => c.addEventListener('click', () => toggle(tags, c.dataset.tag)));
  search.addEventListener('input', render);

  render();
})();
