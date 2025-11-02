import { Client } from "pg";
function json(s,b){ return { statusCode:s, headers:{ "content-type":"application/json" }, body:JSON.stringify(b) }; }
export async function handler(){
  const need=["PGHOST","PGUSER","PGPASSWORD","PGDATABASE"];
  const missing=need.filter(k=>!process.env[k]);
  if(missing.length) return json(500,{ok:false,error:`DB env missing: ${missing.join(", ")}`});
  const client=new Client({
    host:process.env.PGHOST,user:process.env.PGUSER,password:process.env.PGPASSWORD,
    database:process.env.PGDATABASE,port:+(process.env.PGPORT||5432),
    ssl:process.env.PGSSL==="true"?{rejectUnauthorized:false}:undefined
  });
  try{
    await client.connect();
    const info = await client.query(`select current_database() db, current_user usr, version() v`);
    const roleEnum = await client.query(`
      SELECT e.enumlabel
      FROM pg_attribute a
      JOIN pg_class c ON a.attrelid = c.oid
      JOIN pg_type  t ON a.atttypid = t.oid
      JOIN pg_enum  e ON t.oid = e.enumtypid
      WHERE c.relname = 'users' AND a.attname = 'role'
      ORDER BY e.enumsortorder
    `);
    const langCheck = await client.query(`
      SELECT data_type, udt_name
      FROM information_schema.columns
      WHERE table_name='users' AND column_name='preferred_lang'
    `);
    return json(200,{ ok:true, info:info.rows[0], role_enum:roleEnum.rows.map(r=>r.enumlabel), preferred_col:langCheck.rows[0]||null });
  }catch(e){
    return json(500,{ ok:false, code:e.code||null, error:String(e.message||e) });
  }finally{ try{ await client.end(); }catch{} }
}
