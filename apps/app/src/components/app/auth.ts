import { useEffect, useState } from "react";

const DEFAULT_API_BASE_URL = import.meta.env.VITE_QUILLBY_API_BASE_URL ?? "http://localhost:3000";

export function getDefaultApiBaseUrl(): string {
  return DEFAULT_API_BASE_URL.replace(/\/$/, "");
}

export interface AppSession {
  session: {
    id: string;
    userId: string;
    expiresAt?: string;
  };
  user: {
    id: string;
    email: string;
    name?: string | null;
  };
}

interface AuthResponse<T> {
  data: T | null;
}

async function authFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${getDefaultApiBaseUrl()}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}: ${res.statusText}`;
    try {
      const data = (await res.json()) as { message?: string; error?: string };
      message = data.message ?? data.error ?? message;
    } catch {
      // Keep the default status-based error.
    }
    throw new Error(message);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

export async function getSession(): Promise<AppSession | null> {
  const result = await authFetch<AuthResponse<AppSession>>("/api/auth/get-session");
  return result.data;
}

export async function signInEmail(email: string, password: string): Promise<void> {
  await authFetch("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function signUpEmail(name: string, email: string, password: string): Promise<void> {
  await authFetch("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });
}

export async function signOut(): Promise<void> {
  await authFetch("/api/auth/sign-out", {
    method: "POST",
  });
}

export function useSession() {
  const [data, setData] = useState<AppSession | null>(null);
  const [isPending, setIsPending] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  async function refresh() {
    setIsPending(true);
    try {
      const session = await getSession();
      setData(session);
      setError(null);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err : new Error("Failed to load session"));
    } finally {
      setIsPending(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return { data, isPending, error, refresh };
}
