/**
 * Tiny persistence over bun:sqlite. Holds OAuth tokens, per-user dedup state,
 * and per-subscriber delivery tracking. No external DB required — runs anywhere.
 */
import { Database } from "bun:sqlite";

export interface TokenRow {
  user: string;
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

export interface WakeStateRow {
  user: string;
  fired_date: string; // local YYYY-MM-DD
  last_fired_end: string; // ISO of the session end we last fired on
  last_fired_duration?: number | null; // asleep minutes we last reported
  updates?: number | null; // update events sent this morning
}

export class Store {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        user TEXT PRIMARY KEY,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS wake_state (
        user TEXT PRIMARY KEY,
        fired_date TEXT NOT NULL,
        last_fired_end TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS delivery (
        event_id TEXT NOT NULL,
        subscriber TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (event_id, subscriber)
      );
    `);
    // Added 19 Nov (update events): older databases get the columns on start.
    for (const col of ["last_fired_duration INTEGER", "updates INTEGER NOT NULL DEFAULT 0"]) {
      try {
        this.db.exec(`ALTER TABLE wake_state ADD COLUMN ${col}`);
      } catch {
        // already there
      }
    }
  }

  // --- tokens -------------------------------------------------------------
  getToken(user: string): TokenRow | null {
    return this.db
      .query<TokenRow, [string]>("SELECT * FROM oauth_tokens WHERE user = ?")
      .get(user);
  }

  /** The single-user convenience: return the only stored token, if exactly one. */
  getSoleToken(): TokenRow | null {
    const rows = this.db.query<TokenRow, []>("SELECT * FROM oauth_tokens").all();
    return rows.length === 1 ? rows[0]! : null;
  }

  upsertToken(row: TokenRow): void {
    this.db
      .query(
        `INSERT INTO oauth_tokens (user, access_token, refresh_token, expires_at)
         VALUES ($user, $access, $refresh, $exp)
         ON CONFLICT(user) DO UPDATE SET
           access_token = $access, refresh_token = $refresh, expires_at = $exp`,
      )
      .run({
        $user: row.user,
        $access: row.access_token,
        $refresh: row.refresh_token,
        $exp: row.expires_at,
      });
  }

  // --- wake dedup state ---------------------------------------------------
  getWakeState(user: string): WakeStateRow | null {
    return this.db
      .query<WakeStateRow, [string]>("SELECT * FROM wake_state WHERE user = ?")
      .get(user);
  }

  setWakeState(row: WakeStateRow): void {
    this.db
      .query(
        `INSERT INTO wake_state (user, fired_date, last_fired_end, last_fired_duration, updates)
         VALUES ($user, $date, $end, $dur, $upd)
         ON CONFLICT(user) DO UPDATE SET
           fired_date = $date, last_fired_end = $end, last_fired_duration = $dur, updates = $upd`,
      )
      .run({
        $user: row.user,
        $date: row.fired_date,
        $end: row.last_fired_end,
        $dur: row.last_fired_duration ?? null,
        $upd: row.updates ?? 0,
      });
  }

  // --- delivery tracking --------------------------------------------------
  recordDelivery(
    eventId: string,
    subscriber: string,
    status: "ok" | "failed",
    attempts: number,
    now: number,
  ): void {
    this.db
      .query(
        `INSERT INTO delivery (event_id, subscriber, status, attempts, updated_at)
         VALUES ($e, $s, $st, $a, $u)
         ON CONFLICT(event_id, subscriber) DO UPDATE SET
           status = $st, attempts = $a, updated_at = $u`,
      )
      .run({ $e: eventId, $s: subscriber, $st: status, $a: attempts, $u: now });
  }
}
