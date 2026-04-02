import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDeploymentMode } from "@quillby/config";
import { hostedUserState, type QuillbyDb } from "@quillby/database";

export type HostedPlan = "free" | "pro";

export type PlanLimits = {
  maxOwnedWorkspaces: number | null;
  maxDraftsPerWorkspace: number | null;
  harvestCooldownMs: number | null;
};

export const PLAN_LIMITS: Record<HostedPlan, PlanLimits> = {
  free: {
    maxOwnedWorkspaces: 3,
    maxDraftsPerWorkspace: 20,
    harvestCooldownMs: 30 * 60 * 1000,
  },
  pro: {
    maxOwnedWorkspaces: null,
    maxDraftsPerWorkspace: null,
    harvestCooldownMs: null,
  },
};

export function isCloudMode(): boolean {
  return getDeploymentMode() === "cloud";
}

export function isPlanEnforcementEnabled(): boolean {
  if (!isCloudMode()) return false;
  const raw = (process.env.QUILLBY_ENFORCE_PLAN_LIMITS ?? "").trim().toLowerCase();
  if (!raw) return true;
  return raw === "1" || raw === "true" || raw === "yes";
}

export function getBillingPortalUrl(): string | null {
  if (!isCloudMode()) return null;
  const url = process.env.QUILLBY_CLOUD_BILLING_PORTAL_URL?.trim();
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export type BillingAction = "upgrade" | "downgrade" | "manage";

function withQuery(baseUrl: string, query: Record<string, string>): string {
  const url = new URL(baseUrl);
  for (const [k, v] of Object.entries(query)) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

export function getCheckoutUrlForPlan(plan: HostedPlan, userId?: string): string | null {
  if (!isCloudMode()) return null;
  const key = plan === "pro" ? "QUILLBY_STRIPE_CHECKOUT_URL_PRO" : "QUILLBY_STRIPE_CHECKOUT_URL_FREE";
  const raw = process.env[key]?.trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return null;
  return withQuery(raw, userId
    ? { quillbyUserId: userId, plan }
    : { plan });
}

export function getBillingActionUrl(action: BillingAction, currentPlan: HostedPlan, userId?: string): string | null {
  if (!isCloudMode()) return null;
  if (action === "upgrade") {
    return getCheckoutUrlForPlan("pro", userId);
  }
  const portal = getBillingPortalUrl();
  if (!portal) return null;
  return withQuery(portal, userId
    ? { quillbyUserId: userId, action, plan: currentPlan }
    : { action, plan: currentPlan });
}

export function getPlanLimits(plan: HostedPlan): PlanLimits {
  return PLAN_LIMITS[plan];
}

function parseStripeSignature(header: string): { timestamp: string; v1: string } | null {
  const parts = header.split(",").map((p) => p.trim());
  const t = parts.find((p) => p.startsWith("t="))?.slice(2);
  const v1 = parts.find((p) => p.startsWith("v1="))?.slice(3);
  if (!t || !v1) return null;
  return { timestamp: t, v1 };
}

export function verifyStripeWebhookSignature(rawBody: string, signatureHeader: string): boolean {
  const secret = process.env.QUILLBY_STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) return false;
  const parsed = parseStripeSignature(signatureHeader);
  if (!parsed) return false;
  const payload = `${parsed.timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(parsed.v1));
  } catch {
    return false;
  }
}

type StripeEvent = {
  type?: string;
  data?: {
    object?: {
      metadata?: Record<string, string | undefined>;
      client_reference_id?: string;
      items?: { data?: Array<{ price?: { id?: string } }> };
      plan?: { id?: string };
      status?: string;
      cancel_at_period_end?: boolean;
    };
  };
};

function resolveStripeUserId(event: StripeEvent): string | null {
  const obj = event.data?.object;
  const md = obj?.metadata ?? {};
  return (
    md.quillbyUserId ??
    md.userId ??
    obj?.client_reference_id ??
    null
  );
}

function resolvePlanFromStripeEvent(event: StripeEvent): HostedPlan | null {
  const type = event.type ?? "";
  const obj = event.data?.object;
  if (type === "customer.subscription.deleted") return "free";
  if (obj?.status === "canceled") return "free";
  if (obj?.cancel_at_period_end && type === "customer.subscription.updated") return "free";

  const proPriceId = process.env.QUILLBY_STRIPE_PRO_PRICE_ID?.trim();
  const mdPlan = obj?.metadata?.plan?.toLowerCase();
  if (mdPlan === "pro") return "pro";
  if (mdPlan === "free") return "free";

  const itemPrices = obj?.items?.data?.map((i) => i.price?.id).filter(Boolean) as string[] | undefined;
  const planPrice = obj?.plan?.id;
  const isProByPrice = Boolean(
    proPriceId && (itemPrices?.includes(proPriceId) || planPrice === proPriceId)
  );
  if (isProByPrice) return "pro";

  if (
    type === "checkout.session.completed" ||
    type === "customer.subscription.created" ||
    type === "customer.subscription.updated"
  ) {
    return "free";
  }

  return null;
}

export async function applyStripeWebhookEvent(db: QuillbyDb, event: StripeEvent): Promise<{
  handled: boolean;
  updated: boolean;
  userId?: string;
  plan?: HostedPlan;
}> {
  if (!isCloudMode()) return { handled: false, updated: false };
  const type = event.type ?? "";
  const supported = new Set([
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
  ]);
  if (!supported.has(type)) return { handled: false, updated: false };

  const userId = resolveStripeUserId(event);
  const plan = resolvePlanFromStripeEvent(event);
  if (!userId || !plan) return { handled: true, updated: false };

  const existing = await db
    .select({ userId: hostedUserState.userId })
    .from(hostedUserState)
    .where(eq(hostedUserState.userId, userId))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(hostedUserState).values({
      userId,
      currentWorkspaceId: "default",
      plan,
      updatedAt: new Date(),
    });
  } else {
    await db
      .update(hostedUserState)
      .set({ plan, updatedAt: new Date() })
      .where(eq(hostedUserState.userId, userId));
  }

  return { handled: true, updated: true, userId, plan };
}
