import bcrypt from 'bcryptjs';
import { getPool, jsonResponse, optionsResponse } from './db.mjs';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST')
    return jsonResponse({ ok:false, error:'Method not allowed' }, 405);

  try {
    const body = JSON.parse(event.body || '{}');
    const { full_name, email, password, phone = null, preferred_lang = 'es' } = body;

    if (!full_name || !email || !password)
      return jsonResponse({ ok:false, error:'Faltan datos' }, 400);

    const password_hash = await bcrypt.hash(password, 10);
    const pool = getPool();

    const q = `
      INSERT INTO concierium.users (full_name, email, phone, preferred_lang, role, password_hash)
      VALUES ($1,$2,$3,$4,'client',$5)
      ON CONFLICT (email) DO UPDATE
      SET full_name=EXCLUDED.full_name,
          phone=EXCLUDED.phone,
          preferred_lang=EXCLUDED.preferred_lang,
          password_hash=EXCLUDED.password_hash
      RETURNING id, full_name, email, role, preferred_lang, is_active, created_at;
    `;
    const { rows } = await pool.query(q, [full_name, email, phone, preferred_lang, password_hash]);

    return jsonResponse({ ok:true, user: rows[0] }, 201);
  } catch (e) {
    console.error('signin error', e);
    return jsonResponse({ ok:false, error:'No se pudo registrar' }, 500);
  }
}
