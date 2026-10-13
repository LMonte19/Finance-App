import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { readPageQuery, watchPage, invalidatePageReads, isStalePageSession, getPageSessionId, loadingRows } from './page-read-runtime.js?v=1';
import { setStableMarkup } from './dashboard-presentation.js?v=1';
import { qs, esc, money, percent, roleName, initials, dateLabel, icon, kpi, empty, readViewer } from './combined-workspace-ui.js?v=1';

const db=createClient('https://eatxkhhpjruwwibhcubf.supabase.co','sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q',
  {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:'loan-ledger-auth'}});
const state={data:null,tab:'team',requestedTab:null,role:'',search:'',busy:false,pending:null,sequence:0,detailSequence:0,draft:[],dirty:false,saving:false,returnFocus:null};
const eligible=p=>['ADMIN','PARTNER'].includes(p.role);
const financial=(person,field)=>person[field]==null?'—':money(person[field]);
const typeName=type=>String(type||'').includes('MANAGEMENT')?'Administración':'Ingreso de socio';

function ensureShell(){
  const page=qs('partnersPage');if(!page||qs('partnersWorkspace'))return;
  page.classList.add('ll-combined-page');page.dataset.combinedWorkspace='true';
  page.innerHTML=`<div id="partnersWorkspace" data-no-translate="true">
    <header class="cw-header"><div><h1>Socios y usuarios</h1><p>Personas, capital y distribución de inversión en un solo lugar.</p></div><button type="button" class="cw-button" data-partners-refresh>Actualizar</button></header>
    <div id="partnersKpis" class="cw-kpis">${skeletonKpis()}</div>
    <nav class="cw-tabs" role="tablist" aria-label="Secciones de socios"><button id="partnersTeamTab" role="tab" aria-controls="partnersTeamPanel" data-partners-tab="team" aria-selected="true">Equipo</button><button id="partnersAllocationsTab" role="tab" aria-controls="partnersAllocationsPanel" data-partners-tab="allocations" aria-selected="false">Distribuciones</button><button id="partnersSplitTab" role="tab" aria-controls="partnersSplitPanel" data-partners-tab="split" aria-selected="false" hidden>Distribución predeterminada</button></nav>
    <div id="partnersMessage" class="cw-message" role="status" hidden></div>
    <section id="partnersTeamPanel" role="tabpanel" aria-labelledby="partnersTeamTab">
      <div class="cw-team-layout"><section class="cw-card"><div class="cw-card-head"><div><h2>Personas del equipo</h2><p id="partnersTeamCount">Socios, administradores y agentes.</p></div></div>
        <div class="cw-controls"><label class="cw-search">${icon('search')}<input id="partnersSearch" type="search" placeholder="Buscar por nombre…" aria-label="Buscar personas"></label><label><span class="cw-sr">Filtrar por rol</span><select id="partnersFilterRole"><option value="">Todos los roles</option><option value="ADMIN">Administradores</option><option value="AGENT">Agentes</option><option value="PARTNER">Socios</option></select></label></div>
        <div class="cw-table-scroll"><table class="cw-table"><thead><tr><th>Persona / rol</th><th>Capital activo</th><th>Ingreso de socio</th><th>Administración</th><th><span class="cw-sr">Acciones</span></th></tr></thead><tbody id="partnersTeamRows"></tbody></table><div id="partnersTeamLoading">${loadingRows()}</div></div>
      </section><aside class="cw-card"><div class="cw-card-head"><div><h2>Distribuciones recientes</h2><p>Asignadas a partir de pagos registrados.</p></div><button class="cw-link" type="button" data-partners-tab="allocations">Ver todas</button></div><div id="partnersRecent">${loadingRows(3)}</div></aside></div>
    </section>
    <section id="partnersAllocationsPanel" role="tabpanel" aria-labelledby="partnersAllocationsTab" hidden><div class="cw-card"><div class="cw-card-head"><div><h2>Distribuciones a personas</h2><p>Ingreso de socios y administración, con sus pagos vinculados.</p></div></div><div class="cw-controls"><label><span class="cw-sr">Persona</span><select id="partnersFilterPerson"><option value="">Todas las personas</option></select></label><label><span class="cw-sr">Estado</span><select id="partnersFilterAllocation"><option value="active">Vigentes</option><option value="voided">Anuladas</option><option value="all">Todas</option></select></label></div><div id="partnersAllocations">${loadingRows()}</div><p id="partnersAllocationMore" class="cw-help"></p></div></section>
    <section id="partnersSplitPanel" role="tabpanel" aria-labelledby="partnersSplitTab" hidden><div id="partnersSplitEditor" class="cw-split-layout"></div></section>
    <div id="partnersBackdrop" class="cw-backdrop" hidden data-partners-close></div><aside id="partnersSheet" class="cw-sheet" role="dialog" aria-modal="true" aria-labelledby="partnersSheetTitle" hidden tabindex="-1"></aside>
  </div>`;
  page.addEventListener('click',handleClick);page.addEventListener('input',handleInput);page.addEventListener('change',handleChange);page.addEventListener('submit',handleSubmit);
  page.addEventListener('keydown',event=>{
    const sheet=qs('partnersSheet');if(event.key==='Escape')closeSheet();
    if(event.key!=='Tab'||sheet.hidden)return;
    const nodes=[...sheet.querySelectorAll('button,input,select,[href]')].filter(x=>!x.disabled&&!x.hidden);if(!nodes.length)return;
    const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  });
}
function skeletonKpis(){return ['Capital activo','Ingresos de socios','Administración','Personas'].map(label=>kpi(label,'—','—')).join('');}
async function readData(force=false){
  const viewer=await readViewer(db,force);if(!viewer)throw new Error('Inicia sesión para consultar el equipo.');
  const admin=viewer.role==='ADMIN';
  const [summary,allocations,profiles,split]=await Promise.all([
    readPageQuery('partners-summary',()=>db.from('partner_earnings_summary').select('*').order('active_capital',{ascending:false}),{force}),
    readPageQuery('partners-allocations',()=>db.from('partner_allocation_details').select('*').order('created_at',{ascending:false}).order('id',{ascending:false}).limit(100),{force}),
    admin?readPageQuery('profiles',()=>db.from('profiles').select('user_id,full_name,role,created_at').order('full_name',{ascending:true}),{force}):Promise.resolve({data:[]}),
    admin?readPageQuery('setting:default_funding_split',()=>db.from('app_settings').select('setting_value').eq('setting_key','default_funding_split').maybeSingle(),{force}):Promise.resolve({data:null})
  ]);
  for(const r of [summary,allocations,profiles,split])if(r.error)throw r.error;
  const people=new Map((summary.data||[]).map(p=>[p.user_id,{...p}]));(profiles.data||[]).forEach(p=>people.set(p.user_id,{...(people.get(p.user_id)||{}),...p}));
  return {viewer,people:[...people.values()].sort((a,b)=>String(a.full_name||'').localeCompare(String(b.full_name||''),'es')),summary:summary.data||[],allocations:allocations.data||[],split:Array.isArray(split.data?.setting_value)?split.data.setting_value:[]};
}
function message(text,error=false){const host=qs('partnersMessage');if(!host)return;host.hidden=!text;host.textContent=text;host.classList.toggle('is-error',error);}
function setTab(tab){if(tab==='split'&&state.data?.viewer.role!=='ADMIN')return;state.tab=tab;['team','allocations','split'].forEach(name=>{qs({team:'partnersTeamPanel',allocations:'partnersAllocationsPanel',split:'partnersSplitPanel'}[name]).hidden=name!==tab;qs('partnersWorkspace').querySelectorAll('[role="tab"][data-partners-tab="'+name+'"]').forEach(b=>b.setAttribute('aria-selected',String(name===tab)));});}
function renderData(){
  const data=state.data;if(!data)return;const sum=field=>data.summary.reduce((total,p)=>total+Number(p[field]||0),0);
  setStableMarkup(qs('partnersKpis'),kpi('Capital activo',money(sum('active_capital')),'Participación en capital pendiente','wallet')+kpi('Ingresos de socios',money(sum('funding_earned')),'Asignaciones vigentes acumuladas','dollar','lime')+kpi('Administración',money(sum('management_earned')),'Asignaciones vigentes acumuladas','chart','blue')+kpi('Personas',String(data.people.length),'Roles y participación en el equipo','users'));
  qs('partnersSplitTab').hidden=data.viewer.role!=='ADMIN';if(data.viewer.role!=='ADMIN'&&state.tab==='split')setTab('team');renderPeople();
  setStableMarkup(qs('partnersRecent'),data.allocations.filter(r=>!r.is_voided).slice(0,5).map(allocationRow).join('')||empty('Todavía no hay distribuciones.'));
  const filter=qs('partnersFilterPerson'),selected=filter.value;if(setStableMarkup(filter,'<option value="">Todas las personas</option>'+data.people.map(p=>`<option value="${esc(p.user_id)}">${esc(p.full_name||'Sin nombre')}</option>`).join('')))filter.value=data.people.some(p=>p.user_id===selected)?selected:'';
  renderAllocations();if(!state.dirty){state.draft=data.split.map(r=>({...r}));renderSplit();}if(data.viewer.role!=='ADMIN')setStableMarkup(qs('partnersSplitEditor'),'');
  if(state.requestedTab){setTab(state.requestedTab);state.requestedTab=null;}
}
function renderPeople(){
  if(!state.data)return;const rows=state.data.people.filter(p=>(!state.role||p.role===state.role)&&String(p.full_name||'').toLowerCase().includes(state.search.toLowerCase()));const admin=state.data.viewer.role==='ADMIN';
  qs('partnersTeamCount').textContent=`${rows.length} ${rows.length===1?'persona':'personas'} · Capital e ingresos por rol`;qs('partnersTeamLoading').hidden=true;
  setStableMarkup(qs('partnersTeamRows'),rows.map(p=>`<tr><td><button type="button" class="cw-person-button" data-partner-detail="${esc(p.user_id)}"><span class="cw-avatar">${esc(initials(p.full_name))}</span><span><strong>${esc(p.full_name||'Sin nombre')}</strong><small class="cw-role">${roleName(p.role)}</small></span></button></td><td><strong>${financial(p,'active_capital')}</strong></td><td>${financial(p,'funding_earned')}</td><td>${financial(p,'management_earned')}</td><td class="cw-row-actions">${admin?`<button class="cw-icon-button" type="button" data-partner-edit="${esc(p.user_id)}" aria-label="Editar perfil de ${esc(p.full_name)}">${icon('edit')}</button>`:''}<button class="cw-icon-button" type="button" data-partner-detail="${esc(p.user_id)}" aria-label="Detalle de ${esc(p.full_name)}">${icon('arrow')}</button></td></tr>`).join('')||`<tr><td colspan="5">${empty('No hay personas que coincidan con estos filtros.')}</td></tr>`);
}
function allocationRow(r){return `<div class="cw-distribution ${r.is_voided?'is-voided':''}"><span class="cw-round-icon ${String(r.allocation_type).includes('MANAGEMENT')?'blue':'purple'}">${icon('dollar')}</span><div><button class="cw-text-button" type="button" data-partner-detail="${esc(r.partner_user_id)}">${esc(r.partner_name||'Sin nombre')}</button><small>${esc(r.borrower_name||'Sin cliente')} · ${typeName(r.allocation_type)}</small><small>${dateLabel(r.paid_on)}${r.is_voided?' · Anulada':''}</small></div><strong>${money(r.amount)}</strong></div>`;}
function renderAllocations(){if(!state.data)return;const person=qs('partnersFilterPerson').value,mode=qs('partnersFilterAllocation').value;const rows=state.data.allocations.filter(r=>(!person||r.partner_user_id===person)&&(mode==='all'||(mode==='voided'?r.is_voided:!r.is_voided)));setStableMarkup(qs('partnersAllocations'),rows.map(allocationRow).join('')||empty('No hay distribuciones en esta vista.'));qs('partnersAllocationMore').textContent=`${rows.length} registros · Se consultan las 100 distribuciones más recientes. El historial completo está en Actividad y reportes.`;}
function draftValid(){const ids=new Set(),allowed=new Set((state.data?.people||[]).filter(eligible).map(p=>p.user_id));const total=state.draft.reduce((sum,r)=>sum+Number(r.funding_percent||0),0);const valid=state.draft.length>0&&state.draft.every(r=>{const ok=allowed.has(r.partner_user_id)&&!ids.has(r.partner_user_id)&&Number.isFinite(r.funding_percent)&&r.funding_percent>0&&r.funding_percent<=1;ids.add(r.partner_user_id);return ok;})&&Math.abs(total-1)<=0.00001;return {total,valid};}
function renderSplit(force=false){
  if(state.data?.viewer.role!=='ADMIN')return;const names=new Map(state.data.people.map(p=>[p.user_id,p.full_name]));
  const html=`<section class="cw-card cw-split-card"><div class="cw-card-head"><div><h2>Distribución para nuevos desembolsos</h2><p>Define qué porcentaje del capital aporta cada persona. Se aplica como punto de partida a los próximos desembolsos.</p></div></div><form id="partnersSplitForm"><div>${state.draft.map(r=>`<div class="cw-split-row"><span class="cw-avatar">${esc(initials(names.get(r.partner_user_id)||r.partner_name))}</span><span><strong>${esc(names.get(r.partner_user_id)||r.partner_name||'Persona no disponible')}</strong><small>Participación de inversión</small></span><label><span class="cw-sr">Porcentaje de ${esc(names.get(r.partner_user_id)||r.partner_name)}</span><input type="number" step="0.01" min="0.01" max="100" data-split-percent="${esc(r.partner_user_id)}" value="${Number((r.funding_percent*100).toFixed(2))}" required><span>%</span></label><button class="cw-icon-button" type="button" data-split-remove="${esc(r.partner_user_id)}" aria-label="Quitar persona">${icon('close')}</button></div>`).join('')||empty('Agrega las personas que participarán en la inversión.')}</div><div class="cw-split-add"><label><span>Agregar persona</span><select id="partnersSplitPerson"><option value="">Selecciona un socio o administrador</option>${state.data.people.filter(p=>eligible(p)&&!state.draft.some(r=>r.partner_user_id===p.user_id)).map(p=>`<option value="${esc(p.user_id)}">${esc(p.full_name||'Sin nombre')} · ${roleName(p.role)}</option>`).join('')}</select></label><button class="cw-button" type="button" data-split-add>${icon('plus')} Agregar</button></div><div class="cw-split-summary"><div><span>Total de inversión</span><strong id="partnersSplitTotal">—</strong></div><p id="partnersSplitStatus" role="status"></p></div><footer class="cw-form-actions"><button class="cw-button" type="button" data-split-discard>Descartar cambios</button><button id="partnersSplitSave" class="cw-button cw-primary" type="submit">Guardar distribución</button></footer></form></section><aside class="cw-card cw-explainer"><h3>Cómo se usa</h3><p>Esta distribución corresponde a la inversión de capital. Los porcentajes de interés y administración se definen en Configuración.</p><p>Los desembolsos existentes conservan la distribución registrada al crearlos.</p></aside>`;
  setStableMarkup(qs('partnersSplitEditor'),html,force);updateSplitStatus();
}
function updateSplitStatus(){const {total,valid}=draftValid();if(!qs('partnersSplitTotal'))return;qs('partnersSplitTotal').textContent=percent(total);qs('partnersSplitStatus').textContent=valid?(state.dirty?'Listo para guardar.':'Distribución guardada.'):total>1?'Reduce los porcentajes para llegar a 100%.':'La distribución debe sumar 100% y usar socios o administradores.';qs('partnersSplitStatus').classList.toggle('is-error',!valid);qs('partnersSplitSave').disabled=!valid||!state.dirty||state.saving;}
function closeSheet(){state.detailSequence++;if(qs('partnersSheet'))qs('partnersSheet').hidden=true;if(qs('partnersBackdrop'))qs('partnersBackdrop').hidden=true;state.returnFocus?.focus?.();}
function showSheet(html){state.returnFocus=document.activeElement;qs('partnersSheet').innerHTML=`<div class="cw-sheet-head"><h2 id="partnersSheetTitle">Detalle de persona</h2><button class="cw-icon-button" type="button" data-partners-close aria-label="Cerrar panel">${icon('close')}</button></div><div class="cw-sheet-body">${html}</div>`;qs('partnersSheet').hidden=false;qs('partnersBackdrop').hidden=false;qs('partnersSheet').focus();}
function personHeader(p){return `<div class="cw-person-heading"><span class="cw-avatar">${esc(initials(p.full_name))}</span><div><h3>${esc(p.full_name||'Sin nombre')}</h3><span class="cw-role">${roleName(p.role)}</span></div></div>`;}
async function showDetails(id){
  const p=state.data?.people.find(p=>p.user_id===id);if(!p)return;showSheet(personHeader(p)+loadingRows());const sequence=++state.detailSequence;
  try{
    const [loans,allocations]=await Promise.all([readPageQuery('partner:'+id+':loans',()=>db.from('partner_funded_loans').select('*').eq('partner_user_id',id).order('start_date',{ascending:false})),readPageQuery('partner:'+id+':allocations',()=>db.from('partner_allocation_details').select('*').eq('partner_user_id',id).order('created_at',{ascending:false}).limit(100))]);
    if(sequence!==state.detailSequence)return;for(const r of [loans,allocations])if(r.error)throw r.error;
    const groups=new Map();(loans.data||[]).forEach(r=>{const key=r.borrower_id||r.borrower_name;if(!groups.has(key))groups.set(key,{id:r.borrower_id,name:r.borrower_name,capital:0,loans:[]});const group=groups.get(key);group.capital+=Number(r.partner_active_capital||0);group.loans.push(r);});
    setStableMarkup(qs('partnersSheet').querySelector('.cw-sheet-body'),personHeader(p)+`<div class="cw-detail-metrics"><div><small>Capital activo</small><strong>${financial(p,'active_capital')}</strong></div><div><small>Ingreso de socio</small><strong>${financial(p,'funding_earned')}</strong></div><div><small>Administración</small><strong>${financial(p,'management_earned')}</strong></div></div><h3>Participación por cliente</h3>${[...groups.values()].map(g=>`<details class="cw-participation"><summary><span><strong>${esc(g.name||'Sin cliente')}</strong><small>${g.loans.length} ${g.loans.length===1?'desembolso':'desembolsos'}</small></span><strong>${money(g.capital)}</strong></summary><div>${g.loans.map(r=>`<div class="cw-detail-row"><span>${dateLabel(r.start_date)}<small>Participación ${percent(r.funding_percent)} · ${r.status==='ACTIVE'?'Activo':r.status==='VOID'?'Anulado':esc(r.status||'—')}</small></span><strong>${money(r.partner_active_capital)}</strong></div>`).join('')}${g.id?`<button type="button" class="cw-link" data-partner-account="${esc(g.id)}">Abrir cuenta del cliente</button>`:''}</div></details>`).join('')||empty('Esta persona no tiene participación en desembolsos.')}<h3>Últimas distribuciones</h3>${(allocations.data||[]).slice(0,20).map(allocationRow).join('')||empty('No hay distribuciones para esta persona.')}`);
  }catch(e){if(!isStalePageSession(e)&&sequence===state.detailSequence)setStableMarkup(qs('partnersSheet').querySelector('.cw-sheet-body'),personHeader(p)+empty(e.message||String(e)));}
}
function editPerson(id){if(state.data?.viewer.role!=='ADMIN')return;const p=state.data.people.find(p=>p.user_id===id);if(!p)return;showSheet(personHeader(p)+`<form id="partnersProfileForm" data-user-id="${esc(id)}"><label class="cw-field"><span>Nombre</span><input name="full_name" value="${esc(p.full_name||'')}" maxlength="120" required></label><label class="cw-field"><span>Rol de acceso</span><select name="role">${['ADMIN','AGENT','PARTNER'].map(r=>`<option value="${r}" ${p.role===r?'selected':''}>${roleName(r)}</option>`).join('')}</select></label><p class="cw-help">Administrador gestiona la aplicación; agente registra operaciones; socio consulta información según sus permisos.</p><div id="partnersProfileStatus" role="status" class="cw-message" hidden></div><button class="cw-button cw-primary" type="submit">Guardar perfil</button></form>`);}
async function requireAdmin(){const p=await readViewer(db,true);if(p?.role!=='ADMIN')throw new Error('Solo un administrador puede guardar estos cambios.');return p;}
async function handleSubmit(event){
  const form=event.target;if(!['partnersSplitForm','partnersProfileForm'].includes(form.id))return;event.preventDefault();if(state.saving)return;
  state.saving=true;const owner=getPageSessionId(),sequence=state.detailSequence;
  try{
    await requireAdmin();if(owner!==getPageSessionId())return;
    if(form.id==='partnersSplitForm'){
      if(!draftValid().valid)throw new Error('La distribución debe sumar 100% y contener porcentajes válidos.');
      const rows=state.draft.map(r=>({partner_user_id:r.partner_user_id,partner_name:state.data.people.find(p=>p.user_id===r.partner_user_id)?.full_name||r.partner_name,funding_percent:r.funding_percent}));
      const {error}=await db.rpc('set_app_setting',{p_key:'default_funding_split',p_value:rows});if(error)throw error;if(owner!==getPageSessionId())return;
      state.dirty=false;invalidatePageReads();await refresh(true);window.dispatchEvent(new CustomEvent('loan-ledger:defaults-updated'));message('Distribución guardada para nuevos desembolsos.');
    }else{
      const name=form.elements.full_name.value.trim(),role=form.elements.role.value;if(!name||!['ADMIN','AGENT','PARTNER'].includes(role))throw new Error('Completa un nombre y un rol válidos.');
      const {error}=await db.rpc('update_profile_admin',{p_user_id:form.dataset.userId,p_full_name:name,p_role:role});if(error)throw error;if(owner!==getPageSessionId())return;
      invalidatePageReads();if(sequence===state.detailSequence)closeSheet();await refresh(true);window.dispatchEvent(new CustomEvent('loan-ledger:profile-updated',{detail:{userId:form.dataset.userId}}));message('Perfil actualizado.');
    }
  }catch(e){if(!isStalePageSession(e)){message(e.message||String(e),true);const status=qs('partnersProfileStatus');if(status){status.hidden=false;status.textContent=e.message||String(e);status.classList.add('is-error');}}}
  finally{state.saving=false;updateSplitStatus();}
}
function handleInput(e){if(e.target.id==='partnersSearch'){state.search=e.target.value;renderPeople();}const id=e.target.dataset.splitPercent;if(id){const r=state.draft.find(r=>r.partner_user_id===id);if(r)r.funding_percent=Number(e.target.value)/100;state.dirty=true;updateSplitStatus();}}
function handleChange(e){if(e.target.id==='partnersFilterRole'){state.role=e.target.value;renderPeople();}if(['partnersFilterPerson','partnersFilterAllocation'].includes(e.target.id))renderAllocations();}
function handleClick(e){
  const t=e.target;if(t.closest('[data-partners-close]')){closeSheet();return;}const account=t.closest('[data-partner-account]');if(account){closeSheet();window.dispatchEvent(new CustomEvent('loan-ledger:open-account',{detail:{borrowerId:account.dataset.partnerAccount}}));return;}
  const edit=t.closest('[data-partner-edit]');if(edit){editPerson(edit.dataset.partnerEdit);return;}const detail=t.closest('[data-partner-detail]');if(detail){showDetails(detail.dataset.partnerDetail);return;}const tab=t.closest('[data-partners-tab]');if(tab){setTab(tab.dataset.partnersTab);return;}if(t.closest('[data-partners-refresh]')){refresh(true);return;}
  if(state.data?.viewer.role!=='ADMIN')return;if(t.closest('[data-split-add]')){const p=state.data.people.find(p=>p.user_id===qs('partnersSplitPerson').value);if(p&&eligible(p)&&!state.draft.some(r=>r.partner_user_id===p.user_id)){state.draft.push({partner_user_id:p.user_id,partner_name:p.full_name,funding_percent:0});state.dirty=true;renderSplit();}return;}
  const remove=t.closest('[data-split-remove]');if(remove){state.draft=state.draft.filter(r=>r.partner_user_id!==remove.dataset.splitRemove);state.dirty=true;renderSplit();return;}if(t.closest('[data-split-discard]')){state.draft=state.data.split.map(r=>({...r}));state.dirty=false;renderSplit(true);}
}
async function refresh(force=false){ensureShell();if(!qs('partnersPage')?.classList.contains('active-page'))return;if(state.busy){state.pending=!!force||!!state.pending;return;}state.busy=true;const sequence=++state.sequence;try{const data=await readData(force);if(sequence!==state.sequence)return;state.data=data;renderData();}catch(e){if(!isStalePageSession(e))message(e.message||String(e),true);}finally{state.busy=false;if(state.pending!==null){const pending=state.pending;state.pending=null;queueMicrotask(()=>refresh(pending));}}}
ensureShell();
window.addEventListener('loan-ledger:partners-tab',event=>{state.requestedTab=event.detail?.tab||'team';if(state.data){setTab(state.requestedTab);state.requestedTab=null;}else refresh(false);});
watchPage('partnersPage',()=>refresh(false),{prefetch:()=>readData(false),reset:()=>{
  state.sequence++;closeSheet();state.data=null;state.draft=[];state.dirty=false;state.role='';state.search='';state.saving=false;state.tab='team';state.requestedTab=null;
  setStableMarkup(qs('partnersTeamRows'),'');setStableMarkup(qs('partnersRecent'),loadingRows());setStableMarkup(qs('partnersAllocations'),loadingRows());setStableMarkup(qs('partnersSplitEditor'),'');setStableMarkup(qs('partnersKpis'),skeletonKpis());
  setStableMarkup(qs('partnersFilterPerson'),'<option value="">Todas las personas</option>');setStableMarkup(qs('partnersSheet'),'');
  if(qs('partnersTeamLoading'))qs('partnersTeamLoading').hidden=false;if(qs('partnersSplitTab'))qs('partnersSplitTab').hidden=true;if(qs('partnersSearch'))qs('partnersSearch').value='';if(qs('partnersFilterRole'))qs('partnersFilterRole').value='';setTab('team');message('');
}});
