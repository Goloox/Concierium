import { db, json, safeHandler } from "./_db.js";
import { requireAdmin } from "./_auth.js";

export const handler = (event) => safeHandler(async () => {
  const auth = await requireAdmin(event);
  if (!auth.ok) return json(auth.statusCode || 401, auth);

  const { rows } = await db().query(`
    SELECT s.id,
           s.service_kind AS kind,
           s.name,
           COALESCE(d.name,'') AS destination,
           COALESCE(p.name,'') AS provider,
           s.base_price_usd, s.is_active
    FROM services_catalog s
    LEFT JOIN destinations d ON d.id=s.destination_id
    LEFT JOIN providers p ON p.id=s.provider_id
    ORDER BY s.is_active DESC, s.service_kind, s.name
  `);

  return json(200, { ok: true, items: rows });
});
