import { choosePaymentVoidReason } from './payment-void-reasons.js?v=2';
import { CLIENT_CHANGED, CLIENT_FIELDS, mergeClientAccount, publishClientChange } from './client-directory.js?v=1';
import { clientFieldsMarkup, clientFields } from './client-form.js?v=1';
import { attachFundingEditor, openFundingEditor } from './funding-editor.js?v=1';
import { installmentLinksMarkup, attachInstallmentLinks, borrowerInstallmentRows, readInstallmentLinkFields, describeInstallmentLinks } from './installment-links.js?v=1';
import { paymentDistributionMarkup, attachPaymentDistribution } from './payment-distribution.js?v=1';
import { invalidatePageReads } from './page-read-runtime.js?v=1';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { mixedPaymentMarkup, attachMixedPaymentSplit, mixedContextFromCalendar } from './mixed-payment-split.js?v=2';
import { paymentCalendarMarkup, attachPaymentCalendar, paymentCalendarEnd } from './payment-calendar.js?v=2';
import { openActivityDetails } from './activity-details.js?v=5';
import { openClientInstallmentPicker } from './client-installment-picker.js?v=1';

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
  ['clientProfileFixedShellCss','./client-profile-fixed-shell.css?v=2'],
  ['uiFinalPolishCss','./ui-final-polish.css?v=3'],
  ['clientProfileControllerCss','./client-profile-controller.css?v=3'],
  ['clientProfileWorkspaceCss','./client-profile-workspace.css?v=10']
];
STYLE_FILES.forEach(([id,href])=>{
  let link=document.getElementById(id);
  if(!link){link=document.createElement('link');link.id=id;link.rel='stylesheet';document.head.appendChild(link);}
  link.href=href;
});

const CLIENT_RAIL_STORAGE='loanLedger.clientRailCollapsed';
const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(value||0));
const calendarMoney=money;
const paymentAmount=value=>Number(Number(value||0).toFixed(2));
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
let profileCalendarPanel=null;
let movementFilter='todos';
const profileListTemplates=new WeakMap();
const fundingEditors=new WeakMap();
let composerTrigger=null;
let composerBackgrounds=[];

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
  if(row?.timing_status==='OVERDUE')return 'OVERDUE';
  if(row?.status==='PARTIAL')return 'PARTIAL';
  if(row?.timing_status==='DUE_TODAY')return 'DUE_TODAY';
  if(row?.status==='CANCELLED'||row?.timing_status==='CANCELLED')return 'CANCELLED';
  return row?.status||row?.timing_status||'UPCOMING';
}
function paymentTypeLabel(type){return {INSTALLMENT:'Cuota/interés',PRINCIPAL:'Abono a capital',MIXED:'Mixto',PAYOFF:'Saldar capital'}[type]||type||'—';}

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
  if(document.scrollingElement)document.scrollingElement.scrollTop=0;
  document.getElementById('sideMenu')?.classList.remove('open');
  document.getElementById('menuOverlay')?.classList.remove('open');
}
function syncFixedMode(){
  const page=document.getElementById('borrowerAccountPage');
  document.body.classList.toggle('ll-client-detail-fixed',!!page?.classList.contains('active-page')&&mounted);
  if(!page?.classList.contains('active-page')){
    profileCalendarPanel?.close(true,false);
    closeComposer(true,false);
  }
}

async function currentUserId(){
  const {data,error}=await db.auth.getUser();
  if(error)throw error;
  if(!data.user?.id)throw new Error('No se encontró una sesión activa.');
  return data.user.id;
}

async function loadProfileData(borrowerId,{includeAccounts=false}={}){
  const range=cycleDatesAround(new Date(),12,18);
  const endIso=toIso(range[range.length-1]);
  const jobs=[
    db.from('borrower_account_summary').select('*').eq('borrower_id',borrowerId).single(),
    db.rpc('get_borrower_calendar_workspace',{p_borrower_id:borrowerId,p_end_date:endIso}),
    db.from('borrower_disbursements_view').select('*').eq('borrower_id',borrowerId).order('start_date',{ascending:false}),
    db.from('borrower_contact_log_view').select('*').eq('borrower_id',borrowerId).order('created_at',{ascending:false}).limit(80),
    db.from('borrower_followups_view').select('*').eq('borrower_id',borrowerId).order('due_date',{ascending:true}).limit(80),
    db.from('app_settings').select('setting_key,setting_value').in('setting_key',['loan_defaults','default_funding_split']),
    db.from('loan_funding').select('loan_id,partner_user_id,funding_percent,contributed_amount'),
    db.from('profiles').select('user_id,full_name,role'),
    db.from('borrowers').select(CLIENT_FIELDS).eq('id',borrowerId).single()
  ];
  if(includeAccounts)jobs.push(db.from('borrower_account_summary').select('*').order('full_name',{ascending:true}));
  const [results,userRes]=await Promise.all([Promise.all(jobs),db.auth.getUser()]);
  for(const result of results)if(result.error)throw result.error;
  const [summaryRes,calendarRes,disbRes,contactRes,followRes,settingsRes,fundingRes,profilesRes,clientRes,accountsRes]=results;
  if(!calendarRes.data)throw new Error('No se pudo consultar el calendario de esta cuenta.');
  const settings=Object.fromEntries((settingsRes.data||[]).map(row=>[row.setting_key,row.setting_value]));
  const profileNames=new Map((profilesRes.data||[]).map(row=>[row.user_id,row.full_name||row.role||'Socio']));
  const loanIds=new Set((disbRes.data||[]).map(row=>row.id));
  const fundingByLoan=new Map();
  (fundingRes.data||[]).filter(row=>loanIds.has(row.loan_id)).forEach(row=>{
    if(!fundingByLoan.has(row.loan_id))fundingByLoan.set(row.loan_id,[]);
    fundingByLoan.get(row.loan_id).push({...row,partner_name:profileNames.get(row.partner_user_id)||'Socio'});
  });
  const viewer=profilesRes.data?.find(row=>row.user_id===userRes.data?.user?.id);
  return {
    summary:{...summaryRes.data,...clientRes.data},
    fundingPeople:(profilesRes.data||[]).filter(row=>['ADMIN','PARTNER'].includes(row.role)).sort((a,b)=>String(a.full_name).localeCompare(String(b.full_name),'es')),
    canManageFunding:viewer?.role==='ADMIN',
    canEditClient:['ADMIN','AGENT'].includes(viewer?.role),
    calendarRows:calendarRes.data.rows||[],
    calendarAsOf:calendarRes.data.as_of_date||today(),
    disbursements:(disbRes.data||[]).map(row=>({...row,funding:fundingByLoan.get(row.id)||[]})),
    payments:calendarRes.data.payments||[],
    contacts:contactRes.data||[],
    followups:followRes.data||[],
    defaults:settings.loan_defaults||{default_total_monthly_rate:10,default_management_rate:3},
    defaultFunding:Array.isArray(settings.default_funding_split)?settings.default_funding_split.map(row=>({...row,partner_name:profileNames.get(row.partner_user_id)||row.partner_name||'Socio'})):[],
    accounts:accountsRes?.data||null
  };
}

function calendarMap(data){return new Map((data.calendarRows||[]).map(row=>[row.due_date,row]));}
function selectedCalendarRow(data,iso){
  const row=calendarMap(data).get(iso);
  if(row)return row;
  return {due_date:iso,expected_total:0,paid_total:0,amount_due:0,principal_snapshot:0,timing_status:'CANCELLED',status:'CANCELLED',is_virtual:true};
}
function nextDueRow(data){
  const rows=[...(data.calendarRows||[])].filter(row=>Number(row.amount_due||0)>0&&!['PAID','CANCELLED'].includes(dueStatus(row))).sort((a,b)=>String(a.due_date).localeCompare(String(b.due_date)));
  return rows.find(row=>daysFromToday(row.due_date)>=0)||rows[0]||(Number(data.summary.principal_balance||0)>0?selectedCalendarRow(data,nextCycleIso()):null);
}
const CALENDAR_WINDOW_SIZE=6;
function calendarRange(data){
  const asOf=data.calendarAsOf||toIso(new Date());
  const all=data.calendarRows.length?[...new Set(data.calendarRows.map(row=>row.due_date))].sort():cycleDatesAround(parseIso(asOf),12,18).map(toIso);
  const upcoming=all.findIndex(iso=>iso>=asOf), currentIndex=upcoming<0?all.length-1:upcoming;
  const lastStart=Math.max(0,all.length-CALENDAR_WINDOW_SIZE);
  return {asOf,all,currentIso:all[currentIndex],baseStart:Math.min(lastStart,Math.max(0,currentIndex-1)),lastStart};
}
function calendarWindow(range){
  const start=Math.min(range.lastStart,Math.max(0,range.baseStart+calendarOffset));
  return {start,dates:range.all.slice(start,start+CALENDAR_WINDOW_SIZE)};
}
function selectVisibleDate(range,dates){
  if(!dates.includes(selectedDueIso)){
    selectedDueIso=dates.includes(range.currentIso)?range.currentIso:dates.find(iso=>iso>=range.asOf)||dates[1]||dates[0];
  }
}
function calendarAtCurrent(range,start){
  return start===range.baseStart&&selectedDueIso===range.currentIso;
}
function calendarBalance(data,iso){
  const row=selectedCalendarRow(data,iso),asOf=data.calendarAsOf||today();
  const arrears=(data.calendarRows||[]).filter(r=>r.due_date<iso&&r.due_date<asOf&&Number(r.amount_due)>0&&r.status!=='CANCELLED');
  const overdue=Math.round(arrears.reduce((sum,r)=>sum+Number(r.amount_due),0)*100)/100;
  return {row,arrears,overdue,total:Math.round((Number(row.amount_due||0)+overdue)*100)/100};
}
function calendarReceiptHtml(payment,iso){
  const applied=(payment.due_applications||[]).filter(a=>a.due_date===iso).reduce((sum,a)=>sum+Number(a.applied_total||0),0);
  const line=(label,value)=>`<div><span>${label}</span><strong>${calendarMoney(value)}</strong></div>`;
  return `<details class="cp-calendar-receipt" data-payment-receipt="${esc(payment.id)}"><summary><span><strong>Pago del ${fmtDate(payment.paid_on)}</strong><small>${esc(paymentTypeLabel(payment.payment_type))} · Aplicado a esta cuota</small></span><strong>${calendarMoney(applied)}</strong>${svg('chevronDown')}</summary><div class="cp-receipt-body"><div class="cp-receipt-heading"><span>Importe del pago</span><strong>${calendarMoney(payment.amount)}</strong><span class="ll-status-pill ok">APLICADO</span></div><div class="cp-receipt-amounts">${line('Cuota / interés',payment.applied_interest)}${line('Capital',payment.applied_principal)}${line('Administración',payment.applied_mgmt)}${line('Socios',payment.applied_funders)}</div>${payment.notes?`<p class="cp-calendar-note">${esc(payment.notes)}</p>`:''}<h4>Cuotas afectadas</h4>${(payment.due_applications||[]).map(a=>`<div class="cp-calendar-line"><span>${fmtDate(a.due_date)}${a.due_date===iso?' · Esta cuota':''}</span><strong>${calendarMoney(a.applied_total)}</strong></div>`).join('')}<h4>Capital afectado</h4>${(payment.principal_applications||[]).map(a=>{const loan=currentData?.disbursements.find(l=>l.id===a.loan_id);return `<div class="cp-calendar-line"><span>Desembolso${loan?' del '+fmtDate(loan.start_date):' '+esc(String(a.loan_id).slice(0,8))}</span><strong>${calendarMoney(a.amount)}</strong></div>`;}).join('')||'<p class="cp-calendar-note">No afectó capital.</p>'}<h4>Distribuciones</h4>${(payment.allocations||[]).map(a=>`<div class="cp-calendar-line"><span>${esc(a.partner_name||'Socio')}<small>${String(a.allocation_type).includes('MANAGEMENT')?'Administración':'Ingreso de socio'}${a.is_voided?' · Anulada':''}</small></span><strong>${calendarMoney(a.amount)}</strong></div>`).join('')||'<p class="cp-calendar-note">No hay distribuciones vinculadas.</p>'}</div></details>`;
}
function calendarDetailHtml(data,iso){
  const {row,arrears}=calendarBalance(data,iso);
  const payments=(data.payments||[]).filter(p=>!p.is_voided&&(p.due_applications||[]).some(a=>a.due_date===iso&&Number(a.applied_total)>0));
  const linked=payments.reduce((sum,p)=>sum+(p.due_applications||[]).filter(a=>a.due_date===iso).reduce((n,a)=>n+Number(a.applied_total||0),0),0);
  const related=[...(data.followups||[]),...(data.contacts||[])].filter(record=>record.installment_dates?.includes(iso));
  const linkedNotes=related.length?`<section class="cp-due-section"><h3>Notas y seguimientos vinculados</h3><ul class="ll-linked-notes">${related.map(record=>`<li><strong>${esc(record.reason||record.outcome||record.notes||'Nota de contacto')}</strong>${record.execution_date?` <small>· Ejecución: ${fmtDate(record.execution_date)}</small>`:''}</li>`).join('')}</ul><button type="button" class="cp-text-action" data-open-tab="followups">Ver notas y seguimientos</button></section>`:'';
  const excess=Math.max(0,Math.round((Number(row.paid_total||0)-Number(row.expected_total||0))*100)/100);
  return `<div class="cp-due-facts"><div><small>Capital base de esta fecha</small><strong>${calendarMoney(row.principal_snapshot)}</strong></div><div><small>Cuota original</small><strong>${calendarMoney(row.expected_total)}</strong></div><div><small>Pagado a esta cuota</small><strong>${calendarMoney(row.paid_total)}</strong></div></div><p class="cp-calendar-note">Calculada con el capital de esta fecha. Los saldos reflejan los pagos registrados; las cuotas futuras son una proyección.</p>${excess>0?`<p class="cp-calendar-alert">Hay ${calendarMoney(excess)} aplicados por encima del importe de esta cuota. Revisa los pagos vinculados.</p>`:''}<section class="cp-due-section"><h3>Atrasos anteriores <span>${arrears.length}</span></h3>${arrears.length?`<div class="cp-due-table-scroll"><table class="cp-due-table"><thead><tr><th>Cuota</th><th>Original</th><th>Pagado</th><th>Pendiente</th></tr></thead><tbody>${arrears.map(a=>`<tr><td><button type="button" class="cp-text-action" data-calendar-jump="${esc(a.due_date)}">${fmtDate(a.due_date)}</button></td><td>${calendarMoney(a.expected_total)}</td><td>${calendarMoney(a.paid_total)}</td><td><strong>${calendarMoney(a.amount_due)}</strong></td></tr>`).join('')}</tbody></table></div>`:'<p class="cp-calendar-note">No hay cuotas anteriores vencidas pendientes en esta fecha.</p>'}</section><section class="cp-due-section"><h3>Pagos aplicados a esta cuota</h3>${payments.map(p=>calendarReceiptHtml(p,iso)).join('')||'<p class="cp-calendar-note">No hay pagos vinculados a esta cuota.</p>'}${Number(row.paid_total||0)-linked>.005?'<p class="cp-calendar-note">Parte del abono procede de un registro histórico sin detalle de pago vinculado.</p>':''}</section>${linkedNotes}`;
}
function monthRangeTitle(dates){
  const f=new Intl.DateTimeFormat('es',{month:'long',year:'numeric'});
  const first=f.format(parseIso(dates[0]));
  const last=f.format(parseIso(dates.at(-1)));
  return first===last?first:`${first} – ${last}`;
}

