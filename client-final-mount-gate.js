function ensureMountGateStyle(){
  const href='./client-final-mount-gate.css?v=1';
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
let watchTimer=null;
let failSafeTimer=null;
let mountSequence=0;

function accountPage(){ return document.getElementById('borrowerAccountPage'); }
function accountContent(){ return document.getElementById('borrowerAccountContent'); }

function ensureGate(){
  const page=accountPage();
  if(!page) return null;
  let gate=page.querySelector(':scope > .ll-final-mount-gate');
  if(!gate){
    gate=document.createElement('div');
    gate.className='ll-final-mount-gate';
    gate.setAttribute('aria-hidden','true');
    gate.innerHTML='<div class="ll-final-mount-loader"><span></span><span></span><span></span></div>';
    page.appendChild(gate);
  }
  return gate;
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

function stopWatching(){
  if(watchTimer){ clearInterval(watchTimer); watchTimer=null; }
  if(failSafeTimer){ clearTimeout(failSafeTimer); failSafeTimer=null; }
}

function finishMount(sequence){
  if(sequence!==mountSequence) return;
  stopWatching();
  const page=accountPage();
  if(!page) return;
  page.classList.remove('ll-final-mounting');
  page.classList.add('ll-final-mounted');
  pendingBorrowerId=null;
  setTimeout(()=>page.classList.remove('ll-final-mounted'),260);
}

function watchFinal(targetId,sequence){
  let stableHits=0;
  watchTimer=setInterval(()=>{
    if(sequence!==mountSequence){ stopWatching(); return; }
    if(finalProfileReady(targetId)) stableHits+=1; else stableHits=0;
    if(stableHits>=5){
      stopWatching();
      requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(()=>finishMount(sequence),90)));
    }
  },45);
  failSafeTimer=setTimeout(()=>finishMount(sequence),4500);
}

function beginMount(targetId){
  if(!targetId) return;
  const page=accountPage();
  if(!page) return;
  if(pendingBorrowerId===String(targetId) && page.classList.contains('ll-final-mounting')) return;
  mountSequence+=1;
  const sequence=mountSequence;
  pendingBorrowerId=String(targetId);
  stopWatching();
  ensureGate();
  page.classList.remove('ll-final-mounted');
  page.classList.add('ll-final-mounting');
  watchFinal(targetId,sequence);
}

function visuallySelectClient(card){
  const rail=card.closest('.ll-client-rail');
  if(!rail) return;
  rail.querySelectorAll('.ll-client-card.active').forEach(item=>item.classList.remove('active'));
  card.classList.add('active');
}

/* Direct client-to-client switches: account-router intentionally ignores rail clicks,
   so this is the only route used inside the client rail. */
window.addEventListener('click',event=>{
  const page=accountPage();
  if(!page?.classList.contains('active-page')) return;
  const card=event.target.closest?.('#borrowerAccountContent .ll-client-rail [data-acct-borrower]');
  if(!card || card.classList.contains('active')) return;
  const id=card.dataset.acctBorrower;
  if(!id) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  visuallySelectClient(card);
  beginMount(id);
  window.dispatchEvent(new CustomEvent('loan-ledger:account-rendered',{detail:{borrowerId:id,source:'final-mount-gate'}}));
},true);

/* Requests from the loans dashboard arrive here before the desktop renderer has time
   to paint its scaffold, so the gate is already visible when that scaffold is inserted. */
window.addEventListener('loan-ledger:open-account',event=>beginMount(event.detail?.borrowerId));
window.addEventListener('loan-ledger:account-rendered',event=>beginMount(event.detail?.borrowerId));

/* If the account page is created after this module initializes, keep the gate available. */
new MutationObserver(()=>{
  const page=accountPage();
  if(page && pendingBorrowerId){ ensureGate(); page.classList.add('ll-final-mounting'); }
}).observe(document.body,{childList:true,subtree:true});

console.log('final client profile mount gate active');
