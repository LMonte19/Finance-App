function ensureReferenceMatchStyle(){
  const href='./client-profile-reference-match.css?v=3';
  let link=document.getElementById('clientProfileReferenceMatchCss');
  if(link){if(link.getAttribute('href')!==href)link.setAttribute('href',href);return;}
  link=document.createElement('link');
  link.id='clientProfileReferenceMatchCss';
  link.rel='stylesheet';
  link.href=href;
  document.head.appendChild(link);
}
ensureReferenceMatchStyle();

const REF_ICONS={
  dollar:'<path d="M15.2 8.2c-.8-.8-1.8-1.2-3.2-1.2-1.9 0-3.1.8-3.1 2.1 0 3.1 6.2 1.2 6.2 4.4 0 1.4-1.3 2.4-3.4 2.4-1.7 0-3-.5-3.8-1.5M12 5v14"/>',
  trend:'<path d="M5 16.5 10.2 11.3l3.1 3.1L19 8.7"/><path d="M14.7 8.7H19V13"/>',
  clock:'<circle cx="12" cy="12" r="8.2"/><path d="M12 7.5V12l3.2 1.8"/>',
  cycle:'<path d="M18.2 8.2A7 7 0 0 0 6.3 6.5L4.5 8.8"/><path d="M4.5 5v3.8h3.8"/><path d="M5.8 15.8A7 7 0 0 0 17.7 17.5l1.8-2.3"/><path d="M19.5 19v-3.8h-3.8"/>',
  calendar:'<rect x="4.5" y="5.5" width="15" height="14" rx="2.3"/><path d="M8 3.8v3.5M16 3.8v3.5M4.5 9.5h15"/><path d="M8 13h.01M12 13h.01M16 13h.01M8 16.5h.01M12 16.5h.01"/>',
  chevronLeft:'<path d="m14.5 6-6 6 6 6"/>'
};

function refSvg(name){
  return `<svg class="ll-ref-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${REF_ICONS[name]||REF_ICONS.clock}</svg>`;
}

function matchSummaryIcons(root){
  const names=['dollar','trend','clock','cycle','calendar'];
  root.querySelectorAll('[data-profile-panel="summary"] .ll-summary-stat-grid>div').forEach((cell,index)=>{
    let badge=cell.querySelector('.ll-elegant-metric-icon');
    if(!badge){
      badge=document.createElement('span');
      badge.className='ll-elegant-metric-icon';
      cell.prepend(badge);
    }
    badge.innerHTML=refSvg(names[index]||'calendar');
  });
}

function formatRailBalance(card){
  const node=card.querySelector('.ll-client-balance');
  if(!node) return;
  const numeric=Number(String(node.textContent||'').replace(/[^0-9.-]/g,''));
  if(!Number.isFinite(numeric)) return;
  node.textContent=`$${numeric.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}

function matchRail(root){
  const rail=root.querySelector('.ll-client-rail');
  if(!rail) return;

  const filterControl=rail.querySelector('.ll-filter-control');
  if(filterControl) filterControl.setAttribute('aria-hidden','true');

  rail.querySelectorAll('.ll-client-card').forEach(card=>{
    formatRailBalance(card);
    card.querySelector('.ll-active-rail-indicator')?.remove();
    if(card.classList.contains('active')){
      const indicator=document.createElement('span');
      indicator.className='ll-active-rail-indicator';
      indicator.setAttribute('aria-hidden','true');
      card.prepend(indicator);
    }
  });

  const back=root.querySelector('#acctBack');
  if(back){
    back.classList.add('ll-rail-back');
    back.dataset.referenceMatch='1';
    back.innerHTML=`<span class="ll-collapse-icon">${refSvg('chevronLeft')}</span><span>Colapsar</span>`;
  }
}

function applyReferenceMatch(){
  const root=document.querySelector('#borrowerAccountContent .ll-account-shell');
  if(!root) return;
  root.classList.add('ll-reference-match');
  matchSummaryIcons(root);
  matchRail(root);
}

let refQueued=false;
function queueReferenceMatch(){
  if(refQueued)return;
  refQueued=true;
  requestAnimationFrame(()=>{refQueued=false;applyReferenceMatch();});
}

document.addEventListener('DOMContentLoaded',queueReferenceMatch);
window.addEventListener('loan-ledger:account-rendered',()=>setTimeout(queueReferenceMatch,190));
window.addEventListener('loan-ledger:open-account',()=>setTimeout(queueReferenceMatch,190));
const refHost=document.getElementById('borrowerAccountContent');
if(refHost && refHost.dataset.referenceMatchObserver!=='1'){
  refHost.dataset.referenceMatchObserver='1';
  new MutationObserver(mutations=>{
    if(mutations.some(m=>[...m.addedNodes].some(n=>n.nodeType===1&&(n.matches?.('.ll-account-shell,.ll-profile-tabs-host,.ll-client-card')||n.querySelector?.('.ll-account-shell,.ll-profile-tabs-host,.ll-client-card'))))) queueReferenceMatch();
  }).observe(refHost,{childList:true,subtree:true});
}
setTimeout(queueReferenceMatch,400);
setTimeout(queueReferenceMatch,1100);

console.log('client profile reference match active');