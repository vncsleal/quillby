// ─────────────────────────────────────────────────────────────────────────────
// Quillby App — browser-side API client
//
// Self-hosted connections are persisted in localStorage. Cloud sessions rely
// on browser cookies and the server-side Better Auth session.
// ─────────────────────────────────────────────────────────────────────────────

import { getDefaultApiBaseUrl } from "./auth";

const STORAGE_KEY = "quillby_connection";

export interface Connection {
  serverUrl: string; // e.g. "https://quillby.cloud" or "http://localhost:3000"
  apiKey: string;
}

function getApiBaseUrl(): string {
  return (getConnection()?.serverUrl ?? getDefaultApiBaseUrl()).replace(/\/$/, "");
}

export function getResolvedApiBaseUrl(): string {
  return getApiBaseUrl();
}

function getAuthHeaders(): HeadersInit {
  const conn = getConnection();
  if (!conn) return {};
  return { Authorization: `Bearer ${conn.apiKey}` };
}

async function callAppApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}: ${res.statusText}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // fall back to status text
    }
    throw new Error(message);
  }

  return (await res.json()) as T;
}

export function getConnection(): Connection | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Connection;
  } catch {
    return null;
  }
}

export function saveConnection(conn: Connection): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conn));
}

export function clearConnection(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface Workspace {
  id: string;
  name: string;
  createdAt?: string;
  isActive?: boolean;
}

export interface Card {
  id: string;
  title: string;
  source?: string;
  url?: string;
  score?: number;
  summary?: string;
  curationStatus?: "pending" | "approved" | "rejected" | "flagged";
  createdAt?: string;
  workspaceId?: string;
}

export interface Draft {
  id: string;
  format?: string;
  title?: string;
  content?: string;
  createdAt?: string;
  workspaceId?: string;
}

export interface PlanInfo {
  plan: string;
  mode: string;
  planEnforcementEnabled: boolean;
  limits?: Record<string, unknown>;
  billingPortalUrl?: string;
}

export interface ConnectorApiKey {
  id: string;
  name: string;
  prefix?: string | null;
  start?: string | null;
  enabled?: boolean;
  createdAt?: string;
  expiresAt?: string | null;
  rateLimitMax?: number | null;
  rateLimitTimeWindow?: number | null;
}

export async function ping(): Promise<string> {
  const res = await fetch(`${getApiBaseUrl()}/health`, {
    credentials: "include",
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { status: string; version?: string };
  return data.version ?? data.status;
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const result = await callAppApi<{
    workspaces?: Workspace[];
  }>("/api/app/workspaces");
  return result?.workspaces ?? [];
}

export async function selectWorkspace(workspaceId: string): Promise<void> {
  await callAppApi("/api/app/workspaces/select", {
    method: "POST",
    body: JSON.stringify({ workspaceId }),
  });
}

export async function listCards(
  workspaceId?: string,
  status?: string
): Promise<Card[]> {
  const params = new URLSearchParams();
  if (workspaceId) params.set("workspaceId", workspaceId);
  if (status && status !== "all") params.set("status", status);
  const result = await callAppApi<{
    cards?: Card[];
  }>(`/api/app/cards${params.size ? `?${params}` : ""}`);
  return result?.cards ?? [];
}

export async function curateCard(
  cardId: string,
  status: "approved" | "rejected" | "flagged",
  workspaceId?: string
): Promise<void> {
  await callAppApi("/api/app/cards/curate", {
    method: "POST",
    body: JSON.stringify({ cardId, status, workspaceId }),
  });
}

export async function listDrafts(workspaceId?: string): Promise<Draft[]> {
  const params = new URLSearchParams();
  if (workspaceId) params.set("workspaceId", workspaceId);
  const result = await callAppApi<{
    drafts?: Draft[];
  }>(`/api/app/drafts${params.size ? `?${params}` : ""}`);
  return result?.drafts ?? [];
}

export async function getPlan(): Promise<PlanInfo> {
  const result = await callAppApi<PlanInfo>("/api/app/plan");
  return result as PlanInfo;
}

export async function listConnectorApiKeys(): Promise<ConnectorApiKey[]> {
  const result = await callAppApi<{ keys?: ConnectorApiKey[] }>("/api/app/api-keys");
  return result.keys ?? [];
}

export async function createConnectorApiKey(name: string, rateLimitMax?: number): Promise<{ key: string; meta: ConnectorApiKey }> {
  return await callAppApi<{ key: string; meta: ConnectorApiKey }>("/api/app/api-keys", {
    method: "POST",
    body: JSON.stringify({ name, rateLimitMax }),
  });
}

export async function revokeConnectorApiKey(keyId: string): Promise<void> {
  await callAppApi("/api/app/api-keys", {
    method: "DELETE",
    body: JSON.stringify({ keyId }),
  });
}