function metricCell(icon,label,value,sub,slot,subSlot=''){
  return `<div><div class="ll-summary-kpi-main"><span class="ll-elegant-metric-icon">${svg(icon,'ll-ref-svg',14)}</span><div class="ll-summary-kpi-copy"><span>${label}</span><strong class="ll-dynamic-value" data-slot="${slot}">${esc(value)}</strong></div></div><small class="${subSlot?'ll-dynamic-value':''}" ${subSlot?`data-slot="${subSlot}"`:''}>${esc(sub)}</small></div>`;
}
function overdueCaption(summary){
  if(Number(summary.overdue_amount||0)<=0)return 'Sin cuotas atrasadas';
  const count=Number(summary.overdue_count||0),days=Number(summary.max_days_late||0);
  return `${count} ${count===1?'cuota':'cuotas'} · ${days} ${days===1?'día':'días'}`;
}
function emptyState(text,action='',label=''){
  return `<div class="cp-empty"><span>${svg('note')}</span><p>${esc(text)}</p>${action?`<button type="button" class="cp-action cp-quiet" data-composer="${action}">${esc(label)}</button>`:''}</div>`;
}

function clientRailHtml(selectedId){
  return `<aside class="ll-client-rail" data-no-translate="true">
    <div class="ll-rail-top"><div class="ll-rail-title">Clientes</div><button class="ll-icon-btn ll-controller-search" type="button" aria-label="Buscar clientes">${svg('search','ll-ref-svg',15)}</button></div>
    <div class="ll-filter-row"><span>Todos los clientes</span><span class="ll-filter-control" aria-hidden="true">${svg('chevronDown','ll-ref-svg',12)}</span></div>
    <button type="button" class="ll-collapsed-client-marker" data-expand-client-rail aria-label="Buscar o cambiar cliente" title="Buscar o cambiar cliente">${svg('person','ll-ref-svg',15)}</button>
    <div class="ll-client-search-wrap" hidden><input class="ll-client-search-input" type="search" placeholder="Buscar cliente" aria-label="Buscar cliente"></div>
    <div class="ll-client-list">${accounts.map(a=>clientRowHtml(a,selectedId)).join('')}</div>
    <button id="acctBack" type="button" class="ll-soft-btn ll-rail-back" data-reference-match="1"><span class="ll-collapse-icon">${svg('chevronLeft','ll-ref-svg',14)}</span><span>Colapsar</span></button>
  </aside>`;
}
function clientRowHtml(a,selectedId){
  const active=String(a.borrower_id)===String(selectedId);
  const name=a.full_name||'Sin nombre';
  return `<div class="ll-client-card ll-elegant-client-row ${active?'active':''}" role="button" tabindex="0" aria-label="${esc(name)}" aria-current="${active?'true':'false'}" title="${esc(name)}" data-acct-borrower="${esc(a.borrower_id)}" data-client-search="${esc(name.toLowerCase())}">
    ${active?'<span class="ll-active-rail-indicator" aria-hidden="true"></span>':''}
    <div class="ll-client-avatar ll-initial-avatar" aria-hidden="true"><span class="ll-client-initials">${esc(initials(name))}</span></div>
    <div class="ll-client-copy"><div class="ll-client-name">${esc(name)}</div><div class="ll-client-balance">${money(a.principal_balance)}</div></div>
    <span class="ll-rail-badge ll-elegant-status ${tone(a.account_status)}"><i></i><span class="ll-dynamic-value" data-rail-status>${esc(statusLabel(a.account_status))}</span></span>
  </div>`;
}

function calendarHtml(context,data){
  const range=calendarRange(data),{start,dates}=calendarWindow(range);
  selectVisibleDate(range,dates);
  const selected=selectedCalendarRow(data,selectedDueIso);
  const balance=calendarBalance(data,selectedDueIso);
  const selectedStatus=dueStatus(selected);
  return `<div class="ll-cycle-calendar" data-calendar-context="${context}">
    <div class="ll-cycle-calendar-head">
      <div><h2 id="cpCalendarTitle">Calendario de cuotas</h2><small>Día 15 y último día del mes</small></div>
      <div class="cp-calendar-tools">
        <div class="cp-calendar-navigation">
          <div class="cp-calendar-actions">
            <button type="button" class="cp-action cp-quiet" data-open-installment-picker aria-haspopup="dialog">${svg('calendar')} Ver calendario</button>
            <button type="button" class="cp-action cp-quiet" data-calendar-current title="Volver al ${fmtDate(range.currentIso)}" ${calendarAtCurrent(range,start)?'disabled':''}>Cuota actual</button>
          </div>
          <div class="ll-cycle-calendar-nav">
            <button type="button" data-calendar-move="-2" aria-label="Fechas anteriores" ${start===0?'disabled':''}>${svg('chevronLeft','ll-ref-svg',13)}</button>
            <span data-calendar-range>${esc(monthRangeTitle(dates))}</span>
            <button type="button" data-calendar-move="2" aria-label="Fechas siguientes" ${start===range.lastStart?'disabled':''}>${svg('chevronRight','ll-ref-svg',13)}</button>
          </div>
        </div>
        <div class="cp-calendar-legend" aria-label="Estados de las cuotas"><span class="paid">Saldadas</span><span class="overdue">Atrasadas</span><span class="pending">Pendientes</span></div>
      </div>
    </div>
    <div class="ll-cycle-date-row" data-calendar-window="${dates.join(',')}">${calendarDateButtonsHtml(dates,data)}</div>
    <div class="ll-cycle-detail ll-cycle-detail--compact">
      <div><small>Monto total</small><strong class="ll-dynamic-value" data-calendar-slot="total">${calendarMoney(balance.total)}</strong></div>
      <div><small>Cuota pendiente</small><strong class="ll-dynamic-value" data-calendar-slot="pending">${calendarMoney(selected.amount_due)}</strong></div>
      <div><small>Monto atrasado</small><strong class="ll-dynamic-value" data-calendar-slot="arrears">${calendarMoney(balance.overdue)}</strong></div>
      <div><small>Estado de la cuota</small><span class="ll-status-pill ${tone(selectedStatus)} ll-dynamic-value" data-calendar-slot="status">${statusLabel(selectedStatus)}</span></div>
      <div><small>Vencimiento</small><strong class="ll-dynamic-value" data-calendar-slot="timing">${dueTiming(selectedDueIso)}</strong></div>
    </div>
    <p class="cp-calendar-note cp-calendar-equation">Monto total = cuota pendiente + atrasos anteriores vencidos.</p>
    <details class="cp-due-details"><summary><span>Ver detalle de la cuota <time data-calendar-detail-date datetime="${selectedDueIso}">${fmtDate(selectedDueIso)}</time></span>${svg('chevronDown')}</summary><div data-calendar-detail-body>${calendarDetailHtml(data,selectedDueIso)}</div></details>
  </div>`;
}
function calendarDatePresentation(iso,row){
  const status=dueStatus(row),state=tone(status);
  const label={PAID:'Saldada',OVERDUE:'Atrasada',ATRASADO:'Atrasada',DUE_TODAY:'Vence hoy',PARTIAL:'Parcial',CANCELLED:'Cancelada'}[status]||(state==='closed'?'Cerrada':'Pendiente');
  return {label,style:state==='ok'&&status!=='PAID'?'pending':state,description:`${fmtDate(iso)} · ${label} · Saldo de la cuota ${calendarMoney(row.amount_due)}`};
}
function calendarDateButtonsHtml(dates,data){
  return dates.map(iso=>{
    const date=parseIso(iso),{label,style,description}=calendarDatePresentation(iso,selectedCalendarRow(data,iso));
    return `<button type="button" class="ll-cycle-date ${iso===selectedDueIso?'selected':''} ${style}" data-calendar-date="${iso}" aria-pressed="${iso===selectedDueIso?'true':'false'}" aria-label="${esc(description)}"><strong>${date.getDate()}</strong><small>${date.toLocaleDateString('es',{month:'short'}).replace('.','').toUpperCase()}</small><span class="cp-date-status" aria-hidden="true">${label}</span></button>`;
  }).join('');
}

