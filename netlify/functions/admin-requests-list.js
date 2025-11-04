import { db, json, safeHandler } from "./_db.js";
import { requireAdmin } from "./_auth.js";

export const handler = (event) => safeHandler(async () => {
  const auth = await requireAdmin(event);
  if (!auth.ok) return json(auth.statusCode || 401, auth);

  const status = event.queryStringParameters?.status ?? "";
  const pool = db();
  const args = [];
  let where = "";
  if (status) { args.push(status); where = `WHERE r.current_status = $1`; }

  const { rows } = await pool.query(
    `
    SELECT r.id,
           u.full_name AS cliente,
           r.service_kind AS servicio,
           COALESCE(d.name,'—') AS destino,
           r.current_status AS estado
    FROM requests r
    LEFT JOIN users u ON u.id=r.client_id
    LEFT JOIN destinations d ON d.id=r.destination_id
    ${where}
    ORDER BY r.created_at DESC
    LIMIT 100
    `,
    args
  );
  return json(200, { ok: true, items: rows });
});
