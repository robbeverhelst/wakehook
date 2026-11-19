// The two real mornings Robbe flagged (19 Nov: "how do u get only 4h of sleep?"), rebuilt from
// the Google Health v4 numbers Echo pulled afterwards. Times in UTC; Brussels is UTC+1 in November.
import { describe, expect, test } from "bun:test";
import { mapSession } from "../src/sources/google/source";
import { Engine } from "../src/engine";
import { Store } from "../src/db";
import { shouldPollNow } from "../src/scheduler";
import type { Config } from "../src/config";

const st = (type: string, a: string, b: string) => ({ type, startTime: a, endTime: b });
const dp = (name: string, start: string, end: string, stages: ReturnType<typeof st>[]) => ({
  name,
  sleep: { interval: { startTime: start, endTime: end }, type: "STAGES", stages },
});

// 18 Nov: in bed 19:58-07:09 local (18:58Z-06:09Z, 671 min). At fire time only the first
// stretch of stages had synced (229 min asleep); the final log has 546 min asleep, 125 awake.
const nov18Partial = dp("users/self/dataTypes/sleep/dataPoints/18", "2026-11-17T18:58:00Z", "2026-11-18T06:09:00Z", [
  st("AWAKE", "2026-11-17T18:58:00Z", "2026-11-17T20:20:00Z"),
  st("LIGHT", "2026-11-17T20:20:00Z", "2026-11-17T22:30:00Z"),
  st("DEEP", "2026-11-17T22:30:00Z", "2026-11-17T23:20:00Z"),
  st("REM", "2026-11-17T23:20:00Z", "2026-11-18T00:09:00Z"),
]);
const nov18Final = dp("users/self/dataTypes/sleep/dataPoints/18", "2026-11-17T18:58:00Z", "2026-11-18T06:09:00Z", [
  st("AWAKE", "2026-11-17T18:58:00Z", "2026-11-17T20:20:00Z"),
  st("LIGHT", "2026-11-17T20:20:00Z", "2026-11-18T01:00:00Z"),
  st("AWAKE", "2026-11-18T01:00:00Z", "2026-11-18T01:43:00Z"),
  st("DEEP", "2026-11-18T01:43:00Z", "2026-11-18T03:00:00Z"),
  st("REM", "2026-11-18T03:00:00Z", "2026-11-18T06:09:00Z"),
]);

// 19 Nov: the first log ended 03:19Z (04:19 local) and fired with 4h05; the real night was
// 23:41-06:57 local (22:41Z-05:57Z), 403 min asleep, 33 awake. A different dataPoint.
const nov19First = dp("users/self/dataTypes/sleep/dataPoints/190", "2026-11-18T22:41:00Z", "2026-11-19T03:19:00Z", [
  st("LIGHT", "2026-11-18T22:41:00Z", "2026-11-19T01:00:00Z"),
  st("AWAKE", "2026-11-19T01:00:00Z", "2026-11-19T01:13:00Z"),
  st("DEEP", "2026-11-19T01:13:00Z", "2026-11-19T03:19:00Z"),
]);
const nov19Final = dp("users/self/dataTypes/sleep/dataPoints/191", "2026-11-18T22:41:00Z", "2026-11-19T05:57:00Z", [
  st("LIGHT", "2026-11-18T22:41:00Z", "2026-11-19T01:00:00Z"),
  st("AWAKE", "2026-11-19T01:00:00Z", "2026-11-19T01:13:00Z"),
  st("DEEP", "2026-11-19T01:13:00Z", "2026-11-19T03:19:00Z"),
  st("AWAKE", "2026-11-19T03:19:00Z", "2026-11-19T03:39:00Z"),
  st("REM", "2026-11-19T03:39:00Z", "2026-11-19T05:57:00Z"),
]);

function cfg(): Config {
  return {
    port: 0,
    dbPath: ":memory:",
    source: "google-health",
    inference: {
      timezone: "Europe/Brussels",
      windowStart: "04:00",
      windowEnd: "11:00",
      minDurationMin: 180,
      supersedeGapMin: 45,
      correctionMin: 30,
      maxUpdates: 3,
      correctionMin: 30,
      maxUpdates: 3,
    },
    google: {
      clientId: "", clientSecret: "", redirectUri: "", webhookAuthToken: "", scopes: [],
      apiBase: "https://health.googleapis.com/v4",
      mode: "poll", pollIntervalMs: 300_000, pollLookbackMin: 720,
      pollWindowOnly: true, pollWindowMarginMin: 30,
    },
    subscribers: [{ id: "sink", url: "http://127.0.0.1:1/never" }],
  };
}

