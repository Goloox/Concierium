// netlify/functions/api.js  (ESM, todo en una sola Function)
import { Client } from "pg";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";

const SCHEMA = process.env.DB_SCHEMA || "concierium";

/* -------------------- Utils -------------------- */
const J = (status, body) => ({
  statusCode: status,
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify(body),
});

function makeClient() {
  if (process.env.DATABASE_URL) {
    return new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  }
  return new Client({
    host: process.env.PGHOST,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    port: +(process.env.PGPORT || 5432),
    ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
}

function readToken(event) {
  const h = event.headers || {};
  const ah = h.authorization || h.Authorization || "";
  if (ah?.startsWith?.("Bearer ")) return ah.slice(7);
  return null;
}

function requireUser(event) {
  const token = readToken(event);
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    const c = jwt.verify(token, process.env.JWT_SECRET);
    return { id: c?.sub, email: c?.email, name: c?.name, role: c?.role };
  } catch {
    return null;
  }
}

function requireUserId(event) {
  const u = requireUser(event);
  return u?.id || null;
}

/* -------------------- Email -------------------- */
async function sendMail({ to, subject, html, text }) {
  try {
    const host = process.env.SMTP_HOST;
    const port = +(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || "no-reply@localhost";
    if (!host || !user || !pass) {
      console.warn("sendMail: Faltan variables SMTP_HOST/SMTP_USER/SMTP_PASS; no se enviará correo.");
      return { ok: false, skipped: true, reason: "missing_credentials" };
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // true si 465
      auth: { user, pass },
    });

    const cc = process.env.SMTP_CC_ADMIN ? String(process.env.SMTP_CC_ADMIN) : undefined;

    const info = await transporter.sendMail({
      from,
      to,
      cc,
      subject,
      text: text || (html ? html.replace(/<[^>]+>/g, " ") : ""),
      html: html || undefined,
    });

    return { ok: true, messageId: info.messageId };
  } catch (e) {
    console.error("sendMail error:", e);
    return { ok: false, error: String(e?.message || e) };
  }
}

function emailTplNewRequest({ user, reqId, payload }) {
  const title = "✅ Nueva solicitud registrada";
  const body = `
    <h2>${title}</h2>
    <p>Hola ${user?.name || user?.email || "cliente"}, hemos recibido tu solicitud.</p>
    <ul>
      <li><b>Folio:</b> ${reqId}</li>
      <li><b>Tipo:</b> ${payload.service_kind || "—"}</li>
      <li><b>Destino:</b> ${payload.destination_id || "—"}</li>
      <li><b>Catálogo:</b> ${payload.catalog_id || "—"}</li>
      <li><b>Fechas:</b> ${payload.start_date || "—"} → ${payload.end_date || "—"}</li>
      <li><b>Huéspedes:</b> ${payload.guests ?? "—"}</li>
      <li><b>Presupuesto:</b> ${payload.budget_usd ?? "—"} USD</li>
      <li><b>Intereses:</b> ${(Array.isArray(payload.interests) ? payload.interests : []).join(", ") || "—"}</li>
      <li><b>Notas:</b> ${payload.notes || "—"}</li>
    </ul>
    <p>Te avisaremos cuando cambie el estado de tu solicitud.</p>
  `;
  return { subject: title, html: body };
}

function emailTplStatus({ user, reqId, toStatus }) {
  const title = "🔔 Actualización de estado de tu solicitud";
  const body = `
    <h2>${title}</h2>
    <p>Hola ${user?.name || user?.email || "cliente"}, tu solicitud cambió de estado.</p>
    <ul>
      <li><b>Folio:</b> ${reqId}</li>
      <li><b>Nuevo estado:</b> ${toStatus}</li>
    </ul>
    <p>Si no reconoces este cambio, contáctanos.</p>
  `;
  return { subject: title, html: body };
}

/* -------------------- Operaciones públicas -------------------- */
async function opPublicDestinations() {
  const client = makeClient();
  try {
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    const { rows } = await client.query(`
      SELECT id, name, country, region, is_active, sort_order
      FROM ${SCHEMA}.destinations
      WHERE is_active = true
      ORDER BY sort_order ASC, name ASC
    `);
    return J(200, { ok: true, items: rows });
  } catch (e) {
    console.error("public-destinations:", e);
    return J(500, { ok: false, error: "Error listando destinos" });
  } finally {
    try { await client.end(); } catch {}
  }
}

async function opPublicServices() {
  const client = makeClient();
  try {
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    const { rows } = await client.query(`
      SELECT s.id, s.service_kind, s.name, s.description, s.base_price_usd,
             s.destination_id, d.name AS destination,
             s.provider_id, p.name AS provider,
             s.is_active
      FROM ${SCHEMA}.services_catalog s
      LEFT JOIN ${SCHEMA}.destinations d ON d.id = s.destination_id
      LEFT JOIN ${SCHEMA}.providers    p ON p.id = s.provider_id
      WHERE s.is_active = true
      ORDER BY s.service_kind ASC, s.name ASC
    `);
    return J(200, { ok: true, items: rows });
  } catch (e) {
    console.error("public-services:", e);
    return J(500, { ok: false, error: "Error listando servicios" });
  } finally {
    try { await client.end(); } catch {}
  }
}

/* -------------------- Cliente: solicitudes -------------------- */
async function opClientRequestsList(event) {
  const uid = requireUserId(event);
  if (!uid) return J(401, { ok: false, error: "Unauthorized" });

  const url = new URL(event.rawUrl || `http://x${event.path}`);
  const status = url.searchParams.get("status");

  const client = makeClient();
  try {
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    const params = [uid];
    let where = `r.client_id = $1`;
    if (status) { params.push(status); where += ` AND r.current_status = $2`; }

    const q = `
      SELECT r.id, r.client_id, r.service_kind, r.destination_id, r.start_date, r.end_date,
             r.guests, r.budget_usd, r.dietary_notes, r.interests, r.notes,
             r.current_status, r.created_at,
             ri.catalog_id,
             sc.name AS servicio, sc.service_kind AS servicio_kind,
             d.name  AS destino
      FROM ${SCHEMA}.requests r
      LEFT JOIN ${SCHEMA}.request_items   ri ON ri.request_id = r.id
      LEFT JOIN ${SCHEMA}.services_catalog sc ON sc.id = ri.catalog_id
      LEFT JOIN ${SCHEMA}.destinations    d  ON d.id = r.destination_id
      WHERE ${where}
      ORDER BY r.created_at DESC
      LIMIT 200
    `;
    const { rows } = await client.query(q, params);
    return J(200, { ok: true, items: rows });
  } catch (e) {
    console.error("client-requests-list:", e);
    const msg = String(e?.message || e);
    if (/relation .*requests.* does not exist/i.test(msg))
      return J(500, { ok: false, error: `No existe la tabla ${SCHEMA}.requests` });
    return J(500, { ok: false, error: "Error listando solicitudes" });
  } finally {
    try { await client.end(); } catch {}
  }
}

async function opClientRequestsUpsert(event) {
  if (event.httpMethod !== "POST") return J(405, { ok: false, error: "Method Not Allowed" });
  const user = requireUser(event);
  if (!user?.id) return J(401, { ok: false, error: "Unauthorized" });

  let p = {};
  try { p = JSON.parse(event.body || "{}"); }
  catch { return J(400, { ok: false, error: "JSON inválido" }); }

  const id = p.id || null;
  const service_kind = p.service_kind;
  if (!service_kind) return J(400, { ok: false, error: "service_kind requerido" });
  const destination_id = p.destination_id || null;
  const catalog_id     = p.catalog_id || null;
  const start_date     = p.start_date || null;
  const end_date       = p.end_date || null;
  const guests         = p.guests==null || p.guests==="" ? null : +p.guests;
  const budget_usd     = p.budget_usd==null || p.budget_usd==="" ? null : +p.budget_usd;
  const dietary_notes  = p.dietary_notes || null;
  const interests      = Array.isArray(p.interests) ? p.interests : [];
  const notes          = p.notes || null;

  const client = makeClient();
  try {
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);

    if (!id) {
      const qi = `
        INSERT INTO ${SCHEMA}.requests
          (client_id, service_kind, destination_id, start_date, end_date, guests, budget_usd,
           dietary_notes, interests, notes, language)
        VALUES
          ($1::uuid, $2::service_type, $3::uuid, $4::date, $5::date, $6::int, $7::numeric,
           $8::text, $9::text[], $10::text, 'es'::lang_code)
        RETURNING id
      `;
      const { rows } = await client.query(qi, [
        user.id, service_kind, destination_id, start_date, end_date, guests, budget_usd,
        dietary_notes, interests, notes
      ]);
      const newId = rows[0].id;

      if (catalog_id) {
        await client.query(
          `INSERT INTO ${SCHEMA}.request_items (request_id, catalog_id, quantity) VALUES ($1::uuid,$2::uuid,1)`,
          [newId, catalog_id]
        );
      }

      // ---- Correo: nueva solicitud
      const { subject, html } = emailTplNewRequest({ user, reqId: newId, payload: p });
      const mailRes = await sendMail({ to: user.email, subject, html });
      if (!mailRes.ok && !mailRes.skipped) console.error("email new request failed:", mailRes.error);

      // Copia opcional al admin con info básica:
      if (process.env.SMTP_CC_ADMIN) {
        await sendMail({
          to: process.env.SMTP_CC_ADMIN,
          subject: `📥 Nueva solicitud de ${user.email} (${newId})`,
          html: `<p>Cliente: ${user.email}</p><p>Folio: ${newId}</p><pre>${JSON.stringify(p, null, 2)}</pre>`
        });
      }

      return J(200, { ok: true, id: newId });
    } else {
      const q = `
        UPDATE ${SCHEMA}.requests r
        SET service_kind = $3::service_type,
            destination_id = $4::uuid,
            start_date = $5::date,
            end_date   = $6::date,
            guests     = $7::int,
            budget_usd = $8::numeric,
            dietary_notes = $9::text,
            interests = $10::text[],
            notes = $11::text,
            updated_at = now()
        WHERE r.id = $1::uuid AND r.client_id = $2::uuid
        RETURNING id
      `;
      const u = await client.query(q, [
        id, user.id, service_kind, destination_id, start_date, end_date,
        guests, budget_usd, dietary_notes, interests, notes
      ]);
      if (!u.rowCount) return J(404, { ok: false, error: "No encontrado" });

      await client.query(`DELETE FROM ${SCHEMA}.request_items WHERE request_id=$1`, [id]);
      if (catalog_id) {
        await client.query(
          `INSERT INTO ${SCHEMA}.request_items (request_id, catalog_id, quantity) VALUES ($1::uuid,$2::uuid,1)`,
          [id, catalog_id]
        );
      }
      return J(200, { ok: true, id });
    }
  } catch (e) {
    console.error("client-requests-upsert:", e);
    const msg = String(e?.message || e);
    if (/invalid input syntax for type uuid/i.test(msg))   return J(400, { ok: false, error: "UUID inválido" });
    if (/invalid input value for enum service_type/i.test(msg)) return J(400, { ok: false, error: "service_kind inválido" });
    if (/value for domain lang_code/i.test(msg))          return J(400, { ok: false, error: "Idioma inválido" });
    return J(500, { ok: false, error: "Error guardando solicitud" });
  } finally {
    try { await client.end(); } catch {}
  }
}

