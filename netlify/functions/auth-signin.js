import { Client } from "pg";
const SCHEMA = process.env.DB_SCHEMA || "concierium";

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const telRe   = /^[-0-9()+ ]{7,20}$/;

function J(s,b){return{statusCode:s,headers:{"content-type":"application/json; charset=utf-8"},body:JSON.stringify(b)}}

async function getRoleEnumLabels(client){
  const sql = `
    SELECT e.enumlabel
    FROM pg_attribute a
    JOIN pg_class c     ON a.attrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    JOIN pg_type t      ON a.atttypid = t.oid
    JOIN pg_enum e      ON t.oid = e.enumtypid
    WHERE n.nspname = $1 AND c.relname='users' AND a.attname='role'
    ORDER BY e.enumsortorder;
  `;
  const { rows } = await client.query(sql,[SCHEMA]);
  return rows.map(r=>r.enumlabel);
}

export async function handler(event){
  if (event.httpMethod !== "POST") return J(405,{ok:false,error:"Method Not Allowed"});

  const need=["PGHOST","PGUSER","PGPASSWORD","PGDATABASE"];
  const miss=need.filter(k=>!process.env[k]);
  if(miss.length) return J(500,{ok:false,where:"env",error:`missing: ${miss.join(", ")}`});

  let p={};
  try{ p = JSON.parse(event.body||"{}"); }
  catch{ return J(400,{ok:false,where:"parse",error:"Invalid JSON"}); }

  const full_name = String(p.full_name||"").trim();
  const email     = String(p.email||"").trim().toLowerCase();
  const password  = String(p.password||"");
  const phone     = String(p.phone||"").trim();
  const preferred = p.preferred_lang === "en" ? "en" : "es";

  if(full_name.length<3)      return J(400,{ok:false,error:"Nombre muy corto"});
  if(!emailRe.test(email))    return J(400,{ok:false,error:"Email inválido"});
  if(password.length<6)       return J(400,{ok:false,error:"Contraseña muy corta (mín. 6)"});
  if(phone && !telRe.test(phone)) return J(400,{ok:false,error:"Teléfono inválido"});

  const client=new Client({
    host:process.env.PGHOST,user:process.env.PGUSER,password:process.env.PGPASSWORD,
    database:process.env.PGDATABASE,port:+(process.env.PGPORT||5432),
    ssl:process.env.PGSSL==="true"?{rejectUnauthorized:false}:undefined
  });

  try{
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);

    const roleLabels = await getRoleEnumLabels(client);
    if(!roleLabels.length) return J(500,{ok:false,where:"enum",error:`No enum labels for ${SCHEMA}.users.role`});

    let role = roleLabels.includes("client") ? "client"
             : roleLabels.includes("admin")  ? "admin"
             : roleLabels[0];

    const q = `
      INSERT INTO ${SCHEMA}.users (full_name, email, phone, role, preferred_lang, is_active, mfa_enabled)
      VALUES ($1, $2::citext, NULLIF($3,''), $4::${SCHEMA}.role_type, $5::${SCHEMA}.lang_code, true, false)
      RETURNING id, full_name, email::text, phone, role::text, preferred_lang::text, is_active, mfa_enabled, created_at
    `;
    const vals=[full_name,email,phone,role,preferred];
    const { rows } = await client.query(q, vals);
    return J(200,{ok:true,user:rows[0]});

  }catch(e){
    const code = e?.code||null;
    const msg  = String(e?.message||e);

    if(code==="23505" || /duplicate key/i.test(msg))
      return J(409,{ok:false,code,error:"Este correo ya está registrado"});

    if(code==="22P02" || /invalid input value for enum/i.test(msg))
      return J(400,{ok:false,code,error:"Valor inválido en role o preferred_lang"});

    if(code==="42P01" || /relation .* does not exist/i.test(msg))
      return J(500,{ok:false,code,error:`Tabla ${SCHEMA}.users no existe`});

    if(code==="3F000" || /schema .* does not exist/i.test(msg))
      return J(500,{ok:false,code,error:`Esquema ${SCHEMA} no existe`});

    if(code==="28P01" || /password authentication failed/i.test(msg))
      return J(500,{ok:false,code,error:"Credenciales de base de datos inválidas"});

    if(/pg_hba\.conf|must use ssl|SSL/i.test(msg))
      return J(500,{ok:false,code,error:"Conexión rechazada/SSL requerido. Pon PGSSL=true"});

    console.error("auth-signin error:", e);
    return J(500,{ok:false,code,error:"Error interno",detail:msg});
  }finally{
    try{await client.end()}catch{}
  }
}
