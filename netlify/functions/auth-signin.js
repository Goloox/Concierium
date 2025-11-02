import { Client } from "pg";

// Puedes sobreescribir el esquema con una env var si lo cambiaste
const SCHEMA = process.env.DB_SCHEMA || "concierium";

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const telRe   = /^[-0-9()+ ]{7,20}$/;

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
    body: JSON.stringify(body),
  };
}

// Lee etiquetas del enum del campo concierium.users.role (acotado por esquema)
async function getRoleEnumLabels(client) {
  const sql = `
    SELECT e.enumlabel
    FROM pg_attribute a
    JOIN pg_class c       ON a.atttypid = a.atttypid AND a.attrelid = c.oid
    JOIN pg_namespace n   ON c.relnamespace = n.oid
    JOIN pg_type t        ON a.atttypid = t.oid
    JOIN pg_enum e        ON t.oid = e.enumtypid
    WHERE n.nspname = $1
      AND c.relname = 'users'
      AND a.attname = 'role'
    ORDER BY e.enumsortorder;
  `;
  const { rows } = await client.query(sql, [SCHEMA]);
  return rows.map(r => r.enumlabel);
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { ok:false, error:"Method Not Allowed" });
  }

  // Variables mínimas para conectar
  const need = ["PGHOST","PGUSER","PGPASSWORD","PGDATABASE"];
  const missing = need.filter(k => !process.env[k]);
  if (missing.length) {
    return json(500, { ok:false, error:`DB env missing: ${missing.join(", ")}` });
  }

  // Parseo
  let payload = {};
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return json(400, { ok:false, error:"Invalid JSON" }); }

  // Limpieza/validación
  const full_name = String(payload.full_name || "").trim();
  const email     = String(payload.email || "").trim().toLowerCase();
  const password  = String(payload.password || ""); // no se almacena (tu tabla no tiene columna)
  const phone     = String(payload.phone || "").trim();
  const preferred = payload.preferred_lang === "en" ? "en" : "es";

  if (full_name.length < 3)         return json(400, { ok:false, error:"Nombre muy corto" });
  if (!emailRe.test(email))         return json(400, { ok:false, error:"Email inválido" });
  if (password.length < 6)          return json(400, { ok:false, error:"Contraseña muy corta (mín. 6)" });
  if (phone && !telRe.test(phone))  return json(400, { ok:false, error:"Teléfono inválido" });

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

    // Fija search_path para esta sesión (seguro y no altera la BD)
    await client.query(`SET search_path TO ${SCHEMA}, public`);

    // Lee enum válido para 'role' en ESTE esquema
    const roleLabels = await getRoleEnumLabels(client);
    if (!roleLabels.length) {
      return json(500, { ok:false, error:`No se pudo obtener ENUM de ${SCHEMA}.users.role` });
    }

    // Escoge un rol permitido sin tocar la BD
    let role = "client";
    if (!roleLabels.includes(role)) {
      if (roleLabels.includes("admin")) role = "admin";
      else role = roleLabels[0]; // primer valor del enum (p.ej. 'client'/'provider'...)
    }

    const is_active   = true;
    const mfa_enabled = false;

    // IMPORTANTE: tabla y tipos calificados por esquema
    const q = `
      INSERT INTO ${SCHEMA}.users
        (full_name, email, phone, role, preferred_lang, is_active, mfa_enabled)
      VALUES
        ($1, $2::citext, NULLIF($3,''), $4::${SCHEMA}.role_type, $5::${SCHEMA}.lang_code, $6, $7)
      RETURNING id, full_name, email::text, phone, role::text,
                preferred_lang::text, is_active, mfa_enabled, created_at
    `;
    const values = [full_name, email, phone, role, preferred, is_active, mfa_enabled];

    const { rows } = await client.query(q, values);
    return json(200, { ok:true, user: rows[0] });

  } catch (e) {
    const msg = String(e?.message || e || "");
    // Email duplicado
    if (e?.code === "23505" || /duplicate key/i.test(msg)) {
      return json(409, { ok:false, error:"Este correo ya está registrado" });
    }
    // Tipos/ENUM/tabla/esquema
    if (e?.code === "22P02" || /invalid input value for enum/i.test(msg)) {
      return json(400, { ok:false, error:"Valor inválido en role o preferred_lang" });
    }
    if (e?.code === "3D000" || /database .* does not exist/i.test(msg)) {
      return json(500, { ok:false, error:"Base de datos no existe o nombre incorrecto" });
    }
    if (e?.code === "3F000" || /schema .* does not exist/i.test(msg)) {
      return json(500, { ok:false, error:`Esquema ${SCHEMA} no existe (ajusta DB_SCHEMA o crea el esquema)` });
    }
    if (e?.code === "42P01" || /relation .* does not exist/i.test(msg)) {
      return json(500, { ok:false, error:`Tabla ${SCHEMA}.users no existe o search_path incorrecto` });
    }
    if (e?.code === "28P01" || /password authentication failed/i.test(msg)) {
      return json(500, { ok:false, error:"Credenciales de base de datos inválidas" });
    }
    if (/pg_hba\.conf|no route|must use ssl|SSL/i.test(msg)) {
      return json(500, { ok:false, error:"Conexión rechazada/SSL requerido. Prueba PGSSL=true" });
    }

    console.error("auth-signin error:", e);
    return json(500, { ok:false, error:"Error interno" });
  } finally {
    try { await client.end(); } catch {}
  }
}
