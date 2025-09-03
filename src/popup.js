/* global chrome */
(async function () {
  const statusEl = document.getElementById('status');
  const btn = document.getElementById('enable');

  function set(text, cls) {
    statusEl.textContent = text;
    statusEl.className = cls || '';
  }

  async function hasAccess() {
    try {
      const granted = await chrome.permissions.contains({ origins: ['https://github.com/*'] });
      return granted;
    } catch {
      return false;
    }
  }

  async function refresh() {
    const ok = await hasAccess();
    if (ok) {
      set('Access granted. Open GitHub and refresh.', 'ok');
      btn.textContent = 'Re-check';
    } else {
      set('Extension needs permission to run on github.com', 'warn');
      btn.textContent = 'Enable on GitHub';
    }
  }

  btn.addEventListener('click', async () => {
    const ok = await hasAccess();
    if (ok) { await refresh(); return; }
    try {
      const granted = await chrome.permissions.request({ origins: ['https://github.com/*'] });
      if (granted) {
        await refresh();
      } else {
        set('Permission not granted. Click to try again.', 'warn');
      }
    } catch (e) {
      set('Error requesting permission', 'warn');
      console.error('[GHH] permission request error', e);
    }
  });

  refresh();
})();

