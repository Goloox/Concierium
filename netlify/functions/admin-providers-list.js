import { db, json, safeHandler } from "./_db.js";
import { requireAdmin } from "./_auth.js";

export const handler = (event) => safeHandler(async () => {
  const auth = await requireAdmin(event);
  if (!auth.ok) return json(auth.statusCode || 401, auth);

  const { rows } = await db().query(`
    SELECT id, name, type, email, phone, rating, is_active
    FROM providers
    ORDER BY is_active DESC, name ASC
  `);

  return json(200, { ok: true, items: rows });
});