function movementEvents(data){
  return [
    ...data.payments.slice(0,5).map(row=>({id:row.id,date:row.paid_on,title:`${row.is_voided?'Pago anulado':'Pago recibido'} por ${money(row.amount)}`,detail:paymentTypeLabel(row.payment_type),kind:'payment',filter:'pagos'})),
    ...data.disbursements.slice(0,5).map(row=>({id:row.id,date:row.start_date,title:`Capital agregado: ${money(row.principal_original)}`,detail:`Balance actual ${money(row.principal_outstanding)}`,kind:'disbursement',filter:'desembolsos'})),
    ...data.contacts.slice(0,5).map(row=>({id:row.id,date:row.contact_date,title:row.outcome||'Contacto registrado',detail:row.notes||row.contact_type||'',kind:'note',filter:'notas'}))
  ].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
}
function movementsHtml(data){
  const events=movementEvents(data).filter(event=>movementFilter==='todos'||event.filter===movementFilter).slice(0,6);
  if(!events.length)return emptyState('Todavía no hay actividad en esta cuenta.');
  return `<div class="ll-activity-list ll-dynamic-list" data-list="movements">${events.map(event=>`<button type="button" data-activity-kind="${event.kind}" data-activity-record="${esc(event.id)}" data-movement-filter="${event.filter}" aria-label="${esc('Ver detalle: '+event.title)}" ${movementFilter!=='todos'&&movementFilter!==event.filter?'hidden':''}><span class="ll-activity-dot ll-movement-icon-${event.kind}">${svg(event.kind==='payment'?'payment':event.kind==='disbursement'?'disbursement':'note','ll-elegant-svg',16)}</span><span><strong>${esc(event.title)}</strong><small>${fmtDate(event.date)}</small>${event.detail?`<p>${esc(event.detail)}</p>`:''}</span><b>${svg('chevronRight','ll-elegant-svg',16)}</b></button>`).join('')}</div>`;
}
function movementFilterHtml(){return `<div class="ll-movement-filters">${[['todos','Todos'],['pagos','Pagos'],['desembolsos','Desembolsos'],['notas','Notas']].map(([key,label])=>`<button type="button" class="ll-movement-filter ${movementFilter===key?'active':''}" data-filter="${key}">${label}</button>`).join('')}</div>`;}

