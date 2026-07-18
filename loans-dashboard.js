import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(
  'https://eatxkhhpjruwwibhcubf.supabase.co',
  'sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q',
  { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, storage:window.localStorage, storageKey:'loan-ledger-auth' } }
);

const $ = id => document.getElementById(id);
const moneyFormatter = new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const money = value => `$${moneyFormatter.format(Number(value || 0))}`;
const dateLabel = iso => iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('es',{day:'2-digit',month:'short',year:'numeric'}).replace('.','') : '—';
const esc = value => String(value ?? '').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

const state = { filter:'ALL', search:'', sort:'NEXT_DUE', view:'list', data:null, loading:false, lastLoaded:0, opening:false };

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
  arrowDown:'<path d="M12 3v14M7 12l5 5 5-5"/>',
  dollar:'<circle cx="12" cy="12" r="9"/><path d="M16 8.5c-.8-1-2-1.5-4-1.5-2.2 0-3.5 1-3.5 2.5 0 3.8 7.5 1.5 7.5 5.2 0 1.5-1.4 2.6-3.8 2.6-1.9 0-3.4-.6-4.2-1.8M12 5v14"/>',
  alert:'<path d="M10.3 3.7 2.2 18a2 2 0 0 0 1.8 3h16a2 2 0 0 0 1.8-3L13.7 3.7a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]||ICONS.wallet}</svg>`;

function ensureStyles(){
  if($('loansDashboardCss')) return;
  const link=document.createElement('link');
  link.id='loansDashboardCss';link.rel='stylesheet';link.href='./loans-dashboard.css?v=1';
  document.head.appendChild(link);
}

function statusInfo(value){
  const key=String(value||'').toUpperCase();
  if(['OVERDUE','ATRASADO'].includes(key)) return {key:'OVERDUE',label:'ATRASADO',className:'overdue'};
  if(['PAID_OFF','CLOSED','PAID','SALDADO'].includes(key)) return {key:'PAID_OFF',label:'SALDADO',className:'closed'};
  return {key:'CURRENT',label:'AL DÍA',className:'current'};
}

function initials(name){
  return String(name||'?').trim().split(/\s+/).slice(0,2).map(part=>part[0]||'').join('').toUpperCase()||'?';
}
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
  $('btnCreateLoan')?.addEventListener('click',()=>{setTimeout(()=>renderDashboard(true),700);setTimeout(()=>renderDashboard(true),1800);});
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
    $('loansNewClientForm').reset();if(status)status.textContent='Cliente guardado.';
    await renderDashboard(true);setTimeout(closeDrawer,350);
  }catch(error){if(status)status.textContent=error.message||String(error);}
}

async function loadData(){
  const [accountsRes,paymentsRes,disbursementsRes]=await Promise.all([
    db.from('borrower_account_summary').select('*').order('full_name',{ascending:true}),
    db.from('borrower_account_payments_view').select('*').eq('is_voided',false).order('paid_on',{ascending:false}).order('created_at',{ascending:false}).limit(240),
    db.from('borrower_disbursements_view').select('*').order('start_date',{ascending:false}).order('created_at',{ascending:false}).limit(240)
  ]);
  for(const result of [accountsRes,paymentsRes,disbursementsRes])if(result.error)throw result.error;
  const accounts=accountsRes.data||[],payments=paymentsRes.data||[],disbursements=disbursementsRes.data||[];
  const activity=[
    ...payments.map(row=>({borrower_id:row.borrower_id,name:row.borrower_name,type:'PAYMENT',date:row.paid_on,created_at:row.created_at,title:`Pago recibido de ${row.borrower_name}`,amount:Number(row.amount||0)})),
    ...disbursements.map(row=>({borrower_id:row.borrower_id,name:row.borrower_name,type:'DISBURSEMENT',date:row.start_date,created_at:row.created_at,title:`Nuevo desembolso a ${row.borrower_name}`,amount:Number(row.principal_original||0)}))
  ].sort((a,b)=>String(b.created_at||b.date).localeCompare(String(a.created_at||a.date)));
  const latestByBorrower=new Map();activity.forEach(item=>{if(!latestByBorrower.has(item.borrower_id))latestByBorrower.set(item.borrower_id,item);});
  return {accounts,payments,disbursements,activity,latestByBorrower};
}

