import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { readPageQuery, watchPage, invalidatePageReads, isStalePageSession, loadingRows } from './page-read-runtime.js?v=1';
import { setStableMarkup } from './dashboard-presentation.js?v=1';

const db = createClient(
  'https://eatxkhhpjruwwibhcubf.supabase.co',
  'sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q',
  { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, storage:window.localStorage, storageKey:'loan-ledger-auth' } }
);

const $ = id => document.getElementById(id);
const moneyFormatter = new Intl.NumberFormat('en-US',{maximumFractionDigits:0});
const money = value => `$${moneyFormatter.format(Number(value || 0))}`;
const dateLabel = iso => iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('es',{day:'2-digit',month:'short',year:'numeric'}).replace('.','') : '—';
const esc = value => String(value ?? '').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

const state = { filter:'ALL', search:'', sortKey:'NEXT_DUE', sortDir:'asc', view:'list', data:null, loading:false, opening:false, period:'month', periodSequence:0, requestSequence:0, pendingRefresh:null };

const ICONS = {
  wallet:'<path d="M4 7h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12"/><path d="M16 12h5v4h-5a2 2 0 0 1 0-4Z"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  recover:'<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 12h8M12 8v8"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  download:'<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  arrowDown:'<path d="M12 3v14M7 10l5 5 5-5"/>',
  dollar:'<circle cx="12" cy="12" r="9"/><path d="M16 8.5c-.8-1-2-1.5-4-1.5-2.2 0-3.5 1-3.5 2.5 0 3.8 7.5 1.5 7.5 5.2 0 1.5-1.4 2.6-3.8 2.6-1.9 0-3.4-.6-4.2-1.8M12 5v14"/>',
  chevron:'<path d="m9 18 6-6-6-6"/>',
  alert:'<path d="M10.3 3.7 2.2 18a2 2 0 0 0 1.8 3h16a2 2 0 0 0 1.8-3L13.7 3.7a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]||ICONS.wallet}</svg>`;

function ensureStyles(){
  if($('loansDashboardCss')) return;
  const link=document.createElement('link');
  link.id='loansDashboardCss';link.rel='stylesheet';link.href='./loans-dashboard.css?v=2';
  document.head.appendChild(link);
}

function iso(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function periodStart(key){
  const now=new Date();
  if(key==='3m')return iso(new Date(now.getFullYear(),now.getMonth()-2,1));
  if(key==='6m')return iso(new Date(now.getFullYear(),now.getMonth()-5,1));
  if(key==='12m')return iso(new Date(now.getFullYear(),now.getMonth()-11,1));
  return iso(new Date(now.getFullYear(),now.getMonth(),1));
}
function periodLabel(key){return {month:'Este mes','3m':'Últimos 3 meses','6m':'Últimos 6 meses','12m':'Últimos 12 meses'}[key]||'Este mes';}
function bucketCount(key){return key==='month'?6:key==='3m'?6:key==='6m'?6:12;}

function makeBuckets(key){
  const now=new Date();
  const count=bucketCount(key);
  const buckets=[];
  if(key==='month'){
    const start=new Date(now.getFullYear(),now.getMonth(),1);
    const daysInMonth=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
    const span=Math.max(1,Math.ceil(daysInMonth/count));
    for(let i=0;i<count;i++){
      const from=new Date(start.getFullYear(),start.getMonth(),1+i*span);
      const to=i===count-1?new Date(now.getFullYear(),now.getMonth()+1,0):new Date(start.getFullYear(),start.getMonth(),Math.min(daysInMonth,(i+1)*span));
      buckets.push({from,to,value:0});
    }
  }else{
    const months=key==='3m'?3:key==='6m'?6:12;
    for(let i=months-1;i>=0;i--){
      const from=new Date(now.getFullYear(),now.getMonth()-i,1);
      const to=new Date(from.getFullYear(),from.getMonth()+1,0);
      buckets.push({from,to,value:0});
    }
  }
  return buckets;
}

function buildTrend(payments,key){
  const buckets=makeBuckets(key);
  payments.forEach(row=>{
    if(!row.paid_on)return;
    const date=new Date(`${row.paid_on}T00:00:00`);
    const bucket=buckets.find(item=>date>=item.from&&date<=item.to);
    if(bucket)bucket.value+=Number(row.applied_principal||0);
  });
  const max=Math.max(1,...buckets.map(item=>item.value));
  const width=220;
  const step=buckets.length>1?(width-12)/(buckets.length-1):0;
  return buckets.map((item,index)=>({x:6+index*step,y:40-(item.value/max)*31,value:item.value}));
}

async function loadPeriod(key,force=false){
  const start=periodStart(key);
  const [paymentsRes,disbursementsRes]=await Promise.all([
    readPageQuery('loans-period-payments:'+start,()=>db.from('borrower_account_payments_view').select('paid_on,applied_principal,is_voided').eq('is_voided',false).gte('paid_on',start).order('paid_on',{ascending:true}),{force,ttl:45000}),
    readPageQuery('loans-period-disbursements:'+start,()=>db.from('borrower_disbursements_view').select('start_date,principal_original').gte('start_date',start).order('start_date',{ascending:true}),{force,ttl:45000})
  ]);
  if(paymentsRes.error)throw paymentsRes.error;
  if(disbursementsRes.error)throw disbursementsRes.error;
  const payments=paymentsRes.data||[];
  const disbursements=disbursementsRes.data||[];
  return {
    payments,
    disbursed:disbursements.reduce((sum,row)=>sum+Number(row.principal_original||0),0),
    recovered:payments.reduce((sum,row)=>sum+Number(row.applied_principal||0),0)
  };
}

function statusInfo(value){
  const key=String(value||'').toUpperCase();
  if(['OVERDUE','ATRASADO'].includes(key)) return {key:'OVERDUE',label:'ATRASADO',className:'overdue'};
  if(['PAID_OFF','CLOSED','PAID','SALDADO'].includes(key)) return {key:'PAID_OFF',label:'SALDADO',className:'closed'};
  return {key:'CURRENT',label:'AL DÍA',className:'current'};
}

function initials(name){ return String(name||'?').trim().split(/\s+/).slice(0,2).map(part=>part[0]||'').join('').toUpperCase()||'?'; }
function avatarClass(index){ return ['','green','','yellow','gray'][index%5]; }
function borrowerCode(id){ return `CLI-${String(id||'').slice(0,4).toUpperCase()}`; }
function isLoansPage(){ return $('loansPage')?.classList.contains('active-page'); }

function setupPage(){
  const page=$('loansPage');
  if(!page||page.dataset.ldSetup==='1') return;
  ensureStyles();
  page.dataset.ldSetup='1';page.classList.add('ld-ready');

  const cards=[...page.querySelectorAll(':scope > .card')];
  const formCard=cards.find(card=>card.querySelector('#btnCreateLoan'));
  const listCard=cards.find(card=>card.querySelector('#loanList'));

  const dashboard=document.createElement('div');dashboard.id='loansDashboardHost';dashboard.className='ld-dashboard';dashboard.innerHTML='<div class="ld-empty">Cargando cartera...</div>';
  const legacy=document.createElement('div');legacy.id='loansLegacyMount';legacy.hidden=true;
  const overlay=document.createElement('div');overlay.id='loansDrawerOverlay';overlay.className='ld-overlay';
  const drawer=document.createElement('aside');drawer.id='loansDrawer';drawer.className='ld-drawer';drawer.setAttribute('aria-hidden','true');
  drawer.innerHTML=`<div class="ld-drawer-head"><strong id="loansDrawerTitle">Nuevo desembolso</strong><button type="button" class="ld-drawer-close" id="loansDrawerClose">✕</button></div><div id="loansDisbursementBody"></div><div id="loansClientBody" hidden><form id="loansNewClientForm" class="ld-client-form"><label>Nombre completo<input id="ldClientName" required placeholder="Nombre del cliente"></label><label>Teléfono<input id="ldClientPhone" placeholder="Teléfono (opcional)"></label><label>Notas<textarea id="ldClientNotes" placeholder="Notas opcionales"></textarea></label><button type="submit" class="ld-client-save">Guardar cliente</button><div id="ldClientStatus" class="muted"></div></form></div>`;

  page.prepend(dashboard);page.append(legacy,overlay,drawer);
  if(listCard) legacy.appendChild(listCard);
  if(formCard) $('loansDisbursementBody').appendChild(formCard);

  $('loansDrawerClose').onclick=closeDrawer;overlay.onclick=closeDrawer;
  $('loansNewClientForm').addEventListener('submit',saveClient);
  setStableMarkup(dashboard,dashboardHtml(initialLoanData()));
  wireDashboard();
}

function openDrawer(type){
  const drawer=$('loansDrawer'),overlay=$('loansDrawerOverlay');if(!drawer||!overlay)return;
  const client=type==='client';
  $('loansDrawerTitle').textContent=client?'Nuevo cliente':'Nuevo desembolso';
  $('loansClientBody').hidden=!client;$('loansDisbursementBody').hidden=client;
  drawer.classList.add('open');overlay.classList.add('open');drawer.setAttribute('aria-hidden','false');
  setTimeout(()=>client?$('ldClientName')?.focus():$('principal')?.focus(),180);
}
function closeDrawer(){ $('loansDrawer')?.classList.remove('open');$('loansDrawerOverlay')?.classList.remove('open');$('loansDrawer')?.setAttribute('aria-hidden','true'); }

async function saveClient(event){
  event.preventDefault();
  const name=$('ldClientName')?.value.trim();if(!name)return;
  const status=$('ldClientStatus');if(status)status.textContent='Guardando cliente...';
  try{
    const {data:userData,error:userError}=await db.auth.getUser();if(userError)throw userError;
    const {error}=await db.from('borrowers').insert({full_name:name,phone:$('ldClientPhone')?.value.trim()||null,notes:$('ldClientNotes')?.value.trim()||null,created_by:userData.user.id});
    if(error)throw error;
    invalidatePageReads();
    $('loansNewClientForm').reset();if(status)status.textContent='Cliente guardado.';
    await renderDashboard(true);setTimeout(closeDrawer,350);
  }catch(error){if(status)status.textContent=error.message||String(error);}
}

async function loadData(force=false){
  const period=state.period;
  const monthPromise=loadPeriod('month',force);
  const periodPromise=period==='month'?monthPromise:loadPeriod(period,force);
  const [accountsRes,paymentsRes,disbursementsRes,monthData,portfolio]=await Promise.all([
    readPageQuery('loans-accounts',()=>db.from('borrower_account_summary').select('*').order('full_name',{ascending:true}),{force,ttl:45000}),
    readPageQuery('loans-payments',()=>db.from('borrower_account_payments_view').select('*').eq('is_voided',false).order('paid_on',{ascending:false}).order('created_at',{ascending:false}).limit(240),{force,ttl:45000}),
    readPageQuery('loans-disbursements',()=>db.from('borrower_disbursements_view').select('*').order('start_date',{ascending:false}).order('created_at',{ascending:false}).limit(240),{force,ttl:45000}),
    monthPromise,periodPromise
  ]);
  for(const result of [accountsRes,paymentsRes,disbursementsRes])if(result.error)throw result.error;
  const accounts=accountsRes.data||[],payments=paymentsRes.data||[],disbursements=disbursementsRes.data||[];
  const activity=[
    ...payments.map(row=>({borrower_id:row.borrower_id,name:row.borrower_name,type:'PAYMENT',date:row.paid_on,created_at:row.created_at,title:`Pago recibido de ${row.borrower_name}`,amount:Number(row.amount||0)})),
    ...disbursements.map(row=>({borrower_id:row.borrower_id,name:row.borrower_name,type:'DISBURSEMENT',date:row.start_date,created_at:row.created_at,title:`Nuevo desembolso a ${row.borrower_name}`,amount:Number(row.principal_original||0)}))
  ].sort((a,b)=>String(b.created_at||b.date).localeCompare(String(a.created_at||a.date)));
  const latestByBorrower=new Map();activity.forEach(item=>{if(!latestByBorrower.has(item.borrower_id))latestByBorrower.set(item.borrower_id,item);});
  return {accounts,payments,disbursements,activity,latestByBorrower,monthData,portfolio,period};
}

function metricData(data){
  const sum=field=>data.accounts.reduce((total,row)=>total+Number(row[field]||0),0);
  const active=data.accounts.filter(row=>statusInfo(row.account_status).key!=='PAID_OFF');
  const overdue=data.accounts.filter(row=>statusInfo(row.account_status).key==='OVERDUE');
  const today=new Date();today.setHours(0,0,0,0);
  const horizon=new Date(today);horizon.setDate(horizon.getDate()+14);
  const upcoming=data.accounts.filter(row=>{
    if(!row.next_due_date||Number(row.principal_balance||0)<=0)return false;
    const date=new Date(String(row.next_due_date).slice(0,10)+'T00:00:00');
    return !Number.isNaN(date.getTime())&&date>=today&&date<=horizon;
  });
  const totalDisbursed=sum('total_disbursed');
  const recovered=sum('total_principal_paid');
  const balance=sum('principal_balance');
  const openingBalance=balance-data.monthData.disbursed+data.monthData.recovered;
  return {
    balance,totalDisbursed,recovered,
    balanceChange:openingBalance?((balance-openingBalance)/Math.abs(openingBalance))*100:balance?100:0,
    overdueAmount:sum('overdue_amount'),
    upcomingAmount:upcoming.reduce((n,row)=>n+Number(row.current_cycle_fee||0),0),
    upcomingCount:upcoming.length,
    active:active.length,total:data.accounts.length,overdue:overdue.length,
    recoveryRate:totalDisbursed?Math.min(100,(recovered/totalDisbursed)*100):0
  };
}

function trendPoints(payments){
  const now=new Date();const months=[];
  for(let i=5;i>=0;i--){const date=new Date(now.getFullYear(),now.getMonth()-i,1);months.push({key:`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`,value:0});}
  const map=new Map(months.map(item=>[item.key,item]));
  payments.forEach(row=>{const key=String(row.paid_on||'').slice(0,7);if(map.has(key))map.get(key).value+=Number(row.applied_principal||row.amount||0);});
  const max=Math.max(1,...months.map(item=>item.value));
  return months.map((item,index)=>({x:6+index*42,y:40-(item.value/max)*31,value:item.value}));
}

function metricFooter(value,label,{neutral=false,count=false}={}){
  const tone=neutral||!value?'neutral':value>0?'good':'bad';
  const arrow=neutral||!value?'•':value>0?'↑':'↓';
  return `<div class="ld-metric-change ${tone}"><span class="ld-trend-arrow">${arrow}</span><strong>${count?value:Math.abs(value).toFixed(1)+'%'}</strong><span>${label}</span></div>`;
}
function metricCard(iconName,iconClass,label,value,note,footer){return `<article class="ld-metric-card"><div class="ld-metric-main"><span class="ld-metric-icon ${iconClass}">${icon(iconName)}</span><div class="ld-metric-copy"><div class="ld-metric-label">${label}</div><div class="ld-metric-value">${value}</div><div class="ld-metric-note">${note}</div></div></div>${footer}</article>`;}
function metricsHtml(metrics){
  return metricCard('wallet','', 'Balance pendiente',money(metrics.balance),'Capital activo',metricFooter(metrics.balanceChange,'vs. inicio de mes'))+
    metricCard('alert','coral', 'Atrasado',money(metrics.overdueAmount),metrics.overdue+' clientes atrasados',metricFooter(metrics.balance?metrics.overdueAmount/metrics.balance*100:0,'del balance pendiente',{neutral:true}))+
    metricCard('calendar','lime', 'Próximas cuotas',money(metrics.upcomingAmount),metrics.upcomingCount+' vencen en 14 días',metricFooter(metrics.upcomingCount,'cuotas en 14 días',{neutral:true,count:true}))+
    metricCard('users','blue', 'Clientes activos',String(metrics.active),'De '+metrics.total+' clientes',metricFooter(metrics.total?metrics.active/metrics.total*100:0,'de clientes activos',{neutral:true}));
}
function initialLoanData(){return {accounts:[],payments:[],disbursements:[],activity:[],latestByBorrower:new Map(),monthData:{disbursed:0,recovered:0},loading:true};}
function metricSkeletons(){
  return ['Balance pendiente','Atrasado','Próximas cuotas','Clientes activos'].map((label,index)=>metricCard(['wallet','alert','calendar','users'][index],['','coral','lime','blue'][index],label,'—','—','<div class="ld-metric-change neutral">—</div>')).join('');
}

async function changePortfolioPeriod(key){
  state.period=key;const sequence=++state.periodSequence;
  $('ldPortfolioCard')?.setAttribute('aria-busy','true');
  try{
    const portfolio=await loadPeriod(key);
    if(sequence!==state.periodSequence||!state.data)return;
    state.data={...state.data,portfolio,period:key};
    setStableMarkup($('ldPortfolioCard'),recoveryCard(state.data,metricData(state.data)));
  }catch(error){if(!isStalePageSession(error))console.error('portfolio period failed',error);}
  finally{if(sequence===state.periodSequence)$('ldPortfolioCard')?.removeAttribute('aria-busy');}
}

function recoveryCard(data,metrics){
  const current=data.accounts.filter(row=>statusInfo(row.account_status).key==='CURRENT').length;
  const overdue=data.accounts.filter(row=>statusInfo(row.account_status).key==='OVERDUE').length;
  const paid=data.accounts.filter(row=>statusInfo(row.account_status).key==='PAID_OFF').length;
  const total=Math.max(1,current+overdue+paid);
  const currentPct=current/total*100,overduePct=overdue/total*100,paidPct=paid/total*100;
  const portfolio=data.portfolio;
  const combined=Math.max(1,portfolio.disbursed+portfolio.recovered);
  const disbursedPct=portfolio.disbursed/combined*100;
  const recoveredPct=portfolio.recovered/combined*100;
  const recoveryRate=portfolio.disbursed?Math.min(100,portfolio.recovered/portfolio.disbursed*100):0;
  const points=buildTrend(portfolio.payments,data.period);const poly=points.map(point=>`${point.x},${point.y}`).join(' ');const last=points[points.length-1];
  const circumference=2*Math.PI*34;
  const c1=currentPct/100*circumference,c2=overduePct/100*circumference,c3=paidPct/100*circumference;
  const pct=n=>`${Math.round(n)}%`;
  return `<div class="ld-recovery-top"><div><div class="ld-recovery-title">Panorama de cartera</div><div class="ld-recovery-subtle">Desembolsado vs Recuperado</div></div><span class="ld-recovery-chip"><select id="ldRecoveryPeriod" aria-label="Periodo del panorama de cartera">${['month','3m','6m','12m'].map(key=>`<option value="${key}" ${data.period===key?'selected':''}>${periodLabel(key)}</option>`).join('')}</select></span></div>
    <div class="ld-recovery-values">
      <div class="ld-recovery-stat"><span class="ld-recovery-stat-label"><i class="ld-dot purple"></i>Desembolsado</span><strong>${money(portfolio.disbursed)}</strong></div>
      <div class="ld-recovery-stat"><span class="ld-recovery-stat-label"><i class="ld-dot lime"></i>Recuperado</span><strong>${money(portfolio.recovered)}</strong></div>
    </div>
    <div class="ld-split-bar"><span class="ld-split-disbursed" style="width:${disbursedPct}%"></span><span class="ld-split-recovered" style="width:${recoveredPct}%"></span></div>
    <div class="ld-black-section-title">Distribución de estados</div>
    <div class="ld-donut-grid"><svg class="ld-donut" viewBox="0 0 100 100"><circle cx="50" cy="50" r="34" class="ld-donut-track"></circle><circle cx="50" cy="50" r="34" class="ld-donut-segment current" stroke-dasharray="${c1} ${circumference-c1}" stroke-dashoffset="0"></circle><circle cx="50" cy="50" r="34" class="ld-donut-segment overdue" stroke-dasharray="${c2} ${circumference-c2}" stroke-dashoffset="-${c1}"></circle><circle cx="50" cy="50" r="34" class="ld-donut-segment paid" stroke-dasharray="${c3} ${circumference-c3}" stroke-dashoffset="-${c1+c2}"></circle></svg><div class="ld-status-legend"><div><span><i class="dot current"></i>Al día</span><strong>${current} (${pct(currentPct)})</strong></div><div><span><i class="dot overdue"></i>Atrasados</span><strong>${overdue} (${pct(overduePct)})</strong></div><div><span><i class="dot paid"></i>Pagados</span><strong>${paid} (${pct(paidPct)})</strong></div></div></div>
    <div class="ld-recovery-bottom"><div><div class="ld-black-section-title">Tasa de recuperación</div><div class="ld-recovery-rate-big">${recoveryRate.toFixed(1)}%</div><small>${money(portfolio.recovered)} recuperados · ${periodLabel(data.period).toLowerCase()}</small></div><svg class="ld-trend ld-trend-large" viewBox="0 0 220 45" preserveAspectRatio="none"><polyline points="${poly}"></polyline><circle cx="${last.x}" cy="${last.y}" r="3"></circle></svg></div>`;
}

function sortRank(row,data,key){
  if(key==='NAME')return String(row.full_name||'').toLocaleLowerCase();
  if(key==='BALANCE')return Number(row.principal_balance||0);
  if(key==='CYCLE')return Number(row.current_cycle_fee||0);
  if(key==='NEXT_DUE')return String(row.next_due_date||'9999-12-31');
  if(key==='STATUS'){const status=statusInfo(row.account_status).key;return {CURRENT:1,OVERDUE:2,PAID_OFF:3}[status]||9;}
  if(key==='ACTIVITY')return String(data.latestByBorrower.get(row.borrower_id)?.date||'0000-00-00');
  return '';
}
function filteredAccounts(data){
  let rows=[...data.accounts];const query=state.search.trim().toLowerCase();
  if(query)rows=rows.filter(row=>`${row.full_name} ${borrowerCode(row.borrower_id)} ${row.phone||''}`.toLowerCase().includes(query));
  if(state.filter!=='ALL')rows=rows.filter(row=>statusInfo(row.account_status).key===state.filter);
  rows.sort((a,b)=>{
    const av=sortRank(a,data,state.sortKey),bv=sortRank(b,data,state.sortKey);
    let result=0;
    if(typeof av==='number'&&typeof bv==='number')result=av-bv;else result=String(av).localeCompare(String(bv));
    return state.sortDir==='asc'?result:-result;
  });
  return rows;
}

function clientRows(data){
  const rows=filteredAccounts(data);
  if(!rows.length)return '<div class="ld-empty">No hay clientes que coincidan con estos filtros.</div>';
  return rows.map((row,index)=>{
    const status=statusInfo(row.account_status);
    const activity=data.latestByBorrower.get(row.borrower_id);
    if(state.view==='grid')return clientGridCard(row,index,status,activity);
    return `<button type="button" class="ld-client-row" data-ld-borrower="${esc(row.borrower_id)}">
      <div class="ld-client-ident"><span class="ld-avatar ${avatarClass(index)}">${esc(initials(row.full_name))}</span><span class="ld-client-identity"><span class="ld-client-name">${esc(row.full_name)}</span></span></div>
      <div class="ld-cell ld-cell-balance"><strong>${money(row.principal_balance)}</strong></div>
      <div class="ld-cell ld-cell-cycle"><strong>${money(row.current_cycle_fee)}</strong></div>
      <div class="ld-cell ld-cell-due"><strong>${row.next_due_date?dateLabel(row.next_due_date):'—'}</strong>${row.next_due_date?`<small>${daysLabel(row.next_due_date)}</small>`:''}</div>
      <div class="ld-cell-status"><span class="ld-status ${status.className}">${status.label}</span></div>
      <div class="ld-cell ld-cell-activity"><strong>${activity?activity.type==='PAYMENT'?'Pago recibido':'Desembolso':'Sin actividad'}</strong><small>${activity?dateLabel(activity.date):'—'}</small></div>
      <span class="ld-arrow">${icon('chevron')}</span>
    </button>`;
  }).join('');
}

function clientGridCard(row,index,status,activity){
  return `<button type="button" class="ld-client-row ld-grid-card" data-ld-borrower="${esc(row.borrower_id)}" aria-label="Abrir cuenta de ${esc(row.full_name)}">
    <span class="ld-grid-card-head"><span class="ld-client-ident"><span class="ld-avatar ${avatarClass(index)}">${esc(initials(row.full_name))}</span><span class="ld-client-name">${esc(row.full_name)}</span></span><span class="ld-status ${status.className}">${status.label}</span></span>
    <span class="ld-grid-balance"><span class="ld-grid-label">Balance pendiente</span><strong>${money(row.principal_balance)}</strong></span>
    <span class="ld-grid-details"><span><span class="ld-grid-label">Cuota · 15 y fin de mes</span><strong>${money(row.current_cycle_fee)}</strong></span><span><span class="ld-grid-label">Próxima cuota</span><strong>${row.next_due_date?dateLabel(row.next_due_date):'—'}</strong><small>${row.next_due_date?daysLabel(row.next_due_date):'Sin vencimiento'}</small></span></span>
    <span class="ld-grid-activity"><span><span class="ld-grid-label">Última actividad</span><strong>${activity?activity.type==='PAYMENT'?'Pago recibido':'Desembolso':'Sin actividad'}</strong><small>${activity?dateLabel(activity.date):'—'}</small></span><span class="ld-arrow">${icon('chevron')}</span></span>
  </button>`;
}

function daysLabel(iso){const days=Math.ceil((new Date(`${iso}T00:00:00`)-new Date(new Date().toISOString().slice(0,10)+'T00:00:00'))/86400000);if(days<0)return `Hace ${Math.abs(days)} días`;if(days===0)return 'Hoy';if(days===1)return 'Mañana';return `En ${days} días`;}

function upcomingHtml(data){
  const rows=data.accounts.filter(row=>row.next_due_date&&Number(row.principal_balance||0)>0).sort((a,b)=>String(a.next_due_date).localeCompare(String(b.next_due_date))).slice(0,3);
  if(!rows.length)return '<div class="ld-empty">No hay próximos vencimientos.</div>';
  return rows.map(row=>`<div class="ld-due-item"><span class="ld-mini-icon">${icon('calendar')}</span><span><div class="ld-item-title">${esc(row.full_name)}</div><div class="ld-item-meta">${dateLabel(row.next_due_date)}</div></span><span><div class="ld-item-badge">${daysLabel(row.next_due_date)}</div><div class="ld-item-amount" style="margin-top:5px">${money(row.current_cycle_fee)}</div></span></div>`).join('');
}
function activityHtml(data,limit=4){
  const rows=data.activity.slice(0,limit);if(!rows.length)return '<div class="ld-empty">No hay actividad reciente.</div>';
  return rows.map(row=>`<div class="ld-activity-item"><span class="ld-mini-icon ${row.type==='PAYMENT'?'green':''}">${icon(row.type==='PAYMENT'?'dollar':'arrowDown')}</span><span><div class="ld-item-title">${esc(row.title)}</div><div class="ld-item-meta">${money(row.amount)} · ${dateLabel(row.date)}</div></span></div>`).join('');
}

const sortLabels={NAME:'Cliente',BALANCE:'Balance',CYCLE:'Cuota',NEXT_DUE:'Próxima cuota',STATUS:'Estado',ACTIVITY:'Última actividad'};
function sortHeader(key){
  const active=state.sortKey===key;const glyph=active?(state.sortDir==='asc'?'↑':'↓'):'↕';
  return `<button type="button" class="ld-th ${active?'active':''}" data-sort-col="${key}" aria-label="Ordenar por ${sortLabels[key]}"><span class="ld-th-content"><span>${sortLabels[key]}</span>${key==='CYCLE'?'<small>15 y fin de mes</small>':''}</span><span class="ld-sort-glyph">${glyph}</span></button>`;
}

function dashboardHtml(data){
  const metrics=metricData(data);
  return `<div class="ld-page-head"><div><h1 class="ld-page-title">Préstamos</h1><div class="ld-page-subtitle">Gestiona tu cartera de préstamos y clientes.</div></div><div class="ld-head-actions"><button type="button" class="ld-action ld-action-soft" id="ldNewClient">${icon('plus')} Nuevo cliente</button><button type="button" class="ld-action ld-action-primary" id="ldNewDisbursement">${icon('download')} Nuevo desembolso</button></div></div>
  <div class="ld-dashboard-grid"><main class="ld-dashboard-main">
  <section id="ldLoanKpis" class="ld-metric-grid" aria-label="Resumen de préstamos">
    ${data.loading?metricSkeletons():metricsHtml(metrics)}
  </section>
  <section class="ld-client-panel ${state.view==='grid'?'grid-mode':''}" id="ldClientPanel">
    <div class="ld-panel-heading">
      <div class="ld-panel-title">Clientes</div>
      <div class="ld-view-toggle" role="group" aria-label="Vista de clientes">
        <button type="button" data-view="list" aria-label="Vista de lista" aria-pressed="${state.view==='list'}" class="${state.view==='list'?'active':''}">${icon('list')}</button>
        <button type="button" data-view="grid" aria-label="Vista de cuadrícula" aria-pressed="${state.view==='grid'}" class="${state.view==='grid'?'active':''}">${icon('grid')}</button>
      </div>
    </div>
    <div class="ld-controls">
      <label class="ld-search">${icon('search')}<input id="ldSearch" placeholder="Buscar cliente por nombre..." value="${esc(state.search)}" aria-label="Buscar cliente"></label>
      <div class="ld-filter-pills" role="group" aria-label="Filtrar clientes"><button data-filter="ALL" class="${state.filter==='ALL'?'active':''}">Todos</button><button data-filter="CURRENT" class="${state.filter==='CURRENT'?'active':''}">Al día</button><button data-filter="OVERDUE" class="${state.filter==='OVERDUE'?'active':''}">Atrasados</button><button data-filter="PAID_OFF" class="${state.filter==='PAID_OFF'?'active':''}">Pagados</button></div>
      <select id="ldSort" class="ld-sort" aria-label="Ordenar clientes"><option value="NEXT_DUE" ${state.sortKey==='NEXT_DUE'?'selected':''}>Ordenar: Próxima cuota</option><option value="BALANCE" ${state.sortKey==='BALANCE'?'selected':''}>Ordenar: Balance</option><option value="CYCLE" ${state.sortKey==='CYCLE'?'selected':''}>Ordenar: Cuota</option><option value="STATUS" ${state.sortKey==='STATUS'?'selected':''}>Ordenar: Estado</option><option value="ACTIVITY" ${state.sortKey==='ACTIVITY'?'selected':''}>Ordenar: Actividad</option><option value="NAME" ${state.sortKey==='NAME'?'selected':''}>Ordenar: Nombre</option></select>
    </div>
    <div class="ld-table-scroll"><div class="ld-table-head">${sortHeader('NAME')}${sortHeader('BALANCE')}${sortHeader('CYCLE')}${sortHeader('NEXT_DUE')}${sortHeader('STATUS')}${sortHeader('ACTIVITY')}<span></span></div>
    <div class="ld-client-list" id="ldClientList">${data.loading?loadingRows():clientRows(data)}</div></div>
  </section>
  <section class="ld-side-card ld-upcoming-panel"><div class="ld-side-head"><strong>Próximos vencimientos</strong><button type="button" data-go-page="paymentsPage">Ver calendario</button></div><div id="ldUpcomingList">${data.loading?loadingRows(2):upcomingHtml(data)}</div></section></main>
  <aside class="ld-dashboard-side" aria-label="Panorama y actividad"><article id="ldPortfolioCard" class="ld-recovery-card ld-recovery-advanced">${data.loading?'<div class="ld-recovery-title">Panorama de cartera</div>'+loadingRows():recoveryCard(data,metrics)}</article><section class="ld-side-card"><div class="ld-side-head"><strong>Actividad reciente</strong><button type="button" data-go-page="activityPage">Ver todo</button></div><div id="ldRecentActivity">${data.loading?loadingRows(2):activityHtml(data)}</div></section></aside></div>`;
}

function repopulateBorrowerSelect(accounts){
  const select=$('loanBorrower');if(!select)return;
  const selected=select.value;
  if(setStableMarkup(select,accounts.map(row=>`<option value="${row.borrower_id}">${esc(row.full_name)}</option>`).join(''))&&accounts.some(row=>String(row.borrower_id)===selected))select.value=selected;
}
function renderLoanData(data){
  const metrics=metricData(data);
  setStableMarkup($('ldLoanKpis'),metricsHtml(metrics));
  rerenderRows();
  if(data.period===state.period)setStableMarkup($('ldPortfolioCard'),recoveryCard(data,metrics));
  setStableMarkup($('ldRecentActivity'),activityHtml(data));
  setStableMarkup($('ldUpcomingList'),upcomingHtml(data));
  repopulateBorrowerSelect(data.accounts);
}

async function renderDashboard(force=false){
  setupPage();const host=$('loansDashboardHost');if(!host)return;
  if(state.loading){state.pendingRefresh=!!force||!!state.pendingRefresh;return;}
  state.loading=true;const sequence=++state.requestSequence;
  try{
    const data=await loadData(force);
    if(sequence!==state.requestSequence)return;
    if(data.period!==state.period&&state.data?.period===state.period){data.portfolio=state.data.portfolio;data.period=state.period;}
    state.data=data;renderLoanData(data);
  }catch(error){
    if(isStalePageSession(error))return;
    console.error(error);
    if(!state.data)setStableMarkup($('ldClientList'),`<div class="ld-empty">No se pudo cargar la cartera: ${esc(error.message||error)}</div>`);
  }finally{
    state.loading=false;
    if(state.pendingRefresh!==null){const pending=state.pendingRefresh;state.pendingRefresh=null;queueMicrotask(()=>{if(isLoansPage())renderDashboard(pending);});}
  }
}

function rerenderRows(){if(!state.data)return;const panel=$('ldClientPanel');if(panel)panel.classList.toggle('grid-mode',state.view==='grid');if(setStableMarkup($('ldClientList'),clientRows(state.data)))wireRowClicks();updateSortUi();}
function updateSortUi(){
  document.querySelectorAll('#loansDashboardHost [data-sort-col]').forEach(button=>{const active=button.dataset.sortCol===state.sortKey;button.classList.toggle('active',active);const glyph=button.querySelector('.ld-sort-glyph');if(glyph)glyph.textContent=active?(state.sortDir==='asc'?'↑':'↓'):'↕';});
  if($('ldSort')){$('ldSort').value=state.sortKey;$('ldSort').title=$('ldSort').selectedOptions?.[0]?.textContent||'Ordenar clientes';}
}
function showPage(id){document.querySelectorAll('.tab-btn').forEach(button=>button.classList.toggle('active',button.dataset.page===id));document.querySelectorAll('.page').forEach(page=>page.classList.toggle('active-page',page.id===id));$('sideMenu')?.classList.remove('open');$('menuOverlay')?.classList.remove('open');}

function defaultDirection(key){return ['BALANCE','CYCLE','ACTIVITY'].includes(key)?'desc':'asc';}
function wireDashboard(){
  const host=$('loansDashboardHost');if(!host||host.dataset.bound==='1')return;host.dataset.bound='1';
  host.addEventListener('input',event=>{if(event.target.id==='ldSearch'){state.search=event.target.value;rerenderRows();}});
  host.addEventListener('change',event=>{
    if(event.target.id==='ldSort'){state.sortKey=event.target.value;state.sortDir=defaultDirection(state.sortKey);rerenderRows();}
    if(event.target.id==='ldRecoveryPeriod')changePortfolioPeriod(event.target.value);
  });
  host.addEventListener('click',event=>{
    if(event.target.closest?.('#ldNewClient')){openDrawer('client');return;}
    if(event.target.closest?.('#ldNewDisbursement')){openDrawer('disbursement');return;}
    const column=event.target.closest?.('[data-sort-col]');
    if(column){const key=column.dataset.sortCol;if(state.sortKey===key)state.sortDir=state.sortDir==='asc'?'desc':'asc';else{state.sortKey=key;state.sortDir=defaultDirection(key);}rerenderRows();return;}
    const filter=event.target.closest?.('[data-filter]');
    if(filter){state.filter=filter.dataset.filter;host.querySelectorAll('[data-filter]').forEach(item=>item.classList.toggle('active',item===filter));rerenderRows();return;}
    const view=event.target.closest?.('[data-view]');
    if(view){state.view=view.dataset.view;host.querySelectorAll('[data-view]').forEach(item=>{const active=item.dataset.view===state.view;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active));});rerenderRows();return;}
    const button=event.target.closest?.('[data-go-page]');if(button)showPage(button.dataset.goPage);
  });
  wireRowClicks();
}
function wireRowClicks(){document.querySelectorAll('#loansDashboardHost [data-ld-borrower]').forEach(row=>row.addEventListener('click',()=>openClient(row.dataset.ldBorrower,row)));}

