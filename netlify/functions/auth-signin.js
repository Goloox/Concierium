import { Client } from "pg";

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Acepta dígitos, +, (), -, espacio. (coincide con el pattern del HTML)
const telRe   = /^[0-9()+\- ]{7,20}$/;

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
    body: JSON.stringify(body),
  };
}

// Obtiene las etiquetas del enum del campo users.role (sin modificar la DB)
async function getRoleEnumLabels(client) {
  const sql = `
    SELECT e.enumlabel
    FROM pg_attribute a
    JOIN pg_class c ON a.attrelid = c.oid
    JOIN pg_type  t ON a.atttypid = t.oid
    JOIN pg_enum  e ON t.oid = e.enumtypid
    WHERE c.relname = 'users'
      AND a.attname = 'role'
    ORDER BY e.enumsortorder;
  `;
  const { rows } = await client.query(sql);
  return rows.map(r => r.enumlabel);
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { ok:false, error:"Method Not Allowed" });
  }

  // Verifica env vars de DB
  const need = ["PGHOST","PGUSER","PGPASSWORD","PGDATABASE"];
  const missing = need.filter(k => !process.env[k]);
  if (missing.length) {
    return json(500, { ok:false, error:`DB env missing: ${missing.join(", ")}` });
  }

  // Payload
  let payload = {};
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return json(400, { ok:false, error:"Invalid JSON" }); }

  // Limpieza/validación (sin tocar el esquema)
  const full_name = String(payload.full_name || "").trim();
  const email     = String(payload.email || "").trim().toLowerCase();
  const password  = String(payload.password || ""); // no se guarda
  const phone     = String(payload.phone || "").trim();
  const preferred = payload.preferred_lang === "en" ? "en" : "es";

  if (full_name.length < 3) return json(400, { ok:false, error:"Nombre muy corto" });
  if (!emailRe.test(email))  return json(400, { ok:false, error:"Email inválido" });
  if (password.length < 6)   return json(400, { ok:false, error:"Contraseña muy corta (mín. 6)" });
  if (phone && !telRe.test(phone)) return json(400, { ok:false, error:"Teléfono inválido" });

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

    // Lee enum válido para 'role'
    const roleLabels = await getRoleEnumLabels(client);
    if (!roleLabels.length) {
      return json(500, { ok:false, error:"No se pudo obtener ENUM de users.role" });
    }

    // Elige un valor permitido para role (sin cambiar DB)
    let role = "client";
    if (!roleLabels.includes(role)) {
      if (roleLabels.includes("admin")) role = "admin";
      else role = roleLabels[0]; // primer valor definido en tu enum
    }

    const is_active   = true;
    const mfa_enabled = false;

    const q = `
      INSERT INTO users
        (full_name, email, phone, role, preferred_lang, is_active, mfa_enabled)
      VALUES
        ($1, $2::citext, NULLIF($3,''), $4::role_type, $5::lang_code, $6, $7)
      RETURNING id, full_name, email::text, phone, role::text,
                preferred_lang::text, is_active, mfa_enabled, created_at
    `;
    const values = [full_name, email, phone, role, preferred, is_active, mfa_enabled];

    const { rows } = await client.query(q, values);
    return json(200, { ok:true, user: rows[0] });

  } catch (e) {
    // Email duplicado
    if (e?.code === "23505" || /duplicate key/i.test(String(e?.message))) {
      return json(409, { ok:false, error:"Este correo ya está registrado" });
    }
    // Error de enum/tipos
    if (e?.code === "22P02" || /invalid input value for enum/i.test(String(e?.message))) {
      return json(400, { ok:false, error:"Valor inválido en role o preferred_lang" });
    }
    // Credenciales DB incorrectas
    if (e?.code === "28P01" || /password authentication failed/i.test(String(e?.message))) {
      return json(500, { ok:false, error:"Credenciales de base de datos inválidas" });
    }
    console.error("auth-signin error:", e);
    return json(500, { ok:false, error:"Error interno" });
  } finally {
    try { await client.end(); } catch {}
  }
}
