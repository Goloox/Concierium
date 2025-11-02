import jwt from "jsonwebtoken";

export function readToken(event) {
  const h = event.headers || {};
  const q = event.queryStringParameters || {};
  const ah = h.authorization || h.Authorization || "";
  if (ah?.startsWith?.("Bearer ")) return ah.slice(7);
  if (q.jwt) return q.jwt;
  return null;
}

export function requireUserClaims(event) {
  const token = readToken(event);
  if (!token) return { ok: false, statusCode: 401, error: "Unauthorized" };
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
    return { ok: true, claims };
  } catch (err) {
    return { ok: false, statusCode: 401, error: "Invalid token" };
  }
}
