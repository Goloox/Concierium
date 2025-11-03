import { Client } from "pg";
const SCHEMA = process.env.DB_SCHEMA || "concierium";
const j=(s,b)=>({statusCode:s,headers:{"content-type":"application/json"},body:JSON.stringify(b)});
export async function handler(){
  const need=["PGHOST","PGUSER","PGPASSWORD","PGDATABASE"];
  const miss=need.filter(k=>!process.env[k]);
  if(miss.length) return j(500,{ok:false,where:"env",error:`missing: ${miss.join(", ")}`});
  const c=new Client({
    host:process.env.PGHOST, user:process.env.PGUSER, password:process.env.PGPASSWORD,
    database:process.env.PGDATABASE, port:+(process.env.PGPORT||5432),
    ssl:process.env.PGSSL==="true"?{rejectUnauthorized:false}:undefined
  });
  try{
    await c.connect();
    await c.query(`SET search_path TO ${SCHEMA}, public`);
    const hasUsers = await c.query(
      "select 1 from information_schema.tables where table_schema=$1 and table_name='users' limit 1",[SCHEMA]
    );
    const count = hasUsers.rowCount
      ? (await c.query(`select count(*)::int as total from ${SCHEMA}.users`)).rows[0].total
      : null;
    const roleEnum = await c.query(`
      SELECT e.enumlabel
      FROM pg_attribute a
      JOIN pg_class c2     ON a.attrelid = c2.oid
      JOIN pg_namespace n  ON c2.relnamespace = n.oid
      JOIN pg_type t       ON a.atttypid = t.oid
      JOIN pg_enum e       ON t.oid = e.enumtypid
      WHERE n.nspname = $1 AND c2.relname='users' AND a.attname='role'
      ORDER BY e.enumsortorder
    `,[SCHEMA]);
    const langCol = await c.query(`
      SELECT udt_schema, udt_name
      FROM information_schema.columns
      WHERE table_schema=$1 AND table_name='users' AND column_name='preferred_lang'
    `,[SCHEMA]);
    return j(200,{ ok:true, schema:SCHEMA, users_table:!!hasUsers.rowCount, users_count:count,
      role_enum:roleEnum.rows.map(r=>r.enumlabel), preferred_lang_type: langCol.rows[0]||null });
  }catch(e){ return j(500,{ok:false,where:"introspect",code:e.code||null,error:String(e.message||e)}); }
  finally{ try{await c.end()}catch{} }
}
