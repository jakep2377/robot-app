function appendLocalBackendDefaultPort(url: string) {
  const match = url.match(/^(https?):\/\/([^/]+)(\/.*)?$/i);
  if (!match) {
    return url;
  }

  const [, scheme, authority, suffix = ""] = match;
  if (authority.includes(":") || scheme.toLowerCase() === "https") {
    return `${scheme}://${authority}${suffix}`;
  }

  const host = authority.toLowerCase();
  const isLocalLike = host === "localhost"
    || host === "127.0.0.1"
    || host === "10.0.2.2"
    || host === "10.0.3.2"
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    || host.endsWith(".local");

  return isLocalLike ? `${scheme}://${authority}:8080${suffix}` : `${scheme}://${authority}${suffix}`;
}

export function normalizeServerUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "http://192.168.4.1:8080";
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return appendLocalBackendDefaultPort(withProtocol).replace(/\/+$/, "");
}

export function normalizeBaseStationUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "http://192.168.4.1";
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

export function normalizeGatewayUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "http://172.20.10.2";
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

export function toWebSocketUrl(serverUrl: string) {
  return normalizeServerUrl(serverUrl).replace(/^http/i, "ws");
}

export type ServerProbeResult = {
  ok: boolean;
  serverUrl: string;
  status: number | null;
  latencyMs: number;
  error?: string;
  payload?: unknown;
};

export type BaseStationSetupStatus = {
  ok?: boolean;
  configured?: boolean;
  mode?: string;
  state?: string;
  apSsid?: string;
  savedSsid?: string;
  backendUrl?: string;
  wifiLinkState?: string;
  boardApiKeySet?: boolean;
};

export type BaseStationSetupProbeResult = {
  ok: boolean;
  baseStationUrl: string;
  status: number | null;
  latencyMs: number;
  error?: string;
  payload?: BaseStationSetupStatus | null;
};

