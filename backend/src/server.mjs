import http from 'node:http';

const SERVICE_NAME = 'car-journal-reminder-backend';
const DEFAULT_PORT = 10080;
const APP_VERSION = (process.env.APP_VERSION || '0.1.0').trim();
const PORT = Number(process.env.PORT) || DEFAULT_PORT;
const CORS_ORIGINS = parseCorsOrigins(process.env.CORS_ORIGINS || '');
const startedAt = Date.now();

function parseCorsOrigins(raw) {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveCorsOrigin(origin) {
  if (CORS_ORIGINS.includes('*')) {
    return origin || '*';
  }

  if (!origin) {
    return null;
  }

  if (CORS_ORIGINS.includes(origin)) {
    return origin;
  }

  return null;
}

function writeJson(res, statusCode, body, origin) {
  const payload = JSON.stringify(body);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  };

  const resolvedCorsOrigin = resolveCorsOrigin(origin);
  if (resolvedCorsOrigin) {
    headers['Access-Control-Allow-Origin'] = resolvedCorsOrigin;
    headers['Access-Control-Allow-Methods'] = 'GET,POST,PATCH,OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    headers['Vary'] = 'Origin';
  }

  res.writeHead(statusCode, headers);
  res.end(payload);
}

function writeNoContent(res, origin) {
  const headers = {
    'Cache-Control': 'no-store',
  };
  const resolvedCorsOrigin = resolveCorsOrigin(origin);
  if (resolvedCorsOrigin) {
    headers['Access-Control-Allow-Origin'] = resolvedCorsOrigin;
    headers['Access-Control-Allow-Methods'] = 'GET,POST,PATCH,OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    headers['Vary'] = 'Origin';
  }

  res.writeHead(204, headers);
  res.end();
}

function getRuntimeStatus() {
  const serverTimeUnix = Math.floor(Date.now() / 1000);
  const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
  return {
    ok: true,
    service: SERVICE_NAME,
    version: APP_VERSION,
    serverTimeUnix,
    uptimeSeconds,
  };
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  const host = req.headers.host || `127.0.0.1:${PORT}`;

  if (!req.url || !req.method) {
    writeJson(res, 400, { ok: false, message: 'Invalid request.' }, origin);
    return;
  }

  let pathname = '/';

  try {
    const url = new URL(req.url, `http://${host}`);
    pathname = url.pathname;
  } catch {
    writeJson(res, 400, { ok: false, message: 'Malformed URL.' }, origin);
    return;
  }

  if (req.method === 'OPTIONS') {
    writeNoContent(res, origin);
    return;
  }

  if (pathname === '/healthz') {
    if (req.method !== 'GET') {
      writeJson(res, 405, { ok: false, message: 'Method Not Allowed' }, origin);
      return;
    }

    writeJson(
      res,
      200,
      {
        ...getRuntimeStatus(),
        health: 'ok',
      },
      origin,
    );
    return;
  }

  if (pathname === '/api/ping') {
    if (req.method !== 'GET') {
      writeJson(res, 405, { ok: false, message: 'Method Not Allowed' }, origin);
      return;
    }

    writeJson(res, 200, getRuntimeStatus(), origin);
    return;
  }

  writeJson(
    res,
    404,
    {
      ok: false,
      message: 'Not Found',
      path: pathname,
    },
    origin,
  );
});

server.listen(PORT, () => {
  console.log(`[${SERVICE_NAME}] listening on port ${PORT}`);
});
