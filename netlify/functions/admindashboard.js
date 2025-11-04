// /js/admindashboard.js (ESM)
const token = localStorage.getItem('token')||'';
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));

/* =========================
   Helpers HTTP (JSON)
========================= */
const fget  = (url)=> fetch(url,{headers:{Authorization:'Bearer '+token}}).then(r=>r.json());
const fpost = (url,body)=> fetch(url,{
  method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token},
  body:JSON.stringify(body)
}).then(r=>r.json());

/* =========================
   Estado (catálogos)
========================= */
const REF = {
  destinations: [],
  providers: []
};

async function prefetchRefs(){
  const [dres, pres] = await Promise.allSettled([
    fget('/.netlify/functions/admin-destinations-list'),
    fget('/.netlify/functions/admin-providers-list')
  ]);

  const dItems = (dres.value?.items||[]).filter(x=>x.is_active);
  const pItems = (pres.value?.items||[]).filter(x=>x.is_active);

  REF.destinations = dItems;
  REF.providers    = pItems;

  // Llenar selects (si están presentes)
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
}

/* =========================
   DASHBOARD
========================= */
async function loadDash() {
  try{
    const data = await fget('/.netlify/functions/admin-dashboard');
    if(!data.ok) throw new Error(data.error||'Error');
    $('#kpiTotal').textContent = data.total ?? 0;

    const chips = $('#chips'); chips.innerHTML='';
    const palette = { new:'', curation:'warn', proposal_sent:'ok', confirmed:'ok', closed:'', discarded:'err' };
    (data.por_estado||[]).forEach(r=>{
      const span=document.createElement('span');
      span.textContent=`${r.status}: ${r.total}`;
      span.style.cssText='padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.12);margin-right:6px';
      if(palette[r.status]==='ok') span.style.color='#19c37d';
      if(palette[r.status]==='warn') span.style.color='#f5a524';
      if(palette[r.status]==='err') span.style.color='#ef4444';
      chips.appendChild(span);
    });

    const tbR = $('#tblRecent'); tbR.innerHTML='';
    (data.recientes||[]).forEach(r=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${r.id}</td><td>${r.cliente}</td><td>${r.servicio}</td><td>${r.destino}</td><td>${r.estado}</td><td>${r.creada}</td>`;
      tbR.appendChild(tr);
    });

    const tbS = $('#tblSLA'); tbS.innerHTML='';
    (data.sla||[]).forEach(r=>{
      const tags=[];
      if(r.breach_first_attention_2h) tags.push('>2h atenc.');
      if(r.breach_proposal_48h) tags.push('>48h propuesta');
      const tr=document.createElement('tr');
      const fmt = (x)=> (x||'').replace?.('T',' ').slice?.(0,19) || '—';
      tr.innerHTML=`<td>${r.id}</td><td>${fmt(r.created_at)}</td><td>${fmt(r.first_change_at)}</td><td>${fmt(r.proposal_at)}</td><td>${tags.join(' | ')||'—'}</td>`;
      tbS.appendChild(tr);
    });
  }catch(e){ console.error(e); alert('No se pudo cargar el dashboard'); }
}
$('#btnRefresh')?.addEventListener('click', loadDash);

/* =========================
   DESTINOS
========================= */
async function loadDestinos(){
  const d = await fget('/.netlify/functions/admin-destinations-list');
  const tb = $('#tblDestinos'); tb.innerHTML='';
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
  if (r.ok) { e.target.reset(); loadDestinos(); await prefetchRefs(); }
});

/* =========================
   PROVEEDORES
========================= */
async function loadProveedores(){
  const d = await fget('/.netlify/functions/admin-providers-list');
  const tb = $('#tblProveedores'); tb.innerHTML='';
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
  body.rating   = body.rating===''?null:+body.rating;
  body.is_active = body.is_active === 'true';
  const r = await fpost('/.netlify/functions/admin-providers-upsert', body);
  $('#msgProv').textContent = r.ok ? 'Guardado' : (r.error||'Error');
  if (r.ok) { e.target.reset(); loadProveedores(); await prefetchRefs(); }
});

/* =========================
   SERVICIOS
========================= */
async function loadServicios(){
  const d = await fget('/.netlify/functions/admin-services-list');
  const tb = $('#tblServicios'); tb.innerHTML='';
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

  // Edición rápida: rellena form con coincidencias por nombre (si tu endpoint no manda IDs)
  tb.querySelectorAll('.btnEditServ').forEach(btn=>{
    btn.onclick = async ()=>{
      const item = (d.items||[]).find(x=>x.id===btn.dataset.id);
      if(!item) return;

      const f = $('#formServ');
      f.id.value = item.id;
      f.service_kind.value = item.kind;
      f.name.value = item.name;
      f.description.value = item.description || '';
      f.base_price_usd.value = item.base_price_usd ?? '';
      f.is_active.value = item.is_active ? 'true' : 'false';

      await prefetchRefs();
      const dest = REF.destinations.find(dd => dd.name === item.destination);
      const prov = REF.providers.find(pp => pp.name === item.provider);
      $('#selDestination').value = dest ? dest.id : '';
      $('#selProvider').value    = prov ? prov.id : '';

      // Navega a la pestaña
      document.querySelector('.nav a[href="#servicios"]').click();
    };
  });
}

$('#formServ')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  body.base_price_usd = body.base_price_usd===''?null:+body.base_price_usd;
  body.is_active = body.is_active === 'true';
  body.destination_id = body.destination_id ? body.destination_id : null;
  body.provider_id    = body.provider_id ? body.provider_id : null;

  const r = await fpost('/.netlify/functions/admin-services-upsert', body);
  $('#msgServ').textContent = r.ok ? 'Guardado' : (r.error||'Error');
  if (r.ok) {
    e.target.reset();
    await loadServicios();
    await prefetchRefs();
  }
});

/* =========================
   SOLICITUDES
========================= */
async function loadRequests(){
  const st = $('#fltStatus').value;
  const url = '/.netlify/functions/admin-requests-list' + (st?`?status=${encodeURIComponent(st)}`:'');
  const d = await fget(url);
  const tb = $('#tblReq'); tb.innerHTML='';
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
      const id = btn.getAttribute('data-id');
      const sel = tb.querySelector(`.selNext[data-id="${id}"]`);
      const to_status = sel.value;
      if(!to_status){ alert('Selecciona un estado'); return; }
      const r = await fpost('/.netlify/functions/admin-requests-status', { id, to_status });
      if(!r.ok) return alert(r.error||'Error');
      alert('Estado actualizado');
      loadRequests();
    };
  });
}
$('#btnLoadReq')?.addEventListener('click', loadRequests);

/* =========================
   Navegación y arranque
========================= */
const sections = $$('.section');
$$('.nav a').forEach(a=>{
  a.onclick = (e)=>{ e.preventDefault();
    $$('.nav a').forEach(x=>x.classList.remove('active'));
    a.classList.add('active');
    const id = a.getAttribute('href').slice(1);
    sections.forEach(s=>s.style.display = (s.id===id?'block':'none'));
    // Cargas por sección
    if (id==='dash')        loadDash();
    if (id==='destinos')    loadDestinos();
    if (id==='proveedores') loadProveedores();
    if (id==='servicios')  { prefetchRefs(); loadServicios(); }
    if (id==='solicitudes') loadRequests();
  };
});

$('#btnLogout')?.addEventListener('click', ()=>{ localStorage.clear(); location.replace('/login.html'); });

$('#fltStatus').value = '';

async function initialLoadAll(){
  await prefetchRefs();
  await Promise.allSettled([
    loadDash(),
    loadDestinos(),
    loadProveedores(),
    loadServicios(),
    loadRequests()
  ]);
}

(async ()=>{
  if(!location.hash) location.hash = '#dash';
  await initialLoadAll();
  // aplica estado visual de tabs según hash
  const id = (location.hash||'#dash').slice(1);
  $$('.nav a').forEach(a=>a.classList.toggle('active', a.getAttribute('href')===('#'+id)));
  sections.forEach(s=>s.style.display = (s.id===id?'block':'none'));
})();
