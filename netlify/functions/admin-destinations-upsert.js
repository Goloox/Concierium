const { SCHEMA, pgClient, ok, err, requireAdmin } = require("./_admin-util");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return err(405, { ok: false, error: "Method Not Allowed" });
    const { error } = requireAdmin(event);
    if (error) return error;

    let p = {};
    try { p = JSON.parse(event.body || "{}"); } catch { return err(400, { ok: false, error: "JSON inválido" }); }

    const id = p.id || null;
    const name = String(p.name || "").trim();
    const country = p.country ? String(p.country).trim() : null;
    const region = p.region ? String(p.region).trim() : null;
    const sort_order = Number.isFinite(+p.sort_order) ? +p.sort_order : 100;
    const is_active = typeof p.is_active === "boolean" ? p.is_active : true;

    if (!name) return err(400, { ok: false, error: "Nombre requerido" });

    const client = pgClient();
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);

    let rows;
    if (id) {
      const q = `
        UPDATE ${SCHEMA}.destinations
        SET name=$1, country=$2, region=$3, sort_order=$4, is_active=$5, updated_at=now()
        WHERE id=$6
        RETURNING id::text, name, country, region, is_active, sort_order
      `;
      ({ rows } = await client.query(q, [name, country, region, sort_order, is_active, id]));
    } else {
      const q = `
        INSERT INTO ${SCHEMA}.destinations (name, country, region, sort_order, is_active)
        VALUES ($1,$2,$3,$4,$5)
        RETURNING id::text, name, country, region, is_active, sort_order
      `;
      ({ rows } = await client.query(q, [name, country, region, sort_order, is_active]));
    }
    await client.end();
    return ok({ ok: true, item: rows[0] });
  } catch (e) {
    console.error("admin-destinations-upsert", e);
    return err(500, { ok: false, error: "Error interno" });
  }
};
