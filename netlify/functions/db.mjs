import pg from 'pg';

const { Pool } = pg;

// Reusa el pool entre invocaciones (Netlify mantiene caliente el proceso)
let _pool;
export function getPool() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL, // ej: postgres://...neon.tech/DB?sslmode=require
      ssl: { rejectUnauthorized: false }
    });
  }
  return _pool;
}

// Utilidad para JSON + CORS
export function jsonResponse(data, status = 200) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
    },
    body: JSON.stringify(data)
  };
}

export function optionsResponse() {
  return {
    statusCode: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
    }
  };
}
