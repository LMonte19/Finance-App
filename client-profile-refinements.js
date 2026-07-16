const MONEY_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

let carouselBusy = false;

function ensureRefinementStyles() {
  if (document.getElementById('clientProfileRefinementsCss')) return;
  const link = document.createElement('link');
  link.id = 'clientProfileRefinementsCss';
  link.rel = 'stylesheet';
  link.href = './client-profile-refinements.css?v=2';
  document.head.appendChild(link);
}

function formattedMoneyText(value) {
  const number = Number(String(value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) ? `$${MONEY_FORMATTER.format(number)}` : value;
}

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

  [byTitle('Estado de la cuenta'), byTitle('Próxima acción'), byTitle('Pago rápido')]
    .filter(Boolean)
    .forEach((card) => sidebar.appendChild(card));
}

function detailSnapshot(calendar) {
  const detail = calendar.querySelector('.ll-cycle-detail');
  if (!detail) return null;
  let cells = [...detail.children];
  if (cells.length === 6 && cells[0]?.textContent.trim().startsWith('Cuota del')) cells = cells.slice(1);
  if (cells.length < 5) return null;
  return {
    expected: cells[0].querySelector('strong')?.textContent || '',
    paid: cells[1].querySelector('strong')?.textContent || '',
    pending: cells[2].querySelector('strong')?.textContent || '',
    statusText: cells[3].querySelector('.ll-status-pill')?.textContent || '',
    statusClass: cells[3].querySelector('.ll-status-pill')?.className || 'll-status-pill pending',
    timing: cells[4].querySelector('strong')?.textContent || '',
  };
}

function calendarSnapshots(host) {
  const snapshots = new Map();
  host.querySelectorAll('.ll-cycle-calendar').forEach((calendar) => {
    const context = calendar.dataset.calendarContext || `calendar-${snapshots.size}`;
    snapshots.set(context, {
      context,
      title: calendar.querySelector('.ll-cycle-calendar-nav span')?.textContent || '',
      selectedIso: calendar.querySelector('.ll-cycle-date.selected')?.dataset.calendarDate || '',
      detail: detailSnapshot(calendar),
      row: calendar.querySelector('.ll-cycle-date-row'),
    });
  });
  return snapshots;
}

function restoreOriginalHost(root, oldHost, generatedHost) {
  generatedHost?.remove();
  root.querySelector('.ll-tabs')?.insertAdjacentElement('afterend', oldHost);
}

function transitionValue(element, nextText, nextClassName = null) {
  if (!element) return;
  const formatted = nextText.startsWith?.('$') ? formattedMoneyText(nextText) : nextText;
  const sameText = element.textContent === formatted;
  const sameClass = nextClassName === null || element.className === nextClassName;
  if (sameText && sameClass) return;

  element.classList.add('ll-value-leaving');
  window.setTimeout(() => {
    element.textContent = formatted;
    if (nextClassName !== null) element.className = nextClassName;
    element.classList.remove('ll-value-leaving');
    element.classList.add('ll-value-entering');
    requestAnimationFrame(() => requestAnimationFrame(() => element.classList.remove('ll-value-entering')));
  }, 130);
}

function updateDetailInPlace(calendar, snapshot) {
  if (!snapshot) return;
  const detail = calendar.querySelector('.ll-cycle-detail--compact');
  if (!detail) return;
  const cells = [...detail.children];
  if (cells.length < 5) return;

  transitionValue(cells[0].querySelector('strong'), snapshot.expected);
  transitionValue(cells[1].querySelector('strong'), snapshot.paid);
  transitionValue(cells[2].querySelector('strong'), snapshot.pending);
  transitionValue(cells[3].querySelector('.ll-status-pill'), snapshot.statusText, snapshot.statusClass);
  transitionValue(cells[4].querySelector('strong'), snapshot.timing);
}

function updateSelectedColor(host, iso) {
  host.querySelectorAll('.ll-cycle-calendar').forEach((calendar) => {
    calendar.querySelectorAll('[data-calendar-date]').forEach((button) => {
      button.classList.toggle('selected', button.dataset.calendarDate === iso);
    });
  });
}

