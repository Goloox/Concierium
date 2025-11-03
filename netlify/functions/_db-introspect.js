import { Client } from "pg";

function j(s,b){return{statusCode:s,headers:{"content-type":"application/json"},body:JSON.stringify(b)}}

export async function handler(){
  const need=["PGHOST","PGUSER","PGPASSWORD","PGDATABASE"];
  const miss=need.filter(k=>!process.env[k]);
  if(miss.length) return j(500,{ok:false,where:"env",error:`missing: ${miss.join(", ")}`});

  const client=new Client({
    host:process.env.PGHOST,
    user:process.env.PGUSER,
    password:process.env.PGPASSWORD,
    database:process.env.PGDATABASE,
    port:+(process.env.PGPORT||5432),
    ssl:process.env.PGSSL==="true"?{rejectUnauthorized:false}:undefined
  });

  try{
    await client.connect();
    const r = await client.query("select current_database() db, current_user usr, version() v");
    return j(200,{ok:true,info:r.rows[0]});
  }catch(e){
    return j(500,{ok:false,where:"connect/query",code:e.code||null,error:String(e.message||e)});
  }finally{
    try{await client.end()}catch{}
  }
}