async function opClientRequestsStatus(event) {
  if (event.httpMethod !== "POST") return J(405, { ok: false, error: "Method Not Allowed" });
  const user = requireUser(event);
  if (!user?.id) return J(401, { ok: false, error: "Unauthorized" });

  let p = {};
  try { p = JSON.parse(event.body || "{}"); }
  catch { return J(400, { ok: false, error: "JSON inválido" }); }
  const { id, to_status } = p;
  if (!id || !to_status) return J(400, { ok: false, error: "id y to_status requeridos" });

  const client = makeClient();
  try {
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);

    const r = await client.query(`
      UPDATE ${SCHEMA}.requests
      SET current_status = $3::request_status, updated_at = now()
      WHERE id = $1::uuid AND client_id = $2::uuid
      RETURNING id
    `, [id, user.id, to_status]);

    if (!r.rowCount) return J(404, { ok: false, error: "No encontrado" });

    // ---- Correo: cambio de estado
    const { subject, html } = emailTplStatus({ user, reqId: id, toStatus: to_status });
    const mailRes = await sendMail({ to: user.email, subject, html });
    if (!mailRes.ok && !mailRes.skipped) console.error("email status failed:", mailRes.error);

    // Copia opcional al admin:
    if (process.env.SMTP_CC_ADMIN) {
      await sendMail({
        to: process.env.SMTP_CC_ADMIN,
        subject: `🔔 Estado actualizado (${id}) → ${to_status}`,
        html: `<p>Cliente: ${user.email}</p><p>Folio: ${id}</p><p>Nuevo estado: ${to_status}</p>`
      });
    }

    return J(200, { ok: true });
  } catch (e) {
    console.error("client-requests-status:", e);
    const msg = String(e?.message || e);
    if (/invalid input value for enum request_status/i.test(msg)) return J(400, { ok: false, error: "Estado inválido" });
    if (/Transición de estado no permitida/i.test(msg))           return J(400, { ok: false, error: msg });
    return J(500, { ok: false, error: "Error actualizando estado" });
  } finally {
    try { await client.end(); } catch {}
  }
}

