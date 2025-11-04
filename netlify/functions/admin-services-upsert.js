import { db, json, safeHandler } from "./_db.js";
import { requireAdmin } from "./_auth.js";

export const handler = (event) => safeHandler(async () => {
  const auth = await requireAdmin(event);
  if (!auth.ok) return json(auth.statusCode || 401, auth);

  if (event.httpMethod !== "POST")
    return json(405, { ok: false, error: "Method not allowed" });

  const b = JSON.parse(event.body || "{}");
  const {
    id, service_kind, name, description,
    base_price_usd, destination_id, provider_id, is_active = true
  } = b;

  if (!service_kind || !name)
    return json(200, { ok: false, error: "service_kind/name required" });

  const pool = db();
  if (id) {
    await pool.query(
      `UPDATE services_catalog
       SET service_kind=$2, name=$3, description=$4, base_price_usd=$5,
           destination_id=$6, provider_id=$7, is_active=$8, updated_at=now()
       WHERE id=$1`,
      [
        id, service_kind, name, description ?? null,
        base_price_usd ?? null, destination_id || null, provider_id || null, !!is_active
      ]
    );
    return json(200, { ok: true, id });
  } else {
    const { rows } = await pool.query(
      `INSERT INTO services_catalog
       (service_kind, name, description, base_price_usd, destination_id, provider_id, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        service_kind, name, description ?? null,
        base_price_usd ?? null, destination_id || null, provider_id || null, !!is_active
      ]
    );
    return json(200, { ok: true, id: rows[0].id });
  }
});
