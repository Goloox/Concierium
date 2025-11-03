const { SCHEMA, pgClient, ok, err, requireAdmin } = require("./_admin-util");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return err(405, { ok: false, error: "Method Not Allowed" });
    const { error } = requireAdmin(event);
    if (error) return error;

    let p={}; try{ p=JSON.parse(event.body||"{}"); }catch{return err(400,{ok:false,error:"JSON inválido"});}

    const id = p.id || null;
    const kind = String(p.service_kind||"").trim();  // enum service_type
    const name = String(p.name||"").trim();
    const description = p.description ? String(p.description) : null;
    const base_price_usd = (p.base_price_usd==null || p.base_price_usd==="") ? null : +p.base_price_usd;
    const destination_id = p.destination_id || null;
    const provider_id = p.provider_id || null;
    const is_active = typeof p.is_active === "boolean" ? p.is_active : true;

    if(!kind) return err(400,{ok:false,error:"service_kind requerido (lodging,tour,dining,vip)"});
    if(!name) return err(400,{ok:false,error:"name requerido"});

    const client = pgClient();
    await client.connect();
    await client.query(`SET search_path TO ${SCHEMA}, public`);

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
      ({rows} = await client.query(q, [kind, name, description, base_price_usd, destination_id, provider_id, is_active, id]));
    }else{
      const q=`
        INSERT INTO ${SCHEMA}.services_catalog
          (service_kind, name, description, base_price_usd, destination_id, provider_id, is_active)
        VALUES ($1::${SCHEMA}.service_type,$2,$3,$4,$5,$6,$7)
        RETURNING id::text, service_kind::text AS kind, name, description, base_price_usd::text, is_active
      `;
      ({rows} = await client.query(q, [kind, name, description, base_price_usd, destination_id, provider_id, is_active]));
    }
    await client.end();
    return ok({ ok:true, item: rows[0] });

  } catch (e) {
    console.error("admin-services-upsert", e);
    if (/invalid input value for enum/i.test(String(e?.message||e))) {
      return err(400,{ok:false,error:"service_kind inválido. Usa: lodging,tour,dining,vip"});
    }
    return err(500, { ok:false, error:"Error interno" });
  }
};
