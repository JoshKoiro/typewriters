// Shared by every page: the light/dark toggle, and "how long ago" text for dates.

// ---------- Light / dark mode ----------
(function () {
  const root = document.documentElement;
  const button = document.getElementById('theme-toggle');
  if (!button) return;

  button.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch (e) {}
  });

  // Follow the operating system's setting until the visitor picks one themselves.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    let saved = null;
    try { saved = localStorage.getItem('theme'); } catch (err) {}
    if (!saved) root.dataset.theme = e.matches ? 'dark' : 'light';
  });
})();

// ---------- Durations ----------
// Turns two dates into "3 days", "5 weeks", "4 months", "1 year 2 months".
window.durationBetween = function (startISO, endISO) {
  const start = new Date(startISO + 'T00:00:00');
  const end = endISO ? new Date(endISO + 'T00:00:00') : new Date();
  if (isNaN(start)) return '';
  const days = Math.max(0, Math.round((end - start) / 86400000));
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  if (days < 1) return 'today';
  if (days < 14) return plural(days, 'day');
  if (days < 60) return plural(Math.round(days / 7), 'week');

  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
    - (end.getDate() < start.getDate() ? 1 : 0);
  if (months < 24) return plural(Math.max(months, 2), 'month');
  const years = Math.floor(months / 12), rest = months % 12;
  return plural(years, 'year') + (rest ? ' ' + plural(rest, 'month') : '');
};

// Fill every element like <span data-since="2026-10-11" data-until="2026-12-01"></span>
// "data-until" is optional (used for sold machines); without it, the duration runs to today.
document.querySelectorAll('[data-since]').forEach(el => {
  const text = window.durationBetween(el.dataset.since, el.dataset.until);
  if (!text) return;
  const template = el.dataset.template || '{d}';
  el.textContent = template.replace('{d}', text);
});

// ---------- Collapsible issues ----------
// A link to #issue-<id> (from the repair log, another page or a shared URL) opens that issue.
function openTargetDetails() {
  if (!location.hash) return;
  let el = null;
  try { el = document.querySelector(location.hash); } catch (e) { return; }
  if (el && el.tagName === 'DETAILS') {
    el.open = true;
    el.scrollIntoView({ block: 'start' });
  }
}
window.addEventListener('hashchange', openTargetDetails);
openTargetDetails();

// "Show all details" / "Hide all details" buttons: data-expand-all="<selector of the container>"
document.querySelectorAll('[data-expand-all]').forEach(button => {
  const container = document.querySelector(button.dataset.expandAll);
  if (!container) return;
  const all = () => Array.from(container.querySelectorAll('details'));
  const sync = () => {
    const allOpen = all().every(d => d.open);
    button.textContent = allOpen ? 'Hide all details' : 'Show all details';
    button.setAttribute('aria-pressed', allOpen);
  };
  button.addEventListener('click', () => {
    const open = !all().every(d => d.open);
    all().forEach(d => { d.open = open; });
    sync();
  });
  all().forEach(d => d.addEventListener('toggle', sync));
  sync();
});
