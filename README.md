# wakehook

A small, **vendor-neutral "wake detection" webhook bus** — a webhook that fires when you wake up.

It subscribes to a health data provider (today: the **Google Health API**, which powers
Fitbit devices), works out when its person actually **woke up**, and **fans out** a clean,
signed `user.awake` event to *every* subscriber you configure.

It is **not built for any one consumer.** [OpenClaw](https://docs.openclaw.ai) is just one
subscriber — alongside Home Assistant, n8n, a smart lamp, or your own script.

> The bus states a **fact** ("this person woke at 07:03") and broadcasts it.
> Each subscriber decides its own **behavior**. The bus knows nothing about their purpose.

See [`DESIGN.md`](./DESIGN.md) for the full rationale and decision log.

## Why it has to exist

You can't point Google Health's webhook straight at OpenClaw (or anything else):

1. **Semantics** — Google's webhook means *"sleep data changed,"* which also fires for naps,
   mid-night syncs, and edits. It is **not** "you woke up." Something must fetch the session
   and *infer* the wake.
2. **Payload** — Google speaks `{operation, healthUserId, intervals}`; consumers speak their
   own shapes.
3. **Handshake** — Google requires an ownership-verification challenge and a `204` ack with
   7-day retries.

This service is the translator that closes the gap — generically, so anything can subscribe.

## How it works

```
you wake → (phone syncs) → Google Health cloud ──POST──▶ /webhook
   └─ ack 204 → fetch session → infer wake → dedup ──▶ fan out signed user.awake
                                                         ├─▶ OpenClaw   → runs a workflow
                                                         ├─▶ Home Assistant → lamp on
                                                         └─▶ any URL    → its own behavior
```

The wake rule (all thresholds configurable): fire when a session is the **main** sleep,
**ends today** inside a **morning window**, is **long enough**, and we **haven't already
fired today** — with a **supersede** re-fire to heal Fitbit's rare split-night logs.
Tuned to two priorities: **never miss a wakeup**, and **fire as fast as the data arrives**.

> Latency floor is your phone syncing to Fitbit's cloud (open the Fitbit app to force it);
> the bus itself adds ~zero delay.

## The event subscribers receive

```http
POST <subscriber-url>
X-Wake-Signature: sha256=<hmac of body with the subscriber's secret>
X-Wake-Event-Id: <user>:<wokeAt>

{ "event": "user.awake", "wokeAt": "2026-06-14T07:03:00+02:00",
  "user": "<healthUserId>", "source": "google-health",
  "session": { "start": "...", "end": "...", "durationMin": 431 } }
```

`generic` subscribers get exactly this. `openclaw` subscribers instead get a factual nudge
(`POST /hooks/wake { "text": "You woke at 07:03 (slept 7h11m).", "mode": "now" }`) — OpenClaw
then decides what to run.

## Quick start

```bash
bun install
cp config.example.json config.json     # edit subscribers + tz; secrets can go in env
cp .env.example .env                    # GOOGLE_CLIENT_ID / SECRET / WEBHOOK_AUTH_TOKEN

# One-time Google authorization (mints the refresh token):
bun run auth

# Run the bus:
bun run dev        # or: bun run start  /  docker build -t wake . && docker run ...
```

Then expose `/webhook` publicly (Cloudflare Tunnel, reverse proxy, VPS — your choice; the
service bakes in no ingress) and create a Google Health **sleep** webhook subscription
pointing at it.

### Test the subscriber side without waiting for morning

```bash
curl -X POST http://localhost:8080/test/replay \
  -H "Authorization: Bearer $GOOGLE_WEBHOOK_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{}'   # fires a synthetic wake "now"; pass {"end":"...","durationMin":420} to control it
```

## Google setup notes

- Create a Google Cloud project, enable the Health API, configure the OAuth consent screen,
  add yourself as a test user. Scope: `googlehealth.sleep.readonly`.
- **Publish the app to "In Production"** (still unverified, 100-user cap — fine for personal
  use) so the refresh token doesn't expire after 7 days (the "Testing" default).

## Extending

Google Health is just the first `Source`. The core (inference, dedup, fan-out) is
provider-agnostic, so adding a provider touches **no core code**:

1. Implement the `Source` interface (`src/types.ts`) under `src/sources/<name>/`.
   A source declares one or both **capabilities**:
   - `webhook` (push) — the provider POSTs to `/webhook`
     (Google Health, Fitbit Web, WHOOP, Withings, Oura, Sleep as Android…).
   - `poll` (pull) — wakehook polls it on a timer
     (on-device Health Connect bridge, Open Wearables, plain REST APIs…).
2. Register it with one line in `src/sources/registry.ts`.
3. Select it via `"source": "<name>"` in config.

The server mounts `/webhook` only for push sources; the scheduler drives poll sources.
No new providers ship today, but the interface is ready for both kinds.

**New subscriber shape**: add a `preset` branch in `src/subscribers/fanout.ts`.

## Status

v1: Google Health source + inference + fan-out + OpenClaw/generic presets. Core logic is unit
tested (`bun test`). The Google sleep-response field mapping (`mapSession`) is isolated so it
can be confirmed against the live API in one place.

## License

MIT
