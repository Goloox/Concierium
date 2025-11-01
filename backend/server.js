import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================
//  AUTH: SIGN IN + LOGIN
// ============================

// SIGN IN (crear cuenta)
app.post('/api/auth/signin', async (req, res) => {
  try {
    const { full_name, email, password, phone, preferred_lang = 'es' } = req.body;
    if (!full_name || !email || !password)
      return res.status(400).json({ ok: false, error: 'Faltan datos' });

    const hash = await bcrypt.hash(password, 10);
    const q = `
      INSERT INTO concierium.users (full_name, email, phone, preferred_lang, role, password_hash)
      VALUES ($1, $2, $3, $4, 'client', $5)
      ON CONFLICT (email) DO UPDATE
      SET full_name = EXCLUDED.full_name,
          phone = EXCLUDED.phone,
          preferred_lang = EXCLUDED.preferred_lang,
          password_hash = EXCLUDED.password_hash
      RETURNING id, full_name, email, role, preferred_lang;
    `;
    const { rows } = await pool.query(q, [full_name, email, phone, preferred_lang, hash]);
    res.json({ ok: true, user: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'Error al registrar' });
  }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ ok: false, error: 'Faltan datos' });

    const q = `SELECT * FROM concierium.users WHERE email = $1 LIMIT 1;`;
    const { rows } = await pool.query(q, [email]);
    if (!rows.length) return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });

    const u = rows[0];
    const valid = u.password_hash ? await bcrypt.compare(password, u.password_hash) : false;
    if (!valid) return res.status(401).json({ ok: false, error: 'Contraseña incorrecta' });

    res.json({
      ok: true,
      user: {
        id: u.id,
        full_name: u.full_name,
        email: u.email,
        role: u.role,
        preferred_lang: u.preferred_lang
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'Error iniciando sesión' });
  }
});

// ============================
//  ARCHIVOS ESTÁTICOS
// ============================

// Sirve HTMLs base
app.use(express.static(path.join(__dirname, '..')));

// ============================
//  ARRANQUE DEL SERVIDOR
// ============================
app.listen(PORT, () => console.log(`Servidor Concierium en http://localhost:${PORT}`));
