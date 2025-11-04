// netlify/functions/api.js — ESM, una sola function router con calendario y correos
import { Client } from "pg";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";

const SCHEMA = process.env.DB_SCHEMA || "concierium";

// ---------- helpers base ----------
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
    return { id: c?.sub, email: c?.email, name: c?.name, role: (c?.role||"client").toLowerCase() };
  } catch {
    return null;
  }
}
function requireAdmin(event) {
  const u = requireUser(event);
  if (!u) return null;
  const r = (u.role||"client").toLowerCase();
  return (r === "admin" || r === "superadmin") ? u : null;
}

// ---------- correo ----------
async function getTransport() {
  const host = process.env.SMTP_HOST;
  const port = +(process.env.SMTP_PORT||0);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !port || !user || !pass) return null;
  return nodemailer.createTransport({ host, port, secure: port===465, auth: { user, pass } });
}
async function sendMailSafe({ to, subject, html }) {
  try {
    const t = await getTransport();
    if (!t) { console.log("[mail] SMTP no configurado; to:", to, "subject:", subject); return { ok:false, skipped:true }; }
    const from = process.env.FROM_EMAIL || "no-reply@concierium.test";
    await t.sendMail({ from, to, subject, html });
    return { ok:true };
  } catch (e) {
    console.error("[mail] error:", e);
    return { ok:false, error:String(e?.message||e) };
  }
}

// ---------- utils calendario ----------
function mapRequestToEvent(row) {
  // Un evento por solicitud (usa start_date/end_date si existen; si no, created_at)
  const start = row.start_date || row.created_at;
  const end   = row.end_date   || row.start_date || row.created_at;
  const title = `${row.servicio || row.service_kind} ${row.destino ? "· "+row.destino : ""}`.trim();
  return {
    id: row.id,
    title,
    status: row.current_status,
    start, end,
    service_kind: row.service_kind,
    destination: row.destino || null,
  };
}

// ---------- endpoints públicos ----------
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
  } finally { try { await client.end(); } catch {} }
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
  } finally { try { await client.end(); } catch {} }
}

// ---------- CLIENTE ----------
async function opClientRequestsList(event) {
  const u = requireUser(event);
  if (!u?.id) return J(401, { ok:false, error: "Unauthorized" });
  const url = new URL(event.rawUrl || `http://x${event.path}${event.queryStringParameters ? '?' + new URLSearchParams(event.queryStringParameters) : ''}`);
  const status = url.searchParams.get('status');

  const client = makeClient();
  try {
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);

    const params = [u.id];
    let where = `r.client_id = $1`;
    if (status) { params.push(status); where += ` AND r.current_status = $2`; }

    const q = `
      SELECT r.*, 
             sc.name AS servicio, sc.service_kind AS servicio_kind,
             d.name  AS destino
      FROM ${SCHEMA}.requests r
      LEFT JOIN ${SCHEMA}.request_items    ri ON ri.request_id = r.id
      LEFT JOIN ${SCHEMA}.services_catalog sc ON sc.id = ri.catalog_id
      LEFT JOIN ${SCHEMA}.destinations     d  ON d.id = r.destination_id
      WHERE ${where}
      ORDER BY r.created_at DESC
      LIMIT 300
    `;
    const { rows } = await client.query(q, params);
    return J(200, { ok:true, items: rows });
  } catch (e) {
    console.error("client-requests-list:", e);
    const msg = String(e?.message || e);
    if (/relation .*requests.* does not exist/i.test(msg)) return J(500, { ok:false, error: `No existe la tabla ${SCHEMA}.requests` });
    return J(500, { ok:false, error: "Error listando solicitudes" });
  } finally { try { await client.end(); } catch {} }
}

