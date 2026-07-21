import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db=createClient(
  'https://eatxkhhpjruwwibhcubf.supabase.co',
  'sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q',
  {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:'loan-ledger-auth'}}
);

let metricCache=null;
let metricCacheAt=0;
let loading=false;
let polishScheduled=false;

const sum=(rows,field)=>rows.reduce((total,row)=>total+Number(row[field]||0),0);
const iso=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const percent=(current,previous)=>{
  current=Number(current||0);previous=Number(previous||0);
  if(previous===0)return current===0?0:100;
  return ((current-previous)/Math.abs(previous))*100;
};
const formatPct=value=>`${Math.abs(Number(value||0)).toFixed(1)}%`;

function statusKey(value){
  const key=String(value||'').toUpperCase();
  if(['PAID_OFF','CLOSED','PAID','SALDADO'].includes(key))return 'PAID_OFF';
  if(['OVERDUE','ATRASADO'].includes(key))return 'OVERDUE';
  return 'CURRENT';
}

async function loadMetrics(){
  if(metricCache&&Date.now()-metricCacheAt<30000)return metricCache;
  const now=new Date();
  const monthStart=iso(new Date(now.getFullYear(),now.getMonth(),1));
  const [accountsRes,paymentsRes,disbursementsRes]=await Promise.all([
    db.from('borrower_account_summary').select('principal_balance,total_disbursed,total_principal_paid,overdue_amount,due_today_amount,account_status'),
    db.from('borrower_account_payments_view').select('paid_on,applied_principal,is_voided').eq('is_voided',false).gte('paid_on',monthStart),
    db.from('borrower_disbursements_view').select('start_date,principal_original').gte('start_date',monthStart)
  ]);
  for(const result of [accountsRes,paymentsRes,disbursementsRes])if(result.error)throw result.error;
  const accounts=accountsRes.data||[];
  const payments=paymentsRes.data||[];
  const disbursements=disbursementsRes.data||[];
  const currentBalance=sum(accounts,'principal_balance');
  const currentDisbursed=sum(accounts,'total_disbursed');
  const currentRecovered=sum(accounts,'total_principal_paid');
  const principalPaidThisMonth=sum(payments,'applied_principal');
  const disbursedThisMonth=sum(disbursements,'principal_original');
  const previousBalance=currentBalance-disbursedThisMonth+principalPaidThisMonth;
  const previousDisbursed=currentDisbursed-disbursedThisMonth;
  const previousRecovered=currentRecovered-principalPaidThisMonth;
  const pendingDues=sum(accounts,'overdue_amount')+sum(accounts,'due_today_amount');
  const active=accounts.filter(row=>statusKey(row.account_status)!=='PAID_OFF').length;
  metricCache={
    balanceChange:percent(currentBalance,previousBalance),
    disbursedChange:percent(currentDisbursed,previousDisbursed),
    recoveredChange:percent(currentRecovered,previousRecovered),
    pendingShare:currentBalance?pendingDues/currentBalance*100:0,
    activeShare:accounts.length?active/accounts.length*100:0
  };
  metricCacheAt=Date.now();
  return metricCache;
}

function trendHtml(value,label,{inverse=false,neutral=false}={}){
  const numeric=Number(value||0);
  const favorable=inverse?numeric<=0:numeric>=0;
  const tone=neutral?'neutral':favorable?'good':'bad';
  const arrow=neutral?'•':numeric>0?'↑':numeric<0?'↓':'•';
  return `<div class="ld-metric-change ${tone}"><span class="ld-trend-arrow">${arrow}</span><strong>${formatPct(numeric)}</strong><span>${label}</span></div>`;
}

async function applyMetricFooters(){
  const cards=[...document.querySelectorAll('#loansDashboardHost .ld-metric-card')];
  if(cards.length<5||loading)return;
  loading=true;
  try{
    const metrics=await loadMetrics();
    const footers=[
      trendHtml(metrics.balanceChange,'vs. inicio de mes'),
      trendHtml(metrics.disbursedChange,'vs. inicio de mes'),
      trendHtml(metrics.recoveredChange,'vs. inicio de mes'),
      trendHtml(metrics.pendingShare,'del balance pendiente',{neutral:true}),
      trendHtml(metrics.activeShare,'de clientes activos',{neutral:true})
    ];
    cards.slice(0,5).forEach((card,index)=>{
      const next=footers[index];
      if(card.dataset.metricFooter===next)return;
      card.querySelector('.ld-metric-change')?.remove();
      card.insertAdjacentHTML('beforeend',next);
      card.dataset.metricFooter=next;
    });
  }catch(error){console.error('loans metric polish failed',error);}
  finally{loading=false;}
}

function polishControls(){
  const host=document.getElementById('loansDashboardHost');
  if(!host)return;
  host.querySelectorAll('.ld-client-id').forEach(node=>node.remove());
  const search=host.querySelector('#ldSearch');
  if(search&&search.placeholder!=='Buscar cliente por nombre...')search.placeholder='Buscar cliente por nombre...';
  const sort=host.querySelector('#ldSort');
  if(sort){
    const nextTitle=sort.selectedOptions?.[0]?.textContent||'Ordenar clientes';
    if(sort.title!==nextTitle)sort.title=nextTitle;
  }
}

function polish(){
  const host=document.getElementById('loansDashboardHost');
  if(!host)return;
  polishControls();
  applyMetricFooters();
}

function schedulePolish(){
  if(polishScheduled)return;
  polishScheduled=true;
  requestAnimationFrame(()=>{
    polishScheduled=false;
    polish();
  });
}

function attachHostObserver(){
  const host=document.getElementById('loansDashboardHost');
  if(!host||host.dataset.polishObserver==='1')return;
  host.dataset.polishObserver='1';
  new MutationObserver(mutations=>{
    const meaningful=mutations.some(mutation=>
      [...mutation.addedNodes].some(node=>node.nodeType===1&&(
        node.classList?.contains('ld-metric-card')||
        node.classList?.contains('ld-client-row')||
        node.querySelector?.('.ld-metric-card,.ld-client-row,#ldSearch,#ldSort')
      ))
    );
    if(meaningful)schedulePolish();
  }).observe(host,{childList:true,subtree:true});
  schedulePolish();
}

const app=document.getElementById('app');
if(app)new MutationObserver(mutations=>{
  const hostAdded=mutations.some(mutation=>
    [...mutation.addedNodes].some(node=>node.nodeType===1&&(
      node.id==='loansDashboardHost'||node.querySelector?.('#loansDashboardHost')
    ))
  );
  if(hostAdded)attachHostObserver();
}).observe(app,{childList:true,subtree:false});

window.addEventListener('loan-ledger:dashboard-refresh',()=>{
  metricCache=null;metricCacheAt=0;
  setTimeout(()=>{attachHostObserver();schedulePolish();},120);
});
setInterval(()=>{
  if(document.getElementById('loansPage')?.classList.contains('active-page'))schedulePolish();
},5000);
setTimeout(()=>{attachHostObserver();schedulePolish();},250);
setTimeout(()=>{attachHostObserver();schedulePolish();},1000);
attachHostObserver();

console.log('loans dashboard polish active');
