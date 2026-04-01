export interface SealGithubTokenResult {
  sealedToken: string;
  keyVersion: string;
}

interface SealTokenResponseBody {
  ok?: boolean;
  sealedToken?: unknown;
  keyVersion?: unknown;
  message?: unknown;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function resolveAbsoluteBaseUrl(baseUrl: string): string {
  if (/^https?:\/\//i.test(baseUrl)) {
    return baseUrl;
  }
  return `http://${baseUrl}`;
}

export async function sealGithubTokenWithBackend(baseUrl: string, pat: string, timeoutMs = 8000): Promise<SealGithubTokenResult> {
  const normalizedPat = pat.trim();
  if (!normalizedPat) {
    throw new Error('GitHub Token 不能为空。');
  }

  const resolvedBaseUrl = normalizeBaseUrl(resolveAbsoluteBaseUrl(baseUrl));
  if (!resolvedBaseUrl) {
    throw new Error('请先配置提醒后端地址（reminderApiBaseUrl）。');
  }

  const controller = new AbortController();
  const timeoutHandle = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(`${resolvedBaseUrl}/api/token/seal`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        pat: normalizedPat,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as SealTokenResponseBody;
    if (!response.ok || payload.ok !== true) {
      const message =
        typeof payload.message === 'string' && payload.message.trim() ? payload.message.trim() : `后端密封失败（HTTP ${response.status}）。`;
      throw new Error(message);
    }

    const sealedToken = typeof payload.sealedToken === 'string' ? payload.sealedToken.trim() : '';
    const keyVersion = typeof payload.keyVersion === 'string' ? payload.keyVersion.trim() : '';
    if (!sealedToken || !keyVersion || !/^pat\.sealed\./.test(sealedToken)) {
      throw new Error('后端返回的密封 Token 无效。');
    }

    return {
      sealedToken,
      keyVersion,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('请求后端密封 Token 超时，请稍后重试。');
    }

    if (error instanceof TypeError) {
      throw new Error('无法连接提醒后端，请检查 reminderApiBaseUrl 与 CORS 配置。');
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('调用后端密封 Token 失败。');
  } finally {
    clearTimeout(timeoutHandle);
  }
}