async function opClientRequestsUpsert(event) {
  if (event.httpMethod !== 'POST') return J(405, { ok:false, error:'Method Not Allowed' });
  const user = requireUser(event);
  if (!user?.id) return J(401, { ok:false, error:'Unauthorized' });

  let p={}; try { p = JSON.parse(event.body||"{}"); } catch { return J(400, { ok:false, error:'JSON inválido' }); }

  const id = p.id || null;
  const service_kind = p.service_kind;
  if (!service_kind) return J(400, { ok:false, error:'service_kind requerido' });

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
        RETURNING id, created_at
      `;
      const { rows } = await client.query(qi, [
        user.id, service_kind, destination_id, start_date, end_date, guests, budget_usd,
        dietary_notes, interests, notes
      ]);
      const newId = rows[0].id;

      // vincular item si hay
      if (catalog_id) {
        await client.query(
          `INSERT INTO ${SCHEMA}.request_items (request_id, catalog_id, quantity) VALUES ($1::uuid,$2::uuid,1)`,
          [newId, catalog_id]
        );
      }

      // ---- correo confirmación creación
      await sendMailSafe({
        to: user.email,
        subject: `Concierium · Nueva solicitud ${newId}`,
        html: `
          <h2>Tu solicitud fue creada</h2>
          <p><b>ID:</b> ${newId}</p>
          <p><b>Servicio:</b> ${service_kind}</p>
          <p><b>Destino:</b> ${destination_id || '—'} · <b>Fechas:</b> ${start_date || '—'} a ${end_date || '—'}</p>
          <p>Te avisaremos cualquier actualización de estado.</p>
        `
      });

      return J(200, { ok:true, id:newId });
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
      if (!u.rowCount) return J(404, { ok:false, error:'No encontrado' });
      return J(200, { ok:true, id });
    }
  } catch (e) {
    console.error("client-requests-upsert:", e);
    const msg = String(e?.message || e);
    if (/invalid input syntax for type uuid/i.test(msg))   return J(400, { ok:false, error: 'UUID inválido' });
    if (/invalid input value for enum service_type/i.test(msg)) return J(400, { ok:false, error: 'service_kind inválido' });
    return J(500, { ok:false, error: 'Error guardando solicitud' });
  } finally { try { await client.end(); } catch {} }
}

async function opClientRequestsStatus(event) {
  if (event.httpMethod !== 'POST') return J(405, { ok:false, error:'Method Not Allowed' });
  const u = requireUser(event);
  if (!u?.id) return J(401, { ok:false, error:'Unauthorized' });

  let p={}; try{ p = JSON.parse(event.body||"{}"); }catch{ return J(400, { ok:false, error:'JSON inválido' }); }
  const { id, to_status } = p;
  if (!id || !to_status) return J(400, { ok:false, error:'id y to_status requeridos' });

  const client = makeClient();
  try {
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);

    // Actualizar con policy de transición
    const r = await client.query(`
      UPDATE ${SCHEMA}.requests
      SET current_status = $3::request_status, updated_at = now()
      WHERE id = $1::uuid AND client_id = $2::uuid
      RETURNING id, service_kind, destination_id, start_date, end_date, current_status
    `, [id, u.id, to_status]);

    if (!r.rowCount) return J(404, { ok:false, error:'No encontrado' });

    // Email al cliente (propio)
    await sendMailSafe({
      to: u.email,
      subject: `Concierium · Estado actualizado (${to_status}) — ${id}`,
      html: `
        <h2>Tu solicitud cambió de estado</h2>
        <p><b>ID:</b> ${id}</p>
        <p><b>Nuevo estado:</b> ${to_status}</p>
        <p><b>Servicio:</b> ${r.rows[0].service_kind} · <b>Destino:</b> ${r.rows[0].destination_id || '—'}</p>
        <p><b>Fechas:</b> ${r.rows[0].start_date || '—'} a ${r.rows[0].end_date || '—'}</p>
      `
    });

    return J(200, { ok:true });
  } catch (e) {
    console.error("client-requests-status:", e);
    const msg = String(e?.message || e);
    if (/invalid input value for enum request_status/i.test(msg)) return J(400, { ok:false, error: 'Estado inválido' });
    if (/Transición de estado no permitida/i.test(msg))           return J(400, { ok:false, error: msg });
    return J(500, { ok:false, error: 'Error actualizando estado' });
  } finally { try { await client.end(); } catch {} }
}

async function opClientAttachmentsList(event) {
  const u = requireUser(event);
  if (!u?.id) return J(401, { ok:false, error: 'Unauthorized' });
  const url = new URL(event.rawUrl || `http://x${event.path}${event.queryStringParameters ? '?' + new URLSearchParams(event.queryStringParameters) : ''}`);
  const request_id = url.searchParams.get('request_id');
  if (!request_id) return J(400, { ok:false, error:'request_id requerido' });

  const client = makeClient();
  try {
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    const owner = await client.query(`SELECT 1 FROM ${SCHEMA}.requests WHERE id=$1::uuid AND client_id=$2::uuid`, [request_id, u.id]);
    if (!owner.rowCount) return J(404, { ok:false, error:'No encontrado' });

    const { rows } = await client.query(`
      SELECT id, file_name, mime_type, size_bytes, storage_url, created_at
      FROM ${SCHEMA}.attachments
      WHERE request_id = $1::uuid
      ORDER BY created_at DESC
    `, [request_id]);
    return J(200, { ok:true, items: rows });
  } catch (e) {
    console.error("client-attachments-list:", e);
    return J(500, { ok:false, error:'Error listando adjuntos' });
  } finally { try { await client.end(); } catch {} }
}

