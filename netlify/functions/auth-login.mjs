import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getPool, jsonResponse, optionsResponse } from './db.mjs';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST')
    return jsonResponse({ ok:false, error:'Method not allowed' }, 405);

  try {
    const { email, password } = JSON.parse(event.body || '{}');
    if (!email || !password)
      return jsonResponse({ ok:false, error:'Email y password requeridos' }, 400);

    const pool = getPool();
    const q = `
      SELECT id, full_name, email, role, preferred_lang, is_active, password_hash
      FROM concierium.users
      WHERE email = $1
      LIMIT 1;
    `;
    const { rows } = await pool.query(q, [email]);
    if (!rows.length) return jsonResponse({ ok:false, error:'Credenciales inválidas' }, 401);

    const u = rows[0];
    const valid = u.password_hash ? await bcrypt.compare(password, u.password_hash) : false;
    if (!valid) return jsonResponse({ ok:false, error:'Credenciales inválidas' }, 401);
    if (!u.is_active) return jsonResponse({ ok:false, error:'Usuario inactivo' }, 403);

    // Genera JWT (opcional para admin/cliente)
    const token = jwt.sign(
      { sub: u.id, role: u.role, email: u.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    const user = { id: u.id, full_name: u.full_name, email: u.email, role: u.role, preferred_lang: u.preferred_lang };
    return jsonResponse({ ok:true, user, token });
  } catch (e) {
    console.error('login error', e);
    return jsonResponse({ ok:false, error:'No se pudo iniciar sesión' }, 500);
  }
}
