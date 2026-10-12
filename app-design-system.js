// Shared presentation only: existing forms, handlers, permissions, and data remain owned by their modules.
const PAGE_COPY = {
  partnersPage: { es: ['Socios', 'Capital invertido, participaciones y distribuciones de tus socios.'], en: ['Partners', 'Invested capital, partner participation and distributions.'] },
  followupsPage: { es: ['Seguimientos', 'Organiza recordatorios, compromisos de pago y notas de contacto.'], en: ['Follow-ups', 'Organize reminders, payment commitments and contact notes.'] },
  activityPage: { es: ['Actividad', 'Revisa los movimientos y cambios recientes de la aplicación.'], en: ['Activity', 'Review recent application movements and changes.'] },
  loanHealthPage: { es: ['Revisión de cuentas', 'Consulta las alertas y el estado de las cuentas de tus clientes.'], en: ['Account review', 'Review alerts and the state of your client accounts.'] },
  dueOverduePage: { es: ['Cuotas y vencimientos', 'Consulta cuotas pendientes, próximas fechas y montos atrasados.'], en: ['Installments and due dates', 'Review pending installments, upcoming dates and overdue amounts.'] },
  reportsPage: { es: ['Reportes', 'Exporta cuentas, pagos y participaciones para revisar tu cartera.'], en: ['Reports', 'Export accounts, payments and partner participation to review your portfolio.'] },
  systemCheckPage: { es: ['Revisión del sistema', 'Consulta resultados, permisos y comprobaciones de la aplicación.'], en: ['System review', 'Review application results, permissions and checks.'] },
  profilesPage: { es: ['Perfiles y usuarios', 'Administra nombres y roles de las personas con acceso.'], en: ['Profiles and users', 'Manage the names and roles of people with access.'] },
  maintenancePage: { es: ['Mantenimiento', 'Herramientas administrativas para el mantenimiento de la aplicación.'], en: ['Maintenance', 'Administrative tools for application maintenance.'] },
  defaultsPage: { es: ['Configuración', 'Define tasas y distribución de inversión para nuevos desembolsos.'], en: ['Settings', 'Set default rates and investment distribution for new disbursements.'] }
};
const CONTAINER_PAGES = new Set(['profilesPage', 'reportsPage', 'maintenancePage', 'dueOverduePage']);
const SUMMARY_PAGES = new Set(['partnersPage', 'followupsPage', 'loanHealthPage']);
const FILTER_IDS = ['filterFollowupsOpen', 'filterFollowupsOverdue', 'filterFollowupsToday', 'filterFollowupsAll', 'healthFilterAll', 'healthFilterHigh', 'healthFilterMedium', 'healthFilterLow'];

