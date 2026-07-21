import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db=createClient(
  'https://eatxkhhpjruwwibhcubf.supabase.co',
  'sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q',
  {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:'loan-ledger-auth'}}
);

const moneyFormatter=new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const money=value=>`$${moneyFormatter.format(Number(value||0))}`;
let selectedPeriod='month';
let requestSeq=0;
let applying=false;

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

function ensureSelector(card){
  const chip=card.querySelector('.ld-recovery-chip');
  if(!chip)return null;
  let select=chip.querySelector('#ldRecoveryPeriod');
  if(select)return select;
  chip.innerHTML=`<select id="ldRecoveryPeriod" aria-label="Periodo del panorama de cartera"><option value="month">Este mes</option><option value="3m">Últimos 3 meses</option><option value="6m">Últimos 6 meses</option><option value="12m">Últimos 12 meses</option></select>`;
  select=chip.querySelector('#ldRecoveryPeriod');
  if(select)select.value=selectedPeriod;
  return select;
}

async function loadPeriod(key){
  const start=periodStart(key);
  const [paymentsRes,disbursementsRes]=await Promise.all([
    db.from('borrower_account_payments_view').select('paid_on,applied_principal,is_voided').eq('is_voided',false).gte('paid_on',start).order('paid_on',{ascending:true}),
    db.from('borrower_disbursements_view').select('start_date,principal_original').gte('start_date',start).order('start_date',{ascending:true})
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

function updateCard(card,data,key){
  const values=card.querySelectorAll('.ld-recovery-values strong');
  if(values[0])values[0].textContent=money(data.disbursed);
  if(values[1])values[1].textContent=money(data.recovered);

  const total=Math.max(1,data.disbursed+data.recovered);
  const disbursedPct=data.disbursed/total*100;
  const recoveredPct=data.recovered/total*100;
  const disbursedBar=card.querySelector('.ld-split-disbursed');
  const recoveredBar=card.querySelector('.ld-split-recovered');
  if(disbursedBar)disbursedBar.style.width=`${disbursedPct}%`;
  if(recoveredBar)recoveredBar.style.width=`${recoveredPct}%`;

  const rate=data.disbursed?Math.min(100,data.recovered/data.disbursed*100):0;
  const rateNode=card.querySelector('.ld-recovery-rate-big');
  if(rateNode)rateNode.textContent=`${rate.toFixed(1)}%`;
  const recoveredLabel=card.querySelector('.ld-recovery-bottom small');
  if(recoveredLabel)recoveredLabel.textContent=`${money(data.recovered)} recuperados · ${periodLabel(key).toLowerCase()}`;

  const points=buildTrend(data.payments,key);
  const poly=card.querySelector('.ld-trend-large polyline');
  const dot=card.querySelector('.ld-trend-large circle');
  if(poly)poly.setAttribute('points',points.map(point=>`${point.x},${point.y}`).join(' '));
  const last=points[points.length-1];
  if(dot&&last){dot.setAttribute('cx',last.x);dot.setAttribute('cy',last.y);}
}

async function refreshCard(){
  if(applying)return;
  const card=document.querySelector('#loansDashboardHost .ld-recovery-card.ld-recovery-advanced');
  if(!card)return;
  const select=ensureSelector(card);
  if(select)select.value=selectedPeriod;
  applying=true;
  const seq=++requestSeq;
  card.classList.add('ld-period-loading');
  try{
    const data=await loadPeriod(selectedPeriod);
    if(seq!==requestSeq||!document.contains(card))return;
    updateCard(card,data,selectedPeriod);
  }catch(error){console.error('portfolio period failed',error);}
  finally{if(document.contains(card))card.classList.remove('ld-period-loading');applying=false;}
}

document.addEventListener('change',event=>{
  if(event.target?.id!=='ldRecoveryPeriod')return;
  selectedPeriod=event.target.value||'month';
  refreshCard();
},true);

const app=document.getElementById('app');
if(app)new MutationObserver(()=>{
  const card=document.querySelector('#loansDashboardHost .ld-recovery-card.ld-recovery-advanced');
  if(!card)return;
  const select=ensureSelector(card);
  if(select)select.value=selectedPeriod;
  if(!card.dataset.periodReady){card.dataset.periodReady='1';setTimeout(refreshCard,20);}
}).observe(app,{childList:true,subtree:true});

setTimeout(refreshCard,350);setTimeout(refreshCard,1200);
console.log('loans dashboard period selector active');