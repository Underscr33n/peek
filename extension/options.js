const f = document.getElementById('f');
chrome.storage.local.get(['server', 'password'], v => {
  f.server.value = v.server || '';
  f.password.value = v.password || '';
});
f.onsubmit = e => {
  e.preventDefault();
  chrome.storage.local.set({ server: f.server.value.trim().replace(/\/+$/, ''), password: f.password.value },
    () => (document.getElementById('s').textContent = 'Enregistré ✓'));
};
