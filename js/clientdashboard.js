// public/js/clientdashboard.js  (ESM, drop-in robusto con diagnóstico)
const token = localStorage.getItem('token') || '';
if (!token) {
  location.replace('/login.html');
}

const $  = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));

// ====== UI helpers ======
function toast(msg, type='warn', ms=4200){
  const t = $('#toast'); if(!t) return;
  t.textContent = msg;
  t.style.borderColor = type==='err' ? '#ef4444' : type==='ok' ? '#19c37d' : 'rgba(255,255,255,.12)';
  t.style.display = 'block';
  clearTimeout(t._to);
  t._to = setTimeout(()=> t.style.display='none', ms);
}

function showSectionById(id){
  const sections = $$('.section');
  sections.forEach(s => s.style.display = (s.id === id ? 'block' : 'none'));
  $$('.nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === ('#'+id)));
}
function setNavFromHash(){
  const raw = location.hash || '#home';
  const main = raw.split('?')[0] || '#home';
  $$('.nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === main));
}
function parseHash(){
  const raw = location.hash || '#home';
  const [path, query] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(query||'').entries());
  return { path, params };
}

// ====== HTTP helpers ======
const authHeaders = () => ({ Authorization: 'Bearer ' + token });
async function asJson(r){
  let text = await r.text();
  try { return JSON.parse(text || '{}'); } catch { return { ok:false, error:text || r.statusText }; }
}
const fget = async (url) => {
  try{
    const r = await fetch(url, { headers: authHeaders() });
    if(!r.ok) return { ok:false, error:`${r.status} ${r.statusText}`, _status:r.status };
    return await asJson(r);
  }catch(e){ return { ok:false, error:String(e) }; }
};
const fpost = async (url, body) => {
  try{
    const r = await fetch(url, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', ...authHeaders() },
      body: JSON.stringify(body)
    });
    if(!r.ok) return { ok:false, error:`${r.status} ${r.statusText}`, _status:r.status };
    return await asJson(r);
  }catch(e){ return { ok:false, error:String(e) }; }
};
const fupload = async (url, formData) => {
  try{
    const r = await fetch(url, { method:'POST', headers: authHeaders(), body: formData });
    if(!r.ok) return { ok:false, error:`${r.status} ${r.statusText}`, _status:r.status };
    return await asJson(r);
  }catch(e){ return { ok:false, error:String(e) }; }
};

// ====== Endpoints esperados (cliente/públicos) ======
const EP = {
  publicDest: '/.netlify/functions/public-destinations',
  publicServ: '/.netlify/functions/public-services',
  dash:       '/.netlify/functions/client-dashboard',
  list:       '/.netlify/functions/client-requests-list',
  upsert:     '/.netlify/functions/client-requests-upsert',
  status:     '/.netlify/functions/client-requests-status',
  attachList: '/.netlify/functions/client-attachments-list',
  upload:     '/.netlify/functions/upload',
  // (opcionales de depuración — algunos ya los tienes)
  ping:       '/.netlify/functions/_db-ping'
};

