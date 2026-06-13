/**
 * GoogleHealthSource — bridges the Google Health API to normalized SleepSessions.
 *
 * Webhook notification shape (per docs): a JSON body describing which user's data
 * changed and over what time interval(s):
 *   { "operation": "UPSERT" | "DELETE",
 *     "healthUserId": "abc",
 *     "dataType": "sleep",
 *     "intervals": [ { "startTime": "...", "endTime": "..." } ] }
 *
 * The webhook only says data CHANGED — so on UPSERT we fetch the actual sleep
 * session(s) in those intervals and normalize them.
 *
 * The exact REST response field names for the new Google Health API should be
 * confirmed against the live API; the mapping is isolated in `mapSession()` so it
 * is the single place to adjust. Until verified, fetching is feature-flagged off
 * via `cfg` having no token, and /test/replay lets you exercise everything else.
 */
import type { GoogleHealthConfig } from "../../config.ts";
import type { Store } from "../../db.ts";
import type { SleepSession, Source, WebhookCapability } from "../../types.ts";
import { getValidAccessToken } from "./oauth.ts";

const API_BASE = "https://health.googleapis.com/v1";

interface Notification {
  operation?: string;
  healthUserId?: string;
  dataType?: string;
  intervals?: Array<{ startTime?: string; endTime?: string }>;
}

export class GoogleHealthSource implements Source {
  readonly name = "google-health";

  /** Google Health is a push provider — it delivers via the inbound webhook. */
  readonly webhook: WebhookCapability = {
    handleChallenge: (req) => this.handleChallenge(req),
    sessionsFromNotification: (req, body) => this.sessionsFromNotification(req, body),
  };

  constructor(
    private cfg: GoogleHealthConfig,
    private store: Store,
    private now: () => number = Date.now,
  ) {}

  private async handleChallenge(req: Request): Promise<Response | null> {
    // Some webhook setups send an echo challenge (query or body). Echo it back.
    const url = new URL(req.url);
    const q = url.searchParams.get("challenge") ?? url.searchParams.get("hub.challenge");
    if (q) return new Response(q, { status: 200 });
    return null;
  }

  private async sessionsFromNotification(_req: Request, rawBody: string): Promise<SleepSession[]> {
    let note: Notification;
    try {
      note = JSON.parse(rawBody) as Notification;
    } catch {
      return [];
    }

    if (note.operation !== "UPSERT") return []; // ignore DELETE / unknown
    if (note.dataType && !note.dataType.toLowerCase().includes("sleep")) return [];
    const user = note.healthUserId;
    if (!user) return [];

    const token = await getValidAccessToken(this.cfg, this.store, user, this.now);
    const out: SleepSession[] = [];
    for (const interval of note.intervals ?? []) {
      const fetched = await this.fetchSleep(token, user, interval.startTime, interval.endTime);
      out.push(...fetched);
    }
    return out;
  }

  private async fetchSleep(
    token: string,
    user: string,
    startTime?: string,
    endTime?: string,
  ): Promise<SleepSession[]> {
    const p = new URLSearchParams();
    if (startTime) p.set("startTime", startTime);
    if (endTime) p.set("endTime", endTime);
    const res = await fetch(`${API_BASE}/sleep:read?${p.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.warn(`[google-health] sleep read ${res.status}: ${await res.text()}`);
      return [];
    }
    const data = (await res.json()) as { sessions?: unknown[] };
    return (data.sessions ?? [])
      .map((s) => mapSession(s, user))
      .filter((s): s is SleepSession => s !== null);
  }
}

/**
 * Single source of truth for vendor→domain field mapping. Adjust here once the
 * live Google Health sleep response is confirmed.
 */
function mapSession(raw: unknown, user: string): SleepSession | null {
  const s = raw as Record<string, any>;
  const start: string | undefined = s.startTime ?? s.start ?? s.startDate;
  const end: string | undefined = s.endTime ?? s.end ?? s.endDate;
  if (!start || !end) return null;
  const durationMin = Math.round(
    (new Date(end).getTime() - new Date(start).getTime()) / 60000,
  );
  // Google represents naps vs main sleep via a type/flag; treat anything not
  // explicitly a nap as main sleep, and honor an explicit isMainSleep if present.
  const isMainSleep =
    s.isMainSleep ?? (typeof s.type === "string" ? s.type.toLowerCase() !== "nap" : true);
  return {
    id: String(s.id ?? s.name ?? `${user}:${start}`),
    user,
    start,
    end,
    durationMin,
    isMainSleep: Boolean(isMainSleep),
  };
}
