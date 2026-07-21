function addStyle(id, href){
  const existing=document.getElementById(id);
  if(existing){ if(existing.getAttribute('href')!==href) existing.setAttribute('href',href); return; }
  const link=document.createElement('link');
  link.id=id; link.rel='stylesheet'; link.href=href;
  document.head.appendChild(link);
}

addStyle('clientProfileElegantCss','./client-profile-elegant.css?v=1');

let queued=false;

function cardByTitle(root,title){
  return [...root.querySelectorAll('.ll-profile-card')].find(card=>card.querySelector('.ll-card-title')?.textContent.trim()===title);
}

function simplifyHeader(root){
  const actions=root.querySelector('.ll-action-row');
  if(!actions || actions.dataset.elegantReady==='1') return;
  const buttons=[...actions.querySelectorAll(':scope > button')];
  const pay=buttons.find(button=>button.textContent.includes('Registrar pago'));
  const note=buttons.find(button=>button.textContent.includes('Agregar nota'));
  const whatsapp=buttons.find(button=>button.textContent.includes('WhatsApp'));
  const disbursement=buttons.find(button=>button.textContent.includes('Nuevo desembolso'));
  if(!pay || !disbursement) return;

  pay.classList.add('ll-elegant-pay');
  if(!pay.querySelector('.ll-pay-chevron')) pay.insertAdjacentHTML('beforeend','<span class="ll-pay-chevron">⌄</span>');

  const details=document.createElement('details');
  details.className='ll-more-actions';
  details.innerHTML='<summary aria-label="Más acciones">⋮</summary><div class="ll-more-menu"></div>';
  const menu=details.querySelector('.ll-more-menu');
  if(note) menu.appendChild(note);
  if(whatsapp) menu.appendChild(whatsapp);

  actions.innerHTML='';
  actions.appendChild(pay);
  actions.appendChild(details);
  actions.appendChild(disbursement);
  actions.dataset.elegantReady='1';
}

function simplifySummary(root){
  const summary=root.querySelector('[data-profile-panel="summary"]');
  if(!summary) return;

  const disbursementCard=cardByTitle(summary,'Últimos desembolsos');
  if(disbursementCard) disbursementCard.remove();

  const activityCard=cardByTitle(summary,'Actividad reciente');
  if(activityCard){
    const title=activityCard.querySelector('.ll-card-title');
    if(title) title.textContent='Movimientos recientes';
    activityCard.classList.add('ll-movements-card');
    const note=activityCard.querySelector('.ll-card-note');
    if(note) note.remove();
  }

  const calendar=summary.querySelector('.ll-cycle-calendar');
  if(calendar){
    const heading=calendar.querySelector('.ll-cycle-calendar-head strong');
    if(heading) heading.textContent='Cuotas pendientes';
  }
}

function simplifyRail(root){
  root.querySelectorAll('.ll-client-card').forEach(card=>{
    card.classList.add('ll-elegant-client-row');
    const badge=card.querySelector('.ll-rail-badge');
    if(badge) badge.classList.add('ll-elegant-status');
  });
}

function applyElegantProfile(){
  const root=document.querySelector('#borrowerAccountContent .ll-account-shell');
  if(!root) return;
  simplifyHeader(root);
  simplifySummary(root);
  simplifyRail(root);
  root.classList.add('ll-elegant-profile');
}

function queueApply(){
  if(queued) return;
  queued=true;
  requestAnimationFrame(()=>{ queued=false; applyElegantProfile(); });
}

const content=document.getElementById('borrowerAccountContent');
if(content && content.dataset.elegantObserver!=='1'){
  content.dataset.elegantObserver='1';
  new MutationObserver(mutations=>{
    const relevant=mutations.some(m=>[...m.addedNodes].some(node=>node.nodeType===1 && (node.matches?.('.ll-account-shell,.ll-profile-tabs-host') || node.querySelector?.('.ll-account-shell,.ll-profile-tabs-host'))));
    if(relevant) queueApply();
  }).observe(content,{childList:true,subtree:true});
}

document.addEventListener('DOMContentLoaded',queueApply);
window.addEventListener('loan-ledger:account-rendered',()=>setTimeout(queueApply,160));
window.addEventListener('loan-ledger:open-account',()=>setTimeout(queueApply,160));
setTimeout(queueApply,300);
setTimeout(queueApply,1000);

console.log('client profile elegant layer active');