import { Client } from "pg";

const SCHEMA = process.env.DB_SCHEMA || "concierium";

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const telRe   = /^[-0-9()+ ]{7,20}$/;

function J(status, body) {
  return { statusCode: status, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) };
}

function makeClient() {
  if (process.env.DATABASE_URL) {
    return new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false } // sslmode=require
    });
  }
  // fallback a variables sueltas si no hay DATABASE_URL
  return new Client({
    host: process.env.PGHOST,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    port: +(process.env.PGPORT || 5432),
    ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined
  });
}

async function getRoleEnumLabels(client) {
  const sql = `
    SELECT e.enumlabel
    FROM pg_attribute a
    JOIN pg_class c     ON a.attrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    JOIN pg_type t      ON a.atttypid = t.oid
    JOIN pg_enum e      ON t.oid = e.enumtypid
    WHERE n.nspname = $1 AND c.relname='users' AND a.attname='role'
    ORDER BY e.enumsortorder;
  `;
  const { rows } = await client.query(sql, [SCHEMA]);
  return rows.map(r => r.enumlabel);
}

export async function handler(event) {
  if (event.httpMethod !== "POST") return J(405, { ok:false, error:"Method Not Allowed" });

  // Validar que haya credenciales de alguna forma
  const hasUrl = !!process.env.DATABASE_URL;
  const hasPieces = ["PGHOST","PGUSER","PGPASSWORD","PGDATABASE"].every(k => !!process.env[k]);
  if (!hasUrl && !hasPieces) {
    return J(500, { ok:false, where:"env", error:"Faltan credenciales: pon DATABASE_URL o PGHOST/PGUSER/PGPASSWORD/PGDATABASE" });
  }

  // Parseo y validación básica
  let p = {};
  try { p = JSON.parse(event.body || "{}"); } catch { return J(400, { ok:false, error:"Invalid JSON" }); }
  const full_name = String(p.full_name||"").trim();
  const email     = String(p.email||"").trim().toLowerCase();
  const password  = String(p.password||""); // no se guarda (tu tabla no tiene columna)
  const phone     = String(p.phone||"").trim();
  const preferred = p.preferred_lang === "en" ? "en" : "es";

  if (full_name.length < 3)           return J(400, { ok:false, error:"Nombre muy corto" });
  if (!emailRe.test(email))           return J(400, { ok:false, error:"Email inválido" });
  if (password.length < 6)            return J(400, { ok:false, error:"Contraseña muy corta (mín. 6)" });
  if (phone && !telRe.test(phone))    return J(400, { ok:false, error:"Teléfono inválido" });

  const client = makeClient();

  try {
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);

    const roleLabels = await getRoleEnumLabels(client);
    if (!roleLabels.length) return J(500, { ok:false, where:"enum", error:`No enum labels for ${SCHEMA}.users.role` });

    // usa un rol permitido de tu enum
    const role = roleLabels.includes("client") ? "client" :
                 roleLabels.includes("admin")  ? "admin"  : roleLabels[0];

    const q = `
      INSERT INTO ${SCHEMA}.users
        (full_name, email, phone, role, preferred_lang, is_active, mfa_enabled)
      VALUES
        ($1, $2::citext, NULLIF($3,''), $4::${SCHEMA}.role_type, $5::${SCHEMA}.lang_code, true, false)
      RETURNING id, full_name, email::text, phone, role::text, preferred_lang::text, is_active, mfa_enabled, created_at
    `;
    const vals = [full_name, email, phone, role, preferred];
    const { rows } = await client.query(q, vals);
    return J(200, { ok:true, user: rows[0] });

  } catch (e) {
    const code = e?.code || null;
    const msg  = String(e?.message || e);
    if (code === "23505" || /duplicate key/i.test(msg)) return J(409, { ok:false, error:"Este correo ya está registrado" });
    if (code === "22P02" || /invalid input value for enum/i.test(msg)) return J(400, { ok:false, error:"Valor inválido en role o preferred_lang" });
    if (code === "42P01" || /relation .* does not exist/i.test(msg)) return J(500, { ok:false, error:`Tabla ${SCHEMA*
