import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(
  'https://eatxkhhpjruwwibhcubf.supabase.co',
  'sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q',
  { auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, storage:window.localStorage, storageKey:'loan-ledger-auth' } }
);

const money = value => `$${Number(value || 0).toFixed(2)}`;
const today = () => new Date().toISOString().slice(0, 10);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
let currentBorrowerId = null;
let activeTab = 'summary';
let renderSequence = 0;
let currentData = null;
let calendarOffset = 0;
let selectedDueIso = null;

function formatDate(iso, options = { day:'2-digit', month:'short', year:'numeric' }) {
  if (!iso) return '—';
  try { return new Date(`${iso}T00:00:00`).toLocaleDateString('es', options).replace('.', ''); }
  catch { return iso; }
}

function statusLabel(value) {
  const key = String(value || '').toUpperCase();
  return {
    ACTIVE:'ACTIVO', CURRENT:'AL DÍA', OVERDUE:'ATRASADO', ATRASADO:'ATRASADO',
    PAID:'PAGADA', PARTIAL:'PARCIAL', OPEN:'ABIERTO', DONE:'COMPLETADO',
    UPCOMING:'PRÓXIMA', DUE:'PENDIENTE', DUE_TODAY:'VENCE HOY',
    CANCELLED:'CANCELADA', CLOSED:'CERRADO', PAID_OFF:'SALDADO', VOIDED:'ANULADO'
  }[key] || value || '—';
}

function tone(value) {
  const key = String(value || '').toUpperCase();
  if (['OVERDUE','ATRASADO','DANGER','URGENT'].includes(key)) return 'danger';
  if (['DUE','PARTIAL','PENDING','PENDIENTE','HIGH'].includes(key)) return 'pending';
  if (['CLOSED','PAID_OFF','CANCELLED','VOIDED'].includes(key)) return 'closed';
  return 'ok';
}

