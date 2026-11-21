const config = () => chrome.storage.local.get(['server', 'password']);
const auth = pw => ({ authorization: 'Basic ' + btoa(':' + pw) });
const menu = (id, title, parentId) => chrome.contextMenus.create({ id, title, parentId, contexts: ['image'] });
const badge = (tabId, text, color) => {
  chrome.action.setBadgeText({ text, tabId });
  if (color) chrome.action.setBadgeBackgroundColor({ color, tabId });
};

async function buildMenu() {
  await chrome.contextMenus.removeAll();
  menu('peek', 'Enregistrer sur Peek');
  const { server, password } = await config();
  let cats = [];
  try { cats = await (await fetch(server + '/api/categories', { headers: auth(password) })).json(); } catch {}
  for (const c of cats) menu('cat-' + c.id, c.name, 'peek');
  menu('none', 'Sans catégorie', 'peek');
  menu('refresh', '↻ Recharger les catégories', 'peek');
}
let queue = Promise.resolve();
const rebuild = () => (queue = queue.then(buildMenu));

chrome.runtime.onInstalled.addListener(rebuild);
chrome.runtime.onStartup.addListener(rebuild);
chrome.storage.onChanged.addListener(rebuild);

// the extension downloads the image itself (no CORS for extensions), so the server never fetches arbitrary URLs
async function save(url, pageUrl, category) {
  const { server, password } = await config();
  const img = await fetch(url);
  if (!img.ok) throw new Error('image ' + img.status);
  const form = new FormData();
  form.append('file', await img.blob(), 'image');
  if (category) form.append('category', category);
  form.append('source', pageUrl);
  const r = await fetch(server + '/api/photos', { method: 'POST', headers: auth(password), body: form });
  if (!r.ok) throw new Error('peek ' + r.status);
}

async function saveMany(urls, pageUrl, category, tabId) {
  let failed = 0;
  for (const [i, url] of urls.entries()) {
    if (urls.length > 1) badge(tabId, String(urls.length - i), '#555');
    try { await save(url, pageUrl, category); } catch (e) { console.error(url, e); failed++; }
  }
  badge(tabId, failed ? '✗' + (urls.length > 1 ? failed : '') : '✓', failed ? '#c22' : '#2a2');
  setTimeout(() => badge(tabId, ''), 2500);
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'refresh') return rebuild();
  const category = info.menuItemId.startsWith('cat-') ? info.menuItemId.slice(4) : '';
  saveMany([info.srcUrl], info.pageUrl, category, tab.id);
});

chrome.runtime.onMessage.addListener(m => {
  if (m.type === 'save') saveMany(m.urls, m.pageUrl, m.category, m.tabId);
});
