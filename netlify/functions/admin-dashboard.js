import { db, json, safeHandler } from "./_db.js";
import { requireAdmin } from "./_auth.js";

export const handler = (event) => safeHandler(async () => {
  const auth = await requireAdmin(event);
  if (!auth.ok) return json(auth.statusCode || 401, auth);

  const pool = db();

  const [{ rows: totalRows }, { rows: porEstado }, { rows: recientes }, { rows: sla }] =
    await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM requests`),
      pool.query(`
        SELECT current_status AS status, COUNT(*)::int AS total
        FROM requests GROUP BY current_status ORDER BY status
      `),
      pool.query(`
        SELECT r.id, u.full_name AS cliente, r.service_kind AS servicio,
               COALESCE(d.name,'—') AS destino, r.current_status AS estado,
               to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS creada
        FROM requests r
        LEFT JOIN users u ON u.id = r.client_id
        LEFT JOIN destinations d ON d.id = r.destination_id
        ORDER BY r.created_at DESC LIMIT 10
      `),
      pool.query(`
        SELECT id, created_at, first_change_at, proposal_at,
               breach_first_attention_2h, breach_proposal_48h
        FROM v_sla_breaches ORDER BY created_at DESC LIMIT 20
      `),
    ]);

  return json(200, {
    ok: true,
    total: totalRows[0]?.total ?? 0,
    por_estado: porEstado,
    recientes,
    sla,
  });
});
