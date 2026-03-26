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
  const response = await fetch(`${normalizeServerUrl(serverUrl)}${path}`, {
    headers: {
      ...buildAuthHeaders(),
    },
  });
  const text = await readBody(response);
  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function getJsonAllowError<T>(serverUrl: string, path: string): Promise<{ ok: boolean; status: number; data: T | null; raw: string }> {
  const response = await fetch(`${normalizeServerUrl(serverUrl)}${path}`, {
    headers: {
      ...buildAuthHeaders(),
    },
  });

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
  const response = await fetch(`${normalizeServerUrl(serverUrl)}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(),
    },
    body: JSON.stringify(body),
  });
  const text = await readBody(response);
  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function postText(serverUrl: string, path: string, body: string) {
  const response = await fetch(`${normalizeServerUrl(serverUrl)}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(),
    },
    body: JSON.stringify({ cmd: body }),
  });
  const text = await readBody(response);
  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}`);
  }
  return text;
}