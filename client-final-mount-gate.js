function ensureMountGateStyle(){
  const href='./client-final-mount-gate.css?v=7';
  let link=document.getElementById('clientFinalMountGateCss');
  if(link){ if(link.getAttribute('href')!==href) link.setAttribute('href',href); return; }
  link=document.createElement('link');
  link.id='clientFinalMountGateCss';
  link.rel='stylesheet';
  link.href=href;
  document.head.appendChild(link);
}
ensureMountGateStyle();

let mountSequence=0;
let switching=false;
let desiredRailCollapsed=true;

const CLIENT_RAIL_STORAGE='loanLedger.clientRailCollapsed';
const SEARCH_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>';
const PERSON_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.4"/><path d="M5.5 20c.6-4.4 2.8-6.6 6.5-6.6s5.9 2.2 6.5 6.6"/></svg>';
const CHEVRON_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';

function esc(value){
  return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function initials(name='?'){
  return String(name||'?').trim().split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]?.toUpperCase()||'').join('')||'?';
}
function wholeMoney(text){
  const raw=String(text||'').trim();
  if(!raw) return '';
  const numeric=Number(raw.replace(/[^0-9.-]/g,''));
  return Number.isFinite(numeric)?`$${Math.round(numeric).toLocaleString('en-US')}`:raw;
}
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

function clientStatusClass(label=''){
  const key=String(label).trim().toUpperCase();
  if(/ATRAS|VENC|OVERDUE/.test(key)) return 'danger';
  if(/SALD|CERR|PAID|CLOSED/.test(key)) return 'closed';
  return 'ok';
}

function clientsFromLoans(selectedId){
  const visibleRows=[...document.querySelectorAll('#loansDashboardHost [data-ld-borrower]')];
  const rowMap=new Map(visibleRows.map(row=>[String(row.dataset.ldBorrower),row]));
  const options=[...document.querySelectorAll('#loanBorrower option')];
  const source=options.length?options.map(option=>({id:String(option.value),name:option.textContent.trim()})):visibleRows.map(row=>({id:String(row.dataset.ldBorrower),name:row.querySelector('.ld-client-name')?.textContent.trim()||'Cliente'}));
  const seen=new Set();
  return source.filter(item=>item.id&&!seen.has(item.id)&&seen.add(item.id)).map((item,index)=>{
    const row=rowMap.get(item.id);
    const cells=row?[...row.querySelectorAll('.ld-cell strong')]:[];
    const status=row?.querySelector('.ld-status')?.textContent.trim()||'';
    return {
      id:item.id,
      name:item.name||row?.querySelector('.ld-client-name')?.textContent.trim()||'Cliente',
      balance:wholeMoney(cells[0]?.textContent||''),
      status,
      tone:clientStatusClass(status),
      index,
      active:String(item.id)===String(selectedId)
    };
  });
}

function railIsCollapsed(){
  const live=document.querySelector('#borrowerAccountContent .ll-account-shell');
  if(live) return live.classList.contains('ll-client-rail-collapsed');
  return localStorage.getItem(CLIENT_RAIL_STORAGE)==='1';
}

function setDesiredRailState(collapsed){
  desiredRailCollapsed=!!collapsed;
  localStorage.setItem(CLIENT_RAIL_STORAGE,desiredRailCollapsed?'1':'0');
}

function forceInitialRailCollapsed(){
  setDesiredRailState(true);
}

function applyDesiredRailState(){
  const root=accountContent()?.querySelector('.ll-account-shell');
  if(!root) return null;
  root.classList.toggle('ll-client-rail-collapsed',desiredRailCollapsed);
  const btn=root.querySelector('#acctBack');
  if(btn){
    btn.setAttribute('aria-label',desiredRailCollapsed?'Expandir clientes':'Colapsar clientes');
    btn.title=desiredRailCollapsed?'Expandir clientes':'Colapsar clientes';
  }
  return root;
}

