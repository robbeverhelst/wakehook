/**
 * 12-factor config: a single JSON file (CONFIG_PATH, default ./config.json) with
 * env-var overrides for secrets. Nothing about host/ingress is configured here —
 * exposure is the operator's concern (Cloudflare Tunnel, reverse proxy, …).
 */
import { existsSync, readFileSync } from "node:fs";
import type { Subscriber } from "./types.ts";

export interface InferenceConfig {
  /** IANA timezone used to evaluate "today" and the morning window. */
  timezone: string;
  /** Morning window (local 24h "HH:MM"); a main-sleep ending inside it can fire. */
  windowStart: string; // e.g. "04:00"
  windowEnd: string; // e.g. "11:00"
  /** Minimum main-sleep length (minutes) to qualify; weak guard vs split logs. */
  minDurationMin: number;
  /** If a later main-sleep ends > this many minutes after one we already fired
   *  on, re-fire once (heals Fitbit split-night logs). */
  supersedeGapMin: number;
}

export interface GoogleHealthConfig {
  clientId: string;
  clientSecret: string;
  /** Redirect URI registered in Google Cloud, used by the one-time auth CLI. */
  redirectUri: string;
  /** Shared token the provider must present on webhook calls (Authorization). */
  webhookAuthToken: string;
  scopes: string[];
}

export interface Config {
  port: number;
  dbPath: string;
  /** Which registered Source to run (see src/sources/registry.ts). */
  source: string;
  inference: InferenceConfig;
  google: GoogleHealthConfig;
  subscribers: Subscriber[];
}

const DEFAULTS = {
  port: 8080,
  dbPath: "./wake.sqlite",
  inference: {
    timezone: "Europe/Brussels",
    windowStart: "04:00",
    windowEnd: "11:00",
    minDurationMin: 180,
    supersedeGapMin: 45,
  } satisfies InferenceConfig,
};

function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export function loadConfig(): Config {
  const path = env("CONFIG_PATH", "./config.json");
  const file: Partial<Config> = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : {};

  const google: GoogleHealthConfig = {
    clientId: env("GOOGLE_CLIENT_ID", file.google?.clientId ?? ""),
    clientSecret: env("GOOGLE_CLIENT_SECRET", file.google?.clientSecret ?? ""),
    redirectUri: env(
      "GOOGLE_REDIRECT_URI",
      file.google?.redirectUri ?? "http://localhost:8080/oauth/callback",
    ),
    webhookAuthToken: env(
      "GOOGLE_WEBHOOK_AUTH_TOKEN",
      file.google?.webhookAuthToken ?? "",
    ),
    scopes: file.google?.scopes ?? [
      "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
    ],
  };

  return {
    port: Number(env("PORT", String(file.port ?? DEFAULTS.port))),
    dbPath: env("DB_PATH", file.dbPath ?? DEFAULTS.dbPath),
    source: env("SOURCE", file.source ?? "google-health"),
    inference: { ...DEFAULTS.inference, ...(file.inference ?? {}) },
    google,
    subscribers: file.subscribers ?? [],
  };
}
