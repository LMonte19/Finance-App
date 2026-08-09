import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function ensureLiveStyles(){
  const href='./client-profile-live-switch.css?v=1';
  let link=document.getElementById('clientProfileLiveSwitchCss');
  if(link){link.href=href;return;}
  link=document.createElement('link');
  link.id='clientProfileLiveSwitchCss';
  link.rel='stylesheet';
  link.href=href;
  document.head.appendChild(link);
}
ensureLiveStyles();

const db=createClient(
  'https://eatxkhhpjruwwibhcubf.supabase.co',
  'sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q',
  {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:'loan-ledger-auth'}}
);

const money=value=>`$${Math.round(Number(value||0)).toLocaleString('en-US')}`;
const today=()=>new Date().toISOString().slice(0,10);
const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
let liveSequence=0;
let liveData=null;

function formatDate(iso,options={day:'2-digit',month:'short',year:'numeric'}){
  if(!iso)return '—';
  try{return new Date(`${iso}T00:00:00`).toLocaleDateString('es',options).replace('.','');}catch{return iso;}
}
function parseIso(iso){const [y,m,d]=String(iso).split('-').map(Number);return new Date(y,m-1,d);}
function daysFromToday(iso){if(!iso)return null;return Math.round((parseIso(iso)-parseIso(today()))/86400000);}
function dueTiming(iso){const d=daysFromToday(iso);if(d===null||Number.isNaN(d))return 'Sin fecha';if(d<0)return `Hace ${Math.abs(d)} días`;if(d===0)return 'Hoy';if(d===1)return 'Mañana';return `En ${d} días`;}
function statusLabel(value){
  const key=String(value||'').toUpperCase();
  return {ACTIVE:'ACTIVO',CURRENT:'AL DÍA',OVERDUE:'ATRASADO',ATRASADO:'ATRASADO',PAID:'PAGADA',PARTIAL:'PARCIAL',OPEN:'ABIERTO',DONE:'COMPLETADO',UPCOMING:'PRÓXIMA',DUE:'PENDIENTE',DUE_TODAY:'VENCE HOY',CANCELLED:'CANCELADA',CLOSED:'CERRADO',PAID_OFF:'SALDADO',VOIDED:'ANULADO'}[key]||value||'—';
}
function tone(value){const key=String(value||'').toUpperCase();if(['OVERDUE','ATRASADO','DANGER','URGENT'].includes(key))return'danger';if(['DUE','PARTIAL','PENDING','PENDIENTE','HIGH','DUE_TODAY','UPCOMING'].includes(key))return'pending';if(['CLOSED','PAID_OFF','CANCELLED','VOIDED'].includes(key))return'closed';return'ok';}
function dueStatus(row){if(row?.status==='PAID'||row?.timing_status==='PAID')return'PAID';if(row?.status==='PARTIAL')return'PARTIAL';if(row?.timing_status==='OVERDUE')return'OVERDUE';if(row?.timing_status==='DUE_TODAY')return'DUE_TODAY';if(row?.status==='CANCELLED'||row?.timing_status==='CANCELLED')return'CANCELLED';return row?.status||row?.timing_status||'UPCOMING';}
function paymentTypeLabel(type){return{INSTALLMENT:'Cuota/interés',PRINCIPAL:'Abono a capital',MIXED:'Mixto',PAYOFF:'Saldar capital'}[type]||type||'—';}

