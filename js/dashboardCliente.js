// /js/clientdashboard.js  (ESM)
const token = localStorage.getItem('token') || '';
const $  = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));

/* =========================
   HTTP helpers (JSON / upload)
========================= */
const authHeaders = () => ({ Authorization: 'Bearer ' + token });

const fget = (url) =>
  fetch(url, { headers: authHeaders() })
    .then(r => r.json())
    .catch(e => ({ ok:false, error:String(e) }));

const fpost = (url, body) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body)
  })
  .then(r => r.json())
  .catch(e => ({ ok:false, error:String(e) }));

const fupload = (url, formData) =>
  fetch(url, { method: 'POST', headers: authHeaders(), body: formData })
    .then(r => r.json())
    .catch(e => ({ ok:false, error:String(e) }));

/* =========================
   Toast
========================= */
function toast(msg, type='warn', ms=4200){
  const t = $('#toast'); if(!t) return;
  t.textContent = msg;
  t.style.borderColor = type==='err' ? '#ef4444' : type==='ok' ? '#19c37d' : 'rgba(255,255,255,.12)';
  t.style.display = 'block';
  clearTimeout(t._to);
  t._to = setTimeout(()=> t.style.display='none', ms);
}

/* =========================
   Estado (catálogos públicos)
========================= */
const REF = { destinations: [], services: [] };

async function prefetchRefs(){
  const [dres, sres] = await Promise.allSettled([
    fget('/.netlify/functions/public-destinations'),
    fget('/.netlify/functions/public-services'),
  ]);

  const dests = (dres.value?.items || []).filter(x=>x.is_active);
  const servs = (sres.value?.items || []).filter(x=>x.is_active);

  REF.destinations = dests;
  REF.services     = servs;

  // Selects: crear nueva
  const selDestN = $('#selDestinationNew');
  if (selDestN) {
    selDestN.innerHTML = `<option value="">— selecciona —</option>` +
      dests
        .sort((a,b)=> (a.sort_order-b.sort_order) || a.name.localeCompare(b.name))
        .map(d=>`<option value="${d.id}">${d.name}${d.country?(' · '+d.country):''}</option>`).join('');
  }
  const selServN = $('#selServiceNew');
  if (selServN) {
    selServN.innerHTML = `<option value="">— (opcional) —</option>` +
      servs
        .sort((a,b)=> (a.service_kind.localeCompare(b.service_kind)) || a.name.localeCompare(b.name))
        .map(s=>`<option value="${s.id}">${s.name} · ${s.service_kind}${s.base_price_usd?(' · $'+s.base_price_usd):''}</option>`).join('');
  }

  // Selects: editar
  const selDestE = $('#selDestinationEdit');
  if (selDestE) {
    selDestE.innerHTML = `<option value="">— sin destino —</option>` +
      dests
        .sort((a,b)=> (a.sort_order-b.sort_order) || a.name.localeCompare(b.name))
        .map(d=>`<option value="${d.id}">${d.name}${d.country?(' · '+d.country):''}</option>`).join('');
  }
  const selServE = $('#selServiceEdit');
  if (selServE) {
    selServE.innerHTML = `<option value="">— (opcional) —</option>` +
      servs
        .sort((a,b)=> (a.service_kind.localeCompare(b.service_kind)) || a.name.localeCompare(b.name))
        .map(s=>`<option value="${s.id}">${s.name} · ${s.service_kind}${s.base_price_usd?(' · $'+s.base_price_usd):''}</option>`).join('');
  }
}

/* =========================
   UI helpers
========================= */
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