function clientRowsHtml(clients){
  return clients.map(client=>`<div class="ll-load-client ${client.active?'active':''}" data-load-client="${esc(client.id)}">
    <span class="ll-load-avatar tone-${client.index%5}">${esc(initials(client.name))}</span>
    <span class="ll-load-client-copy"><strong>${esc(client.name)}</strong>${client.balance?`<small>${esc(client.balance)}</small>`:''}</span>
    ${client.status?`<span class="ll-load-status ${client.tone}"><i></i>${esc(client.status)}</span>`:''}
  </div>`).join('');
}

function loadingShellHtml(clients,selectedId,collapsed){
  return `<div class="ll-loading-account-shell ${collapsed?'is-collapsed':''}" data-loading-borrower="${esc(selectedId)}" aria-live="polite">
    <aside class="ll-loading-client-rail">
      <div class="ll-loading-rail-top"><strong>Clientes</strong><span class="ll-loading-search">${SEARCH_ICON}</span></div>
      <div class="ll-loading-filter"><span>Todos los clientes</span><span>⌄</span></div>
      <div class="ll-loading-collapsed-marker">${PERSON_ICON}</div>
      <div class="ll-loading-client-list">${clientRowsHtml(clients)}</div>
      <div class="ll-loading-collapse"><span>${CHEVRON_ICON}</span><em>Colapsar</em></div>
    </aside>
    <main class="ll-loading-workspace">
      <div class="ll-loading-badge"><span class="ll-loading-dot"></span><strong>Cargando...</strong></div>
    </main>
  </div>`;
}

function removeLoadingShell(immediate=false){
  const page=accountPage();
  const shell=page?.querySelector(':scope > .ll-loading-account-shell');
  if(!shell) return;
  if(immediate){ shell.remove(); return; }
  shell.classList.add('is-leaving');
  setTimeout(()=>shell.remove(),300);
}

function showLoadingShell(clients,selectedId,{collapsed=railIsCollapsed(),animateRail=true}={}){
  const page=ensureAccountPage();
  if(!page) return null;
  removeLoadingShell(true);
  page.insertAdjacentHTML('beforeend',loadingShellHtml(clients,selectedId,collapsed));
  const shell=page.querySelector(':scope > .ll-loading-account-shell');
  if(!animateRail) shell?.classList.add('no-rail-entry');
  page.classList.remove('ll-profile-revealing');
  page.classList.add('ll-profile-loading');
  document.body.classList.add('ll-client-load-active');
  requestAnimationFrame(()=>shell?.classList.add('is-visible'));
  return shell;
}

function finalProfileReady(targetId){
  const root=applyDesiredRailState();
  if(!root) return false;
  if(root.classList.contains('ll-client-rail-collapsed')!==desiredRailCollapsed) return false;
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

function waitForFinal(targetId,sequence,timeout=15000){
  return new Promise(resolve=>{
    let stable=0;
    const started=performance.now();
    const tick=()=>{
      if(sequence!==mountSequence) return resolve(false);
      if(finalProfileReady(targetId)) stable+=1; else stable=0;
      if(stable>=3) return requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true)));
      if(performance.now()-started>=timeout) return resolve(false);
      setTimeout(tick,45);
    };
    tick();
  });
}

function waitForInPlaceFinal(targetId,sequence,root,timeout=15000){
  return new Promise(resolve=>{
    let stable=0;
    const started=performance.now();
    const tick=()=>{
      if(sequence!==mountSequence || !document.contains(root)) return resolve(false);
      const active=root.querySelector('.ll-client-card.active[data-acct-borrower]');
      const activeMatches=active && String(active.dataset.acctBorrower)===String(targetId);
      const tabsReady=root.dataset.functionalTabs==='ready';
      const headerReady=String(root.dataset.inplaceHeaderBorrower||'')===String(targetId);
      const panelReady=!!root.querySelector('.ll-profile-tabs-host [data-profile-panel].active');
      if(activeMatches && tabsReady && headerReady && panelReady) stable+=1; else stable=0;
      if(stable>=3) return requestAnimationFrame(()=>resolve(true));
      if(performance.now()-started>=timeout) return resolve(false);
      setTimeout(tick,42);
    };
    tick();
  });
}

function dispatchRender(id,source){
  window.dispatchEvent(new CustomEvent('loan-ledger:account-rendered',{detail:{borrowerId:id,source}}));
}

