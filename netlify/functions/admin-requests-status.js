const { SCHEMA, pgClient, ok, err, requireAdmin } = require("./_admin-util");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return err(405, { ok:false, error:"Method Not Allowed" });
    const { auth, error } = requireAdmin(event);
    if (error) return error;

    let p={}; try{ p=JSON.parse(event.body||"{}"); }catch{return err(400,{ok:false,error:"JSON inválido"});}

    const id = p.id;
    const to_status = String(p.to_status||"").trim(); // enum request_status
    const note = p.note ? String(p.note) : null;

    if(!id || !to_status) return err(400,{ok:false,error:"id y to_status son requeridos"});

    const client = pgClient();
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);

    // Intento de transición — tu trigger enforce_status_transition valida
    try{
      const q = `
        UPDATE ${SCHEMA}.requests
        SET current_status = $1::${SCHEMA}.request_status,
            assigned_admin_id = COALESCE(assigned_admin_id, $2)
        WHERE id = $3
        RETURNING id::text, current_status::text AS estado
      `;
      const { rows } = await client.query(q, [to_status, auth.sub, id]);

      // Si hay nota, registrarla como entrada de historial aparte (opcional)
      if (note) {
        await client.query(
          `INSERT INTO ${SCHEMA}.status_history (request_id, from_status, to_status, changed_by, note)
           VALUES ($1, NULL, $2::${SCHEMA}.request_status, $3, $4)`,
          [id, to_status, auth.sub, note]
        );
      }

      await client.end();
      return ok({ ok:true, item: rows[0] });
    } catch (e) {
      await client.end();
      const msg = String(e?.message||e);
      if (/Transición de estado no permitida/i.test(msg)) {
        return err(409,{ok:false,error:msg});
      }
      if (/invalid input value for enum/i.test(msg)) {
        return err(400,{ok:false,error:"to_status inválido. Usa: new,curation,proposal_sent,confirmed,closed,discarded"});
      }
      console.error("admin-requests-status", e);
      return err(500,{ok:false,error:"Error interno"});
    }

  } catch (e) {
    console.error("admin-requests-status outer", e);
    return err(500, { ok:false, error:"Error interno" });
  }
};
