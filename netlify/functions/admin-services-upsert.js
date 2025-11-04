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
    const { error } = requireAdmin(event); if(error) return error;

    let p={}; try{ p=JSON.parse(event.body||"{}"); }catch{ return err(400,{ok:false,error:"JSON inválido"}); }
    const id = p.id||null;
    const kind = String(p.service_kind||"").trim();
    const name = String(p.name||"").trim();
    const description = p.description ? String(p.description) : null;
    const base_price_usd = (p.base_price_usd==null||p.base_price_usd==="") ? null : +p.base_price_usd;
    const destination_id = p.destination_id || null;
    const provider_id = p.provider_id || null;
    const is_active = typeof p.is_active==="boolean" ? p.is_active : (String(p.is_active||"true")==="true");

    if(!kind) return err(400,{ok:false,error:"service_kind requerido (lodging,tour,dining,vip)"});
    if(!name) return err(400,{ok:false,error:"name requerido"});

    const client=pgClient(); await client.connect(); await client.query(`SET search_path TO ${SCHEMA}, public`);
    let rows;
    if(id){
      const q=`
        UPDATE ${SCHEMA}.services_catalog
        SET service_kind=$1::${SCHEMA}.service_type, name=$2, description=$3,
            base_price_usd=$4, destination_id=$5, provider_id=$6, is_active=$7,
            updated_at=now()
        WHERE id=$8
        RETURNING id::text, service_kind::text AS kind, name, description, base_price_usd::text, is_active
      `;
      ({rows}=await client.query(q,[kind,name,description,base_price_usd,destination_id,provider_id,is_active,id]));
    }else{
      const q=`
        INSERT INTO ${SCHEMA}.services_catalog
          (service_kind,name,description,base_price_usd,destination_id,provider_id,is_active)
        VALUES ($1::${SCHEMA}.service_type,$2,$3,$4,$5,$6,$7)
        RETURNING id::text, service_kind::text AS kind, name, description, base_price_usd::text, is_active
      `;
      ({rows}=await client.query(q,[kind,name,description,base_price_usd,destination_id,provider_id,is_active]));
    }
    await client.end();
    return ok({ ok:true, item: rows[0] });
  }catch(e){
    console.error("admin-services-upsert",e);
    if(/invalid input value for enum/i.test(String(e?.message||e))){
      return err(400,{ok:false,error:"service_kind inválido. Usa: lodging,tour,dining,vip"});
    }
    return err(500,{ok:false,error:"Error interno"});
  }
};
