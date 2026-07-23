const GLOBAL_NAV_STORAGE='loanLedger.globalNavExpanded';
const CLIENT_RAIL_STORAGE='loanLedger.clientRailCollapsed';

const ICONS={
  logo:'<path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9 4.9 19.1"/>',
  menu:'<path d="M5 7h14M5 12h14M5 17h14"/>',
  home:'<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  loans:'<path d="M4 7.5h16v11H4z"/><path d="M7 7.5V5h10v2.5M8 12h8M8 15h5"/>',
  payments:'<circle cx="12" cy="12" r="8"/><path d="M14.8 8.7c-.7-.7-1.6-1-2.8-1-1.7 0-2.8.7-2.8 1.9 0 2.8 5.6 1.1 5.6 4 0 1.3-1.2 2.2-3.1 2.2-1.5 0-2.7-.5-3.5-1.3M12 5.5v13"/>',
  clients:'<circle cx="9" cy="8" r="3"/><path d="M3.8 19c.5-4 2.4-6 5.2-6s4.7 2 5.2 6"/><circle cx="17" cy="9" r="2.2"/><path d="M15.3 14c3.2-.6 5.1 1.1 5.5 4"/>',
  partners:'<circle cx="8" cy="8" r="2.7"/><circle cx="16" cy="8" r="2.7"/><path d="M3.5 19c.4-3.7 1.9-5.8 4.5-5.8s4.1 2.1 4.5 5.8M11.5 19c.4-3.7 1.9-5.8 4.5-5.8s4.1 2.1 4.5 5.8"/>',
  followups:'<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  activity:'<path d="M4 17h3l2-5 3 3 3-7 2 4h3"/>',
  review:'<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h5M8 16h7"/>',
  calendar:'<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M8 3.5v4M16 3.5v4M4 9.5h16"/>',
  reports:'<path d="M5 19V9M10 19V5M15 19v-7M20 19V3"/>',
  system:'<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  users:'<circle cx="9" cy="8" r="3"/><path d="M3.8 19c.5-4 2.4-6 5.2-6s4.7 2 5.2 6M16 7h4M18 5v4M16 14h4M18 12v4"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.6a7 7 0 0 0-.7-1.6l1-1.9-2.1-2.1-1.9 1A7 7 0 0 0 11.5 5L11 3H8l-.6 2a7 7 0 0 0-1.6.7l-1.9-1L1.8 6.8l1 1.9A7 7 0 0 0 2.1 10L0 10.5v3l2 .6a7 7 0 0 0 .7 1.6l-1 1.9 2.1 2.1 1.9-1a7 7 0 0 0 1.6.7l.6 2h3l.6-2a7 7 0 0 0 1.6-.7l1.9 1 2.1-2.1-1-1.9a7 7 0 0 0 .7-1.6z" transform="translate(2 -1) scale(.83)"/>',
  maintenance:'<path d="m5 19 6-6M14 5l5 5M13 6l5 5M4 20l3-1-2-2z"/><path d="M10 4a4 4 0 0 0 5 5l4 4-4 4-4-4a4 4 0 0 1-5-5z"/>',
  theme:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
  language:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9S14.5 18.4 12 21M12 3c-2.5 2.6-3.7 5.6-3.7 9S9.5 18.4 12 21"/>',
  logout:'<path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10"/>',
  chevron:'<path d="m9 6 6 6-6 6"/>'
};

