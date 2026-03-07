const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    process.env[key] = value;
  }
}

loadEnvFile();

const PORT = Number(process.env.SYNC_PORT || 8787);
const HOST = process.env.SYNC_HOST || '0.0.0.0';
const API_TOKEN = String(process.env.SYNC_API_TOKEN || '').trim();
const DATA_DIR = process.env.SYNC_DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'sync-store.json');
const MAX_BODY_BYTES = Number(process.env.SYNC_MAX_BODY_BYTES || 20 * 1024 * 1024);

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ records: {} }, null, 2), 'utf8');
  }
}

function readStore() {
  ensureStore();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.records || typeof parsed.records !== 'object') {
      return { records: {} };
    }
    return parsed;
  } catch {
    return { records: {} };
  }
}

function writeStore(store) {
  ensureStore();
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function unauthorized(res) {
  sendJson(res, 401, { error: 'Unauthorized' });
}

function verifyAuth(req) {
  if (!API_TOKEN) return true;
  const auth = String(req.headers.authorization || '');
  return auth === `Bearer ${API_TOKEN}`;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function validateChurchKey(churchKey) {
  return /^[a-zA-Z0-9._-]{3,120}$/.test(String(churchKey || ''));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === '/faithflow/sync/upload' && req.method === 'POST') {
      if (!verifyAuth(req)) {
        unauthorized(res);
        return;
      }
      const body = await readJsonBody(req);
      const churchKey = String(body?.churchKey || '').trim();
      const payload = String(body?.payload || '').trim();
      if (!validateChurchKey(churchKey)) {
        sendJson(res, 400, { error: 'Invalid churchKey format.' });
        return;
      }
      if (!payload) {
        sendJson(res, 400, { error: 'Encrypted payload is required.' });
        return;
      }

      const store = readStore();
      store.records[churchKey] = {
        payload,
        uploadedAt: String(body?.uploadedAt || new Date().toISOString()),
        appVersion: String(body?.appVersion || ''),
        platform: String(body?.platform || ''),
      };
      writeStore(store);
      sendJson(res, 200, { success: true, churchKey, uploadedAt: store.records[churchKey].uploadedAt });
      return;
    }

    if (url.pathname === '/faithflow/sync/download' && req.method === 'GET') {
      if (!verifyAuth(req)) {
        unauthorized(res);
        return;
      }
      const churchKey = String(url.searchParams.get('churchKey') || '').trim();
      if (!validateChurchKey(churchKey)) {
        sendJson(res, 400, { error: 'Invalid churchKey format.' });
        return;
      }
      const store = readStore();
      const record = store.records[churchKey];
      if (!record) {
        sendJson(res, 404, { error: 'No backup found for this churchKey.' });
        return;
      }
      sendJson(res, 200, {
        payload: record.payload,
        uploadedAt: record.uploadedAt,
        appVersion: record.appVersion,
        platform: record.platform,
      });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : 'Server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`FaithFlow Sync Server running at http://${HOST}:${PORT}`);
});
