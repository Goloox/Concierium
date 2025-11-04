import { db, json, safeHandler } from "./_db.js";
import { requireAdmin } from "./_auth.js";

export const handler = (event) => safeHandler(async () => {
  const auth = await requireAdmin(event);
  if (!auth.ok) return json(auth.statusCode || 401, auth);

  const { rows } = await db().query(`
    SELECT id, name, country, region, sort_order, is_active
    FROM destinations
    ORDER BY is_active DESC, sort_order ASC, name ASC
  `);

  return json(200, { ok: true, items: rows });
});
