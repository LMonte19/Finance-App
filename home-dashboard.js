import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase=createClient(
  "https://eatxkhhpjruwwibhcubf.supabase.co",
  "sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q",
  {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:"loan-ledger-auth"}}
);

function ensureStyle(){
  const href="./home-dashboard.css?v=1";
  let link=document.getElementById("homeDashboardCss");
  if(!link){link=document.createElement("link");link.id="homeDashboardCss";link.rel="stylesheet";document.head.appendChild(link);}
  link.href=href;
}
ensureStyle();

const qs=id=>document.getElementById(id);
const money=n=>`$${Math.round(Number(n||0)).toLocaleString("en-US")}`;
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const todayIso=()=>new Date().toISOString().slice(0,10);
const addDays=(iso,days)=>{const d=new Date(`${iso}T00:00:00`);d.setDate(d.getDate()+days);return d.toISOString().slice(0,10);};
const monthKey=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;
const previousMonthKey=()=>{const d=new Date();d.setMonth(d.getMonth()-1);return monthKey(d);};
const initials=name=>String(name||"?").trim().split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()||"").join("")||"?";

let dataCache=null;
let loading=false;
let lastLoadAt=0;
let operationTab="dues";
const REFRESH_MS=45000;

const ICONS={
  wallet:'<path d="M5 6.5h12.5A2.5 2.5 0 0 1 20 9v9a2 2 0 0 1-2 2H6a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2h11"/><path d="M15 11h5v5h-5a2.5 2.5 0 0 1 0-5Z"/>',
  alert:'<path d="M10.2 4.4 3.6 16a2 2 0 0 0 1.8 3h13.2a2 2 0 0 0 1.8-3L13.8 4.4a2 2 0 0 0-3.6 0Z"/><path d="M12 9v4M12 16h.01"/>',
  dollar:'<circle cx="12" cy="12" r="8.5"/><path d="M15.2 8.5c-.7-.8-1.7-1.2-3.2-1.2-1.8 0-3 .8-3 2 0 3 6 1.2 6 4.2 0 1.3-1.2 2.2-3.2 2.2-1.6 0-2.8-.5-3.6-1.4M12 5.5v13"/>',
  calendar:'<rect x="4" y="5.5" width="16" height="14" rx="2.5"/><path d="M8 3.5v4M16 3.5v4M4 9.5h16"/>',
  users:'<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.5-4 2.4-6 5.5-6s5 2 5.5 6M15.5 7.5a2.5 2.5 0 0 1 0 5M16 14c2.7.2 4.2 1.9 4.5 5"/>',
  shield:'<path d="M12 3.5 19 6v5.5c0 4.3-2.7 7.3-7 9-4.3-1.7-7-4.7-7-9V6l7-2.5Z"/><path d="M12 8v6M9 11h6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  card:'<rect x="3.5" y="6" width="17" height="12" rx="2.5"/><path d="M3.5 10h17M8 14h3"/>',
  chart:'<path d="M4 19V5M4 19h16"/><path d="m7 15 4-5 3 2 5-6"/>',
  message:'<path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.6 8.6 0 0 1-3.4-.7L4 20l1.7-4.2A7.3 7.3 0 0 1 4 11.5 7.5 7.5 0 0 1 12 4a7.5 7.5 0 0 1 8 7.5Z"/>',
  chevron:'<path d="m9 6 6 6-6 6"/>',
  arrowUp:'<path d="m7 14 5-5 5 5"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>',
  edit:'<path d="m5 16.5-.8 3.3 3.3-.8L18 8.5 15.5 6 5 16.5Z"/><path d="m14 7.5 2.5 2.5"/>'
};
function svg(name,size=17){return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]||ICONS.wallet}</svg>`;}

function isHome(){return qs("dashboardPage")?.classList.contains("active-page");}
function fmtDate(iso){if(!iso)return "—";const d=new Date(`${String(iso).slice(0,10)}T00:00:00`);if(Number.isNaN(d.getTime()))return iso;return d.toLocaleDateString("es",{day:"2-digit",month:"short",year:"numeric"}).replace(".","");}
function relativeDate(value){if(!value)return "—";const d=new Date(value),now=new Date(),diff=now-d;if(diff<60000)return "Ahora";if(diff<3600000)return `Hace ${Math.max(1,Math.floor(diff/60000))} min`;if(diff<86400000)return `Hace ${Math.max(1,Math.floor(diff/3600000))} h`;if(diff<172800000)return "Ayer";return d.toLocaleDateString("es",{day:"numeric",month:"short",year:"numeric"}).replace(".","");}

function ensureDom(){
  const page=qs("dashboardPage");
  if(!page||qs("homeDashboard"))return;
  page.classList.add("ll-home-page");
  page.innerHTML=`<div id="homeDashboard" class="ll-home-dashboard" data-no-translate="true">
    <header class="ll-home-header">
      <div><h1>Control de Préstamos</h1><p id="homeIdentity">Resumen general de cartera, pagos y próximas acciones.</p></div>
      <div class="ll-home-updated"><span>Actualizado ahora</span><i></i></div>
    </header>

    <section class="ll-home-summary" aria-label="Resumen general">
      <div class="ll-home-section-title"><h2>Resumen general</h2></div>
      <div id="homeKpis" class="ll-home-kpis">${kpiSkeleton().repeat(4)}</div>
    </section>

    <section class="ll-home-analytics">
      <article class="ll-home-portfolio"><div class="ll-analytics-title"><h3>Estado de cartera</h3><p>Distribución de cartera</p></div><div id="homePortfolioChart"></div></article>
      <article class="ll-home-recovery"><div class="ll-analytics-title"><h3>Recuperación del mes</h3><p>Pagos recibidos</p></div><div id="homeRecoveryChart"></div><div id="homeRecoveryGoal"></div></article>
      <article class="ll-home-monthly"><div class="ll-analytics-title"><h3>Resumen mensual</h3></div><div id="homeMonthlySummary"></div></article>
    </section>

    <section class="ll-home-actions"><h3>Acciones rápidas</h3><div class="ll-home-action-grid">
      <button type="button" data-home-action="loan" class="lime">${svg("plus",20)}<span>Nuevo desembolso</span></button>
      <button type="button" data-home-action="payment" class="purple">${svg("card",20)}<span>Registrar pago</span></button>
      <button type="button" data-home-action="followup" class="blue">${svg("chart",20)}<span>Seguimiento</span></button>
      <button type="button" data-home-action="contact" class="blue">${svg("message",20)}<span>Nota de contacto</span></button>
    </div></section>

    <section class="ll-home-middle">
      <article class="ll-home-priority"><div class="ll-home-card-head"><h3>Prioridad de hoy</h3><button type="button" data-home-view="priority">Ver todo</button></div><div id="homePriorityList"></div></article>
      <article class="ll-home-operations"><div class="ll-home-card-head"><h3>Operaciones</h3><button type="button" data-home-view="operations">Ver todo</button></div><nav class="ll-home-operation-tabs"><button type="button" data-operation-tab="dues" class="active">Próximas cuotas</button><button type="button" data-operation-tab="payments">Pagos recientes</button><button type="button" data-operation-tab="activity">Actividad</button></nav><div id="homeOperationsBody"></div></article>
    </section>

    <section class="ll-home-activity"><div class="ll-home-card-head"><h3>Actividad reciente</h3><button type="button" data-home-view="activity">Ver todo</button></div><div id="homeActivityFeed"></div></section>
  </div>`;
  wire();
}
function kpiSkeleton(){return `<article class="ll-home-kpi is-loading"><span class="ll-home-kpi-icon"></span><div><small>—</small><strong>—</strong><p>—</p></div></article>`;}

function wire(){
  const root=qs("homeDashboard");if(!root||root.dataset.bound==="1")return;root.dataset.bound="1";
  root.addEventListener("click",event=>{
    const action=event.target.closest("[data-home-action]")?.dataset.homeAction;
    if(action){runQuickAction(action);return;}
    const tab=event.target.closest("[data-operation-tab]")?.dataset.operationTab;
    if(tab){operationTab=tab;renderOperations();return;}
    const client=event.target.closest("[data-home-client]")?.dataset.homeClient;
    if(client){window.dispatchEvent(new CustomEvent("loan-ledger:open-account",{detail:{borrowerId:client}}));return;}
    const payment=event.target.closest("[data-home-payment]")?.dataset.homePayment;
    if(payment){goToPayments();return;}
    const view=event.target.closest("[data-home-view]")?.dataset.homeView;
    if(view)openRelatedView(view);
  });
}
function activatePage(id){
  const tab=document.querySelector(`.tab-btn[data-page="${id}"]`);
  if(tab){tab.click();return;}
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active-page"));qs(id)?.classList.add("active-page");
}
function goToPayments(){activatePage("paymentsPage");}
function runQuickAction(action){
  if(action==="loan"){activatePage("loansPage");setTimeout(()=>qs("loanBorrower")?.focus(),80);return;}
  if(action==="payment"){goToPayments();setTimeout(()=>qs("llOpenPaymentDrawer")?.click(),100);return;}
  if(action==="followup"){qs("menuFollowups")?.click();setTimeout(()=>qs("followupBorrower")?.focus(),100);return;}
  if(action==="contact"){qs("menuFollowups")?.click();setTimeout(()=>qs("contactBorrower")?.focus(),100);}
}
function openRelatedView(view){
  if(view==="activity"){qs("menuActivity")?.click();return;}
  if(view==="priority"){activatePage("loansPage");return;}
  if(view==="operations"){
    if(operationTab==="payments")goToPayments();
    else if(operationTab==="activity")qs("menuActivity")?.click();
    else activatePage("loansPage");
  }
}

async function fetchUpcomingDue(activeAccounts){
  const today=todayIso(),end=addDays(today,45);
  const chunks=await Promise.all(activeAccounts.map(async account=>{
    const {data,error}=await supabase.rpc("get_borrower_due_calendar",{p_borrower_id:account.borrower_id,p_start_date:today,p_end_date:end});
    if(error){console.warn("home due calendar",account.full_name,error);return [];}
    return (data||[]).map(row=>({...row,full_name:account.full_name,borrower_id:account.borrower_id}));
  }));
  return chunks.flat().map(row=>({...row,amount_due:Number(row.amount_due||0)})).filter(row=>row.amount_due>0&&row.status!=="CANCELLED"&&row.due_date>=today).sort((a,b)=>a.due_date.localeCompare(b.due_date)||String(a.full_name||"").localeCompare(String(b.full_name||"")));
}

async function fetchData(){
  const [accountsRes,paymentsRes,activityRes]=await Promise.all([
    supabase.from("borrower_account_summary").select("*").order("principal_balance",{ascending:false}).limit(250),
    supabase.from("borrower_account_payments_view").select("*").order("paid_on",{ascending:false}).order("created_at",{ascending:false}).limit(300),
    supabase.from("activity_log_view").select("*").order("created_at",{ascending:false}).limit(30)
  ]);
  if(accountsRes.error)throw accountsRes.error;if(paymentsRes.error)throw paymentsRes.error;if(activityRes.error)throw activityRes.error;
  const accounts=accountsRes.data||[];
  const activeAccounts=accounts.filter(a=>Number(a.principal_balance||0)>0);
  const upcomingDue=await fetchUpcomingDue(activeAccounts);
  const payments=paymentsRes.data||[];
  const activePayments=payments.filter(p=>!p.is_voided);
  const currentMonth=monthKey(),previousMonth=previousMonthKey();
  const monthPayments=activePayments.filter(p=>String(p.paid_on||"").slice(0,7)===currentMonth);
  const previousPayments=activePayments.filter(p=>String(p.paid_on||"").slice(0,7)===previousMonth);
  const sum=(rows,field)=>rows.reduce((total,row)=>total+Number(row[field]||0),0);
  const activeCapital=sum(activeAccounts,"principal_balance");
  const overdueAccounts=activeAccounts.filter(a=>Number(a.overdue_amount||0)>0).sort((a,b)=>Number(b.overdue_amount||0)-Number(a.overdue_amount||0));
  const currentAccounts=activeAccounts.filter(a=>Number(a.overdue_amount||0)<=0);
  const closedAccounts=accounts.filter(a=>Number(a.principal_balance||0)<=0||["PAID_OFF","CLOSED"].includes(String(a.account_status||"").toUpperCase()));
  const overdueTotal=sum(overdueAccounts,"overdue_amount");
  const monthPaid=sum(monthPayments,"amount");
  const previousPaid=sum(previousPayments,"amount");
  const monthlyFee=sum(activeAccounts,"current_monthly_fee");
  const monthlyMgmt=sum(activeAccounts,"current_monthly_mgmt");
  const monthlyFunders=sum(activeAccounts,"current_monthly_funders");
  const dueSoon=upcomingDue.filter(row=>row.due_date<=addDays(todayIso(),7));
  const dueSoonAmount=sum(dueSoon,"amount_due");
  return {accounts,activeAccounts,currentAccounts,overdueAccounts,closedAccounts,activeCapital,overdueTotal,payments,activePayments,monthPayments,monthPaid,previousPaid,monthlyFee,monthlyMgmt,monthlyFunders,upcomingDue,dueSoon,dueSoonAmount,activity:activityRes.data||[]};
}

async function refresh(force=false){
  ensureDom();if(!isHome()||loading)return;
  if(!force&&dataCache&&Date.now()-lastLoadAt<REFRESH_MS){render(dataCache);return;}
  loading=true;
  try{dataCache=await fetchData();lastLoadAt=Date.now();render(dataCache);}catch(error){console.error("home dashboard load failed",error);showError(error);}finally{loading=false;}
}
function showError(error){const host=qs("homeKpis");if(host)host.innerHTML=`<div class="ll-home-error">${esc(error.message||error)}</div>`;}

function render(data){
  renderKpis(data);renderPortfolio(data);renderRecovery(data);renderMonthly(data);renderPriority(data);renderOperations();renderActivity(data);
  const stamp=qs("homeDashboard")?.querySelector(".ll-home-updated span");if(stamp)stamp.textContent="Actualizado ahora";
}
function renderKpis(data){
  const host=qs("homeKpis");if(!host)return;
  const overduePct=data.activeCapital?Math.round((data.overdueTotal/data.activeCapital)*100):0;
  const change=data.previousPaid?Math.round(((data.monthPaid-data.previousPaid)/Math.abs(data.previousPaid))*100):null;
  const changeText=change===null?(data.monthPaid?"Nuevo vs. mes anterior":"Sin cambio vs. mes anterior"):`${change>=0?"↑":"↓"} ${Math.abs(change)}% vs mes anterior`;
  const cards=[
    ["lime","wallet","Capital activo",money(data.activeCapital),"Total en cartera"],
    ["coral","alert","Atrasado total",money(data.overdueTotal),`${overduePct}% de la cartera`],
    ["purple","dollar","Pagos del mes",money(data.monthPaid),changeText],
    ["lime","calendar","Próximas cuotas",money(data.dueSoonAmount),`${data.dueSoon.length} vencen pronto`]
  ];
  host.innerHTML=cards.map(([tone,icon,label,value,sub])=>`<article class="ll-home-kpi ${tone}"><span class="ll-home-kpi-icon">${svg(icon,21)}</span><div><small>${label}</small><strong>${value}</strong><p>${sub}</p></div></article>`).join("");
}
function renderPortfolio(data){
  const host=qs("homePortfolioChart");if(!host)return;
  const current=data.currentAccounts.length,overdue=data.overdueAccounts.length,closed=data.closedAccounts.length,total=Math.max(1,current+overdue+closed);
  const currentPct=Math.round(current/total*100),overduePct=Math.round(overdue/total*100),closedPct=Math.max(0,100-currentPct-overduePct);
  const gradient=`conic-gradient(#8dcc35 0 ${currentPct}%,#ff6262 ${currentPct}% ${currentPct+overduePct}%,#6f49e8 ${currentPct+overduePct}% 100%)`;
  host.innerHTML=`<div class="ll-portfolio-layout"><div class="ll-donut" style="background:${gradient}"><div><small>Total</small><strong>${money(data.activeCapital)}</strong></div></div><div class="ll-donut-legend"><span><i class="lime"></i>Al día <b>${currentPct}%</b></span><span><i class="coral"></i>Atrasado <b>${overduePct}%</b></span><span><i class="purple"></i>Saldado <b>${closedPct}%</b></span></div></div>`;
}
function renderRecovery(data){
  const host=qs("homeRecoveryChart");if(!host)return;
  const days=new Date(new Date().getFullYear(),new Date().getMonth()+1,0).getDate();
  const byDay=Array.from({length:days},()=>0);
  data.monthPayments.forEach(p=>{const day=Number(String(p.paid_on||"").slice(8,10));if(day>=1&&day<=days)byDay[day-1]+=Number(p.amount||0);});
  let running=0;const cumulative=byDay.map(v=>(running+=v));const max=Math.max(1,...cumulative);const W=520,H=155,padX=20,padY=15,plotW=W-padX*2,plotH=H-padY*2;
  const points=cumulative.map((v,i)=>`${padX+(i/(Math.max(1,days-1)))*plotW},${H-padY-(v/max)*plotH}`).join(" ");
  const bars=byDay.map((v,i)=>{const x=padX+(i/days)*plotW+2,w=Math.max(3,plotW/days-4),h=(v/max)*plotH,y=H-padY-h;return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(2,h).toFixed(1)}" rx="2"/>`;}).join("");
  host.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Recuperación acumulada del mes"><g class="bars">${bars}</g><polyline points="${points}"/></svg><div class="ll-chart-axis"><span>1</span><span>8</span><span>15</span><span>22</span><span>${days}</span></div>`;
  const goalHost=qs("homeRecoveryGoal");if(goalHost){const goal=Math.max(data.monthlyFee,data.monthPaid,1);const pct=Math.min(100,Math.round(data.monthPaid/goal*100));goalHost.innerHTML=`<div><span>Meta mensual: <b>${money(goal)}</b></span><strong>${pct}% alcanzado</strong></div><i><b style="width:${pct}%"></b></i>`;}
}
function renderMonthly(data){
  const host=qs("homeMonthlySummary");if(!host)return;
  host.innerHTML=`${monthlyRow("purple","dollar","Cuota mensual total",money(data.monthlyFee),"Total a cobrar")}${monthlyRow("lime","users","Socios mensual",money(data.monthlyFunders),"Participaciones")}${monthlyRow("blue","shield","Administración",money(data.monthlyMgmt),"Comisiones")}`;
}
function monthlyRow(tone,icon,label,value,sub){return `<div class="ll-monthly-row"><span class="${tone}">${svg(icon,20)}</span><div><small>${label}</small><strong>${value}</strong><p>${sub}</p></div></div>`;}
function renderPriority(data){
  const host=qs("homePriorityList");if(!host)return;
  const rows=data.overdueAccounts.slice(0,4);
  host.innerHTML=rows.length?rows.map(a=>`<button type="button" class="ll-priority-row" data-home-client="${esc(a.borrower_id)}"><i>${esc(initials(a.full_name))}</i><strong>${esc(a.full_name||"Cliente")}</strong><em>ATRASADO</em><span>${Number(a.overdue_count||0)} cuotas&nbsp;&nbsp;·&nbsp;&nbsp;${Number(a.max_days_late||0)} días tarde</span><b>${money(a.overdue_amount)}</b>${svg("chevron",14)}</button>`).join(""):`<div class="ll-home-empty">No hay cuentas atrasadas.</div>`;
}
function renderOperations(){
  if(!dataCache)return;
  document.querySelectorAll("[data-operation-tab]").forEach(btn=>btn.classList.toggle("active",btn.dataset.operationTab===operationTab));
  const host=qs("homeOperationsBody");if(!host)return;
  if(operationTab==="payments"){
    const rows=dataCache.activePayments.slice(0,5);host.innerHTML=tableHeader(["Cliente","Monto","Fecha","Detalle",""])+rows.map(p=>`<button class="ll-operation-row payment" type="button" data-home-payment="${esc(p.id)}"><strong>${esc(p.borrower_name||"Cliente")}</strong><b>${money(p.amount)}</b><span>${fmtDate(p.paid_on)}</span><small>Cuota ${money(p.applied_interest)} · Capital ${money(p.applied_principal)}</small>${svg("chevron",13)}</button>`).join("");return;
  }
  if(operationTab==="activity"){
    const rows=meaningfulActivity(dataCache.activity).slice(0,5);host.innerHTML=rows.length?rows.map(activityCompact).join(""):`<div class="ll-home-empty">No hay actividad reciente.</div>`;return;
  }
  const rows=dataCache.upcomingDue.slice(0,5);host.innerHTML=tableHeader(["Cliente","Monto","Fecha","Estado",""])+rows.map(d=>`<button class="ll-operation-row" type="button" data-home-client="${esc(d.borrower_id)}"><strong>${esc(d.borrower_name||d.full_name||"Cliente")}</strong><b>${money(d.amount_due)}</b><span>${fmtDate(d.due_date)}</span><em class="${d.is_virtual?"virtual":"registered"}">${d.is_virtual?"Virtual":"Registrada"}</em>${svg("chevron",13)}</button>`).join("");
}
function tableHeader(labels){return `<div class="ll-operation-head">${labels.map(x=>`<span>${x}</span>`).join("")}</div>`;}

const ACTION_LABELS={
  PARTNER_ALLOCATION_CREATED:"Asignación de socios creada",PARTNER_ALLOCATION_EDITED:"Asignación de socios actualizada",PARTNER_ALLOCATION_REVERSED:"Asignación de socios revertida",
  ACCOUNT_PAYMENT_RECORDED:"Pago registrado",PAYMENT_EDITED:"Pago actualizado",ACCOUNT_PAYMENT_VOIDED:"Pago anulado",
  CLIENT_CREATED:"Cliente agregado",CLIENT_EDITED:"Cliente actualizado",DISBURSEMENT_CREATED:"Nuevo desembolso",DISBURSEMENT_EDITED:"Desembolso actualizado",
  FOLLOWUP_CREATED:"Seguimiento creado",FOLLOWUP_EDITED:"Seguimiento actualizado",CONTACT_NOTE_CREATED:"Nota de contacto creada"
};
function meaningfulActivity(rows){return (rows||[]).filter(row=>ACTION_LABELS[row.action_type]||["borrowers","payments","loans","loan_funding","payment_allocations","borrower_followups","borrower_contact_log"].includes(row.entity_table));}
function activityTitle(row){return ACTION_LABELS[row.action_type]||String(row.action_type||"Actividad").replaceAll("_"," ").toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());}
function activitySub(row){if(row.summary)return row.summary;const name=row.borrower_name||row.entity_text||"";if(row.payment_amount!=null)return `${name}${name?" · ":""}${money(row.payment_amount)}`;return name||"Actualización del sistema";}
function activityIcon(row){const key=String(row.action_type||"");if(key.includes("PAYMENT"))return ["purple","edit"];if(key.includes("PARTNER"))return ["lime","users"];if(key.includes("CLIENT"))return ["blue","users"];return ["purple","edit"];}
function activityCompact(row){const [tone,icon]=activityIcon(row);return `<div class="ll-operation-activity"><span class="${tone}">${svg(icon,16)}</span><div><strong>${esc(activityTitle(row))}</strong><small>${esc(activitySub(row))}</small></div><time>${esc(relativeDate(row.created_at))}</time></div>`;}
function renderActivity(data){
  const host=qs("homeActivityFeed");if(!host)return;const rows=meaningfulActivity(data.activity).slice(0,3);
  host.innerHTML=rows.length?rows.map(row=>{const [tone,icon]=activityIcon(row);return `<div class="ll-activity-item"><span class="${tone}">${svg(icon,18)}</span><div><strong>${esc(activityTitle(row))}</strong><small>${esc(activitySub(row))}</small></div><time>${esc(relativeDate(row.created_at))}</time></div>`;}).join(""):`<div class="ll-home-empty">No hay actividad reciente.</div>`;
}

function tick(){ensureDom();if(isHome())refresh(false);}
const pageNode=qs("dashboardPage");if(pageNode)new MutationObserver(()=>setTimeout(tick,40)).observe(pageNode,{attributes:true,attributeFilter:["class"]});
setInterval(()=>{if(isHome())refresh(false);},REFRESH_MS);
tick();

console.log("modern home dashboard active");
