import http from 'node:http';

const SERVICE_NAME = 'car-journal-reminder-backend';
const DEFAULT_PORT = 18080;
const APP_VERSION = (process.env.APP_VERSION || '0.1.0').trim();
const REQUESTED_PORT = Number(process.env.PORT) || DEFAULT_PORT;
const EXPLICIT_PORT = typeof process.env.PORT === 'string' && process.env.PORT.trim().length > 0;
const ENABLE_PORT_FALLBACK = parseBooleanEnv(process.env.ENABLE_PORT_FALLBACK, !EXPLICIT_PORT);
const MAX_PORT_FALLBACK_STEPS = clampInteger(process.env.MAX_PORT_FALLBACK_STEPS, 20, 0, 200);
const DEFAULT_CORS_ORIGIN_RULES = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'https://*.github.io',
];
const CORS_ORIGINS = resolveCorsOrigins(process.env.CORS_ORIGINS || '');
const startedAt = Date.now();
let listeningPort = REQUESTED_PORT;

function parseCorsOrigins(raw) {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveCorsOrigins(raw) {
  const parsed = parseCorsOrigins(raw);
  if (parsed.length > 0) {
    return parsed;
  }

  return [...DEFAULT_CORS_ORIGIN_RULES];
}

function isWildcardCorsRule(rule) {
  return /^https?:\/\/\*\.[^/]+$/i.test(rule);
}

function originMatchesCorsRule(origin, rule) {
  if (rule === origin) {
    return true;
  }

  if (!isWildcardCorsRule(rule)) {
    return false;
  }

  const wildcardMatch = rule.match(/^(https?):\/\/\*\.([^/]+)$/i);
  if (!wildcardMatch) {
    return false;
  }

  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }

  const expectedProtocol = `${wildcardMatch[1].toLowerCase()}:`;
  if (parsedOrigin.protocol.toLowerCase() !== expectedProtocol) {
    return false;
  }

  const host = parsedOrigin.hostname.toLowerCase();
  const wildcardSuffix = wildcardMatch[2].toLowerCase();
  return host === wildcardSuffix || host.endsWith(`.${wildcardSuffix}`);
}

function parseBooleanEnv(raw, fallback) {
  if (typeof raw !== 'string') {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return fallback;
}

function clampInteger(raw, fallback, min, max) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const rounded = Math.floor(parsed);
  return Math.max(min, Math.min(max, rounded));
}

function resolveCorsOrigin(origin) {
  if (CORS_ORIGINS.includes('*')) {
    return origin || '*';
  }

  if (!origin) {
    return null;
  }

  if (CORS_ORIGINS.some((rule) => originMatchesCorsRule(origin, rule))) {
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
    headers['Access-Control-Allow-Methods'] = 'GET,HEAD,POST,PATCH,OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    headers['Vary'] = 'Origin';
  }

  res.writeHead(statusCode, headers);
  res.end(payload);
}

function writeNoContent(res, origin, statusCode = 204) {
  const headers = {
    'Cache-Control': 'no-store',
  };
  const resolvedCorsOrigin = resolveCorsOrigin(origin);
  if (resolvedCorsOrigin) {
    headers['Access-Control-Allow-Origin'] = resolvedCorsOrigin;
    headers['Access-Control-Allow-Methods'] = 'GET,HEAD,POST,PATCH,OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    headers['Vary'] = 'Origin';
  }

  res.writeHead(statusCode, headers);
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
  const host = req.headers.host || `127.0.0.1:${listeningPort}`;

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
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      writeJson(res, 405, { ok: false, message: 'Method Not Allowed' }, origin);
      return;
    }

    if (req.method === 'HEAD') {
      writeNoContent(res, origin, 200);
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
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      writeJson(res, 405, { ok: false, message: 'Method Not Allowed' }, origin);
      return;
    }

    if (req.method === 'HEAD') {
      writeNoContent(res, origin, 200);
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

function listenOnPort(port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };

    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

async function startServer() {
  let port = REQUESTED_PORT;
  let fallbackSteps = 0;

  while (fallbackSteps <= MAX_PORT_FALLBACK_STEPS) {
    try {
      await listenOnPort(port);
      listeningPort = port;
      const fallbackUsed = port !== REQUESTED_PORT;

      console.log(`[${SERVICE_NAME}] listening on port ${port}`);
      console.log(`[${SERVICE_NAME}] cors origins: ${CORS_ORIGINS.join(', ')}`);
      if (fallbackUsed) {
        console.warn(`[${SERVICE_NAME}] requested port ${REQUESTED_PORT} is busy, fallback to ${port}`);
      }
      return;
    } catch (error) {
      if (error && error.code === 'EADDRINUSE') {
        if (ENABLE_PORT_FALLBACK && fallbackSteps < MAX_PORT_FALLBACK_STEPS) {
          fallbackSteps += 1;
          port += 1;
          continue;
        }

        console.error(`[${SERVICE_NAME}] port ${port} is already in use.`);
        console.error(`[${SERVICE_NAME}] hint: set PORT to another value, or stop existing process using this port.`);
        process.exitCode = 1;
        return;
      }

      console.error(`[${SERVICE_NAME}] failed to start server:`, error);
      process.exitCode = 1;
      return;
    }
  }

  console.error(`[${SERVICE_NAME}] failed to find available port after ${MAX_PORT_FALLBACK_STEPS} fallback attempts.`);
  process.exitCode = 1;
}

void startServer();
