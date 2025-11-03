// CommonJS para Netlify Functions
const { Client } = require("pg");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const SCHEMA = process.env.DB_SCHEMA || "concierium";

const J = (status, body) => ({
  statusCode: status,
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify(body),
});

// --- Conexión PostgreSQL ---
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

// --- Main handler ---
exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return J(405, { ok:false, error:"Method Not Allowed" });
    }

    if (!process.env.JWT_SECRET) {
      return J(500, { ok:false, error:"Falta JWT_SECRET en variables de entorno" });
    }

    let p = {};
    try { p = JSON.parse(event.body || "{}"); }
    catch { return J(400, { ok:false, error:"JSON inválido" }); }

    const email    = String(p.email || "").trim().toLowerCase();
    const password = String(p.password || "");

    if (!email || !password) {
      return J(400, { ok:false, error:"Email y contraseña requeridos" });
    }

    const client = makeClient();
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);

    // --- Buscar usuario ---
    const q = `
      SELECT id, full_name, email::text AS email,
             role::text AS role, preferred_lang::text AS lang,
             is_active, password_hash
      FROM ${SCHEMA}.users
      WHERE email = $1::citext
      LIMIT 1
    `;
    const { rows } = await client.query(q, [email]);
    await client.end();

    if (!rows.length) {
      return J(401, { ok:false, error:"Credenciales inválidas" });
    }

    const u = rows[0];

    if (!u.is_active) {
      return J(403, { ok:false, error:"Usuario inactivo" });
    }

    if (!u.password_hash) {
      return J(401, { ok:false, error:"Este usuario no tiene contraseña configurada" });
    }

    // --- Validar contraseña ---
    const okPass = await bcrypt.compare(password, u.password_hash);
    if (!okPass) {
      return J(401, { ok:false, error:"Credenciales inválidas" });
    }

    // --- Determinar ruta por rol ---
    const role = String(u.role || "").toLowerCase();
    const dest = (role === "admin" || role === "superadmin") ? "/admin/" : "/cliente/";

    // --- Firmar JWT (12h) ---
    const token = jwt.sign(
      {
        sub: u.id,
        email: u.email,
        name: u.full_name,
        role: role,
        lang: u.lang || "es",
      },
      process.env.JWT_SECRET,
      { expiresIn: "12h" }
    );

    return J(200, {
      ok: true,
      token,
      user: {
        id: u.id,
        full_name: u.full_name,
        email: u.email,
        role: role,
        lang: u.lang || "es",
        is_active: u.is_active,
      },
      redirectTo: dest
    });

  } catch (e) {
    console.error("auth-login error:", e);
    const code = e?.code || null;
    const msg  = String(e?.message || e);

    if (code === "28P01" || /password authentication failed/i.test(msg)) {
      return J(500, { ok:false, error:"Credenciales de base de datos inválidas" });
    }
    if (/pg_hba\.conf|must use ssl|SSL/i.test(msg)) {
      return J(500, { ok:false, error:"Conexión rechazada/SSL requerido" });
    }
    if (code === "42P01") {
      return J(500, { ok:false, error:`Tabla ${SCHEMA}.users no existe` });
    }
    return J(500, { ok:false, error:"Error interno" });
  }
};
