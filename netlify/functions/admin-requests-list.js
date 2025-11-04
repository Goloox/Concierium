const { Client } = require("pg");
const jwt = require("jsonwebtoken");
const SCHEMA = process.env.DB_SCHEMA || "concierium";
const ok=(b)=>({statusCode:200,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify(b)});
const err=(s,b)=>({statusCode:s,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify(b)});
function pgClient(){ if(process.env.DATABASE_URL){ return new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});} return new Client({host:process.env.PGHOST,user:process.env.PGUSER,password:process.env.PGPASSWORD,database:process.env.PGDATABASE,port:+(process.env.PGPORT||5432),ssl:process.env.PGSSL==="true"?{rejectUnauthorized:false}:undefined}); }
function requireAdmin(event){ if(!process.env.JWT_SECRET) return { error: err(500,{ok:false,error:"Falta JWT_SECRET"}) }; try{const h=event.headers||{};const raw=h.authorization||h.Authorization||""; if(!raw.startsWith("Bearer ")) return { error: err(401,{ok:false,error:"No autorizado"}) }; const auth=jwt.verify(raw.slice(7),process.env.JWT_SECRET); const role=String(auth.role||"").toLowerCase(); if(!(role==="admin"||role==="superadmin")) return { error: err(403,{ok:false,error:"Solo administradores"}) }; return { auth }; }catch{ return { error: err(401,{ok:false,error:"Token inválido"}) }; }
exports.handler = async (event)=>{
  try{
    if(event.httpMethod!=="GET") return err(405,{ok:false,error:"Method Not Allowed"});
    const { error } = requireAdmin(event); if(error) return error;

    const url = new URL(event.rawUrl || `https://example.com${event.path}${event.queryStringParameters ? '?'+new URLSearchParams(event.queryStringParameters) : ''}`);
    const status = url.searchParams.get("status");
    const limit  = Math.min(+(url.searchParams.get("limit")||50),200);

    const client=pgClient(); await client.connect(); await client.query(`SET search_path TO ${SCHEMA}, public`);
    const base = `
      SELECT r.id::text, u.full_name AS cliente, r.service_kind::text AS servicio,
             COALESCE(d.name,'—') AS destino, r.current_status::text AS estado,
             to_char(r.created_at,'YYYY-MM-DD HH24:MI') AS creada
      FROM ${SCHEMA}.requests r
      JOIN ${SCHEMA}.users u ON u.id = r.client_id
      LEFT JOIN ${SCHEMA}.destinations d ON d.id = r.destination_id
    `;
    let q, params;
    if(status){
      q = `${base} WHERE r.current_status=$1::${SCHEMA}.request_status ORDER BY r.created_at DESC LIMIT $2`;
      params=[status,limit];
    }else{
      q = `${base} ORDER BY r.created_at DESC LIMIT $1`;
      params=[limit];
    }
    const { rows } = await client.query(q, params);
    await client.end();
    return ok({ ok:true, items: rows });
  }catch(e){ console.error("admin-requests-list",e); return err(500,{ok:false,error:"Error interno"}); }
};
