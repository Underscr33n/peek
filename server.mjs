import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { createHash, timingSafeEqual } from 'node:crypto';

const DATA = process.env.DATA_DIR || './data';
const IMG = path.join(DATA, 'images');
const PASSWORD = Buffer.from(process.env.PASSWORD || '');
const MAX_UPLOAD = 100 * 1024 * 1024; // ponytail: whole upload buffered in RAM, stream to disk if you bulk-upload GBs
if (!PASSWORD.length) throw new Error('PASSWORD env var required');
fs.mkdirSync(IMG, { recursive: true });

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg' };
const MIME = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));
const IMG_RE = new RegExp(`^/img/([a-f0-9]{64}\\.(${Object.values(EXT).join('|')}))$`);

const db = new DatabaseSync(path.join(DATA, 'peek.db'));
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY, file TEXT UNIQUE NOT NULL, source TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL COLLATE NOCASE);
  CREATE TABLE IF NOT EXISTS photo_categories (
    photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (photo_id, category_id));
`);
const sql = {
  cats: db.prepare(`SELECT c.id, c.name, COUNT(pc.photo_id) AS count FROM categories c
    LEFT JOIN photo_categories pc ON pc.category_id = c.id GROUP BY c.id ORDER BY c.name`),
  addCat: db.prepare('INSERT OR IGNORE INTO categories(name) VALUES (?)'),
  catByName: db.prepare('SELECT id, name FROM categories WHERE name = ?'),
  delCat: db.prepare('DELETE FROM categories WHERE id = ?'),
  addPhoto: db.prepare('INSERT OR IGNORE INTO photos(file, source) VALUES (?, ?)'),
  photoByFile: db.prepare('SELECT id FROM photos WHERE file = ?'),
  photoById: db.prepare('SELECT file FROM photos WHERE id = ?'),
  delPhoto: db.prepare('DELETE FROM photos WHERE id = ?'),
  // SELECT-based insert: silently skips unknown photo/category ids instead of throwing on FK
  link: db.prepare(`INSERT OR IGNORE INTO photo_categories
    SELECT p.id, c.id FROM photos p, categories c WHERE p.id = ? AND c.id = ?`),
  unlink: db.prepare('DELETE FROM photo_categories WHERE photo_id = ? AND category_id = ?'),
};
const photosQuery = filtered => db.prepare(`
  SELECT p.id, p.file, p.source, p.created_at,
    json_group_array(pc.category_id) FILTER (WHERE pc.category_id IS NOT NULL) AS categories
  FROM photos p LEFT JOIN photo_categories pc ON pc.photo_id = p.id
  ${filtered ? 'WHERE p.id IN (SELECT photo_id FROM photo_categories WHERE category_id = ?)' : ''}
  GROUP BY p.id ORDER BY p.id DESC`);
const listAll = photosQuery(false), listByCat = photosQuery(true);

function authed(req) {
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const pw = Buffer.from(Buffer.from(m[1], 'base64').toString().split(':').slice(1).join(':'));
  return pw.length === PASSWORD.length && timingSafeEqual(pw, PASSWORD);
}

const send = (res, code, data) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
};

async function readJson(req) {
  let s = '';
  for await (const chunk of req) if ((s += chunk).length > 1e5) throw new Error('body too large');
  return JSON.parse(s || '{}');
}

async function savePhotos(req) {
  const form = await new Request('http://local', {
    method: 'POST', headers: { 'content-type': req.headers['content-type'] || '' },
    body: Readable.toWeb(req), duplex: 'half',
  }).formData();
  const cats = form.getAll('category').map(Number).filter(Boolean);
  const source = String(form.get('source') || '') || null;
  const ids = [];
  for (const f of form.getAll('file')) {
    const ext = typeof f === 'object' && EXT[f.type.split(';')[0].trim().toLowerCase()];
    if (!ext) continue;
    const buf = Buffer.from(await f.arrayBuffer());
    // content hash as filename: same image saved twice = one file, categories merge
    const file = `${createHash('sha256').update(buf).digest('hex')}.${ext}`;
    const dest = path.join(IMG, file);
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, buf);
    sql.addPhoto.run(file, source);
    const { id } = sql.photoByFile.get(file);
    for (const c of cats) sql.link.run(id, c);
    ids.push(id);
  }
  return ids;
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
    const p = url.pathname, M = req.method;
    let m;

    // images are public so you can embed them anywhere
    if (M === 'GET' && (m = IMG_RE.exec(p))) {
      return fs.readFile(path.join(IMG, m[1]), (err, buf) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, {
          'content-type': MIME[m[2]], 'cache-control': 'public, max-age=31536000, immutable',
          'content-security-policy': 'sandbox', 'x-content-type-options': 'nosniff', // svg can't run scripts
        });
        res.end(buf);
      });
    }

    if (!authed(req)) {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="peek"' });
      return res.end();
    }

    if (M === 'GET' && p === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(new URL('./index.html', import.meta.url)));
    }
    if (M === 'GET' && p === '/api/categories') return send(res, 200, sql.cats.all());
    if (M === 'POST' && p === '/api/categories') {
      const name = String((await readJson(req)).name || '').trim();
      if (!name) return send(res, 400, { error: 'name required' });
      sql.addCat.run(name);
      return send(res, 201, sql.catByName.get(name));
    }
    if (M === 'DELETE' && (m = /^\/api\/categories\/(\d+)$/.exec(p))) {
      sql.delCat.run(m[1]);
      return send(res, 200, {});
    }
    if (M === 'GET' && p === '/api/photos') {
      const cat = url.searchParams.get('category');
      const rows = cat ? listByCat.all(cat) : listAll.all();
      return send(res, 200, rows.map(r => ({ ...r, categories: JSON.parse(r.categories) })));
    }
    if (M === 'POST' && p === '/api/photos') {
      if (!(Number(req.headers['content-length']) <= MAX_UPLOAD)) return send(res, 413, { error: 'max 100 MB per upload' });
      const ids = await savePhotos(req);
      return ids.length ? send(res, 201, { ids }) : send(res, 400, { error: 'no valid image (jpg/png/gif/webp/avif/svg)' });
    }
    if ((m = /^\/api\/photos\/(\d+)\/categories\/(\d+)$/.exec(p)) && (M === 'PUT' || M === 'DELETE')) {
      (M === 'PUT' ? sql.link : sql.unlink).run(m[1], m[2]);
      return send(res, 200, {});
    }
    if (M === 'DELETE' && (m = /^\/api\/photos\/(\d+)$/.exec(p))) {
      const row = sql.photoById.get(m[1]);
      if (row) { sql.delPhoto.run(m[1]); fs.rmSync(path.join(IMG, row.file), { force: true }); }
      return send(res, 200, {});
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
}).listen(process.env.PORT || 3000, () => console.log('peek on :' + (process.env.PORT || 3000)));
