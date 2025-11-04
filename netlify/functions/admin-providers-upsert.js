const { Client } = require("pg");
const jwt = require("jsonwebtoken");

const SCHEMA = process.env.DB_SCHEMA || "concierium";
const ok  = (b)=>({statusCode:200,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify(b)});
const err = (s,b)=>({statusCode:s,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify(b)});

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
function requireAdmin(event){
  if(!process.env.JWT_SECRET) return { error: err(500,{ok:false,error:"Falta JWT_SECRET"}) };
  try{
    const h = event.headers||{};
    const raw = h.authorization||h.Authorization||"";
    if(!raw.startsWith("Bearer ")) return { error: err(401,{ok:false,error:"No autorizado"}) };
    const auth = jwt.verify(raw.slice(7), process.env.JWT_SECRET);
    const role = String(auth.role||"").toLowerCase();
    if(!(role==="admin"||role==="superadmin")) return { error: err(403,{ok:false,error:"Solo administradores"}) };
    return { auth };
  }catch{ return { error: err(401,{ok:false,error:"Token inválido"}) }; }
}

exports.handler = async (event)=>{
  try{
    if(event.httpMethod!=="POST") return err(405,{ok:false,error:"Method Not Allowed"});
    const { error } = requireAdmin(event); if(error) return error;

    let p={}; try{ p=JSON.parse(event.body||"{}"); }catch{ return err(400,{ok:false,error:"JSON inválido"}); }
    const id = p.id||null;
    const name = String(p.name||"").trim();
    const country = p.country ? String(p.country).trim() : null;
    const region  = p.region  ? String(p.region).trim()  : null;
    const sort_order = Number.isFinite(+p.sort_order) ? +p.sort_order : 100;
    const is_active  = typeof p.is_active==="boolean" ? p.is_active : (String(p.is_active||"true")==="true");

    if(!name) return err(400,{ok:false,error:"Nombre requerido"});

    const client = pgClient();
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);

    let rows;
    if(id){
      const q=`
        UPDATE ${SCHEMA}.destinations
        SET name=$1, country=$2, region=$3, sort_order=$4, is_active=$5, updated_at=now()
        WHERE id=$6
        RETURNING id::text, name, country, region, is_active, sort_order
      `;
      ({ rows } = await client.query(q,[name,country,region,sort_order,is_active,id]));
    }else{
      const q=`
        INSERT INTO ${SCHEMA}.destinations (name,country,region,sort_order,is_active)
        VALUES ($1,$2,$3,$4,$5)
        RETURNING id::text, name, country, region, is_active, sort_order
      `;
      ({ rows } = await client.query(q,[name,country,region,sort_order,is_active]));
    }
    await client.end();
    return ok({ ok:true, item: rows[0] });
  }catch(e){
    console.error("admin-destinations-upsert", e);
    return err(500,{ok:false,error:"Error interno"});
  }
};
