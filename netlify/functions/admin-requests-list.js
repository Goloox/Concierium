const { SCHEMA, pgClient, ok, err, requireAdmin } = require("./_admin-util");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "GET") return err(405, { ok: false, error: "Method Not Allowed" });
    const { error } = requireAdmin(event);
    if (error) return error;

    const url = new URL(event.rawUrl || `https://x${event.path}${event.rawQuery ? '?'+event.rawQuery : ''}`);
    const status = url.searchParams.get("status");  // optional
    const limit = Math.min(+(url.searchParams.get("limit")||50), 200);

    const client = pgClient();
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);

    const base = `
      SELECT r.id::text, u.full_name AS cliente, r.service_kind::text AS servicio,
             COALESCE(d.name,'—') AS destino, r.current_status::text AS estado,
             to_char(r.created_at,'YYYY-MM-DD HH24:MI') AS creada
      FROM ${SCHEMA}.requests r
      JOIN ${SCHEMA}.users u ON u.id = r.client_id
      LEFT JOIN ${SCHEMA}.destinations d ON d.id = r.destination_id
    `;
    let q, params;
    if (status) {
      q = `${base} WHERE r.current_status = $1::${SCHEMA}.request_status ORDER BY r.created_at DESC LIMIT $2`;
      params = [status, limit];
    } else {
      q = `${base} ORDER BY r.created_at DESC LIMIT $1`;
      params = [limit];
    }
    const { rows } = await client.query(q, params);
    await client.end();

    return ok({ ok:true, items: rows });
  } catch (e) {
    console.error("admin-requests-list", e);
    return err(500, { ok:false, error:"Error interno" });
  }
};
