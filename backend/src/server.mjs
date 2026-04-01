import http from 'node:http';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const SERVICE_NAME = 'car-journal-reminder-backend';
const GITHUB_API_BASE = 'https://api.github.com';
const SEALED_TOKEN_PREFIX = 'pat.sealed';
const DEFAULT_PORT = 18080;
const APP_VERSION = (process.env.APP_VERSION || '0.1.0').trim();
const REQUESTED_PORT = Number(process.env.PORT) || DEFAULT_PORT;
const EXPLICIT_PORT = typeof process.env.PORT === 'string' && process.env.PORT.trim().length > 0;
const ENABLE_PORT_FALLBACK = parseBooleanEnv(process.env.ENABLE_PORT_FALLBACK, !EXPLICIT_PORT);
const MAX_PORT_FALLBACK_STEPS = clampInteger(process.env.MAX_PORT_FALLBACK_STEPS, 20, 0, 200);
const MAX_SEAL_JSON_BODY_BYTES = clampInteger(process.env.MAX_SEAL_JSON_BODY_BYTES, 32 * 1024, 1024, 256 * 1024);
const MAX_GITHUB_PROXY_BODY_BYTES = clampInteger(
  process.env.MAX_GITHUB_PROXY_BODY_BYTES,
  8 * 1024 * 1024,
  32 * 1024,
  32 * 1024 * 1024,
);
const PAT_WRAP_KEY_VERSION = (process.env.PAT_WRAP_KEY_VERSION || 'v1').trim() || 'v1';
const PAT_WRAP_KEY = resolvePatWrapKey(process.env.PAT_WRAP_KEY_BASE64 || '');
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

function toBase64Url(value) {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  const padded = padding === 0 ? normalized : `${normalized}${'='.repeat(4 - padding)}`;
  return Buffer.from(padded, 'base64');
}

function resolvePatWrapKey(raw) {
  if (typeof raw !== 'string') {
    return null;
  }

  const normalized = raw.trim();
  if (!normalized) {
    return null;
  }

  try {
    const key = Buffer.from(normalized, 'base64');
    if (key.length !== 32) {
      return null;
    }
    return key;
  } catch {
    return null;
  }
}

function sealPatToken(pat) {
  if (!PAT_WRAP_KEY) {
    throw new Error('PAT_WRAP_KEY_MISSING');
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', PAT_WRAP_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(pat, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = {
    iat: Math.floor(Date.now() / 1000),
    iv: toBase64Url(iv),
    tag: toBase64Url(tag),
    ciphertext: toBase64Url(encrypted),
  };
  const payloadEncoded = toBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${SEALED_TOKEN_PREFIX}.${PAT_WRAP_KEY_VERSION}.${payloadEncoded}`;
}

function unsealPatToken(sealedToken) {
  if (!PAT_WRAP_KEY) {
    throw new Error('PAT_WRAP_KEY_MISSING');
  }

  if (typeof sealedToken !== 'string') {
    throw new Error('SEALED_TOKEN_INVALID');
  }

  const trimmed = sealedToken.trim();
  const segments = trimmed.split('.');
  if (segments.length !== 4 || segments[0] !== 'pat' || segments[1] !== 'sealed') {
    throw new Error('SEALED_TOKEN_INVALID');
  }

  const payloadEncoded = segments[3];
  let payload;
  try {
    payload = JSON.parse(fromBase64Url(payloadEncoded).toString('utf8'));
  } catch {
    throw new Error('SEALED_TOKEN_INVALID');
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof payload.iv !== 'string' ||
    typeof payload.tag !== 'string' ||
    typeof payload.ciphertext !== 'string'
  ) {
    throw new Error('SEALED_TOKEN_INVALID');
  }

  let iv;
  let tag;
  let ciphertext;
  try {
    iv = fromBase64Url(payload.iv);
    tag = fromBase64Url(payload.tag);
    ciphertext = fromBase64Url(payload.ciphertext);
  } catch {
    throw new Error('SEALED_TOKEN_INVALID');
  }

  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error('SEALED_TOKEN_INVALID');
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', PAT_WRAP_KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8').trim();
    if (!decrypted) {
      throw new Error('SEALED_TOKEN_INVALID');
    }
    return decrypted;
  } catch {
    throw new Error('SEALED_TOKEN_INVALID');
  }
}

function normalizeNonEmptyString(value, maxLength = 200) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, maxLength);
}

function normalizeRepoPath(rawPath) {
  const path = normalizeNonEmptyString(rawPath, 1000).replace(/^\/+/, '');
  if (!path || path.includes('..') || path.includes('\\')) {
    return '';
  }
  return path;
}

function encodeContentPath(path) {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function makeGithubContentsEndpoint({ owner, repo, path, branch }) {
  const refQuery = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  return `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeContentPath(path)}${refQuery}`;
}

async function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let exceededLimit = false;

    req.on('data', (chunk) => {
      if (exceededLimit) {
        return;
      }

      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        exceededLimit = true;
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (exceededLimit) {
        const error = new Error('JSON body too large');
        error.code = 'BODY_TOO_LARGE';
        reject(error);
        return;
      }

      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        const error = new Error('Invalid JSON');
        error.code = 'INVALID_JSON';
        reject(error);
      }
    });

    req.on('error', (error) => {
      reject(error);
    });
  });
}

async function parseGithubResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      message: text.slice(0, 2000),
    };
  }
}

async function proxyGithubContentsRequest({ method, pat, owner, repo, branch, path, payload }) {
  const endpoint = makeGithubContentsEndpoint({
    owner,
    repo,
    path,
    branch: method === 'GET' ? branch : '',
  });
  const headers = {
    Authorization: `Bearer ${pat}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const init = {
    method,
    headers,
  };

  if (method === 'PUT') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(payload);
  }

  const upstreamResponse = await fetch(endpoint, init);
  const body = await parseGithubResponseBody(upstreamResponse);
  return {
    status: upstreamResponse.status,
    body,
  };
}