/* -------------------- Adjuntos -------------------- */
async function opClientAttachmentsList(event) {
  const uid = requireUserId(event);
  if (!uid) return J(401, { ok: false, error: "Unauthorized" });

  const url = new URL(event.rawUrl || `http://x${event.path}`);
  const request_id = url.searchParams.get("request_id");
  if (!request_id) return J(400, { ok: false, error: "request_id requerido" });

  const client = makeClient();
  try {
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    const owner = await client.query(`SELECT 1 FROM ${SCHEMA}.requests WHERE id=$1::uuid AND client_id=$2::uuid`, [request_id, uid]);
    if (!owner.rowCount) return J(404, { ok: false, error: "No encontrado" });

    const { rows } = await client.query(`
      SELECT id, file_name, mime_type, size_bytes, storage_url, created_at
      FROM ${SCHEMA}.attachments
      WHERE request_id = $1::uuid
      ORDER BY created_at DESC
    `, [request_id]);
    return J(200, { ok: true, items: rows });
  } catch (e) {
    console.error("client-attachments-list:", e);
    return J(500, { ok: false, error: "Error listando adjuntos" });
  } finally {
    try { await client.end(); } catch {}
  }
}

/* -------------------- Calendario (cliente) -------------------- */
async function opClientCalendar(event) {
  const uid = requireUserId(event);
  if (!uid) return J(401, { ok: false, error: "Unauthorized" });

  const url = new URL(event.rawUrl || `http://x${event.path}`);
  const y = +(url.searchParams.get("year") || 0);
  const m = +(url.searchParams.get("month") || 0);

  const client = makeClient();
  try {
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);

    // Ejemplo simple: usa start_date/end_date como eventos
    const { rows } = await client.query(`
      SELECT id, service_kind, start_date, end_date, current_status
      FROM ${SCHEMA}.requests
      WHERE client_id = $1::uuid
        AND ((start_date IS NOT NULL) OR (end_date IS NOT NULL))
        AND (
          (EXTRACT(YEAR FROM COALESCE(start_date, end_date)) = $2)
          AND (EXTRACT(MONTH FROM COALESCE(start_date, end_date)) = $3)
        )
      ORDER BY COALESCE(start_date, end_date) ASC
    `, [uid, y, m]);

    const items = rows.map(r => ({
      id: r.id,
      title: r.service_kind,
      start: r.start_date,
      end: r.end_date,
      status: r.current_status || "new",
    }));

    return J(200, { ok: true, items });
  } catch (e) {
    console.error("client-calendar:", e);
    return J(500, { ok: false, error: "Error cargando calendario" });
  } finally {
    try { await client.end(); } catch {}
  }
}