async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = 5000) {
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) ? Math.max(1000, Math.round(timeoutMs)) : 5000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? 'Network request failed');
    const normalized = message.toLowerCase();
    if (
      normalized.includes('abort')
      || normalized.includes('timeout')
      || normalized.includes('timed out')
      || normalized.includes('socket')
    ) {
      throw new Error(`Request timed out after ${Math.max(1, Math.round(effectiveTimeoutMs / 1000))} seconds`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function parseBodyPayload(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function looksLikeRobotBackend(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }

  const candidate = payload as Record<string, unknown>;
  return candidate.service === "robot-lora-server"
    || candidate.mode === "SERVER"
    || (typeof candidate.connectivity === "object" && candidate.connectivity !== null)
    || (candidate.ok === true && typeof candidate.checks === "object");
}

export async function probeServer(serverUrl: string, timeoutMs = 1500): Promise<ServerProbeResult> {
  const normalized = normalizeServerUrl(serverUrl);
  const startedAt = Date.now();
  let lastStatus: number | null = null;
  let lastPayload: unknown = null;
  let lastError = '';

  try {
    const healthResponse = await fetchWithTimeout(`${normalized}/api/health`, {
      headers: {
        ...buildAuthHeaders(),
      },
    }, timeoutMs);
    const healthText = await readBody(healthResponse);
    const healthPayload = parseBodyPayload(healthText);
    const latencyMs = Date.now() - startedAt;

    lastStatus = healthResponse.status;
    lastPayload = healthPayload;
    lastError = healthText || `HTTP ${healthResponse.status}`;

    if (healthResponse.ok && looksLikeRobotBackend(healthPayload)) {
      return {
        ok: true,
        serverUrl: normalized,
        status: healthResponse.status,
        latencyMs,
        payload: healthPayload,
      };
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : 'Health probe failed';
  }

  try {
    const statusResponse = await fetchWithTimeout(`${normalized}/status`, {
      headers: {
        ...buildAuthHeaders(),
      },
    }, Math.max(timeoutMs, 2500));
    const statusText = await readBody(statusResponse);
    const latencyMs = Date.now() - startedAt;

    lastStatus = statusResponse.status;
    if (!statusResponse.ok) {
      return {
        ok: false,
        serverUrl: normalized,
        status: statusResponse.status,
        latencyMs,
        error: statusText || lastError || `HTTP ${statusResponse.status}`,
      };
    }

    const payload = parseBodyPayload(statusText);
    if (!looksLikeRobotBackend(payload)) {
      return {
        ok: false,
        serverUrl: normalized,
        status: statusResponse.status,
        latencyMs,
        error: 'Endpoint is reachable, but it is not the robot backend.',
        payload,
      };
    }

    return {
      ok: true,
      serverUrl: normalized,
      status: statusResponse.status,
      latencyMs,
      payload,
    };
  } catch (error) {
    return {
      ok: false,
      serverUrl: normalized,
      status: lastStatus,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : lastError || 'Probe failed',
      payload: lastPayload,
    };
  }
}

export async function probeBaseStationSetup(baseStationUrl: string, timeoutMs = 2500): Promise<BaseStationSetupProbeResult> {
  const normalized = normalizeBaseStationUrl(baseStationUrl);
  const startedAt = Date.now();

  try {
    const response = await fetchWithTimeout(`${normalized}/setup/status`, {
      headers: {
        Accept: 'application/json',
      },
    }, timeoutMs);
    const text = await readBody(response);
    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      return {
        ok: false,
        baseStationUrl: normalized,
        status: response.status,
        latencyMs,
        error: text || `HTTP ${response.status}`,
        payload: null,
      };
    }

    let payload: BaseStationSetupStatus | null = null;
    if (text) {
      try {
        payload = JSON.parse(text) as BaseStationSetupStatus;
      } catch {
        payload = null;
      }
    }

    return {
      ok: true,
      baseStationUrl: normalized,
      status: response.status,
      latencyMs,
      payload,
    };
  } catch (error) {
    return {
      ok: false,
      baseStationUrl: normalized,
      status: null,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'Base station setup probe failed',
      payload: null,
    };
  }
}

export async function configureBaseStationSetup(baseStationUrl: string, body: {
  ssid: string;
  password: string;
  backendUrl?: string;
  boardApiKey?: string;
}) {
  const response = await fetchWithTimeout(`${normalizeBaseStationUrl(baseStationUrl)}/setup/network`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }, 7000);
  const text = await readBody(response);
  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}`);
  }
  return text ? JSON.parse(text) as { ok?: boolean; message?: string } : {};
}

function buildAuthHeaders() {
  const apiKey = typeof process.env.EXPO_PUBLIC_APP_API_KEY === "string"
    ? process.env.EXPO_PUBLIC_APP_API_KEY.trim()
    : "";

  const headers: Record<string, string> = {};
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }
  return headers;
}

async function readBody(response: Response) {
  const text = await response.text();
  return text.trim();
}

export async function getJson<T>(serverUrl: string, path: string, timeoutMs = 8000): Promise<T> {
  const response = await fetchWithTimeout(`${normalizeServerUrl(serverUrl)}${path}`, {
    headers: {
      ...buildAuthHeaders(),
    },
  }, timeoutMs);
  const text = await readBody(response);
  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function getJsonAllowError<T>(serverUrl: string, path: string, timeoutMs = 8000): Promise<{ ok: boolean; status: number; data: T | null; raw: string }> {
  const response = await fetchWithTimeout(`${normalizeServerUrl(serverUrl)}${path}`, {
    headers: {
      ...buildAuthHeaders(),
    },
  }, timeoutMs);

  const text = await readBody(response);
  let data: T | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = null;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    raw: text,
  };
}

export async function getGatewayJsonAllowError<T>(gatewayUrl: string, path: string, timeoutMs = 8000): Promise<{ ok: boolean; status: number; data: T | null; raw: string }> {
  const response = await fetchWithTimeout(`${normalizeGatewayUrl(gatewayUrl)}${path}`, {
    headers: {
      ...buildAuthHeaders(),
    },
  }, timeoutMs);

  const text = await readBody(response);
  let data: T | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = null;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    raw: text,
  };
}

export async function postJson<T>(serverUrl: string, path: string, body: unknown, timeoutMs = 15000): Promise<T> {
  const response = await fetchWithTimeout(`${normalizeServerUrl(serverUrl)}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(),
    },
    body: JSON.stringify(body),
  }, timeoutMs);
  const text = await readBody(response);
  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function postText(serverUrl: string, path: string, body: string, timeoutMs = 10000) {
  const response = await fetchWithTimeout(`${normalizeServerUrl(serverUrl)}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(),
    },
    body: JSON.stringify({ cmd: body }),
  }, timeoutMs);
  const text = await readBody(response);
  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}`);
  }
  return text;
}

export async function postGatewayText(gatewayUrl: string, path: string, body: string, timeoutMs = 10000) {
  const response = await fetchWithTimeout(`${normalizeGatewayUrl(gatewayUrl)}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(),
    },
    body: JSON.stringify({ cmd: body }),
  }, timeoutMs);
  const text = await readBody(response);
  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}`);
  }
  return text;
}

export async function postGatewayPlainText(gatewayUrl: string, path: string, body: string, timeoutMs = 8000) {
  const response = await fetchWithTimeout(`${normalizeGatewayUrl(gatewayUrl)}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      ...buildAuthHeaders(),
    },
    body,
  }, timeoutMs);
  const text = await readBody(response);
  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}`);
  }
  return text;
}

export async function postPlainText(serverUrl: string, path: string, body: string, timeoutMs = 8000) {
  const response = await fetchWithTimeout(`${normalizeServerUrl(serverUrl)}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      ...buildAuthHeaders(),
    },
    body,
  }, timeoutMs);
  const text = await readBody(response);
  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}`);
  }
  return text;
}
