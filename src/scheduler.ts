/**
 * Drives a poll-based Source: periodically calls poll.run() and feeds any
 * sessions into the engine. No-op for push-only sources. Ticks never overlap.
 */
import type { Engine } from "./engine.ts";
import type { Source } from "./types.ts";

export function startPolling(source: Source, engine: Engine): { stop: () => void } | null {
  const poll = source.poll;
  if (!poll) return null;

  let running = false;
  const tick = async () => {
    if (running) return; // skip if the previous tick is still in flight
    running = true;
    try {
      const sessions = await poll.run();
      if (sessions.length) await engine.process(sessions, source.name);
    } catch (err) {
      console.error(`[poll] ${source.name} error: ${String(err)}`);
    } finally {
      running = false;
    }
  };

  const handle = setInterval(tick, poll.intervalMs);
  console.log(`[poll] polling ${source.name} every ${poll.intervalMs}ms`);
  void tick(); // run once immediately on boot
  return { stop: () => clearInterval(handle) };
}
