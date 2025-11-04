import { Client } from 'pg';
const SCHEMA = process.env.DB_SCHEMA || 'concierium';

export const handler = async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
  await c.connect();
  await c.query(`set search_path to ${SCHEMA}, public`);
  const { rows } = await c.query(
    `select id, service_kind, name, description, base_price_usd,
            destination_id, provider_id, is_active
     from services_catalog
     where is_active=true
     order by service_kind asc, name asc`);
  await c.end();
  return {
    statusCode:200,
    headers:{'content-type':'application/json'},
    body: JSON.stringify({ ok:true, items: rows })
  };
};
