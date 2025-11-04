import { Client } from 'pg';
const SCHEMA = process.env.DB_SCHEMA || 'concierium';

export const handler = async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
  await c.connect();
  await c.query(`set search_path to ${SCHEMA}, public`);
  const { rows } = await c.query(
    `select id, name, country, region, sort_order, is_active
     from destinations where is_active=true order by sort_order asc, name asc`);
  await c.end();
  return {
    statusCode:200,
    headers:{'content-type':'application/json'},
    body: JSON.stringify({ ok:true, items: rows })
  };
};
