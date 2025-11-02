import { Client } from "pg";

/** Utilidades simples */
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const telRe   = /^[0-9+()\-\s]{7,20}$/;

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
    body: JSON.stringify(body),
  };
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method Not Allowed" });
  }

  // Verifica variables de entorno necesarias para conectar
  const need = ["PGHOST", "PGUSER", "PGPASSWORD", "PGDATABASE"];
  const missing = need.filter((k) => !process.env[k]);
  if (missing.length) {
    return json(500, { ok: false, error: `DB env missing: ${missing.join(", ")}` });
  }

  // Parseo de payload
  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { ok: false, error: "Invalid JSON" });
  }

  // Limpieza/validación (sin tocar el esquema)
  const full_name = String(payload.full_name || "").trim();
  const email = String(payload.email || "").trim().toLowerCase();
  const password = String(payload.password || "");          // NO se almacena (no hay columna). Solo validación mínima.
  const phone = String(payload.phone || "").trim();
  const preferred = payload.preferred_lang === "en" ? "en" : "es";

  if (full_name.length < 3) return json(400, { ok: false, error: "Nombre muy corto" });
  if (!emailRe.test(email)) return json(400, { ok: false, error: "Email inválido" });
  if (password.length < 6) return json(400, { ok: false, error: "Contraseña muy corta (mín. 6)" });
  if (phone && !telRe.test(phone)) return json(400, { ok: false, error: "Teléfono inválido" });

  // Defaults que sí existen en tu tabla
  const role = "client";        // role_type
  const is_active = true;       // boolean
  const mfa_enabled = false;    // boolean

  // Conexión PG
  const client = new Client({
    host: process.env.PGHOST,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    port: +(process.env.PGPORT || 5432),
    ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();

    // Importante: No se especifican columnas que no existen. Tampoco se crean tablas ni extensiones.
    // Confiamos en defaults de 'id' y 'created_at' ya definidos en tu tabla.
    const q = `
      INSERT INTO users (full_name, email, phone, role, preferred_lang, is_active, mfa_enabled)
      VALUES ($1, $2::citext, NULLIF($3,''), $4::role_type, $5::lang_code, $6, $7)
      RETURNING id, full_name, email::text, phone, role::text, preferred_lang::text, is_active, mfa_enabled, created_at
    `;
    const values = [full_name, email, phone, role, preferred, is_active, mfa_enabled];

    const { rows } = await client.query(q, values);
    const user = rows[0];

    return json(200, { ok: true, user });
  } catch (e) {
    // Email duplicado (unique index/constraint en email citext)
    if (e?.code === "23505" || /duplicate key/i.test(String(e?.message))) {
      return json(409, { ok: false, error: "Este correo ya está registrado" });
    }
    // Valor de enum inválido (por si se toca role/preferred_lang)
    if (e?.code === "22P02" || /invalid input value for enum/i.test(String(e?.message))) {
      return json(400, { ok: false, error: "Valor inválido en role o preferred_lang" });
    }
    console.error("auth-signin error:", e);
    return json(500, { ok: false, error: "Error interno" });
  } finally {
    try { await client.end(); } catch {}
  }
}
