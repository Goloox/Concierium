import { Client } from 'pg';
const SCHEMA = process.env.DB_SCHEMA || 'concierium';
export const handler = async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
  await c.connect();
  await c.query(`set search_path to ${SCHEMA}, public`);
  const { rows } = await c.query(`
    select sc.id, sc.service_kind, sc.name, sc.description, sc.base_price_usd, sc.is_active,
           sc.destination_id,
           d.name as destination,
           sc.provider_id,
           p.name as provider
    from services_catalog sc
    left join destinations d on d.id = sc.destination_id
    left join providers    p on p.id = sc.provider_id
    order by sc.service_kind asc, sc.name asc`);
  await c.end();
  return { statusCode:200, headers:{'content-type':'application/json'},
    body: JSON.stringify({ ok:true, items: rows }) };
};