async function loadData(borrowerId){
  const now=new Date();
  const start=new Date(now.getFullYear()-1,now.getMonth(),1).toISOString().slice(0,10);
  const end=new Date(now.getFullYear()+1,now.getMonth()+7,0).toISOString().slice(0,10);
  const [summaryRes,calendarRes,disbRes,payRes,contactRes,followRes,settingsRes,fundingRes,profilesRes]=await Promise.all([
    db.from('borrower_account_summary').select('*').eq('borrower_id',borrowerId).single(),
    db.rpc('get_borrower_due_calendar',{p_borrower_id:borrowerId,p_start_date:start,p_end_date:end}),
    db.from('borrower_disbursements_view').select('*').eq('borrower_id',borrowerId).order('start_date',{ascending:false}),
    db.from('borrower_account_payments_view').select('*').eq('borrower_id',borrowerId).order('paid_on',{ascending:false}).order('created_at',{ascending:false}).limit(120),
    db.from('borrower_contact_log_view').select('*').eq('borrower_id',borrowerId).order('created_at',{ascending:false}).limit(80),
    db.from('borrower_followups_view').select('*').eq('borrower_id',borrowerId).order('due_date',{ascending:true}).limit(80),
    db.from('app_settings').select('setting_key,setting_value').in('setting_key',['loan_defaults','default_funding_split']),
    db.from('loan_funding').select('loan_id,partner_user_id,funding_percent'),
    db.from('profiles').select('user_id,full_name,role')
  ]);
  for(const result of [summaryRes,calendarRes,disbRes,payRes,contactRes,followRes,settingsRes,fundingRes,profilesRes])if(result.error)throw result.error;
  const settings=Object.fromEntries((settingsRes.data||[]).map(row=>[row.setting_key,row.setting_value]));
  const names=new Map((profilesRes.data||[]).map(row=>[row.user_id,row.full_name||row.role||'Socio']));
  const loanIds=new Set((disbRes.data||[]).map(row=>row.id));
  const fundingByLoan=new Map();
  (fundingRes.data||[]).filter(row=>loanIds.has(row.loan_id)).forEach(row=>{
    if(!fundingByLoan.has(row.loan_id))fundingByLoan.set(row.loan_id,[]);
    fundingByLoan.get(row.loan_id).push({...row,partner_name:names.get(row.partner_user_id)||'Socio'});
  });
  return{
    summary:summaryRes.data,
    calendarRows:calendarRes.data||[],
    disbursements:(disbRes.data||[]).map(row=>({...row,funding:fundingByLoan.get(row.id)||[]})),
    payments:payRes.data||[],contacts:contactRes.data||[],followups:followRes.data||[],
    defaults:settings.loan_defaults||{default_total_monthly_rate:10,default_management_rate:3},
    funding:Array.isArray(settings.default_funding_split)?settings.default_funding_split:[]
  };
}

function calendarMap(data){return new Map((data.calendarRows||[]).map(row=>[row.due_date,row]));}
function selectedCalendarRow(data,iso){
  const row=calendarMap(data).get(iso);if(row)return row;
  return{due_date:iso,expected_total:Number(data.summary.current_cycle_fee||0),paid_total:0,amount_due:Number(data.summary.current_cycle_fee||0),timing_status:daysFromToday(iso)<0?'OVERDUE':daysFromToday(iso)===0?'DUE_TODAY':'UPCOMING',status:'DUE',is_virtual:true};
}
function nextDueRow(data){
  const rows=[...(data.calendarRows||[])].filter(row=>Number(row.amount_due||0)>0&&!['PAID','CANCELLED'].includes(dueStatus(row))).sort((a,b)=>String(a.due_date).localeCompare(String(b.due_date)));
  return rows.find(row=>daysFromToday(row.due_date)>=0)||rows[0]||null;
}

