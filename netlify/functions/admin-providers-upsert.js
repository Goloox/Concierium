const { SCHEMA, pgClient, ok, err, requireAdmin } = require("./_admin-util");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return err(405, { ok: false, error: "Method Not Allowed" });
    const { error } = requireAdmin(event);
    if (error) return error;

    let p={}; try{ p=JSON.parse(event.body||"{}"); }catch{return err(400,{ok:false,error:"JSON inválido"});}
    const id = p.id || null;
    const name = String(p.name||"").trim();
    const type = String(p.type||"").trim(); // enum provider_type
    const email = p.email ? String(p.email).trim().toLowerCase() : null;
    const phone = p.phone ? String(p.phone).trim() : null;
    const rating = (p.rating==null || p.rating==="") ? null : +p.rating;
    const is_active = typeof p.is_active==="boolean" ? p.is_active : true;

    if(!name) return err(400,{ok:false,error:"Nombre requerido"});
    if(!type) return err(400,{ok:false,error:"Tipo requerido (provider_type)"});

    const client = pgClient();
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);

    let rows;
    if(id){
      const q=`
        UPDATE ${SCHEMA}.providers
        SET name=$1, type=$2::${SCHEMA}.provider_type, email=$3::citext, phone=$4, rating=$5, is_active=$6, updated_at=now()
        WHERE id=$7
        RETURNING id::text, name, type::text AS type, email::text AS email, phone, rating, is_active
      `;
      ({rows} = await client.query(q,[name,type,email,phone,rating,is_active,id]));
    }else{
      const q=`
        INSERT INTO ${SCHEMA}.providers (name,type,email,phone,rating,is_active)
        VALUES ($1,$2::${SCHEMA}.provider_type,$3::citext,$4,$5,$6)
        RETURNING id::text, name, type::text AS type, email::text AS email, phone, rating, is_active
      `;
      ({rows} = await client.query(q,[name,type,email,phone,rating,is_active]));
    }
    await client.end();
    return ok({ok:true, item: rows[0]});
  } catch (e) {
    console.error("admin-providers-upsert", e);
    if (/invalid input value for enum/i.test(String(e?.message||e))) {
      return err(400,{ok:false,error:"Tipo inválido. Usa: hotel,residence,tour_operator,restaurant,chef,assistant,translator,security,transport"});
    }
    return err(500, { ok:false, error:"Error interno" });
  }
};
