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
    const client=pgClient(); await client.connect(); await client.query(`SET search_path TO ${SCHEMA}, public`);
    const q=`
      SELECT s.id::text, s.service_kind::text AS kind, s.name, s.description,
             s.base_price_usd::text AS base_price_usd,
             d.name AS destination, p.name AS provider, s.is_active
      FROM ${SCHEMA}.services_catalog s
      LEFT JOIN ${SCHEMA}.destinations d ON d.id = s.destination_id
      LEFT JOIN ${SCHEMA}.providers p ON p.id = s.provider_id
      ORDER BY s.is_active DESC, s.created_at DESC
      LIMIT 200
    `;
    const { rows } = await client.query(q); await client.end();
    return ok({ ok:true, items: rows });
  }catch(e){ console.error("admin-services-list",e); return err(500,{ok:false,error:"Error interno"}); }
};