/* =========================
   HOME (resumen del cliente)
========================= */
async function loadClientHome(){
  const data = await fget('/.netlify/functions/client-dashboard');
  if(!data || data.ok===false){
    $('#kpiMine')?.replaceChildren(document.createTextNode('—'));
    $('#chipsMine')?.replaceChildren();
    $('#tblMyRecent')?.replaceChildren();
    toast(data?.error || 'No se pudo cargar tu dashboard', 'warn');
    return;
  }
  $('#kpiMine').textContent = data.total ?? 0;

  const chips = $('#chipsMine'); if (chips) {
    chips.innerHTML = '';
    const palette = { new:'', curation:'warn', proposal_sent:'ok', confirmed:'ok', closed:'', discarded:'err' };
    (data.por_estado||[]).forEach(r=>{
      const span = document.createElement('span');
      span.textContent = `${r.status}: ${r.total}`;
      span.style.cssText = 'padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.12);margin-right:6px';
      if(palette[r.status]==='ok')   span.style.color='#19c37d';
      if(palette[r.status]==='warn') span.style.color='#f5a524';
      if(palette[r.status]==='err')  span.style.color='#ef4444';
      chips.appendChild(span);
    });
  }

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

/* =========================
   NUEVA SOLICITUD
========================= */
$('#formNewReq')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  // Normaliza
  body.guests = body.guests ? +body.guests : null;
  body.budget_usd = body.budget_usd ? +body.budget_usd : null;
  body.destination_id = body.destination_id || null;
  body.catalog_id     = body.catalog_id || null; // service seleccionado
  body.interests = (body.interests||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(!body.service_kind){ toast('Selecciona un tipo de servicio','warn'); return; }

  const r = await fpost('/.netlify/functions/client-requests-upsert', body);
  $('#msgNewReq').textContent = r.ok ? 'Solicitud creada' : (r.error||'Error');
  if(r.ok){
    toast('Solicitud enviada','ok',2200);
    e.target.reset();
    location.hash = '#mis-solicitudes';
    await loadMyRequests();
  }
});

