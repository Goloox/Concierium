import { db, json, safeHandler } from "./_db.js";
import { requireAdmin } from "./_auth.js";

export const handler = (event) => safeHandler(async () => {
  const auth = await requireAdmin(event);
  if (!auth.ok) return json(auth.statusCode || 401, auth);

  if (event.httpMethod !== "POST")
    return json(405, { ok: false, error: "Method not allowed" });

  const body = JSON.parse(event.body || "{}");
  const { id, name, country, region, sort_order = 100, is_active = true } = body;
  if (!name) return json(200, { ok: false, error: "name is required" });

  const pool = db();

  if (id) {
    await pool.query(
      `UPDATE destinations
          SET name=$2, country=$3, region=$4, sort_order=$5, is_active=$6, updated_at=now()
        WHERE id=$1`,
      [id, name, country ?? null, region ?? null, sort_order, !!is_active]
    );
    return json(200, { ok: true, id });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO destinations (name, country, region, sort_order, is_active)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id`,
      [name, country ?? null, region ?? null, sort_order, !!is_active]
    );
    return json(200, { ok: true, id: rows[0].id });
  } catch (e) {
    if (e.code === "23505")
      return json(200, { ok: false, error: "Destino ya existe (nombre+país)" });
    throw e;
  }
});
