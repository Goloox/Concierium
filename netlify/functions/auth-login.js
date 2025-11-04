import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db, json, safeHandler } from "./_db.js";

const SCHEMA = process.env.DB_SCHEMA || "concierium";

export const handler = (event) => safeHandler(async () => {
  if (event.httpMethod !== "POST")
    return json(405, { ok: false, error: "Method Not Allowed" });

  if (!process.env.JWT_SECRET)
    return json(500, { ok: false, error: "Falta JWT_SECRET en variables de entorno" });

  let p = {};
  try { p = JSON.parse(event.body || "{}"); }
  catch { return json(400, { ok: false, error: "JSON inválido" }); }

  const email    = String(p.email || "").trim().toLowerCase();
  const password = String(p.password || "");
  if (!email || !password)
    return json(400, { ok: false, error: "Email y contraseña requeridos" });

  const pool = db();
  await pool.query(`SET search_path TO ${SCHEMA}, public`);

  const { rows } = await pool.query(
    `SELECT id, full_name, email::text AS email,
            role::text AS role, preferred_lang::text AS lang,
            is_active, password_hash
       FROM ${SCHEMA}.users
      WHERE email = $1::citext
      LIMIT 1`,
    [email]
  );

  if (!rows.length) return json(401, { ok: false, error: "Credenciales inválidas" });

  const u = rows[0];
  if (!u.is_active) return json(403, { ok: false, error: "Usuario inactivo" });
  if (!u.password_hash) return json(401, { ok: false, error: "Este usuario no tiene contraseña configurada" });

  const okPass = await bcrypt.compare(password, u.password_hash);
  if (!okPass) return json(401, { ok: false, error: "Credenciales inválidas" });

  const role = String(u.role || "").toLowerCase();
  const dest = (role === "admin" || role === "superadmin") ? "/admin/" : "/cliente/";

  const token = jwt.sign(
    { sub: u.id, email: u.email, name: u.full_name, role, lang: u.lang || "es" },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );

  return json(200, {
    ok: true,
    token,
    user: { id: u.id, full_name: u.full_name, email: u.email, role, lang: u.lang || "es", is_active: u.is_active },
    redirectTo: dest
  });
});
