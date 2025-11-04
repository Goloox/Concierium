// /client/js/clientdashboard.js  — ESM ÚNICO
// Requiere que existan en el DOM los ids usados en /client/index.html
// y que el token JWT esté en localStorage ("token").

////////////////////////////////////////////////////////////////////////////////
// Helpers base
////////////////////////////////////////////////////////////////////////////////
const token = localStorage.getItem('token') || '';
const $  = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));

function toast(msg, ms=2200){
  const t = $('#toast');
  if(!t) return alert(msg);
  t.textContent = msg;
  t.style.display = 'block';
  setTimeout(()=>{ t.style.display='none'; }, ms);
}

const authHeaders = () => token ? { Authorization: 'Bearer ' + token } : {};

const fget = (url) =>
  fetch(url, { headers: authHeaders() })
    .then(r => r.json())
    .catch(e => ({ ok:false, error:String(e) }));

const fpost = (url, body) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body)
  }).then(r => r.json())
   .catch(e => ({ ok:false, error:String(e) }));

const fupload = (url, formData) =>
  fetch(url, { method: 'POST', headers: authHeaders(), body: formData })
    .then(r => r.json())
    .catch(e => ({ ok:false, error:String(e) }));

const apiGet  = (op, qs={}) => {
  const qp = new URLSearchParams({ op, ...qs }).toString();
  return fget('/.netlify/functions/api?' + qp);
};
const apiPost = (op, body) => {
  const qp = new URLSearchParams({ op }).toString();
  return fpost('/.netlify/functions/api?' + qp, body);
};

////////////////////////////////////////////////////////////////////////////////
// Estado en memoria
////////////////////////////////////////////////////////////////////////////////
const state = {
  destinations: [],     // [{id,name,...}]
  services: [],         // [{id, service_kind, name, destination, provider, ...}]
  myRequests: [],       // [{...}]
  editCurrent: null,    // request en edición
};

