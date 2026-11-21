const config = () => chrome.storage.local.get(['server', 'password']);
const auth = pw => ({ authorization: 'Basic ' + btoa(':' + pw) });
const menu = (id, title, parentId) => chrome.contextMenus.create({ id, title, parentId, contexts: ['image'] });

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

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'refresh') return rebuild();
  const badge = (text, color) => {
    chrome.action.setBadgeText({ text, tabId: tab.id });
    if (color) chrome.action.setBadgeBackgroundColor({ color, tabId: tab.id });
  };
  try {
    const { server, password } = await config();
    // the extension downloads the image itself (no CORS for extensions), so the server never fetches arbitrary URLs
    const img = await fetch(info.srcUrl);
    if (!img.ok) throw new Error('image ' + img.status);
    const form = new FormData();
    form.append('file', await img.blob(), 'image');
    if (info.menuItemId.startsWith('cat-')) form.append('category', info.menuItemId.slice(4));
    form.append('source', info.pageUrl);
    const r = await fetch(server + '/api/photos', { method: 'POST', headers: auth(password), body: form });
    if (!r.ok) throw new Error('peek ' + r.status);
    badge('✓', '#2a2');
  } catch (e) {
    console.error(e);
    badge('✗', '#c22');
  }
  setTimeout(() => badge(''), 2500);
});