// ---------- Calendario CLIENTE ----------
async function opClientCalendar(event) {
  const u = requireUser(event);
  if (!u?.id) return J(401, { ok:false, error:'Unauthorized' });

  const url = new URL(event.rawUrl || `http://x${event.path}${event.queryStringParameters ? '?' + new URLSearchParams(event.queryStringParameters) : ''}`);
  const y = +(url.searchParams.get('year') || 0);
  const m = +(url.searchParams.get('month') || 0); // 1..12 opcional — (no imprescindible)

  const client = makeClient();
  try {
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    // Traemos todas las solicitudes del usuario (puedes filtrar por rango si quieres)
    const { rows } = await client.query(`
      SELECT r.*, sc.name AS servicio, d.name AS destino
      FROM ${SCHEMA}.requests r
      LEFT JOIN ${SCHEMA}.request_items ri ON ri.request_id = r.id
      LEFT JOIN ${SCHEMA}.services_catalog sc ON sc.id = ri.catalog_id
      LEFT JOIN ${SCHEMA}.destinations d ON d.id = r.destination_id
      WHERE r.client_id = $1
      ORDER BY COALESCE(r.start_date, r.created_at) ASC
      LIMIT 200
    `, [u.id]);

    const events = rows.map(mapRequestToEvent);
    // si pasaron year/month, filtramos
    let filtered = events;
    if (y && m) {
      filtered = events.filter(ev => {
        const sd = new Date(ev.start||ev.end||Date.now());
        return (sd.getUTCFullYear()===y && (sd.getUTCMonth()+1)===m);
      });
    }
    return J(200, { ok:true, items: filtered });
  } catch (e) {
    console.error("client-calendar:", e);
    return J(500, { ok:false, error:'Error cargando calendario' });
  } finally { try { await client.end(); } catch {} }
}

// ---------- ADMIN ----------
async function opAdminRequestsStatus(event) {
  if (event.httpMethod !== 'POST') return J(405, { ok:false, error:'Method Not Allowed' });
  const admin = requireAdmin(event);
  if (!admin) return J(401, { ok:false, error:'Unauthorized' });

  let p={}; try{ p = JSON.parse(event.body||"{}"); }catch{ return J(400, { ok:false, error:'JSON inválido' }); }
  const { id, to_status } = p;
  if (!id || !to_status) return J(400, { ok:false, error:'id y to_status requeridos' });

  const client = makeClient();
  try {
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    // obtenemos email del cliente para notificar
    const info = await client.query(`
      SELECT r.id, r.client_id, u.email::text AS email, r.service_kind, r.destination_id, r.start_date, r.end_date
      FROM ${SCHEMA}.requests r
      JOIN ${SCHEMA}.users u ON u.id = r.client_id
      WHERE r.id = $1::uuid
      LIMIT 1
    `, [id]);
    if (!info.rowCount) return J(404, { ok:false, error:'No encontrado' });

    const upd = await client.query(`
      UPDATE ${SCHEMA}.requests SET current_status=$2::request_status, updated_at=now() WHERE id=$1::uuid
      RETURNING id
    `, [id, to_status]);
    if (!upd.rowCount) return J(500, { ok:false, error:'No se pudo actualizar' });

    // email al cliente
    await sendMailSafe({
      to: info.rows[0].email,
      subject: `Concierium · Estado actualizado (${to_status}) — ${id}`,
      html: `
        <h2>Tu solicitud cambió de estado</h2>
        <p><b>ID:</b> ${id}</p>
        <p><b>Nuevo estado:</b> ${to_status}</p>
        <p><b>Servicio:</b> ${info.rows[0].service_kind} · <b>Destino:</b> ${info.rows[0].destination_id || '—'}</p>
        <p><b>Fechas:</b> ${info.rows[0].start_date || '—'} a ${info.rows[0].end_date || '—'}</p>
      `
    });

    return J(200, { ok:true });
  } catch (e) {
    console.error("admin-requests-status:", e);
    const msg = String(e?.message || e);
    if (/invalid input value for enum request_status/i.test(msg)) return J(400, { ok:false, error:'Estado inválido' });
    if (/Transición de estado no permitida/i.test(msg))           return J(400, { ok:false, error: msg });
    return J(500, { ok:false, error:'Error actualizando estado' });
  } finally { try { await client.end(); } catch {} }
}

