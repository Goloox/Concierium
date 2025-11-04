import { db, json, safeHandler } from "./_db.js";
import { requireAdmin } from "./_auth.js";

export const handler = (event) => safeHandler(async () => {
  const auth = await requireAdmin(event);
  if (!auth.ok) return json(auth.statusCode || 401, auth);

  if (event.httpMethod !== "POST")
    return json(405, { ok: false, error: "Method not allowed" });

  const body = JSON.parse(event.body || "{}");
  const { id, name, type, email, phone, rating, is_active = true } = body;
  if (!name || !type) return json(200, { ok: false, error: "name/type required" });

  const pool = db();
  if (id) {
    await pool.query(
      `UPDATE providers
       SET name=$2, type=$3, email=$4, phone=$5, rating=$6, is_active=$7, updated_at=now()
       WHERE id=$1`,
      [id, name, type, email ?? null, phone ?? null, rating ?? null, !!is_active]
    );
    return json(200, { ok: true, id });
  } else {
    const { rows } = await pool.query(
      `INSERT INTO providers (name, type, email, phone, rating, is_active)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [name, type, email ?? null, phone ?? null, rating ?? null, !!is_active]
    );
    return json(200, { ok: true, id: rows[0].id });
  }
});
