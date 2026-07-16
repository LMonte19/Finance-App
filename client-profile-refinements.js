function ensureRefinementStyles() {
  if (document.getElementById('clientProfileRefinementsCss')) return;
  const link = document.createElement('link');
  link.id = 'clientProfileRefinementsCss';
  link.rel = 'stylesheet';
  link.href = './client-profile-refinements.css?v=1';
  document.head.appendChild(link);
}

const MONEY_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoneyText(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  nodes.forEach((node) => {
    const original = node.nodeValue || '';
    const updated = original.replace(/\$(-?\d+(?:\.\d+)?)/g, (_match, rawValue) => {
      const value = Number(rawValue);
      return Number.isFinite(value) ? `$${MONEY_FORMATTER.format(value)}` : _match;
    });
    if (updated !== original) node.nodeValue = updated;
  });
}

function refineCalendars(root) {
  root.querySelectorAll('.ll-cycle-calendar').forEach((calendar) => {
    const heading = calendar.querySelector('.ll-cycle-calendar-head strong');
    if (heading) heading.textContent = 'Cuotas pendientes';

    const detail = calendar.querySelector('.ll-cycle-detail');
    if (!detail) return;

    const firstBlock = detail.firstElementChild;
    const firstText = firstBlock?.textContent?.trim() || '';
    if (firstBlock && firstText.startsWith('Cuota del')) firstBlock.remove();
    detail.classList.add('ll-cycle-detail--compact');
  });
}

function reorderSummaryCards(root) {
  const sidebar = root.querySelector('[data-profile-panel="summary"] .ll-panel-side');
  if (!sidebar) return;

  const cards = [...sidebar.querySelectorAll(':scope > .ll-profile-card')];
  const byTitle = (title) => cards.find((card) => card.querySelector('.ll-card-title')?.textContent.trim() === title);

  byTitle('Cuota pendiente')?.remove();

  const stateCard = byTitle('Estado de la cuenta');
  const actionCard = byTitle('Próxima acción');
  const quickPayCard = byTitle('Pago rápido');

  [stateCard, actionCard, quickPayCard].filter(Boolean).forEach((card) => sidebar.appendChild(card));
}

function refineProfile() {
  ensureRefinementStyles();
  const host = document.querySelector('#borrowerAccountContent .ll-profile-tabs-host');
  if (!host || host.dataset.refinementVersion === '1') return;

  host.dataset.refinementVersion = '1';
  refineCalendars(host);
  reorderSummaryCards(host);
  formatMoneyText(host);
}

let queued = false;
function queueRefinement() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    refineProfile();
  });
}

ensureRefinementStyles();
document.addEventListener('DOMContentLoaded', queueRefinement);
window.addEventListener('loan-ledger:account-rendered', queueRefinement);
window.addEventListener('loan-ledger:open-account', queueRefinement);

const accountContent = document.getElementById('borrowerAccountContent');
if (accountContent) {
  new MutationObserver(queueRefinement).observe(accountContent, { childList:true, subtree:true });
}

queueRefinement();
console.log('client profile refinements active');
