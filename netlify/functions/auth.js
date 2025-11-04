// netlify/functions/_auth.js
import jwt from "jsonwebtoken";
import { db } from "./_db.js";

function readToken(event) {
  const h = event.headers || {};
  const q = event.queryStringParameters || {};
  const ah = h.authorization || h.Authorization || "";
  if (ah?.startsWith?.("Bearer ")) return ah.slice(7);
  if (q?.jwt) return q.jwt;
  return null;
}

export async function requireAdmin(event) {
  const token = readToken(event);
  if (!token) return { ok: false, statusCode: 401, error: "Unauthorized (no token)" };

  let claims;
  try {
    claims = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return { ok: false, statusCode: 401, error: "Invalid token" };
  }

  const pool = db();
  const { rows } = await pool.query(
    `SELECT id, email, role, is_active
       FROM users
      WHERE (id::text = $1 OR email = $2)
      LIMIT 1`,
    [claims.sub ?? "", claims.email ?? ""]
  );

  const u = rows[0];
  if (!u) return { ok: false, statusCode: 401, error: "User not found" };
  if (!u.is_active) return { ok: false, statusCode: 403, error: "User disabled" };
  if (u.role !== "admin" && u.role !== "superadmin")
    return { ok: false, statusCode: 403, error: "Admin role required" };

  return { ok: true, user: u };
}
