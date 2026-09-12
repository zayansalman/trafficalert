import { createClient, type Client } from "@libsql/client";

let client: Client | undefined;

export function getDb(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) throw new Error("TURSO_DATABASE_URL is not set");

    client = createClient({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

let initialized: Promise<void> | undefined;

export function ensureSchema(): Promise<void> {
  if (!initialized) {
    initialized = getDb()
      .execute(
        `CREATE TABLE IF NOT EXISTS user_reports (
          id          TEXT PRIMARY KEY,
          location    TEXT NOT NULL,
          severity    TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
          description TEXT NOT NULL,
          timestamp   TEXT NOT NULL,
          session_id  TEXT NOT NULL
        )`,
      )
      .then(() => {});
  }
  return initialized;
}