// ====== Diagnóstico de endpoints ======
let HEALTH = {
  publicDest:false, publicServ:false, dash:false, list:false, upsert:false, status:false, attachList:false, upload:false, ping:null
};
async function healthCheck(){
  const tests = [
    ['publicDest', EP.publicDest, 'GET'],
    ['publicServ', EP.publicServ, 'GET'],
    ['dash',       EP.dash,       'GET'],
    ['list',       EP.list,       'GET'],
    ['upsert',     EP.upsert,     'POST', { service_kind:'tour' }], // body mínimo válido
    ['status',     EP.status,     'POST', { id:'00000000-0000-0000-0000-000000000000', to_status:'discarded' }],
    ['attachList', EP.attachList, 'GET?request_id=fake'],
    ['upload',     EP.upload,     'HEAD'], // HEAD puede no estar — si falla, marcamos null
    ['ping',       EP.ping,       'GET', null, true]
  ];

  const out = [];
  for (const [key, url, method, body, optional] of tests){
    try{
      let res;
      if (method === 'GET'){
        res = await fetch(url, { headers:authHeaders() });
      } else if (method === 'GET?request_id=fake'){
        res = await fetch(url + '?request_id=00000000-0000-0000-0000-000000000000', { headers:authHeaders() });
      } else if (method === 'POST'){
        res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json', ...authHeaders()}, body:JSON.stringify(body||{}) });
      } else if (method === 'HEAD'){
        res = await fetch(url, { method:'HEAD', headers:authHeaders() });
      }
      const okish = res && (res.ok || res.status===400 || res.status===401 || res.status===403 || res.status===404);
      HEALTH[key] = okish ? (res.ok) : false;
      out.push([key, res.status, res.statusText]);
    }catch(e){
      HEALTH[key] = optional ? null : false;
      out.push([key, 'ERR', String(e)]);
    }
  }

  // UI de diagnóstico (no requiere cambios en tu HTML; reusa Home)
  const chips = $('#chipsMine');
  if (chips){
    const mk = (k, good, statusTxt) => {
      const span = document.createElement('span');
      span.className = 'chip';
      span.textContent = `${k}: ${statusTxt}`;
      span.style.color = good===true ? '#19c37d' : (good===null ? '#f5a524' : '#ef4444');
      return span;
    };
    chips.innerHTML = '';
    for (const [k, st, txt] of out){
      const good = HEALTH[k];
      chips.appendChild(mk(k, good, `${st}`));
    }
  }

  // Mensajes guía
  const missing = Object.entries(HEALTH).filter(([k,v])=> v===false && k!=='ping').map(([k])=>k);
  if (missing.length){
    console.warn('Faltan endpoints cliente:', missing);
    toast('Faltan endpoints del cliente: ' + missing.join(', '), 'warn', 6000);
  }
}

// ====== Catálogos ======
const REF = { destinations: [], services: [] };

async function prefetchRefs(){
  const [dres, sres] = await Promise.all([ fget(EP.publicDest), fget(EP.publicServ) ]);

  if (!dres?.items) {
    REF.destinations = [];
    console.error('public-destinations falló:', dres?.error);
  } else REF.destinations = dres.items.filter(x=>x.is_active!==false);

  if (!sres?.items) {
    REF.services = [];
    console.error('public-services falló:', sres?.error);
  } else REF.services = sres.items.filter(x=>x.is_active!==false);

  // Selects: crear nueva
  const selDestN = $('#selDestinationNew');
  if (selDestN) {
    selDestN.innerHTML = `<option value="">— selecciona —</option>` +
      REF.destinations
        .sort((a,b)=> (a.sort_order-b.sort_order) || a.name.localeCompare(b.name))
        .map(d=>`<option value="${d.id}">${d.name}${d.country?(' · '+d.country):''}</option>`).join('');
  }
  const selServN = $('#selServiceNew');
  if (selServN) {
    selServN.innerHTML = `<option value="">— (opcional) —</option>` +
      REF.services
        .sort((a,b)=> (a.service_kind.localeCompare(b.service_kind)) || a.name.localeCompare(b.name))
        .map(s=>`<option value="${s.id}">${s.name} · ${s.service_kind}${s.base_price_usd?(' · $'+s.base_price_usd):''}</option>`).join('');
  }

  // Selects: editar
  const selDestE = $('#selDestinationEdit');
  if (selDestE) {
    selDestE.innerHTML = `<option value="">— sin destino —</option>` +
      REF.destinations
        .sort((a,b)=> (a.sort_order-b.sort_order) || a.name.localeCompare(b.name))
        .map(d=>`<option value="${d.id}">${d.name}${d.country?(' · '+d.country):''}</option>`).join('');
  }
  const selServE = $('#selServiceEdit');
  if (selServE) {
    selServE.innerHTML = `<option value="">— (opcional) —</option>` +
      REF.services
        .sort((a,b)=> (a.service_kind.localeCompare(b.service_kind)) || a.name.localeCompare(b.name))
        .map(s=>`<option value="${s.id}">${s.name} · ${s.service_kind}${s.base_price_usd?(' · $'+s.base_price_usd):''}</option>`).join('');
  }
}