async function opAdminCalendar(event) {
  const admin = requireAdmin(event);
  if (!admin) return J(401, { ok:false, error:'Unauthorized' });

  const url = new URL(event.rawUrl || `http://x${event.path}${event.queryStringParameters ? '?' + new URLSearchParams(event.queryStringParameters) : ''}`);
  const y = +(url.searchParams.get('year') || 0);
  const m = +(url.searchParams.get('month') || 0);

  const client = makeClient();
  try {
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    const { rows } = await client.query(`
      SELECT r.*, sc.name AS servicio, d.name AS destino
      FROM ${SCHEMA}.requests r
      LEFT JOIN ${SCHEMA}.request_items ri ON ri.request_id = r.id
      LEFT JOIN ${SCHEMA}.services_catalog sc ON sc.id = ri.catalog_id
      LEFT JOIN ${SCHEMA}.destinations d ON d.id = r.destination_id
      ORDER BY COALESCE(r.start_date, r.created_at) ASC
      LIMIT 500
    `);
    const events = rows.map(mapRequestToEvent);
    let filtered = events;
    if (y && m) {
      filtered = events.filter(ev => {
        const sd = new Date(ev.start||ev.end||Date.now());
        return (sd.getUTCFullYear()===y && (sd.getUTCMonth()+1)===m);
      });
    }
    return J(200, { ok:true, items: filtered });
  } catch (e) {
    console.error("admin-calendar:", e);
    return J(500, { ok:false, error:'Error cargando calendario' });
  } finally { try { await client.end(); } catch {} }
}

// ---------- ping ----------
async function opPing() {
  const client = makeClient();
  try {
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    const { rows } = await client.query(`SELECT now() AS ts`);
    return J(200, { ok: true, ts: rows[0].ts });
  } catch (e) {
    return J(500, { ok: false, error: "DB error" });
  } finally { try { await client.end(); } catch {} }
}

// ---------- router ----------
export async function handler(event) {
  try {
    const op = (event.queryStringParameters && event.queryStringParameters.op) || '';
    if (!op) return J(400, { ok:false, error:'op requerido' });

    if (event.httpMethod === 'GET') {
      if (op === 'public-destinations')   return opPublicDestinations();
      if (op === 'public-services')       return opPublicServices();
      if (op === 'client-requests-list')  return opClientRequestsList(event);
      if (op === 'client-attachments-list') return opClientAttachmentsList(event);
      if (op === 'client-calendar')       return opClientCalendar(event);
      if (op === 'admin-calendar')        return opAdminCalendar(event);
      if (op === 'ping')                  return opPing();
      return J(404, { ok:false, error:'op desconocido (GET)' });
    }

    if (event.httpMethod === 'POST') {
      if (op === 'client-requests-upsert') return opClientRequestsUpsert(event);
      if (op === 'client-requests-status') return opClientRequestsStatus(event);
      if (op === 'admin-requests-status')  return opAdminRequestsStatus(event);
      return J(404, { ok:false, error:'op desconocido (POST)' });
    }

    return J(405, { ok:false, error:'Method Not Allowed' });
  } catch (e) {
    console.error("api router:", e);
    return J(500, { ok:false, error:'Error interno' });
  }
}
