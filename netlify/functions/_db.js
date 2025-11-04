// Conexion pool singleton para Neon (pg)
import { Pool } from "pg";

let _pool;
export function db() {
  if (_pool) return _pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL missing");
  _pool = new Pool({
    connectionString,
    // Neon requiere SSL
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: false,
  });
  // sane defaults por sesión
  _pool.on("connect", async (client) => {
    await client.query(`
      SET application_name = 'concierium-admin';
      SET search_path TO concierium, public;
      SET statement_timeout = 15000;
    `);
  });
  return _pool;
}

// helper para respuestas JSON consistentes (evita 502 por body no JSON)
export function json(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

// wrapper seguro
export async function safeHandler(fn) {
  try {
    const res = await fn();
    return res;
  } catch (err) {
    console.error(err);
    return json(200, { ok: false, error: err.message || "Server error" });
  }
}