// ====== Home (resumen) ======
async function loadClientHome(){
  const data = await fget(EP.dash);
  if(!data || data.ok===false){
    $('#kpiMine')?.replaceChildren(document.createTextNode('—'));
    const tb = $('#tblMyRecent'); if (tb) tb.innerHTML = `<tr><td colspan="6" class="muted">${data?.error || 'Dashboard no disponible'}</td></tr>`;
    console.error('client-dashboard:', data?.error);
    return;
  }
  $('#kpiMine').textContent = data.total ?? 0;

  const tb = $('#tblMyRecent'); if (tb) {
    tb.innerHTML='';
    (data.recientes||[]).forEach(r=>{
      const tr=document.createElement('tr');
      tr.innerHTML = `<td>${r.id}</td><td>${r.servicio}</td><td>${r.destino}</td><td>${r.estado}</td><td>${r.creada}</td>
                      <td><button class="btn btnOpenReq" data-id="${r.id}">Abrir</button></td>`;
      tb.appendChild(tr);
    });
    tb.querySelectorAll('.btnOpenReq').forEach(b=>{
      b.onclick = ()=> { location.hash = `#solicitudes/edit?id=${b.dataset.id}`; };
    });
    if(!data.recientes?.length) tb.innerHTML = `<tr><td colspan="6" class="muted">Sin recientes</td></tr>`;
  }
}
$('#btnRefreshClient')?.addEventListener('click', loadClientHome);

// ====== Nueva solicitud ======
$('#formNewReq')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (HEALTH.upsert === false) {
    toast('Endpoint de creación no disponible (.functions/client-requests-upsert)', 'err'); 
    return;
  }
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());

  // Normaliza
  body.guests = body.guests ? +body.guests : null;
  body.budget_usd = body.budget_usd ? +body.budget_usd : null;
  body.destination_id = body.destination_id || null;
  body.catalog_id     = body.catalog_id || null;
  body.interests      = (body.interests||'').split(',').map(s=>s.trim()).filter(Boolean);

  if(!body.service_kind){ toast('Selecciona un tipo de servicio','warn'); return; }

  const r = await fpost(EP.upsert, body);
  $('#msgNewReq').textContent = r.ok ? 'Solicitud creada' : (r.error||'Error');
  if(r.ok){
    toast('Solicitud enviada','ok',2200);
    e.target.reset();
    location.hash = '#mis-solicitudes';
    await loadMyRequests();
  } else {
    console.error('client-requests-upsert:', r.error);
  }
});

// ====== Lista de mis solicitudes ======
async function loadMyRequests(){
  const st = $('#fltStatusMyReq')?.value || '';
  const url = EP.list + (st?`?status=${encodeURIComponent(st)}`:'');
  const d = await fget(url);
  const tb = $('#tblMyReq'); if(!tb) return;
  tb.innerHTML='';
  if(d?.error || d?.ok===false){ tb.innerHTML=`<tr><td colspan="6" class="muted">${d.error||'No disponible'}</td></tr>`; console.error('client-requests-list:', d?.error); return; }
  (d.items||[]).forEach(it=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `
      <td>${it.id}</td>
      <td>${it.servicio||'—'}</td>
      <td>${it.destino||'—'}</td>
      <td>${it.fecha || (it.start_date? it.start_date : '—')}</td>
      <td>${it.estado||'—'}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btnOpen" data-id="${it.id}">Abrir</button>
        ${it.estado!=='discarded' && it.estado!=='closed' ? `<button class="btn btnCancel" data-id="${it.id}">Cancelar</button>` : ''}
      </td>
    `;
    tb.appendChild(tr);
  });

  tb.querySelectorAll('.btnOpen').forEach(btn=>{
    btn.onclick = ()=> { location.hash = `#solicitudes/edit?id=${btn.dataset.id}`; };
  });
  tb.querySelectorAll('.btnCancel').forEach(btn=>{
    btn.onclick = async ()=>{
      if (HEALTH.status === false) { toast('Endpoint de cambio de estado no disponible', 'err'); return; }
      const id = btn.dataset.id;
      if(!confirm('¿Deseas cancelar esta solicitud?')) return;
      const r = await fpost(EP.status, { id, to_status:'discarded' });
      if(!r.ok){ toast(r.error||'Error','err'); console.error('client-requests-status:', r.error); return; }
      toast('Solicitud cancelada','ok',2200);
      await loadMyRequests();
      await loadClientHome();
    };
  });

  if(!(d.items||[]).length) tb.innerHTML=`<tr><td colspan="6" class="muted">No tienes solicitudes</td></tr>`;
}
$('#btnLoadMyReq')?.addEventListener('click', loadMyRequests);

