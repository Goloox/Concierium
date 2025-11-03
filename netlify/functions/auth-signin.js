// CommonJS para Netlify Functions
const { Client } = require("pg");
const bcrypt = require("bcryptjs");

const SCHEMA = process.env.DB_SCHEMA || "concierium";

const J = (status, body) => ({
  statusCode: status,
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify(body),
});

function makeClient() {
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

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const telRe   = /^[-0-9()+ ]{7,20}$/;

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return J(405, { ok:false, error:"Method Not Allowed" });
    }

    let p = {};
    try { p = JSON.parse(event.body || "{}"); }
    catch { return J(400, { ok:false, error:"Invalid JSON" }); }

    const full_name = String(p.full_name||"").trim();
    const email     = String(p.email||"").trim().toLowerCase();
    const password  = String(p.password||"");
    const phone     = String(p.phone||"").trim();
    const preferred = p.preferred_lang === "en" ? "en" : "es";

    // Validaciones
    if (full_name.length < 3)         return J(400,{ok:false,error:"Nombre muy corto"});
    if (!emailRe.test(email))         return J(400,{ok:false,error:"Email inválido"});
    if (password.length < 6)          return J(400,{ok:false,error:"Contraseña muy corta (mín. 6)"});
    if (phone && !telRe.test(phone))  return J(400,{ok:false,error:"Teléfono inválido"});

    // Hash de contraseña
    const password_hash = await bcrypt.hash(password, 10);

    const client = makeClient();
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);

    // Rol por defecto válido según tu enum
    const role = "client";

    const q = `
      INSERT INTO ${SCHEMA}.users
        (full_name, email, phone, role, preferred_lang, is_active, mfa_enabled, password_hash)
      VALUES
        ($1, $2::citext, NULLIF($3,''), $4::${SCHEMA}.role_type, $5::${SCHEMA}.lang_code, true, false, $6)
      RETURNING id, full_name, email::text, phone, role::text, preferred_lang::text, is_active, mfa_enabled, created_at
    `;
    const vals = [ full_name, email, phone, role, preferred, password_hash ];
    const { rows } = await client.query(q, vals);
    await client.end();

    return J(200, { ok:true, user: rows[0] });

  } catch (e) {
    const code = e?.code || null;
    const msg  = String(e?.message || e);

    if (code === "23505" || /duplicate key/i.test(msg)) {
      return J(409, { ok:false, error:"Este correo ya está registrado" });
    }
    if (code === "22P02" || /invalid input value for enum/i.test(msg)) {
      return J(400, { ok:false, error:"Valor inválido en role o preferred_lang" });
    }
    if (code === "42P01" || /relation .* does not exist/i.test(msg)) {
      return J(500, { ok:false, error:`Tabla ${SCHEMA}.users no existe` });
    }
    if (code === "3F000" || /schema .* does not exist/i.test(msg)) {
      return J(500, { ok:false, error:`Esquema ${SCHEMA} no existe` });
    }
    if (code === "28P01" || /password authentication failed/i.test(msg)) {
      return J(500, { ok:false, error:"Credenciales de base de datos inválidas" });
    }
    if (/pg_hba\.conf|must use ssl|SSL/i.test(msg)) {
      return J(500, { ok:false, error:"Conexión rechazada/SSL requerido" });
    }

    console.error("auth-signin error:", e);
    return J(500, { ok:false, error:"Error interno" });
  }
};
