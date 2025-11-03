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
      SELECT id::text, name, country, region, is_active, sort_order
      FROM ${SCHEMA}.destinations
      ORDER BY is_active DESC, sort_order ASC, name ASC
      LIMIT 200
    `;
    const { rows } = await client.query(q);
    await client.end();
    return ok({ ok: true, items: rows });
  } catch (e) {
    console.error("admin-destinations-list", e);
    return err(500, { ok: false, error: "Error interno" });
  }
};