function metricData(data){
  const sum=(field)=>data.accounts.reduce((total,row)=>total+Number(row[field]||0),0);
  const active=data.accounts.filter(row=>statusInfo(row.account_status).key!=='PAID_OFF');
  const overdue=data.accounts.filter(row=>statusInfo(row.account_status).key==='OVERDUE');
  const totalDisbursed=sum('total_disbursed');
  const recovered=sum('total_principal_paid');
  const pendingDues=sum('overdue_amount')+sum('due_today_amount');
  return {balance:sum('principal_balance'),totalDisbursed,recovered,pendingDues,active:active.length,total:data.accounts.length,overdue:overdue.length,recoveryRate:totalDisbursed?Math.min(100,(recovered/totalDisbursed)*100):0};
}

function trendPoints(payments){
  const now=new Date();const months=[];
  for(let i=5;i>=0;i--){const date=new Date(now.getFullYear(),now.getMonth()-i,1);months.push({key:`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`,value:0});}
  const map=new Map(months.map(item=>[item.key,item]));
  payments.forEach(row=>{const key=String(row.paid_on||'').slice(0,7);if(map.has(key))map.get(key).value+=Number(row.applied_principal||row.amount||0);});
  const max=Math.max(1,...months.map(item=>item.value));
  return months.map((item,index)=>({x:5+index*42,y:40-(item.value/max)*31,value:item.value}));
}

function metricCard(iconName,iconClass,label,value,note){return `<article class="ld-metric-card"><div class="ld-metric-main"><span class="ld-metric-icon ${iconClass}">${icon(iconName)}</span><div><div class="ld-metric-label">${label}</div><div class="ld-metric-value">${value}</div><div class="ld-metric-note">${note}</div></div></div></article>`;}

function recoveryCard(data,metrics){
  const points=trendPoints(data.payments);const poly=points.map(point=>`${point.x},${point.y}`).join(' ');const last=points[points.length-1];
  return `<article class="ld-recovery-card"><div class="ld-recovery-head"><span>Recuperación de capital</span><small class="ld-recovery-info">Cartera actual</small></div><div class="ld-recovery-rate">${metrics.recoveryRate.toFixed(1)}%</div><div class="ld-recovery-sub">${money(metrics.recovered)} de ${money(metrics.totalDisbursed)}</div><div class="ld-progress"><span style="width:${metrics.recoveryRate}%"></span></div><svg class="ld-trend" viewBox="0 0 220 45" preserveAspectRatio="none"><polyline points="${poly}"></polyline><circle cx="${last.x}" cy="${last.y}" r="3"></circle></svg></article>`;
}

function filteredAccounts(data){
  let rows=[...data.accounts];const query=state.search.trim().toLowerCase();
  if(query)rows=rows.filter(row=>`${row.full_name} ${borrowerCode(row.borrower_id)} ${row.phone||''}`.toLowerCase().includes(query));
  if(state.filter!=='ALL')rows=rows.filter(row=>statusInfo(row.account_status).key===state.filter);
  rows.sort((a,b)=>{
    if(state.sort==='BALANCE')return Number(b.principal_balance||0)-Number(a.principal_balance||0);
    if(state.sort==='NAME')return String(a.full_name).localeCompare(String(b.full_name));
    if(state.sort==='ACTIVITY')return String(data.latestByBorrower.get(b.borrower_id)?.date||'').localeCompare(String(data.latestByBorrower.get(a.borrower_id)?.date||''));
    return String(a.next_due_date||'9999-12-31').localeCompare(String(b.next_due_date||'9999-12-31'));
  });
  return rows;
}