// ====== Editar solicitud + adjuntos ======
async function openMyRequestEdit(id){
  await prefetchRefs();

  const d = await fget(EP.list);
  const item = (d.items||[]).find(x=> x.id===id);
  if(!item){ toast('Solicitud no encontrada','err'); location.hash='#mis-solicitudes'; return; }

  const f = $('#formReqEdit');
  if (f) {
    f.id.value = item.id;

    const dest = REF.destinations.find(dd => dd.id===item.destination_id) || REF.destinations.find(dd => dd.name===item.destino);
    const serv = REF.services.find(ss => ss.id===item.catalog_id)         || REF.services.find(ss => ss.name===item.servicio);
    $('#selDestinationEdit').value = dest ? dest.id : '';
    $('#selServiceEdit').value     = serv ? serv.id : '';

    f.service_kind.value = item.service_kind || item.servicio_kind || '';
    f.start_date.value   = item.start_date || '';
    f.end_date.value     = item.end_date || '';
    f.guests.value       = item.guests ?? '';
    f.budget_usd.value   = item.budget_usd ?? '';
    f.dietary_notes.value= item.dietary_notes || '';
    f.interests.value    = (item.interests||[]).join(', ');
    f.notes.value        = item.notes || '';
  }

  $('#reqPreview').innerHTML = `
    <div><b>Folio:</b> ${item.id}</div>
    <div><b>Servicio:</b> ${item.servicio||'—'} (${item.service_kind||'—'})</div>
    <div><b>Destino:</b> ${item.destino||'—'}</div>
    <div><b>Fecha:</b> ${item.start_date||'—'} ${item.end_date?('→ '+item.end_date):''}</div>
    <div><b>Huéspedes:</b> ${item.guests??'—'} · <b>Presupuesto:</b> ${item.budget_usd??'—'}</div>
    <div><b>Estado:</b> ${item.estado}</div>
  `;

  // Adjuntos
  await loadAttachmentsList(item.id);

  const up = $('#uploadRequestId');
  if (up) up.value = item.id;

  showSectionById('solicitud-edit');
}

$('#formReqEdit')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (HEALTH.upsert === false) { toast('Endpoint de actualización no disponible', 'err'); return; }
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  body.guests = body.guests ? +body.guests : null;
  body.budget_usd = body.budget_usd ? +body.budget_usd : null;
  body.destination_id = body.destination_id || null;
  body.catalog_id     = body.catalog_id || null;
  body.interests = (body.interests||'').split(',').map(s=>s.trim()).filter(Boolean);

  const r = await fpost(EP.upsert, body);
  $('#msgReqEdit').textContent = r.ok ? 'Cambios guardados' : (r.error||'Error');
  if(r.ok){
    toast('Solicitud actualizada','ok',2200);
    await loadMyRequests();
    await loadClientHome();
  } else {
    console.error('client-requests-upsert (edit):', r.error);
  }
});