function waitFor(selector,timeout=2600){return new Promise(resolve=>{const found=document.querySelector(selector);if(found)return resolve(found);const started=Date.now();const timer=setInterval(()=>{const node=document.querySelector(selector);if(node||Date.now()-started>timeout){clearInterval(timer);resolve(node||null);}},35);});}
function clearTransitionNames(){document.querySelectorAll('[style*="view-transition-name"]').forEach(node=>node.style.viewTransitionName='');}

async function openClient(id,row){
  if(state.opening)return;state.opening=true;
  const panel=$('ldClientPanel');row.classList.add('selected-opening');$('loansDashboardHost')?.classList.add('ld-opening');
  const update=async()=>{
    window.dispatchEvent(new CustomEvent('loan-ledger:open-account',{detail:{borrowerId:id}}));
    const rail=await waitFor('#borrowerAccountPage.active-page .ll-client-rail');
    const selected=document.querySelector(`#borrowerAccountPage .ll-client-card[data-acct-borrower="${id}"]`);
    if(rail)rail.style.viewTransitionName='loan-client-list';if(selected)selected.style.viewTransitionName='loan-selected-client';
  };
  try{
    if(document.startViewTransition&&panel){panel.style.viewTransitionName='loan-client-list';row.style.viewTransitionName='loan-selected-client';const transition=document.startViewTransition(update);await transition.finished;}
    else{await new Promise(resolve=>setTimeout(resolve,320));await update();}
  }catch(error){console.error(error);window.dispatchEvent(new CustomEvent('loan-ledger:open-account',{detail:{borrowerId:id}}));}
  finally{clearTransitionNames();row.classList.remove('selected-opening');$('loansDashboardHost')?.classList.remove('ld-opening');state.opening=false;}
}

