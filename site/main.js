// The landing page's two small behaviours: copying the starter prompt, and saying how wide Rome
// would be on the time scale at the width it is drawn.

for (const button of document.querySelectorAll('[data-copy]')) {
  const text = document.getElementById(button.dataset.copy);
  const label = button.textContent;
  let timer;
  button.addEventListener('click', () => {
    const done = (message) => {
      button.textContent = message;
      clearTimeout(timer);
      timer = setTimeout(() => (button.textContent = label), 2400);
    };
    const select = () => {
      const range = document.createRange();
      range.selectNodeContents(text);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      done('Selected');
    };
    if (!navigator.clipboard) return select();
    navigator.clipboard.writeText(text.textContent.trim()).then(() => done('Copied'), select);
  });
}

for (const out of document.querySelectorAll('[data-sliver]')) {
  const line = document.getElementById(out.dataset.of);
  const fraction = Number(out.dataset.years) / (Number(out.dataset.spanMa) * 1e6);
  const show = () => {
    const px = line.getBoundingClientRect().width * fraction;
    if (px > 0) out.textContent = `${px.toPrecision(2)} px`;
  };
  show();
  if ('ResizeObserver' in window) new ResizeObserver(show).observe(line);
}
