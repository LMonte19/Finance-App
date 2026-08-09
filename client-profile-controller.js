import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db=createClient(
  'https://eatxkhhpjruwwibhcubf.supabase.co',
  'sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q',
  {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:'loan-ledger-auth'}}
);

const STYLE_FILES=[
  ['clientProfileRefinementsCss','./client-profile-refinements.css?v=2'],
  ['clientProfileCohesionCss','./client-profile-cohesion.css?v=1'],
  ['clientProfileCohesionFinalCss','./client-profile-cohesion-final.css?v=4'],
  ['clientProfileElegantCss','./client-profile-elegant.css?v=2'],
  ['clientProfileElegantIconsCss','./client-profile-elegant-icons.css?v=2'],
  ['clientProfileElegantFixCss','./client-profile-elegant-fix.css?v=1'],
  ['clientProfileReferenceMatchCss','./client-profile-reference-match.css?v=3'],
  ['clientProfileRailExactCss','./client-profile-rail-exact.css?v=1'],
  ['clientProfileFixedShellCss','./client-profile-fixed-shell.css?v=1'],
  ['uiFinalPolishCss','./ui-final-polish.css?v=3'],
  ['clientProfileControllerCss','./client-profile-controller.css?v=1']
];
STYLE_FILES.forEach(([id,href])=>{
  let link=document.getElementById(id);
  if(!link){link=document.createElement('link');link.id=id;link.rel='stylesheet';document.head.appendChild(link);}
  link.href=href;
});

const CLIENT_RAIL_STORAGE='loanLedger.clientRailCollapsed';
const money=value=>`$${Math.round(Number(value||0)).toLocaleString('en-US')}`;
const today=()=>new Date().toISOString().slice(0,10);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const initials=name=>String(name||'?').trim().split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]?.toUpperCase()||'').join('')||'?';

let mounted=false;
let currentBorrowerId=null;
let currentData=null;
let accounts=[];
let requestSequence=0;
let activeTab='summary';
let calendarOffset=0;
let selectedDueIso=null;
let movementFilter='todos';

