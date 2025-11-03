// CommonJS
const { Client } = require("pg");
const jwt = require("jsonwebtoken");

const SCHEMA = process.env.DB_SCHEMA || "concierium";
const ok = (b)=>({statusCode:200,headers:{'content-type':'application/json'},body:JSON.stringify(b)});
const err=(s,e)=>({statusCode:s,headers:{'content-type':'application/json'},body:JSON.stringify(e)});

function pgClient(){
  if(process.env.DATABASE_URL){
    return new Client({ connectionString:process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
  }
  return new Client({
    host:process.env.PGHOST, user:process.env.PGUSER, password:process.env.PGPASSWORD,
    database:process.env.PGDATABASE, port:+(process.env.PGPORT||5432),
    ssl:process.env.PGSSL==="true"?{rejectUnauthorized:false}:undefined
  });
}

function getAuthUser(event){
  try{
    const h = event.headers||{};
    const raw = h.authorization||h.Authorization||"";
    if(!raw.startsWith("Bearer ")) return null;
    return jwt.verify(raw.slice(7), process.env.JWT_SECRET);
  }catch{return null;}
}

exports.handler = async (event)=>{
  try{
    if(event.httpMethod!=="GET") return err(405,{ok:false,error:"Method Not Allowed"});
    if(!process.env.JWT_SECRET) return err(500,{ok:false,error:"Falta JWT_SECRET"});

    const auth = getAuthUser(event);
    if(!auth?.sub) return err(401,{ok:false,error:"No autorizado"});

    const client = pgClient();
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);

    // KPIs
    const activeSql = `
      SELECT count(*)::int AS n
      FROM ${SCHEMA}.requests
      WHERE client_id = $1
        AND current_status IN ('new','curation','proposal_sent','confirmed')
    `;
    const lastSql = `
      SELECT id, current_status::text AS status, updated_at
      FROM ${SCHEMA}.requests
      WHERE client_id = $1
      ORDER BY updated_at DESC NULLS LAST, created_at DESC
      LIMIT 1
    `;
    const listSql = `
      SELECT r.id::text,
             r.service_kind::text AS servicio,
             COALESCE(d.name,'—') AS destino,
             COALESCE(to_char(r.start_date,'YYYY-MM-DD'),'—') AS fecha_inicio,
             COALESCE(to_char(r.end_date,'YYYY-MM-DD'),'—')   AS fecha_fin,
             r.current_status::text AS estado
      FROM ${SCHEMA}.requests r
      LEFT JOIN ${SCHEMA}.destinations d ON d.id = r.destination_id
      WHERE r.client_id = $1
      ORDER BY r.created_at DESC
      LIMIT 5
    `;

    const [{rows:activeRows},{rows:lastRows},{rows:listRows}] = await Promise.all([
      client.query(activeSql,[auth.sub]),
      client.query(lastSql,[auth.sub]),
      client.query(listSql,[auth.sub]),
    ]);

    // Recomendación simple: último destino usado por el cliente
    const recoSql = `
      SELECT d.name AS destino
      FROM ${SCHEMA}.requests r
      LEFT JOIN ${SCHEMA}.destinations d ON d.id = r.destination_id
      WHERE r.client_id = $1 AND d.name IS NOT NULL
      ORDER BY r.updated_at DESC NULLS LAST, r.created_at DESC
      LIMIT 1
    `;
    const { rows:recoRows } = await client.query(recoSql, [auth.sub]);

    await client.end();

    return ok({
      ok:true,
      kpis:{
        activas: activeRows[0]?.n || 0,
        ultimo_estado: lastRows[0]?.status || null,
        ultimo_id: lastRows[0]?.id || null,
      },
      recomendado: recoRows[0]?.destino || null,
      solicitudes: listRows
    });

  }catch(e){
    console.error("client-dashboard", e);
    return err(500,{ok:false,error:"Error interno"});
  }
};
