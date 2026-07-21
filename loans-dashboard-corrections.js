function compactRecoveryPeriodOptions(){
  const select=document.getElementById('ldRecoveryPeriod');
  if(!select)return false;
  const labels={month:'Este mes','3m':'3 meses','6m':'6 meses','12m':'12 meses'};
  let changed=false;
  [...select.options].forEach(option=>{
    const next=labels[option.value];
    if(next&&option.textContent!==next){option.textContent=next;changed=true;}
  });
  return changed;
}

function compactMetricNotes(){
  let changed=false;
  document.querySelectorAll('#loansDashboardHost .ld-metric-note').forEach(note=>{
    const current=note.textContent.trim();
    const next=current.replace(/\s+registrados$/i,'');
    if(next!==current){note.textContent=next;changed=true;}
  });
  return changed;
}

let scheduled=false;
function scheduleCorrection(){
  if(scheduled)return;
  scheduled=true;
  requestAnimationFrame(()=>{
    scheduled=false;
    compactRecoveryPeriodOptions();
    compactMetricNotes();
  });
}

function attachDashboardObserver(){
  const host=document.getElementById('loansDashboardHost');
  if(!host||host.dataset.correctionsObserver==='1')return;
  host.dataset.correctionsObserver='1';
  new MutationObserver(mutations=>{
    const needsCheck=mutations.some(mutation=>
      [...mutation.addedNodes].some(node=>
        node.nodeType===1&&(
          node.id==='ldRecoveryPeriod'||
          node.classList?.contains('ld-metric-card')||
          node.querySelector?.('#ldRecoveryPeriod,.ld-metric-card')
        )
      )
    );
    if(needsCheck)scheduleCorrection();
  }).observe(host,{childList:true,subtree:true});
  scheduleCorrection();
}

const app=document.getElementById('app');
if(app){
  new MutationObserver(mutations=>{
    const hostAdded=mutations.some(mutation=>
      [...mutation.addedNodes].some(node=>
        node.nodeType===1&&(
          node.id==='loansDashboardHost'||
          node.querySelector?.('#loansDashboardHost')
        )
      )
    );
    if(hostAdded)attachDashboardObserver();
  }).observe(app,{childList:true,subtree:false});
}

document.addEventListener('change',event=>{
  if(event.target?.id==='ldRecoveryPeriod')scheduleCorrection();
},true);

attachDashboardObserver();
setTimeout(attachDashboardObserver,300);
setTimeout(attachDashboardObserver,1000);

console.log('loans dashboard corrections active');
