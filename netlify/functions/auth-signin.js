import { Client } from "pg";

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const telRe   = /^[-0-9()+ ]{7,20}$/;

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
    body: JSON.stringify(body),
  };
}

// Lee etiquetas del enum del campo users.role
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

  const need = ["PGHOST","PGUSER","PGPASSWORD","PGDATABASE"];
  const missing = need.filter(k => !process.env[k]);
  if (missing.length) {
    return json(500, { ok:false, error:`DB env missing: ${missing.join(", ")}` });
  }

  let payload = {};
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return json(400, { ok:false, error:"Invalid JSON" }); }

  const full_name = String(payload.full_name || "").trim();
  const email     = String(payload.email || "").trim().toLowerCase();
  const password  = String(payload.password || ""); // no se almacena
  const phone     = String(payload.phone || "").trim();
  const preferred = payload.preferred_lang === "en" ? "en" : "es";

  if (full_name.length < 3)   return json(400, { ok:false, error:"Nombre muy corto" });
  if (!emailRe.test(email))   return json(400, { ok:false, error:"Email inválido" });
  if (password.length < 6)    return json(400, { ok:false, error:"Contraseña muy corta (mín. 6)" });
  if (phone && !telRe.test(phone)) return json(400, { ok:false, error:"Teléfono inválido" });

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

    // Obtiene roles válidos del enum
    const roleLabels = await getRoleEnumLabels(client);
    if (!roleLabels.length) {
      return json(500, { ok:false, error:"No se pudo obtener ENUM de users.role" });
    }

    // Escoge un rol permitido
    let role = "client";
    if (!roleLabels.includes(role)) {
      if (roleLabels.includes("admin")) role = "admin";
      else role = roleLabels[0];
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
    const debug = process.env.DEBUG === "true";
    // Errores comunes con mensajes claros
    if (e?.code === "23505" || /duplicate key/i.test(String(e?.message))) {
      return json(409, { ok:false, error:"Este correo ya está registrado", ...(debug ? { code:e.code, detail:String(e.message) } : {}) });
    }
    if (e?.code === "22P02" || /invalid input value for enum/i.test(String(e?.message))) {
      return json(400, { ok:false, error:"Valor inválido en role o preferred_lang", ...(debug ? { code:e.code, detail:String(e.message) } : {}) });
    }
    if (e?.code === "28P01" || /password authentication failed/i.test(String(e?.message))) {
      return json(500, { ok:false, error:"Credenciales de base de datos inválidas", ...(debug ? { code:e.code, detail:String(e.message) } : {}) });
    }
    if (/no pg_hba\.conf entry|must use ssl|SSL/i.test(String(e?.message))) {
      return json(500, { ok:false, error:"Conexión rechazada/SSL requerido. Prueba PGSSL=true", ...(debug ? { code:e.code, detail:String(e.message) } : {}) });
    }
    // Respuesta con detalle solo si DEBUG=true
    return json(500, { ok:false, error:"Error interno", ...(debug ? { code:e.code || null, detail:String(e.message || e) } : {}) });
  } finally {
    try { await client.end(); } catch {}
  }
}