function addClass(node, name) {
  if (node && !node.classList.contains(name)) node.classList.add(name);
}
function setText(node, value) {
  if (node.textContent !== value) node.textContent = value;
}
function ensureStyle() {
  if (document.getElementById('appDesignSystemCss')) return;
  const link = document.createElement('link');
  link.id = 'appDesignSystemCss';
  link.rel = 'stylesheet';
  link.href = './app-design-system.css?v=1';
  document.head.appendChild(link);
}
function ensurePageHeader(page, copy) {
  let header = page.querySelector(':scope > .ll-ui-page-header');
  if (!header) {
    header = document.createElement('header');
    header.className = 'll-ui-page-header';
    header.dataset.noTranslate = 'true';
    const text = document.createElement('div');
    text.append(document.createElement('h1'), document.createElement('p'));
    header.appendChild(text);
    page.prepend(header);
  }
  const language = localStorage.getItem('loanLedger.language') === 'en' ? 'en' : 'es';
  const [title, description] = copy[language];
  setText(header.querySelector('h1'), title);
  setText(header.querySelector('p'), description);
  return header;
}
function decoratePage(page, copy) {
  addClass(page, 'll-ui-page');
  const header = ensurePageHeader(page, copy);
  const cards = [...page.querySelectorAll('.card')];
  cards.forEach(card => {
    addClass(card, 'll-ui-card');
    const title = [...card.children].find(node => node.tagName === 'DIV' && node.style.fontWeight === '800')
      || card.querySelector(':scope > div > div[style*="font-weight:800"]');
    if (title) {
      addClass(title, 'll-ui-section-title');
      if (!title.hasAttribute('role')) {
        title.setAttribute('role', 'heading');
        title.setAttribute('aria-level', '2');
      }
    }
  });
  const first = page.querySelector(':scope > .card');
  if (first) {
    if (CONTAINER_PAGES.has(page.id)) addClass(first, 'll-ui-container-card');
    if (SUMMARY_PAGES.has(page.id) && first.querySelector('.stats-grid')) addClass(first, 'll-ui-summary-card');
    if (page.id !== 'defaultsPage') {
      const title = first.querySelector('.ll-ui-section-title');
      addClass(title, 'll-ui-duplicate-heading');
      if (title) title.removeAttribute('role');
      [...first.children].filter(node => node.classList.contains('muted') && !node.id && node.children.length === 0)
        .forEach(node => addClass(node, 'll-ui-duplicate-description'));
    }
  }
  if (page.id === 'reportsPage') {
    const intro = document.querySelector('#reportsPageContent > .card');
    if (intro) {
      addClass(intro, 'll-ui-report-range');
      addClass(intro.querySelector('.ll-ui-section-title'), 'll-ui-duplicate-heading');
    }
  }
  if (page.id === 'systemCheckPage') {
    const refresh = page.querySelector('#btnRefreshSystemCheck');
    if (refresh && refresh.parentElement !== header) header.appendChild(refresh);
    if (first) addClass(first, 'll-ui-empty-intro');
  }
  if (page.id === 'followupsPage') {
    addClass(page.querySelector('#filterFollowupsOpen')?.closest('.card'), 'll-ui-filter-card');
  }
  if (page.id === 'loanHealthPage') {
    addClass(page.querySelector('#healthFilterAll')?.closest('.card'), 'll-ui-filter-card');
  }
}
function decorateFilters() {
  FILTER_IDS.forEach(id => {
    const button = document.getElementById(id);
    if (!button) return;
    addClass(button, 'll-ui-filter-button');
    const background = String(button.style.background || '').replace(/\s+/g, '').toLowerCase();
    const selected = background === '#2b63ff' || background === 'rgb(43,99,255)';
    const pressed = selected ? 'true' : 'false';
    if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
  });
}
function decorateStatuses() {
  document.querySelectorAll('.ll-ui-page .pill, .ll-ui-page .activity-chip').forEach(node => {
    const label = node.textContent.trim().toUpperCase();
    const color = String(node.style.color || '').toLowerCase();
    let tone = '';
    if (/^(HIGH|ALTA|URGENT|URGENTE|FAIL|FALLA|NO|ANULADO)$/.test(label) || ['#ff8b8b', '#ff515b'].includes(color)) tone = 'danger';
    else if (/^(MEDIUM|MEDIA|WARN|REVISAR|OVERDUE|ATRASADO|ATRASADA)$/.test(label) || color === '#ffd27a') tone = 'warning';
    else if (/^(PASS|BIEN|SI|SÍ|DONE|COMPLETADO|CURRENT|AL DÍA)$/.test(label) || color === '#9ff5b2') tone = 'success';
    else if (/^(LOW|BAJA)$/.test(label) || color === '#8fb1ff') tone = 'info';
    if (node.dataset.uiTone !== tone) node.dataset.uiTone = tone;
  });
}
function refreshPresentation() {
  ensureStyle();
  Object.entries(PAGE_COPY).forEach(([id, copy]) => {
    const page = document.getElementById(id);
    if (page) decoratePage(page, copy);
  });
  decorateFilters();
  decorateStatuses();
}
let scheduled = false;
function schedulePresentation() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    refreshPresentation();
  });
}
ensureStyle();
const app = document.getElementById('app');
if (app) new MutationObserver(schedulePresentation).observe(app, {
  childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style']
});
new MutationObserver(schedulePresentation).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
document.addEventListener('click', event => {
  if (event.target.closest?.('.ll-ui-filter-button, #btnLangToggle, [data-global-action="language"]')) schedulePresentation();
});
window.addEventListener('storage', event => {
  if (event.key === 'loanLedger.language') schedulePresentation();
});
refreshPresentation();

