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