/* -------------------- Ping -------------------- */
async function opPing() {
  const client = makeClient();
  try {
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    const { rows } = await client.query(`SELECT now() AS ts`);
    return J(200, { ok: true, ts: rows[0].ts });
  } catch (e) {
    return J(500, { ok: false, error: "DB error" });
  } finally {
    try { await client.end(); } catch {}
  }
}

/* -------------------- Router -------------------- */
export async function handler(event) {
  try {
    const op = (event.queryStringParameters && event.queryStringParameters.op) || "";

    if (event.httpMethod === "GET") {
      if (op === "public-destinations")   return opPublicDestinations();
      if (op === "public-services")       return opPublicServices();
      if (op === "client-requests-list")  return opClientRequestsList(event);
      if (op === "client-attachments-list") return opClientAttachmentsList(event);
      if (op === "client-calendar")       return opClientCalendar(event);
      if (op === "ping")                  return opPing();
      return J(404, { ok: false, error: "op desconocido (GET)" });
    }

    if (event.httpMethod === "POST") {
      if (op === "client-requests-upsert")  return opClientRequestsUpsert(event);
      if (op === "client-requests-status")  return opClientRequestsStatus(event);
      return J(404, { ok: false, error: "op desconocido (POST)" });
    }

    return J(405, { ok: false, error: "Method Not Allowed" });
  } catch (e) {
    console.error("api router:", e);
    return J(500, { ok: false, error: "Error interno" });
  }
}
