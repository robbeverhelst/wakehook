/**
 * Broadcast a WakeEvent to every configured subscriber. Each delivery is
 * independent, signed with that subscriber's secret, and retried a few times.
 * One slow/failing subscriber never blocks the others.
 */
import { createHmac } from "node:crypto";
import type { Subscriber, WakeEvent } from "../types.ts";
import type { Store } from "../db.ts";

const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 500;

function sign(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

/** Shape the outgoing request body per the subscriber's preset. */
function buildBody(event: WakeEvent, sub: Subscriber): string {
  if (sub.preset === "openclaw") {
    const t = new Date(event.wokeAt);
    const hh = String(t.getHours()).padStart(2, "0");
    const mm = String(t.getMinutes()).padStart(2, "0");
    const dur = `${Math.floor(event.session.durationMin / 60)}h${event.session.durationMin % 60}m`;
    // A factual nudge — OpenClaw decides what to do with it.
    return JSON.stringify({ text: `You woke at ${hh}:${mm} (slept ${dur}).`, mode: "now" });
  }
  // generic: the vendor-neutral signed contract anything can consume.
  return JSON.stringify(event);
}

async function deliverOne(
  event: WakeEvent,
  eventId: string,
  sub: Subscriber,
  store: Store,
  now: () => number,
): Promise<boolean> {
  const body = buildBody(event, sub);
  const signature = sign(body, sub.secret);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(sub.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Wake-Signature": signature,
          "X-Wake-Event-Id": eventId,
          // OpenClaw's /hooks/wake expects a bearer token; the secret doubles as it.
          ...(sub.preset === "openclaw"
            ? { Authorization: `Bearer ${sub.secret}` }
            : {}),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        store.recordDelivery(eventId, sub.id, "ok", attempt, now());
        console.log(`[fanout] ${sub.id} ✓ (${res.status}, attempt ${attempt})`);
        return true;
      }
      console.warn(`[fanout] ${sub.id} non-2xx ${res.status} (attempt ${attempt})`);
    } catch (err) {
      console.warn(`[fanout] ${sub.id} error (attempt ${attempt}): ${String(err)}`);
    }
    if (attempt < MAX_ATTEMPTS) {
      await Bun.sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
    }
  }
  store.recordDelivery(eventId, sub.id, "failed", MAX_ATTEMPTS, now());
  return false;
}

export async function fanout(
  event: WakeEvent,
  subscribers: Subscriber[],
  store: Store,
  now: () => number = Date.now,
): Promise<{ delivered: number; failed: number }> {
  const eventId = `${event.user}:${event.wokeAt}`;
  if (subscribers.length === 0) {
    console.warn("[fanout] no subscribers configured — event not delivered anywhere");
    return { delivered: 0, failed: 0 };
  }
  const results = await Promise.all(
    subscribers.map((s) => deliverOne(event, eventId, s, store, now)),
  );
  const delivered = results.filter(Boolean).length;
  return { delivered, failed: results.length - delivered };
}

export function toWakeEvent(
  session: { user: string; start: string; end: string; durationMin: number },
  source: string,
): WakeEvent {
  return {
    event: "user.awake",
    wokeAt: session.end,
    user: session.user,
    source,
    session: {
      start: session.start,
      end: session.end,
      durationMin: session.durationMin,
    },
  };
}
