import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { readPageQuery, watchPage, isStalePageSession, loadingRows, getPageSessionId } from './page-read-runtime.js?v=1';
import { setStableMarkup } from './dashboard-presentation.js?v=1';
import { qs, esc, money, roleName, dateLabel, isoDate, today, icon, empty, openPage } from './combined-workspace-ui.js?v=1';
import { actionLabels, tableLabels, technicalTables, actionName, tableName, changeDetails, groupActivity } from './activity-labels.js?v=1';
import { REPORTS, exportReport, collectRows, downloadCsv, validateRange } from './report-exports.js?v=1';

const db=createClient('https://eatxkhhpjruwwibhcubf.supabase.co','sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q',{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:'loan-ledger-auth'}});
const state={page:0,size:50,total:0,rows:[],sequence:0,searchTimer:null,tab:'history',exporting:false};

function periodRange(key){
  const now=new Date(),end=new Date(now.getFullYear(),now.getMonth()+1,0);let start=new Date(now.getFullYear(),now.getMonth(),1);
  if(key==='today')return {start:today(),end:today()};if(key==='7d'){start=new Date(now);start.setDate(start.getDate()-6);return {start:isoDate(start),end:today()};}
  if(key==='3m')start=new Date(now.getFullYear(),now.getMonth()-2,1);if(key==='all')return {start:'',end:''};return {start:isoDate(start),end:isoDate(end)};
}
function ensureShell(){
  let page=qs('activityPage');if(!page){page=document.createElement('div');page.id='activityPage';page.className='page';qs('app')?.append(page);}if(qs('activityWorkspace'))return;
  page.classList.add('ll-combined-page');page.dataset.combinedWorkspace='true';const range=periodRange('month');
  page.innerHTML=`<div id="activityWorkspace" data-no-translate="true"><header class="cw-header"><div><h1>Actividad y reportes</h1><p>Revisa los movimientos, consulta sus detalles y descarga tus reportes.</p></div><button class="cw-button" type="button" data-activity-refresh>Actualizar</button></header>
    <nav class="cw-tabs" role="tablist" aria-label="Actividad y reportes"><button id="activityHistoryTab" role="tab" aria-controls="activityHistoryPanel" aria-selected="true" data-activity-tab="history">Historial</button><button id="activityReportsTab" role="tab" aria-controls="activityReportsPanel" aria-selected="false" data-activity-tab="reports">Reportes</button></nav>
    <section class="cw-card cw-range"><label><span>Período</span><select id="activityFilterPeriod"><option value="today">Hoy</option><option value="7d">Últimos 7 días</option><option value="month" selected>Este mes</option><option value="3m">Últimos 3 meses</option><option value="all">Todo el historial</option><option value="custom">Personalizado</option></select></label><label><span>Desde</span><input id="activityFilterStart" type="date" value="${range.start}"></label><label><span>Hasta</span><input id="activityFilterEnd" type="date" value="${range.end}"></label><p id="activityRangeNote">El período se aplica al historial y a los reportes de movimientos.</p></section>
    <div id="activityMessage" class="cw-message" role="status" hidden></div>
    <section id="activityHistoryPanel" role="tabpanel" aria-labelledby="activityHistoryTab"><div class="cw-card"><div class="cw-card-head"><div><h2>Movimientos</h2><p id="activityCount">Cargando el historial…</p></div><button class="cw-button" type="button" data-export-activity>${icon('download')} Exportar historial</button></div>
      <div class="cw-controls cw-activity-filters"><label class="cw-search">${icon('search')}<input id="activitySearch" type="search" placeholder="Buscar persona, cliente o texto…" aria-label="Buscar en el historial"></label><label><span class="cw-sr">Tipo de acción</span><select id="activityFilterAction"><option value="">Todas las acciones</option>${Object.entries(actionLabels).map(([key,label])=>`<option value="${esc(key)}">${esc(label)}</option>`).join('')}</select></label><label><span class="cw-sr">Sección</span><select id="activityFilterTable"><option value="">Todas las secciones</option>${Object.entries(tableLabels).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label></div>
      <div class="cw-history-note"><label class="cw-check"><input type="checkbox" id="activityFilterTechnical"> Incluir registros de cuotas calculadas y aplicaciones automáticas</label></div><div id="activityList">${loadingRows(4)}</div><footer class="cw-pagination"><span id="activityPageInfo"></span><div><button class="cw-button" type="button" data-activity-prev disabled>Anterior</button><button class="cw-button" type="button" data-activity-next disabled>Siguiente</button></div></footer>
    </div></section>
    <section id="activityReportsPanel" role="tabpanel" aria-labelledby="activityReportsTab" hidden><div class="cw-report-intro"><h2>Reportes para descargar</h2><p>Los reportes de movimientos usan las fechas de arriba. Las cuentas y el resumen de socios muestran el estado actual.</p></div><div class="cw-report-grid">${REPORTS.map(r=>`<article class="cw-card cw-report-card"><span class="cw-round-icon purple">${icon(r.icon)}</span><h3>${r.title}</h3><p>${r.description}</p><small>${r.scope}</small><button type="button" class="cw-button" data-report="${r.key}">${icon('download')} Descargar CSV</button></article>`).join('')}</div></section>
  </div>`;
  page.addEventListener('click',handleClick);page.addEventListener('change',handleChange);page.addEventListener('input',event=>{if(event.target.id==='activitySearch'){state.page=0;state.sequence++;clearTimeout(state.searchTimer);state.searchTimer=setTimeout(()=>refresh(false),250);}});
  const side=qs('sideMenu');if(side&&!qs('menuActivity')){const button=document.createElement('button');button.id='menuActivity';button.className='menu-link';button.dataset.page='activityPage';button.textContent='Actividad y reportes';button.onclick=()=>openPage('activityPage');side.insertBefore(button,side.querySelector('[data-page="defaultsPage"]'));}
}
function message(text,error=false){const node=qs('activityMessage');node.hidden=!text;node.textContent=text;node.classList.toggle('is-error',error);}
function filters(){return {start:qs('activityFilterStart').value,end:qs('activityFilterEnd').value,action:qs('activityFilterAction').value,table:qs('activityFilterTable').value,search:qs('activitySearch').value.trim(),technical:qs('activityFilterTechnical').checked};}
function queryFor(f,count=false){
  let query=db.from('activity_log_view').select('*',count?{count:'exact'}:{}).order('created_at',{ascending:false}).order('id',{ascending:false});
  if(f.start)query=query.gte('created_at',new Date(f.start+'T00:00:00').toISOString());
  if(f.end){const end=new Date(f.end+'T00:00:00');end.setDate(end.getDate()+1);query=query.lt('created_at',end.toISOString());}
  if(f.action)query=query.eq('action_type',f.action);if(f.table)query=query.eq('entity_table',f.table);
  if(!f.technical)query=query.not('entity_table','in','('+technicalTables.join(',')+')');
  // Keep user text out of the PostgREST filter grammar while retaining words and names.
  const term=f.search.replace(/[^\p{L}\p{N}\s@+\-]/gu,' ').replace(/\s+/g,' ').trim();
  if(term)query=query.or(['actor_name','borrower_name','entity_text','summary'].map(field=>`${field}.ilike.%${term}%`).join(','));
  return query;
}
function readActivity(f,page=0,force=false){return readPageQuery('activity-workspace:'+JSON.stringify({...f,page}),()=>queryFor(f,true).range(page*state.size,(page+1)*state.size-1),{force,ttl:45000});}
function setTab(tab){state.tab=tab;qs('activityHistoryPanel').hidden=tab!=='history';qs('activityReportsPanel').hidden=tab!=='reports';qs('activityWorkspace').querySelectorAll('[role="tab"]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.activityTab===tab)));}
function eventTone(row){if(/VOID|DELET|REVERSE/.test(row.action_type))return 'coral';if(row.entity_table==='payments')return 'lime';if(row.entity_table==='profiles')return 'blue';return 'purple';}
function rowMarkup(row,children=[]){
  const amount=row.new_data?.amount??row.old_data?.amount??(row.entity_table==='loans'?row.new_data?.principal_original:null)??(row.entity_table==='payments'?row.payment_amount:null);
  const date=new Date(row.created_at),time=Number.isNaN(date.getTime())?'—':date.toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'});
  const detail=changeDetails(row),notes=String(row.summary||'');
  const summary=notes&&!/changed$|BORROWER_DUE_EVENTS|MANAGEMENT_FEE|PARTNER_DISTRIBUTION|FUNDER_FEE|FUNDING_FEE|allocation_type/.test(notes)&&!technicalTables.includes(row.entity_table)?`<p class="cw-event-summary">${esc(notes)}</p>`:'';
  return `<article class="cw-event"><time datetime="${esc(row.created_at)}">${time}</time><span class="cw-round-icon ${eventTone(row)}">${icon(row.entity_table==='payments'?'dollar':row.entity_table==='profiles'?'users':technicalTables.includes(row.entity_table)?'calendar':'chart')}</span><div class="cw-event-copy"><div class="cw-event-top"><h3>${actionName(row.action_type)}</h3><span class="cw-tag">${tableName(row.entity_table)}</span></div><p class="cw-event-actor">${esc(row.actor_name||'Sistema')}${row.actor_role?' · '+roleName(row.actor_role):''}</p>${row.borrower_name?`<button class="cw-link" type="button" data-activity-client="${esc(row.borrower_id||'')}">${esc(row.borrower_name)}</button>`:''}${summary}${detail||children.length?`<details class="cw-event-details"><summary>Ver detalles${children.length?' · '+children.length+' registros relacionados':''}</summary><div>${detail}${row.payment_id&&row.entity_table!=='payments'?`<p class="cw-help">Pago vinculado: ${money(row.payment_amount)} · ${dateLabel(row.payment_paid_on)}</p>`:''}${children.map(child=>`<section class="cw-related-event"><h4>${actionName(child.action_type)}</h4><p>${tableName(child.entity_table)}</p>${changeDetails(child)}</section>`).join('')}</div></details>`:''}</div>${amount!=null?`<strong class="cw-event-amount">${money(amount)}</strong>`:'<span></span>'}</article>`;
}
function renderActivity(){
  const groups=groupActivity(state.rows);let previous='',html='';
  groups.forEach(({row,children})=>{const key=dateLabel(row.created_at);if(previous!==key){html+=`<h3 class="cw-day-heading">${key}</h3>`;previous=key;}html+=rowMarkup(row,children);});
  setStableMarkup(qs('activityList'),html||empty('No hay movimientos con estos filtros.'));
  qs('activityCount').textContent=`${state.total} registros encontrados · Los movimientos relacionados se agrupan.`;
  const from=state.total?state.page*state.size+1:0,to=Math.min(state.total,(state.page+1)*state.size);
  qs('activityPageInfo').textContent=`${from}–${to} de ${state.total} registros`;
  qs('activityWorkspace').querySelector('[data-activity-prev]').disabled=state.page===0;
  qs('activityWorkspace').querySelector('[data-activity-next]').disabled=to>=state.total;
}
async function refresh(force=false){
  ensureShell();if(!qs('activityPage').classList.contains('active-page'))return;const sequence=++state.sequence,f=filters(),page=state.page;
  try{validateRange(f);const result=await readActivity(f,page,force);if(sequence!==state.sequence)return;if(result.error)throw result.error;state.rows=result.data||[];state.total=result.count??state.rows.length;renderActivity();}
  catch(e){if(!isStalePageSession(e)&&sequence===state.sequence)message(e.message||String(e),true);}
}
function handleChange(event){
  const target=event.target;if(!target.id.startsWith('activityFilter'))return;
  if(target.id==='activityFilterPeriod'&&target.value!=='custom'){const range=periodRange(target.value);qs('activityFilterStart').value=range.start;qs('activityFilterEnd').value=range.end;}
  if(['activityFilterStart','activityFilterEnd'].includes(target.id))qs('activityFilterPeriod').value='custom';
  if(target.id==='activityFilterTable'&&technicalTables.includes(target.value))qs('activityFilterTechnical').checked=true;
  state.page=0;message('');refresh(false);
}
async function exportHistory(f){
  const rows=await collectRows(()=>queryFor(f));downloadCsv('historial',rows.map(row=>({registrado:row.created_at,persona:row.actor_name,rol:roleName(row.actor_role),accion:actionName(row.action_type),seccion:tableName(row.entity_table),cliente:row.borrower_name,monto:row.new_data?.amount??row.payment_amount,fecha_pago:row.payment_paid_on,resumen:row.summary,antes:row.old_data,despues:row.new_data,referencia:row.id})));return rows.length;
}
async function handleClick(event){
  const target=event.target,tab=target.closest('[data-activity-tab]');if(tab){setTab(tab.dataset.activityTab);return;}
  const client=target.closest('[data-activity-client]');if(client?.dataset.activityClient){window.dispatchEvent(new CustomEvent('loan-ledger:open-account',{detail:{borrowerId:client.dataset.activityClient}}));return;}
  if(target.closest('[data-activity-refresh]')){refresh(true);return;}if(target.closest('[data-activity-prev]')){state.page=Math.max(0,state.page-1);refresh(false);return;}if(target.closest('[data-activity-next]')){state.page++;refresh(false);return;}
  const report=target.closest('[data-report]'),history=target.closest('[data-export-activity]');if(!report&&!history||state.exporting)return;
  const f=filters(),owner=getPageSessionId(),button=report||history;state.exporting=true;button.disabled=true;message('Preparando la descarga…');
  try{validateRange(f);const count=history?await exportHistory(f):await exportReport(report.dataset.report,f);if(owner===getPageSessionId())message(`Descarga preparada: ${count} registros.`);}
  catch(e){if(!isStalePageSession(e)&&owner===getPageSessionId())message(e.message||String(e),true);}
  finally{state.exporting=false;button.disabled=false;}
}
ensureShell();
watchPage('activityPage',()=>refresh(false),{interval:45000,prefetch:()=>readActivity(filters(),state.page),reset:()=>{state.sequence++;state.rows=[];state.total=0;state.page=0;state.exporting=false;setStableMarkup(qs('activityList'),loadingRows(4));qs('activityCount').textContent='Cargando el historial…';qs('activityPageInfo').textContent='';message('');}});