function animateText(element,nextText,nextClass=null){
  if(!element)return Promise.resolve();
  const text=String(nextText??'');
  if(element.textContent===text&&(nextClass===null||element.className===nextClass))return Promise.resolve();
  element.classList.add('ll-live-value');
  const out=element.animate?.([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-3px)'}],{duration:90,easing:'ease-out',fill:'forwards'});
  return Promise.resolve(out?.finished).catch(()=>{}).then(()=>{
    element.textContent=text;
    if(nextClass!==null)element.className=nextClass;
    element.animate?.([{opacity:0,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],{duration:180,easing:'cubic-bezier(.22,.61,.36,1)',fill:'both'});
  });
}
function nodeFromHtml(html){const box=document.createElement('div');box.innerHTML=html.trim();return box.firstElementChild;}
async function replaceRegion(oldNode,html){
  if(!oldNode)return null;
  const next=nodeFromHtml(html);if(!next)return oldNode;
  oldNode.classList.add('ll-live-region');
  try{await oldNode.animate?.([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-2px)'}],{duration:90,easing:'ease-out',fill:'forwards'}).finished;}catch{}
  oldNode.replaceWith(next);
  next.classList.add('ll-live-region');
  next.animate?.([{opacity:0,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],{duration:190,easing:'cubic-bezier(.22,.61,.36,1)',fill:'both'});
  return next;
}
function cardByTitle(root,title){return[...root.querySelectorAll('.ll-profile-card')].find(card=>card.querySelector('.ll-card-title')?.textContent.trim()===title);}
function bodyNode(card){return card?.querySelector(':scope > .ll-record-list,:scope > .ll-empty-state,:scope > .ll-activity-list,:scope > .ll-next-action');}

function paymentRows(payments){
  if(!payments.length)return'<div class="ll-empty-state">No hay pagos registrados para este cliente.</div>';
  return`<div class="ll-record-list">${payments.map(p=>`<article class="ll-record-row"><div class="ll-record-date"><strong>${formatDate(p.paid_on,{day:'2-digit',month:'short'})}</strong><small>${formatDate(p.paid_on,{year:'numeric'})}</small></div><div class="ll-record-main"><div class="ll-record-title">${money(p.amount)} <span class="ll-mini-pill ${p.is_voided?'ll-record-danger':''}">${p.is_voided?'ANULADO':paymentTypeLabel(p.payment_type)}</span></div><div class="ll-record-meta">Cuota/interés: ${money(p.applied_interest)} · Capital: ${money(p.applied_principal)} · Administración: ${money(p.applied_mgmt)} · Socios: ${money(p.applied_funders)}</div>${p.notes?`<div class="ll-record-note">${esc(p.notes)}</div>`:''}${p.void_reason?`<div class="ll-record-note">Motivo de anulación: ${esc(p.void_reason)}</div>`:''}</div>${p.is_voided?'':`<button type="button" class="ll-inline-action ll-danger-action" data-void-payment="${p.id}">Anular</button>`}</article>`).join('')}</div>`;
}
function disbursementRows(rows){
  if(!rows.length)return'<div class="ll-empty-state">No hay desembolsos registrados para este cliente.</div>';
  return`<div class="ll-record-list">${rows.map(row=>{const funding=row.funding?.length?row.funding.map(item=>`${esc(item.partner_name)} ${(Number(item.funding_percent||0)*100).toFixed(2)}%`).join(' · '):'Sin distribución visible';return`<article class="ll-record-row ll-disbursement-record"><div class="ll-record-date"><strong>${formatDate(row.start_date,{day:'2-digit',month:'short'})}</strong><small>${formatDate(row.start_date,{year:'numeric'})}</small></div><div class="ll-record-main"><div class="ll-record-title">${money(row.principal_original)} <span class="ll-status-pill ${tone(row.status)}">${statusLabel(row.status)}</span></div><div class="ll-record-meta">Balance pendiente: ${money(row.principal_outstanding)} · Interés mensual: ${(Number(row.monthly_rate_total||0)*100).toFixed(2)}% · Administración: ${(Number(row.monthly_rate_mgmt||0)*100).toFixed(2)}%</div><div class="ll-record-note">Distribución: ${funding}</div>${row.notes?`<div class="ll-record-note">${esc(row.notes)}</div>`:''}</div></article>`;}).join('')}</div>`;
}
function followupRows(rows){
  if(!rows.length)return'<div class="ll-empty-state">No hay seguimientos para este cliente.</div>';
  return`<div class="ll-record-list">${rows.map(row=>`<article class="ll-record-row"><div class="ll-record-date"><strong>${formatDate(row.due_date,{day:'2-digit',month:'short'})}</strong><small>${dueTiming(row.due_date)}</small></div><div class="ll-record-main"><div class="ll-record-title">${esc(row.reason||'Seguimiento')} <span class="ll-status-pill ${tone(row.timing_status||row.status)}">${statusLabel(row.status==='DONE'?'DONE':row.timing_status)}</span></div><div class="ll-record-meta">Prioridad: ${esc(row.priority||'NORMAL')}${row.loan_start_date?` · Desembolso: ${formatDate(row.loan_start_date)}`:''}</div>${row.completed_notes?`<div class="ll-record-note">${esc(row.completed_notes)}</div>`:''}</div>${row.status==='DONE'?'':`<button type="button" class="ll-inline-action" data-complete-followup="${row.id}">Completar</button>`}</article>`).join('')}</div>`;
}
function contactRows(rows){
  if(!rows.length)return'<div class="ll-empty-state">No hay notas o contactos registrados para este cliente.</div>';
  return`<div class="ll-record-list">${rows.map(row=>`<article class="ll-record-row"><div class="ll-record-date"><strong>${formatDate(row.contact_date,{day:'2-digit',month:'short'})}</strong><small>${esc(row.contact_type||'NOTA')}</small></div><div class="ll-record-main"><div class="ll-record-title">${esc(row.outcome||'Contacto registrado')}</div><div class="ll-record-note">${esc(row.notes||'')}</div><div class="ll-record-meta">Registrado por: ${esc(row.created_by_name||'Usuario')}</div></div></article>`).join('')}</div>`;
}

const ICONS={payment:'<path d="M12 4v15M7 14l5 5 5-5"/>',disbursement:'<path d="M6 18 18 6M10 6h8v8"/>',note:'<path d="M6 4h9l3 3v13H6z"/><path d="M15 4v4h4M9 12h6M9 16h5"/>',chevron:'<path d="m9 6 6 6-6 6"/>'};
function svg(name){return`<svg class="ll-elegant-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;}
function movementRows(data){
  const events=[
    ...data.payments.slice(0,5).map(row=>({date:row.paid_on,tab:'payments',title:`Pago recibido por ${money(row.amount)}`,detail:paymentTypeLabel(row.payment_type),kind:'payment',filter:'pagos'})),
    ...data.disbursements.slice(0,5).map(row=>({date:row.start_date,tab:'disbursements',title:`Capital agregado: ${money(row.principal_original)}`,detail:`Balance actual ${money(row.principal_outstanding)}`,kind:'disbursement',filter:'desembolsos'})),
    ...data.contacts.slice(0,5).map(row=>({date:row.contact_date,tab:'followups',title:row.outcome||'Contacto registrado',detail:row.notes||row.contact_type||'',kind:'note',filter:'notas'})),
    ...data.followups.slice(0,5).map(row=>({date:row.due_date,tab:'followups',title:row.reason||'Seguimiento',detail:statusLabel(row.status==='DONE'?'DONE':row.timing_status),kind:'note',filter:'notas'}))
  ].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,5);
  if(!events.length)return'<div class="ll-empty-state">Todavía no hay actividad en esta cuenta.</div>';
  return`<div class="ll-activity-list">${events.map(e=>`<button type="button" data-open-tab="${e.tab}" data-movement-filter="${e.filter}"><span class="ll-activity-dot ll-movement-icon-${e.kind}">${svg(e.kind)}</span><span><strong>${esc(e.title)}</strong><small>${formatDate(e.date)}</small>${e.detail?`<p>${esc(e.detail)}</p>`:''}</span><b>${svg('chevron')}</b></button>`).join('')}</div>`;
}
function loanOptions(rows){return`<option value="">Cuenta general</option>${rows.map(row=>`<option value="${row.id}">${formatDate(row.start_date)} · ${money(row.principal_outstanding)} · ${statusLabel(row.status)}</option>`).join('')}`;}

async function patchCalendars(root,data){
  const calendars=[...root.querySelectorAll('.ll-profile-tabs-host .ll-cycle-calendar')];
  const jobs=[];
  calendars.forEach(calendar=>{
    const buttons=[...calendar.querySelectorAll('[data-calendar-date]')];
    let selected=calendar.querySelector('.ll-cycle-date.selected')?.dataset.calendarDate||buttons.find(button=>daysFromToday(button.dataset.calendarDate)>=0)?.dataset.calendarDate||buttons[0]?.dataset.calendarDate;
    buttons.forEach(button=>{
      const iso=button.dataset.calendarDate;
      const row=selectedCalendarRow(data,iso);
      button.classList.remove('ok','pending','danger','closed');
      button.classList.add(tone(dueStatus(row)));
      button.classList.toggle('selected',iso===selected);
    });
    if(!selected)return;
    const row=selectedCalendarRow(data,selected);
    const key=dueStatus(row);
    const detail=calendar.querySelector('.ll-cycle-detail--compact')||calendar.querySelector('.ll-cycle-detail');
    let cells=detail?[...detail.children]:[];
    if(cells.length===6&&cells[0]?.textContent.trim().startsWith('Cuota del'))cells=cells.slice(1);
    if(cells.length>=5){
      jobs.push(animateText(cells[0].querySelector('strong'),money(row.expected_total)));
      jobs.push(animateText(cells[1].querySelector('strong'),money(row.paid_total)));
      jobs.push(animateText(cells[2].querySelector('strong'),money(row.amount_due)));
      jobs.push(animateText(cells[3].querySelector('.ll-status-pill'),statusLabel(key),`ll-status-pill ${tone(key)}`));
      jobs.push(animateText(cells[4].querySelector('strong'),dueTiming(selected)));
    }
  });
  await Promise.all(jobs);
}

async function patchSummary(root,data){
  const panel=root.querySelector('[data-profile-panel="summary"]');if(!panel)return;
  const a=data.summary,nextDue=nextDueRow(data),cells=[...panel.querySelectorAll('.ll-summary-stat-grid>div')];
  const jobs=[];
  if(cells[0]){jobs.push(animateText(cells[0].querySelector(':scope>strong'),money(a.principal_balance)));jobs.push(animateText(cells[0].querySelector(':scope>small'),statusLabel(a.account_status)));}
  if(cells[1]){jobs.push(animateText(cells[1].querySelector(':scope>strong'),money(a.total_disbursed)));jobs.push(animateText(cells[1].querySelector(':scope>small'),`${a.disbursement_count||0} desembolsos`));}
  if(cells[2])jobs.push(animateText(cells[2].querySelector(':scope>strong'),money(a.current_monthly_fee)));
  if(cells[3])jobs.push(animateText(cells[3].querySelector(':scope>strong'),money(a.current_cycle_fee)));
  if(cells[4]){jobs.push(animateText(cells[4].querySelector(':scope>strong'),formatDate(nextDue?.due_date)));jobs.push(animateText(cells[4].querySelector(':scope>small'),nextDue?dueTiming(nextDue.due_date):'Sin fecha'));}

  const facts=panel.querySelector('.ll-account-facts');
  const factRows=facts?[...facts.children]:[];
  const factValues=[statusLabel(a.account_status),money(a.overdue_amount),String(a.overdue_count||0),String(a.max_days_late||0)];
  factRows.forEach((row,index)=>jobs.push(animateText(row.querySelector('strong'),factValues[index])));

  const nextCard=cardByTitle(panel,'Próxima acción');
  if(nextCard){
    const open=data.followups.filter(row=>row.status!=='DONE')[0];
    const html=open?`<div class="ll-next-action"><span class="ll-status-pill ${tone(open.timing_status)}">${statusLabel(open.timing_status)}</span><strong>${esc(open.reason)}</strong><p>${formatDate(open.due_date)} · ${dueTiming(open.due_date)}</p><button type="button" class="ll-purple-btn" data-complete-followup="${open.id}">Marcar como completada</button></div>`:`<div class="ll-next-action"><strong>Sin seguimientos pendientes</strong><p>La cuenta no tiene acciones abiertas.</p><button type="button" class="ll-soft-btn" data-open-tab="followups">Crear seguimiento</button></div>`;
    const old=bodyNode(nextCard);if(old)jobs.push(replaceRegion(old,html));
  }

  const movementCard=cardByTitle(panel,'Movimientos')||cardByTitle(panel,'Actividad reciente');
  if(movementCard){const old=bodyNode(movementCard);if(old)jobs.push(replaceRegion(old,movementRows(data)));}

  const quick=panel.querySelector('#llSummaryQuickPayForm');
  if(quick){
    const suggested=Number(a.current_cycle_fee||a.current_monthly_fee||0);
    const values=[suggested/2,suggested,suggested*2,suggested*4].filter(v=>v>0);
    const wrap=quick.querySelector('.ll-summary-quick-amounts');
    if(wrap)wrap.innerHTML=values.map((value,index)=>`<button type="button" class="${index===1?'active':''}" data-summary-amount="${value}">${money(value)}</button>`).join('');
    const input=quick.querySelector('#llSummaryPayAmount');if(input)input.value=suggested?Math.round(suggested):'';
  }
  await Promise.all(jobs);
}

async function patchOtherPanels(root,data){
  const jobs=[];
  const payments=root.querySelector('[data-profile-panel="payments"]');
  if(payments){
    const history=cardByTitle(payments,'Historial de pagos');const old=bodyNode(history);if(old)jobs.push(replaceRegion(old,paymentRows(data.payments)));
    const suggested=Number(data.summary.current_cycle_fee||data.summary.current_monthly_fee||0);
    const input=payments.querySelector('#llProfilePayAmount');if(input)input.value=suggested?Math.round(suggested):'';
    const quick=payments.querySelector('.ll-quick-profile-amounts');if(quick)quick.innerHTML=[suggested/2,suggested,suggested*2].filter(v=>v>0).map(v=>`<button type="button" data-profile-amount="${v}">${money(v)}</button>`).join('');
  }
  const disb=root.querySelector('[data-profile-panel="disbursements"]');
  if(disb){const history=cardByTitle(disb,'Historial y detalles de desembolsos');const old=bodyNode(history);if(old)jobs.push(replaceRegion(old,disbursementRows(data.disbursements)));}
  const follow=root.querySelector('[data-profile-panel="followups"]');
  if(follow){
    const fCard=cardByTitle(follow,'Historial de seguimientos'),cCard=cardByTitle(follow,'Historial de notas y contactos');
    const fOld=bodyNode(fCard),cOld=bodyNode(cCard);if(fOld)jobs.push(replaceRegion(fOld,followupRows(data.followups)));if(cOld)jobs.push(replaceRegion(cOld,contactRows(data.contacts)));
    const options=loanOptions(data.disbursements);const cLoan=follow.querySelector('#llProfileContactLoan'),fLoan=follow.querySelector('#llProfileFollowupLoan');if(cLoan)cLoan.innerHTML=options;if(fLoan)fLoan.innerHTML=options;
  }
  await Promise.all(jobs);
}

async function patchProfile(root,data){
  liveData=data;
  await Promise.all([patchSummary(root,data),patchCalendars(root,data),patchOtherPanels(root,data)]);
  root.dataset.functionalTabs='ready';
  root.dataset.liveProfileReady='1';
}

function activeBorrower(){return document.querySelector('#borrowerAccountContent .ll-client-card.active[data-acct-borrower]')?.dataset.acctBorrower||null;}
async function refreshCurrent(root){const id=activeBorrower();if(!id)return;const data=await loadData(id);await patchProfile(root,data);}
async function userId(){const{data,error}=await db.auth.getUser();if(error)throw error;if(!data.user?.id)throw new Error('No se encontró una sesión activa.');return data.user.id;}
function setStatus(id,text,error=false){const el=document.getElementById(id);if(!el)return;el.textContent=text;el.classList.toggle('error',error);}

async function handleSubmit(event){
  const root=event.target.closest?.('.ll-account-shell');if(!root||root.dataset.liveSwitchEnabled!=='1')return;
  const form=event.target;if(!['llSummaryQuickPayForm','llProfilePaymentForm','llProfileContactForm','llProfileFollowupForm','llProfileDisbursementForm'].includes(form.id))return;
  event.preventDefault();event.stopImmediatePropagation();
  const borrower=activeBorrower();if(!borrower)return;
  try{
    if(form.id==='llSummaryQuickPayForm'||form.id==='llProfilePaymentForm'){
      const summary=form.id==='llSummaryQuickPayForm';
      const amount=Number(form.querySelector(summary?'#llSummaryPayAmount':'#llProfilePayAmount')?.value||0);
      const paid_on=summary?today():form.querySelector('#llProfilePayDate')?.value;
      const payment_type=summary?'INSTALLMENT':form.querySelector('#llProfilePayType')?.value||'INSTALLMENT';
      const notes=summary?'Pago rápido desde el resumen':form.querySelector('#llProfilePayNotes')?.value.trim()||null;
      const statusId=summary?'llSummaryPayStatus':'llProfilePayStatus';
      if(!amount||!paid_on)return setStatus(statusId,'Fecha y monto son requeridos.',true);
      setStatus(statusId,'Aplicando pago...');const{error}=await db.rpc('apply_borrower_payment',{p_borrower_id:borrower,p_paid_on:paid_on,p_amount:amount,p_payment_type:payment_type,p_notes:notes});if(error)return setStatus(statusId,error.message,true);setStatus(statusId,'Pago registrado correctamente.');
    }else if(form.id==='llProfileContactForm'){
      const contact_date=form.querySelector('#llProfileContactDate')?.value,contact_type=form.querySelector('#llProfileContactType')?.value||'NOTE',loan_id=form.querySelector('#llProfileContactLoan')?.value||null,outcome=form.querySelector('#llProfileContactOutcome')?.value.trim()||null,notes=form.querySelector('#llProfileContactNotes')?.value.trim();
      if(!contact_date||!notes)return setStatus('llProfileContactStatus','Fecha y notas son requeridas.',true);setStatus('llProfileContactStatus','Guardando nota...');const created_by=await userId();const{error}=await db.from('borrower_contact_log').insert({borrower_id:borrower,loan_id,contact_date,contact_type,outcome,notes,created_by});if(error)return setStatus('llProfileContactStatus',error.message,true);
    }else if(form.id==='llProfileFollowupForm'){
      const due_date=form.querySelector('#llProfileFollowupDate')?.value,priority=form.querySelector('#llProfileFollowupPriority')?.value||'NORMAL',loan_id=form.querySelector('#llProfileFollowupLoan')?.value||null,reason=form.querySelector('#llProfileFollowupReason')?.value.trim();
      if(!due_date||!reason)return setStatus('llProfileFollowupStatus','Fecha y motivo son requeridos.',true);setStatus('llProfileFollowupStatus','Creando seguimiento...');const created_by=await userId();const{error}=await db.from('borrower_followups').insert({borrower_id:borrower,loan_id,due_date,priority,reason,created_by});if(error)return setStatus('llProfileFollowupStatus',error.message,true);
    }else if(form.id==='llProfileDisbursementForm'){
      const principal=Number(form.querySelector('#llProfilePrincipal')?.value||0),start_date=form.querySelector('#llProfileStartDate')?.value,total=Number(form.querySelector('#llProfileTotalRate')?.value||0)/100,mgmt=Number(form.querySelector('#llProfileMgmtRate')?.value||0)/100,notes=form.querySelector('#llProfileDisbursementNotes')?.value.trim()||null;
      const funding=[...form.querySelectorAll('[data-partner-user-id]')].map(input=>({partner_user_id:input.dataset.partnerUserId,funding_percent:Number(input.value||0)/100})).filter(row=>row.partner_user_id&&row.funding_percent>0);const ft=funding.reduce((s,row)=>s+row.funding_percent,0);
      if(!principal||!start_date)return setStatus('llProfileDisbursementStatus','Fecha y capital son requeridos.',true);if(mgmt>total)return setStatus('llProfileDisbursementStatus','La administración no puede superar el interés total.',true);if(!funding.length||Math.abs(ft-1)>0.001)return setStatus('llProfileDisbursementStatus','La distribución debe sumar 100%.',true);
      setStatus('llProfileDisbursementStatus','Guardando desembolso...');const created_by=await userId();const{data:loan,error}=await db.from('loans').insert({borrower_id:borrower,created_by,start_date,principal_original:principal,principal_outstanding:principal,monthly_rate_total:total,monthly_rate_mgmt:mgmt,notes,status:'ACTIVE'}).select('id').single();if(error)return setStatus('llProfileDisbursementStatus',error.message,true);const f=await db.from('loan_funding').insert(funding.map(row=>({loan_id:loan.id,...row})));if(f.error)return setStatus('llProfileDisbursementStatus',f.error.message,true);
    }
    await refreshCurrent(root);
  }catch(error){console.error('live profile action failed',error);}
}

document.addEventListener('submit',handleSubmit,true);
document.addEventListener('click',async event=>{
  const root=event.target.closest?.('.ll-account-shell');if(!root||root.dataset.liveSwitchEnabled!=='1')return;
  const open=event.target.closest('[data-open-tab]');if(open){event.preventDefault();event.stopImmediatePropagation();root.querySelector(`.ll-tab[data-profile-tab="${open.dataset.openTab}"]`)?.click();return;}
  const amount=event.target.closest('[data-summary-amount],[data-profile-amount]');if(amount){const selector=amount.hasAttribute('data-summary-amount')?'#llSummaryPayAmount':'#llProfilePayAmount';const value=amount.dataset.summaryAmount||amount.dataset.profileAmount;const input=root.querySelector(selector);if(input)input.value=Math.round(Number(value||0));return;}
  const complete=event.target.closest('[data-complete-followup]');if(complete){event.preventDefault();event.stopImmediatePropagation();const note=prompt('Nota de finalización (opcional):','');if(note===null)return;const{error}=await db.rpc('complete_followup',{p_followup_id:complete.dataset.completeFollowup,p_completed_notes:note.trim()||null});if(error)return alert(error.message);await refreshCurrent(root);return;}
  const voidBtn=event.target.closest('[data-void-payment]');if(voidBtn){event.preventDefault();event.stopImmediatePropagation();const reason=prompt('Motivo de anulación (opcional):','');if(reason===null)return;if(!confirm('¿Seguro que quieres anular este pago? Se revertirán las aplicaciones de cuota, capital y distribuciones.'))return;const{error}=await db.rpc('void_payment',{p_payment_id:voidBtn.dataset.voidPayment,p_reason:reason.trim()||null});if(error)return alert(error.message);await refreshCurrent(root);return;}
  const whatsapp=[...root.querySelectorAll('.ll-action-row button,.ll-more-menu button')].find(button=>button.textContent.includes('WhatsApp'));
  if(whatsapp&&event.target.closest('button')===whatsapp){event.preventDefault();event.stopImmediatePropagation();const phone=String(liveData?.summary?.phone||'').replace(/\D/g,'');if(!phone)return alert('Este cliente no tiene un teléfono registrado.');window.open(`https://wa.me/${phone}`,'_blank','noopener,noreferrer');}
},true);

/* This listener is intentionally registered before client-profile-tabs.js. The base identity
   renderer and calendar controller run first; then this handler prevents the old full-host
   profile renderer from running for client-to-client switches. */
window.addEventListener('loan-ledger:account-rendered',event=>{
  if(event.detail?.source!=='inplace-profile-switch')return;
  const id=event.detail?.borrowerId;const root=document.querySelector('#borrowerAccountContent .ll-account-shell');if(!id||!root)return;
  event.stopImmediatePropagation();
  const sequence=++liveSequence;
  root.dataset.liveSwitchEnabled='1';
  root.dataset.functionalTabs='live-loading';
  loadData(id).then(async data=>{
    if(sequence!==liveSequence||!document.contains(root))return;
    await patchProfile(root,data);
    root.dataset.liveProfileBorrower=String(id);
  }).catch(error=>{console.error('live client profile switch failed',error);root.dataset.functionalTabs='error';});
},true);

console.log('live client profile data switching active');
