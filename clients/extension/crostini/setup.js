import { t, localizeDocument } from "../src/localization.js";
// Copy exact implementation commands without displaying internal product names.
localizeDocument(document);
const status = document.querySelector('#command-status');
for (const button of document.querySelectorAll('button[data-command]')) {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.command);
      status.textContent = t("setup_dynamic_001");
    } catch {
      status.textContent = t("setup_dynamic_002");
    }
  });
}
