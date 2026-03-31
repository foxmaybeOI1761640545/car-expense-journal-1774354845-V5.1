export interface ReminderBackendPingResult {
  service: string;
  version: string;
  serverTimeUnix: number;
  uptimeSeconds: number;
}

const UNSAFE_BROWSER_PORTS = new Set<number>([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111,
  113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540,
  548, 554, 556, 563, 587, 601, 636, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666,
  6667, 6668, 6669, 6679, 6697, 10080,
]);

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function resolveAbsoluteBaseUrl(baseUrl: string): string {
  if (/^https?:\/\//i.test(baseUrl)) {
    return baseUrl;
  }

  return `http://${baseUrl}`;
}

function assertSafePort(baseUrl: string): void {
  let parsed: URL;

  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('提醒后端地址格式无效，请填写 http://host:port 形式。');
  }

  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  if (!Number.isFinite(port)) {
    throw new Error('提醒后端地址端口无效。');
  }

  if (UNSAFE_BROWSER_PORTS.has(port)) {
    throw new Error(`浏览器会拦截端口 ${port}（ERR_UNSAFE_PORT），请改用 18080、10081、8080 等安全端口。`);
  }
}

function parsePingPayload(payload: unknown): ReminderBackendPingResult {
  if (!payload || typeof payload !== 'object') {
    throw new Error('返回内容无效。');
  }

  const value = payload as Record<string, unknown>;
  if (value.ok !== true) {
    throw new Error('服务返回非成功状态。');
  }

  const service = typeof value.service === 'string' ? value.service : 'unknown-service';
  const version = typeof value.version === 'string' ? value.version : 'unknown-version';
  const serverTimeUnix = Number(value.serverTimeUnix);
  const uptimeSeconds = Number(value.uptimeSeconds);

  if (!Number.isFinite(serverTimeUnix) || !Number.isFinite(uptimeSeconds)) {
    throw new Error('服务返回字段不完整。');
  }

  return {
    service,
    version,
    serverTimeUnix: Math.floor(serverTimeUnix),
    uptimeSeconds: Math.floor(uptimeSeconds),
  };
}

export async function pingReminderBackend(baseUrl: string, timeoutMs = 6000): Promise<ReminderBackendPingResult> {
  const normalizedBaseUrl = normalizeBaseUrl(resolveAbsoluteBaseUrl(baseUrl));
  if (!normalizedBaseUrl) {
    throw new Error('提醒后端地址为空。');
  }
  assertSafePort(normalizedBaseUrl);

  const controller = new AbortController();
  const timeoutHandle = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(`${normalizedBaseUrl}/api/ping`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`服务响应异常：HTTP ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    return parsePingPayload(payload);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('连接超时，请检查后端服务是否可访问。');
    }

    if (error instanceof TypeError) {
      throw new Error(`连接失败：${normalizedBaseUrl}/api/ping。请确认端口与后端实际监听端口一致。`);
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('连接提醒后端失败。');
  } finally {
    clearTimeout(timeoutHandle);
  }
}
