function ensureMountGateStyle(){
  const href='./client-final-mount-gate.css?v=3';
  let link=document.getElementById('clientFinalMountGateCss');
  if(link){ if(link.getAttribute('href')!==href) link.setAttribute('href',href); return; }
  link=document.createElement('link');
  link.id='clientFinalMountGateCss';
  link.rel='stylesheet';
  link.href=href;
  document.head.appendChild(link);
}
ensureMountGateStyle();

let pendingBorrowerId=null;
let mountSequence=0;
let switching=false;
let loansFreezeObserver=null;
let loansFreezeSnapshot=null;
let loansFreezeRestoring=false;

function accountPage(){ return document.getElementById('borrowerAccountPage'); }
function accountContent(){ return document.getElementById('borrowerAccountContent'); }

function ensureAccountPage(){
  const app=document.getElementById('app');
  if(!app) return null;
  let page=accountPage();
  if(page) return page;
  page=document.createElement('div');
  page.id='borrowerAccountPage';
  page.className='page';
  page.innerHTML='<div id="borrowerAccountContent"></div>';
  app.appendChild(page);
  return page;
}

function showAccountPage(){
  const page=ensureAccountPage();
  if(!page) return;
  document.querySelectorAll('.tab-btn').forEach(button=>button.classList.remove('active'));
  document.querySelectorAll('.page').forEach(node=>node.classList.remove('active-page'));
  page.classList.add('active-page');
  document.getElementById('sideMenu')?.classList.remove('open');
  document.getElementById('menuOverlay')?.classList.remove('open');
}

function finalProfileReady(targetId){
  const root=accountContent()?.querySelector('.ll-account-shell');
  if(!root) return false;
  const active=root.querySelector('.ll-client-card.active[data-acct-borrower]');
  if(!active || String(active.dataset.acctBorrower)!==String(targetId)) return false;
  if(root.dataset.functionalTabs!=='ready') return false;
  if(root.dataset.visualPolished!=='1') return false;
  if(!root.classList.contains('ll-tabs-ready')) return false;
  if(!root.classList.contains('ll-elegant-profile')) return false;
  if(!root.classList.contains('ll-reference-match')) return false;
  if(!root.querySelector('.ll-profile-tabs-host [data-profile-panel].active')) return false;
  if(!root.querySelector('.ll-elegant-metric-icon')) return false;
  if(!root.querySelector('.ll-collapsed-client-marker')) return false;
  return true;
}

function waitForFinal(targetId,sequence,timeout=5000){
  return new Promise(resolve=>{
    let stable=0;
    const started=performance.now();
    const tick=()=>{
      if(sequence!==mountSequence) return resolve(false);
      if(finalProfileReady(targetId)) stable+=1; else stable=0;
      if(stable>=3) return requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true)));
      if(performance.now()-started>=timeout) return resolve(false);
      setTimeout(tick,38);
    };
    tick();
  });
}

function dispatchRender(id,source){
  window.dispatchEvent(new CustomEvent('loan-ledger:account-rendered',{detail:{borrowerId:id,source}}));
}

function clearEntryClass(page){
  if(!page) return;
  setTimeout(()=>page.classList.remove('ll-client-entry'),620);
}

function restoreFrozenLoansValues(){
  if(loansFreezeRestoring || !loansFreezeSnapshot) return;
  const host=document.getElementById('loansDashboardHost');
  if(!host) return;
  loansFreezeRestoring=true;
  try{
    const metricGrid=host.querySelector('.ld-metric-grid');
    if(metricGrid && loansFreezeSnapshot.metricGrid!==null && metricGrid.innerHTML!==loansFreezeSnapshot.metricGrid){
      metricGrid.innerHTML=loansFreezeSnapshot.metricGrid;
    }
    const recovery=host.querySelector('.ld-recovery-card');
    if(recovery && loansFreezeSnapshot.recovery!==null && recovery.innerHTML!==loansFreezeSnapshot.recovery){
      recovery.innerHTML=loansFreezeSnapshot.recovery;
    }
  }finally{
    loansFreezeRestoring=false;
  }
}

function startLoansVisualFreeze(){
  stopLoansVisualFreeze();
  const host=document.getElementById('loansDashboardHost');
  if(!host) return;
  const metricGrid=host.querySelector('.ld-metric-grid');
  const recovery=host.querySelector('.ld-recovery-card');
  loansFreezeSnapshot={
    metricGrid:metricGrid?.innerHTML ?? null,
    recovery:recovery?.innerHTML ?? null
  };
  window.__loanLedgerLoansVisualFreeze=true;
  loansFreezeObserver=new MutationObserver(()=>restoreFrozenLoansValues());
  loansFreezeObserver.observe(host,{childList:true,subtree:true,characterData:true});
  restoreFrozenLoansValues();
}

