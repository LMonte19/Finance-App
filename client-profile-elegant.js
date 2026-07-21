function addStyle(id, href){
  const existing=document.getElementById(id);
  if(existing){ if(existing.getAttribute('href')!==href) existing.setAttribute('href',href); return; }
  const link=document.createElement('link');
  link.id=id; link.rel='stylesheet'; link.href=href;
  document.head.appendChild(link);
}

addStyle('clientProfileElegantCss','./client-profile-elegant.css?v=2');
addStyle('clientProfileElegantIconsCss','./client-profile-elegant-icons.css?v=2');
addStyle('clientProfileElegantFixCss','./client-profile-elegant-fix.css?v=1');

const ELEGANT_ICONS={
  dollar:'<circle cx="12" cy="12" r="8.5"/><path d="M15.2 8.5c-.7-.8-1.7-1.2-3.2-1.2-1.8 0-3 .8-3 2 0 3 6 1.2 6 4.2 0 1.3-1.2 2.2-3.2 2.2-1.6 0-2.8-.5-3.6-1.4M12 5.5v13"/>',
  trend:'<path d="M5 16 10 11l3 3 6-7"/><path d="M14 7h5v5"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.7"/>',
  cycle:'<path d="M18.5 8A7 7 0 0 0 6 6.5L4 9"/><path d="M4 5v4h4"/><path d="M5.5 16A7 7 0 0 0 18 17.5L20 15"/><path d="M20 19v-4h-4"/>',
  calendar:'<rect x="4" y="5.5" width="16" height="14" rx="2.5"/><path d="M8 3.5v4M16 3.5v4M4 9.5h16"/><path d="M8 13h.01M12 13h.01M16 13h.01M8 16.5h.01M12 16.5h.01"/>',
  arrowDown:'<path d="M12 4v15"/><path d="m7 14 5 5 5-5"/>',
  arrowUpRight:'<path d="M6 18 18 6M10 6h8v8"/>',
  message:'<path d="M5 5.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-8l-4.5 3v-3H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"/>',
  note:'<path d="M6 4h9l3 3v13H6z"/><path d="M15 4v4h4M9 12h6M9 16h5"/>',
  check:'<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12 2.3 2.4 4.8-5"/>',
  chevronRight:'<path d="m9 6 6 6-6 6"/>'
};

function elegantIcon(name){
  return `<svg class="ll-elegant-svg" style="width:16px!important;height:16px!important;max-width:16px!important;max-height:16px!important;min-width:16px!important;min-height:16px!important;display:block!important" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ELEGANT_ICONS[name]||ELEGANT_ICONS.check}</svg>`;
}

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
  pay.querySelector('.ll-pay-chevron')?.remove();

  const details=document.createElement('details');
  details.className='ll-more-actions';
  details.innerHTML='<summary aria-label="Más acciones">⋮</summary><div class="ll-more-menu"></div>';
  const menu=details.querySelector('.ll-more-menu');
  if(note) menu.appendChild(note);
  if(whatsapp) menu.appendChild(whatsapp);

  actions.innerHTML='';
  actions.appendChild(pay);
  actions.appendChild(disbursement);
  actions.appendChild(details);
  actions.dataset.elegantReady='1';
}

function applyMetricIcons(root){
  const icons=['dollar','trend','clock','cycle','calendar'];
  root.querySelectorAll('[data-profile-panel="summary"] .ll-summary-stat-grid>div').forEach((cell,index)=>{
    let icon=cell.querySelector('.ll-elegant-metric-icon');
    if(!icon){
      icon=document.createElement('span');
      icon.className='ll-elegant-metric-icon';
      cell.prepend(icon);
    }
    icon.setAttribute('style','position:absolute!important;left:11px!important;top:50%!important;transform:translateY(-50%)!important;width:30px!important;height:30px!important;min-width:30px!important;max-width:30px!important;min-height:30px!important;max-height:30px!important;display:grid!important;place-items:center!important;border-radius:50%!important;background:#f4f5f7!important;color:#707784!important;overflow:hidden!important');
    icon.innerHTML=elegantIcon(icons[index]||'calendar');
  });
}

function movementInfo(button){
  const title=button.querySelector('strong')?.textContent?.trim().toLowerCase()||'';
  if(title.includes('pago recibido')) return {icon:'arrowDown',type:'payment',filter:'pagos'};
  if(title.includes('capital agregado')||title.includes('desembolso')) return {icon:'arrowUpRight',type:'disbursement',filter:'desembolsos'};
  if(title.includes('seguimiento')) return {icon:'check',type:'note',filter:'notas'};
  return {icon:'note',type:'note',filter:'notas'};
}