function svg(name,cls='ll-global-svg'){
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]||ICONS.home}</svg>`;
}

const PRIMARY=[
  {page:'dashboardPage',label:'Inicio',icon:'home'},
  {page:'loansPage',label:'Préstamos',icon:'loans'},
  {page:'paymentsPage',label:'Pagos',icon:'payments'},
];

const PAGE_META={
  borrowersPage:['Clientes','clients'],
  partnersPage:['Socios','partners'],
  followupsPage:['Seguimientos','followups'],
  activityPage:['Actividad','activity'],
  loanHealthPage:['Revisión de cuentas','review'],
  dueOverduePage:['Cuotas / vencimientos','calendar'],
  reportsPage:['Reportes','reports'],
  systemCheckPage:['Revisión del sistema','system'],
  profilesPage:['Perfiles / usuarios','users'],
  maintenancePage:['Mantenimiento','maintenance'],
  defaultsPage:['Configuración','settings'],
};

function ensureStyle(){
  let link=document.getElementById('globalAppSidebarCss');
  const href='./global-app-sidebar.css?v=1';
  if(link){if(link.getAttribute('href')!==href)link.setAttribute('href',href);return;}
  link=document.createElement('link');link.id='globalAppSidebarCss';link.rel='stylesheet';link.href=href;document.head.appendChild(link);
}

function appIsSignedIn(){
  const app=document.getElementById('app');
  return !!app && getComputedStyle(app).display!=='none';
}

function createSidebar(){
  let nav=document.getElementById('llGlobalSidebar');
  if(nav)return nav;
  nav=document.createElement('aside');
  nav.id='llGlobalSidebar';
  nav.className='ll-global-sidebar';
  nav.innerHTML=`
    <div class="ll-global-head">
      <button class="ll-global-logo" type="button" data-global-toggle aria-label="Abrir menú">${svg('logo')}</button>
      <div class="ll-global-brand"><strong>Control de Préstamos</strong><span id="llGlobalUser">Usuario</span></div>
      <button class="ll-global-menu-toggle" type="button" data-global-toggle aria-label="Abrir o cerrar menú">${svg('menu')}</button>
    </div>
    <nav class="ll-global-primary" aria-label="Navegación principal"></nav>
    <div class="ll-global-divider"></div>
    <nav class="ll-global-secondary" aria-label="Más herramientas"></nav>
    <div class="ll-global-spacer"></div>
    <div class="ll-global-footer">
      <button type="button" class="ll-global-action" data-global-action="theme">${svg('theme')}<span>Tema</span></button>
      <button type="button" class="ll-global-action" data-global-action="language">${svg('language')}<span>Idioma</span><em id="llGlobalLang">EN</em></button>
      <button type="button" class="ll-global-action ll-global-logout" data-global-action="logout">${svg('logout')}<span>Cerrar sesión</span></button>
    </div>`;
  document.body.prepend(nav);

  const primary=nav.querySelector('.ll-global-primary');
  PRIMARY.forEach(item=>{
    const btn=document.createElement('button');
    btn.type='button';btn.className='ll-global-nav-item';btn.dataset.page=item.page;
    btn.innerHTML=`${svg(item.icon)}<span>${item.label}</span>`;
    btn.onclick=()=>activatePage(item.page);
    primary.appendChild(btn);
  });

  nav.querySelectorAll('[data-global-toggle]').forEach(btn=>btn.onclick=toggleGlobalNav);
  nav.querySelector('[data-global-action="theme"]').onclick=()=>document.getElementById('btnThemeToggle')?.click();
  nav.querySelector('[data-global-action="language"]').onclick=()=>document.getElementById('btnLangToggle')?.click();
  nav.querySelector('[data-global-action="logout"]').onclick=()=>document.getElementById('btnSignOut')?.click();
  return nav;
}

function activatePage(pageId){
  const primary=document.querySelector(`#app > .tabs .tab-btn[data-page="${pageId}"]`);
  if(primary){primary.click();syncActive();return;}
  const source=document.querySelector(`#sideMenu .menu-link[data-page="${pageId}"]`);
  if(source){source.click();syncActive();return;}
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active-page'));
  document.getElementById(pageId)?.classList.add('active-page');
  syncActive();
}

