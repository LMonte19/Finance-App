const ICONS = {
  spark:'<path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9 4.9 19.1"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  chevronDown:'<path d="m7 10 5 5 5-5"/>',
  sliders:'<path d="M4 6h10M18 6h2M14 4v4M4 12h3M11 12h9M7 10v4M4 18h8M16 18h4M12 16v4"/>',
  arrowUpRight:'<path d="M7 17 17 7M7 7h10v10"/>',
  phone:'<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z"/>',
  idCard:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M6 16c.7-1.4 3.3-1.4 4 0M13 9h5M13 13h5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alertCircle:'<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 17h.01"/>',
  dollar:'<circle cx="12" cy="12" r="9"/><path d="M16 8.5c-.8-1-2-1.5-4-1.5-2.2 0-3.5 1-3.5 2.5 0 3.8 7.5 1.5 7.5 5.2 0 1.5-1.4 2.6-3.8 2.6-1.9 0-3.4-.6-4.2-1.8M12 5v14"/>',
  note:'<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v5h5M9 12h6M9 16h6"/>',
  message:'<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.7 8.7 0 0 1-3.7-.9L3 21l1.7-5a8.3 8.3 0 1 1 16.3-4.5Z"/><path d="M8.5 8.8c.7 2.6 2.1 4 4.7 4.7"/>',
  download:'<path d="M12 3v12M7 10l5 5 5-5M4 19h16"/>',
  layout:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  receipt:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  creditCard:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/>',
  briefcase:'<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V4h6v3M3 12h18"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
  refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 8A7 7 0 0 1 18 6l2 2M17.9 16A7 7 0 0 1 6 18l-2-2"/>',
  checkSquare:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',
  phoneCall:'<path d="M15 5a6 6 0 0 1 4 4M15 1a10 10 0 0 1 8 8"/><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z"/>',
  chevronRight:'<path d="m9 18 6-6-6-6"/>',
  chevronLeft:'<path d="m15 18-6-6 6-6"/>'
};

function icon(name){
  return `<svg class="ll-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.layout}</svg>`;
}

function neutralAvatar(){
  return `<svg class="ll-avatar-placeholder" viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="30" r="16" fill="currentColor" opacity=".82"/><path d="M19 94c1.8-22.5 12-35 29-35s27.2 12.5 29 35H19Z" fill="currentColor" opacity=".72"/></svg>`;
}

function setButtonIcon(button,name,cleanPattern){
  if(!button) return;
  const label = button.textContent.replace(cleanPattern,'').trim();
  button.innerHTML = `${icon(name)}<span>${label}</span>`;
}

