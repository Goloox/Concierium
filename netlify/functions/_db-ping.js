import { Client } from "pg";
const J=(s,b)=>({statusCode:s,headers:{"content-type":"application/json"},body:JSON.stringify(b)});
export async function handler(){
  try{
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    await client.connect();
    const r = await client.query("select current_database() db, current_user usr");
    await client.end();
    return J(200,{ ok:true, info:r.rows[0] });
  }catch(e){
    return J(500,{ ok:false, error:String(e.message||e) });
  }
}
