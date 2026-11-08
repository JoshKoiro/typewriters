// Issues page: filtering, sorting and the summary line.
//
// Within a group (status, category) an issue matches ANY selected chip. No chips = no filter.
// Filters are kept in the URL so links can be shared, e.g.
//   ?status=open                 only open issues
//   ?category=paper-feed         every paper-feed problem, across all machines
(function () {
  const list = document.getElementById('issue-list');
  if (!list) return;
  const rows = Array.from(list.querySelectorAll('.issue-row'));
  const chips = Array.from(document.querySelectorAll('.chip[data-group]'));
  const search = document.getElementById('search');
  const sortSelect = document.getElementById('sort');
  const resultLine = document.getElementById('result-line');
  const empty = document.getElementById('empty-state');
  const clearButton = document.getElementById('clear-filters');

  const GROUPS = ['status', 'category'];
  const DEFAULT_SORT = 'opened-desc';

  // ---------- State from the URL ----------
  const params = new URLSearchParams(window.location.search);
  const selected = {};
  for (const g of GROUPS) {
    selected[g] = new Set((params.get(g) || '').split(',').map(s => s.trim()).filter(Boolean));
  }
  search.value = params.get('q') || '';
  const validSorts = Array.from(sortSelect.options).map(o => o.value);
  sortSelect.value = validSorts.includes(params.get('sort')) ? params.get('sort') : DEFAULT_SORT;

  const matches = (row, q) =>
    GROUPS.every(g => !selected[g].size || selected[g].has(row.dataset[g] || '')) &&
    (q === '' || row.dataset.search.includes(q));

  // ---------- Sorting (missing dates go last) ----------
  const opened = r => r.dataset.opened || null;
  const name = r => r.dataset.sortName || '';
  const byOpened = direction => (a, b) => {
    const va = opened(a), vb = opened(b);
    if (va === vb) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return (va < vb ? -1 : 1) * direction;
  };
  const SORTS = {
    'opened-desc': byOpened(-1),
    'opened-asc': byOpened(1),
    'machine': (a, b) => name(a).localeCompare(name(b)) || byOpened(-1)(a, b),
  };

  // ---------- Summary: "5 issues · 2 open · 1 managed · 2 fixed" ----------
  function summary(shown) {
    if (!shown.length) return 'No issues';
    const counts = new Map(), labels = {};
    shown.forEach(r => {
      counts.set(r.dataset.status, (counts.get(r.dataset.status) || 0) + 1);
      labels[r.dataset.status] = r.dataset.statusLabel;
    });
    // Same order as the status chips (which follow _data/issue_statuses.yml)
    const order = chips.filter(c => c.dataset.group === 'status').map(c => c.dataset.value);
    const parts = [shown.length === 1 ? '1 issue' : `${shown.length} issues`];
    [...counts.keys()]
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .forEach(k => parts.push(`${counts.get(k)} ${labels[k]}`));
    return parts.join(' · ');
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const shown = rows.filter(r => {
      const ok = matches(r, q);
      r.hidden = !ok;
      return ok;
    });
    const compare = SORTS[sortSelect.value] || SORTS[DEFAULT_SORT];
    rows.slice().sort((a, b) => compare(a, b) || name(a).localeCompare(name(b))).forEach(r => list.appendChild(r));

    chips.forEach(c => c.setAttribute('aria-pressed', selected[c.dataset.group].has(c.dataset.value)));
    resultLine.textContent = summary(shown);
    empty.hidden = shown.length !== 0;
    clearButton.hidden = !(q !== '' || GROUPS.some(g => selected[g].size));

    const next = new URLSearchParams();
    for (const g of GROUPS) if (selected[g].size) next.set(g, [...selected[g]].join(','));
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
    GROUPS.forEach(g => selected[g].clear());
    search.value = '';
    render();
  });
  search.addEventListener('input', render);
  sortSelect.addEventListener('change', render);

  render();
})();
