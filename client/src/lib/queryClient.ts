import { QueryClient, QueryFunction } from "@tanstack/react-query";

const AUTH_TOKEN_KEY = "auth_token";

// In-memory fallback for when localStorage is blocked (iframe cross-site context)
let inMemoryToken: string | null = null;

// Check if we're in an iframe
export function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // If we can't access window.top, we're likely in a cross-origin iframe
  }
}

// Try to use localStorage, fall back to memory
function tryLocalStorage(action: 'get' | 'set' | 'remove', value?: string | null): string | null {
  try {
    if (action === 'get') {
      return localStorage.getItem(AUTH_TOKEN_KEY);
    } else if (action === 'set' && value) {
      localStorage.setItem(AUTH_TOKEN_KEY, value);
    } else if (action === 'remove') {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
    return null;
  } catch {
    // localStorage blocked (third-party iframe context)
    console.log('[Auth] localStorage blocked, using in-memory storage');
    return null;
  }
}

export function getAuthToken(): string | null {
  // Try localStorage first, fall back to memory
  const stored = tryLocalStorage('get');
  return stored || inMemoryToken;
}

export function setAuthToken(token: string | null): void {
  // Always set in memory (works everywhere)
  inMemoryToken = token;
  
  if (token) {
    tryLocalStorage('set', token);
    // Notify parent window if in iframe
    notifyParentAuth(token);
  } else {
    tryLocalStorage('remove');
    notifyParentAuth(null);
  }
}

export function clearAuthToken(): void {
  inMemoryToken = null;
  tryLocalStorage('remove');
  notifyParentAuth(null);
}

// Notify parent window of auth changes (for iframe embedding)
function notifyParentAuth(token: string | null): void {
  if (!isInIframe()) return;
  
  try {
    const message = {
      type: 'LUKEREWARDS_AUTH',
      token: token,
      action: token ? 'login' : 'logout'
    };
    // Send to parent - they need to whitelist the origin
    window.parent.postMessage(message, '*');
    console.log('[Auth] Notified parent window:', message.action);
  } catch (e) {
    console.log('[Auth] Could not notify parent:', e);
  }
}

// Listen for auth tokens from parent window
export function initIframeAuth(): void {
  if (!isInIframe()) return;
  
  window.addEventListener('message', (event) => {
    // Accept messages from known parent domains
    const trustedOrigins = [
      'https://lukerewards.com',
      'https://www.lukerewards.com',
      'https://lukethedegen.com',
      'https://www.lukethedegen.com'
    ];
    
    if (!trustedOrigins.includes(event.origin)) {
      return;
    }
    
    const data = event.data;
    if (data?.type === 'LUKEREWARDS_TOKEN') {
      console.log('[Auth] Received token from parent');
      inMemoryToken = data.token;
    }
  });
  
  // Request token from parent on load
  try {
    window.parent.postMessage({ type: 'LUKEREWARDS_REQUEST_TOKEN' }, '*');
    console.log('[Auth] Requested token from parent');
  } catch (e) {
    console.log('[Auth] Could not request token from parent:', e);
  }
}

function getAuthHeaders(): HeadersInit {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function safeJsonParse(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { message: text || response.statusText || "Unknown error" };
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: HeadersInit = {
    ...getAuthHeaders(),
    ...(data ? { "Content-Type": "application/json" } : {}),
  };

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      headers: getAuthHeaders(),
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