function validateSealRequestBody(body) {
  const pat = normalizeNonEmptyString(body?.pat, 2048);
  if (!pat) {
    return {
      ok: false,
      message: 'Invalid PAT.',
    };
  }

  return {
    ok: true,
    pat,
  };
}

function validateGithubProxyBody(body, requirePayload = false) {
  const sealedToken = normalizeNonEmptyString(body?.sealedToken, 8192);
  const owner = normalizeNonEmptyString(body?.owner, 120);
  const repo = normalizeNonEmptyString(body?.repo, 120);
  const branch = normalizeNonEmptyString(body?.branch, 160);
  const path = normalizeRepoPath(body?.path);

  if (!sealedToken || !owner || !repo || !path) {
    return {
      ok: false,
      message: 'Invalid GitHub proxy request.',
    };
  }

  if (!requirePayload) {
    return {
      ok: true,
      sealedToken,
      owner,
      repo,
      branch,
      path,
    };
  }

  const payload = body?.payload;
  if (!payload || typeof payload !== 'object') {
    return {
      ok: false,
      message: 'Invalid GitHub payload.',
    };
  }

  const message = normalizeNonEmptyString(payload.message, 300);
  const content = typeof payload.content === 'string' ? payload.content : '';
  const sha = normalizeNonEmptyString(payload.sha, 120);
  const payloadBranch = normalizeNonEmptyString(payload.branch, 160);

  if (!message || !content.trim()) {
    return {
      ok: false,
      message: 'Invalid GitHub payload.',
    };
  }

  return {
    ok: true,
    sealedToken,
    owner,
    repo,
    branch,
    path,
    payload: {
      message,
      content,
      sha: sha || undefined,
      branch: payloadBranch || undefined,
    },
  };
}

async function handleTokenSealRequest(req, res, origin) {
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, message: 'Method Not Allowed' }, origin);
    return;
  }

  if (!PAT_WRAP_KEY) {
    writeJson(res, 503, { ok: false, message: 'PAT sealing is not configured.' }, origin);
    return;
  }

  try {
    const body = await readJsonBody(req, MAX_SEAL_JSON_BODY_BYTES);
    const validated = validateSealRequestBody(body);
    if (!validated.ok) {
      writeJson(res, 400, { ok: false, message: validated.message }, origin);
      return;
    }

    const sealedToken = sealPatToken(validated.pat);
    writeJson(
      res,
      200,
      {
        ok: true,
        keyVersion: PAT_WRAP_KEY_VERSION,
        sealedToken,
      },
      origin,
    );
  } catch (error) {
    if (error && error.code === 'BODY_TOO_LARGE') {
      writeJson(res, 413, { ok: false, message: 'JSON body too large.' }, origin);
      return;
    }
    if (error && error.code === 'INVALID_JSON') {
      writeJson(res, 400, { ok: false, message: 'Invalid JSON.' }, origin);
      return;
    }
    writeJson(res, 500, { ok: false, message: 'Failed to seal token.' }, origin);
  }
}

async function handleGithubContentsProxyRequest(req, res, origin, mode) {
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, message: 'Method Not Allowed' }, origin);
    return;
  }

  if (!PAT_WRAP_KEY) {
    writeJson(res, 503, { ok: false, message: 'GitHub proxy is not configured.' }, origin);
    return;
  }

  try {
    const body = await readJsonBody(req, MAX_GITHUB_PROXY_BODY_BYTES);
    const validated = validateGithubProxyBody(body, mode === 'put');
    if (!validated.ok) {
      writeJson(res, 400, { ok: false, message: validated.message }, origin);
      return;
    }

    let pat = '';
    try {
      pat = unsealPatToken(validated.sealedToken);
    } catch {
      writeJson(res, 400, { ok: false, message: 'Invalid sealed token.' }, origin);
      return;
    }

    const result = await proxyGithubContentsRequest({
      method: mode === 'put' ? 'PUT' : 'GET',
      pat,
      owner: validated.owner,
      repo: validated.repo,
      branch: validated.branch,
      path: validated.path,
      payload: mode === 'put' ? validated.payload : undefined,
    });
    writeJson(res, result.status, result.body, origin);
  } catch (error) {
    if (error && error.code === 'BODY_TOO_LARGE') {
      writeJson(res, 413, { ok: false, message: 'JSON body too large.' }, origin);
      return;
    }
    if (error && error.code === 'INVALID_JSON') {
      writeJson(res, 400, { ok: false, message: 'Invalid JSON.' }, origin);
      return;
    }
    writeJson(res, 502, { ok: false, message: 'GitHub proxy request failed.' }, origin);
  }
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

  if (pathname === '/api/token/seal') {
    void handleTokenSealRequest(req, res, origin);
    return;
  }

  if (pathname === '/api/github/contents/get') {
    void handleGithubContentsProxyRequest(req, res, origin, 'get');
    return;
  }

  if (pathname === '/api/github/contents/list') {
    void handleGithubContentsProxyRequest(req, res, origin, 'list');
    return;
  }

  if (pathname === '/api/github/contents/put') {
    void handleGithubContentsProxyRequest(req, res, origin, 'put');
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
      console.log(`[${SERVICE_NAME}] pat sealing: ${PAT_WRAP_KEY ? `enabled (${PAT_WRAP_KEY_VERSION})` : 'disabled'}`);
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
