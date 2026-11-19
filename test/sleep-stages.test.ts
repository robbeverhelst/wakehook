import { expect, test } from "bun:test";
import { mapSession } from "../src/sources/google/source";

const st = (type: string, a: string, b: string) => ({ type, startTime: a, endTime: b });

test("durationMin counts only asleep stages; inBedMin keeps the window", () => {
  const s = mapSession(
    {
      name: "users/x/dataTypes/sleep/dataPoints/1",
      sleep: {
        interval: { startTime: "2026-11-03T19:26:00Z", endTime: "2026-11-04T03:24:00Z" },
        stages: [
          st("AWAKE", "2026-11-03T19:26:00Z", "2026-11-03T21:00:00Z"),
          st("LIGHT", "2026-11-03T21:00:00Z", "2026-11-04T01:00:00Z"),
          st("DEEP", "2026-11-04T01:00:00Z", "2026-11-04T02:00:00Z"),
          st("REM", "2026-11-04T02:00:00Z", "2026-11-04T03:24:00Z"),
        ],
      },
    },
    "self",
  );
  expect(s?.inBedMin).toBe(478);
  expect(s?.durationMin).toBe(384);
  expect(s?.isMainSleep).toBe(true);
});

test("no stages falls back to the window", () => {
  const s = mapSession(
    { sleep: { interval: { startTime: "2026-11-03T22:00:00Z", endTime: "2026-11-04T05:00:00Z" } } },
    "self",
  );
  expect(s?.durationMin).toBe(420);
});