function parseIso(iso) {
  const [year, month, day] = String(iso).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toIso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function lastDay(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function cycleDatesAround(baseDate = new Date(), monthsBefore = 12, monthsAfter = 18) {
  const dates = [];
  for (let cursor = addMonths(baseDate, -monthsBefore); cursor <= addMonths(baseDate, monthsAfter); cursor = addMonths(cursor, 1)) {
    dates.push(new Date(cursor.getFullYear(), cursor.getMonth(), 15));
    dates.push(new Date(cursor.getFullYear(), cursor.getMonth(), lastDay(cursor.getFullYear(), cursor.getMonth())));
  }
  return dates.sort((a,b) => a - b);
}

function nextCycleIso(from = new Date()) {
  const start = parseIso(toIso(from));
  const found = cycleDatesAround(from, 1, 3).find(date => date >= start);
  return toIso(found || start);
}

function daysFromToday(iso) {
  if (!iso) return null;
  return Math.round((parseIso(iso) - parseIso(today())) / 86400000);
}

function dueTiming(iso) {
  const days = daysFromToday(iso);
  if (days === null || Number.isNaN(days)) return 'Sin fecha';
  if (days < 0) return `Hace ${Math.abs(days)} días`;
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Mañana';
  return `En ${days} días`;
}

function paymentTypeLabel(type) {
  return { INSTALLMENT:'Cuota/interés', PRINCIPAL:'Abono a capital', MIXED:'Mixto', PAYOFF:'Saldar capital' }[type] || type || '—';
}

function dueStatus(row) {
  if (row?.status === 'PAID' || row?.timing_status === 'PAID') return 'PAID';
  if (row?.status === 'PARTIAL') return 'PARTIAL';
  if (row?.timing_status === 'OVERDUE') return 'OVERDUE';
  if (row?.timing_status === 'DUE_TODAY') return 'DUE_TODAY';
  if (row?.status === 'CANCELLED' || row?.timing_status === 'CANCELLED') return 'CANCELLED';
  return row?.status || row?.timing_status || 'UPCOMING';
}

async function currentUserId() {
  const { data, error } = await db.auth.getUser();
  if (error) throw error;
  if (!data.user?.id) throw new Error('No se encontró una sesión activa.');
  return data.user.id;
}

async function loadProfileData(borrowerId) {
  const rangeDates = cycleDatesAround(new Date(), 12, 18);
  const startIso = toIso(rangeDates[0]);
  const endIso = toIso(rangeDates[rangeDates.length - 1]);
  const [summaryRes, calendarRes, disbRes, payRes, contactRes, followRes, settingsRes, fundingRes, profilesRes] = await Promise.all([
    db.from('borrower_account_summary').select('*').eq('borrower_id', borrowerId).single(),
    db.rpc('get_borrower_due_calendar', { p_borrower_id:borrowerId, p_start_date:startIso, p_end_date:endIso }),
    db.from('borrower_disbursements_view').select('*').eq('borrower_id', borrowerId).order('start_date', { ascending:false }),
    db.from('borrower_account_payments_view').select('*').eq('borrower_id', borrowerId).order('paid_on', { ascending:false }).order('created_at', { ascending:false }).limit(120),
    db.from('borrower_contact_log_view').select('*').eq('borrower_id', borrowerId).order('created_at', { ascending:false }).limit(80),
    db.from('borrower_followups_view').select('*').eq('borrower_id', borrowerId).order('due_date', { ascending:true }).limit(80),
    db.from('app_settings').select('setting_key,setting_value').in('setting_key', ['loan_defaults','default_funding_split']),
    db.from('loan_funding').select('loan_id,partner_user_id,funding_percent'),
    db.from('profiles').select('user_id,full_name,role')
  ]);
  for (const result of [summaryRes, calendarRes, disbRes, payRes, contactRes, followRes, settingsRes, fundingRes, profilesRes]) {
    if (result.error) throw result.error;
  }
  const settings = Object.fromEntries((settingsRes.data || []).map(row => [row.setting_key, row.setting_value]));
  const profileNames = new Map((profilesRes.data || []).map(row => [row.user_id, row.full_name || row.role || 'Socio']));
  const loanIds = new Set((disbRes.data || []).map(row => row.id));
  const fundingByLoan = new Map();
  (fundingRes.data || []).filter(row => loanIds.has(row.loan_id)).forEach(row => {
    if (!fundingByLoan.has(row.loan_id)) fundingByLoan.set(row.loan_id, []);
    fundingByLoan.get(row.loan_id).push({ ...row, partner_name:profileNames.get(row.partner_user_id) || 'Socio' });
  });
  return {
    summary:summaryRes.data,
    calendarRows:calendarRes.data || [],
    disbursements:(disbRes.data || []).map(row => ({ ...row, funding:fundingByLoan.get(row.id) || [] })),
    payments:payRes.data || [],
    contacts:contactRes.data || [],
    followups:followRes.data || [],
    defaults:settings.loan_defaults || { default_total_monthly_rate:10, default_management_rate:3 },
    funding:Array.isArray(settings.default_funding_split) ? settings.default_funding_split : []
  };
}

function dataCard(title, body, extraClass = '', action = '') {
  return `<section class="ll-card ll-profile-card ${extraClass}"><div class="ll-card-head"><div class="ll-card-title">${title}</div>${action}</div>${body}</section>`;
}

function emptyState(text) {
  return `<div class="ll-empty-state">${esc(text)}</div>`;
}

function calendarMap(data) {
  return new Map((data.calendarRows || []).map(row => [row.due_date, row]));
}

function visibleCycleDates() {
  const all = cycleDatesAround(new Date(), 12, 18);
  const baseIso = selectedDueIso || nextCycleIso();
  let baseIndex = all.findIndex(date => toIso(date) === baseIso);
  if (baseIndex < 0) baseIndex = all.findIndex(date => date >= new Date());
  let start = Math.max(0, baseIndex - 1 + calendarOffset);
  start = Math.min(start, Math.max(0, all.length - 6));
  return all.slice(start, start + 6);
}

function selectedCalendarRow(data, iso) {
  const row = calendarMap(data).get(iso);
  if (row) return row;
  return {
    due_date:iso,
    expected_total:Number(data.summary.current_cycle_fee || 0),
    paid_total:0,
    amount_due:Number(data.summary.current_cycle_fee || 0),
    principal_snapshot:Number(data.summary.principal_balance || 0),
    timing_status:daysFromToday(iso) < 0 ? 'OVERDUE' : daysFromToday(iso) === 0 ? 'DUE_TODAY' : 'UPCOMING',
    status:'DUE',
    is_virtual:true
  };
}

function nextDueRow(data) {
  const rows = [...(data.calendarRows || [])]
    .filter(row => Number(row.amount_due || 0) > 0 && !['PAID','CANCELLED'].includes(dueStatus(row)))
    .sort((a,b) => String(a.due_date).localeCompare(String(b.due_date)));
  const upcoming = rows.find(row => daysFromToday(row.due_date) >= 0);
  if (upcoming) return upcoming;
  if (rows.length) return rows[0];
  if (Number(data.summary.principal_balance || 0) <= 0) return null;
  return selectedCalendarRow(data, nextCycleIso());
}

function paymentCalendar(data, context) {
  const dates = visibleCycleDates();
  if (!selectedDueIso || !dates.some(date => toIso(date) === selectedDueIso)) {
    selectedDueIso = toIso(dates.find(date => date >= parseIso(today())) || dates[1] || dates[0]);
  }
  const selected = selectedCalendarRow(data, selectedDueIso);
  const selectedStatus = dueStatus(selected);
  const monthTitle = (() => {
    const formatter = new Intl.DateTimeFormat('es', { month:'long', year:'numeric' });
    const first = formatter.format(dates[0]);
    const last = formatter.format(dates[dates.length - 1]);
    return first === last ? first : `${first} – ${last}`;
  })();
  return `<div class="ll-cycle-calendar" data-calendar-context="${context}">
    <div class="ll-cycle-calendar-head"><div><strong>Próximas fechas de pago</strong><small>Cuotas automáticas: día 15 y último día del mes</small></div><div class="ll-cycle-calendar-nav"><button type="button" data-calendar-move="-2">‹</button><span>${esc(monthTitle)}</span><button type="button" data-calendar-move="2">›</button></div></div>
    <div class="ll-cycle-date-row">${dates.map(date => {
      const iso = toIso(date);
      const row = selectedCalendarRow(data, iso);
      const status = dueStatus(row);
      return `<button type="button" class="ll-cycle-date ${iso === selectedDueIso ? 'selected' : ''} ${tone(status)}" data-calendar-date="${iso}"><span>${date.toLocaleDateString('es',{weekday:'short'}).replace('.','')}</span><strong>${date.getDate()}</strong><small>${date.toLocaleDateString('es',{month:'short'}).replace('.','').toUpperCase()}</small></button>`;
    }).join('')}</div>
    <div class="ll-cycle-detail">
      <div><span>Cuota del ${formatDate(selectedDueIso, { day:'numeric', month:'long', year:'numeric' })}</span><small>${selected.is_virtual ? 'Fecha calculada automáticamente' : 'Evento de cuota registrado'}</small></div>
      <div><small>Monto esperado</small><strong>${money(selected.expected_total)}</strong></div>
      <div><small>Pagado</small><strong>${money(selected.paid_total)}</strong></div>
      <div><small>Pendiente</small><strong>${money(selected.amount_due)}</strong></div>
      <div><small>Estado</small><span class="ll-status-pill ${tone(selectedStatus)}">${statusLabel(selectedStatus)}</span></div>
      <div><small>Días restantes</small><strong>${dueTiming(selectedDueIso)}</strong></div>
    </div>
  </div>`;
}

function paymentRows(payments) {
  if (!payments.length) return emptyState('No hay pagos registrados para este cliente.');
  return `<div class="ll-record-list">${payments.map(payment => `<article class="ll-record-row">
    <div class="ll-record-date"><strong>${formatDate(payment.paid_on,{day:'2-digit',month:'short'})}</strong><small>${formatDate(payment.paid_on,{year:'numeric'})}</small></div>
    <div class="ll-record-main"><div class="ll-record-title">${money(payment.amount)} <span class="ll-mini-pill ${payment.is_voided ? 'll-record-danger' : ''}">${payment.is_voided ? 'ANULADO' : paymentTypeLabel(payment.payment_type)}</span></div><div class="ll-record-meta">Cuota/interés: ${money(payment.applied_interest)} · Capital: ${money(payment.applied_principal)} · Administración: ${money(payment.applied_mgmt)} · Socios: ${money(payment.applied_funders)}</div>${payment.notes ? `<div class="ll-record-note">${esc(payment.notes)}</div>` : ''}${payment.void_reason ? `<div class="ll-record-note">Motivo de anulación: ${esc(payment.void_reason)}</div>` : ''}</div>
    ${payment.is_voided ? '' : `<button type="button" class="ll-inline-action ll-danger-action" data-void-payment="${payment.id}">Anular</button>`}
  </article>`).join('')}</div>`;
}

function disbursementRows(disbursements) {
  if (!disbursements.length) return emptyState('No hay desembolsos registrados para este cliente.');
  return `<div class="ll-record-list">${disbursements.map(row => {
    const funding = row.funding?.length ? row.funding.map(item => `${esc(item.partner_name)} ${(Number(item.funding_percent || 0) * 100).toFixed(2)}%`).join(' · ') : 'Sin distribución visible';
    return `<article class="ll-record-row ll-disbursement-record">
      <div class="ll-record-date"><strong>${formatDate(row.start_date,{day:'2-digit',month:'short'})}</strong><small>${formatDate(row.start_date,{year:'numeric'})}</small></div>
      <div class="ll-record-main"><div class="ll-record-title">${money(row.principal_original)} <span class="ll-status-pill ${tone(row.status)}">${statusLabel(row.status)}</span></div><div class="ll-record-meta">Balance pendiente: ${money(row.principal_outstanding)} · Interés mensual: ${(Number(row.monthly_rate_total || 0) * 100).toFixed(2)}% · Administración: ${(Number(row.monthly_rate_mgmt || 0) * 100).toFixed(2)}%</div><div class="ll-record-note">Distribución: ${funding}</div>${row.notes ? `<div class="ll-record-note">${esc(row.notes)}</div>` : ''}</div>
    </article>`;
  }).join('')}</div>`;
}

function recentDisbursements(disbursements) {
  if (!disbursements.length) return emptyState('No hay desembolsos registrados.');
  return `<div class="ll-compact-history">${disbursements.slice(0,5).map(row => `<button type="button" data-open-tab="disbursements"><span>${formatDate(row.start_date)}</span><strong>${money(row.principal_original)}</strong></button>`).join('')}</div>`;
}

function followupRows(followups) {
  if (!followups.length) return emptyState('No hay seguimientos para este cliente.');
  return `<div class="ll-record-list">${followups.map(row => `<article class="ll-record-row"><div class="ll-record-date"><strong>${formatDate(row.due_date,{day:'2-digit',month:'short'})}</strong><small>${dueTiming(row.due_date)}</small></div><div class="ll-record-main"><div class="ll-record-title">${esc(row.reason || 'Seguimiento')} <span class="ll-status-pill ${tone(row.timing_status || row.status)}">${statusLabel(row.status === 'DONE' ? 'DONE' : row.timing_status)}</span></div><div class="ll-record-meta">Prioridad: ${esc(row.priority || 'NORMAL')}${row.loan_start_date ? ` · Desembolso: ${formatDate(row.loan_start_date)}` : ''}</div>${row.completed_notes ? `<div class="ll-record-note">${esc(row.completed_notes)}</div>` : ''}</div>${row.status === 'DONE' ? '' : `<button type="button" class="ll-inline-action" data-complete-followup="${row.id}">Completar</button>`}</article>`).join('')}</div>`;
}

function contactRows(contacts) {
  if (!contacts.length) return emptyState('No hay notas o contactos registrados para este cliente.');
  return `<div class="ll-record-list">${contacts.map(row => `<article class="ll-record-row"><div class="ll-record-date"><strong>${formatDate(row.contact_date,{day:'2-digit',month:'short'})}</strong><small>${esc(row.contact_type || 'NOTA')}</small></div><div class="ll-record-main"><div class="ll-record-title">${esc(row.outcome || 'Contacto registrado')}</div><div class="ll-record-note">${esc(row.notes || '')}</div><div class="ll-record-meta">Registrado por: ${esc(row.created_by_name || 'Usuario')}</div></div></article>`).join('')}</div>`;
}

function recentActivity(data) {
  const events = [
    ...data.payments.slice(0,5).map(row => ({ date:row.paid_on, tab:'payments', title:`Pago recibido por ${money(row.amount)}`, detail:paymentTypeLabel(row.payment_type) })),
    ...data.disbursements.slice(0,5).map(row => ({ date:row.start_date, tab:'disbursements', title:`Capital agregado: ${money(row.principal_original)}`, detail:`Balance actual ${money(row.principal_outstanding)}` })),
    ...data.contacts.slice(0,5).map(row => ({ date:row.contact_date, tab:'followups', title:row.outcome || 'Contacto registrado', detail:row.notes || row.contact_type || '' })),
    ...data.followups.slice(0,5).map(row => ({ date:row.due_date, tab:'followups', title:row.reason || 'Seguimiento', detail:statusLabel(row.status === 'DONE' ? 'DONE' : row.timing_status) }))
  ].sort((a,b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0,5);
  if (!events.length) return emptyState('Todavía no hay actividad en esta cuenta.');
  return `<div class="ll-activity-list">${events.map(event => `<button type="button" data-open-tab="${event.tab}"><span class="ll-activity-dot"></span><span><strong>${esc(event.title)}</strong><small>${formatDate(event.date)}</small>${event.detail ? `<p>${esc(event.detail)}</p>` : ''}</span><b>›</b></button>`).join('')}</div>`;
}

function loanOptions(disbursements) {
  return `<option value="">Cuenta general</option>${disbursements.map(row => `<option value="${row.id}">${formatDate(row.start_date)} · ${money(row.principal_outstanding)} · ${statusLabel(row.status)}</option>`).join('')}`;
}

function quickPaymentForm(data) {
  const suggested = Number(data.summary.current_cycle_fee || data.summary.current_monthly_fee || 0);
  const amounts = [suggested/2, suggested, suggested*2, suggested*4].filter(value => value > 0);
  return `<form id="llSummaryQuickPayForm" class="ll-summary-quick-pay"><p>Abona a la cuenta del cliente</p><div class="ll-summary-quick-amounts">${amounts.map((value,index) => `<button type="button" class="${index === 1 ? 'active' : ''}" data-summary-amount="${value.toFixed(2)}">${money(value)}</button>`).join('')}</div><input id="llSummaryPayAmount" type="number" min="0.01" step="0.01" value="${suggested ? suggested.toFixed(2) : ''}" required><button type="submit" class="ll-primary-btn">Registrar pago</button><div id="llSummaryPayStatus" class="ll-form-status">Pago rápido de cuota/interés.</div></form>`;
}

function summaryPanel(data) {
  const a = data.summary;
  const nextDue = nextDueRow(data);
  const openFollowups = data.followups.filter(row => row.status !== 'DONE');
  const nextFollowup = openFollowups[0];
  return `<section class="ll-profile-panel" data-profile-panel="summary"><div class="ll-panel-grid"><div class="ll-panel-main">
    ${dataCard('Resumen financiero', `<div class="ll-summary-stat-grid"><div><span>Balance de capital</span><strong>${money(a.principal_balance)}</strong><small>${statusLabel(a.account_status)}</small></div><div><span>Total desembolsado</span><strong>${money(a.total_disbursed)}</strong><small>${a.disbursement_count || 0} desembolsos</small></div><div><span>Cuota mensual</span><strong>${money(a.current_monthly_fee)}</strong><small>Actual</small></div><div><span>Cuota por ciclo</span><strong>${money(a.current_cycle_fee)}</strong><small>15 y fin de mes</small></div><div><span>Próxima cuota</span><strong>${formatDate(nextDue?.due_date)}</strong><small>${nextDue ? dueTiming(nextDue.due_date) : 'Sin fecha'}</small></div></div>`)}
    ${dataCard('Calendario de pagos', paymentCalendar(data,'summary'))}
    ${dataCard('Últimos desembolsos', recentDisbursements(data.disbursements), '', '<button type="button" class="ll-card-link" data-open-tab="disbursements">Ver todos</button>')}
    ${dataCard('Actividad reciente', recentActivity(data), '', '<span class="ll-card-note">Selecciona una actividad para ver su historial</span>')}
  </div><aside class="ll-panel-side">
    ${dataCard('Próxima acción', nextFollowup ? `<div class="ll-next-action"><span class="ll-status-pill ${tone(nextFollowup.timing_status)}">${statusLabel(nextFollowup.timing_status)}</span><strong>${esc(nextFollowup.reason)}</strong><p>${formatDate(nextFollowup.due_date)} · ${dueTiming(nextFollowup.due_date)}</p><button type="button" class="ll-purple-btn" data-complete-followup="${nextFollowup.id}">Marcar como completada</button></div>` : `<div class="ll-next-action"><strong>Sin seguimientos pendientes</strong><p>La cuenta no tiene acciones abiertas.</p><button type="button" class="ll-soft-btn" data-open-tab="followups">Crear seguimiento</button></div>`)}
    ${dataCard('Cuota pendiente', nextDue ? `<div class="ll-pending-due"><span>Cuota del ${formatDate(nextDue.due_date)}</span><strong>${money(nextDue.amount_due ?? nextDue.expected_total)}</strong><div><span>Estado</span><b>${statusLabel(dueStatus(nextDue))}</b></div><div><span>Fecha</span><b>${dueTiming(nextDue.due_date)}</b></div><button type="button" class="ll-card-link-button" data-open-tab="payments">Ver pagos y cuotas</button></div>` : emptyState('No hay una cuota pendiente.'))}
    ${dataCard('Pago rápido', quickPaymentForm(data))}
    ${dataCard('Estado de la cuenta', `<div class="ll-account-facts"><div><span>Estado</span><strong>${statusLabel(a.account_status)}</strong></div><div><span>Atrasado</span><strong>${money(a.overdue_amount)}</strong></div><div><span>Cuotas atrasadas</span><strong>${a.overdue_count || 0}</strong></div><div><span>Días tarde</span><strong>${a.max_days_late || 0}</strong></div></div>`)}
  </aside></div></section>`;
}

function paymentsPanel(data) {
  const suggested = Number(data.summary.current_cycle_fee || data.summary.current_monthly_fee || 0);
  return `<section class="ll-profile-panel" data-profile-panel="payments">
    ${dataCard('Calendario de pagos y cuotas', paymentCalendar(data,'payments'))}
    <div class="ll-panel-grid ll-payment-layout"><div class="ll-panel-main">${dataCard('Historial de pagos', paymentRows(data.payments))}</div><aside class="ll-panel-side">${dataCard('Registrar pago', `<form id="llProfilePaymentForm" class="ll-profile-form"><label>Monto<input id="llProfilePayAmount" type="number" min="0.01" step="0.01" value="${suggested ? suggested.toFixed(2) : ''}" required></label><label>Fecha<input id="llProfilePayDate" type="date" value="${today()}" required></label><label>Tipo de pago<select id="llProfilePayType"><option value="INSTALLMENT">Pago de cuota/interés</option><option value="PRINCIPAL">Abono directo a capital</option><option value="MIXED">Mixto: cuota y sobrante a capital</option><option value="PAYOFF">Saldar capital</option></select></label><label>Notas<input id="llProfilePayNotes" placeholder="Notas del pago"></label><div class="ll-quick-profile-amounts">${[suggested/2,suggested,suggested*2].filter(v=>v>0).map(value => `<button type="button" data-profile-amount="${value.toFixed(2)}">${money(value)}</button>`).join('')}</div><button type="submit" class="ll-primary-btn">Registrar pago</button><div id="llProfilePayStatus" class="ll-form-status">Los pagos de cuota no reducen el capital. El capital solo baja con abono, mixto o saldo.</div></form>`)}</aside></div>
  </section>`;
}

function disbursementsPanel(data) {
  const totalRate = Number(data.defaults.default_total_monthly_rate ?? 10);
  const mgmtRate = Number(data.defaults.default_management_rate ?? 3);
  const fundingHtml = data.funding.length ? data.funding.map((row,index) => `<label class="ll-funding-row"><span>${esc(row.partner_name || 'Socio')}</span><input type="number" min="0" max="100" step="0.01" value="${(Number(row.funding_percent || 0)*100).toFixed(2)}" data-funding-index="${index}" data-partner-user-id="${esc(row.partner_user_id)}"></label>`).join('') : emptyState('No hay distribución predeterminada. Configúrala antes de crear un desembolso.');
  return `<section class="ll-profile-panel" data-profile-panel="disbursements"><div class="ll-panel-grid ll-disbursement-layout"><div class="ll-panel-main">${dataCard('Historial y detalles de desembolsos', disbursementRows(data.disbursements))}</div><aside class="ll-panel-side">${dataCard('Nuevo desembolso', `<form id="llProfileDisbursementForm" class="ll-profile-form"><label>Capital desembolsado<input id="llProfilePrincipal" type="number" min="0.01" step="0.01" required></label><label>Fecha de inicio<input id="llProfileStartDate" type="date" value="${today()}" required></label><div class="ll-form-two"><label>Interés mensual total %<input id="llProfileTotalRate" type="number" min="0" step="0.01" value="${totalRate.toFixed(2)}" required></label><label>Administración %<input id="llProfileMgmtRate" type="number" min="0" step="0.01" value="${mgmtRate.toFixed(2)}" required></label></div><label>Notas<input id="llProfileDisbursementNotes" placeholder="Notas opcionales"></label><div class="ll-form-section-title">Distribución de inversión</div><div id="llProfileFundingRows">${fundingHtml}</div><div id="llProfileFundingTotal" class="ll-form-status"></div><button type="submit" class="ll-primary-btn" ${data.funding.length ? '' : 'disabled'}>Guardar desembolso</button><div id="llProfileDisbursementStatus" class="ll-form-status">El capital se agrega a la cuenta y las cuotas futuras se recalculan automáticamente.</div></form>`)}</aside></div></section>`;
}

function followupsPanel(data) {
  const options = loanOptions(data.disbursements);
  return `<section class="ll-profile-panel" data-profile-panel="followups"><div class="ll-form-card-grid">${dataCard('Agregar nota o contacto', `<form id="llProfileContactForm" class="ll-profile-form"><div class="ll-form-two"><label>Tipo<select id="llProfileContactType"><option value="NOTE">Nota</option><option value="CALL">Llamada</option><option value="TEXT">Texto</option><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">Correo</option><option value="IN_PERSON">En persona</option><option value="OTHER">Otro</option></select></label><label>Fecha<input id="llProfileContactDate" type="date" value="${today()}" required></label></div><label>Desembolso relacionado<select id="llProfileContactLoan">${options}</select></label><label>Resultado<input id="llProfileContactOutcome" placeholder="Ej.: prometió pagar el viernes"></label><label>Notas<textarea id="llProfileContactNotes" rows="4" required placeholder="Escribe la nota del contacto"></textarea></label><button type="submit" class="ll-primary-btn">Guardar nota</button><div id="llProfileContactStatus" class="ll-form-status"></div></form>`)}${dataCard('Programar seguimiento', `<form id="llProfileFollowupForm" class="ll-profile-form"><div class="ll-form-two"><label>Fecha<input id="llProfileFollowupDate" type="date" value="${today()}" required></label><label>Prioridad<select id="llProfileFollowupPriority"><option value="NORMAL">Normal</option><option value="LOW">Baja</option><option value="HIGH">Alta</option><option value="URGENT">Urgente</option></select></label></div><label>Desembolso relacionado<select id="llProfileFollowupLoan">${options}</select></label><label>Motivo<textarea id="llProfileFollowupReason" rows="4" required placeholder="Motivo o recordatorio"></textarea></label><button type="submit" class="ll-primary-btn">Crear seguimiento</button><div id="llProfileFollowupStatus" class="ll-form-status"></div></form>`)}</div><div class="ll-form-card-grid ll-followup-lists">${dataCard('Historial de seguimientos', followupRows(data.followups))}${dataCard('Historial de notas y contactos', contactRows(data.contacts))}</div></section>`;
}

function removeDuesTab(root) {
  root.querySelectorAll('.ll-tab').forEach(tab => {
    if (tab.textContent.trim() === 'Cuotas') tab.remove();
  });
}

function renderHost(root, data) {
  currentData = data;
  removeDuesTab(root);
  root.classList.add('ll-tabs-ready');
  root.querySelector('.ll-profile-tabs-host')?.remove();
  const host = document.createElement('div');
  host.className = 'll-profile-tabs-host';
  host.innerHTML = `${summaryPanel(data)}${paymentsPanel(data)}${disbursementsPanel(data)}${followupsPanel(data)}`;
  root.querySelector('.ll-tabs')?.insertAdjacentElement('afterend', host);
  wireTabs(root);
  wireActions(root, data);
  showTab(root, activeTab, false);
}

function tabKey(label) {
  return { Resumen:'summary', Pagos:'payments', Desembolsos:'disbursements', Seguimientos:'followups' }[label] || 'summary';
}

function showTab(root, key, focus = true) {
  activeTab = key === 'dues' ? 'payments' : key;
  root.querySelectorAll('.ll-tab').forEach(tab => {
    const selected = tab.dataset.profileTab === activeTab;
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
  root.querySelectorAll('[data-profile-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.profilePanel === activeTab));
  if (focus) root.querySelector(`[data-profile-panel="${activeTab}"]`)?.scrollIntoView({ behavior:'smooth', block:'start' });
}

function wireTabs(root) {
  root.querySelectorAll('.ll-tab').forEach(tab => {
    const key = tabKey(tab.textContent.trim());
    tab.dataset.profileTab = key;
    tab.setAttribute('role','tab');
    tab.setAttribute('tabindex','0');
    tab.onclick = () => showTab(root,key);
    tab.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showTab(root,key); } };
  });
}

async function refreshProfile(root) {
  if (!currentBorrowerId || !document.contains(root)) return;
  const data = await loadProfileData(currentBorrowerId);
  if (!document.contains(root)) return;
  renderHost(root,data);
}

function setStatus(id,message,error=false) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('error',error);
}

async function applyPayment({ amount, paid_on, payment_type='INSTALLMENT', notes=null, statusId, root }) {
  if (!amount || !paid_on) return setStatus(statusId,'Fecha y monto son requeridos.',true);
  setStatus(statusId,'Aplicando pago...');
  const { error } = await db.rpc('apply_borrower_payment',{ p_borrower_id:currentBorrowerId, p_paid_on:paid_on, p_amount:amount, p_payment_type:payment_type, p_notes:notes });
  if (error) return setStatus(statusId,error.message,true);
  setStatus(statusId,'Pago registrado correctamente.');
  await refreshProfile(root);
}

function wireActions(root,data) {
  root.querySelectorAll('[data-open-tab]').forEach(button => button.onclick = () => showTab(root,button.dataset.openTab));
  root.querySelectorAll('[data-calendar-move]').forEach(button => button.onclick = () => { calendarOffset += Number(button.dataset.calendarMove || 0); renderHost(root,currentData); });
  root.querySelectorAll('[data-calendar-date]').forEach(button => button.onclick = () => { selectedDueIso = button.dataset.calendarDate; renderHost(root,currentData); });
  root.querySelectorAll('[data-profile-amount]').forEach(button => button.onclick = () => { const input=document.getElementById('llProfilePayAmount'); if(input) input.value=button.dataset.profileAmount; });
  root.querySelectorAll('[data-summary-amount]').forEach(button => button.onclick = () => { root.querySelectorAll('[data-summary-amount]').forEach(item=>item.classList.remove('active')); button.classList.add('active'); const input=document.getElementById('llSummaryPayAmount'); if(input) input.value=button.dataset.summaryAmount; });

  const topButtons = [...root.querySelectorAll('.ll-action-row button')];
  const payButton = root.querySelector('#llFocusPay') || topButtons.find(button => button.textContent.includes('Registrar pago'));
  const noteButton = topButtons.find(button => button.textContent.includes('Agregar nota'));
  const whatsappButton = topButtons.find(button => button.textContent.includes('WhatsApp'));
  const disbursementButton = topButtons.find(button => button.textContent.includes('Nuevo desembolso'));
  if (payButton) payButton.onclick = () => { showTab(root,'payments'); setTimeout(()=>document.getElementById('llProfilePayAmount')?.focus(),80); };
  if (noteButton) noteButton.onclick = () => { showTab(root,'followups'); setTimeout(()=>document.getElementById('llProfileContactNotes')?.focus(),80); };
  if (disbursementButton) disbursementButton.onclick = () => { showTab(root,'disbursements'); setTimeout(()=>document.getElementById('llProfilePrincipal')?.focus(),80); };
  if (whatsappButton) whatsappButton.onclick = () => { const phone=String(data.summary.phone||'').replace(/\D/g,''); if(!phone)return alert('Este cliente no tiene un teléfono registrado.'); window.open(`https://wa.me/${phone}`,'_blank','noopener,noreferrer'); };

  document.getElementById('llSummaryQuickPayForm')?.addEventListener('submit',event=>{ event.preventDefault(); applyPayment({ amount:Number(document.getElementById('llSummaryPayAmount')?.value||0), paid_on:today(), payment_type:'INSTALLMENT', notes:'Pago rápido desde el resumen', statusId:'llSummaryPayStatus', root }); });
  document.getElementById('llProfilePaymentForm')?.addEventListener('submit',event=>{ event.preventDefault(); applyPayment({ amount:Number(document.getElementById('llProfilePayAmount')?.value||0), paid_on:document.getElementById('llProfilePayDate')?.value, payment_type:document.getElementById('llProfilePayType')?.value||'INSTALLMENT', notes:document.getElementById('llProfilePayNotes')?.value.trim()||null, statusId:'llProfilePayStatus', root }); });

  document.getElementById('llProfileContactForm')?.addEventListener('submit',async event=>{ event.preventDefault(); const contact_date=document.getElementById('llProfileContactDate')?.value; const contact_type=document.getElementById('llProfileContactType')?.value||'NOTE'; const loan_id=document.getElementById('llProfileContactLoan')?.value||null; const outcome=document.getElementById('llProfileContactOutcome')?.value.trim()||null; const notes=document.getElementById('llProfileContactNotes')?.value.trim(); if(!contact_date||!notes)return setStatus('llProfileContactStatus','Fecha y notas son requeridas.',true); setStatus('llProfileContactStatus','Guardando nota...'); const created_by=await currentUserId(); const {error}=await db.from('borrower_contact_log').insert({borrower_id:currentBorrowerId,loan_id,contact_date,contact_type,outcome,notes,created_by}); if(error)return setStatus('llProfileContactStatus',error.message,true); activeTab='followups'; await refreshProfile(root); });
  document.getElementById('llProfileFollowupForm')?.addEventListener('submit',async event=>{ event.preventDefault(); const due_date=document.getElementById('llProfileFollowupDate')?.value; const priority=document.getElementById('llProfileFollowupPriority')?.value||'NORMAL'; const loan_id=document.getElementById('llProfileFollowupLoan')?.value||null; const reason=document.getElementById('llProfileFollowupReason')?.value.trim(); if(!due_date||!reason)return setStatus('llProfileFollowupStatus','Fecha y motivo son requeridos.',true); setStatus('llProfileFollowupStatus','Creando seguimiento...'); const created_by=await currentUserId(); const {error}=await db.from('borrower_followups').insert({borrower_id:currentBorrowerId,loan_id,due_date,priority,reason,created_by}); if(error)return setStatus('llProfileFollowupStatus',error.message,true); activeTab='followups'; await refreshProfile(root); });

  root.querySelectorAll('[data-complete-followup]').forEach(button=>button.onclick=async()=>{ const note=prompt('Nota de finalización (opcional):',''); if(note===null)return; const {error}=await db.rpc('complete_followup',{p_followup_id:button.dataset.completeFollowup,p_completed_notes:note.trim()||null}); if(error)return alert(error.message); await refreshProfile(root); });
  root.querySelectorAll('[data-void-payment]').forEach(button=>button.onclick=async()=>{ const reason=prompt('Motivo de anulación (opcional):',''); if(reason===null)return; if(!confirm('¿Seguro que quieres anular este pago? Se revertirán las aplicaciones de cuota, capital y distribuciones.'))return; const {error}=await db.rpc('void_payment',{p_payment_id:button.dataset.voidPayment,p_reason:reason.trim()||null}); if(error)return alert(error.message); activeTab='payments'; await refreshProfile(root); });

  const fundingInputs=[...root.querySelectorAll('[data-partner-user-id]')];
  const updateFundingTotal=()=>{ const total=fundingInputs.reduce((sum,input)=>sum+Number(input.value||0),0); setStatus('llProfileFundingTotal',`Total: ${total.toFixed(2)}%${Math.abs(total-100)>0.01?' · Debe sumar 100%.':''}`,Math.abs(total-100)>0.01); };
  fundingInputs.forEach(input=>input.addEventListener('input',updateFundingTotal)); updateFundingTotal();
  document.getElementById('llProfileDisbursementForm')?.addEventListener('submit',async event=>{ event.preventDefault(); const principal=Number(document.getElementById('llProfilePrincipal')?.value||0); const start_date=document.getElementById('llProfileStartDate')?.value; const monthly_rate_total=Number(document.getElementById('llProfileTotalRate')?.value||0)/100; const monthly_rate_mgmt=Number(document.getElementById('llProfileMgmtRate')?.value||0)/100; const notes=document.getElementById('llProfileDisbursementNotes')?.value.trim()||null; const funding=fundingInputs.map(input=>({partner_user_id:input.dataset.partnerUserId,funding_percent:Number(input.value||0)/100})).filter(row=>row.partner_user_id&&row.funding_percent>0); const fundingTotal=funding.reduce((sum,row)=>sum+row.funding_percent,0); if(!principal||!start_date)return setStatus('llProfileDisbursementStatus','Fecha y capital son requeridos.',true); if(monthly_rate_mgmt>monthly_rate_total)return setStatus('llProfileDisbursementStatus','La administración no puede superar el interés total.',true); if(!funding.length||Math.abs(fundingTotal-1)>0.001)return setStatus('llProfileDisbursementStatus','La distribución debe sumar 100%.',true); setStatus('llProfileDisbursementStatus','Guardando desembolso...'); const created_by=await currentUserId(); const {data:loan,error:loanError}=await db.from('loans').insert({borrower_id:currentBorrowerId,created_by,start_date,principal_original:principal,principal_outstanding:principal,monthly_rate_total,monthly_rate_mgmt,notes,status:'ACTIVE'}).select('id').single(); if(loanError)return setStatus('llProfileDisbursementStatus',loanError.message,true); const {error:fundingError}=await db.from('loan_funding').insert(funding.map(row=>({loan_id:loan.id,partner_user_id:row.partner_user_id,funding_percent:row.funding_percent}))); if(fundingError)return setStatus('llProfileDisbursementStatus',fundingError.message,true); activeTab='disbursements'; await refreshProfile(root); });
}

async function enhanceProfile(borrowerId) {
  currentBorrowerId = borrowerId || currentBorrowerId;
  if (!currentBorrowerId) return;
  const root = document.querySelector('#borrowerAccountContent .ll-account-shell');
  if (!root || root.dataset.functionalTabs === 'loading') return;
  const sequence = ++renderSequence;
  root.dataset.functionalTabs = 'loading';
  try {
    calendarOffset = 0;
    selectedDueIso = null;
    const data = await loadProfileData(currentBorrowerId);
    if (sequence !== renderSequence || !document.contains(root)) return;
    renderHost(root,data);
    root.dataset.functionalTabs = 'ready';
  } catch (error) {
    console.error(error);
    root.dataset.functionalTabs = 'error';
    root.querySelector('.ll-tabs')?.insertAdjacentHTML('afterend',`<div class="ll-card ll-tabs-error">No se pudieron cargar las pestañas: ${esc(error.message||error)}</div>`);
  }
}

function scheduleEnhance(borrowerId) {
  if (borrowerId) currentBorrowerId = borrowerId;
  setTimeout(()=>enhanceProfile(currentBorrowerId),180);
}

window.addEventListener('loan-ledger:account-rendered',event=>scheduleEnhance(event.detail?.borrowerId));
window.addEventListener('loan-ledger:open-account',event=>scheduleEnhance(event.detail?.borrowerId));
document.addEventListener('click',event=>{ const card=event.target.closest?.('[data-acct-borrower]'); if(card?.dataset.acctBorrower)scheduleEnhance(card.dataset.acctBorrower); },true);
const content=document.getElementById('borrowerAccountContent');
if(content)new MutationObserver(()=>{ const root=content.querySelector('.ll-account-shell'); if(root&&root.dataset.functionalTabs!=='ready'&&currentBorrowerId)scheduleEnhance(currentBorrowerId); }).observe(content,{childList:true,subtree:true});

console.log('functional client profile tabs active');
