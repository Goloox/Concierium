export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return json({ ok:false, error:'Method not allowed' }, 405);
  }

  try {
    const body = JSON.parse(event.body || '{}');
    if (!body.email) return json({ ok:false, error:'Faltan datos' }, 400);

    // TODO: aquí pones tu lógica real con Neon
    return json({ ok:true, echo: { email: body.email } }, 201);
  } catch (e) {
    return json({ ok:false, error:'Body inválido' }, 400);
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Content-Type': 'application/json; charset=utf-8'
  };
}
function json(data, status=200) {
  return { statusCode: status, headers: corsHeaders(), body: JSON.stringify(data) };
}
