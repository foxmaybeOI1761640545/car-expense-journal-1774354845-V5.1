export interface ReminderBackendPingResult {
  service: string;
  version: string;
  serverTimeUnix: number;
  uptimeSeconds: number;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
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
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    throw new Error('提醒后端地址为空。');
  }

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

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('连接提醒后端失败。');
  } finally {
    clearTimeout(timeoutHandle);
  }
}