////////////////////////////////////////////////////////////////////////////////
/** Utilidades UI */
////////////////////////////////////////////////////////////////////////////////
function setActiveNav(hash){
  $$('.nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === hash));
}
function showSection(id){
  $$('.section').forEach(sec => sec.style.display = (sec.id === id ? 'block' : 'none'));
}

function fillSelect(selectEl, rows, {value='id', label='name', withEmpty=true, emptyText='— selecciona —'}={}){
  if(!selectEl) return;
  selectEl.innerHTML = '';
  if (withEmpty) {
    const op = document.createElement('option');
    op.value = ''; op.textContent = emptyText;
    selectEl.appendChild(op);
  }
  for (const r of rows){
    const op = document.createElement('option');
    op.value = r[value] ?? '';
    op.textContent = r[label] ?? r[value] ?? '';
    selectEl.appendChild(op);
  }
}

function fmtDate(s){
  if(!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s);
  return d.toISOString().replace('T',' ').slice(0,16);
}

function splitInterests(s){
  if (!s) return [];
  if (Array.isArray(s)) return s;
  return String(s).split(',').map(x=>x.trim()).filter(Boolean);
}

////////////////////////////////////////////////////////////////////////////////
// Prefetch referencias (destinos/servicios) — se usa en varias pantallas
////////////////////////////////////////////////////////////////////////////////
async function prefetchRefs(){
  const [dests, servs] = await Promise.all([
    apiGet('public-destinations'),
    apiGet('public-services'),
  ]);

  if(!dests.ok){
    console.error(dests.error);
    toast('No se pudieron cargar destinos');
    state.destinations = [];
  } else {
    state.destinations = dests.items || [];
  }

  if(!servs.ok){
    console.error(servs.error);
    toast('No se pudieron cargar servicios');
    state.services = [];
  } else {
    state.services = servs.items || [];
  }

  // Armar selects compartidos
  fillSelect($('#selDestinationNew'), state.destinations);
  // El de "editar" se construye cuando entramos a la vista de edición
  refreshServiceSelectFor('#selServiceNew', $('#selKindNew')?.value || '');
}

function refreshServiceSelectFor(selectCss, kindFilter=''){
  const el = $(selectCss);
  if(!el) return;
  const items = state.services
    .filter(s => !kindFilter || s.service_kind === kindFilter);
  const rows = items.map(s => ({ id: s.id, name: `${s.name} ${s.destination ? '· '+s.destination : ''}` }));
  fillSelect(el, rows, { withEmpty:true, emptyText:'— (opcional) —' });
}

////////////////////////////////////////////////////////////////////////////////
// HOME — KPIs y recientes (del propio usuario)
////////////////////////////////////////////////////////////////////////////////
async function loadHome(){
  // Reusa la lista de mis solicitudes para KPIs y tabla "Recientes"
  const resp = await apiGet('client-requests-list');
  if(!resp.ok){
    console.error(resp.error);
    const msg = String(resp.error||'Error');
    if (/no existe la tabla .*requests/i.test(msg)) {
      toast('La tabla requests no existe. Corre el esquema SQL.');
    } else {
      toast('No se pudieron cargar tus solicitudes');
    }
    $('#kpiMine').textContent = '—';
    $('#tblMyRecent').innerHTML = '<tr><td colspan="6">Error</td></tr>';
    $('#chipsMine').innerHTML = '';
    return;
  }
  const items = resp.items || [];
  state.myRequests = items;

  // KPIs por estado
  const byStatus = items.reduce((acc, r)=>{
    const k = r.current_status || 'new';
    acc[k] = (acc[k]||0) + 1;
    return acc;
  }, {});
  const total = items.length;
  $('#kpiMine').textContent = String(total);
  const chips = $('#chipsMine'); chips.innerHTML = '';
  for (const [st, n] of Object.entries(byStatus)){
    const span = document.createElement('span');
    span.className = 'chip';
    span.textContent = `${st}: ${n}`;
    chips.appendChild(span);
  }

  // Recientes (top 10)
  const tb = $('#tblMyRecent'); tb.innerHTML = '';
  items.slice(0,10).forEach(r=>{
    const tr = document.createElement('tr');
    const fecha = r.start_date || r.created_at || '';
    tr.innerHTML = `
      <td>${r.id}</td>
      <td>${r.servicio || r.servicio_kind || r.service_kind || '—'}</td>
      <td>${r.destino || '—'}</td>
      <td>${r.current_status || 'new'}</td>
      <td>${fmtDate(fecha)}</td>
      <td><a class="btn" href="#solicitudes/edit?id=${encodeURIComponent(r.id)}">Editar</a></td>
    `;
    tb.appendChild(tr);
  });
}

////////////////////////////////////////////////////////////////////////////////
// NUEVA — crear solicitud
////////////////////////////////////////////////////////////////////////////////
function bindNueva(){
  const selKind = $('#selKindNew');
  selKind?.addEventListener('change', ()=>{
    refreshServiceSelectFor('#selServiceNew', selKind.value);
  });

  $('#formNewReq')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const f = e.target;
    const data = Object.fromEntries(new FormData(f).entries());

    const payload = {
      service_kind: data.service_kind || '',
      destination_id: data.destination_id || null,
      catalog_id: data.catalog_id || null,
      start_date: data.start_date || null,
      end_date: data.end_date || null,
      guests: data.guests ? +data.guests : null,
      budget_usd: data.budget_usd ? +data.budget_usd : null,
      dietary_notes: data.dietary_notes || null,
      interests: splitInterests(data.interests),
      notes: data.notes || null,
    };

    const r = await apiPost('client-requests-upsert', payload);
    const msgEl = $('#msgNewReq');
    msgEl.textContent = r.ok ? 'Enviado' : (r.error || 'Error');
    if(r.ok){
      f.reset();
      // recarga home y mis solicitudes
      await Promise.all([loadHome(), loadMisSolicitudes()]);
      // navega a mis solicitudes
      location.hash = '#mis-solicitudes';
      toast('Solicitud creada');
    }else{
      toast(msgEl.textContent);
    }
  });
}