function clientRows(data){
  const rows=filteredAccounts(data);
  if(!rows.length)return '<div class="ld-empty">No hay clientes que coincidan con estos filtros.</div>';
  return rows.map((row,index)=>{
    const status=statusInfo(row.account_status);const activity=data.latestByBorrower.get(row.borrower_id);
    return `<button type="button" class="ld-client-row" data-ld-borrower="${row.borrower_id}"><div class="ld-client-ident"><span class="ld-avatar ${avatarClass(index)}">${esc(initials(row.full_name))}</span><span><span class="ld-client-name">${esc(row.full_name)}</span><span class="ld-client-id">ID: ${borrowerCode(row.borrower_id)}</span></span></div><div class="ld-cell"><strong>${money(row.principal_balance)}</strong><small>Capital pendiente</small></div><div class="ld-cell"><strong>${money(row.current_cycle_fee)}</strong><small>15 y fin de mes</small></div><div class="ld-cell"><strong>${dateLabel(row.next_due_date)}</strong><small>${row.next_due_date?daysLabel(row.next_due_date):'Sin fecha'}</small></div><div><span class="ld-status ${status.className}">${status.label}</span></div><div class="ld-cell"><strong>${activity?activity.type==='PAYMENT'?'Pago recibido':'Desembolso':'Sin actividad'}</strong><small>${activity?dateLabel(activity.date):'—'}</small></div><div class="ld-arrow">›</div></button>`;
  }).join('');
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

function dashboardHtml(data){
  const metrics=metricData(data);
  return `<div class="ld-page-head"><div><h1 class="ld-page-title">Préstamos</h1><div class="ld-page-subtitle">Gestiona tu cartera de préstamos y el estado de tus clientes.</div></div><div class="ld-head-actions"><button type="button" class="ld-action ld-action-soft" id="ldNewClient">${icon('plus')} Nuevo cliente</button><button type="button" class="ld-action ld-action-primary" id="ldNewDisbursement">${icon('download')} Nuevo desembolso</button></div></div>
  <section class="ld-metric-grid">${metricCard('wallet','', 'Balance total pendiente',money(metrics.balance),'De capital')}${metricCard('users','lime','Total desembolsado',money(metrics.totalDisbursed),`${data.disbursements.length} desembolsos registrados`)}${metricCard('recover','coral','Capital recuperado',money(metrics.recovered),'Aplicado a capital')}${metricCard('clock','', 'Cuotas pendientes',money(metrics.pendingDues),`${metrics.overdue} clientes atrasados`)}${metricCard('users','blue','Clientes activos',String(metrics.active),`De ${metrics.total} clientes`)}${recoveryCard(data,metrics)}</section>
  <div class="ld-main-grid"><section class="ld-client-panel ${state.view==='grid'?'grid-mode':''}" id="ldClientPanel"><div class="ld-panel-title">Clientes</div><div class="ld-controls"><label class="ld-search">${icon('search')}<input id="ldSearch" placeholder="Buscar cliente por nombre o ID..." value="${esc(state.search)}"></label><div class="ld-filter-pills"><button data-filter="ALL" class="${state.filter==='ALL'?'active':''}">Todos</button><button data-filter="CURRENT" class="${state.filter==='CURRENT'?'active':''}">Al día</button><button data-filter="OVERDUE" class="${state.filter==='OVERDUE'?'active':''}">Atrasados</button><button data-filter="PAID_OFF" class="${state.filter==='PAID_OFF'?'active':''}">Saldados</button></div><select id="ldSort" class="ld-sort"><option value="NEXT_DUE" ${state.sort==='NEXT_DUE'?'selected':''}>Ordenar por: Próxima cuota</option><option value="BALANCE" ${state.sort==='BALANCE'?'selected':''}>Ordenar por: Balance</option><option value="ACTIVITY" ${state.sort==='ACTIVITY'?'selected':''}>Ordenar por: Actividad</option><option value="NAME" ${state.sort==='NAME'?'selected':''}>Ordenar por: Nombre</option></select><div class="ld-view-toggle"><button type="button" data-view="list" class="${state.view==='list'?'active':''}">${icon('list')}</button><button type="button" data-view="grid" class="${state.view==='grid'?'active':''}">${icon('grid')}</button></div></div><div class="ld-table-head"><span>Cliente</span><span>Balance pendiente</span><span>Cuota por ciclo</span><span>Próxima cuota</span><span>Estado</span><span>Último movimiento</span><span></span></div><div class="ld-client-list" id="ldClientList">${clientRows(data)}</div><div class="ld-client-foot"><span>Selecciona un cliente para ver su cuenta, pagos, desembolsos y seguimientos.</span><button type="button" id="ldGuide">Ver guía rápida ›</button></div></section><aside class="ld-side-stack"><section class="ld-side-card"><div class="ld-side-head"><strong>Próximos vencimientos</strong><button type="button" data-go-page="paymentsPage">Ver calendario</button></div>${upcomingHtml(data)}</section><section class="ld-side-card"><div class="ld-side-head"><strong>Actividad reciente</strong><button type="button" data-go-page="paymentsPage">Ver todo</button></div>${activityHtml(data)}</section></aside></div>`;
}

function repopulateBorrowerSelect(accounts){const select=$('loanBorrower');if(select)select.innerHTML=accounts.map(row=>`<option value="${row.borrower_id}">${esc(row.full_name)}</option>`).join('');}

async function renderDashboard(force=false){
  setupPage();const host=$('loansDashboardHost');if(!host||state.loading)return;
  if(!force&&state.data&&Date.now()-state.lastLoaded<12000){host.innerHTML=dashboardHtml(state.data);wireDashboard();return;}
  state.loading=true;if(!state.data)host.innerHTML='<div class="ld-empty">Cargando cartera...</div>';
  try{state.data=await loadData();state.lastLoaded=Date.now();repopulateBorrowerSelect(state.data.accounts);host.innerHTML=dashboardHtml(state.data);wireDashboard();}
  catch(error){console.error(error);host.innerHTML=`<div class="ld-empty">No se pudo cargar la cartera: ${esc(error.message||error)}</div>`;}
  finally{state.loading=false;}
}

function rerenderRows(){if(!state.data)return;const panel=$('ldClientPanel');if(panel)panel.classList.toggle('grid-mode',state.view==='grid');const list=$('ldClientList');if(list)list.innerHTML=clientRows(state.data);wireRowClicks();}
function showPage(id){document.querySelectorAll('.tab-btn').forEach(button=>button.classList.toggle('active',button.dataset.page===id));document.querySelectorAll('.page').forEach(page=>page.classList.toggle('active-page',page.id===id));$('sideMenu')?.classList.remove('open');$('menuOverlay')?.classList.remove('open');}

function wireDashboard(){
  $('ldNewClient')?.addEventListener('click',()=>openDrawer('client'));
  $('ldNewDisbursement')?.addEventListener('click',()=>openDrawer('disbursement'));
  $('ldSearch')?.addEventListener('input',event=>{state.search=event.target.value;rerenderRows();});
  $('ldSort')?.addEventListener('change',event=>{state.sort=event.target.value;rerenderRows();});
  document.querySelectorAll('#loansDashboardHost [data-filter]').forEach(button=>button.addEventListener('click',()=>{state.filter=button.dataset.filter;document.querySelectorAll('#loansDashboardHost [data-filter]').forEach(item=>item.classList.toggle('active',item===button));rerenderRows();}));
  document.querySelectorAll('#loansDashboardHost [data-view]').forEach(button=>button.addEventListener('click',()=>{state.view=button.dataset.view;document.querySelectorAll('#loansDashboardHost [data-view]').forEach(item=>item.classList.toggle('active',item===button));rerenderRows();}));
  document.querySelectorAll('#loansDashboardHost [data-go-page]').forEach(button=>button.addEventListener('click',()=>showPage(button.dataset.goPage)));
  $('ldGuide')?.addEventListener('click',()=>alert('Usa la búsqueda y los filtros para encontrar una cuenta. Selecciona una fila para abrir el perfil completo.'));
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
document.addEventListener('DOMContentLoaded',activate);
const app=$('app');if(app)new MutationObserver(activate).observe(app,{subtree:true,attributes:true,attributeFilter:['class','style']});
window.addEventListener('loan-ledger:dashboard-refresh',()=>renderDashboard(true));
setInterval(()=>{if(isLoansPage())renderDashboard(false);},15000);
setTimeout(activate,350);setTimeout(activate,1300);activate();

console.log('loans portfolio dashboard active');
