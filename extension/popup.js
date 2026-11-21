const $ = id => document.getElementById(id);
const el = (tag, props, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const msg = text => ($('msg').textContent = text);

// runs inside the web page: visible images, skipping icons (<100px) and blob: urls
const collect = () => [...new Set([...document.images]
  .filter(i => i.naturalWidth >= 100 && i.naturalHeight >= 100)
  .map(i => i.currentSrc || i.src)
  .filter(s => /^(https?|data):/.test(s)))];

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const { server, password } = await chrome.storage.local.get(['server', 'password']);

if (!server) {
  msg('Configure le serveur dans les options de l’extension.');
} else {
  try {
    const r = await fetch(server + '/api/categories', { headers: { authorization: 'Basic ' + btoa(':' + password) } });
    if (!r.ok) throw new Error(r.status);
    $('cat').append(el('option', { value: '' }, 'Sans catégorie'),
      ...(await r.json()).map(c => el('option', { value: c.id }, c.name)));
  } catch (e) { msg('Serveur injoignable (' + e.message + ')'); }

  const [{ result: urls = [] } = {}] = await chrome.scripting
    .executeScript({ target: { tabId: tab.id }, func: collect }).catch(() => []);
  if (!urls.length) msg('Aucune image trouvée sur cette page.');
  $('grid').replaceChildren(...urls.map(u =>
    el('label', { className: 'item' }, el('input', { type: 'checkbox', value: u }), el('img', { src: u, loading: 'lazy' }))));
}

const boxes = () => [...document.querySelectorAll('#grid input')];
const refresh = () => {
  const n = boxes().filter(b => b.checked).length;
  $('save').disabled = !n;
  $('save').textContent = n ? `Enregistrer (${n})` : 'Enregistrer';
};
$('grid').onchange = refresh;
$('all').onclick = () => { const on = boxes().some(b => !b.checked); boxes().forEach(b => (b.checked = on)); refresh(); };
$('save').onclick = () => {
  chrome.runtime.sendMessage({
    type: 'save', urls: boxes().filter(b => b.checked).map(b => b.value),
    category: $('cat').value, pageUrl: tab.url, tabId: tab.id,
  });
  window.close(); // the background worker does the uploads, progress shows on the badge
};
