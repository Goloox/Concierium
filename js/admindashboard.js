// /js/admindashboard.js  (ESM)
const token = localStorage.getItem('token') || '';
const $  = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));

/* =========================
   HTTP helpers (JSON)
========================= */
const fget = (url) =>
  fetch(url, { headers: { Authorization: 'Bearer ' + token } })
    .then(r => r.json())
    .catch(e => ({ ok:false, error:String(e) }));

const fpost = (url, body) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body)
  })
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
   Estado (catálogos)
========================= */
const REF = { destinations: [], providers: [] };

async function prefetchRefs(){
  const [dres, pres] = await Promise.allSettled([
    fget('/.netlify/functions/admin-destinations-list'),
    fget('/.netlify/functions/admin-providers-list')
  ]);

  const dItems = (dres.value?.items || []).filter(x=>x.is_active);
  const pItems = (pres.value?.items || []).filter(x=>x.is_active);

  REF.destinations = dItems;
  REF.providers    = pItems;

  // Selects del formulario CREAR
  const selDest = $('#selDestination');
  if (selDest) {
    selDest.innerHTML = `<option value="">— sin destino —</option>` +
      dItems
        .sort((a,b)=> (a.sort_order-b.sort_order) || a.name.localeCompare(b.name))
        .map(d=>`<option value="${d.id}">${d.name}${d.country?(' · '+d.country):''}</option>`).join('');
  }
  const selProv = $('#selProvider');
  if (selProv) {
    selProv.innerHTML = `<option value="">— sin proveedor —</option>` +
      pItems
        .sort((a,b)=> a.name.localeCompare(b.name))
        .map(p=>`<option value="${p.id}">${p.name} · ${p.type}</option>`).join('');
  }

  // Selects del formulario EDIT
  const selDestE = $('#selDestinationEdit');
  if (selDestE) {
    selDestE.innerHTML = `<option value="">— sin destino —</option>` +
      dItems
        .sort((a,b)=> (a.sort_order-b.sort_order) || a.name.localeCompare(b.name))
        .map(d=>`<option value="${d.id}">${d.name}${d.country?(' · '+d.country):''}</option>`).join('');
  }
  const selProvE = $('#selProviderEdit');
  if (selProvE) {
    selProvE.innerHTML = `<option value="">— sin proveedor —</option>` +
      pItems
        .sort((a,b)=> a.name.localeCompare(b.name))
        .map(p=>`<option value="${p.id}">${p.name} · ${p.type}</option>`).join('');
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
  const raw = location.hash || '#dash';
  const main = raw.split('?')[0] || '#dash';
  $$('.nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === main));
}

/* =========================
   DASHBOARD
========================= */
async function loadDash(){
  const elMsg = $('#dashMsg');
  try{
    const data = await fget('/.netlify/functions/admin-dashboard');
    if(!data || data.error || data.ok===false){
      const msg = data?.error || 'No se pudo cargar el dashboard';
      $('#kpiTotal').textContent = '—';
      $('#chips').innerHTML='';
      $('#tblRecent').innerHTML = `<tr><td colspan="6" class="muted">Sin datos</td></tr>`;
      $('#tblSLA').innerHTML    = `<tr><td colspan="5" class="muted">Sin datos</td></tr>`;
      elMsg.textContent = msg;
      if (/relation .* does not exist/i.test(msg)) {
        toast('Aún falta crear alguna tabla/vista del dashboard. Revisa el deploy SQL.', 'warn');
      }
      return;
    }

    elMsg.textContent = '';
    $('#kpiTotal').textContent = data.total ?? 0;

    const chips = $('#chips'); chips.innerHTML='';
    const palette = { new:'', curation:'warn', proposal_sent:'ok', confirmed:'ok', closed:'', discarded:'err' };
    (data.por_estado||[]).forEach(r=>{
      const span = document.createElement('span');
      span.textContent = `${r.status}: ${r.total}`;
      span.className = 'chip';
      if(palette[r.status]==='ok')   span.style.color='#19c37d';
      if(palette[r.status]==='warn') span.style.color='#f5a524';
      if(palette[r.status]==='err')  span.style.color='#ef4444';
      chips.appendChild(span);
    });

    const tbR = $('#tblRecent'); tbR.innerHTML='';
    (data.recientes||[]).forEach(r=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${r.id}</td><td>${r.cliente}</td><td>${r.servicio}</td><td>${r.destino}</td><td>${r.estado}</td><td>${r.creada}</td>`;
      tbR.appendChild(tr);
    });
    if(!data.recientes?.length) tbR.innerHTML=`<tr><td colspan="6" class="muted">Sin recientes</td></tr>`;

    const tbS = $('#tblSLA'); tbS.innerHTML='';
    (data.sla||[]).forEach(r=>{
      const tags=[];
      if(r.breach_first_attention_2h) tags.push('>2h atenc.');
      if(r.breach_proposal_48h) tags.push('>48h propuesta');
      const fmt=(x)=> (x||'').replace?.('T',' ').slice?.(0,19) || '—';
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${r.id}</td><td>${fmt(r.created_at)}</td><td>${fmt(r.first_change_at)}</td><td>${fmt(r.proposal_at)}</td><td>${tags.join(' | ')||'—'}</td>`;
      tbS.appendChild(tr);
    });
    if(!data.sla?.length) tbS.innerHTML=`<tr><td colspan="5" class="muted">Sin alertas</td></tr>`;

  }catch(e){
    elMsg.textContent = 'Error al cargar dashboard';
    toast('Error al cargar dashboard','err');
    console.error(e);
  }
}
$('#btnRefresh')?.addEventListener('click', loadDash);

/* =========================
   DESTINOS
========================= */
async function loadDestinos(){
  const d = await fget('/.netlify/functions/admin-destinations-list');
  const tb = $('#tblDestinos'); tb.innerHTML='';
  if(d?.error || d?.ok===false){ tb.innerHTML=`<tr><td colspan="6" class="muted">${d.error||'Error'}</td></tr>`; return; }
  (d.items||[]).forEach(it=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `<td>${it.name}</td><td>${it.country||'—'}</td><td>${it.region||'—'}</td><td>${it.sort_order}</td><td>${it.is_active?'Sí':'No'}</td>
    <td><button class="btn" data-id="${it.id}" data-type="editDest">Editar</button></td>`;
    tb.appendChild(tr);
  });
}
$('#formDest')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  body.sort_order = +body.sort_order;
  body.is_active = body.is_active === 'true';
  const r = await fpost('/.netlify/functions/admin-destinations-upsert', body);
  $('#msgDest').textContent = r.ok ? 'Guardado' : (r.error||'Error');
  if (r.ok) { e.target.reset(); await loadDestinos(); await prefetchRefs(); }
});

