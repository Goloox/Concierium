import bcrypt from "bcryptjs";
import { Client } from "pg";

/**
 * Utilidad: limpiar/normalizar
 */
function cleanEmail(s) {
  return String(s || "").trim().toLowerCase();
}
function cleanStr(s) {
  return String(s || "").trim();
}
function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
function isTel(s) {
  if (!s) return true; // opcional
  return /^[0-9+()\-\s]{7,20}$/.test(s);
}

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
    body: JSON.stringify(body)
  };
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method Not Allowed" });
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { ok: false, error: "Invalid JSON" });
  }

  const full_name = cleanStr(payload.full_name);
  const email = cleanEmail(payload.email);
  const password = String(payload.password || "");
  const phone = cleanStr(payload.phone || "");
  const preferred_lang = (payload.preferred_lang === "en") ? "en" : "es";

  // Validaciones
  if (full_name.length < 3) return json(400, { ok: false, error: "Nombre muy corto" });
  if (!isEmail(email)) return json(400, { ok: false, error: "Email inválido" });
  if (password.length < 6) return json(400, { ok: false, error: "Contraseña muy corta (mín. 6)" });
  if (!isTel(phone)) return json(400, { ok: false, error: "Teléfono inválido" });

  // Hash
  const password_hash = await bcrypt.hash(password, 10);

  // ¿Hay DB configurada?
  const hasDB = !!(process.env.PGHOST && process.env.PGUSER && process.env.PGPASSWORD && process.env.PGDATABASE);

  if (!hasDB) {
    // MODO DEMO (sin DB)
    const user = {
      id: "demo_" + Math.random().toString(36).slice(2, 8),
      full_name,
      email,
      phone: phone || null,
      preferred_lang
    };
    return json(200, { ok: true, user, demo: true });
  }

  // Conexión a Postgres
  const client = new Client({
    host: process.env.PGHOST,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    port: +(process.env.PGPORT || 5432),
    ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined
  });

  try {
    await client.connect();

    // Asegurar tabla (simple y útil para primeras pruebas)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        phone TEXT,
        preferred_lang TEXT NOT NULL DEFAULT 'es',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // Si tu Postgres no tiene la extensión pgcrypto para gen_random_uuid():
    // await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto;");

    // Insertar
    const insert = await client.query(
      `INSERT INTO users (full_name, email, password_hash, phone, preferred_lang)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, full_name, email, phone, preferred_lang, created_at`,
      [full_name, email, password_hash, phone || null, preferred_lang]
    );

    const user = insert.rows[0];
    return json(200, { ok: true, user });

  } catch (e) {
    // Conflicto por email duplicado
    if ((e?.code === "23505") || /duplicate key/i.test(String(e?.message))) {
      return json(409, { ok: false, error: "Este correo ya está registrado" });
    }
    return json(500, { ok: false, error: "Error interno" });
  } finally {
    try { await client.end(); } catch {}
  }
}