function revealFinal(sequence){
  if(sequence!==mountSequence) return;
  const page=accountPage();
  if(!page) return;
  const root=applyDesiredRailState();
  if(root) root.getBoundingClientRect();
  requestAnimationFrame(()=>{
    if(sequence!==mountSequence) return;
    applyDesiredRailState();
    page.classList.add('ll-profile-revealing');
    page.classList.remove('ll-profile-loading');
    document.body.classList.remove('ll-client-load-active');
    removeLoadingShell(false);
    setTimeout(()=>page.classList.remove('ll-profile-revealing'),380);
  });
}

function showLoadFailure(sequence){
  if(sequence!==mountSequence) return;
  const badge=accountPage()?.querySelector('.ll-loading-badge strong');
  if(badge) badge.textContent='La carga está tardando más de lo esperado...';
}

function ensureInPlaceBadge(root){
  const workspace=root?.querySelector('.ll-workspace');
  if(!workspace) return null;
  let badge=workspace.querySelector(':scope > .ll-inplace-loading-badge');
  if(!badge){
    badge=document.createElement('div');
    badge.className='ll-inplace-loading-badge';
    badge.innerHTML='<span class="ll-loading-dot"></span><strong>Cargando...</strong>';
    workspace.appendChild(badge);
  }
  return badge;
}

function beginInPlaceSwitch(root){
  root.classList.remove('ll-inplace-reveal');
  root.classList.add('ll-inplace-switching');
  ensureInPlaceBadge(root)?.classList.add('visible');
}

function finishInPlaceSwitch(root){
  const badge=root.querySelector('.ll-inplace-loading-badge');
  badge?.classList.remove('visible');
  root.classList.remove('ll-inplace-switching');
  root.classList.add('ll-inplace-reveal');
  setTimeout(()=>{
    root.classList.remove('ll-inplace-reveal');
    badge?.remove();
  },420);
}

async function openFromLoans(id){
  if(!id || switching) return;
  switching=true;
  const sequence=++mountSequence;
  const clients=clientsFromLoans(id);

  forceInitialRailCollapsed();
  showLoadingShell(clients,id,{collapsed:true,animateRail:true});
  showAccountPage();
  dispatchRender(id,'loans-loading-shell');

  try{
    const ready=await waitForFinal(id,sequence);
    if(sequence!==mountSequence) return;
    if(ready) revealFinal(sequence); else showLoadFailure(sequence);
  }finally{
    if(sequence===mountSequence) switching=false;
  }
}

async function switchInsideRail(id,card){
  if(!id || switching) return;
  const root=accountContent()?.querySelector('.ll-account-shell');
  if(!root) return;
  switching=true;
  const sequence=++mountSequence;

  /* The profile shell and client rail stay mounted. Only client-specific data changes. */
  forceInitialRailCollapsed();
  applyDesiredRailState();
  root.dataset.functionalTabs='switch-requested';
  root.dataset.inplaceHeaderBorrower='loading';
  beginInPlaceSwitch(root);

  root.querySelectorAll('.ll-client-card.active').forEach(node=>node.classList.remove('active'));
  card.classList.add('active');

  dispatchRender(id,'inplace-profile-switch');

  try{
    const ready=await waitForInPlaceFinal(id,sequence,root);
    if(sequence!==mountSequence) return;
    if(ready) finishInPlaceSwitch(root);
    else {
      const badge=ensureInPlaceBadge(root);
      if(badge) badge.querySelector('strong').textContent='La carga está tardando más de lo esperado...';
    }
  }finally{
    if(sequence===mountSequence) switching=false;
  }
}

new MutationObserver(()=>{
  if(!document.body.classList.contains('ll-client-load-active')) return;
  applyDesiredRailState();
}).observe(document.body,{childList:true,subtree:true});

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
  switchInsideRail(id,card);
},true);

window.addEventListener('loan-ledger:open-account',event=>{
  const id=event.detail?.borrowerId;
  if(!id || switching) return;
  if(accountPage()?.classList.contains('active-page')) return;
  openFromLoans(id);
});

console.log('stable client profile mount and in-place switching active');