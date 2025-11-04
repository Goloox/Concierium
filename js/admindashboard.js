// /js/admindashboard.js
const token = localStorage.getItem('token')||'';
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));

/* ============= Utils ============= */
const fget  = (url)=> fetch(url,{headers:{Authorization:'Bearer '+token}}).then(r=>r.json()).catch(e=>({ok:false,error:String(e)}));
const fpost = (url,body)=> fetch(url,{
  method:'POST', headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
  body:JSON.stringify(body)
}).then(r=>r.json()).catch(e=>({ok:false,error:String(e)}));

function toast(msg,type='warn',ms=4500){
  const t = $('#toast'); if(!t) return;
  t.textContent = msg;
  t.style.borderColor = type==='err'?'#ef4444':type==='ok'?'#19c37d':'rgba(255,255,255,.12)';
  t.style.display='block';
  clearTimeout(t._to); t._to = setTimeout(()=> t.style.display='none', ms);
}

/* ============= Estado (catálogos) ============= */
const REF = { destinations:[], providers:[] };

async function prefetchRefs(){
  const [dres, pres] = await Promise.allSettled([
    fget('/.netlify/functions/admin-destinations-list'),
    fget('/.netlify/functions/admin-providers-list')
  ]);
  const dOk = dres.status==='fulfilled' && !dres.value.error;
  const pOk = pres.status==='fulfilled' && !pres.value.error;

  REF.destinations = dOk ? (dres.value.items||[]).filter(x=>x.is_active) : [];
  REF.providers    = pOk ? (pres.value.items||[]).filter(x=>x.is_active) : [];

  const selDest = $('#selDestination');
  if (selDest) {
    selDest.innerHTML = `<option value="">— sin destino —</option>` +
      REF.destinations
        .sort((a,b)=> (a.sort_order-b.sort_order) || a.name.localeCompare(b.name))
        .map(d=>`<option value="${d.id}">${d.name}${d.country?(' · '+d.country):''}</option>`).join('');
  }
  const selProv = $('#selProvider');
  if (selProv) {
    selProv.innerHTML = `<option value="">— sin proveedor —</option>` +
      REF.providers
        .sort((a,b)=> a.name.localeCompare(b.name))
        .map(p=>`<option value="${p.id}">${p.name} · ${p.type}</option>`).join('');
  }
}

/* ============= Dashboard ============= */
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
      // si error de tabla inexistente, muéstralo suave, no revientes
      if (/relation .* does not exist/i.test(msg)) toast('Aún no existe alguna tabla/vista del dashboard. Revisa el deploy SQL.', 'warn');
      return;
    }

    elMsg.textContent = '';
    $('#kpiTotal').textContent = data.total ?? 0;

    const chips = $('#chips'); chips.innerHTML='';
    const palette = { new:'', curation:'warn', proposal_sent:'ok', confirmed:'ok', closed:'', discarded:'err' };
    (data.por_estado||[]).forEach(r=>{
      const span=document.createElement('span');
      span.textContent=`${r.status}: ${r.total}`;
      span.className='chip';
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
    if(!data.recientes?.length) tbR.innerHTML=`<tr><td colspan="6" class="muted">Sin recientes</td></tr>`;

    const tbS = $('#tblSLA'); tbS.innerHTML='';
    (data.sla||[]).forEach(r=>{
      const tags=[];
      if(r.breach_first_attention_2h) tags.push('>2h atenc.');
      if(r.breach_proposal_48h) tags.push('>48h propuesta');
      const tr=document.createElement('tr');
      const fmt=(x)=> (x||'').replace?.('T',' ').slice?.(0,19) || '—';
      tr.innerHTML=`<td>${r.id}</td><td>${fmt(r.created_at)}</td><td>${fmt(r.first_change_at)}</td><td>${fmt(r.proposal_at)}</td><td>${tags.join(' | ')||'—'}</td>`;
      tbS.appendChild(tr);
    });
    if(!data.sla?.length) tbS.innerHTML=`<tr><td colspan="5" class="muted">Sin alertas</td></tr>`;

  }catch(e){
    elMsg.textContent = 'Error al cargar dashboard';
    toast('Error al cargar dashboard', 'err');
    console.error(e);
  }
}
$('#btnRefresh')?.addEventListener('click', loadDash);

/* ============= Destinos ============= */
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
  const body=Object.fromEntries(new FormData(e.target).entries());
  body.sort_order=+body.sort_order; body.is_active=body.is_active==='true';
  const r=await fpost('/.netlify/functions/admin-destinations-upsert', body);
  $('#msgDest').textContent = r.ok ? 'Guardado' : (r.error||'Error');
  if(r.ok){ e.target.reset(); await loadDestinos(); await prefetchRefs(); }
});

