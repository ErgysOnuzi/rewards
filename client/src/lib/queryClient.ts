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

// Try to use localStorage AND sessionStorage for redundancy
function tryLocalStorage(action: 'get' | 'set' | 'remove', value?: string | null): string | null {
  try {
    if (action === 'get') {
      // Try localStorage first, then sessionStorage as backup
      const localValue = localStorage.getItem(AUTH_TOKEN_KEY);
      if (localValue) return localValue;
      
      // Check sessionStorage and restore to localStorage if found
      const sessionValue = sessionStorage.getItem(AUTH_TOKEN_KEY);
      if (sessionValue) {
        try {
          localStorage.setItem(AUTH_TOKEN_KEY, sessionValue);
          console.log('[Auth] Restored token from sessionStorage to localStorage');
        } catch { /* ignore */ }
        return sessionValue;
      }
      return null;
    } else if (action === 'set' && value) {
      localStorage.setItem(AUTH_TOKEN_KEY, value);
      sessionStorage.setItem(AUTH_TOKEN_KEY, value); // Backup
    } else if (action === 'remove') {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      sessionStorage.removeItem(AUTH_TOKEN_KEY);
    }
    return null;
  } catch {
    // localStorage blocked (third-party iframe context)
    console.log('[Auth] localStorage blocked, trying sessionStorage');
    try {
      if (action === 'get') {
        return sessionStorage.getItem(AUTH_TOKEN_KEY);
      } else if (action === 'set' && value) {
        sessionStorage.setItem(AUTH_TOKEN_KEY, value);
      } else if (action === 'remove') {
        sessionStorage.removeItem(AUTH_TOKEN_KEY);
      }
    } catch {
      console.log('[Auth] All storage blocked, using in-memory only');
    }
    return null;
  }
}

export function getAuthToken(): string | null {
  // Try localStorage first, fall back to memory
  const stored = tryLocalStorage('get');
  const token = stored || inMemoryToken;
  
  // Debug: Log token retrieval status (helps diagnose session issues)
  if (typeof window !== 'undefined' && !token) {
    console.log('[Auth] No token found:', { 
      fromLocalStorage: !!stored, 
      fromMemory: !!inMemoryToken,
      localStorageAvailable: isLocalStorageAvailable()
    });
  }
  
  return token;
}

// Check if localStorage is actually available and working
function isLocalStorageAvailable(): boolean {
  try {
    const testKey = '__auth_test__';
    localStorage.setItem(testKey, 'test');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

export function setAuthToken(token: string | null): void {
  // Always set in memory (works everywhere)
  inMemoryToken = token;
  
  if (token) {
    tryLocalStorage('set', token);
    // Verify it was stored
    const verified = tryLocalStorage('get');
    console.log('[Auth] Token saved:', { 
      inMemory: true, 
      inLocalStorage: verified === token,
      tokenPreview: token.substring(0, 20) + '...'
    });
    // Notify parent window if in iframe
    notifyParentAuth(token);
  } else {
    tryLocalStorage('remove');
    console.log('[Auth] Token cleared');
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

// Log auth state on module load (helps diagnose session persistence issues)
if (typeof window !== 'undefined') {
  const storedToken = tryLocalStorage('get');
  console.log('[Auth] App startup state:', {
    hasStoredToken: !!storedToken,
    tokenPreview: storedToken ? storedToken.substring(0, 20) + '...' : null,
    isIframe: isInIframe(),
    localStorageAvailable: isLocalStorageAvailable()
  });
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