describe("partial Fitbit syncs", () => {
  test("18 Nov partial stages: in-bed minus known awake, not the partial stage sum", () => {
    const s = mapSession(nov18Partial, "self")!;
    expect(s.inBedMin).toBe(671);
    // the old rule gave 229 (3h49); now 671 - 82 known awake
    expect(s.durationMin).toBe(589);
  });

  test("18 Nov final stages: full coverage keeps the exact stage sum (9h06)", () => {
    expect(mapSession(nov18Final, "self")!.durationMin).toBe(546);
  });

  test("19 Nov final: 6h43 asleep", () => {
    expect(mapSession(nov19Final, "self")!.durationMin).toBe(403);
  });
});

describe("re-fire with corrected numbers", () => {
  const events: any[] = [];
  const realFetch = globalThis.fetch;
  const capture = () => {
    events.length = 0;
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      events.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 202 });
    }) as typeof fetch;
  };

  test("19 Nov: first log fires, the later longer log fires an update", async () => {
    capture();
    const store = new Store(":memory:");
    store.upsertToken({ user: "self", access_token: "a", refresh_token: "r", expires_at: 0 });
    let now = Date.parse("2026-11-19T03:19:30Z");
    const engine = new Engine(cfg(), store, () => now);
    expect(await engine.process([mapSession(nov19First, "self")!], "google-health")).toBe(1);
    // the poll keeps running after the fire, inside the morning window
    now = Date.parse("2026-11-19T06:05:00Z");
    expect(shouldPollNow(cfg(), store, () => now)).toBe(true);
    // the next poll returns both logs; the full one wins, the old one skips
    expect(
      await engine.process([mapSession(nov19First, "self")!, mapSession(nov19Final, "self")!], "google-health"),
    ).toBe(1);
    globalThis.fetch = realFetch;
    expect(events.map((e) => e.kind)).toEqual(["wake", "update"]);
    expect(events[1].session.durationMin).toBe(403);
    expect(events[1].update).toBe(1);
  });

  test("18 Nov: same log, stages complete later -> one correction update", async () => {
    capture();
    const store = new Store(":memory:");
    let now = Date.parse("2026-11-18T06:10:00Z");
    const engine = new Engine(cfg(), store, () => now);
    expect(await engine.process([mapSession(nov18Partial, "self")!], "google-health")).toBe(1);
    now = Date.parse("2026-11-18T07:00:00Z");
    expect(await engine.process([mapSession(nov18Final, "self")!], "google-health")).toBe(1);
    // nothing new after that
    expect(await engine.process([mapSession(nov18Final, "self")!], "google-health")).toBe(0);
    globalThis.fetch = realFetch;
    expect(events.map((e) => [e.kind, e.session.durationMin])).toEqual([
      ["wake", 589],
      ["update", 546],
    ]);
  });

  test("updates stop at maxUpdates and the poll then stops", async () => {
    capture();
    const store = new Store(":memory:");
    store.upsertToken({ user: "self", access_token: "a", refresh_token: "r", expires_at: 0 });
    const c = cfg();
    c.inference.maxUpdates = 1;
    let now = Date.parse("2026-11-19T03:19:30Z");
    const engine = new Engine(c, store, () => now);
    await engine.process([mapSession(nov19First, "self")!], "google-health");
    now = Date.parse("2026-11-19T06:05:00Z");
    await engine.process([mapSession(nov19Final, "self")!], "google-health");
    globalThis.fetch = realFetch;
    expect(shouldPollNow(c, store, () => now)).toBe(false);
  });
});

test("wake events carry top-level kind and update: 0", async () => {
  const { toWakeEvent } = await import("../src/subscribers/fanout");
  const e = toWakeEvent({ user: "self", start: "a", end: "b", durationMin: 400 }, "google-health");
  expect(e.kind).toBe("wake");
  expect(e.update).toBe(0);
});