function fmtDate(iso,options={day:'2-digit',month:'short',year:'numeric'}){
  if(!iso)return '—';
  try{return new Date(`${iso}T00:00:00`).toLocaleDateString('es',options).replace('.','');}catch{return iso;}
}
function parseIso(iso){const [y,m,d]=String(iso).split('-').map(Number);return new Date(y,m-1,d);}
function toIso(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function addMonths(date,months){return new Date(date.getFullYear(),date.getMonth()+months,1);}
function lastDay(year,monthIndex){return new Date(year,monthIndex+1,0).getDate();}
function cycleDatesAround(base=new Date(),before=12,after=18){
  const dates=[];
  for(let cursor=addMonths(base,-before);cursor<=addMonths(base,after);cursor=addMonths(cursor,1)){
    dates.push(new Date(cursor.getFullYear(),cursor.getMonth(),15));
    dates.push(new Date(cursor.getFullYear(),cursor.getMonth(),lastDay(cursor.getFullYear(),cursor.getMonth())));
  }
  return dates.sort((a,b)=>a-b);
}
function nextCycleIso(from=new Date()){
  const start=parseIso(toIso(from));
  return toIso(cycleDatesAround(from,1,3).find(date=>date>=start)||start);
}
function daysFromToday(iso){if(!iso)return null;return Math.round((parseIso(iso)-parseIso(today()))/86400000);}
function dueTiming(iso){
  const days=daysFromToday(iso);
  if(days===null||Number.isNaN(days))return 'Sin fecha';
  if(days<0)return `Hace ${Math.abs(days)} días`;
  if(days===0)return 'Hoy';
  if(days===1)return 'Mañana';
  return `En ${days} días`;
}
function statusLabel(value){
  const key=String(value||'').toUpperCase();
  return {ACTIVE:'ACTIVO',CURRENT:'AL DÍA',OVERDUE:'ATRASADO',ATRASADO:'ATRASADO',PAID:'PAGADA',PARTIAL:'PARCIAL',OPEN:'ABIERTO',DONE:'COMPLETADO',UPCOMING:'PRÓXIMA',DUE:'PENDIENTE',DUE_TODAY:'VENCE HOY',CANCELLED:'CANCELADA',CLOSED:'CERRADO',PAID_OFF:'SALDADO',VOIDED:'ANULADO'}[key]||value||'—';
}
function tone(value){
  const key=String(value||'').toUpperCase();
  if(['OVERDUE','ATRASADO','DANGER','URGENT'].includes(key))return 'danger';
  if(['DUE','PARTIAL','PENDING','PENDIENTE','HIGH','DUE_TODAY','UPCOMING'].includes(key))return 'pending';
  if(['CLOSED','PAID_OFF','CANCELLED','VOIDED'].includes(key))return 'closed';
  return 'ok';
}
function dueStatus(row){
  if(row?.status==='PAID'||row?.timing_status==='PAID')return 'PAID';
  if(row?.status==='PARTIAL')return 'PARTIAL';
  if(row?.timing_status==='OVERDUE')return 'OVERDUE';
  if(row?.timing_status==='DUE_TODAY')return 'DUE_TODAY';
  if(row?.status==='CANCELLED'||row?.timing_status==='CANCELLED')return 'CANCELLED';
  return row?.status||row?.timing_status||'UPCOMING';
}
function paymentTypeLabel(type){return {INSTALLMENT:'Cuota/interés',PRINCIPAL:'Abono a capital',MIXED:'Mixto',PAYOFF:'Saldar capital'}[type]||type||'—';}
function avatarTone(name){return [...String(name||'')].reduce((sum,ch)=>sum+ch.charCodeAt(0),0)%4;}

const ICONS={
  dollar:'<circle cx="12" cy="12" r="8.2"/><path d="M15.2 8.2c-.8-.8-1.8-1.2-3.2-1.2-1.9 0-3.1.8-3.1 2.1 0 3.1 6.2 1.2 6.2 4.4 0 1.4-1.3 2.4-3.4 2.4-1.7 0-3-.5-3.8-1.5M12 5v14"/>',
  trend:'<path d="M5 16.5 10.2 11.3l3.1 3.1L19 8.7"/><path d="M14.7 8.7H19V13"/>',
  clock:'<circle cx="12" cy="12" r="8.2"/><path d="M12 7.5V12l3.2 1.8"/>',
  cycle:'<path d="M18.2 8.2A7 7 0 0 0 6.3 6.5L4.5 8.8"/><path d="M4.5 5v3.8h3.8"/><path d="M5.8 15.8A7 7 0 0 0 17.7 17.5l1.8-2.3"/><path d="M19.5 19v-3.8h-3.8"/>',
  calendar:'<rect x="4.5" y="5.5" width="15" height="14" rx="2.3"/><path d="M8 3.8v3.5M16 3.8v3.5M4.5 9.5h15"/><path d="M8 13h.01M12 13h.01M16 13h.01M8 16.5h.01M12 16.5h.01"/>',
  payment:'<path d="M12 4v15M7 14l5 5 5-5"/>',
  disbursement:'<path d="M6 18 18 6M10 6h8v8"/>',
  note:'<path d="M6 4h9l3 3v13H6z"/><path d="M15 4v4h4M9 12h6M9 16h5"/>',
  check:'<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12 2.3 2.4 4.8-5"/>',
  chevronRight:'<path d="m9 6 6 6-6 6"/>',
  chevronLeft:'<path d="m14.5 6-6 6 6 6"/>',
  chevronDown:'<path d="m6 9 6 6 6-6"/>',
  more:'<circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  person:'<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20c.6-4.4 2.8-6.6 6.5-6.6s5.9 2.2 6.5 6.6"/>'
};
function svg(name,cls='ll-ref-svg',size=16){return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]||ICONS.check}</svg>`;}

function ensureAccountPage(){
  const app=document.getElementById('app');
  if(!app)return null;
  let page=document.getElementById('borrowerAccountPage');
  if(!page){page=document.createElement('div');page.id='borrowerAccountPage';page.className='page';page.innerHTML='<div id="borrowerAccountContent"></div>';app.appendChild(page);}
  return page;
}
function showAccountPage(){
  const page=ensureAccountPage();
  document.querySelectorAll('.tab-btn').forEach(btn=>btn.classList.remove('active'));
  document.querySelectorAll('.page').forEach(node=>node.classList.remove('active-page'));
  page?.classList.add('active-page');
  document.body.classList.add('ll-client-detail-fixed');
  document.getElementById('sideMenu')?.classList.remove('open');
  document.getElementById('menuOverlay')?.classList.remove('open');
}
function syncFixedMode(){
  const page=document.getElementById('borrowerAccountPage');
  document.body.classList.toggle('ll-client-detail-fixed',!!page?.classList.contains('active-page')&&mounted);
}

async function currentUserId(){
  const {data,error}=await db.auth.getUser();
  if(error)throw error;
  if(!data.user?.id)throw new Error('No se encontró una sesión activa.');
  return data.user.id;
}

async function loadProfileData(borrowerId,{includeAccounts=false}={}){
  const range=cycleDatesAround(new Date(),12,18);
  const startIso=toIso(range[0]);
  const endIso=toIso(range[range.length-1]);
  const jobs=[
    db.from('borrower_account_summary').select('*').eq('borrower_id',borrowerId).single(),
    db.rpc('get_borrower_due_calendar',{p_borrower_id:borrowerId,p_start_date:startIso,p_end_date:endIso}),
    db.from('borrower_disbursements_view').select('*').eq('borrower_id',borrowerId).order('start_date',{ascending:false}),
    db.from('borrower_account_payments_view').select('*').eq('borrower_id',borrowerId).order('paid_on',{ascending:false}).order('created_at',{ascending:false}).limit(120),
    db.from('borrower_contact_log_view').select('*').eq('borrower_id',borrowerId).order('created_at',{ascending:false}).limit(80),
    db.from('borrower_followups_view').select('*').eq('borrower_id',borrowerId).order('due_date',{ascending:true}).limit(80),
    db.from('app_settings').select('setting_key,setting_value').in('setting_key',['loan_defaults','default_funding_split']),
    db.from('loan_funding').select('loan_id,partner_user_id,funding_percent'),
    db.from('profiles').select('user_id,full_name,role')
  ];
  if(includeAccounts)jobs.push(db.from('borrower_account_summary').select('*').order('full_name',{ascending:true}));
  const results=await Promise.all(jobs);
  for(const result of results)if(result.error)throw result.error;
  const [summaryRes,calendarRes,disbRes,payRes,contactRes,followRes,settingsRes,fundingRes,profilesRes,accountsRes]=results;
  const settings=Object.fromEntries((settingsRes.data||[]).map(row=>[row.setting_key,row.setting_value]));
  const profileNames=new Map((profilesRes.data||[]).map(row=>[row.user_id,row.full_name||row.role||'Socio']));
  const loanIds=new Set((disbRes.data||[]).map(row=>row.id));
  const fundingByLoan=new Map();
  (fundingRes.data||[]).filter(row=>loanIds.has(row.loan_id)).forEach(row=>{
    if(!fundingByLoan.has(row.loan_id))fundingByLoan.set(row.loan_id,[]);
    fundingByLoan.get(row.loan_id).push({...row,partner_name:profileNames.get(row.partner_user_id)||'Socio'});
  });
  return {
    summary:summaryRes.data,
    calendarRows:calendarRes.data||[],
    disbursements:(disbRes.data||[]).map(row=>({...row,funding:fundingByLoan.get(row.id)||[]})),
    payments:payRes.data||[],
    contacts:contactRes.data||[],
    followups:followRes.data||[],
    defaults:settings.loan_defaults||{default_total_monthly_rate:10,default_management_rate:3},
    defaultFunding:Array.isArray(settings.default_funding_split)?settings.default_funding_split:[],
    accounts:accountsRes?.data||null
  };
}

function calendarMap(data){return new Map((data.calendarRows||[]).map(row=>[row.due_date,row]));}
function selectedCalendarRow(data,iso){
  const row=calendarMap(data).get(iso);
  if(row)return row;
  return {due_date:iso,expected_total:Number(data.summary.current_cycle_fee||0),paid_total:0,amount_due:Number(data.summary.current_cycle_fee||0),principal_snapshot:Number(data.summary.principal_balance||0),timing_status:daysFromToday(iso)<0?'OVERDUE':daysFromToday(iso)===0?'DUE_TODAY':'UPCOMING',status:'DUE',is_virtual:true};
}
function nextDueRow(data){
  const rows=[...(data.calendarRows||[])].filter(row=>Number(row.amount_due||0)>0&&!['PAID','CANCELLED'].includes(dueStatus(row))).sort((a,b)=>String(a.due_date).localeCompare(String(b.due_date)));
  return rows.find(row=>daysFromToday(row.due_date)>=0)||rows[0]||(Number(data.summary.principal_balance||0)>0?selectedCalendarRow(data,nextCycleIso()):null);
}
function visibleCycleDates(){
  const all=cycleDatesAround(new Date(),12,18);
  const baseIso=selectedDueIso||nextCycleIso();
  let baseIndex=all.findIndex(date=>toIso(date)===baseIso);
  if(baseIndex<0)baseIndex=all.findIndex(date=>date>=new Date());
  let start=Math.max(0,baseIndex-1+calendarOffset);
  start=Math.min(start,Math.max(0,all.length-6));
  return all.slice(start,start+6);
}
function monthRangeTitle(dates){
  const f=new Intl.DateTimeFormat('es',{month:'long',year:'numeric'});
  const first=f.format(dates[0]);
  const last=f.format(dates[dates.length-1]);
  return first===last?first:`${first} – ${last}`;
}

function metricCell(icon,label,value,sub,slot,subSlot=''){
  return `<div><span class="ll-elegant-metric-icon">${svg(icon,'ll-ref-svg',14)}</span><span>${label}</span><strong class="ll-dynamic-value" data-slot="${slot}">${esc(value)}</strong><small class="${subSlot?'ll-dynamic-value':''}" ${subSlot?`data-slot="${subSlot}"`:''}>${esc(sub)}</small></div>`;
}
function dataCard(title,body,extraClass='',headExtra=''){
  return `<section class="ll-card ll-profile-card ${extraClass}"><div class="ll-card-head"><div class="ll-card-title">${title}</div>${headExtra}</div>${body}</section>`;
}
function emptyState(text){return `<div class="ll-empty-state">${esc(text)}</div>`;}

function clientRailHtml(selectedId){
  return `<aside class="ll-client-rail" data-no-translate="true">
    <div class="ll-rail-top"><div class="ll-rail-title">Clientes</div><button class="ll-icon-btn ll-controller-search" type="button" aria-label="Buscar clientes">${svg('search','ll-ref-svg',15)}</button></div>
    <div class="ll-filter-row"><span>Todos los clientes</span><span class="ll-filter-control" aria-hidden="true">${svg('chevronDown','ll-ref-svg',12)}</span></div>
    <div class="ll-collapsed-client-marker">${svg('person','ll-ref-svg',15)}</div>
    <div class="ll-client-search-wrap" hidden><input class="ll-client-search-input" type="search" placeholder="Buscar cliente" aria-label="Buscar cliente"></div>
    <div class="ll-client-list">${accounts.map(a=>clientRowHtml(a,selectedId)).join('')}</div>
    <button id="acctBack" type="button" class="ll-soft-btn ll-rail-back" data-reference-match="1"><span class="ll-collapse-icon">${svg('chevronLeft','ll-ref-svg',14)}</span><span>Colapsar</span></button>
  </aside>`;
}
function clientRowHtml(a,selectedId){
  const active=String(a.borrower_id)===String(selectedId);
  const name=a.full_name||'Sin nombre';
  return `<div class="ll-client-card ll-elegant-client-row ${active?'active':''}" data-acct-borrower="${esc(a.borrower_id)}" data-client-search="${esc(name.toLowerCase())}">
    ${active?'<span class="ll-active-rail-indicator" aria-hidden="true"></span>':''}
    <div class="ll-client-avatar ll-initial-avatar tone-${avatarTone(name)}"><span class="ll-client-initials">${esc(initials(name))}</span></div>
    <div class="ll-client-copy"><div class="ll-client-name">${esc(name)}</div><div class="ll-client-balance">${money(a.principal_balance)}</div></div>
    <span class="ll-rail-badge ll-elegant-status ${tone(a.account_status)}"><i></i><span class="ll-dynamic-value" data-rail-status>${esc(statusLabel(a.account_status))}</span></span>
  </div>`;
}

function calendarHtml(context,data){
  const dates=visibleCycleDates();
  if(!selectedDueIso||!dates.some(date=>toIso(date)===selectedDueIso))selectedDueIso=toIso(dates.find(date=>date>=parseIso(today()))||dates[1]||dates[0]);
  const selected=selectedCalendarRow(data,selectedDueIso);
  const selectedStatus=dueStatus(selected);
  return `<div class="ll-cycle-calendar" data-calendar-context="${context}">
    <div class="ll-cycle-calendar-head"><div><strong>Cuotas pendientes</strong><small>Cuotas automáticas: día 15 y último día del mes</small></div><div class="ll-cycle-calendar-nav"><button type="button" data-calendar-move="-2" aria-label="Fechas anteriores">${svg('chevronLeft','ll-ref-svg',13)}</button><span>${esc(monthRangeTitle(dates))}</span><button type="button" data-calendar-move="2" aria-label="Fechas siguientes">${svg('chevronRight','ll-ref-svg',13)}</button></div></div>
    <div class="ll-cycle-date-row">${calendarDateButtonsHtml(dates,data)}</div>
    <div class="ll-cycle-detail ll-cycle-detail--compact">
      <div><small>Monto esperado</small><strong class="ll-dynamic-value" data-calendar-slot="expected">${money(selected.expected_total)}</strong></div>
      <div><small>Pagado</small><strong class="ll-dynamic-value" data-calendar-slot="paid">${money(selected.paid_total)}</strong></div>
      <div><small>Pendiente</small><strong class="ll-dynamic-value" data-calendar-slot="pending">${money(selected.amount_due)}</strong></div>
      <div><small>Estado</small><span class="ll-status-pill ${tone(selectedStatus)} ll-dynamic-value" data-calendar-slot="status">${statusLabel(selectedStatus)}</span></div>
      <div><small>Días restantes</small><strong class="ll-dynamic-value" data-calendar-slot="timing">${dueTiming(selectedDueIso)}</strong></div>
    </div>
  </div>`;
}
function calendarDateButtonsHtml(dates,data){
  return dates.map(date=>{
    const iso=toIso(date),row=selectedCalendarRow(data,iso),status=dueStatus(row);
    return `<button type="button" class="ll-cycle-date ${iso===selectedDueIso?'selected':''} ${tone(status)}" data-calendar-date="${iso}"><span>${date.toLocaleDateString('es',{weekday:'short'}).replace('.','')}</span><strong>${date.getDate()}</strong><small>${date.toLocaleDateString('es',{month:'short'}).replace('.','').toUpperCase()}</small></button>`;
  }).join('');
}

function movementEvents(data){
  return [
    ...data.payments.slice(0,5).map(row=>({date:row.paid_on,tab:'payments',title:`Pago recibido por ${money(row.amount)}`,detail:paymentTypeLabel(row.payment_type),kind:'payment',filter:'pagos'})),
    ...data.disbursements.slice(0,5).map(row=>({date:row.start_date,tab:'disbursements',title:`Capital agregado: ${money(row.principal_original)}`,detail:`Balance actual ${money(row.principal_outstanding)}`,kind:'disbursement',filter:'desembolsos'})),
    ...data.contacts.slice(0,5).map(row=>({date:row.contact_date,tab:'followups',title:row.outcome||'Contacto registrado',detail:row.notes||row.contact_type||'',kind:'note',filter:'notas'})),
    ...data.followups.slice(0,5).map(row=>({date:row.due_date,tab:'followups',title:row.reason||'Seguimiento',detail:statusLabel(row.status==='DONE'?'DONE':row.timing_status),kind:'note',filter:'notas'}))
  ].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,5);
}
function movementsHtml(data){
  const events=movementEvents(data);
  if(!events.length)return emptyState('Todavía no hay actividad en esta cuenta.');
  return `<div class="ll-activity-list ll-dynamic-list" data-list="movements">${events.map(event=>`<button type="button" data-open-tab="${event.tab}" data-movement-filter="${event.filter}" ${movementFilter!=='todos'&&movementFilter!==event.filter?'hidden':''}><span class="ll-activity-dot ll-movement-icon-${event.kind}">${svg(event.kind==='payment'?'payment':event.kind==='disbursement'?'disbursement':'note','ll-elegant-svg',16)}</span><span><strong>${esc(event.title)}</strong><small>${fmtDate(event.date)}</small>${event.detail?`<p>${esc(event.detail)}</p>`:''}</span><b>${svg('chevronRight','ll-elegant-svg',16)}</b></button>`).join('')}</div>`;
}
function movementFilterHtml(){return `<div class="ll-movement-filters">${[['todos','Todos'],['pagos','Pagos'],['desembolsos','Desembolsos'],['notas','Notas']].map(([key,label])=>`<button type="button" class="ll-movement-filter ${movementFilter===key?'active':''}" data-filter="${key}">${label}</button>`).join('')}</div>`;}

function paymentRowsHtml(rows){
  if(!rows.length)return emptyState('No hay pagos registrados para este cliente.');
  return `<div class="ll-record-list ll-dynamic-list" data-list="payments">${rows.map(p=>`<article class="ll-record-row"><div class="ll-record-date"><strong>${fmtDate(p.paid_on,{day:'2-digit',month:'short'})}</strong><small>${fmtDate(p.paid_on,{year:'numeric'})}</small></div><div class="ll-record-main"><div class="ll-record-title">${money(p.amount)} <span class="ll-mini-pill ${p.is_voided?'ll-record-danger':''}">${p.is_voided?'ANULADO':paymentTypeLabel(p.payment_type)}</span></div><div class="ll-record-meta">Cuota/interés: ${money(p.applied_interest)} · Capital: ${money(p.applied_principal)} · Administración: ${money(p.applied_mgmt)} · Socios: ${money(p.applied_funders)}</div>${p.notes?`<div class="ll-record-note">${esc(p.notes)}</div>`:''}${p.void_reason?`<div class="ll-record-note">Motivo de anulación: ${esc(p.void_reason)}</div>`:''}</div>${p.is_voided?'':`<button type="button" class="ll-inline-action ll-danger-action" data-void-payment="${esc(p.id)}">Anular</button>`}</article>`).join('')}</div>`;
}
function disbursementRowsHtml(rows){
  if(!rows.length)return emptyState('No hay desembolsos registrados para este cliente.');
  return `<div class="ll-record-list ll-dynamic-list" data-list="disbursements">${rows.map(row=>{const funding=row.funding?.length?row.funding.map(item=>`${esc(item.partner_name)} ${Math.round(Number(item.funding_percent||0)*100)}%`).join(' · '):'Sin distribución visible';return `<article class="ll-record-row ll-disbursement-record"><div class="ll-record-date"><strong>${fmtDate(row.start_date,{day:'2-digit',month:'short'})}</strong><small>${fmtDate(row.start_date,{year:'numeric'})}</small></div><div class="ll-record-main"><div class="ll-record-title">${money(row.principal_original)} <span class="ll-status-pill ${tone(row.status)}">${statusLabel(row.status)}</span></div><div class="ll-record-meta">Balance pendiente: ${money(row.principal_outstanding)} · Interés mensual: ${(Number(row.monthly_rate_total||0)*100).toFixed(2)}% · Administración: ${(Number(row.monthly_rate_mgmt||0)*100).toFixed(2)}%</div><div class="ll-record-note">Distribución: ${funding}</div>${row.notes?`<div class="ll-record-note">${esc(row.notes)}</div>`:''}</div></article>`;}).join('')}</div>`;
}
function followupRowsHtml(rows){
  if(!rows.length)return emptyState('No hay seguimientos para este cliente.');
  return `<div class="ll-record-list ll-dynamic-list" data-list="followups">${rows.map(row=>`<article class="ll-record-row"><div class="ll-record-date"><strong>${fmtDate(row.due_date,{day:'2-digit',month:'short'})}</strong><small>${dueTiming(row.due_date)}</small></div><div class="ll-record-main"><div class="ll-record-title">${esc(row.reason||'Seguimiento')} <span class="ll-status-pill ${tone(row.timing_status||row.status)}">${statusLabel(row.status==='DONE'?'DONE':row.timing_status)}</span></div><div class="ll-record-meta">Prioridad: ${esc(row.priority||'NORMAL')}${row.loan_start_date?` · Desembolso: ${fmtDate(row.loan_start_date)}`:''}</div>${row.completed_notes?`<div class="ll-record-note">${esc(row.completed_notes)}</div>`:''}</div>${row.status==='DONE'?'':`<button type="button" class="ll-inline-action" data-complete-followup="${esc(row.id)}">Completar</button>`}</article>`).join('')}</div>`;
}
function contactRowsHtml(rows){
  if(!rows.length)return emptyState('No hay notas o contactos registrados para este cliente.');
  return `<div class="ll-record-list ll-dynamic-list" data-list="contacts">${rows.map(row=>`<article class="ll-record-row"><div class="ll-record-date"><strong>${fmtDate(row.contact_date,{day:'2-digit',month:'short'})}</strong><small>${esc(row.contact_type||'NOTA')}</small></div><div class="ll-record-main"><div class="ll-record-title">${esc(row.outcome||'Contacto registrado')}</div><div class="ll-record-note">${esc(row.notes||'')}</div><div class="ll-record-meta">Registrado por: ${esc(row.created_by_name||'Usuario')}</div></div></article>`).join('')}</div>`;
}
function loanOptionsHtml(rows){return `<option value="">Cuenta general</option>${rows.map(row=>`<option value="${esc(row.id)}">${fmtDate(row.start_date)} · ${money(row.principal_outstanding)} · ${statusLabel(row.status)}</option>`).join('')}`;}
function fundingRowsHtml(data){
  if(!data.defaultFunding.length)return emptyState('No hay distribución predeterminada. Configúrala antes de crear un desembolso.');
  return data.defaultFunding.map((row,index)=>`<label class="ll-funding-row"><span>${esc(row.partner_name||'Socio')}</span><input type="number" min="0" max="100" step="0.01" value="${(Number(row.funding_percent||0)*100).toFixed(2)}" data-funding-index="${index}" data-partner-user-id="${esc(row.partner_user_id)}"></label>`).join('');
}

function nextActionBodyHtml(data){
  const row=data.followups.find(item=>item.status!=='DONE');
  if(!row)return `<div class="ll-next-action"><span class="ll-status-pill closed">SIN PENDIENTES</span><strong>Sin seguimientos pendientes</strong><p>La cuenta no tiene acciones abiertas.</p><button type="button" class="ll-soft-btn" data-open-tab="followups">Crear seguimiento</button></div>`;
  return `<div class="ll-next-action"><span class="ll-status-pill ${tone(row.timing_status)}">${statusLabel(row.timing_status)}</span><strong>${esc(row.reason)}</strong><p>${fmtDate(row.due_date)} · ${dueTiming(row.due_date)}</p><button type="button" class="ll-purple-btn" data-complete-followup="${esc(row.id)}">Marcar como completada</button></div>`;
}

function profileShellHtml(data,selectedId){
  const a=data.summary,next=nextDueRow(data),suggested=Number(a.current_cycle_fee||a.current_monthly_fee||0);
  const totalRate=Number(data.defaults.default_total_monthly_rate??10),mgmtRate=Number(data.defaults.default_management_rate??3);
  return `<div class="ll-account-shell ll-client-rail-collapsed ll-tabs-ready ll-elegant-profile ll-reference-match" data-active-borrower="${esc(selectedId)}">
    ${clientRailHtml(selectedId)}
    <main class="ll-workspace" data-no-translate="true">
      <div class="ll-controller-loading-badge" aria-live="polite"><span class="ll-controller-loading-dot"></span><strong>Cargando...</strong></div>
      <section class="ll-client-header">
        <div class="ll-avatar-xl ll-dynamic-value" data-slot="header-avatar">${esc(initials(a.full_name))}</div>
        <div class="ll-client-header-copy"><div class="ll-title-row"><div class="ll-client-title ll-dynamic-value" data-slot="header-name">${esc(a.full_name||'Cuenta del cliente')}</div><span class="ll-status-pill ${tone(a.account_status)} ll-dynamic-value" data-slot="header-status">${esc(statusLabel(a.account_status))}</span></div><div class="ll-client-meta"><span>Teléfono: <b class="ll-dynamic-value" data-slot="header-phone">${esc(a.phone||'Sin teléfono')}</b></span><span>Próxima cuota: <b class="ll-dynamic-value" data-slot="header-next-due">${esc(fmtDate(next?.due_date||a.next_due_date))}</b></span><span>Atrasado: <b class="ll-dynamic-value" data-slot="header-overdue">${money(a.overdue_amount)}</b></span></div></div>
        <div class="ll-action-row" data-elegant-ready="1"><button class="ll-soft-btn ll-elegant-pay" type="button" id="llFocusPay">Registrar pago</button><button class="ll-primary-btn" type="button" data-top-action="disbursement">Nuevo desembolso</button><details class="ll-more-actions"><summary aria-label="Más acciones">${svg('more','ll-ref-svg',16)}</summary><div class="ll-more-menu"><button class="ll-soft-btn" type="button" data-top-action="note">Agregar nota</button><button class="ll-soft-btn" type="button" data-top-action="whatsapp">WhatsApp</button></div></details></div>
      </section>
      <nav class="ll-tabs" role="tablist"><div class="ll-tab active" role="tab" tabindex="0" data-profile-tab="summary">Resumen</div><div class="ll-tab" role="tab" tabindex="0" data-profile-tab="payments">Pagos</div><div class="ll-tab" role="tab" tabindex="0" data-profile-tab="disbursements">Desembolsos</div><div class="ll-tab" role="tab" tabindex="0" data-profile-tab="followups">Seguimientos</div></nav>
      <div class="ll-profile-tabs-host" data-refinement-version="3">
        <section class="ll-profile-panel active" data-profile-panel="summary"><div class="ll-panel-grid"><div class="ll-panel-main">
          ${dataCard('Resumen financiero',`<div class="ll-summary-stat-grid">${metricCell('dollar','Balance de capital',money(a.principal_balance),statusLabel(a.account_status),'principal','principal-status')}${metricCell('trend','Total desembolsado',money(a.total_disbursed),`${a.disbursement_count||0} desembolsos`,'total-disbursed','disbursement-count')}${metricCell('clock','Cuota mensual',money(a.current_monthly_fee),'Actual','monthly-fee')}${metricCell('cycle','Cuota por ciclo',money(a.current_cycle_fee),'15 y fin de mes','cycle-fee')}${metricCell('calendar','Próxima cuota',fmtDate(next?.due_date),'Sin fecha'===dueTiming(next?.due_date)?'Sin fecha':dueTiming(next?.due_date),'next-due','next-due-timing')}</div>`)}
          ${dataCard('Calendario de pagos',calendarHtml('summary',data))}
          ${dataCard('Movimientos',`<div class="ll-list-host" data-list-host="movements">${movementsHtml(data)}</div>`,'ll-movements-card',movementFilterHtml())}
        </div><aside class="ll-panel-side">
          ${dataCard('Estado de la cuenta',`<div class="ll-account-facts"><div><span>Estado</span><strong class="ll-dynamic-value" data-slot="account-status">${statusLabel(a.account_status)}</strong></div><div><span>Atrasado</span><strong class="ll-dynamic-value" data-slot="account-overdue">${money(a.overdue_amount)}</strong></div><div><span>Cuotas atrasadas</span><strong class="ll-dynamic-value" data-slot="account-overdue-count">${a.overdue_count||0}</strong></div><div><span>Días tarde</span><strong class="ll-dynamic-value" data-slot="account-days-late">${a.max_days_late||0}</strong></div></div>`)}
          ${dataCard('Próxima acción',`<div class="ll-next-action-host ll-dynamic-list" data-list-host="next-action">${nextActionBodyHtml(data)}</div>`) }
          ${dataCard('Pago rápido',`<form id="llSummaryQuickPayForm" class="ll-summary-quick-pay"><p>Abona a la cuenta del cliente</p><div class="ll-summary-quick-amounts">${quickAmountButtons(suggested,4,true)}</div><input id="llSummaryPayAmount" type="number" min="1" step="1" value="${suggested?Math.round(suggested):''}" required><button type="submit" class="ll-primary-btn">Registrar pago</button><div id="llSummaryPayStatus" class="ll-form-status">Pago rápido de cuota/interés.</div></form>`)}
        </aside></div></section>

        <section class="ll-profile-panel" data-profile-panel="payments">
          ${dataCard('Calendario de pagos y cuotas',calendarHtml('payments',data))}
          <div class="ll-panel-grid ll-payment-layout"><div class="ll-panel-main">${dataCard('Historial de pagos',`<div class="ll-list-host" data-list-host="payments">${paymentRowsHtml(data.payments)}</div>`)}</div><aside class="ll-panel-side">${dataCard('Registrar pago',`<form id="llProfilePaymentForm" class="ll-profile-form"><label>Monto<input id="llProfilePayAmount" type="number" min="1" step="1" value="${suggested?Math.round(suggested):''}" required></label><label>Fecha<input id="llProfilePayDate" type="date" value="${today()}" required></label><label>Tipo de pago<select id="llProfilePayType"><option value="INSTALLMENT">Pago de cuota/interés</option><option value="PRINCIPAL">Abono directo a capital</option><option value="MIXED">Mixto: cuota y sobrante a capital</option><option value="PAYOFF">Saldar capital</option></select></label><label>Notas<input id="llProfilePayNotes" placeholder="Notas del pago"></label><div class="ll-quick-profile-amounts">${quickAmountButtons(suggested,3,false)}</div><button type="submit" class="ll-primary-btn">Registrar pago</button><div id="llProfilePayStatus" class="ll-form-status">Los pagos de cuota no reducen el capital. El capital solo baja con abono, mixto o saldo.</div></form>`)}</aside></div>
        </section>

        <section class="ll-profile-panel" data-profile-panel="disbursements"><div class="ll-panel-grid ll-disbursement-layout"><div class="ll-panel-main">${dataCard('Historial y detalles de desembolsos',`<div class="ll-list-host" data-list-host="disbursements">${disbursementRowsHtml(data.disbursements)}</div>`)}</div><aside class="ll-panel-side">${dataCard('Nuevo desembolso',`<form id="llProfileDisbursementForm" class="ll-profile-form"><label>Capital desembolsado<input id="llProfilePrincipal" type="number" min="1" step="1" required></label><label>Fecha de inicio<input id="llProfileStartDate" type="date" value="${today()}" required></label><div class="ll-form-two"><label>Interés mensual total %<input id="llProfileTotalRate" type="number" min="0" step="0.01" value="${totalRate.toFixed(2)}" required></label><label>Administración %<input id="llProfileMgmtRate" type="number" min="0" step="0.01" value="${mgmtRate.toFixed(2)}" required></label></div><label>Notas<input id="llProfileDisbursementNotes" placeholder="Notas opcionales"></label><div class="ll-form-section-title">Distribución de inversión</div><div id="llProfileFundingRows">${fundingRowsHtml(data)}</div><div id="llProfileFundingTotal" class="ll-form-status"></div><button type="submit" class="ll-primary-btn" ${data.defaultFunding.length?'':'disabled'}>Guardar desembolso</button><div id="llProfileDisbursementStatus" class="ll-form-status">El capital se agrega a la cuenta y las cuotas futuras se recalculan automáticamente.</div></form>`)}</aside></div></section>

        <section class="ll-profile-panel" data-profile-panel="followups"><div class="ll-form-card-grid">${dataCard('Agregar nota o contacto',`<form id="llProfileContactForm" class="ll-profile-form"><div class="ll-form-two"><label>Tipo<select id="llProfileContactType"><option value="NOTE">Nota</option><option value="CALL">Llamada</option><option value="TEXT">Texto</option><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">Correo</option><option value="IN_PERSON">En persona</option><option value="OTHER">Otro</option></select></label><label>Fecha<input id="llProfileContactDate" type="date" value="${today()}" required></label></div><label>Desembolso relacionado<select id="llProfileContactLoan">${loanOptionsHtml(data.disbursements)}</select></label><label>Resultado<input id="llProfileContactOutcome" placeholder="Ej.: prometió pagar el viernes"></label><label>Notas<textarea id="llProfileContactNotes" rows="4" required placeholder="Escribe la nota del contacto"></textarea></label><button type="submit" class="ll-primary-btn">Guardar nota</button><div id="llProfileContactStatus" class="ll-form-status"></div></form>`)}${dataCard('Programar seguimiento',`<form id="llProfileFollowupForm" class="ll-profile-form"><div class="ll-form-two"><label>Fecha<input id="llProfileFollowupDate" type="date" value="${today()}" required></label><label>Prioridad<select id="llProfileFollowupPriority"><option value="NORMAL">Normal</option><option value="LOW">Baja</option><option value="HIGH">Alta</option><option value="URGENT">Urgente</option></select></label></div><label>Desembolso relacionado<select id="llProfileFollowupLoan">${loanOptionsHtml(data.disbursements)}</select></label><label>Motivo<textarea id="llProfileFollowupReason" rows="4" required placeholder="Motivo o recordatorio"></textarea></label><button type="submit" class="ll-primary-btn">Crear seguimiento</button><div id="llProfileFollowupStatus" class="ll-form-status"></div></form>`)}</div><div class="ll-form-card-grid ll-followup-lists">${dataCard('Historial de seguimientos',`<div class="ll-list-host" data-list-host="followups">${followupRowsHtml(data.followups)}</div>`)}${dataCard('Historial de notas y contactos',`<div class="ll-list-host" data-list-host="contacts">${contactRowsHtml(data.contacts)}</div>`)}</div></section>
      </div>
    </main>
  </div>`;
}
function quickAmountButtons(suggested,count,summary){
  const values=count===4?[suggested/2,suggested,suggested*2,suggested*4]:[suggested/2,suggested,suggested*2];
  return values.map((value,index)=>`<button type="button" class="ll-dynamic-value ${summary&&index===1?'active':''}" ${summary?'data-summary-amount':'data-profile-amount'}="${Math.round(value||0)}" ${value>0?'':'hidden'}>${money(value)}</button>`).join('');
}
function updateQuickAmounts(root,suggested,summary){
  const values=summary?[suggested/2,suggested,suggested*2,suggested*4]:[suggested/2,suggested,suggested*2];
  const selector=summary?'[data-summary-amount]':'[data-profile-amount]';
  [...root.querySelectorAll(selector)].forEach((button,index)=>{
    const value=values[index]||0;
    button.hidden=value<=0;
    if(summary)button.dataset.summaryAmount=String(Math.round(value));else button.dataset.profileAmount=String(Math.round(value));
    transitionValue(button,money(value));
  });
}

function showInitialLoading(){
  showAccountPage();
  document.body.classList.add('ll-client-detail-fixed');
  const content=document.getElementById('borrowerAccountContent');
  if(!content)return;
  content.innerHTML=`<div class="ll-controller-first-load"><aside>${svg('person','ll-ref-svg',16)}</aside><main><div class="ll-controller-first-load-badge"><span class="ll-controller-loading-dot"></span><strong>Cargando...</strong></div></main></div>`;
}

function mountProfile(data,selectedId){
  const content=document.getElementById('borrowerAccountContent');
  if(!content)return;
  localStorage.setItem(CLIENT_RAIL_STORAGE,'1');
  content.innerHTML=profileShellHtml(data,selectedId);
  mounted=true;
  document.body.classList.add('ll-client-detail-fixed');
  wireController(content.querySelector('.ll-account-shell'));
  updateFundingTotal();
  showTab(activeTab,false);
}

function transitionValue(element,nextText,nextClassName=null){
  if(!element)return Promise.resolve();
  const text=String(nextText??'');
  const sameText=element.textContent===text;
  const sameClass=nextClassName===null||element.className===nextClassName;
  if(sameText&&sameClass)return Promise.resolve();
  element.classList.add('ll-value-leaving');
  return new Promise(resolve=>setTimeout(()=>{
    element.textContent=text;
    if(nextClassName!==null)element.className=nextClassName;
    element.classList.remove('ll-value-leaving');
    element.classList.add('ll-value-entering');
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      element.classList.remove('ll-value-entering');
      resolve();
    }));
  },130));
}
function transitionList(host,nextHtml){
  if(!host)return Promise.resolve();
  const currentHeight=host.getBoundingClientRect().height;
  host.style.minHeight=`${currentHeight}px`;
  host.classList.add('ll-list-leaving');
  return new Promise(resolve=>setTimeout(()=>{
    host.innerHTML=nextHtml;
    host.classList.remove('ll-list-leaving');
    host.classList.add('ll-list-entering');
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      host.classList.remove('ll-list-entering');
      setTimeout(()=>{host.style.minHeight='';resolve();},180);
    }));
  },130));
}
function slot(root,name){return root.querySelector(`[data-slot="${name}"]`);}

async function updateCalendars(root,data){
  const jobs=[];
  root.querySelectorAll('.ll-cycle-calendar').forEach(calendar=>{
    const buttons=[...calendar.querySelectorAll('[data-calendar-date]')];
    if(!selectedDueIso||!buttons.some(btn=>btn.dataset.calendarDate===selectedDueIso))selectedDueIso=buttons.find(btn=>daysFromToday(btn.dataset.calendarDate)>=0)?.dataset.calendarDate||buttons[0]?.dataset.calendarDate;
    buttons.forEach(btn=>{
      const key=dueStatus(selectedCalendarRow(data,btn.dataset.calendarDate));
      btn.classList.remove('ok','pending','danger','closed');
      btn.classList.add(tone(key));
      btn.classList.toggle('selected',btn.dataset.calendarDate===selectedDueIso);
    });
    const row=selectedCalendarRow(data,selectedDueIso),key=dueStatus(row);
    jobs.push(
      transitionValue(calendar.querySelector('[data-calendar-slot="expected"]'),money(row.expected_total)),
      transitionValue(calendar.querySelector('[data-calendar-slot="paid"]'),money(row.paid_total)),
      transitionValue(calendar.querySelector('[data-calendar-slot="pending"]'),money(row.amount_due)),
      transitionValue(calendar.querySelector('[data-calendar-slot="status"]'),statusLabel(key),`ll-status-pill ${tone(key)} ll-dynamic-value`),
      transitionValue(calendar.querySelector('[data-calendar-slot="timing"]'),dueTiming(selectedDueIso))
    );
  });
  await Promise.all(jobs);
}

async function updateProfile(data,borrowerId){
  const root=document.querySelector('#borrowerAccountContent .ll-account-shell');
  if(!root)return;
  const a=data.summary,next=nextDueRow(data),suggested=Number(a.current_cycle_fee||a.current_monthly_fee||0);
  root.dataset.activeBorrower=String(borrowerId);
  const jobs=[
    transitionValue(slot(root,'header-avatar'),initials(a.full_name)),
    transitionValue(slot(root,'header-name'),a.full_name||'Cuenta del cliente'),
    transitionValue(slot(root,'header-status'),statusLabel(a.account_status),`ll-status-pill ${tone(a.account_status)} ll-dynamic-value`),
    transitionValue(slot(root,'header-phone'),a.phone||'Sin teléfono'),
    transitionValue(slot(root,'header-next-due'),fmtDate(next?.due_date||a.next_due_date)),
    transitionValue(slot(root,'header-overdue'),money(a.overdue_amount)),
    transitionValue(slot(root,'principal'),money(a.principal_balance)),
    transitionValue(slot(root,'principal-status'),statusLabel(a.account_status)),
    transitionValue(slot(root,'total-disbursed'),money(a.total_disbursed)),
    transitionValue(slot(root,'disbursement-count'),`${a.disbursement_count||0} desembolsos`),
    transitionValue(slot(root,'monthly-fee'),money(a.current_monthly_fee)),
    transitionValue(slot(root,'cycle-fee'),money(a.current_cycle_fee)),
    transitionValue(slot(root,'next-due'),fmtDate(next?.due_date)),
    transitionValue(slot(root,'next-due-timing'),next?dueTiming(next.due_date):'Sin fecha'),
    transitionValue(slot(root,'account-status'),statusLabel(a.account_status)),
    transitionValue(slot(root,'account-overdue'),money(a.overdue_amount)),
    transitionValue(slot(root,'account-overdue-count'),String(a.overdue_count||0)),
    transitionValue(slot(root,'account-days-late'),String(a.max_days_late||0)),
    updateCalendars(root,data),
    transitionList(root.querySelector('[data-list-host="movements"]'),movementsHtml(data)),
    transitionList(root.querySelector('[data-list-host="next-action"]'),nextActionBodyHtml(data)),
    transitionList(root.querySelector('[data-list-host="payments"]'),paymentRowsHtml(data.payments)),
    transitionList(root.querySelector('[data-list-host="disbursements"]'),disbursementRowsHtml(data.disbursements)),
    transitionList(root.querySelector('[data-list-host="followups"]'),followupRowsHtml(data.followups)),
    transitionList(root.querySelector('[data-list-host="contacts"]'),contactRowsHtml(data.contacts))
  ];

  updateQuickAmounts(root,suggested,true);
  updateQuickAmounts(root,suggested,false);
  const quickInput=root.querySelector('#llSummaryPayAmount');if(quickInput)quickInput.value=suggested?Math.round(suggested):'';
  const payInput=root.querySelector('#llProfilePayAmount');if(payInput)payInput.value=suggested?Math.round(suggested):'';
  const options=loanOptionsHtml(data.disbursements);
  const contactLoan=root.querySelector('#llProfileContactLoan');if(contactLoan)contactLoan.innerHTML=options;
  const followLoan=root.querySelector('#llProfileFollowupLoan');if(followLoan)followLoan.innerHTML=options;

  await Promise.all(jobs);
  updateActiveRail(borrowerId,data.summary);
  applyMovementFilter(root,movementFilter);
}

function updateActiveRail(borrowerId,summary=null){
  const root=document.querySelector('#borrowerAccountContent .ll-account-shell');
  if(!root)return;
  root.querySelectorAll('.ll-client-card').forEach(card=>{
    const active=String(card.dataset.acctBorrower)===String(borrowerId);
    card.classList.toggle('active',active);
    card.querySelector('.ll-active-rail-indicator')?.remove();
    if(active){const indicator=document.createElement('span');indicator.className='ll-active-rail-indicator';indicator.setAttribute('aria-hidden','true');card.prepend(indicator);}
  });
  const card=root.querySelector(`.ll-client-card[data-acct-borrower="${CSS.escape(String(borrowerId))}"]`);
  if(card&&summary){
    transitionValue(card.querySelector('.ll-client-balance'),money(summary.principal_balance));
    const badge=card.querySelector('.ll-rail-badge');
    if(badge){
      badge.className=`ll-rail-badge ll-elegant-status ${tone(summary.account_status)}`;
      transitionValue(badge.querySelector('[data-rail-status]'),statusLabel(summary.account_status));
    }
  }
}

function showLoadingBadge(show,text='Cargando...'){
  const badge=document.querySelector('#borrowerAccountContent .ll-controller-loading-badge');
  if(!badge)return;
  const strong=badge.querySelector('strong');if(strong)strong.textContent=text;
  badge.classList.toggle('visible',show);
}

async function selectClient(borrowerId,{initial=false}={}){
  if(!borrowerId)return;
  showAccountPage();
  const sequence=++requestSequence;
  if(!mounted){
    showInitialLoading();
    try{
      const data=await loadProfileData(borrowerId,{includeAccounts:true});
      if(sequence!==requestSequence)return;
      accounts=data.accounts||[];
      currentBorrowerId=borrowerId;currentData=data;
      mountProfile(data,borrowerId);
      window.dispatchEvent(new CustomEvent('loan-ledger:client-profile-ready',{detail:{borrowerId,initial:true}}));
    }catch(error){
      console.error('client profile initial load failed',error);
      const content=document.getElementById('borrowerAccountContent');
      if(content)content.innerHTML=`<div class="ll-controller-load-error">No se pudo cargar el perfil. ${esc(error.message||error)}</div>`;
    }
    return;
  }
  if(String(currentBorrowerId)===String(borrowerId)&&!initial){syncFixedMode();return;}
  updateActiveRail(borrowerId);
  showLoadingBadge(true);
  try{
    const data=await loadProfileData(borrowerId);
    if(sequence!==requestSequence)return;
    currentBorrowerId=borrowerId;currentData=data;
    await updateProfile(data,borrowerId);
    if(sequence!==requestSequence)return;
    showLoadingBadge(false);
    window.dispatchEvent(new CustomEvent('loan-ledger:client-profile-ready',{detail:{borrowerId,initial:false}}));
  }catch(error){
    console.error('client profile switch failed',error);
    if(sequence===requestSequence)showLoadingBadge(true,'No se pudo cargar');
  }
}

function showTab(key,focus=true){
  const root=document.querySelector('#borrowerAccountContent .ll-account-shell');
  if(!root)return;
  activeTab=key;
  root.querySelectorAll('.ll-tab').forEach(tab=>{const active=tab.dataset.profileTab===key;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',active?'true':'false');});
  root.querySelectorAll('[data-profile-panel]').forEach(panel=>panel.classList.toggle('active',panel.dataset.profilePanel===key));
  if(focus)root.querySelector(`[data-profile-panel="${key}"]`)?.scrollIntoView({behavior:'smooth',block:'start'});
}
function applyMovementFilter(root,filter){
  movementFilter=filter;
  root.querySelectorAll('[data-movement-filter]').forEach(row=>row.hidden=filter!=='todos'&&row.dataset.movementFilter!==filter);
  root.querySelectorAll('.ll-movement-filter').forEach(btn=>btn.classList.toggle('active',btn.dataset.filter===filter));
}

async function moveCalendar(direction){
  if(!currentData)return;
  calendarOffset+=Number(direction||0);
  const dates=visibleCycleDates();
  if(!dates.some(date=>toIso(date)===selectedDueIso))selectedDueIso=toIso(dates.find(date=>date>=parseIso(today()))||dates[1]||dates[0]);
  const dir=Number(direction)>0?'forward':'backward';
  const calendars=[...document.querySelectorAll('#borrowerAccountContent .ll-cycle-calendar')];
  calendars.forEach(calendar=>calendar.querySelector('.ll-cycle-date-row')?.classList.add(`ll-carousel-out-${dir}`));
  await new Promise(resolve=>setTimeout(resolve,220));
  calendars.forEach(calendar=>{
    const oldRow=calendar.querySelector('.ll-cycle-date-row');
    const box=document.createElement('div');box.innerHTML=`<div class="ll-cycle-date-row ll-carousel-in-${dir}">${calendarDateButtonsHtml(dates,currentData)}</div>`;
    const newRow=box.firstElementChild;oldRow?.replaceWith(newRow);
    const title=calendar.querySelector('.ll-cycle-calendar-nav span');if(title)title.textContent=monthRangeTitle(dates);
    requestAnimationFrame(()=>requestAnimationFrame(()=>newRow.classList.remove(`ll-carousel-in-${dir}`)));
  });
  await updateCalendars(document.querySelector('#borrowerAccountContent .ll-account-shell'),currentData);
}
async function chooseCalendarDate(iso){
  if(!currentData||!iso)return;
  selectedDueIso=iso;
  const root=document.querySelector('#borrowerAccountContent .ll-account-shell');
  root?.querySelectorAll('[data-calendar-date]').forEach(btn=>btn.classList.toggle('selected',btn.dataset.calendarDate===iso));
  await updateCalendars(root,currentData);
}

function setStatus(id,message,error=false){const el=document.getElementById(id);if(el){el.textContent=message;el.classList.toggle('error',error);}}
async function refreshCurrent(){
  if(!currentBorrowerId)return;
  const sequence=++requestSequence;showLoadingBadge(true);
  const data=await loadProfileData(currentBorrowerId);
  if(sequence!==requestSequence)return;
  currentData=data;await updateProfile(data,currentBorrowerId);showLoadingBadge(false);
}

async function handleSubmit(event){
  const form=event.target.closest('form');
  if(!form||!form.closest('#borrowerAccountContent .ll-account-shell'))return;
  if(!['llSummaryQuickPayForm','llProfilePaymentForm','llProfileContactForm','llProfileFollowupForm','llProfileDisbursementForm'].includes(form.id))return;
  event.preventDefault();
  try{
    if(form.id==='llSummaryQuickPayForm'||form.id==='llProfilePaymentForm'){
      const summary=form.id==='llSummaryQuickPayForm';
      const amount=Number(form.querySelector(summary?'#llSummaryPayAmount':'#llProfilePayAmount')?.value||0);
      const paid_on=summary?today():form.querySelector('#llProfilePayDate')?.value;
      const payment_type=summary?'INSTALLMENT':form.querySelector('#llProfilePayType')?.value||'INSTALLMENT';
      const notes=summary?'Pago rápido desde el resumen':form.querySelector('#llProfilePayNotes')?.value.trim()||null;
      const statusId=summary?'llSummaryPayStatus':'llProfilePayStatus';
      if(!amount||!paid_on)return setStatus(statusId,'Fecha y monto son requeridos.',true);
      setStatus(statusId,'Aplicando pago...');
      const {error}=await db.rpc('apply_borrower_payment',{p_borrower_id:currentBorrowerId,p_paid_on:paid_on,p_amount:amount,p_payment_type:payment_type,p_notes:notes});
      if(error)return setStatus(statusId,error.message,true);
      setStatus(statusId,'Pago registrado correctamente.');
    }else if(form.id==='llProfileContactForm'){
      const date=form.querySelector('#llProfileContactDate')?.value,notes=form.querySelector('#llProfileContactNotes')?.value.trim();
      if(!date||!notes)return setStatus('llProfileContactStatus','Fecha y notas son requeridas.',true);
      setStatus('llProfileContactStatus','Guardando nota...');
      const {error}=await db.from('borrower_contact_log').insert({borrower_id:currentBorrowerId,loan_id:form.querySelector('#llProfileContactLoan')?.value||null,contact_date:date,contact_type:form.querySelector('#llProfileContactType')?.value||'NOTE',outcome:form.querySelector('#llProfileContactOutcome')?.value.trim()||null,notes,created_by:await currentUserId()});
      if(error)return setStatus('llProfileContactStatus',error.message,true);
      setStatus('llProfileContactStatus','Nota guardada.');
    }else if(form.id==='llProfileFollowupForm'){
      const date=form.querySelector('#llProfileFollowupDate')?.value,reason=form.querySelector('#llProfileFollowupReason')?.value.trim();
      if(!date||!reason)return setStatus('llProfileFollowupStatus','Fecha y motivo son requeridos.',true);
      setStatus('llProfileFollowupStatus','Creando seguimiento...');
      const {error}=await db.from('borrower_followups').insert({borrower_id:currentBorrowerId,loan_id:form.querySelector('#llProfileFollowupLoan')?.value||null,due_date:date,priority:form.querySelector('#llProfileFollowupPriority')?.value||'NORMAL',reason,created_by:await currentUserId()});
      if(error)return setStatus('llProfileFollowupStatus',error.message,true);
      setStatus('llProfileFollowupStatus','Seguimiento creado.');
    }else{
      const principal=Number(form.querySelector('#llProfilePrincipal')?.value||0),start_date=form.querySelector('#llProfileStartDate')?.value,total=Number(form.querySelector('#llProfileTotalRate')?.value||0)/100,mgmt=Number(form.querySelector('#llProfileMgmtRate')?.value||0)/100,notes=form.querySelector('#llProfileDisbursementNotes')?.value.trim()||null;
      const funding=[...form.querySelectorAll('[data-partner-user-id]')].map(input=>({partner_user_id:input.dataset.partnerUserId,funding_percent:Number(input.value||0)/100})).filter(row=>row.partner_user_id&&row.funding_percent>0);
      const fundingTotal=funding.reduce((sum,row)=>sum+row.funding_percent,0);
      if(!principal||!start_date)return setStatus('llProfileDisbursementStatus','Fecha y capital son requeridos.',true);
      if(mgmt>total)return setStatus('llProfileDisbursementStatus','La administración no puede superar el interés total.',true);
      if(!funding.length||Math.abs(fundingTotal-1)>0.001)return setStatus('llProfileDisbursementStatus','La distribución debe sumar 100%.',true);
      setStatus('llProfileDisbursementStatus','Guardando desembolso...');
      const {data:loan,error}=await db.from('loans').insert({borrower_id:currentBorrowerId,created_by:await currentUserId(),start_date,principal_original:principal,principal_outstanding:principal,monthly_rate_total:total,monthly_rate_mgmt:mgmt,notes,status:'ACTIVE'}).select('id').single();
      if(error)return setStatus('llProfileDisbursementStatus',error.message,true);
      const fundingResult=await db.from('loan_funding').insert(funding.map(row=>({loan_id:loan.id,...row})));
      if(fundingResult.error)return setStatus('llProfileDisbursementStatus',fundingResult.error.message,true);
      setStatus('llProfileDisbursementStatus','Desembolso guardado.');
    }
    await refreshCurrent();
  }catch(error){console.error('client profile action failed',error);alert(error.message||error);}
}

async function handleClick(event){
  const root=event.currentTarget;
  const client=event.target.closest('.ll-client-card[data-acct-borrower]');
  if(client){event.preventDefault();selectClient(client.dataset.acctBorrower);return;}
  const tab=event.target.closest('.ll-tab[data-profile-tab]');if(tab){showTab(tab.dataset.profileTab);return;}
  const open=event.target.closest('[data-open-tab]');if(open){showTab(open.dataset.openTab);return;}
  const top=event.target.closest('[data-top-action]');if(top){
    const action=top.dataset.topAction;
    if(action==='disbursement'){showTab('disbursements');setTimeout(()=>root.querySelector('#llProfilePrincipal')?.focus(),80);}
    if(action==='note'){showTab('followups');setTimeout(()=>root.querySelector('#llProfileContactNotes')?.focus(),80);}
    if(action==='whatsapp'){const phone=String(currentData?.summary?.phone||'').replace(/\D/g,'');if(!phone)return alert('Este cliente no tiene un teléfono registrado.');window.open(`https://wa.me/${phone}`,'_blank','noopener,noreferrer');}
    return;
  }
  if(event.target.closest('#llFocusPay')){showTab('payments');setTimeout(()=>root.querySelector('#llProfilePayAmount')?.focus(),80);return;}
  const move=event.target.closest('[data-calendar-move]');if(move){event.preventDefault();moveCalendar(move.dataset.calendarMove);return;}
  const date=event.target.closest('[data-calendar-date]');if(date){event.preventDefault();chooseCalendarDate(date.dataset.calendarDate);return;}
  const filter=event.target.closest('.ll-movement-filter');if(filter){applyMovementFilter(root,filter.dataset.filter);return;}
  const summaryAmount=event.target.closest('[data-summary-amount]');if(summaryAmount){root.querySelectorAll('[data-summary-amount]').forEach(btn=>btn.classList.remove('active'));summaryAmount.classList.add('active');const input=root.querySelector('#llSummaryPayAmount');if(input)input.value=summaryAmount.dataset.summaryAmount;return;}
  const profileAmount=event.target.closest('[data-profile-amount]');if(profileAmount){const input=root.querySelector('#llProfilePayAmount');if(input)input.value=profileAmount.dataset.profileAmount;return;}
  const complete=event.target.closest('[data-complete-followup]');if(complete){const note=prompt('Nota de finalización (opcional):','');if(note===null)return;const {error}=await db.rpc('complete_followup',{p_followup_id:complete.dataset.completeFollowup,p_completed_notes:note.trim()||null});if(error)return alert(error.message);await refreshCurrent();return;}
  const voidButton=event.target.closest('[data-void-payment]');if(voidButton){const reason=prompt('Motivo de anulación (opcional):','');if(reason===null)return;if(!confirm('¿Seguro que quieres anular este pago? Se revertirán las aplicaciones de cuota, capital y distribuciones.'))return;const {error}=await db.rpc('void_payment',{p_payment_id:voidButton.dataset.voidPayment,p_reason:reason.trim()||null});if(error)return alert(error.message);await refreshCurrent();return;}
  const search=event.target.closest('.ll-controller-search');if(search){const wrap=root.querySelector('.ll-client-search-wrap'),input=root.querySelector('.ll-client-search-input');if(wrap){wrap.hidden=!wrap.hidden;if(!wrap.hidden)setTimeout(()=>input?.focus(),0);}return;}
}
function handleInput(event){
  if(event.target.matches('.ll-client-search-input')){const q=event.target.value.trim().toLowerCase();document.querySelectorAll('#borrowerAccountContent .ll-client-card').forEach(card=>card.hidden=!!q&&!String(card.dataset.clientSearch||'').includes(q));}
  if(event.target.matches('[data-partner-user-id]'))updateFundingTotal();
}
function handleKeydown(event){
  const tab=event.target.closest('.ll-tab[data-profile-tab]');if(tab&&(event.key==='Enter'||event.key===' ')){event.preventDefault();showTab(tab.dataset.profileTab);}
}
function updateFundingTotal(){
  const inputs=[...document.querySelectorAll('#borrowerAccountContent [data-partner-user-id]')];
  if(!inputs.length)return;
  const total=inputs.reduce((sum,input)=>sum+Number(input.value||0),0);
  setStatus('llProfileFundingTotal',`Total: ${total.toFixed(2)}%${Math.abs(total-100)>0.01?' · Debe sumar 100%.':''}`,Math.abs(total-100)>0.01);
}
function wireController(root){
  if(!root||root.dataset.controllerBound==='1')return;
  root.dataset.controllerBound='1';
  root.addEventListener('click',handleClick);
  root.addEventListener('submit',handleSubmit);
  root.addEventListener('input',handleInput);
  root.addEventListener('keydown',handleKeydown);
}

window.addEventListener('click',event=>{
  const row=event.target.closest?.('#loansDashboardHost [data-ld-borrower]');
  if(!row)return;
  const id=row.dataset.ldBorrower;if(!id)return;
  event.preventDefault();event.stopImmediatePropagation();selectClient(id,{initial:!mounted});
},true);

window.addEventListener('loan-ledger:account-rendered',event=>{
  const id=event.detail?.borrowerId;
  if(id)selectClient(id,{initial:!mounted});
});

const page=ensureAccountPage();
if(page)new MutationObserver(syncFixedMode).observe(page,{attributes:true,attributeFilter:['class']});

console.log('single persistent client profile controller active');
