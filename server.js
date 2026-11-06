#!/usr/bin/env node
/**
 * Roam mock API — zero dependencies, needs only Node.js 18+.
 *   node mock/server.js            → http://localhost:3000
 *   PORT=4000 node mock/server.js  → another port
 *
 * Serves the JSON files in this folder with the same URLs as the real backend (/v1/...).
 * Data is read-only: POST/PATCH/DELETE return the saved example response.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const DIR = __dirname;
const PORT = Number(process.env.PORT || 3000);
const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8')).endpoints;

const load = (file) => JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
const exists = (file) => fs.existsSync(path.join(DIR, file));

// Success examples first so e.g. POST /v1/auth/login returns the 200 example, not the 401 one.
const routes = index
  .filter((e) => !e.file.startsWith('errors/'))
  .map((e) => {
    const u = new URL(e.endpoint, 'http://x');
    return { method: e.method, path: u.pathname, query: u.searchParams.toString(), status: e.status, file: e.file };
  });

const PROTECTED = /^\/v1\/(me|favorites|requests|ai\/plans)(\/|$)/;

function resolve(method, url, body, headers) {
  const q = new URLSearchParams(url.searchParams);
  q.delete('currency'); // currency is display-only in the mock
  const query = q.toString();
  const p = url.pathname.replace(/\/+$/, '');

  if (p === '/health') return { status: 200, body: { status: 'ok', mode: 'mock', time: new Date().toISOString() } };

  // Guest mode: protected endpoints need a Bearer token (any value works in the mock)
  if (PROTECTED.test(p) && !headers.authorization) return { status: 401, file: 'errors/401-login-required.json' };

  // Auth
  if (method === 'POST' && p === '/v1/auth/register') {
    const ok = body && body.acceptTerms === true && /.+@.+\..+/.test(body.email || '') && (body.password || '').length >= 8 && (body.fullName || '').trim();
    return ok ? { status: 201, file: 'auth/register.json' } : { status: 400, file: 'errors/400-validation.json' };
  }
  if (method === 'POST' && p === '/v1/auth/login') {
    if (!body || (body.password || '').length < 8) return { status: 401, file: 'errors/401-invalid-credentials.json' };
    return { status: 200, file: 'auth/login.json' };
  }
  if (method === 'POST' && (p === '/v1/auth/refresh' || p === '/v1/auth/google' || p === '/v1/auth/apple')) return { status: 200, file: 'auth/login.json' };
  if (method === 'POST' && ['/v1/auth/logout', '/v1/auth/forgot-password', '/v1/auth/reset-password', '/v1/me/devices'].includes(p)) return { status: 204 };

  // AI chat: pick the conversation step from the request body
  if (method === 'POST' && p === '/v1/ai/chat') {
    const msgs = (body && body.messages) || [];
    const last = ((msgs.filter((m) => m.role === 'user').pop() || {}).content || '').toLowerCase();
    const all = msgs.map((m) => m.content || '').join(' ').toLowerCase();
    if (body && body.draft) return { status: 200, file: 'ai/chat-5-cheaper.json' };
    if (body && body.action === 'create_plan') return { status: 200, file: 'ai/chat-4-plan.json' };
    if (/included/.test(all)) return { status: 200, file: 'ai/chat-3-ready.json' };
    if (/\bfrom\b|baku|flexible/.test(last)) return { status: 200, file: 'ai/chat-2-departure.json' };
    return { status: 200, file: 'ai/chat-1-free-text.json' };
  }

  // 1) exact method + path + query
  let r = routes.find((x) => x.method === method && x.path === p && x.query === query);
  // 2) region filter on lists
  if (!r && method === 'GET') {
    const region = q.get('region') || q.get('regionId');
    if (p === '/v1/tours' && region && exists(`tours/by-region/${region}.json`)) return { status: 200, file: `tours/by-region/${region}.json` };
    if (p === '/v1/tours' && url.searchParams.get('currency') === 'EUR') return { status: 200, file: 'tours/index-eur.json' };
    if (p === '/v1/countries' && region && exists(`countries/by-region/${region}.json`)) return { status: 200, file: `countries/by-region/${region}.json` };
    if (p === '/v1/tours/filters' && region === 'africa') return { status: 200, file: 'tours/filters-africa.json' };
  }
  // 3) detail by id: /v1/tours/{id}, /v1/countries/{id}, /v1/cities/{id}, /v1/places/{id}
  if (!r && method === 'GET') {
    const m = p.match(/^\/v1\/(tours|countries|cities|places)\/([a-z0-9-]+)$/);
    if (m && m[2] !== 'filters') {
      const file = `${m[1]}/${m[2]}.json`;
      if (exists(file)) return { status: 200, file };
      if (m[1] === 'places') {
        // find the place inside its city file
        for (const f of fs.readdirSync(path.join(DIR, 'cities'))) {
          const place = load(`cities/${f}`).places.find((x) => x.id === m[2]);
          if (place) return { status: 200, body: place };
        }
      }
      return { status: 404, file: 'errors/404-not-found.json' };
    }
    if (/^\/v1\/requests\/[0-9a-f-]{36}$/.test(p)) return { status: 200, file: 'requests/detail.json' };
    if (/^\/v1\/ai\/plans\/[0-9a-f-]{36}$/.test(p)) return { status: 200, file: 'ai/plan-detail.json' };
  }
  // 4) same method + path, any query
  if (!r) r = routes.find((x) => x.method === method && x.path === p);
  if (r) return { status: r.status, file: r.file };

  // Writes without a stored example: echo success
  if (p.startsWith('/v1/admin/')) return { status: 200, body: { ok: true, mode: 'mock' } };
  if (method === 'DELETE') return { status: 204 };
  if (/^\/v1\/requests\/[0-9a-f-]{36}\/cancel$/.test(p)) return { status: 200, file: 'requests/detail.json' };
  if (method === 'PATCH' && p === '/v1/me') return { status: 200, file: 'me/profile.json' };
  return { status: 404, body: { statusCode: 404, error: 'NotFound', message: `No mock for ${method} ${p}` } };
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
      const r = resolve(req.method, url, body, req.headers);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('X-Mock', 'roam');
      if (r.status === 204) {
        res.writeHead(204).end();
      } else {
        const body = r.body ?? load(r.file);
        res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body, null, 2));
      }
      console.log(`${req.method} ${req.url} → ${r.status}${r.file ? ` (${r.file})` : ''}`);
    });
  })
  .listen(PORT, () => {
    console.log(`Roam MOCK API on http://localhost:${PORT}  (try http://localhost:${PORT}/v1/tours)`);
    console.log('Read-only sample data. For the real backend use Docker: see POSTMAN.md');
  });