/* =========================
   MIS SOLICITUDES (lista)
========================= */
async function loadMyRequests(){
  const st = $('#fltStatusMyReq')?.value || '';
  const url = '/.netlify/functions/client-requests-list' + (st?`?status=${encodeURIComponent(st)}`:'');
  const d = await fget(url);
  const tb = $('#tblMyReq'); if(!tb) return;
  tb.innerHTML='';
  if(d?.error || d?.ok===false){ tb.innerHTML=`<tr><td colspan="7" class="muted">${d.error||'Error'}</td></tr>`; return; }
  (d.items||[]).forEach(it=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `
      <td>${it.id}</td>
      <td>${it.servicio}</td>
      <td>${it.destino}</td>
      <td>${it.fecha || (it.start_date? it.start_date : '—')}</td>
      <td>${it.estado}</td>
      <td style="display:flex;gap:6px">
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
      const id = btn.dataset.id;
      if(!confirm('¿Deseas cancelar esta solicitud?')) return;
      const r = await fpost('/.netlify/functions/client-requests-status', { id, to_status:'discarded' });
      if(!r.ok){ toast(r.error||'Error','err'); return; }
      toast('Solicitud cancelada','ok',2200);
      await loadMyRequests();
      await loadClientHome();
    };
  });

  if(!(d.items||[]).length) tb.innerHTML=`<tr><td colspan="7" class="muted">No tienes solicitudes</td></tr>`;
}
$('#btnLoadMyReq')?.addEventListener('click', loadMyRequests);

/* =========================
   SOLICITUD - edición/adjuntos
========================= */
async function openMyRequestEdit(id){
  await prefetchRefs();

  // Trae lista y busca (o crea endpoint get-by-id si lo prefieres)
  const d = await fget('/.netlify/functions/client-requests-list');
  const item = (d.items||[]).find(x=> x.id===id);
  if(!item){ toast('Solicitud no encontrada','err'); location.hash='#mis-solicitudes'; return; }

  // Prefill edición básica (solo campos de cliente)
  const f = $('#formReqEdit');
  if (f) {
    f.id.value = item.id;
    // selects
    const dest = REF.destinations.find(dd => dd.id===item.destination_id) || REF.destinations.find(dd => dd.name===item.destino);
    const serv = REF.services.find(ss => ss.id===item.catalog_id)         || REF.services.find(ss => ss.name===item.servicio);
    $('#selDestinationEdit').value = dest ? dest.id : '';
    $('#selServiceEdit').value     = serv ? serv.id : '';
    // inputs comunes
    f.service_kind.value = item.service_kind || item.servicio_kind || ''; // por si el backend lo expone con otro alias
    f.start_date.value   = item.start_date || '';
    f.end_date.value     = item.end_date || '';
    f.guests.value       = item.guests ?? '';
    f.budget_usd.value   = item.budget_usd ?? '';
    f.dietary_notes.value= item.dietary_notes || '';
    f.interests.value    = (item.interests||[]).join(', ');
    f.notes.value        = item.notes || '';
  }

  // Resumen
  $('#reqPreview').innerHTML = `
    <div><b>Folio:</b> ${item.id}</div>
    <div><b>Servicio:</b> ${item.servicio||'—'} (${item.service_kind||'—'})</div>
    <div><b>Destino:</b> ${item.destino||'—'}</div>
    <div><b>Fecha:</b> ${item.start_date||'—'} ${item.end_date?('→ '+item.end_date):''}</div>
    <div><b>Huéspedes:</b> ${item.guests??'—'} · <b>Presupuesto:</b> ${item.budget_usd??'—'}</div>
    <div><b>Estado:</b> ${item.estado}</div>
  `;

  // Adjuntos: listar
  await loadAttachmentsList(item.id);

  showSectionById('solicitud-edit');
}

// Guardar cambios del cliente sobre su solicitud
$('#formReqEdit')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  // normaliza
  body.guests = body.guests ? +body.guests : null;
  body.budget_usd = body.budget_usd ? +body.budget_usd : null;
  body.destination_id = body.destination_id || null;
  body.catalog_id     = body.catalog_id || null;
  body.interests = (body.interests||'').split(',').map(s=>s.trim()).filter(Boolean);

  const r = await fpost('/.netlify/functions/client-requests-upsert', body);
  $('#msgReqEdit').textContent = r.ok ? 'Cambios guardados' : (r.error||'Error');
  if(r.ok){
    toast('Solicitud actualizada','ok',2200);
    await loadMyRequests();
    await loadClientHome();
  }
});

// Cancelar desde la vista de edición (si agregas un botón con id=btnCancelReq)
$('#btnCancelReq')?.addEventListener('click', async ()=>{
  const id = $('#formReqEdit')?.id?.value;
  if(!id) return;
  if(!confirm('¿Deseas cancelar esta solicitud?')) return;
  const r = await fpost('/.netlify/functions/client-requests-status', { id, to_status:'discarded' });
  if(!r.ok){ toast(r.error||'Error','err'); return; }
  toast('Solicitud cancelada','ok',2200);
  location.hash = '#mis-solicitudes';
  await loadMyRequests();
  await loadClientHome();
});

/* =========================
   Adjuntos del cliente
========================= */
async function loadAttachmentsList(request_id){
  const ul = $('#attachmentsList'); if(!ul) return;
  ul.innerHTML = '<li class="muted">Cargando…</li>';
  const d = await fget('/.netlify/functions/client-attachments-list?request_id='+encodeURIComponent(request_id));
  if(d?.error || d?.ok===false){ ul.innerHTML = `<li class="muted">${d.error||'Error'}</li>`; return; }

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

// subida (FormData: file + request_id)
$('#formUpload')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const fd = new FormData(e.target);
  const file = fd.get('file');
  const request_id = fd.get('request_id');
  if(!file || !request_id){ toast('Selecciona un archivo y una solicitud','warn'); return; }
  // Validación ligera por UI (backend validará igual)
  const okType = /^(application\/pdf|image\/png|image\/jpe?g)$/i.test(file.type);
  if(!okType){ toast('Tipo no permitido (solo PDF/JPG/PNG)','warn'); return; }
  if(file.size > 10*1024*1024){ toast('Archivo > 10MB','warn'); return; }

  const upfd = new FormData();
  upfd.append('file', file);
  upfd.append('request_id', request_id);

  const r = await fupload('/.netlify/functions/upload', upfd);
  $('#msgUpload').textContent = r.ok ? 'Archivo subido' : (r.error||'Error');
  if(r.ok){
    toast('Adjunto subido','ok',2200);
    e.target.reset();
    await loadAttachmentsList(request_id);
  }
});

/* =========================
   Router (cliente)
========================= */
async function router(){
  const { path, params } = parseHash();
  setNavFromHash();

  if (path === '#home' || path === '#') {
    showSectionById('home');
    await loadClientHome();
    return;
  }
  if (path === '#nueva') {
    showSectionById('nueva');
    await prefetchRefs();
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

  // fallback
  showSectionById('home');
  await loadClientHome();
}

window.addEventListener('hashchange', router);

/* =========================
   Logout
========================= */
$('#btnLogout')?.addEventListener('click', ()=>{
  localStorage.clear();
  location.replace('/login.html');
});

/* =========================
   Arranque
========================= */
(async ()=>{
  if(!location.hash) location.hash = '#home';
  await prefetchRefs();
  await router();
})();