/* =========================
   PROVEEDORES
========================= */
async function loadProveedores(){
  const d = await fget('/.netlify/functions/admin-providers-list');
  const tb = $('#tblProveedores'); tb.innerHTML='';
  if(d?.error || d?.ok===false){ tb.innerHTML=`<tr><td colspan="7" class="muted">${d.error||'Error'}</td></tr>`; return; }
  (d.items||[]).forEach(it=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `<td>${it.name}</td><td>${it.type}</td><td>${it.email||'—'}</td><td>${it.phone||'—'}</td><td>${it.rating??'—'}</td><td>${it.is_active?'Sí':'No'}</td>
    <td><button class="btn" data-id="${it.id}" data-type="editProv">Editar</button></td>`;
    tb.appendChild(tr);
  });
}
$('#formProv')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  body.rating    = body.rating===''?null:+body.rating;
  body.is_active = body.is_active === 'true';
  const r = await fpost('/.netlify/functions/admin-providers-upsert', body);
  $('#msgProv').textContent = r.ok ? 'Guardado' : (r.error||'Error');
  if (r.ok) { e.target.reset(); await loadProveedores(); await prefetchRefs(); }
});

/* =========================
   SERVICIOS (listado + crear)
========================= */
async function loadServicios(){
  const d = await fget('/.netlify/functions/admin-services-list');
  const tb = $('#tblServicios'); tb.innerHTML='';
  if(d?.error || d?.ok===false){ tb.innerHTML=`<tr><td colspan="7" class="muted">${d.error||'Error'}</td></tr>`; return; }
  (d.items||[]).forEach(it=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `
      <td>${it.kind}</td>
      <td>${it.name}</td>
      <td>${it.destination||'—'}</td>
      <td>${it.provider||'—'}</td>
      <td>${it.base_price_usd??'—'}</td>
      <td>${it.is_active?'Sí':'No'}</td>
      <td><button class="btn btnEditServ" data-id="${it.id}">Editar</button></td>
    `;
    tb.appendChild(tr);
  });

  // Editar -> router abre pantalla de edición
  tb.querySelectorAll('.btnEditServ').forEach(btn=>{
    btn.onclick = () => { location.hash = `#servicios/edit?id=${btn.dataset.id}`; };
  });
}

$('#formServ')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  body.base_price_usd = body.base_price_usd===''?null:+body.base_price_usd;
  body.is_active      = body.is_active==='true';
  body.destination_id = body.destination_id || null;
  body.provider_id    = body.provider_id || null;

  const r = await fpost('/.netlify/functions/admin-services-upsert', body);
  $('#msgServ').textContent = r.ok ? 'Guardado' : (r.error||'Error');
  if (r.ok) {
    e.target.reset();
    await loadServicios();
    await prefetchRefs();
  }
});

