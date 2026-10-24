// Copy exact implementation commands without displaying internal product names.
const status = document.querySelector('#command-status');
for (const button of document.querySelectorAll('button[data-command]')) {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.command);
      status.textContent = 'Command copied. Run it in Linux Terminal.';
    } catch {
      status.textContent = 'The command could not be copied. Check browser clipboard access and try again.';
    }
  });
}
