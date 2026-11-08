// Gallery: filtering, sorting and the summary line.
//
// Filters: within a group (status, size, condition) a card matches ANY selected chip;
// for tags it must have ALL selected tags. No chips selected in a group = no filter.
// Everything is kept in the URL, so links can be shared, e.g.
//   ?status=for-sale          only machines for sale
//   ?size=ultra-portable      only ultra-portables
//   ?sort=year-asc            oldest machines first
(function () {
  const gallery = document.getElementById('gallery');
  const cards = Array.from(gallery.querySelectorAll('.card'));
  const chips = Array.from(document.querySelectorAll('.chip[data-group]'));
  const search = document.getElementById('search');
  const sortSelect = document.getElementById('sort');
  const resultLine = document.getElementById('result-line');
  const empty = document.getElementById('empty-state');
  const clearButton = document.getElementById('clear-filters');

  const GROUPS = { status: 'any', favorite: 'any', size: 'any', condition: 'any', tag: 'all' };
  const DEFAULT_SORT = 'acquired-desc';

  // ---------- State from the URL ----------
  const params = new URLSearchParams(window.location.search);
  const selected = {};
  for (const g of Object.keys(GROUPS)) {
    selected[g] = new Set((params.get(g) || '').split(',').map(s => s.trim()).filter(Boolean));
  }
  search.value = params.get('q') || '';
  const validSorts = Array.from(sortSelect.options).map(o => o.value);
  sortSelect.value = validSorts.includes(params.get('sort')) ? params.get('sort') : DEFAULT_SORT;

  // ---------- Matching ----------
  function cardValues(card, group) {
    if (group === 'tag') return card.dataset.tags ? card.dataset.tags.split('|') : [];
    return [card.dataset[group] || ''];
  }

  function matches(card, q) {
    for (const [group, mode] of Object.entries(GROUPS)) {
      const wanted = selected[group];
      if (!wanted.size) continue;
      const values = cardValues(card, group);
      const ok = mode === 'all'
        ? [...wanted].every(v => values.includes(v))
        : values.some(v => wanted.has(v));
      if (!ok) return false;
    }
    return q === '' || card.dataset.search.includes(q);
  }

  // ---------- Sorting ----------
  // Missing values always go last, whichever direction.
  const num = v => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
  const byValue = (get, direction) => (a, b) => {
    const va = get(a), vb = get(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return (va < vb ? -1 : va > vb ? 1 : 0) * direction;
  };
  const acquired = c => c.dataset.acquired || null;
  const name = c => c.dataset.sortName || '';

  const SORTS = {
    'acquired-desc': byValue(acquired, -1),
    'acquired-asc': byValue(acquired, 1),
    'year-asc': byValue(c => num(c.dataset.year), 1),
    'year-desc': byValue(c => num(c.dataset.year), -1),
    'make': (a, b) => name(a).localeCompare(name(b)),
    'feel': byValue(c => num(c.dataset.feel), -1),
  };

  function sortCards() {
    const compare = SORTS[sortSelect.value] || SORTS[DEFAULT_SORT];
    // Ties fall back to make & model so the order is always stable
    cards
      .slice()
      .sort((a, b) => compare(a, b) || name(a).localeCompare(name(b)))
      .forEach(card => gallery.appendChild(card));
  }

  // ---------- Summary line ----------
  function summary(shown) {
    const n = shown.length;
    if (!n) return 'No machines';
    const years = shown.map(c => num(c.dataset.year)).filter(y => y !== null);
    let text = n === 1 ? '1 typewriter' : `${n} typewriters`;
    if (years.length) {
      const min = Math.min(...years), max = Math.max(...years);
      const avg = Math.round(years.reduce((s, y) => s + y, 0) / years.length);
      text += min === max ? ` · built ${min}` : ` · built ${min}–${max} · average ${avg}`;
    }
    return text;
  }

  // ---------- Render ----------
  function render() {
    const q = search.value.trim().toLowerCase();
    const shown = [];
    cards.forEach(card => {
      const ok = matches(card, q);
      card.hidden = !ok;
      if (ok) shown.push(card);
    });
    sortCards();

    chips.forEach(c => c.setAttribute('aria-pressed', selected[c.dataset.group].has(c.dataset.value)));
    resultLine.textContent = summary(shown);
    empty.hidden = shown.length !== 0;

    const anyFilter = q !== '' || Object.values(selected).some(s => s.size);
    clearButton.hidden = !anyFilter;

    // Keep the URL in sync (without adding browser history entries)
    const next = new URLSearchParams();
    for (const [g, set] of Object.entries(selected)) if (set.size) next.set(g, [...set].join(','));
    if (q) next.set('q', q);
    if (sortSelect.value !== DEFAULT_SORT) next.set('sort', sortSelect.value);
    const qs = next.toString().replace(/%2C/g, ',');
    history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
  }

  chips.forEach(c => c.addEventListener('click', () => {
    const set = selected[c.dataset.group];
    set.has(c.dataset.value) ? set.delete(c.dataset.value) : set.add(c.dataset.value);
    render();
  }));
  clearButton.addEventListener('click', () => {
    Object.values(selected).forEach(s => s.clear());
    search.value = '';
    render();
  });
  search.addEventListener('input', render);
  sortSelect.addEventListener('change', render);

  render();
})();