////////////////////////////////////////////////////////////////////////////////
// MIS SOLICITUDES — listar y filtrar
////////////////////////////////////////////////////////////////////////////////
async function loadMisSolicitudes(){
  const st = $('#fltStatusMyReq')?.value || '';
  const d = await apiGet('client-requests-list', st ? { status: st } : {});
  const tb = $('#tblMyReq');
  if(!tb) return;

  if(!d.ok){
    console.error(d.error);
    tb.innerHTML = `<tr><td colspan="6">${d.error||'Error'}</td></tr>`;
    return;
  }

  const items = d.items || [];
  state.myRequests = items;

  if(items.length === 0){
    tb.innerHTML = '<tr><td colspan="6">Sin resultados</td></tr>';
    return;
  }

  tb.innerHTML = '';
  for(const it of items){
    const fecha = it.start_date || it.created_at || '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${it.id}</td>
      <td>${it.servicio || it.servicio_kind || it.service_kind || '—'}</td>
      <td>${it.destino || '—'}</td>
      <td>${fmtDate(fecha)}</td>
      <td>${it.current_status || 'new'}</td>
      <td><a class="btn" href="#solicitudes/edit?id=${encodeURIComponent(it.id)}">Editar</a></td>
    `;
    tb.appendChild(tr);
  }
}

function bindMisSolicitudes(){
  $('#btnLoadMyReq')?.addEventListener('click', loadMisSolicitudes);
}

////////////////////////////////////////////////////////////////////////////////
// EDITAR — cargar, pintar, guardar y cancelar
////////////////////////////////////////////////////////////////////////////////
function findReqInState(id){
  return state.myRequests.find(r => r.id === id) || null;
}

function previewEdit(data, box){
  if(!box) return;
  const lines = [];
  const mapKind = (v)=> v || data.servicio_kind || data.service_kind || '—';
  lines.push(`Servicio: ${mapKind(data.service_kind)}`);
  lines.push(`Destino: ${data.destination_id || '—'}`);
  lines.push(`Catálogo: ${data.catalog_id || '—'}`);
  lines.push(`Desde: ${data.start_date || '—'}  Hasta: ${data.end_date || '—'}`);
  lines.push(`Huéspedes: ${data.guests ?? '—'}  Presupuesto: ${data.budget_usd ?? '—'}`);
  lines.push(`Alimentación: ${data.dietary_notes || '—'}`);
  lines.push(`Intereses: ${(Array.isArray(data.interests)?data.interests:splitInterests(data.interests)).join(', ') || '—'}`);
  lines.push(`Notas: ${data.notes || '—'}`);
  box.textContent = lines.join('\n');
}

function fillEditSelects(){
  fillSelect($('#selDestinationEdit'), state.destinations, { withEmpty:true, emptyText:'— sin destino —' });
  // servicios filtrados por kind cuando cambie el select del form
  refreshServiceSelectFor('#selServiceEdit', $('[name="service_kind"]', $('#formReqEdit'))?.value || '');
}

function bindEditForm(){
  const form = $('#formReqEdit'); if(!form) return;
  // filtrar catálogo por tipo
  $('[name="service_kind"]', form)?.addEventListener('change', (e)=>{
    refreshServiceSelectFor('#selServiceEdit', e.target.value);
  });
  // previsualización on input
  form.addEventListener('input', ()=>{
    const data = Object.fromEntries(new FormData(form).entries());
    data.interests = splitInterests(data.interests);
    previewEdit(data, $('#reqPreview'));
  });
  // submit
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const payload = {
      id: data.id,
      service_kind: data.service_kind,
      destination_id: data.destination_id || null,
      catalog_id: data.catalog_id || null,
      start_date: data.start_date || null,
      end_date: data.end_date || null,
      guests: data.guests ? +data.guests : null,
      budget_usd: data.budget_usd ? +data.budget_usd : null,
      dietary_notes: data.dietary_notes || null,
      interests: splitInterests(data.interests),
      notes: data.notes || null,
    };
    const r = await apiPost('client-requests-upsert', payload);
    $('#msgReqEdit').textContent = r.ok ? 'Guardado' : (r.error||'Error');
    toast($('#msgReqEdit').textContent);
    if(r.ok){
      await loadMisSolicitudes();
    }
  });

  // Cancelar (cambiar a discarded)
  $('#btnCancelReq')?.addEventListener('click', async ()=>{
    const id = form.elements.id?.value;
    if(!id) return toast('Sin id');
    const r = await apiPost('client-requests-status', { id, to_status:'discarded' });
    if(!r.ok){ toast(r.error||'Error'); return; }
    toast('Solicitud cancelada');
    await loadMisSolicitudes();
    location.hash = '#mis-solicitudes';
  });
}

async function loadAdjuntosList(requestId){
  const ul = $('#attachmentsList');
  if(!ul) return;
  const r = await apiGet('client-attachments-list', { request_id: requestId });
  if(!r.ok){
    ul.innerHTML = `<li class="muted">${r.error||'Error'}</li>`;
    return;
  }
  const items = r.items || [];
  if(items.length === 0){
    ul.innerHTML = `<li class="muted">Sin adjuntos</li>`;
    return;
  }
  ul.innerHTML = '';
  for(const a of items){
    const li = document.createElement('li');
    const linkText = a.file_name || a.storage_url || a.id;
    const href = a.storage_url || '#';
    li.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div>
          <div><b>${linkText}</b></div>
          <div class="muted">${a.mime_type} · ${(a.size_bytes??0)} bytes · ${fmtDate(a.created_at)}</div>
        </div>
        ${href && href !== '#' ? `<a class="btn" href="${href}" target="_blank" rel="noopener">Ver</a>` : ''}
      </div>
    `;
    ul.appendChild(li);
  }
}

