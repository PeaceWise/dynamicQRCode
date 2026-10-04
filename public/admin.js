// Copy-to-clipboard buttons: <button data-copy="#input-id">
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy]');
  if (!button) return;
  const input = document.querySelector(button.dataset.copy);
  if (!input) return;
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(input.value);
    button.textContent = 'Copied!';
  } catch {
    input.select();
    button.textContent = 'Press Ctrl/⌘+C';
  }
  setTimeout(() => (button.textContent = original), 2000);
});

// Live preview for the QR design editor. Downloads still use the saved design.
(() => {
  const form = document.getElementById('design-form');
  const preview = document.getElementById('qr-preview');
  if (!form || !preview) return;
  const dirty = document.getElementById('design-dirty');
  const warning = document.getElementById('design-warning');
  const savedSrc = preview.src;

  const luminance = (hex) => {
    const c = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  let timer;
  const update = () => {
    const params = new URLSearchParams({ preview: '1' });
    for (const [key, value] of new FormData(form)) {
      if (!key.startsWith('_') && typeof value === 'string') params.set(key, value);
    }
    params.set('logoClear', form.elements.logoClear.checked ? '1' : '0');
    preview.src = `${preview.dataset.base}/qr.svg?${params}`;
    dirty.hidden = false;

    const bg = params.get('bg');
    const problems = [['Pattern', params.get('fg')], ['Corner', params.get('eye')]]
      .filter(([, c]) => luminance(c) >= luminance(bg) || contrast(c, bg) < 3)
      .map(([name]) => name);
    warning.hidden = problems.length === 0;
    warning.textContent = `${problems.join(' and ')} color is too light against the background to scan reliably.`;
  };

  form.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(update, 120);
  });
  form.addEventListener('reset', () => {
    preview.src = savedSrc;
    dirty.hidden = true;
  });
})();
