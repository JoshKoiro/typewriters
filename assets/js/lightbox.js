// Click a photo on a machine page to view it full size. Arrow keys / buttons to move, Esc to close.
(function () {
  const links = Array.from(document.querySelectorAll('[data-lightbox]'));
  const box = document.getElementById('lightbox');
  if (!links.length || !box || typeof box.showModal !== 'function') return;

  const img = box.querySelector('img');
  let index = 0;

  function show(i) {
    index = (i + links.length) % links.length;
    img.src = links[index].href;
    img.alt = links[index].querySelector('img').alt;
  }

  links.forEach((a, i) => a.addEventListener('click', e => {
    e.preventDefault();
    show(i);
    box.showModal();
  }));

  box.querySelector('.lightbox-close').addEventListener('click', () => box.close());
  box.querySelector('.lightbox-prev').addEventListener('click', () => show(index - 1));
  box.querySelector('.lightbox-next').addEventListener('click', () => show(index + 1));
  box.addEventListener('click', e => { if (e.target === box) box.close(); });
  document.addEventListener('keydown', e => {
    if (!box.open) return;
    if (e.key === 'ArrowLeft') show(index - 1);
    if (e.key === 'ArrowRight') show(index + 1);
  });

  const single = links.length === 1;
  box.querySelector('.lightbox-prev').hidden = single;
  box.querySelector('.lightbox-next').hidden = single;
})();
