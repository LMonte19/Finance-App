function ensureMountGateStyle(){
  const href='./client-final-mount-gate.css?v=5';
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

function waitForFinal(targetId,sequence,timeout=7000){
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

function clearViewTransitionNames(){
  document.querySelectorAll('[style*="view-transition-name"]').forEach(node=>node.style.viewTransitionName='');
}

function markEntryElements(){
  const rail=accountContent()?.querySelector('.ll-client-rail');
  const workspace=accountContent()?.querySelector('.ll-workspace');
  if(rail) rail.style.viewTransitionName='ll-client-entry-rail';
  if(workspace) workspace.style.viewTransitionName='ll-client-entry-workspace';
}

async function buildAndRevealFromLoans(id,sequence){
  const page=ensureAccountPage();
  if(!page) return false;
  page.classList.add('ll-client-preparing');
  dispatchRender(id,'loans-snapshot-preload');
  const ready=await waitForFinal(id,sequence);
  if(sequence!==mountSequence) return false;
  page.classList.remove('ll-client-preparing');
  markEntryElements();
  showAccountPage();
  return ready;
}

async function openFromLoans(id){
  if(!id || switching) return;
  switching=true;
  mountSequence+=1;
  const sequence=mountSequence;
  pendingBorrowerId=String(id);
  ensureAccountPage();

  try{
    if(document.startViewTransition){
      const transition=document.startViewTransition(async()=>{
        await buildAndRevealFromLoans(id,sequence);
      });
      await transition.finished;
    }else{
      await buildAndRevealFromLoans(id,sequence);
      accountPage()?.classList.add('ll-client-entry-fallback');
      setTimeout(()=>accountPage()?.classList.remove('ll-client-entry-fallback'),520);
    }
  }catch(error){
    console.error('Loans to client transition failed:',error);
    if(sequence===mountSequence){
      await buildAndRevealFromLoans(id,sequence);
    }
  }finally{
    clearViewTransitionNames();
    if(sequence===mountSequence){
      pendingBorrowerId=null;
      switching=false;
      accountPage()?.classList.remove('ll-client-preparing');
    }
  }
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

window.addEventListener('click',event=>{
  const row=event.target.closest?.('#loansDashboardHost [data-ld-borrower]');
  if(!row) return;
  const id=row.dataset.ldBorrower;
  if(!id) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openFromLoans(id);
},true);

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

window.addEventListener('loan-ledger:open-account',event=>{
  const id=event.detail?.borrowerId;
  if(!id || switching) return;
  const page=ensureAccountPage();
  if(page?.classList.contains('active-page')) return;
  openFromLoans(id);
});

console.log('final client profile snapshot transitions active');