$('#btnCancelReq')?.addEventListener('click', async ()=>{
  const id = $('#formReqEdit')?.id?.value;
  if(!id) return;
  if (HEALTH.status === false) { toast('Endpoint de cambio de estado no disponible', 'err'); return; }
  if(!confirm('¿Deseas cancelar esta solicitud?')) return;
  const r = await fpost(EP.status, { id, to_status:'discarded' });
  if(!r.ok){ toast(r.error||'Error','err'); console.error('client-requests-status:', r.error); return; }
  toast('Solicitud cancelada','ok',2200);
  location.hash = '#mis-solicitudes';
  await loadMyRequests();
  await loadClientHome();
});

// Adjuntos
async function loadAttachmentsList(request_id){
  const ul = $('#attachmentsList'); if(!ul) return;
  if (HEALTH.attachList === false) { ul.innerHTML = `<li class="muted">Endpoint de adjuntos no disponible</li>`; return; }
  ul.innerHTML = '<li class="muted">Cargando…</li>';
  const d = await fget(EP.attachList + '?request_id=' + encodeURIComponent(request_id));
  if(d?.error || d?.ok===false){ ul.innerHTML = `<li class="muted">${d.error||'Error'}</li>`; console.error('client-attachments-list:', d?.error); return; }
  if(!(d.items||[]).length){ ul.innerHTML = `<li class="muted">Sin archivos</li>`; return; }
  ul.innerHTML = '';
  (d.items||[]).forEach(a=>{
    const li = document.createElement('li');
    li.innerHTML = `
      <div><b>${a.file_name}</b> <span class="muted">(${a.mime_type}, ${(a.size_bytes/1024).toFixed(1)} KB)</span></div>
      ${a.storage_url ? `<div><a class="btn" href="${a.storage_url}" target="_blank" rel="noopener">Ver/Descargar</a></div>` : ''}
    `;
    ul.appendChild(li);
  });
}

$('#formUpload')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (HEALTH.upload === false) { toast('Endpoint de subida no disponible', 'err'); return; }
  const fd = new FormData(e.target);
  const file = fd.get('file');
  const request_id = fd.get('request_id');
  if(!file || !request_id){ toast('Selecciona un archivo y una solicitud','warn'); return; }
  const okType = /^(application\/pdf|image\/png|image\/jpe?g)$/i.test(file.type);
  if(!okType){ toast('Tipo no permitido (solo PDF/JPG/PNG)','warn'); return; }
  if(file.size > 10*1024*1024){ toast('Archivo > 10MB','warn'); return; }

  const upfd = new FormData();
  upfd.append('file', file);
  upfd.append('request_id', request_id);

  const r = await fupload(EP.upload, upfd);
  $('#msgUpload').textContent = r.ok ? 'Archivo subido' : (r.error||'Error');
  if(r.ok){
    toast('Adjunto subido','ok',2200);
    e.target.reset();
    await loadAttachmentsList(request_id);
  } else {
    console.error('upload:', r.error);
  }
});

// ====== Router ======
async function router(){
  const { path, params } = parseHash();
  setNavFromHash();

  if (path === '#home' || path === '#') {
    showSectionById('home');
    await healthCheck();   // << muestra estado en Home
    await loadClientHome();
    return;
  }
  if (path === '#nueva') {
    showSectionById('nueva');
    await prefetchRefs();
    if (HEALTH.upsert === false) toast('Crear solicitud no disponible (falta función)', 'warn');
    return;
  }
  if (path === '#mis-solicitudes') {
    showSectionById('mis-solicitudes');
    await loadMyRequests();
    return;
  }
  if (path.startsWith('#solicitudes/edit')) {
    const id = params.id || '';
    if (!id) { toast('Falta id','warn'); location.hash = '#mis-solicitudes'; return; }
    await openMyRequestEdit(id);
    return;
  }

  showSectionById('home');
  await healthCheck();
  await loadClientHome();
}
window.addEventListener('hashchange', router);

// ====== Logout ======
$('#btnLogout')?.addEventListener('click', ()=>{
  localStorage.clear();
  location.replace('/login.html');
});

// ====== Arranque ======
(async ()=>{
  if(!location.hash) location.hash = '#home';
  await prefetchRefs();
  await router();
})();
