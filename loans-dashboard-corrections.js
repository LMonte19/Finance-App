function compactRecoveryPeriodOptions(){
  const select=document.getElementById('ldRecoveryPeriod');
  if(!select)return;
  const labels={month:'Este mes','3m':'3 meses','6m':'6 meses','12m':'12 meses'};
  [...select.options].forEach(option=>{if(labels[option.value])option.textContent=labels[option.value];});
}

function polishLoansDashboardCorrections(){
  compactRecoveryPeriodOptions();
}

const app=document.getElementById('app');
if(app)new MutationObserver(()=>queueMicrotask(polishLoansDashboardCorrections)).observe(app,{childList:true,subtree:true});
document.addEventListener('change',event=>{if(event.target?.id==='ldRecoveryPeriod')setTimeout(polishLoansDashboardCorrections,0);},true);
setTimeout(polishLoansDashboardCorrections,250);
setTimeout(polishLoansDashboardCorrections,900);
polishLoansDashboardCorrections();

console.log('loans dashboard corrections active');
