const { SCHEMA, pgClient, ok, err, requireAdmin } = require("./_admin-util");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "GET") return err(405, { ok: false, error: "Method Not Allowed" });
    const { error } = requireAdmin(event);
    if (error) return error;

    const client = pgClient();
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    const q = `
      SELECT s.id::text, s.service_kind::text AS kind, s.name, s.description,
             s.base_price_usd::text AS base_price_usd,
             d.name AS destination, p.name AS provider, s.is_active
      FROM ${SCHEMA}.services_catalog s
      LEFT JOIN ${SCHEMA}.destinations d ON d.id = s.destination_id
      LEFT JOIN ${SCHEMA}.providers p ON p.id = s.provider_id
      ORDER BY s.is_active DESC, s.created_at DESC
      LIMIT 200
    `;
    const { rows } = await client.query(q);
    await client.end();
    return ok({ ok: true, items: rows });
  } catch (e) {
    console.error("admin-services-list", e);
    return err(500, { ok: false, error: "Error interno" });
  }
};
