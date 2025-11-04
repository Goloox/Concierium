import { Pool } from "pg";

let _pool;
export function db() {
  if (_pool) return _pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL missing");
  _pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }, // Neon
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  _pool.on("connect", async (client) => {
    await client.query(`
      SET application_name = 'concierium-admin';
      SET search_path TO concierium, public;
      SET statement_timeout = 15000;
    `);
  });
  return _pool;
}

export function json(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

export async function safeHandler(fn) {
  try { return await fn(); }
  catch (err) {
    console.error(err);
    return json(200, { ok: false, error: err.message || "Server error" });
  }
}