function generatedHostAfterOriginal(root, originalHandler, element, event) {
  const oldHost = element.closest('.ll-profile-tabs-host');
  if (!oldHost || typeof originalHandler !== 'function') return null;
  originalHandler.call(element, event);
  const generatedHost = root.querySelector('.ll-profile-tabs-host');
  if (!generatedHost || generatedHost === oldHost) return null;
  return { oldHost, generatedHost, snapshots: calendarSnapshots(generatedHost) };
}

function handleDateSelection(button, event, originalHandler) {
  event.preventDefault();
  event.stopPropagation();
  if (carouselBusy) return;

  const root = button.closest('.ll-account-shell');
  if (!root) return;
  const result = generatedHostAfterOriginal(root, originalHandler, button, event);
  if (!result) return;

  const selectedIso = button.dataset.calendarDate;
  restoreOriginalHost(root, result.oldHost, result.generatedHost);
  updateSelectedColor(result.oldHost, selectedIso);

  result.oldHost.querySelectorAll('.ll-cycle-calendar').forEach((calendar) => {
    const context = calendar.dataset.calendarContext || '';
    updateDetailInPlace(calendar, result.snapshots.get(context)?.detail);
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function handleCarousel(button, event, originalHandler) {
  event.preventDefault();
  event.stopPropagation();
  if (carouselBusy) return;

  const root = button.closest('.ll-account-shell');
  if (!root) return;
  const result = generatedHostAfterOriginal(root, originalHandler, button, event);
  if (!result) return;

  restoreOriginalHost(root, result.oldHost, result.generatedHost);
  carouselBusy = true;
  const direction = Number(button.dataset.calendarMove || 0) > 0 ? 'forward' : 'backward';
  const oldCalendars = [...result.oldHost.querySelectorAll('.ll-cycle-calendar')];

  oldCalendars.forEach((calendar) => {
    calendar.querySelector('.ll-cycle-date-row')?.classList.add(`ll-carousel-out-${direction}`);
  });

  await wait(220);

  oldCalendars.forEach((calendar) => {
    const context = calendar.dataset.calendarContext || '';
    const snapshot = result.snapshots.get(context);
    if (!snapshot?.row) return;

    const oldRow = calendar.querySelector('.ll-cycle-date-row');
    const newRow = snapshot.row;
    oldRow?.replaceWith(newRow);

    const monthTitle = calendar.querySelector('.ll-cycle-calendar-nav span');
    if (monthTitle && monthTitle.textContent !== snapshot.title) monthTitle.textContent = snapshot.title;

    newRow.classList.add(`ll-carousel-in-${direction}`);
    bindCalendar(calendar);
    updateDetailInPlace(calendar, snapshot.detail);
    requestAnimationFrame(() => requestAnimationFrame(() => newRow.classList.remove(`ll-carousel-in-${direction}`)));
  });

  carouselBusy = false;
}

function bindCalendar(calendar) {
  calendar.querySelectorAll('[data-calendar-date]').forEach((button) => {
    if (button.dataset.llSmoothBound === '1') return;
    const originalHandler = button.onclick;
    button.dataset.llSmoothBound = '1';
    button.onclick = (event) => handleDateSelection(button, event, originalHandler);
  });

  calendar.querySelectorAll('[data-calendar-move]').forEach((button) => {
    if (button.dataset.llSmoothBound === '1') return;
    const originalHandler = button.onclick;
    button.dataset.llSmoothBound = '1';
    button.onclick = (event) => handleCarousel(button, event, originalHandler);
  });
}

function bindCalendarInteractions(root) {
  root.querySelectorAll('.ll-cycle-calendar').forEach(bindCalendar);
}

function refineProfile() {
  ensureRefinementStyles();
  const host = document.querySelector('#borrowerAccountContent .ll-profile-tabs-host');
  if (!host || host.dataset.refinementVersion === '3') return;

  host.dataset.refinementVersion = '3';
  refineCalendars(host);
  reorderSummaryCards(host);
  formatMoneyText(host);
  bindCalendarInteractions(host);
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

document.addEventListener('DOMContentLoaded', queueRefinement);
window.addEventListener('loan-ledger:account-rendered', queueRefinement);
window.addEventListener('loan-ledger:open-account', queueRefinement);

const accountContent = document.getElementById('borrowerAccountContent');
if (accountContent) new MutationObserver(queueRefinement).observe(accountContent, { childList:true, subtree:true });

queueRefinement();
console.log('client profile refinements active');