/* ============= Proveedores ============= */
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
  const body=Object.fromEntries(new FormData(e.target).entries());
  body.rating=body.rating===''?null:+body.rating; body.is_active=body.is_active==='true';
  const r=await fpost('/.netlify/functions/admin-providers-upsert', body);
  $('#msgProv').textContent = r.ok ? 'Guardado' : (r.error||'Error');
  if(r.ok){ e.target.reset(); await loadProveedores(); await prefetchRefs(); }
});

/* ============= Servicios ============= */
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

  tb.querySelectorAll('.btnEditServ').forEach(btn=>{
    btn.onclick = async ()=>{
      const item=(d.items||[]).find(x=>x.id===btn.dataset.id);
      if(!item) return;
      const f=$('#formServ');
      f.id.value=item.id; f.service_kind.value=item.kind; f.name.value=item.name;
      f.description.value=item.description||''; f.base_price_usd.value=item.base_price_usd??'';
      f.is_active.value=item.is_active?'true':'false';
      await prefetchRefs();
      const dest=REF.destinations.find(dd=>dd.name===item.destination);
      const prov=REF.providers.find(pp=>pp.name===item.provider);
      $('#selDestination').value = dest?dest.id:'';
      $('#selProvider').value    = prov?prov.id:'';
      document.querySelector('.nav a[href="#servicios"]').click();
    };
  });
}
$('#formServ')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const body=Object.fromEntries(new FormData(e.target).entries());
  body.base_price_usd = body.base_price_usd===''?null:+body.base_price_usd;
  body.is_active = body.is_active==='true';
  body.destination_id = body.destination_id || null;
  body.provider_id    = body.provider_id || null;
  const r=await fpost('/.netlify/functions/admin-services-upsert', body);
  $('#msgServ').textContent = r.ok ? 'Guardado' : (r.error||'Error');
  if(r.ok){ e.target.reset(); await loadServicios(); await prefetchRefs(); }
});

/* ============= Solicitudes ============= */
async function loadRequests(){
  const st=$('#fltStatus').value;
  const url='/.netlify/functions/admin-requests-list'+(st?`?status=${encodeURIComponent(st)}`:'');
  const d=await fget(url);
  const tb=$('#tblReq'); tb.innerHTML='';
  if(d?.error || d?.ok===false){ tb.innerHTML=`<tr><td colspan="7" class="muted">${d.error||'Error'}</td></tr>`; return; }
  (d.items||[]).forEach(it=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`
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
    btn.onclick=async ()=>{
      const id=btn.getAttribute('data-id');
      const sel=tb.querySelector(`.selNext[data-id="${id}"]`);
      const to_status=sel.value;
      if(!to_status){ toast('Selecciona un estado','warn'); return; }
      const r=await fpost('/.netlify/functions/admin-requests-status',{ id, to_status });
      if(!r.ok){ toast(r.error||'Error','err'); return; }
      toast('Estado actualizado','ok',2500);
      loadRequests();
    };
  });
}
$('#btnLoadReq')?.addEventListener('click', loadRequests);

/* ============= Nav & Arranque ============= */
const sections=$$('.section');
$$('.nav a').forEach(a=>{
  a.onclick=(e)=>{ e.preventDefault();
    $$('.nav a').forEach(x=>x.classList.remove('active'));
    a.classList.add('active');
    const id=a.getAttribute('href').slice(1);
    sections.forEach(s=>s.style.display=(s.id===id?'block':'none'));
    if(id==='dash')        loadDash();
    if(id==='destinos')    loadDestinos();
    if(id==='proveedores') loadProveedores();
    if(id==='servicios') { prefetchRefs(); loadServicios(); }
    if(id==='solicitudes') loadRequests();
  };
});

$('#btnLogout')?.addEventListener('click', ()=>{ localStorage.clear(); location.replace('/login.html'); });
$('#fltStatus').value = '';

async function initialLoadAll(){
  // Precarga catálogos (para selects) y luego intenta todo; si algo falla, sigue con lo demás.
  await prefetchRefs();
  await Promise.allSettled([ loadDash(), loadDestinos(), loadProveedores(), loadServicios(), loadRequests() ]);
}

(async ()=>{
  if(!location.hash) location.hash='#dash';
  await initialLoadAll();
  const id=(location.hash||'#dash').slice(1);
  $$('.nav a').forEach(a=>a.classList.toggle('active', a.getAttribute('href')===('#'+id)));
  sections.forEach(s=>s.style.display=(s.id===id?'block':'none'));
})();
