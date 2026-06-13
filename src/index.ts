/** Entry point: load config, open the store, wire the source, serve. */
import { loadConfig } from "./config.ts";
import { Store } from "./db.ts";
import { GoogleHealthSource } from "./sources/google/source.ts";
import { buildServer } from "./server.ts";

const cfg = loadConfig();
const store = new Store(cfg.dbPath);
const source = new GoogleHealthSource(cfg.google, store);
const app = buildServer(cfg, store, source);

if (!cfg.google.webhookAuthToken) {
  console.warn(
    "[boot] GOOGLE_WEBHOOK_AUTH_TOKEN is unset — /webhook is OPEN. Set it before exposing publicly.",
  );
}
if (cfg.subscribers.length === 0) {
  console.warn("[boot] no subscribers configured — wake events will go nowhere.");
}

console.log(
  `[boot] wakehook up on :${cfg.port} | source=${source.name} | subscribers=${cfg.subscribers.length} | tz=${cfg.inference.timezone}`,
);

export default { port: cfg.port, fetch: app.fetch };