function paymentRowsHtml(rows){
  if(!rows.length)return emptyState('Todavía no hay pagos registrados.','payment','Registrar primer pago');
  return `<div class="cp-ledger-head cp-payment-columns" aria-hidden="true"><span>Fecha</span><span>Monto</span><span>Tipo de pago</span><span>Capital</span><span>Cuota/interés</span><span>Estado</span><span></span></div><div class="cp-record-list" data-list="payments">${rows.map(p=>`
    <details class="cp-record" data-profile-record="${esc(p.id)}" data-history-row="payments" data-payment-state="${p.is_voided?'voided':'active'}" data-history-search="${esc([p.paid_on,fmtDate(p.paid_on),p.amount,paymentTypeLabel(p.payment_type),p.notes,p.void_reason].join(' ').toLowerCase())}">
      <summary class="cp-payment-columns"><time datetime="${esc(p.paid_on)}">${fmtDate(p.paid_on)}</time><strong>${money(p.amount)}</strong><span>${esc(paymentTypeLabel(p.payment_type))}</span><span class="cp-row-amount">${money(p.applied_principal)}</span><span class="cp-row-amount">${money(p.applied_interest)}</span><span class="cp-record-state ${p.is_voided?'is-voided':'is-current'}">${p.is_voided?'Anulado':'Registrado'}</span><span class="cp-record-chevron">${svg('chevronDown')}</span></summary>
      <div class="cp-record-detail"><dl><div><dt>Abono a capital</dt><dd>${money(p.applied_principal)}</dd></div><div><dt>Cuota/interés</dt><dd>${money(p.applied_interest)}</dd></div><div><dt>Administración</dt><dd>${money(p.applied_mgmt)}</dd></div><div><dt>Socios</dt><dd>${money(p.applied_funders)}</dd></div><div><dt>Notas</dt><dd>${esc(p.notes||'Sin notas')}</dd></div>${p.void_reason?`<div><dt>Motivo de anulación</dt><dd>${esc(p.void_reason)}</dd></div>`:''}</dl>${p.is_voided?'':`<button type="button" class="cp-action cp-danger" data-void-payment="${esc(p.id)}">Anular pago</button>`}</div>
    </details>`).join('')}</div>`;
}
function disbursementRowsHtml(rows,canEdit=false){
  if(!rows.length)return emptyState('Todavía no hay desembolsos registrados.','disbursement','Crear desembolso');
  return `<div class="cp-ledger-head cp-loan-columns" aria-hidden="true"><span>Fecha de inicio</span><span>Desembolsado</span><span>Capital pendiente</span><span>Interés mensual</span><span>Estado</span><span></span></div><div class="cp-record-list" data-list="disbursements">${rows.map(row=>`
    <details class="cp-record" data-profile-record="${esc(row.id)}" data-history-row="disbursements" data-history-search="${esc([row.start_date,fmtDate(row.start_date),row.principal_original,row.principal_outstanding,statusLabel(row.status),row.notes,...(row.funding||[]).map(item=>item.partner_name)].join(' ').toLowerCase())}">
      <summary class="cp-loan-columns"><time datetime="${esc(row.start_date)}">${fmtDate(row.start_date)}</time><strong>${money(row.principal_original)}</strong><span class="cp-row-amount">${money(row.principal_outstanding)}</span><span>${(Number(row.monthly_rate_total||0)*100).toFixed(2)}%</span><span class="ll-status-pill ${tone(row.status)}">${esc(statusLabel(row.status))}</span><span class="cp-record-chevron">${svg('chevronDown')}</span></summary>
      <div class="cp-record-detail"><dl><div><dt>Capital pendiente</dt><dd>${money(row.principal_outstanding)}</dd></div><div><dt>Administración mensual</dt><dd>${(Number(row.monthly_rate_mgmt||0)*100).toFixed(2)}%</dd></div><div><dt>Distribución de inversión</dt><dd>${row.funding?.length?row.funding.map(item=>{
        const amount=item.contributed_amount==null?Number(row.principal_original)*Number(item.funding_percent):Number(item.contributed_amount);
        const percent=Number(row.principal_original)>0?amount/Number(row.principal_original)*100:0;
        return `${esc(item.partner_name)} ${money(amount)} (${percent.toFixed(2)}%)`;
      }).join(' · '):'Sin distribución visible'}</dd></div><div><dt>Notas</dt><dd>${esc(row.notes||'Sin notas')}</dd></div></dl>${canEdit&&row.status!=='VOIDED'?`<button type="button" class="cp-action cp-quiet" data-edit-contributions="${esc(row.id)}">Editar aportes</button>`:''}</div>
    </details>`).join('')}</div>`;
}
function followupRowsHtml(rows){
  if(!rows.length)return emptyState('Sin seguimientos pendientes.','followup','Programar seguimiento');
  const priority={NORMAL:'Normal',LOW:'Baja',HIGH:'Alta',URGENT:'Urgente'};
  const sorted=[...rows].sort((a,b)=>(a.status==='DONE')-(b.status==='DONE')||String(a.due_date).localeCompare(String(b.due_date)));
  return `<div class="cp-record-list" data-list="followups">${sorted.map(row=>`<article class="cp-followup-row"><div class="cp-date"><time datetime="${esc(row.due_date)}">${fmtDate(row.due_date)}</time><small>${row.status==='DONE'?'Completado':dueTiming(row.due_date)}</small></div><div class="cp-followup-copy"><strong>${esc(row.reason||'Seguimiento')}</strong><p>Prioridad ${esc(priority[row.priority]||row.priority||'Normal')}${row.loan_start_date?` · Desembolso del ${fmtDate(row.loan_start_date)}`:''}</p>${describeInstallmentLinks(row)?`<p>${esc(describeInstallmentLinks(row))}</p>`:''}${row.completed_notes?`<p>${esc(row.completed_notes)}</p>`:''}</div><div class="cp-followup-actions"><span class="ll-status-pill ${tone(row.status==='DONE'?'DONE':row.timing_status||row.status)}">${esc(statusLabel(row.status==='DONE'?'DONE':row.timing_status||row.status))}</span>${row.status==='DONE'?'':`<button type="button" class="cp-action cp-quiet" data-complete-followup="${esc(row.id)}">Completar</button>`}</div></article>`).join('')}</div>`;
}
function contactRowsHtml(rows){
  if(!rows.length)return emptyState('Todavía no hay notas ni contactos.','note','Agregar nota');
  const types={NOTE:'Nota',CALL:'Llamada',TEXT:'Texto',WHATSAPP:'WhatsApp',EMAIL:'Correo',IN_PERSON:'En persona',OTHER:'Otro'};
  return `<div class="cp-record-list" data-list="contacts">${rows.map(row=>`<details class="cp-record cp-contact-record" data-profile-record="${esc(row.id)}"><summary><span class="cp-date"><time datetime="${esc(row.contact_date)}">${fmtDate(row.contact_date)}</time><small>${esc(types[row.contact_type]||row.contact_type||'Nota')}</small></span><span class="cp-followup-copy"><strong>${esc(row.outcome||'Nota de contacto')}</strong><small>${esc(row.notes||'')}</small></span><span class="cp-record-chevron">${svg('chevronDown')}</span></summary><div class="cp-record-detail"><p>${esc(row.notes||'Sin notas')}</p>${describeInstallmentLinks(row)?`<p>${esc(describeInstallmentLinks(row))}</p>`:''}<small>Registrado por ${esc(row.created_by_name||'Usuario')}</small></div></details>`).join('')}</div>`;
}
function loanOptionsHtml(rows){return `<option value="">Cuenta general</option>${rows.map(row=>`<option value="${esc(row.id)}">${fmtDate(row.start_date)} · ${money(row.principal_outstanding)} · ${statusLabel(row.status)}</option>`).join('')}`;}
function profileFundingEditor(form,data=currentData){
  if(!fundingEditors.has(form)){
    const editor=attachFundingEditor(form.querySelector('#llProfileFundingRows'),{
      people:data.fundingPeople||[],preset:data.defaultFunding,total:()=>form.querySelector('#llProfilePrincipal').value});
    fundingEditors.set(form,editor);
  }
  return fundingEditors.get(form);
}
function profileContactDetails(a){
  const lines=[];
  if(a.additional_phones?.length)lines.push(['Teléfonos adicionales',a.additional_phones.join(' · ')]);
  if(a.emails?.length)lines.push(['Correos electrónicos',a.emails.join(' · ')]);
  const guarantor=[a.guarantor_name,a.guarantor_phone,a.guarantor_email].filter(Boolean);
  if(guarantor.length)lines.push(['Garante',guarantor.join(' · ')]);
  return lines.map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('');
}
function nextActionBodyHtml(data){
  const row=data.followups.find(item=>item.status!=='DONE');
  if(!row)return `<div class="cp-next-action"><span class="cp-subtle-status">${svg('check')} Sin pendientes</span><p>Programa un recordatorio cuando necesites retomar esta cuenta.</p><button type="button" class="cp-action cp-quiet" data-composer="followup">Programar seguimiento</button></div>`;
  return `<div class="cp-next-action"><span class="ll-status-pill ${tone(row.timing_status)}">${esc(statusLabel(row.timing_status||row.status))}</span><strong>${esc(row.reason)}</strong><p>${fmtDate(row.due_date)} · ${dueTiming(row.due_date)}</p><button type="button" class="cp-action cp-quiet" data-complete-followup="${esc(row.id)}">Marcar como completado</button></div>`;
}
function historyToolbar(kind,title,description,action,label){
  return `<div class="cp-panel-heading"><div><h2>${title}</h2><p>${description}</p></div><button type="button" class="cp-action" data-composer="${action}">${label}</button></div><div class="cp-history-tools"><label class="cp-search">${svg('search')}<input type="search" data-history-search-input="${kind}" placeholder="Buscar por fecha, monto o notas" aria-label="Buscar ${kind==='payments'?'pagos':'desembolsos'}"></label>${kind==='payments'?'<select data-payment-state-filter aria-label="Filtrar estado de pagos"><option value="all">Todos los pagos</option><option value="active">Registrados</option><option value="voided">Anulados</option></select>':'<button type="button" class="cp-text-action" data-open-tab="summary">Ver resumen</button>'}<span class="cp-result-count" data-history-count="${kind}"></span></div>`;
}
function composerHtml(data){
  const a=data.summary,suggested=Number(a.current_cycle_fee||a.current_monthly_fee||0);
  const totalRate=Number(data.defaults.default_total_monthly_rate??10),mgmtRate=Number(data.defaults.default_management_rate??3);
  return `<div class="cp-composer-overlay" data-close-composer hidden></div><aside class="cp-composer" role="dialog" aria-modal="true" aria-labelledby="cpComposerTitle" hidden>
    <header class="cp-composer-head"><div><p>Cuenta de <strong data-slot="composer-name">${esc(a.full_name)}</strong></p><h2 id="cpComposerTitle">Registrar pago</h2></div><button type="button" class="cp-close" data-close-composer aria-label="Cerrar panel">×</button></header>
    <div class="cp-composer-context"><span>Capital pendiente</span><strong data-slot="composer-balance">${money(a.principal_balance)}</strong></div><div class="cp-composer-body">
      <section data-composer-panel="client" hidden><form id="llProfileClientForm" class="ll-profile-form">
        ${clientFieldsMarkup()}
        <div id="llProfileClientStatus" class="ll-form-status" role="status"></div>
        <div class="cp-form-actions"><button type="button" class="cp-action" data-close-composer>Cancelar</button><button type="submit" class="ll-primary-btn cp-action cp-primary">Guardar cambios</button></div>
      </form></section>
      <section data-composer-panel="payment" hidden><form id="llProfilePaymentForm" class="ll-profile-form"><label>Monto<input id="llProfilePayAmount" type="number" min="0.01" step="0.01" value="${suggested?paymentAmount(suggested):''}" required></label><div class="ll-quick-profile-amounts">${quickAmountButtons(suggested,3,false)}</div><label>Fecha<input id="llProfilePayDate" type="date" value="${today()}" required></label><label>Tipo de pago<select id="llProfilePayType"><option value="INSTALLMENT">Pago de cuota/interés</option><option value="PRINCIPAL">Abono directo a capital</option><option value="MIXED">Mixto: cuota + abono al capital</option><option value="PAYOFF">Saldar capital</option></select></label>${mixedPaymentMarkup('llProfileMixed')}${paymentCalendarMarkup('llProfileCalendar')}${paymentDistributionMarkup()}<label>Notas<input id="llProfilePayNotes" placeholder="Notas opcionales"></label><p class="cp-form-help">Las cuotas cubren intereses. El capital solo se reduce con abonos, pagos mixtos o saldos.</p><div id="llProfilePayStatus" class="ll-form-status" role="status"></div><div class="cp-form-actions"><button type="button" class="cp-action" data-close-composer>Cancelar</button><button type="submit" class="ll-primary-btn cp-action cp-primary">Registrar pago</button></div></form></section>
      <section data-composer-panel="disbursement" hidden><form id="llProfileDisbursementForm" class="ll-profile-form"><label>Capital desembolsado<input id="llProfilePrincipal" type="number" min="0.01" max="9999999999.99" step="0.01" required></label><label>Fecha de inicio<input id="llProfileStartDate" type="date" value="${today()}" required></label><div class="ll-form-two"><label>Interés mensual total %<input id="llProfileTotalRate" type="number" min="0" step="0.01" value="${totalRate.toFixed(2)}" required></label><label>Administración %<input id="llProfileMgmtRate" type="number" min="0" step="0.01" value="${mgmtRate.toFixed(2)}" required></label></div><label>Notas<input id="llProfileDisbursementNotes" placeholder="Notas opcionales"></label><div id="llProfileFundingRows"></div><p class="cp-form-help">El capital se agrega a la cuenta y se recalculan las cuotas futuras.</p><div id="llProfileDisbursementStatus" class="ll-form-status" role="status"></div><div class="cp-form-actions"><button type="button" class="cp-action" data-close-composer>Cancelar</button><button type="submit" class="ll-primary-btn cp-action cp-primary" ${data.canManageFunding?'':'disabled'}>Guardar desembolso</button></div></form></section>
      <section data-composer-panel="note" hidden><form id="llProfileContactForm" class="ll-profile-form"><div class="ll-form-two"><label>Tipo<select id="llProfileContactType"><option value="NOTE">Nota</option><option value="CALL">Llamada</option><option value="TEXT">Texto</option><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">Correo</option><option value="IN_PERSON">En persona</option><option value="OTHER">Otro</option></select></label><label>Fecha<input id="llProfileContactDate" type="date" value="${today()}" required></label></div><label>Desembolso relacionado<select id="llProfileContactLoan">${loanOptionsHtml(data.disbursements)}</select></label>${installmentLinksMarkup()}<label>Resultado<input id="llProfileContactOutcome" placeholder="Ej.: prometió pagar el viernes"></label><label>Notas<textarea id="llProfileContactNotes" rows="4" required placeholder="Escribe la nota del contacto"></textarea></label><div id="llProfileContactStatus" class="ll-form-status" role="status"></div><div class="cp-form-actions"><button type="button" class="cp-action" data-close-composer>Cancelar</button><button type="submit" class="ll-primary-btn cp-action cp-primary">Guardar nota</button></div></form></section>
      <section data-composer-panel="followup" hidden><form id="llProfileFollowupForm" class="ll-profile-form"><div class="ll-form-two"><label>Fecha de seguimiento<input id="llProfileFollowupDate" type="date" value="${today()}" required></label><label>Prioridad<select id="llProfileFollowupPriority"><option value="NORMAL">Normal</option><option value="LOW">Baja</option><option value="HIGH">Alta</option><option value="URGENT">Urgente</option></select></label></div><label>Desembolso relacionado<select id="llProfileFollowupLoan">${loanOptionsHtml(data.disbursements)}</select></label>${installmentLinksMarkup()}<label>Motivo<textarea id="llProfileFollowupReason" rows="4" required placeholder="Motivo o recordatorio"></textarea></label><div id="llProfileFollowupStatus" class="ll-form-status" role="status"></div><div class="cp-form-actions"><button type="button" class="cp-action" data-close-composer>Cancelar</button><button type="submit" class="ll-primary-btn cp-action cp-primary">Crear seguimiento</button></div></form></section>
    </div>
  </aside>`;
}
function profileShellHtml(data,selectedId){
  const a=data.summary,next=nextDueRow(data),pending=data.followups.filter(row=>row.status!=='DONE').length;
  return `<div class="ll-account-shell ll-client-rail-collapsed ll-tabs-ready ll-elegant-profile ll-reference-match ll-client-hub" data-overdue="${Number(a.overdue_amount)>0?'1':'0'}" data-active-borrower="${esc(selectedId)}">
    ${clientRailHtml(selectedId)}<main class="ll-workspace" data-no-translate="true">
      <div class="ll-controller-loading-badge" aria-live="polite"><span class="ll-controller-loading-dot"></span><strong>Cargando...</strong></div>
      <div class="cp-masthead"><section class="ll-client-header">
        <div class="ll-avatar-xl ll-dynamic-value" data-slot="header-avatar">${esc(initials(a.full_name))}</div>
        <div class="ll-client-header-copy"><div class="ll-title-row"><h1 class="ll-client-title ll-dynamic-value" data-slot="header-name">${esc(a.full_name||'Cuenta del cliente')}</h1><span class="ll-status-pill ${tone(a.account_status)} ll-dynamic-value" data-slot="header-status">${esc(statusLabel(a.account_status))}</span></div><div class="ll-client-meta"><span>Teléfono: <b class="ll-dynamic-value" data-slot="header-phone">${esc(a.phone||'Sin teléfono')}</b></span><button type="button" class="cp-text-action" data-top-action="whatsapp">WhatsApp</button><button type="button" class="cp-text-action" data-composer="client"${data.canEditClient?'':' hidden'}>Editar cliente</button></div><div class="cp-client-notes" tabindex="0"${a.notes?.trim()?'':' hidden'}><strong>Notas del cliente:</strong> <span data-slot="header-notes">${esc(a.notes||'')}</span></div><details class="ll-flow-details cp-contact-details" hidden><summary>Más datos de contacto</summary><dl data-slot="contact-details"></dl></details></div>
        <div class="ll-action-row"><button class="ll-primary-btn cp-action cp-primary" type="button" id="llFocusPay" data-composer="payment">${svg('payment')} Registrar pago</button><button class="cp-action" type="button" data-composer="disbursement">Nuevo desembolso</button><details class="ll-more-actions"><summary aria-label="Más acciones">${svg('more')}</summary><div class="ll-more-menu"><button type="button" data-composer="note">Agregar nota o contacto</button><button type="button" data-composer="followup">Programar seguimiento</button></div></details></div>
      </section>
      <div class="ll-summary-stat-grid cp-kpis" aria-label="Resumen de la cuenta">
        ${metricCell('dollar','Capital pendiente',money(a.principal_balance),'Saldo actual','principal')}
        ${metricCell('cycle','Cuota por ciclo',money(a.current_cycle_fee),'15 y fin de mes','cycle-fee')}
        ${metricCell('clock','Total atrasado',money(a.overdue_amount),overdueCaption(a),'account-overdue','overdue-caption')}
        ${metricCell('calendar','Próxima cuota',fmtDate(next?.due_date),dueTiming(next?.due_date),'next-due','next-due-timing')}
      </div>
      <nav class="ll-tabs" role="tablist" aria-label="Información del cliente"><button type="button" class="ll-tab active" role="tab" aria-controls="cpSummaryPanel" data-profile-tab="summary">Resumen</button><button type="button" class="ll-tab" role="tab" aria-controls="cpPaymentsPanel" data-profile-tab="payments">Pagos <span class="cp-tab-count" data-slot="payments-count">${data.payments.length}</span></button><button type="button" class="ll-tab" role="tab" aria-controls="cpDisbursementsPanel" data-profile-tab="disbursements">Desembolsos <span class="cp-tab-count" data-slot="disbursements-count">${data.disbursements.length}</span></button><button type="button" class="ll-tab" role="tab" aria-controls="cpFollowupsPanel" data-profile-tab="followups">Notas y seguimientos <span class="cp-tab-count" data-slot="followups-count">${pending}</span></button></nav></div>
      <div class="cp-notice" role="status" hidden></div><div class="ll-profile-tabs-host cp-content" data-refinement-version="4">
        <section id="cpSummaryPanel" class="ll-profile-panel active" role="tabpanel" data-profile-panel="summary"><div class="cp-overview"><div class="cp-overview-main">
          <section class="cp-panel cp-section cp-calendar" aria-labelledby="cpCalendarTitle">${calendarHtml('summary',data)}</section><section class="cp-panel cp-section"><div class="cp-section-heading"><h2>Actividad reciente</h2>${movementFilterHtml()}</div><div class="ll-list-host" data-list-host="movements">${movementsHtml(data)}</div></section>
        </div><aside class="cp-overview-side"><section class="cp-panel cp-section"><div class="cp-section-heading"><h2>Información de la cuenta</h2></div><dl class="cp-account-facts"><div><dt>Total desembolsado</dt><dd data-slot="total-disbursed">${money(a.total_disbursed)}</dd></div><div><dt>Capital abonado</dt><dd data-slot="principal-paid">${money(a.total_principal_paid)}</dd></div><div><dt>Cuota mensual</dt><dd data-slot="monthly-fee">${money(a.current_monthly_fee)}</dd></div><div><dt>Desembolsos</dt><dd data-slot="disbursement-count">${a.disbursement_count||0}</dd></div></dl><button type="button" class="cp-text-action" data-open-tab="disbursements">Ver detalle de desembolsos ${svg('chevronRight')}</button></section><section class="cp-panel cp-section"><div class="cp-section-heading"><h2>Próximo seguimiento</h2></div><div class="ll-next-action-host" data-list-host="next-action">${nextActionBodyHtml(data)}</div></section></aside></div></section>
        <section id="cpPaymentsPanel" class="ll-profile-panel" role="tabpanel" data-profile-panel="payments"><div class="cp-panel cp-history-panel">${historyToolbar('payments','Historial de pagos','Consulta capital, intereses y distribución de cada pago.','payment','Registrar pago')}<div class="ll-list-host" data-list-host="payments">${paymentRowsHtml(data.payments)}</div><div class="cp-filter-empty" data-history-empty="payments" hidden>No hay pagos que coincidan con la búsqueda.</div></div></section>
        <section id="cpDisbursementsPanel" class="ll-profile-panel" role="tabpanel" data-profile-panel="disbursements"><div class="cp-panel cp-history-panel">${historyToolbar('disbursements','Desembolsos','Capital, saldo y condiciones de cada desembolso.','disbursement','Nuevo desembolso')}<div class="ll-list-host" data-list-host="disbursements">${disbursementRowsHtml(data.disbursements,data.canManageFunding)}</div><div class="cp-filter-empty" data-history-empty="disbursements" hidden>No hay desembolsos que coincidan con la búsqueda.</div></div></section>
        <section id="cpFollowupsPanel" class="ll-profile-panel" role="tabpanel" data-profile-panel="followups"><div class="cp-panel cp-followup-panel"><div class="cp-panel-heading"><div><h2>Notas y seguimientos</h2><p>Recordatorios pendientes e historial de contacto.</p></div><div class="cp-toolbar-actions"><button type="button" class="cp-action" data-composer="note">Agregar nota</button><button type="button" class="cp-action" data-composer="followup">Programar seguimiento</button></div></div><section class="cp-section"><div class="cp-section-heading"><h3>Seguimientos</h3><span class="cp-result-count" data-slot="pending-followups">${pending} pendientes</span></div><div class="ll-list-host" data-list-host="followups">${followupRowsHtml(data.followups)}</div></section><section class="cp-section"><div class="cp-section-heading"><h3>Notas y contactos</h3><span class="cp-result-count" data-slot="contacts-count">${data.contacts.length} registros</span></div><div class="ll-list-host" data-list-host="contacts">${contactRowsHtml(data.contacts)}</div></section></div></section>
      </div>
    </main>${composerHtml(data)}
  </div>`;
}