function rebuildSecondary(){
  const nav=createSidebar();
  const container=nav.querySelector('.ll-global-secondary');
  const sources=[...document.querySelectorAll('#sideMenu .menu-link[data-page]')];
  const seen=new Set();
  const items=[];
  sources.forEach(source=>{
    const page=source.dataset.page;
    if(!page||PRIMARY.some(x=>x.page===page)||seen.has(page))return;
    seen.add(page);
    const meta=PAGE_META[page]||[(source.textContent||page).trim(),'settings'];
    items.push({page,label:meta[0],icon:meta[1],source,hidden:source.style.display==='none'||source.dataset.roleHidden==='true'});
  });
  Object.entries(PAGE_META).forEach(([page,meta])=>{
    if(seen.has(page))return;
    const pageEl=document.getElementById(page);
    if(pageEl)items.push({page,label:meta[0],icon:meta[1],source:null,hidden:false});
  });

  const signature=items.map(x=>`${x.page}:${x.hidden}`).join('|');
  if(container.dataset.signature===signature)return;
  container.dataset.signature=signature;
  container.innerHTML='';
  items.forEach(item=>{
    const btn=document.createElement('button');
    btn.type='button';btn.className='ll-global-nav-item ll-global-secondary-item';btn.dataset.page=item.page;
    btn.innerHTML=`${svg(item.icon)}<span>${item.label}</span>`;
    if(item.hidden)btn.hidden=true;
    btn.onclick=()=>item.source?item.source.click():activatePage(item.page);
    container.appendChild(btn);
  });
}

function toggleGlobalNav(){
  const expanded=!document.body.classList.contains('ll-global-nav-expanded');
  document.body.classList.toggle('ll-global-nav-expanded',expanded);
  localStorage.setItem(GLOBAL_NAV_STORAGE,expanded?'1':'0');
}

function syncUser(){
  const who=(document.getElementById('whoami')?.textContent||'').trim();
  const el=document.getElementById('llGlobalUser');
  if(el&&who&&who!=='Sesión no iniciada')el.textContent=who;
  const lang=document.getElementById('btnLangToggle');
  const langEl=document.getElementById('llGlobalLang');
  if(langEl&&lang)langEl.textContent=(lang.textContent||'EN').trim();
}

function syncActive(){
  const active=document.querySelector('.page.active-page')?.id||'';
  document.querySelectorAll('#llGlobalSidebar .ll-global-nav-item[data-page]').forEach(btn=>btn.classList.toggle('active',btn.dataset.page===active));
}

function syncShell(){
  ensureStyle();
  const signed=appIsSignedIn();
  document.body.classList.toggle('ll-global-shell-active',signed);
  if(!signed)return;
  createSidebar();
  if(localStorage.getItem(GLOBAL_NAV_STORAGE)==='1')document.body.classList.add('ll-global-nav-expanded');
  rebuildSecondary();syncUser();syncActive();syncClientRailState();
}

function syncClientRailState(){
  const shell=document.querySelector('#borrowerAccountContent .ll-account-shell');
  if(!shell)return;
  const collapsed=localStorage.getItem(CLIENT_RAIL_STORAGE)==='1';
  shell.classList.toggle('ll-client-rail-collapsed',collapsed);
  const btn=shell.querySelector('#acctBack');
  if(btn){btn.setAttribute('aria-label',collapsed?'Expandir clientes':'Colapsar clientes');btn.title=collapsed?'Expandir clientes':'Colapsar clientes';}
}

function toggleClientRail(){
  const shell=document.querySelector('#borrowerAccountContent .ll-account-shell');
  if(!shell)return;
  const collapsed=!shell.classList.contains('ll-client-rail-collapsed');
  shell.classList.toggle('ll-client-rail-collapsed',collapsed);
  localStorage.setItem(CLIENT_RAIL_STORAGE,collapsed?'1':'0');
  syncClientRailState();
}

document.addEventListener('click',event=>{
  const btn=event.target.closest?.('#borrowerAccountContent #acctBack');
  if(!btn)return;
  event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
  toggleClientRail();
},true);

ensureStyle();
const observer=new MutationObserver(()=>{clearTimeout(window.__llGlobalNavTimer);window.__llGlobalNavTimer=setTimeout(syncShell,80);});
observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']});
document.addEventListener('DOMContentLoaded',syncShell);
window.addEventListener('loan-ledger:account-rendered',()=>setTimeout(syncShell,120));
window.addEventListener('loan-ledger:open-account',()=>setTimeout(syncShell,120));
setInterval(syncShell,1800);
setTimeout(syncShell,150);
setTimeout(syncShell,700);

console.log('global application sidebar active');