function polishClientDetail(){
  const root = document.querySelector('#borrowerAccountContent .ll-account-shell');
  if(!root || root.dataset.visualPolished === '1') return;
  root.dataset.visualPolished = '1';

  root.querySelectorAll('.ll-client-avatar,.ll-avatar-xl').forEach(avatar=>{
    if(!avatar.querySelector('img')) avatar.innerHTML = neutralAvatar();
    avatar.setAttribute('aria-label','Imagen genérica del cliente');
  });

  const logo = root.querySelector('.ll-logo-mark');
  if(logo) logo.innerHTML = icon('spark');
  const search = root.querySelector('.ll-icon-btn');
  if(search){search.innerHTML = icon('search');search.setAttribute('aria-label','Buscar clientes');}

  const filter = root.querySelector('.ll-filter-row');
  if(filter){
    const parts = filter.children;
    if(parts[0]){parts[0].classList.add('ll-filter-label');parts[0].innerHTML = `Todos los clientes ${icon('chevronDown')}`;}
    if(parts[1]){parts[1].classList.add('ll-filter-control');parts[1].innerHTML = icon('sliders');}
  }

  root.querySelectorAll('.ll-client-card').forEach(card=>{
    card.setAttribute('role','button');
    card.setAttribute('tabindex','0');
    const trailing = card.children[2];
    if(trailing){
      trailing.classList.add('ll-client-trailing');
      trailing.removeAttribute('style');
      const open = trailing.querySelector('span:first-child');
      if(open){open.classList.add('ll-client-open');open.innerHTML = icon('arrowUpRight');}
    }
  });

  const metaIcons = ['phone','idCard','calendar','alertCircle'];
  root.querySelectorAll('.ll-client-meta > span').forEach((item,index)=>{
    item.classList.add('ll-meta-item');
    const text = item.textContent.replace(/^[☎◴↗]\s*/,'').trim();
    item.innerHTML = `${icon(metaIcons[index] || 'idCard')}<span>${text}</span>`;
  });

  const actionButtons = root.querySelectorAll('.ll-action-row button');
  setButtonIcon(actionButtons[0],'dollar',/^\$\s*/);
  setButtonIcon(actionButtons[1],'note',/^▣\s*/);
  setButtonIcon(actionButtons[2],'message',/^☏\s*/);
  setButtonIcon(actionButtons[3],'download',/^↓\s*/);

  const tabMap = {Resumen:'layout',Cuotas:'receipt',Pagos:'creditCard',Desembolsos:'briefcase',Seguimientos:'clock'};
  root.querySelectorAll('.ll-tab').forEach(tab=>{
    const label = tab.textContent.trim();
    tab.innerHTML = `${icon(tabMap[label] || 'layout')}<span>${label}</span>`;
  });

  const statMap = ['dollar','note','calendar','refresh','calendar'];
  root.querySelectorAll('.ll-stat-icon').forEach((stat,index)=>stat.innerHTML = icon(statMap[index] || 'layout'));

  const calendarCard = [...root.querySelectorAll('.ll-card')].find(card=>card.querySelector('.ll-card-title')?.textContent.trim() === 'Calendario de cuotas');
  if(calendarCard){
    calendarCard.querySelector('.ll-card-title')?.remove();
    const head = calendarCard.querySelector('.ll-date-head');
    const month = head?.querySelector('span')?.textContent.trim() || 'Calendario';
    if(head) head.innerHTML = `<div class="ll-calendar-label">${icon('calendar')}<strong>Próximas fechas de pago</strong></div><div class="ll-calendar-nav"><span class="ll-calendar-arrow">${icon('chevronLeft')}</span><span>${month}</span><span class="ll-calendar-arrow">${icon('chevronRight')}</span></div>`;

    const due = calendarCard.querySelector('.ll-due-highlight');
    if(due){
      const first = due.children[0];
      if(first){first.classList.add('ll-due-title');first.innerHTML = `<span class="ll-due-title-icon">${icon('calendar')}</span><div>${first.innerHTML}</div>`;}
      due.insertAdjacentHTML('beforeend',`<span class="ll-due-chevron">${icon('chevronRight')}</span>`);
    }
  }

  root.querySelectorAll('.ll-side-title').forEach(title=>{
    const badge = title.querySelector('.ll-side-icon');
    if(!badge) return;
    const text = title.textContent.trim();
    const name = text.includes('Próxima acción') ? 'checkSquare' : text.includes('Cuota pendiente') ? 'calendar' : text.includes('Pago rápido') ? 'dollar' : 'note';
    badge.innerHTML = icon(name);
  });

  root.querySelectorAll('.ll-timeline-dot').forEach(dot=>{
    const value = dot.textContent.trim();
    dot.innerHTML = icon(value === '$' ? 'dollar' : value === '☎' ? 'phoneCall' : value === '↓' ? 'download' : 'checkSquare');
  });

  const back = root.querySelector('#acctBack');
  if(back){back.classList.add('ll-rail-back');setButtonIcon(back,'chevronLeft',/^/);}
}

function startPolishObserver(){
  const content = document.getElementById('borrowerAccountContent');
  if(!content || content.dataset.polishObserver === '1') return;
  content.dataset.polishObserver = '1';
  new MutationObserver(()=>queueMicrotask(polishClientDetail)).observe(content,{childList:true,subtree:true});
  polishClientDetail();
}

document.addEventListener('DOMContentLoaded',startPolishObserver);
window.addEventListener('loan-ledger:account-rendered',()=>setTimeout(()=>{startPolishObserver();polishClientDetail();},130));
startPolishObserver();

console.log('client detail visual polish active');