function quickAmountButtons(suggested,count,summary){
  const values=count===4?[suggested/2,suggested,suggested*2,suggested*4]:[suggested/2,suggested,suggested*2];
  return values.map((value,index)=>`<button type="button" class="ll-dynamic-value ${summary&&index===1?'active':''}" ${summary?'data-summary-amount':'data-profile-amount'}="${paymentAmount(value)}" ${value>0?'':'hidden'}>${money(value)}</button>`).join('');
}
function updateQuickAmounts(root,suggested,summary){
  const values=summary?[suggested/2,suggested,suggested*2,suggested*4]:[suggested/2,suggested,suggested*2];
  const selector=summary?'[data-summary-amount]':'[data-profile-amount]';
  [...root.querySelectorAll(selector)].forEach((button,index)=>{
    const value=values[index]||0;
    button.hidden=value<=0;
    if(summary)button.dataset.summaryAmount=String(paymentAmount(value));else button.dataset.profileAmount=String(paymentAmount(value));
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
  showTab(activeTab,false);
  syncContactAction(content.querySelector('.ll-account-shell'),data);
}

function transitionValue(element,nextText,nextClassName=null){
  if(!element)return Promise.resolve();
  const text=String(nextText??'');
  const sameText=element.textContent===text;
  const sameClass=nextClassName===null||element.className===nextClassName;
  if(sameText&&sameClass)return Promise.resolve();
  if(element.closest('.ll-summary-stat-grid,.ll-client-hub')){
    element.textContent=text;
    if(nextClassName!==null)element.className=nextClassName;
    return Promise.resolve();
  }
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
  if(profileListTemplates.get(host)===nextHtml)return Promise.resolve();
  profileListTemplates.set(host,nextHtml);
  if(host.closest('.ll-client-hub')){
    const open=new Set([...host.querySelectorAll('[data-profile-record][open]')].map(row=>row.dataset.profileRecord));
    host.innerHTML=nextHtml;
    host.querySelectorAll('[data-profile-record]').forEach(row=>{if(open.has(row.dataset.profileRecord))row.setAttribute('open','');});
    return Promise.resolve();
  }
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
  if(!root)return;
  const range=calendarRange(data),{start,dates}=calendarWindow(range);
  calendarOffset=start-range.baseStart;
  selectVisibleDate(range,dates);
  const jobs=[];
  root.querySelectorAll('.ll-cycle-calendar').forEach(calendar=>{
    const rowHost=calendar.querySelector('.ll-cycle-date-row'), windowKey=dates.join(',');
    if(rowHost.dataset.calendarWindow!==windowKey){
      rowHost.innerHTML=calendarDateButtonsHtml(dates,data);
      rowHost.dataset.calendarWindow=windowKey;
    }
    const title=calendar.querySelector('[data-calendar-range]'), monthRange=monthRangeTitle(dates);
    if(title.textContent!==monthRange)title.textContent=monthRange;
    calendar.querySelector('[data-calendar-move="-2"]').disabled=start===0;
    calendar.querySelector('[data-calendar-move="2"]').disabled=start===range.lastStart;
    const current=calendar.querySelector('[data-calendar-current]');
    current.disabled=calendarAtCurrent(range,start);
    current.title=`Volver al ${fmtDate(range.currentIso)}`;
    const buttons=[...calendar.querySelectorAll('[data-calendar-date]')];
    buttons.forEach(btn=>{
      const {label,style,description}=calendarDatePresentation(btn.dataset.calendarDate,selectedCalendarRow(data,btn.dataset.calendarDate));
      btn.classList.remove('ok','pending','danger','closed');
      btn.classList.add(style);
      btn.classList.toggle('selected',btn.dataset.calendarDate===selectedDueIso);
      btn.setAttribute('aria-pressed',btn.dataset.calendarDate===selectedDueIso?'true':'false');
      btn.setAttribute('aria-label',description);
      const badge=btn.querySelector('.cp-date-status');
      if(badge&&badge.textContent!==label)badge.textContent=label;
    });
    const {row,overdue,total}=calendarBalance(data,selectedDueIso),key=dueStatus(row);
    jobs.push(
      transitionValue(calendar.querySelector('[data-calendar-slot="total"]'),calendarMoney(total)),
      transitionValue(calendar.querySelector('[data-calendar-slot="pending"]'),calendarMoney(row.amount_due)),
      transitionValue(calendar.querySelector('[data-calendar-slot="arrears"]'),calendarMoney(overdue)),
      transitionValue(calendar.querySelector('[data-calendar-slot="status"]'),statusLabel(key),`ll-status-pill ${tone(key)} ll-dynamic-value`),
      transitionValue(calendar.querySelector('[data-calendar-slot="timing"]'),dueTiming(selectedDueIso))
    );
    const body=calendar.querySelector('[data-calendar-detail-body]'),nextHtml=calendarDetailHtml(data,selectedDueIso);
    if(body&&body.__calendarMarkup!==nextHtml){
      const open=new Set([...body.querySelectorAll('[data-payment-receipt][open]')].map(p=>p.dataset.paymentReceipt));
      body.innerHTML=nextHtml;body.__calendarMarkup=nextHtml;
      body.querySelectorAll('[data-payment-receipt]').forEach(p=>p.toggleAttribute('open',open.has(p.dataset.paymentReceipt)));
    }
    const date=calendar.querySelector('[data-calendar-detail-date]');if(date){date.dateTime=selectedDueIso;date.textContent=fmtDate(selectedDueIso);}
  });
  await Promise.all(jobs);
}

async function updateProfile(data,borrowerId){
  const root=document.querySelector('#borrowerAccountContent .ll-account-shell');
  if(!root)return;
  const a=data.summary,next=nextDueRow(data),suggested=Number(a.current_cycle_fee||a.current_monthly_fee||0);
  const clientChanged=String(root.dataset.activeBorrower)!==String(borrowerId);
  if(clientChanged){closeComposer(true,false);resetComposerForms(root,data);root.querySelector('.cp-due-details')?.removeAttribute('open');root.querySelectorAll('[data-history-search-input]').forEach(input=>input.value='');const filter=root.querySelector('[data-payment-state-filter]');if(filter)filter.value='all';const notice=root.querySelector('.cp-notice');if(notice)notice.hidden=true;}
  if(clientChanged){calendarOffset=0;selectedDueIso=null;}
  root.dataset.activeBorrower=String(borrowerId);
  root.dataset.overdue=Number(a.overdue_amount)>0?'1':'0';
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
    transitionValue(slot(root,'disbursement-count'),String(a.disbursement_count||0)),
    transitionValue(slot(root,'principal-paid'),money(a.total_principal_paid)),
    transitionValue(slot(root,'overdue-caption'),overdueCaption(a)),
    transitionValue(slot(root,'composer-name'),a.full_name||'Cuenta del cliente'),
    transitionValue(slot(root,'composer-balance'),money(a.principal_balance)),
    transitionValue(slot(root,'payments-count'),String(data.payments.length)),
    transitionValue(slot(root,'disbursements-count'),String(data.disbursements.length)),
    transitionValue(slot(root,'followups-count'),String(data.followups.filter(row=>row.status!=='DONE').length)),
    transitionValue(slot(root,'pending-followups'),`${data.followups.filter(row=>row.status!=='DONE').length} pendientes`),
    transitionValue(slot(root,'contacts-count'),`${data.contacts.length} registros`),
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
    transitionList(root.querySelector('[data-list-host="disbursements"]'),disbursementRowsHtml(data.disbursements,data.canManageFunding)),
    transitionList(root.querySelector('[data-list-host="followups"]'),followupRowsHtml(data.followups)),
    transitionList(root.querySelector('[data-list-host="contacts"]'),contactRowsHtml(data.contacts))
  ];

  updateQuickAmounts(root,suggested,true);
  updateQuickAmounts(root,suggested,false);
  const quickInput=root.querySelector('#llSummaryPayAmount');if(quickInput)quickInput.value=suggested?paymentAmount(suggested):'';
  const payInput=root.querySelector('#llProfilePayAmount');if(payInput&&(clientChanged||payInput.closest('form')?.dataset.dirty!=='1'))payInput.value=suggested?paymentAmount(suggested):'';
  const options=loanOptionsHtml(data.disbursements);
  [root.querySelector('#llProfileContactLoan'),root.querySelector('#llProfileFollowupLoan')].forEach(select=>{if(!select)return;const value=select.value;select.innerHTML=options;if([...select.options].some(option=>option.value===value))select.value=value;});

  await Promise.all(jobs);
  profileMixedSplit()?.refresh({force:true});
  if(!root.querySelector('.cp-composer')?.hidden&&!root.querySelector('[data-composer-panel="payment"]')?.hidden)profilePaymentCalendar()?.refresh({force:true});
  updateActiveRail(borrowerId,data.summary);
  applyMovementFilter(root,movementFilter);
  applyHistoryFilters(root);
  syncContactAction(root,data);
}

function updateActiveRail(borrowerId,summary=null){
  const root=document.querySelector('#borrowerAccountContent .ll-account-shell');
  if(!root)return;
  root.querySelectorAll('.ll-client-card').forEach(card=>{
    const active=String(card.dataset.acctBorrower)===String(borrowerId);
    card.classList.toggle('active',active);
    card.setAttribute('aria-current',active?'true':'false');
    card.querySelector('.ll-active-rail-indicator')?.remove();
    if(active){const indicator=document.createElement('span');indicator.className='ll-active-rail-indicator';indicator.setAttribute('aria-hidden','true');card.prepend(indicator);}
  });
  const card=root.querySelector(`.ll-client-card[data-acct-borrower="${CSS.escape(String(borrowerId))}"]`);
  if(card&&summary){
    const name=summary.full_name||'Sin nombre';
    card.setAttribute('aria-label',name);
    card.title=name;
    card.dataset.clientSearch=name.toLowerCase();
    transitionValue(card.querySelector('.ll-client-name'),name);
    transitionValue(card.querySelector('.ll-client-initials'),initials(name));
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
  profileCalendarPanel?.close(true,false);
  closeComposer(true,false);
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

function showTab(key,resetScroll=true){
  const root=document.querySelector('#borrowerAccountContent .ll-account-shell');
  if(!root)return;
  if(![...root.querySelectorAll('[data-profile-panel]')].some(panel=>panel.dataset.profilePanel===key))return;
  activeTab=key;
  root.querySelectorAll('.ll-tab').forEach(tab=>{const active=tab.dataset.profileTab===key;tab.id=`cpTab-${tab.dataset.profileTab}`;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',active?'true':'false');tab.tabIndex=active?0:-1;});
  root.querySelectorAll('[data-profile-panel]').forEach(panel=>{const active=panel.dataset.profilePanel===key;panel.classList.toggle('active',active);panel.hidden=!active;panel.setAttribute('aria-labelledby',`cpTab-${panel.dataset.profilePanel}`);});
  // Only the inner workspace scrolls; scrolling a panel into view also moves
  // overflow-hidden ancestors and pushes both client navigation and content up.
  if(resetScroll){const workspace=root.querySelector('.cp-content')||root.querySelector('.ll-workspace');if(workspace)workspace.scrollTop=0;}
  applyHistoryFilters(root);
}
function focusProfileControl(root,selector){
  const control=root.querySelector(selector);
  if(!control)return;
  const fixed=window.matchMedia('(min-width:900px)').matches;
  control.focus({preventScroll:fixed});
  const workspace=control.closest('.cp-content,.ll-workspace');
  if(!fixed||!workspace)return;
  const target=control.getBoundingClientRect(),viewport=workspace.getBoundingClientRect();
  if(target.top<viewport.top||target.bottom>viewport.bottom)workspace.scrollTop+=target.top-viewport.top-24;
}
function applyMovementFilter(root,filter){
  movementFilter=filter;
  if(currentData&&root.classList.contains('ll-client-hub'))transitionList(root.querySelector('[data-list-host="movements"]'),movementsHtml(currentData));
  root.querySelectorAll('[data-movement-filter]').forEach(row=>row.hidden=filter!=='todos'&&row.dataset.movementFilter!==filter);
  root.querySelectorAll('.ll-movement-filter').forEach(btn=>btn.classList.toggle('active',btn.dataset.filter===filter));
}
function applyHistoryFilters(root){
  if(!root)return;
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  for(const kind of ['payments','disbursements']){
    const input=root.querySelector(`[data-history-search-input="${kind}"]`);
    const query=normalize(input?.value.trim());
    const state=kind==='payments'?(root.querySelector('[data-payment-state-filter]')?.value||'all'):'all';
    const rows=[...root.querySelectorAll(`[data-history-row="${kind}"]`)];
    let count=0;
    rows.forEach(row=>{row.hidden=!!query&&!normalize(row.dataset.historySearch).includes(query)||state!=='all'&&row.dataset.paymentState!==state;if(!row.hidden)count++;});
    const empty=root.querySelector(`[data-history-empty="${kind}"]`);if(empty)empty.hidden=!rows.length||count>0;
    const result=root.querySelector(`[data-history-count="${kind}"]`);if(result)result.textContent=`${count} de ${rows.length} ${kind==='payments'?'pagos':'desembolsos'}`;
  }
}
function syncContactAction(root,data){
  const action=root?.querySelector('[data-top-action="whatsapp"]');
  if(action)action.hidden=!String(data?.summary?.phone||'').replace(/\D/g,'');
  const edit=root?.querySelector('[data-composer="client"]');
  if(edit)edit.hidden=!data?.canEditClient;
  const details=root&&slot(root,'contact-details');
  if(details){
    const html=profileContactDetails(data.summary);
    if(details.dataset.markup!==html){details.innerHTML=html;details.dataset.markup=html;}
    details.parentElement.hidden=!html;
  }
  const notes=root&&slot(root,'header-notes');
  if(notes){
    const value=data?.summary?.notes||'';
    notes.textContent=value;
    notes.parentElement.hidden=!value.trim();
  }
}
function resetComposerForms(root,data,form=null){
  const scope=form||root.querySelector('.cp-composer');
  if(!scope)return;
  [scope,...scope.querySelectorAll('form')].forEach(node=>{if(node.tagName==='FORM')delete node.dataset.dirty;});
  scope.querySelectorAll('input,textarea').forEach(input=>{
    input.value=input.type==='date'?today():'';
  });
  const defaults={'#llProfilePayType':'INSTALLMENT','#llProfileContactType':'NOTE','#llProfileContactLoan':'','#llProfileFollowupLoan':'','#llProfileFollowupPriority':'NORMAL'};
  Object.entries(defaults).forEach(([selector,value])=>{const input=scope.querySelector(selector);if(input)input.value=value;});
  for(const [id,value] of [['llProfileTotalRate',data.defaults.default_total_monthly_rate??10],['llProfileMgmtRate',data.defaults.default_management_rate??3]]){const input=scope.querySelector(`#${id}`);if(input)input.value=Number(value).toFixed(2);}
  const amount=scope.querySelector('#llProfilePayAmount'),suggested=Number(data.summary.current_cycle_fee||data.summary.current_monthly_fee||0);if(amount)amount.value=suggested?paymentAmount(suggested):'';
  const funding=scope.querySelector('#llProfileFundingRows');
  if(funding){funding.replaceChildren();fundingEditors.delete(funding.closest('form'));}
  const submit=scope.querySelector('#llProfileDisbursementForm button[type="submit"]');if(submit)submit.disabled=!data.canManageFunding;
  scope.querySelectorAll('[data-installment-links]').forEach(host=>attachInstallmentLinks(host,{load:id=>borrowerInstallmentRows(db,id)})?.reset());
  if(scope.querySelector('[data-payment-calendar]')){profilePaymentCalendar()?.reset();profilePaymentDistribution()?.reset();}
  scope.querySelectorAll('.ll-form-status').forEach(status=>{status.textContent='';status.classList.remove('error');});
  if(scope.querySelector('[data-mixed-payment]'))profileMixedSplit()?.reset();
}
function profileMixedSplit(){
  const form=document.getElementById('llProfilePaymentForm'),host=form?.querySelector('[data-mixed-payment]');
  return attachMixedPaymentSplit(host,{
    readPayment:()=>({borrowerId:currentBorrowerId,paidOn:form.querySelector('#llProfilePayDate').value,
      amount:Number(form.querySelector('#llProfilePayAmount').value||0),type:form.querySelector('#llProfilePayType').value,
      targeted:(form.querySelector('[data-pcal-target]')?.value||'oldest')!=='oldest'}),
    loadContext:async(borrowerId,paidOn)=>{
      const local=String(borrowerId)===String(currentBorrowerId)?mixedContextFromCalendar(currentData,paidOn):null;
      if(local)return local;
      const {data,error}=await db.rpc('get_borrower_mixed_payment_context',{p_borrower_id:borrowerId,p_paid_on:paidOn});
      if(error)throw error;return data;
    }
  });
}
function profilePaymentDraft(form){
  return {borrowerId:currentBorrowerId,paidOn:form.querySelector('#llProfilePayDate').value,
    amount:Number(form.querySelector('#llProfilePayAmount').value||0),type:form.querySelector('#llProfilePayType').value,
    installment:Number(form.querySelector('#llProfileMixedInstallment')?.value||0)};
}
function profilePaymentDistribution(){
  const form=document.getElementById('llProfilePaymentForm');
  return attachPaymentDistribution(form?.querySelector('[data-payment-distribution]'),{db,readPayment:()=>profilePaymentDraft(form)});
}
function profilePaymentCalendar(){
  const form=document.getElementById('llProfilePaymentForm');
  return attachPaymentCalendar(form?.querySelector('[data-payment-calendar]'),{
    readPayment:()=>profilePaymentDraft(form),
    loadCalendar:async(borrowerId,paidOn)=>{
      const end=paymentCalendarEnd(paidOn);
      if(currentData&&borrowerId===String(currentBorrowerId)&&(currentData.calendarRows.at(-1)?.due_date||'')>=end)
        return {rows:currentData.calendarRows,as_of_date:currentData.calendarAsOf};
      const {data,error}=await db.rpc('get_borrower_calendar_workspace',{p_borrower_id:borrowerId,p_end_date:end});
      if(error)throw error;return data;
    }
  });
}
async function updateProfilePaymentPreview({force=false}={}){
  profilePaymentDistribution()?.refresh();
  await profileMixedSplit()?.refresh({force});
  profilePaymentCalendar()?.refresh({force});
}
function openComposer(kind,trigger=null){
  const root=document.querySelector('#borrowerAccountContent .ll-account-shell');
  const drawer=root?.querySelector('.cp-composer'),panel=drawer?.querySelector(`[data-composer-panel="${kind}"]`);
  if(!drawer||!panel||root.querySelector('.ll-controller-loading-badge.visible'))return;
  if(panel.querySelector('form')?.dataset.saving==='1')return;
  if(kind==='client'){
    if(!currentData?.canEditClient)return;
    clientFields(panel.querySelector('form')).set(currentData.summary);
    setStatus('llProfileClientStatus','');
  }
  if(kind==='disbursement'){
    if(!currentData?.canManageFunding){announceProfile('Solo un administrador puede registrar desembolsos.');return;}
    profileFundingEditor(panel.querySelector('form'));
  }
  if(kind==='note'||kind==='followup')attachInstallmentLinks(panel.querySelector('[data-installment-links]'),
    {load:id=>borrowerInstallmentRows(db,id)})?.set(currentBorrowerId,currentData.calendarRows);
  drawer.querySelector('.cp-composer-context').hidden=kind==='client';
  const titles={client:'Editar cliente',payment:'Registrar pago',disbursement:'Nuevo desembolso',note:'Agregar nota o contacto',followup:'Programar seguimiento'};
  drawer.querySelector('#cpComposerTitle').textContent=titles[kind];
  drawer.querySelectorAll('[data-composer-panel]').forEach(item=>item.hidden=item!==panel);
  root.querySelectorAll('.ll-more-actions').forEach(menu=>menu.removeAttribute('open'));
  drawer.hidden=false;root.querySelector('.cp-composer-overlay').hidden=false;root.classList.add('cp-composer-open');
  composerTrigger=trigger;
  const backgrounds=[root.querySelector('.ll-workspace'),root.querySelector('.ll-client-rail'),document.getElementById('llGlobalSidebar')].filter(Boolean);
  if(!composerBackgrounds.length){composerBackgrounds=backgrounds.map(node=>({node,inert:node.hasAttribute('inert')}));backgrounds.forEach(node=>node.setAttribute('inert',''));}
  drawer.querySelector('.cp-composer-body').scrollTop=0;
  const focus={client:'[name="full_name"]',payment:'#llProfilePayAmount',disbursement:'#llProfilePrincipal',note:'#llProfileContactNotes',followup:'#llProfileFollowupReason'};
  panel.querySelector(focus[kind])?.focus({preventScroll:true});
  if(kind==='payment')updateProfilePaymentPreview({force:true});
}
function closeComposer(force=false,restoreFocus=true){
  const root=document.querySelector('#borrowerAccountContent .ll-account-shell'),drawer=root?.querySelector('.cp-composer');
  const wasOpen=drawer&&!drawer.hidden;
  if(!force&&drawer?.querySelector('form[data-saving="1"]'))return false;
  if(drawer){drawer.hidden=true;root.querySelector('.cp-composer-overlay').hidden=true;root.classList.remove('cp-composer-open');}
  composerBackgrounds.forEach(({node,inert})=>{if(!inert)node.removeAttribute('inert');});composerBackgrounds=[];
  if(restoreFocus&&wasOpen)(composerTrigger?.isConnected?composerTrigger:root.querySelector('.ll-tab.active'))?.focus({preventScroll:true});
  composerTrigger=null;return true;
}
function announceProfile(message,retry=false){
  const notice=document.querySelector('#borrowerAccountContent .cp-notice');
  if(notice){
    notice.textContent=message;notice.hidden=false;
    if(retry){const button=document.createElement('button');button.type='button';button.className='cp-text-action';button.dataset.refreshProfile='1';button.textContent='Actualizar cuenta';notice.appendChild(button);}
  }
}

async function moveCalendar(direction){
  if(!currentData)return;
  calendarOffset+=Number(direction||0);
  await updateCalendars(document.querySelector('#borrowerAccountContent .ll-account-shell'),currentData);
}
async function chooseCalendarDate(iso,{current=false}={}){
  if(!currentData)return;
  const root=document.querySelector('#borrowerAccountContent .ll-account-shell');
  const range=calendarRange(currentData),target=current?range.currentIso:iso,index=range.all.indexOf(target);
  if(!root||index<0)return;
  if(current)calendarOffset=0;
  else if(!calendarWindow(range).dates.includes(target)){
    calendarOffset=Math.max(0,index-1)-range.baseStart;
  }
  selectedDueIso=target;
  await updateCalendars(root,currentData);
  return target;
}
async function jumpCalendar(root,iso,options){
  const target=await chooseCalendarDate(iso,options);
  if(target)focusProfileControl(root,`[data-calendar-date="${target}"]`);
}
function openProfileCalendar(root,trigger){
  if(!currentData)return;
  const borrowerId=currentBorrowerId;
  profileCalendarPanel=openClientInstallmentPicker({
    rows:currentData.calendarRows, selectedIso: selectedDueIso, asOf: calendarRange(currentData).asOf,
    borrowerName:currentData.summary.full_name||'Cuenta del cliente', describeDate:calendarDatePresentation, trigger,
    onClose:()=>{profileCalendarPanel=null;},
    onSelect:iso=>{if(currentBorrowerId===borrowerId)jumpCalendar(root,iso);}
  });
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
  if(!['llProfileClientForm','llSummaryQuickPayForm','llProfilePaymentForm','llProfileContactForm','llProfileFollowupForm','llProfileDisbursementForm'].includes(form.id))return;
  event.preventDefault();
  if(form.dataset.saving==='1')return;
  const submit=form.querySelector('button[type="submit"]'),wasDisabled=submit?.disabled;
  form.dataset.saving='1';form.setAttribute('aria-busy','true');if(submit)submit.disabled=true;
  try{
    if(form.id==='llProfileClientForm'){
      const root=form.closest('.ll-account-shell'),borrowerId=currentBorrowerId;
      if(!borrowerId||!currentData?.canEditClient||root.dataset.activeBorrower!==String(borrowerId))return;
      const status='llProfileClientStatus';
      const fields=clientFields(form).values();
      setStatus(status,'Guardando cambios…');
      const {data:saved,error}=await db.from('borrowers').update(fields).eq('id',borrowerId).select(CLIENT_FIELDS).single();
      if(error||!saved){
        if(String(currentBorrowerId)===String(borrowerId))setStatus(status,'No se pudo guardar la información del cliente.',true);
        return;
      }
      publishClientChange(saved);
      if(String(currentBorrowerId)===String(borrowerId)&&root.isConnected&&!root.querySelector('.cp-composer').hidden){
        currentData={...currentData,summary:{...currentData.summary,...saved}};
        const summary=currentData.summary;
        transitionValue(slot(root,'header-name'),summary.full_name);
        transitionValue(slot(root,'header-avatar'),initials(summary.full_name));
        transitionValue(slot(root,'header-phone'),summary.phone||'Sin teléfono');
        transitionValue(slot(root,'composer-name'),summary.full_name);
        syncContactAction(root,currentData);
        updateActiveRail(borrowerId,summary);
        closeComposer(true);
        announceProfile('Información del cliente actualizada.');
      }
      return;
    }
    if(form.id==='llSummaryQuickPayForm'||form.id==='llProfilePaymentForm'){
      const summary=form.id==='llSummaryQuickPayForm';
      const amount=Number(form.querySelector(summary?'#llSummaryPayAmount':'#llProfilePayAmount')?.value||0);
      const paid_on=summary?today():form.querySelector('#llProfilePayDate')?.value;
      const payment_type=summary?'INSTALLMENT':form.querySelector('#llProfilePayType')?.value||'INSTALLMENT';
      const notes=summary?'Pago rápido desde el resumen':form.querySelector('#llProfilePayNotes')?.value.trim()||null;
      const statusId=summary?'llSummaryPayStatus':'llProfilePayStatus';
      if(!amount||!paid_on)return setStatus(statusId,'Fecha y monto son requeridos.',true);
      setStatus(statusId,'Aplicando pago...');
      const borrowerId=currentBorrowerId;
      let parts,dueDates,partnerSplit;
      try{
        if(payment_type==='MIXED')parts=await profileMixedSplit().values();
        if(!summary){
          const installment=parts?.installment??(payment_type==='INSTALLMENT'?amount:0);
          dueDates=await profilePaymentCalendar()?.values(installment);
          partnerSplit=await profilePaymentDistribution()?.values(installment);
          const draft=profilePaymentDraft(form);
          if(draft.borrowerId!==borrowerId||draft.paidOn!==paid_on||draft.amount!==amount||draft.type!==payment_type||
            (parts&&draft.installment!==installment))throw new Error('El pago cambió. Revisa los datos y vuelve a guardarlo.');
        }
      }catch(error){return setStatus(statusId,error.message||String(error),true);}
      const {error}=await db.rpc('record_borrower_payment',{
        p_borrower_id:borrowerId,p_paid_on:paid_on,p_amount:amount,p_payment_type:payment_type,p_notes:notes,
        p_installment_amount:parts?.installment??null,p_principal_amount:parts?.principal??null,
        p_due_dates:dueDates??null,p_partner_split:partnerSplit??null});
      if(error)return setStatus(statusId,error.message,true);
      setStatus(statusId,'Pago registrado correctamente.');
    }else if(form.id==='llProfileContactForm'){
      const date=form.querySelector('#llProfileContactDate')?.value,notes=form.querySelector('#llProfileContactNotes')?.value.trim();
      if(!date||!notes)return setStatus('llProfileContactStatus','Fecha y notas son requeridas.',true);
      setStatus('llProfileContactStatus','Guardando nota...');
      const {error}=await db.from('borrower_contact_log').insert({borrower_id:currentBorrowerId,loan_id:form.querySelector('#llProfileContactLoan')?.value||null,contact_date:date,contact_type:form.querySelector('#llProfileContactType')?.value||'NOTE',outcome:form.querySelector('#llProfileContactOutcome')?.value.trim()||null,notes,...readInstallmentLinkFields(form),created_by:await currentUserId()});
      if(error)return setStatus('llProfileContactStatus',error.message,true);
      setStatus('llProfileContactStatus','Nota guardada.');
    }else if(form.id==='llProfileFollowupForm'){
      const date=form.querySelector('#llProfileFollowupDate')?.value,reason=form.querySelector('#llProfileFollowupReason')?.value.trim();
      if(!date||!reason)return setStatus('llProfileFollowupStatus','Fecha y motivo son requeridos.',true);
      setStatus('llProfileFollowupStatus','Creando seguimiento...');
      const {error}=await db.from('borrower_followups').insert({borrower_id:currentBorrowerId,loan_id:form.querySelector('#llProfileFollowupLoan')?.value||null,due_date:date,priority:form.querySelector('#llProfileFollowupPriority')?.value||'NORMAL',reason,...readInstallmentLinkFields(form),created_by:await currentUserId()});
      if(error)return setStatus('llProfileFollowupStatus',error.message,true);
      setStatus('llProfileFollowupStatus','Seguimiento creado.');
    }else{
      const status='llProfileDisbursementStatus';
      if(!currentData?.canManageFunding)return setStatus(status,'Solo un administrador puede registrar desembolsos.',true);
      const rate=selector=>Number((Number(form.querySelector(selector).value)/100).toFixed(4));
      let contributions;
      try{contributions=profileFundingEditor(form).values();}catch(error){return setStatus(status,error.message,true);}
      setStatus(status,'Guardando desembolso…');
      const {error}=await db.rpc('create_funded_disbursement',{
        p_borrower_id:currentBorrowerId,p_start_date:form.querySelector('#llProfileStartDate').value,
        p_principal:Number(form.querySelector('#llProfilePrincipal').value),p_rate_total:rate('#llProfileTotalRate'),
        p_rate_mgmt:rate('#llProfileMgmtRate'),p_notes:form.querySelector('#llProfileDisbursementNotes').value.trim()||null,
        p_contributions:contributions});
      if(error)return setStatus(status,error.message,true);
      setStatus('llProfileDisbursementStatus','Desembolso guardado.');
    }
    invalidatePageReads();
    announceProfile({llProfilePaymentForm:'Pago registrado.',llProfileContactForm:'Nota guardada.',llProfileFollowupForm:'Seguimiento creado.',llProfileDisbursementForm:'Desembolso guardado.'}[form.id]||'Registro guardado.');
    try{await refreshCurrent();}catch(error){console.error('saved profile refresh failed',error);announceProfile('El registro se guardó, pero no se pudo actualizar la cuenta.',true);showLoadingBadge(false);}
    const root=document.querySelector('#borrowerAccountContent .ll-account-shell');if(root&&currentData)resetComposerForms(root,currentData,form);
    closeComposer(true);
  }catch(error){
    console.error('client profile action failed',error);
    if(form.id==='llProfileClientForm')setStatus('llProfileClientStatus',error.message||'No se pudo guardar la información del cliente.',true);
    else alert(error.message||error);
  }
  finally{delete form.dataset.saving;form.removeAttribute('aria-busy');if(submit)submit.disabled=!!wasDisabled;}
}

async function handleClick(event){
  const root=event.currentTarget;
  const retry=event.target.closest('[data-refresh-profile]');
  if(retry){
    event.preventDefault();retry.disabled=true;
    try{await refreshCurrent();announceProfile('Cuenta actualizada.');}catch(error){console.error('profile retry failed',error);showLoadingBadge(false);announceProfile('No se pudo actualizar la cuenta. Inténtalo de nuevo.',true);}
    return;
  }
  if(event.target.closest('[data-close-composer]')){event.preventDefault();closeComposer();return;}
  const funding=event.target.closest('[data-edit-contributions]');
  if(funding&&currentData?.canManageFunding){
    const loan=currentData.disbursements.find(row=>String(row.id)===funding.dataset.editContributions);
    if(loan)openFundingEditor(db,{loan:{...loan,borrower_id:currentBorrowerId},people:currentData.fundingPeople,trigger:funding});
    return;
  }
  const composer=event.target.closest('[data-composer]');if(composer){event.preventDefault();openComposer(composer.dataset.composer,composer);return;}
  const activity=event.target.closest('[data-activity-record]');
  if(activity&&currentData){
    event.preventDefault();
    const kind=activity.dataset.activityKind,records={payment:currentData.payments,disbursement:currentData.disbursements,note:currentData.contacts};
    openActivityDetails({kind,id:activity.dataset.activityRecord,record:records[kind]?.find(row=>String(row.id)===activity.dataset.activityRecord),borrowerName:currentData.summary.full_name});return;
  }
  if(event.target.closest('[data-split-reset]')){updateProfilePaymentPreview();return;}
  if(event.target.closest('[data-expand-client-rail]')){event.preventDefault();if(root.classList.contains('ll-client-rail-collapsed'))root.querySelector('#acctBack')?.click();root.querySelector('.ll-controller-search')?.click();return;}
  const client=event.target.closest('.ll-client-card[data-acct-borrower]');
  if(client){event.preventDefault();selectClient(client.dataset.acctBorrower);return;}
  const tab=event.target.closest('.ll-tab[data-profile-tab]');if(tab){showTab(tab.dataset.profileTab);return;}
  const open=event.target.closest('[data-open-tab]');if(open){showTab(open.dataset.openTab);return;}
  const top=event.target.closest('[data-top-action]');if(top){
    const action=top.dataset.topAction;
    if(action==='disbursement'){showTab('disbursements');setTimeout(()=>focusProfileControl(root,'#llProfilePrincipal'),80);}
    if(action==='note'){showTab('followups');setTimeout(()=>focusProfileControl(root,'#llProfileContactNotes'),80);}
    if(action==='whatsapp'){const phone=String(currentData?.summary?.phone||'').replace(/\D/g,'');if(!phone)return alert('Este cliente no tiene un teléfono registrado.');window.open(`https://wa.me/${phone}`,'_blank','noopener,noreferrer');}
    return;
  }
  if(event.target.closest('#llFocusPay')){showTab('payments');setTimeout(()=>focusProfileControl(root,'#llProfilePayAmount'),80);return;}
  const calendarPicker=event.target.closest('[data-open-installment-picker]');if(calendarPicker){openProfileCalendar(root,calendarPicker);return;}
  if(event.target.closest('[data-calendar-current]')){await jumpCalendar(root,null,{current:true});return;}
  const move=event.target.closest('[data-calendar-move]');if(move){event.preventDefault();moveCalendar(move.dataset.calendarMove);return;}
  const date=event.target.closest('[data-calendar-date]');if(date){event.preventDefault();chooseCalendarDate(date.dataset.calendarDate);return;}
  const jump=event.target.closest('[data-calendar-jump]');if(jump){event.preventDefault();await jumpCalendar(root,jump.dataset.calendarJump);return;}
  const filter=event.target.closest('.ll-movement-filter');if(filter){applyMovementFilter(root,filter.dataset.filter);return;}
  const summaryAmount=event.target.closest('[data-summary-amount]');if(summaryAmount){root.querySelectorAll('[data-summary-amount]').forEach(btn=>btn.classList.remove('active'));summaryAmount.classList.add('active');const input=root.querySelector('#llSummaryPayAmount');if(input)input.value=summaryAmount.dataset.summaryAmount;return;}
  const profileAmount=event.target.closest('[data-profile-amount]');if(profileAmount){const input=root.querySelector('#llProfilePayAmount');if(input){input.value=profileAmount.dataset.profileAmount;input.closest('form').dataset.dirty='1';}updateProfilePaymentPreview();return;}
  const complete=event.target.closest('[data-complete-followup]');if(complete){const note=prompt('Nota de finalización (opcional):','');if(note===null)return;const {error}=await db.rpc('complete_followup',{p_followup_id:complete.dataset.completeFollowup,p_completed_notes:note.trim()||null});if(error)return alert(error.message);invalidatePageReads();await refreshCurrent();return;}
  const voidButton=event.target.closest('[data-void-payment]');
  if(voidButton){
    const borrowerId=currentBorrowerId;
    const paymentId=voidButton.dataset.voidPayment;
    const reason=await choosePaymentVoidReason(voidButton);
    if(!reason||!voidButton.isConnected||currentBorrowerId!==borrowerId)return;
    voidButton.disabled=true;
    try{
      const {error}=await db.rpc('void_payment',{p_payment_id:paymentId,p_reason:reason});
      if(error)return alert(error.message);
      invalidatePageReads();
      await refreshCurrent();
    }finally{voidButton.disabled=false;}
    return;
  }
  const search=event.target.closest('.ll-controller-search');if(search){const wrap=root.querySelector('.ll-client-search-wrap');if(wrap){wrap.hidden=!wrap.hidden;if(!wrap.hidden)setTimeout(()=>focusProfileControl(root,'.ll-client-search-input'),0);}return;}
}
function handleInput(event){
  const form=event.target.closest('.cp-composer form');if(form)form.dataset.dirty='1';
  if(['llProfilePayAmount','llProfilePayType','llProfilePayDate'].includes(event.target.id)||event.target.matches('[data-split-part]'))updateProfilePaymentPreview();
  if(event.target.matches('[data-history-search-input],[data-payment-state-filter]'))applyHistoryFilters(event.currentTarget);
  if(event.target.matches('.ll-client-search-input')){const q=event.target.value.trim().toLowerCase();document.querySelectorAll('#borrowerAccountContent .ll-client-card').forEach(card=>card.hidden=!!q&&!String(card.dataset.clientSearch||'').includes(q));}
  if(event.target.id==='llProfilePrincipal'&&form)fundingEditors.get(form)?.refresh();
}
function handleKeydown(event){
  const drawer=event.target.closest('.cp-composer');
  if(drawer){
    if(event.key==='Escape'){event.preventDefault();closeComposer();return;}
    if(event.key==='Tab'){
      const focusable=[...drawer.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(node=>!node.disabled&&!node.closest('[hidden]'));
      const first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&event.target===first){event.preventDefault();last?.focus({preventScroll:true});}
      else if(!event.shiftKey&&event.target===last){event.preventDefault();first?.focus({preventScroll:true});}
    }
    return;
  }
  const client=event.target.closest('.ll-client-card[data-acct-borrower]');
  if(client&&(event.key==='Enter'||event.key===' ')){event.preventDefault();selectClient(client.dataset.acctBorrower);return;}
  const tab=event.target.closest('.ll-tab[data-profile-tab]');if(!tab)return;
  if(event.key==='Enter'||event.key===' '){event.preventDefault();showTab(tab.dataset.profileTab);}
  if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
    event.preventDefault();const tabs=[...tab.parentElement.querySelectorAll('[data-profile-tab]')],index=tabs.indexOf(tab);
    const next=event.key==='Home'?tabs[0]:event.key==='End'?tabs[tabs.length-1]:tabs[(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];
    showTab(next.dataset.profileTab);next.focus({preventScroll:true});
  }
}
function wireController(root){
  if(!root||root.dataset.controllerBound==='1')return;
  root.dataset.controllerBound='1';
  root.addEventListener('click',handleClick);
  root.addEventListener('submit',handleSubmit);
  root.addEventListener('input',handleInput);
  root.addEventListener('change',handleInput);
  root.addEventListener('loan-ledger:payment-target-changed',()=>updateProfilePaymentPreview());
  root.addEventListener('keydown',handleKeydown);
}

window.addEventListener(CLIENT_CHANGED,event=>{
  const client=event.detail?.client;
  if(!client||!mounted)return;
  accounts=mergeClientAccount(accounts,client);
  const list=document.querySelector('#borrowerAccountContent .ll-client-list');
  if(!list)return;
  const card=[...list.querySelectorAll('[data-acct-borrower]')].find(node=>node.dataset.acctBorrower===String(client.id));
  const row=accounts.find(account=>String(account.borrower_id)===String(client.id));
  if(card){
    card.title=client.full_name;card.setAttribute('aria-label',client.full_name);card.dataset.clientSearch=client.full_name.toLowerCase();
    transitionValue(card.querySelector('.ll-client-name'),client.full_name);
    transitionValue(card.querySelector('.ll-client-initials'),initials(client.full_name));
  }else list.insertAdjacentHTML('afterbegin',clientRowHtml(row,currentBorrowerId));
});

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
window.addEventListener('loan-ledger:account-changed',event=>{
  const id=event.detail?.borrowerId;
  if(mounted&&currentBorrowerId&&(!id||String(id)===String(currentBorrowerId)))refreshCurrent().catch(error=>{console.error('account refresh after action failed',error);showLoadingBadge(false);announceProfile('El movimiento se guardó. Actualiza la cuenta para ver el saldo más reciente.',true);});
});

const page=ensureAccountPage();
if(page)new MutationObserver(syncFixedMode).observe(page,{attributes:true,attributeFilter:['class']});

console.log('single persistent client profile controller active');
