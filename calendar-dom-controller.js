import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(
  'https://eatxkhhpjruwwibhcubf.supabase.co',
  'sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q',
  { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, storage:window.localStorage, storageKey:'loan-ledger-auth' } }
);

const moneyFormatter = new Intl.NumberFormat('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });
const money = value => `$${moneyFormatter.format(Number(value || 0))}`;
let trackedBorrowerId = null;
let busy = false;

const parseIso = iso => {
  const [year, month, day] = String(iso).split('-').map(Number);
  return new Date(year, month - 1, day);
};
const toIso = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const addMonths = (date, months) => new Date(date.getFullYear(), date.getMonth() + months, 1);
const lastDay = (year, month) => new Date(year, month + 1, 0).getDate();
const todayIso = () => toIso(new Date());

function cycleDatesAround(baseDate = new Date(), before = 24, after = 24) {
  const dates = [];
  for (let cursor = addMonths(baseDate, -before); cursor <= addMonths(baseDate, after); cursor = addMonths(cursor, 1)) {
    dates.push(new Date(cursor.getFullYear(), cursor.getMonth(), 15));
    dates.push(new Date(cursor.getFullYear(), cursor.getMonth(), lastDay(cursor.getFullYear(), cursor.getMonth())));
  }
  return dates.sort((a,b) => a - b);
}

function daysFromToday(iso) {
  return Math.round((parseIso(iso) - parseIso(todayIso())) / 86400000);
}

function timingLabel(iso) {
  const days = daysFromToday(iso);
  if (days < 0) return `Hace ${Math.abs(days)} días`;
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Mañana';
  return `En ${days} días`;
}

function statusKey(row) {
  if (row?.status === 'PAID' || row?.timing_status === 'PAID') return 'PAID';
  if (row?.status === 'PARTIAL') return 'PARTIAL';
  if (row?.timing_status === 'OVERDUE') return 'OVERDUE';
  if (row?.timing_status === 'DUE_TODAY') return 'DUE_TODAY';
  if (row?.status === 'CANCELLED' || row?.timing_status === 'CANCELLED') return 'CANCELLED';
  return row?.status || row?.timing_status || 'UPCOMING';
}

function statusLabel(value) {
  return {
    PAID:'PAGADA', PARTIAL:'PARCIAL', OVERDUE:'ATRASADA', DUE_TODAY:'VENCE HOY',
    CANCELLED:'CANCELADA', DUE:'PENDIENTE', UPCOMING:'PENDIENTE'
  }[value] || value || 'PENDIENTE';
}

function tone(value) {
  if (value === 'OVERDUE') return 'danger';
  if (['DUE','PARTIAL','UPCOMING','DUE_TODAY'].includes(value)) return 'pending';
  if (['CANCELLED'].includes(value)) return 'closed';
  return 'ok';
}

function borrowerId() {
  return trackedBorrowerId || document.querySelector('.ll-client-card.active[data-acct-borrower]')?.dataset.acctBorrower || null;
}

async function dueRows(startIso, endIso) {
  const id = borrowerId();
  if (!id) throw new Error('No se encontró el cliente activo.');
  const { data, error } = await db.rpc('get_borrower_due_calendar', {
    p_borrower_id:id,
    p_start_date:startIso,
    p_end_date:endIso,
  });
  if (error) throw error;
  return data || [];
}

function calendars() {
  return [...document.querySelectorAll('#borrowerAccountContent .ll-profile-tabs-host .ll-cycle-calendar')];
}

function detailCells(calendar) {
  const detail = calendar.querySelector('.ll-cycle-detail--compact');
  const cells = detail ? [...detail.children] : [];
  return cells.length >= 5 ? {
    expected:cells[0].querySelector('strong'),
    paid:cells[1].querySelector('strong'),
    pending:cells[2].querySelector('strong'),
    status:cells[3].querySelector('.ll-status-pill'),
    timing:cells[4].querySelector('strong'),
  } : null;
}

async function animateValue(element, nextText, nextClass = null) {
  if (!element) return;
  const sameText = element.textContent === nextText;
  const sameClass = nextClass === null || element.className === nextClass;
  if (sameText && sameClass) return;

  if (element.animate) {
    try {
      await element.animate([
        { opacity:1, transform:'translateY(0)' },
        { opacity:0, transform:'translateY(-4px)' },
      ], { duration:140, easing:'ease-out', fill:'forwards' }).finished;
    } catch {}
  }

  element.textContent = nextText;
  if (nextClass !== null) element.className = nextClass;

  if (element.animate) {
    element.animate([
      { opacity:0, transform:'translateY(4px)' },
      { opacity:1, transform:'translateY(0)' },
    ], { duration:220, easing:'cubic-bezier(.22,.61,.36,1)', fill:'both' });
  }
}

function updateSelectedButtons(iso) {
  calendars().forEach(calendar => {
    calendar.querySelectorAll('[data-calendar-date]').forEach(button => {
      button.classList.toggle('selected', button.dataset.calendarDate === iso);
    });
  });
}

async function updateDetails(row, iso) {
  const key = statusKey(row);
  const jobs = [];
  calendars().forEach(calendar => {
    const cells = detailCells(calendar);
    if (!cells) return;
    jobs.push(animateValue(cells.expected, money(row.expected_total)));
    jobs.push(animateValue(cells.paid, money(row.paid_total)));
    jobs.push(animateValue(cells.pending, money(row.amount_due)));
    jobs.push(animateValue(cells.status, statusLabel(key), `ll-status-pill ${tone(key)}`));
    jobs.push(animateValue(cells.timing, timingLabel(iso)));
  });
  await Promise.all(jobs);
}

async function selectDate(iso) {
  if (busy) return;
  busy = true;
  try {
    updateSelectedButtons(iso);
    const rows = await dueRows(iso, iso);
    const row = rows[0] || { due_date:iso, expected_total:0, paid_total:0, amount_due:0, status:'DUE', timing_status:daysFromToday(iso) < 0 ? 'OVERDUE' : 'UPCOMING' };
    await updateDetails(row, iso);
  } catch (error) {
    console.error('calendar date update failed', error);
  } finally {
    busy = false;
  }
}

function monthRangeTitle(dates) {
  const formatter = new Intl.DateTimeFormat('es', { month:'long', year:'numeric' });
  const first = formatter.format(dates[0]);
  const last = formatter.format(dates[dates.length - 1]);
  return first === last ? first : `${first} – ${last}`;
}

function currentVisibleDates(calendar) {
  return [...calendar.querySelectorAll('[data-calendar-date]')].map(button => parseIso(button.dataset.calendarDate));
}

function shiftedDates(calendar, direction) {
  const current = currentVisibleDates(calendar);
  const first = current[0] || new Date();
  const all = cycleDatesAround(first, 24, 24);
  const firstIndex = Math.max(0, all.findIndex(date => toIso(date) === toIso(first)));
  const shift = direction > 0 ? 2 : -2;
  const start = Math.max(0, Math.min(firstIndex + shift, all.length - 6));
  return all.slice(start, start + 6);
}

function updateButton(button, date, row, selectedIso) {
  const iso = toIso(date);
  const key = statusKey(row);
  button.dataset.calendarDate = iso;
  button.className = `ll-cycle-date ${iso === selectedIso ? 'selected' : ''} ${tone(key)}`;
  const pieces = button.children;
  if (pieces[0]) pieces[0].textContent = date.toLocaleDateString('es',{weekday:'short'}).replace('.','');
  if (pieces[1]) pieces[1].textContent = String(date.getDate());
  if (pieces[2]) pieces[2].textContent = date.toLocaleDateString('es',{month:'short'}).replace('.','').toUpperCase();
}

async function animateRow(row, keyframes, options) {
  if (!row?.animate) return;
  try { await row.animate(keyframes, options).finished; } catch {}
}

async function moveCarousel(direction) {
  if (busy) return;
  const active = calendars()[0];
  if (!active) return;
  busy = true;
  try {
    const dates = shiftedDates(active, direction);
    const startIso = toIso(dates[0]);
    const endIso = toIso(dates[dates.length - 1]);
    const rows = await dueRows(startIso, endIso);
    const rowMap = new Map(rows.map(row => [row.due_date, row]));
    const currentSelected = active.querySelector('.ll-cycle-date.selected')?.dataset.calendarDate;
    const visibleIsos = dates.map(toIso);
    const selectedIso = visibleIsos.includes(currentSelected) ? currentSelected : visibleIsos[direction > 0 ? 1 : 4];

    const allCalendars = calendars();
    await Promise.all(allCalendars.map(calendar => animateRow(
      calendar.querySelector('.ll-cycle-date-row'),
      [{opacity:1,transform:'translateX(0)'},{opacity:0,transform:`translateX(${direction > 0 ? -44 : 44}px)`}],
      {duration:220,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'}
    )));

    allCalendars.forEach(calendar => {
      const buttons = [...calendar.querySelectorAll('[data-calendar-date]')];
      buttons.forEach((button,index) => {
        const iso = toIso(dates[index]);
        const row = rowMap.get(iso) || { status:'DUE', timing_status:daysFromToday(iso) < 0 ? 'OVERDUE' : 'UPCOMING' };
        updateButton(button, dates[index], row, selectedIso);
      });
      const title = calendar.querySelector('.ll-cycle-calendar-nav span');
      if (title) title.textContent = monthRangeTitle(dates);
      const row = calendar.querySelector('.ll-cycle-date-row');
      if (row) {
        row.style.opacity = '1';
        row.style.transform = 'translateX(0)';
        row.animate?.([
          {opacity:0,transform:`translateX(${direction > 0 ? 44 : -44}px)`},
          {opacity:1,transform:'translateX(0)'},
        ], {duration:340,easing:'cubic-bezier(.22,.61,.36,1)',fill:'both'});
      }
    });

    const selectedRow = rowMap.get(selectedIso) || { due_date:selectedIso, expected_total:0, paid_total:0, amount_due:0, status:'DUE', timing_status:daysFromToday(selectedIso) < 0 ? 'OVERDUE' : 'UPCOMING' };
    await updateDetails(selectedRow, selectedIso);
  } catch (error) {
    console.error('calendar carousel update failed', error);
  } finally {
    busy = false;
  }
}

document.addEventListener('click', (event) => {
  const dateButton = event.target.closest?.('#borrowerAccountContent .ll-profile-tabs-host [data-calendar-date]');
  if (dateButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    selectDate(dateButton.dataset.calendarDate);
    return;
  }

  const moveButton = event.target.closest?.('#borrowerAccountContent .ll-profile-tabs-host [data-calendar-move]');
  if (moveButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    moveCarousel(Number(moveButton.dataset.calendarMove || 0));
  }
}, true);

document.addEventListener('click', (event) => {
  const card = event.target.closest?.('[data-acct-borrower]');
  if (card?.dataset.acctBorrower) trackedBorrowerId = card.dataset.acctBorrower;
}, true);

window.addEventListener('loan-ledger:open-account', event => {
  if (event.detail?.borrowerId) trackedBorrowerId = event.detail.borrowerId;
});
window.addEventListener('loan-ledger:account-rendered', event => {
  if (event.detail?.borrowerId) trackedBorrowerId = event.detail.borrowerId;
});

console.log('direct calendar DOM controller active');