/* =========================
   SERVICIO - Edición (pantalla)
========================= */
async function openServiceEdit(id){
  await prefetchRefs();

  // Ideal: tener /admin-services-get?id=... ; mientras, usamos la lista y filtramos
  const d = await fget('/.netlify/functions/admin-services-list');
  const item = (d.items||[]).find(x => x.id === id);
  if(!item){
    toast('No se encontró el servicio','err');
    location.hash = '#servicios';
    return;
  }

  // Prefill
  const f = $('#formServEdit');
  f.id.value            = item.id;
  f.service_kind.value  = item.kind;
  f.name.value          = item.name;
  f.description.value   = item.description || '';
  f.base_price_usd.value= item.base_price_usd ?? '';
  f.is_active.value     = item.is_active ? 'true' : 'false';

  // Con IDs si el backend los devuelve; de lo contrario, fallback por nombre
  const dest = REF.destinations.find(dd => dd.id===item.destination_id) || REF.destinations.find(dd => dd.name===item.destination);
  const prov = REF.providers.find(pp => pp.id===item.provider_id)       || REF.providers.find(pp => pp.name===item.provider);
  $('#selDestinationEdit').value = dest ? dest.id : '';
  $('#selProviderEdit').value    = prov ? prov.id : '';

  // Preview
  $('#servPreview').innerHTML = `
    <div><b>${item.name}</b></div>
    <div class="muted">${item.kind} · ${dest?dest.name:'—'} · ${prov?prov.name:'—'}</div>
    <div>Precio: ${item.base_price_usd ?? '—'}</div>
    <div>Activo: ${item.is_active ? 'Sí' : 'No'}</div>
  `;

  showSectionById('servicio-edit');
}

$('#formServEdit')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  body.base_price_usd = body.base_price_usd===''?null:+body.base_price_usd;
  body.is_active      = body.is_active === 'true';
  body.destination_id = body.destination_id || null;
  body.provider_id    = body.provider_id || null;

  const r = await fpost('/.netlify/functions/admin-services-upsert', body);
  $('#msgServEdit').textContent = r.ok ? 'Guardado' : (r.error||'Error');
  if (r.ok) {
    toast('Servicio actualizado','ok',2200);
    location.hash = '#servicios';
    await loadServicios();
  }
});

$('#btnBackServicios')?.addEventListener('click', ()=>{ location.hash = '#servicios'; });

/* =========================
   SOLICITUDES
========================= */
async function loadRequests(){
  const st = $('#fltStatus').value;
  const url = '/.netlify/functions/admin-requests-list' + (st?`?status=${encodeURIComponent(st)}`:'');
  const d = await fget(url);
  const tb = $('#tblReq'); tb.innerHTML='';
  if(d?.error || d?.ok===false){ tb.innerHTML=`<tr><td colspan="7" class="muted">${d.error||'Error'}</td></tr>`; return; }
  (d.items||[]).forEach(it=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `
      <td>${it.id}</td><td>${it.cliente}</td><td>${it.servicio}</td><td>${it.destino}</td>
      <td>${it.estado}</td>
      <td>
        <select data-id="${it.id}" class="selNext">
          <option value="">(selecciona)</option>
          <option>new</option><option>curation</option><option>proposal_sent</option>
          <option>confirmed</option><option>closed</option><option>discarded</option>
        </select>
      </td>
      <td><button class="btn btnGo" data-id="${it.id}">Cambiar</button></td>
    `;
    tb.appendChild(tr);
  });

  tb.querySelectorAll('.btnGo').forEach(btn=>{
    btn.onclick = async ()=>{
      const id  = btn.getAttribute('data-id');
      const sel = tb.querySelector(`.selNext[data-id="${id}"]`);
      const to_status = sel.value;
      if(!to_status){ toast('Selecciona un estado','warn'); return; }
      const r = await fpost('/.netlify/functions/admin-requests-status', { id, to_status });
      if(!r.ok){ toast(r.error||'Error','err'); return; }
      toast('Estado actualizado','ok',2200);
      loadRequests();
    };
  });
}
$('#btnLoadReq')?.addEventListener('click', loadRequests);

/* =========================
   Router
========================= */
function parseHash(){
  const raw = location.hash || '#dash';
  const [path, query] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(query||'').entries());
  return { path, params };
}

async function router(){
  const { path, params } = parseHash();
  setNavFromHash();

  if (path === '#dash' || path === '#') {
    showSectionById('dash');
    await loadDash();
    return;
  }
  if (path === '#destinos') {
    showSectionById('destinos');
    await loadDestinos();
    return;
  }
  if (path === '#proveedores') {
    showSectionById('proveedores');
    await loadProveedores();
    return;
  }
  if (path === '#servicios') {
    showSectionById('servicios');
    await prefetchRefs();
    await loadServicios();
    return;
  }
  if (path.startsWith('#servicios/edit')) {
    const id = params.id || '';
    if (!id) { toast('Falta id','warn'); location.hash='#servicios'; return; }
    await openServiceEdit(id);
    return;
  }
  if (path === '#solicitudes') {
    showSectionById('solicitudes');
    await loadRequests();
    return;
  }

  // fallback
  showSectionById('dash');
  await loadDash();
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
  if(!location.hash) location.hash = '#dash';
  await prefetchRefs();   // para selects listos si entran directo a /edit
  await router();         // resuelve ruta actual
})();