async function backToLoans(){
  const rail=document.querySelector('#borrowerAccountPage .ll-client-rail');const selected=document.querySelector('#borrowerAccountPage .ll-client-card.active');const id=selected?.dataset.acctBorrower;
  const update=async()=>{showPage('loansPage');await renderDashboard(false);const panel=$('ldClientPanel');const row=id?document.querySelector(`#loansDashboardHost [data-ld-borrower="${id}"]`):null;if(panel)panel.style.viewTransitionName='loan-client-list';if(row)row.style.viewTransitionName='loan-selected-client';};
  try{if(document.startViewTransition&&rail){rail.style.viewTransitionName='loan-client-list';if(selected)selected.style.viewTransitionName='loan-selected-client';const transition=document.startViewTransition(update);await transition.finished;}else await update();}finally{clearTransitionNames();}
}

document.addEventListener('click',event=>{const back=event.target.closest?.('#borrowerAccountPage #acctBack');if(back){event.preventDefault();event.stopImmediatePropagation();backToLoans();}},true);

function activate(){setupPage();if(isLoansPage())renderDashboard(false);}
watchPage('loansPage',activate,{interval:45000,prefetch:()=>loadData(false),reset:()=>{
  state.requestSequence++;state.periodSequence++;state.data=null;state.filter='ALL';state.search='';state.view='list';state.period='month';
  state.sortKey='NEXT_DUE';state.sortDir='asc';
  closeDrawer();setStableMarkup($('loansDashboardHost'),dashboardHtml(initialLoanData()),true);
}});
window.addEventListener('loan-ledger:dashboard-refresh',()=>renderDashboard(true));
setupPage();

console.log('loans portfolio dashboard active');
