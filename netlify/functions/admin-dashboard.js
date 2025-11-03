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
    const role = String(auth.role||"").toLowerCase();
    if(!(role==="admin" || role==="superadmin")) return err(403,{ok:false,error:"Solo administradores"});

    const client = pgClient();
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);

    // Totales por estado
    const byStatusSql = `
      SELECT current_status::text AS status, COUNT(*)::int AS total
      FROM ${SCHEMA}.requests
      GROUP BY current_status
      ORDER BY 2 DESC
    `;
    const totalSql = `SELECT COUNT(*)::int AS total FROM ${SCHEMA}.requests`;
    const recentSql = `
      SELECT r.id::text,
             u.full_name AS cliente,
             r.service_kind::text AS servicio,
             COALESCE(d.name,'—') AS destino,
             r.current_status::text AS estado,
             to_char(r.created_at,'YYYY-MM-DD HH24:MI') AS creada
      FROM ${SCHEMA}.requests r
      JOIN ${SCHEMA}.users u ON u.id = r.client_id
      LEFT JOIN ${SCHEMA}.destinations d ON d.id = r.destination_id
      ORDER BY r.created_at DESC
      LIMIT 10
    `;
    const slaSql = `
      SELECT id::text, created_at, first_change_at, proposal_at,
             breach_first_attention_2h, breach_proposal_48h
      FROM ${SCHEMA}.v_sla_breaches
      ORDER BY created_at DESC
      LIMIT 10
    `;

    const [byStatus, total, recent, sla] = await Promise.all([
      client.query(byStatusSql),
      client.query(totalSql),
      client.query(recentSql),
      client.query(slaSql)
    ]);

    await client.end();

    return ok({
      ok:true,
      total: total.rows[0]?.total||0,
      por_estado: byStatus.rows,
      recientes: recent.rows,
      sla: sla.rows
    });

  }catch(e){
    console.error("admin-dashboard", e);
    return err(500,{ok:false,error:"Error interno"});
  }
};
