const { Client } = require("pg");
const jwt = require("jsonwebtoken");
const SCHEMA = process.env.DB_SCHEMA || "concierium";
const ok=(b)=>({statusCode:200,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify(b)});
const err=(s,b)=>({statusCode:s,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify(b)});
function pgClient(){ if(process.env.DATABASE_URL){ return new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});} return new Client({host:process.env.PGHOST,user:process.env.PGUSER,password:process.env.PGPASSWORD,database:process.env.PGDATABASE,port:+(process.env.PGPORT||5432),ssl:process.env.PGSSL==="true"?{rejectUnauthorized:false}:undefined}); }
function requireAdmin(event){ if(!process.env.JWT_SECRET) return { error: err(500,{ok:false,error:"Falta JWT_SECRET"}) }; try{const h=event.headers||{};const raw=h.authorization||h.Authorization||""; if(!raw.startsWith("Bearer ")) return { error: err(401,{ok:false,error:"No autorizado"}) }; const auth=jwt.verify(raw.slice(7),process.env.JWT_SECRET); const role=String(auth.role||"").toLowerCase(); if(!(role==="admin"||role==="superadmin")) return { error: err(403,{ok:false,error:"Solo administradores"}) }; return { auth }; }catch{ return { error: err(401,{ok:false,error:"Token inválido"}) }; }
exports.handler = async (event)=>{
  try{
    if(event.httpMethod!=="POST") return err(405,{ok:false,error:"Method Not Allowed"});
    const { auth, error } = requireAdmin(event); if(error) return error;

    let p={}; try{ p=JSON.parse(event.body||"{}"); }catch{ return err(400,{ok:false,error:"JSON inválido"}); }
    const id = p.id; const to_status = String(p.to_status||"").trim(); const note = p.note?String(p.note):null;
    if(!id||!to_status) return err(400,{ok:false,error:"id y to_status son requeridos"});

    const client=pgClient(); await client.connect(); await client.query(`SET search_path TO ${SCHEMA}, public`);
    try{
      const q=`UPDATE ${SCHEMA}.requests SET current_status=$1::${SCHEMA}.request_status, assigned_admin_id=COALESCE(assigned_admin_id,$2) WHERE id=$3 RETURNING id::text, current_status::text AS estado`;
      const { rows } = await client.query(q,[to_status,auth.sub,id]);
      if(note){
        await client.query(`INSERT INTO ${SCHEMA}.status_history (request_id, from_status, to_status, changed_by, note) VALUES ($1,NULL,$2::${SCHEMA}.request_status,$3,$4)`,[id,to_status,auth.sub,note]);
      }
      await client.end();
      return ok({ ok:true, item: rows[0] });
    }catch(e){
      await client.end();
      const msg=String(e?.message||e);
      if(/Transición de estado no permitida/i.test(msg)) return err(409,{ok:false,error:msg});
      if(/invalid input value for enum/i.test(msg)) return err(400,{ok:false,error:"to_status inválido. Usa: new,curation,proposal_sent,confirmed,closed,discarded"});
      console.error("admin-requests-status",e);
      return err(500,{ok:false,error:"Error interno"});
    }
  }catch(e){
    console.error("admin-requests-status outer",e);
    return err(500,{ok:false,error:"Error interno"});
  }
};
