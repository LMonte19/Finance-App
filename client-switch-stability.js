function ensureSwitchStyle(){
  const href='./client-switch-stability.css?v=1';
  let link=document.getElementById('clientSwitchStabilityCss');
  if(link){ if(link.getAttribute('href')!==href) link.setAttribute('href',href); return; }
  link=document.createElement('link');
  link.id='clientSwitchStabilityCss';
  link.rel='stylesheet';
  link.href=href;
  document.head.appendChild(link);
}

ensureSwitchStyle();

let pendingBorrowerId=null;
let shield=null;
let readyTimer=null;
let failSafeTimer=null;
let resizeHandler=null;

function currentContent(){ return document.getElementById('borrowerAccountContent'); }
function currentWorkspace(){ return currentContent()?.querySelector('.ll-workspace'); }
function accountPageIsOpen(){ return document.getElementById('borrowerAccountPage')?.classList.contains('active-page'); }

function updateShieldBounds(){
  if(!shield) return;
  const workspace=currentWorkspace();
  if(!workspace) return;
  const rect=workspace.getBoundingClientRect();
  shield.style.left=`${Math.max(0,rect.left)}px`;
  shield.style.top=`${Math.max(0,rect.top)}px`;
  shield.style.width=`${Math.max(0,Math.min(window.innerWidth,rect.right)-Math.max(0,rect.left))}px`;
  shield.style.height=`${Math.max(0,Math.min(window.innerHeight,rect.bottom)-Math.max(0,rect.top))}px`;
}

function createShield(){
  removeShield(false);
  const workspace=currentWorkspace();
  if(!workspace) return;
  shield=document.createElement('div');
  shield.className='ll-client-switch-shield';
  shield.setAttribute('aria-hidden','true');
  shield.innerHTML='<div class="ll-client-switch-indicator"><span></span><span></span><span></span></div>';
  document.body.appendChild(shield);
  updateShieldBounds();
  requestAnimationFrame(()=>shield?.classList.add('visible'));
  resizeHandler=()=>updateShieldBounds();
  window.addEventListener('resize',resizeHandler,{passive:true});
}

function removeShield(animate=true){
  if(readyTimer){ clearInterval(readyTimer); readyTimer=null; }
  if(failSafeTimer){ clearTimeout(failSafeTimer); failSafeTimer=null; }
  if(resizeHandler){ window.removeEventListener('resize',resizeHandler); resizeHandler=null; }
  const node=shield;
  shield=null;
  pendingBorrowerId=null;
  if(!node) return;
  if(!animate){ node.remove(); return; }
  node.classList.remove('visible');
  node.classList.add('leaving');
  setTimeout(()=>node.remove(),190);
}

function visuallySelectClient(card){
  const rail=card.closest('.ll-client-rail');
  if(!rail) return;
  rail.querySelectorAll('.ll-client-card.active').forEach(item=>item.classList.remove('active'));
  card.classList.add('active');
}

function profileIsFinal(targetId){
  const root=currentContent()?.querySelector('.ll-account-shell');
  if(!root) return false;
  const active=root.querySelector('.ll-client-card.active[data-acct-borrower]');
  if(!active || String(active.dataset.acctBorrower)!==String(targetId)) return false;
  const tabsReady=root.dataset.functionalTabs==='ready';
  const elegant=root.classList.contains('ll-elegant-profile');
  const reference=root.classList.contains('ll-reference-match');
  const host=!!root.querySelector('.ll-profile-tabs-host');
  return tabsReady && elegant && reference && host;
}

function watchUntilFinal(targetId){
  let stableHits=0;
  readyTimer=setInterval(()=>{
    updateShieldBounds();
    if(profileIsFinal(targetId)) stableHits+=1; else stableHits=0;
    if(stableHits>=2){
      clearInterval(readyTimer); readyTimer=null;
      requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(()=>removeShield(true),70)));
    }
  },45);
  failSafeTimer=setTimeout(()=>removeShield(true),3200);
}

function switchClientDirect(card,event){
  const targetId=card.dataset.acctBorrower;
  if(!targetId || pendingBorrowerId || card.classList.contains('active')) return false;
  pendingBorrowerId=targetId;
  event.preventDefault();
  event.stopPropagation();
  visuallySelectClient(card);
  createShield();
  watchUntilFinal(targetId);
  window.dispatchEvent(new CustomEvent('loan-ledger:account-rendered',{
    detail:{borrowerId:targetId,directRailSwitch:true}
  }));
  return true;
}

/* Window capture fires before account-ui's document capture handler. This prevents
   the legacy account renderer from ever painting during client-to-client switches. */
window.addEventListener('click',event=>{
  if(!accountPageIsOpen()) return;
  const card=event.target.closest?.('#borrowerAccountContent .ll-client-rail [data-acct-borrower]');
  if(!card) return;
  switchClientDirect(card,event);
},true);

/* If another navigation path completes while a shield exists, keep its bounds current. */
window.addEventListener('loan-ledger:open-account',()=>{ if(shield) updateShieldBounds(); });

console.log('client switch stability active');
