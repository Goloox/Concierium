import { db, json, safeHandler } from "./_db.js";
import { requireAdmin } from "./_auth.js";

export const handler = (event) => safeHandler(async () => {
  const auth = await requireAdmin(event);
  if (!auth.ok) return json(auth.statusCode || 401, auth);

  if (event.httpMethod !== "POST")
    return json(405, { ok: false, error: "Method not allowed" });

  const { id, to_status } = JSON.parse(event.body || "{}");
  if (!id || !to_status) return json(200, { ok: false, error: "id/to_status required" });

  const pool = db();

  try {
    // asignamos admin (para status_history.changed_by) si no tiene
    await pool.query(
      `UPDATE requests
       SET current_status = $2,
           assigned_admin_id = COALESCE(assigned_admin_id, $3),
           updated_at = now()
       WHERE id = $1`,
      [id, to_status, auth.user.id]
    );
    return json(200, { ok: true, id, to_status });
  } catch (e) {
    // El trigger RAISE EXCEPTION llega aquí
    return json(200, { ok: false, error: e.message });
  }
});