function stopLoansVisualFreeze(){
  loansFreezeObserver?.disconnect();
  loansFreezeObserver=null;
  loansFreezeSnapshot=null;
  loansFreezeRestoring=false;
  window.__loanLedgerLoansVisualFreeze=false;
}

function holdLoansVisible(){
  startLoansVisualFreeze();
  document.body.classList.add('ll-opening-client-from-loans');
  document.getElementById('loansPage')?.classList.add('active-page');
}

function releaseLoansIntoClient(page){
  restoreFrozenLoansValues();
  showAccountPage();
  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{
      document.body.classList.remove('ll-opening-client-from-loans');
      stopLoansVisualFreeze();
      clearEntryClass(page);
    });
  });
}

async function openFromLoans(id){
  if(!id || switching) return;
  switching=true;
  mountSequence+=1;
  const sequence=mountSequence;
  pendingBorrowerId=String(id);
  const page=ensureAccountPage();
  if(!page){ switching=false; return; }

  /* Keep the exact Loans frame and its real values visible while the final account UI mounts offscreen. */
  holdLoansVisible();
  page.classList.add('ll-client-preparing');

  try{
    dispatchRender(id,'loans-preload');
    await waitForFinal(id,sequence);
    if(sequence!==mountSequence) return;

    restoreFrozenLoansValues();
    page.classList.remove('ll-client-preparing');
    page.classList.add('ll-client-entry');
    releaseLoansIntoClient(page);
  }finally{
    if(sequence===mountSequence){
      pendingBorrowerId=null;
      switching=false;
      /* Fail-safe: never leave the dashboard locked by the preparation class. */
      setTimeout(()=>{
        document.body.classList.remove('ll-opening-client-from-loans');
        stopLoansVisualFreeze();
      },900);
    }
  }
}

function clearViewTransitionNames(){
  document.querySelectorAll('[style*="view-transition-name"]').forEach(node=>node.style.viewTransitionName='');
}

async function switchInsideRail(id){
  if(!id || switching) return;
  switching=true;
  mountSequence+=1;
  const sequence=mountSequence;
  pendingBorrowerId=String(id);
  const page=accountPage();
  page?.classList.add('ll-client-switching');

  const doUpdate=async()=>{
    dispatchRender(id,'rail-switch');
    await waitForFinal(id,sequence);
    const nextWorkspace=accountContent()?.querySelector('.ll-workspace');
    const nextRail=accountContent()?.querySelector('.ll-client-rail');
    if(nextWorkspace) nextWorkspace.style.viewTransitionName='ll-client-workspace';
    if(nextRail) nextRail.style.viewTransitionName='ll-client-rail';
  };

  try{
    const oldWorkspace=accountContent()?.querySelector('.ll-workspace');
    const oldRail=accountContent()?.querySelector('.ll-client-rail');
    if(oldWorkspace) oldWorkspace.style.viewTransitionName='ll-client-workspace';
    if(oldRail) oldRail.style.viewTransitionName='ll-client-rail';

    if(document.startViewTransition){
      const transition=document.startViewTransition(doUpdate);
      await transition.finished;
    }else{
      await doUpdate();
      page?.classList.add('ll-client-switch-fallback-in');
      setTimeout(()=>page?.classList.remove('ll-client-switch-fallback-in'),360);
    }
  }catch(error){
    console.error('Client transition failed:',error);
    await doUpdate();
  }finally{
    clearViewTransitionNames();
    page?.classList.remove('ll-client-switching');
    pendingBorrowerId=null;
    switching=false;
  }
}

/* Own the Loans-row click at the window capture phase. No temporary row state is
   applied: the dashboard and its last real numbers remain unchanged until the final profile is ready. */
window.addEventListener('click',event=>{
  const row=event.target.closest?.('#loansDashboardHost [data-ld-borrower]');
  if(!row) return;
  const id=row.dataset.ldBorrower;
  if(!id) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openFromLoans(id);
},true);

/* Client-to-client changes keep the current final UI visually frozen through the
   browser view transition while the new final profile mounts underneath. */
window.addEventListener('click',event=>{
  const page=accountPage();
  if(!page?.classList.contains('active-page')) return;
  const card=event.target.closest?.('#borrowerAccountContent .ll-client-rail [data-acct-borrower]');
  if(!card || card.classList.contains('active')) return;
  const id=card.dataset.acctBorrower;
  if(!id) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  switchInsideRail(id);
},true);

/* External account requests use the same stable Loans-to-profile transition. */
window.addEventListener('loan-ledger:open-account',event=>{
  const id=event.detail?.borrowerId;
  if(!id || switching) return;
  const page=ensureAccountPage();
  if(page?.classList.contains('active-page')) return;
  openFromLoans(id);
});

console.log('final client profile transitions active');