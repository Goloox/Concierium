// CommonJS helpers reutilizables
const { Client } = require("pg");
const jwt = require("jsonwebtoken");

const SCHEMA = process.env.DB_SCHEMA || "concierium";

function pgClient() {
  if (process.env.DATABASE_URL) {
    return new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return new Client({
    host: process.env.PGHOST,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    port: +(process.env.PGPORT || 5432),
    ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
}

function ok(body) {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}
function err(status, body) {
  return {
    statusCode: status,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

function getAuth(event) {
  try {
    const h = event.headers || {};
    const raw = h.authorization || h.Authorization || "";
    if (!raw.startsWith("Bearer ")) return null;
    return jwt.verify(raw.slice(7), process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

function requireAdmin(event) {
  if (!process.env.JWT_SECRET) {
    return { error: err(500, { ok: false, error: "Falta JWT_SECRET" }) };
  }
  const auth = getAuth(event);
  if (!auth?.sub) return { error: err(401, { ok: false, error: "No autorizado" }) };
  const role = String(auth.role || "").toLowerCase();
  if (!(role === "admin" || role === "superadmin")) {
    return { error: err(403, { ok: false, error: "Solo administradores" }) };
  }
  return { auth };
}

module.exports = { SCHEMA, pgClient, ok, err, requireAdmin };
