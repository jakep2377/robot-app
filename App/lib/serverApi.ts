export function normalizeServerUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "http://192.168.4.1:8080";
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

async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function probeServer(serverUrl: string, timeoutMs = 1500): Promise<ServerProbeResult> {
  const normalized = normalizeServerUrl(serverUrl);
  const startedAt = Date.now();

  try {
    const healthResponse = await fetchWithTimeout(`${normalized}/api/health`, {
      headers: {
        ...buildAuthHeaders(),
      },
    }, timeoutMs);
    const healthText = await readBody(healthResponse);
    const latencyMs = Date.now() - startedAt;

    if (healthResponse.ok) {
      let payload: unknown = null;
      if (healthText) {
        try {
          payload = JSON.parse(healthText);
        } catch {
          payload = healthText;
        }
      }
      return {
        ok: true,
        serverUrl: normalized,
        status: healthResponse.status,
        latencyMs,
        payload,
      };
    }

    const statusResponse = await fetchWithTimeout(`${normalized}/status`, {
      headers: {
        ...buildAuthHeaders(),
      },
    }, timeoutMs);
    const statusText = await readBody(statusResponse);
    if (!statusResponse.ok) {
      return {
        ok: false,
        serverUrl: normalized,
        status: statusResponse.status,
        latencyMs,
        error: statusText || `HTTP ${statusResponse.status}`,
      };
    }

    let payload: unknown = null;
    if (statusText) {
      try {
        payload = JSON.parse(statusText);
      } catch {
        payload = statusText;
      }
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
      status: null,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Probe failed",
    };
  }
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

export async function getJson<T>(serverUrl: string, path: string): Promise<T> {
  const response = await fetchWithTimeout(`${normalizeServerUrl(serverUrl)}${path}`, {
    headers: {
      ...buildAuthHeaders(),
    },
  }, 5000);
  const text = await readBody(response);
  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function getJsonAllowError<T>(serverUrl: string, path: string): Promise<{ ok: boolean; status: number; data: T | null; raw: string }> {
  const response = await fetchWithTimeout(`${normalizeServerUrl(serverUrl)}${path}`, {
    headers: {
      ...buildAuthHeaders(),
    },
  }, 5000);

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

export async function postJson<T>(serverUrl: string, path: string, body: unknown): Promise<T> {
  const response = await fetchWithTimeout(`${normalizeServerUrl(serverUrl)}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(),
    },
    body: JSON.stringify(body),
  }, 7000);
  const text = await readBody(response);
  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function postText(serverUrl: string, path: string, body: string) {
  const response = await fetchWithTimeout(`${normalizeServerUrl(serverUrl)}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(),
    },
    body: JSON.stringify({ cmd: body }),
  }, 7000);
  const text = await readBody(response);
  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}`);
  }
  return text;
}
