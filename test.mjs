// node test.mjs — starts the server on a temp dir and runs the main flow
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert';

const dir = mkdtempSync(tmpdir() + '/peek-');
const srv = spawn('node', ['server.mjs'], { env: { ...process.env, DATA_DIR: dir, PASSWORD: 'pw', PORT: '3999' }, stdio: 'inherit' });
await new Promise(r => setTimeout(r, 800));
const B = 'http://localhost:3999', H = { authorization: 'Basic ' + btoa(':pw') };
const api = async (u, o = {}) => { const r = await fetch(B + u, { ...o, headers: { ...H, ...o.headers } }); return [r.status, await r.json().catch(() => null)]; };

try {
  assert.equal((await fetch(B + '/api/categories')).status, 401);
  const [, a] = await api('/api/categories', { method: 'POST', body: JSON.stringify({ name: 'Archi' }) });
  const [, b] = await api('/api/categories', { method: 'POST', body: JSON.stringify({ name: 'Nature' }) });

  const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' });
  const up = cat => { const f = new FormData(); f.append('file', png, 'x.png'); f.append('category', cat); f.append('source', 'https://ex.com'); return api('/api/photos', { method: 'POST', body: f }); };
  const [s1, r1] = await up(a.id);
  const [, r2] = await up(b.id); // same image again → same photo, second category
  assert.equal(s1, 201);
  assert.deepEqual(r1.ids, r2.ids);

  let [, photos] = await api('/api/photos');
  assert.equal(photos.length, 1);
  assert.deepEqual(photos[0].categories.sort(), [a.id, b.id].sort());
  assert.equal((await fetch(B + '/img/' + photos[0].file)).status, 200); // public, no auth

  await api(`/api/photos/${photos[0].id}/categories/${a.id}`, { method: 'DELETE' });
  await api(`/api/photos/${photos[0].id}/categories/9999`, { method: 'PUT' }); // unknown category: ignored, no 500
  [, photos] = await api('/api/photos?category=' + a.id);
  assert.equal(photos.length, 0);

  const bad = new FormData(); bad.append('file', new Blob(['hi'], { type: 'text/html' }), 'x.html');
  assert.equal((await api('/api/photos', { method: 'POST', body: bad }))[0], 400);
  console.log('OK');
} finally { srv.kill(); }