function applyMovementIcons(root){
  root.querySelectorAll('.ll-movements-card .ll-activity-list button').forEach(button=>{
    const info=movementInfo(button);
    button.dataset.movementFilter=info.filter;
    const dot=button.querySelector('.ll-activity-dot');
    if(dot){
      dot.dataset.graphicIcon='1';
      dot.className=`ll-activity-dot ll-movement-icon-${info.type}`;
      dot.setAttribute('style','width:30px!important;height:30px!important;min-width:30px!important;min-height:30px!important;display:grid!important;place-items:center!important;border-radius:50%!important;margin:0!important;box-shadow:none!important');
      dot.innerHTML=elegantIcon(info.icon);
    }
    const arrow=button.querySelector('b');
    if(arrow){
      arrow.dataset.graphicIcon='1';
      arrow.innerHTML=elegantIcon('chevronRight');
    }
  });
}

function applyMovementFilter(card,filter){
  card.querySelectorAll('[data-movement-filter]').forEach(row=>{
    row.hidden=filter!=='todos' && row.dataset.movementFilter!==filter;
  });
  card.querySelectorAll('.ll-movement-filter').forEach(button=>button.classList.toggle('active',button.dataset.filter===filter));
}

function ensureMovementFilters(card){
  const head=card.querySelector('.ll-card-head');
  if(!head) return;
  const title=head.querySelector('.ll-card-title');
  if(title) title.textContent='Movimientos';
  let filters=head.querySelector('.ll-movement-filters');
  if(!filters){
    filters=document.createElement('div');
    filters.className='ll-movement-filters';
    filters.innerHTML='<button type="button" class="ll-movement-filter active" data-filter="todos">Todos</button><button type="button" class="ll-movement-filter" data-filter="pagos">Pagos</button><button type="button" class="ll-movement-filter" data-filter="desembolsos">Desembolsos</button><button type="button" class="ll-movement-filter" data-filter="notas">Notas</button>';
    head.appendChild(filters);
    filters.querySelectorAll('.ll-movement-filter').forEach(button=>button.onclick=()=>applyMovementFilter(card,button.dataset.filter));
  }
}

function simplifySummary(root){
  const summary=root.querySelector('[data-profile-panel="summary"]');
  if(!summary) return;

  const disbursementCard=cardByTitle(summary,'Últimos desembolsos');
  if(disbursementCard) disbursementCard.remove();

  const activityCard=cardByTitle(summary,'Actividad reciente');
  if(activityCard){
    const title=activityCard.querySelector('.ll-card-title');
    if(title) title.textContent='Movimientos';
    activityCard.classList.add('ll-movements-card');
    activityCard.querySelector('.ll-card-note')?.remove();
  }

  const existingMovements=cardByTitle(summary,'Movimientos recientes')||cardByTitle(summary,'Movimientos');
  if(existingMovements){
    existingMovements.classList.add('ll-movements-card');
    existingMovements.querySelector('.ll-card-note')?.remove();
    ensureMovementFilters(existingMovements);
  }

  const calendar=summary.querySelector('.ll-cycle-calendar');
  if(calendar){
    const heading=calendar.querySelector('.ll-cycle-calendar-head strong');
    if(heading) heading.textContent='Cuotas pendientes';
  }

  applyMetricIcons(root);
  applyMovementIcons(root);
}

function initials(name){
  return String(name||'?').split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]?.toUpperCase()).join('')||'?';
}

function avatarTone(name){
  const total=[...String(name||'')].reduce((sum,char)=>sum+char.charCodeAt(0),0);
  return total%4;
}

function simplifyRail(root){
  root.querySelectorAll('.ll-client-card').forEach(card=>{
    card.classList.add('ll-elegant-client-row');
    const name=card.querySelector('.ll-client-name')?.textContent.trim()||'?';
    const avatar=card.querySelector('.ll-client-avatar');
    if(avatar){
      avatar.className=`ll-client-avatar ll-initial-avatar tone-${avatarTone(name)}`;
      avatar.innerHTML=`<span class="ll-client-initials">${initials(name)}</span>`;
    }
    card.querySelector('.ll-client-id')?.setAttribute('aria-hidden','true');
    const badge=card.querySelector('.ll-rail-badge');
    if(badge) badge.classList.add('ll-elegant-status');
  });
}

function applyElegantProfile(){
  const root=document.querySelector('#borrowerAccountContent .ll-account-shell');
  if(!root) return;
  root.classList.add('ll-elegant-profile');
  simplifyHeader(root);
  simplifySummary(root);
  simplifyRail(root);
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