let transitionBusy=false;

function waitFor(selector,timeout=2800){
  return new Promise(resolve=>{
    const ready=document.querySelector(selector);if(ready)return resolve(ready);
    const started=Date.now();
    const timer=setInterval(()=>{
      const node=document.querySelector(selector);
      if(node||Date.now()-started>timeout){clearInterval(timer);resolve(node||null);}
    },35);
  });
}

function clearNames(){
  document.querySelectorAll('[style*="view-transition-name"]').forEach(node=>node.style.viewTransitionName='');
}

async function openWithoutRerender(id,row){
  if(transitionBusy)return;
  transitionBusy=true;
  const panel=document.getElementById('ldClientPanel');
  const update=async()=>{
    window.dispatchEvent(new CustomEvent('loan-ledger:open-account',{detail:{borrowerId:id}}));
    const rail=await waitFor('#borrowerAccountPage.active-page .ll-client-rail');
    const selected=document.querySelector(`#borrowerAccountPage .ll-client-card[data-acct-borrower="${id}"]`);
    if(rail)rail.style.viewTransitionName='loan-client-list';
    if(selected)selected.style.viewTransitionName='loan-selected-client';
  };
  try{
    if(document.startViewTransition&&panel){
      panel.style.viewTransitionName='loan-client-list';
      row.style.viewTransitionName='loan-selected-client';
      const transition=document.startViewTransition(update);
      await transition.finished;
    }else{
      await update();
    }
  }catch(error){
    console.error('portfolio transition failed',error);
    window.dispatchEvent(new CustomEvent('loan-ledger:open-account',{detail:{borrowerId:id}}));
  }finally{
    clearNames();
    transitionBusy=false;
  }
}

document.addEventListener('click',event=>{
  const row=event.target.closest?.('#loansDashboardHost [data-ld-borrower]');
  if(!row)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openWithoutRerender(row.dataset.ldBorrower,row);
},true);

console.log('loans dashboard transition stabilization active');