function bindUpload(){
  const f = $('#formUpload');
  if(!f) return;
  f.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const rid = $('#uploadRequestId')?.value || f.elements.request_id?.value || '';
    const file = f.elements.file?.files?.[0];
    if(!rid){ toast('request_id requerido'); return; }
    if(!file){ toast('Selecciona un archivo'); return; }
    const fd = new FormData();
    fd.append('request_id', rid);
    fd.append('file', file);

    // NOTA: esta ruta depende de tu función 'upload.js'
    const r = await fupload('/.netlify/functions/upload', fd);
    $('#msgUpload').textContent = r.ok ? 'Subido' : (r.error||'Error al subir');
    toast($('#msgUpload').textContent);
    if(r.ok){
      await loadAdjuntosList(rid);
      f.reset();
    }
  });
}

async function enterEditById(id){
  // buscar en cache; si no está, recargar lista
  let req = findReqInState(id);
  if(!req){
    const d = await apiGet('client-requests-list');
    if(d.ok) state.myRequests = d.items || [];
    req = findReqInState(id);
  }
  if(!req){
    toast('No se encontró la solicitud');
    location.hash = '#mis-solicitudes';
    return;
  }
  state.editCurrent = req;

  // mostrar sección
  setActiveNav('#mis-solicitudes'); // mantiene menú
  showSection('solicitud-edit');

  // llenar selects de referencias
  fillEditSelects();

  // poblar form
  const form = $('#formReqEdit');
  form.reset();
  form.elements.id.value = req.id;
  form.elements.service_kind.value = (req.service_kind || req.servicio_kind || 'tour');
  refreshServiceSelectFor('#selServiceEdit', form.elements.service_kind.value);
  if (req.destination_id) form.elements.destination_id.value = req.destination_id;
  if (req.catalog_id)     form.elements.catalog_id.value     = req.catalog_id;
  if (req.start_date)     form.elements.start_date.value     = req.start_date;
  if (req.end_date)       form.elements.end_date.value       = req.end_date;
  if (req.guests!=null)   form.elements.guests.value         = req.guests;
  if (req.budget_usd!=null) form.elements.budget_usd.value   = req.budget_usd;
  if (req.dietary_notes)  form.elements.dietary_notes.value  = req.dietary_notes;
  const ints = Array.isArray(req.interests) ? req.interests : splitInterests(req.interests);
  form.elements.interests.value = ints.join(', ');
  if (req.notes)          form.elements.notes.value          = req.notes;

  // preview
  previewEdit({
    service_kind: form.elements.service_kind.value,
    destination_id: form.elements.destination_id.value || null,
    catalog_id: form.elements.catalog_id.value || null,
    start_date: form.elements.start_date.value || null,
    end_date: form.elements.end_date.value || null,
    guests: form.elements.guests.value ? +form.elements.guests.value : null,
    budget_usd: form.elements.budget_usd.value ? +form.elements.budget_usd.value : null,
    dietary_notes: form.elements.dietary_notes.value || null,
    interests: splitInterests(form.elements.interests.value),
    notes: form.elements.notes.value || null,
  }, $('#reqPreview'));

  // listar adjuntos
  $('#uploadRequestId') && ($('#uploadRequestId').value = req.id);
  await loadAdjuntosList(req.id);
}

////////////////////////////////////////////////////////////////////////////////
// Router simple por hash
////////////////////////////////////////////////////////////////////////////////
async function router(){
  const h = location.hash || '#home';
  // rutas:
  // #home
  // #nueva
  // #mis-solicitudes
  // #solicitudes/edit?id=UUID
  try{
    if (h.startsWith('#solicitudes/edit')){
      const u = new URL(location.href);
      const id = u.hash.split('?')[1] ? new URLSearchParams(u.hash.split('?')[1]).get('id') : null;
      setActiveNav('#mis-solicitudes');
      await prefetchRefs(); // por si hay refresh
      await enterEditById(id);
      bindEditForm();
      bindUpload();
      return;
    }

    if (h === '#nueva'){
      setActiveNav('#nueva');
      showSection('nueva');
      await prefetchRefs();
      bindNueva();
      return;
    }

    if (h === '#mis-solicitudes'){
      setActiveNav('#mis-solicitudes');
      showSection('mis-solicitudes');
      await loadMisSolicitudes();
      bindMisSolicitudes();
      return;
    }

    // default: home
    setActiveNav('#home');
    showSection('home');
    await loadHome();
    $('#btnRefreshClient')?.addEventListener('click', loadHome);
  }catch(e){
    console.error('router error', e);
    toast('Error en router');
  }
}

////////////////////////////////////////////////////////////////////////////////
// Eventos globales
////////////////////////////////////////////////////////////////////////////////
$('#btnLogout')?.addEventListener('click', ()=>{
  localStorage.clear();
  // Importante: si tu login está bajo /client/
  location.replace('/client/login.html');
});

// navegación SPA
window.addEventListener('hashchange', router);

// Arranque
(async ()=>{
  if(!location.hash) location.hash = '#home';
  await prefetchRefs();
  await router();
})();
