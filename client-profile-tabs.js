import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(
  'https://eatxkhhpjruwwibhcubf.supabase.co',
  'sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage, storageKey: 'loan-ledger-auth' } }
);

const money = value => `$${Number(value || 0).toFixed(2)}`;
const today = () => new Date().toISOString().slice(0, 10);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
let currentBorrowerId = null;
let activeTab = 'summary';
let renderSequence = 0;

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

function daysFromToday(iso) {
  if (!iso) return null;
  const start = new Date(`${today()}T00:00:00`);
  const end = new Date(`${iso}T00:00:00`);
  return Math.round((end - start) / 86400000);
}

function dueTiming(iso) {
  const days = daysFromToday(iso);
  if (days === null) return 'Sin fecha';
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
  if (row?.status === 'CANCELLED') return 'CANCELLED';
  return row?.status || row?.timing_status || 'UPCOMING';
}

async function currentUserId() {
  const { data, error } = await db.auth.getUser();
  if (error) throw error;
  if (!data.user?.id) throw new Error('No se encontró una sesión activa.');
  return data.user.id;
}

async function loadProfileData(borrowerId) {
  const [summaryRes, dueRes, disbRes, payRes, contactRes, followRes, settingsRes] = await Promise.all([
    db.from('borrower_account_summary').select('*').eq('borrower_id', borrowerId).single(),
    db.from('borrower_due_events_view').select('*').eq('borrower_id', borrowerId).order('due_date', { ascending:false }).limit(120),
    db.from('borrower_disbursements_view').select('*').eq('borrower_id', borrowerId).order('start_date', { ascending:false }),
    db.from('borrower_account_payments_view').select('*').eq('borrower_id', borrowerId).order('paid_on', { ascending:false }).order('created_at', { ascending:false }).limit(120),
    db.from('borrower_contact_log_view').select('*').eq('borrower_id', borrowerId).order('created_at', { ascending:false }).limit(80),
    db.from('borrower_followups_view').select('*').eq('borrower_id', borrowerId).order('due_date', { ascending:true }).limit(80),
    db.from('app_settings').select('setting_key,setting_value').in('setting_key', ['loan_defaults','default_funding_split'])
  ]);
  for (const result of [summaryRes, dueRes, disbRes, payRes, contactRes, followRes, settingsRes]) {
    if (result.error) throw result.error;
  }
  const settings = Object.fromEntries((settingsRes.data || []).map(row => [row.setting_key, row.setting_value]));
  return {
    summary: summaryRes.data,
    dues: dueRes.data || [],
    disbursements: disbRes.data || [],
    payments: payRes.data || [],
    contacts: contactRes.data || [],
    followups: followRes.data || [],
    defaults: settings.loan_defaults || { default_total_monthly_rate:10, default_management_rate:3 },
    funding: Array.isArray(settings.default_funding_split) ? settings.default_funding_split : []
  };
}

function dataCard(title, body, extraClass = '') {
  return `<section class="ll-card ll-profile-card ${extraClass}"><div class="ll-card-title">${title}</div>${body}</section>`;
}

function emptyState(text) {
  return `<div class="ll-empty-state">${esc(text)}</div>`;
}

function paymentRows(payments) {
  if (!payments.length) return emptyState('No hay pagos registrados para este cliente.');
  return `<div class="ll-record-list">${payments.map(payment => `
    <article class="ll-record-row">
      <div class="ll-record-date"><strong>${formatDate(payment.paid_on, { day:'2-digit', month:'short' })}</strong><small>${formatDate(payment.paid_on, { year:'numeric' })}</small></div>
      <div class="ll-record-main">
        <div class="ll-record-title">${money(payment.amount)} <span class="ll-mini-pill ${payment.is_voided ? 'll-record-danger' : ''}">${payment.is_voided ? 'ANULADO' : paymentTypeLabel(payment.payment_type)}</span></div>
        <div class="ll-record-meta">Cuota/interés: ${money(payment.applied_interest)} · Capital: ${money(payment.applied_principal)} · Administración: ${money(payment.applied_mgmt)} · Socios: ${money(payment.applied_funders)}</div>
        ${payment.notes ? `<div class="ll-record-note">${esc(payment.notes)}</div>` : ''}
        ${payment.void_reason ? `<div class="ll-record-note">Motivo de anulación: ${esc(payment.void_reason)}</div>` : ''}
      </div>
      ${payment.is_voided ? '' : `<button type="button" class="ll-inline-action ll-danger-action" data-void-payment="${payment.id}">Anular</button>`}
    </article>`).join('')}</div>`;
}

function disbursementRows(disbursements) {
  if (!disbursements.length) return emptyState('No hay desembolsos registrados para este cliente.');
  return `<div class="ll-record-list">${disbursements.map(row => `
    <article class="ll-record-row">
      <div class="ll-record-date"><strong>${formatDate(row.start_date, { day:'2-digit', month:'short' })}</strong><small>${formatDate(row.start_date, { year:'numeric' })}</small></div>
      <div class="ll-record-main">
        <div class="ll-record-title">${money(row.principal_original)} <span class="ll-status-pill ${tone(row.status)}">${statusLabel(row.status)}</span></div>
        <div class="ll-record-meta">Balance pendiente: ${money(row.principal_outstanding)} · Interés mensual: ${(Number(row.monthly_rate_total || 0) * 100).toFixed(2)}% · Administración: ${(Number(row.monthly_rate_mgmt || 0) * 100).toFixed(2)}%</div>
        ${row.notes ? `<div class="ll-record-note">${esc(row.notes)}</div>` : ''}
      </div>
    </article>`).join('')}</div>`;
}

function dueRows(dues) {
  if (!dues.length) return emptyState('Todavía no hay eventos de cuota generados para este cliente.');
  return `<div class="ll-due-table">
    <div class="ll-due-table-head"><span>Fecha</span><span>Esperado</span><span>Pagado</span><span>Pendiente</span><span>Estado</span></div>
    ${dues.map(row => {
      const status = dueStatus(row);
      return `<article class="ll-due-table-row">
        <div><strong>${formatDate(row.due_date)}</strong><small>${dueTiming(row.due_date)}</small></div>
        <div>${money(row.expected_total)}</div>
        <div>${money(row.paid_total)}</div>
        <div><strong>${money(row.amount_due)}</strong></div>
        <div><span class="ll-status-pill ${tone(status)}">${statusLabel(status)}</span></div>
      </article>`;
    }).join('')}
  </div>`;
}

function followupRows(followups) {
  if (!followups.length) return emptyState('No hay seguimientos para este cliente.');
  return `<div class="ll-record-list">${followups.map(row => `
    <article class="ll-record-row">
      <div class="ll-record-date"><strong>${formatDate(row.due_date, { day:'2-digit', month:'short' })}</strong><small>${dueTiming(row.due_date)}</small></div>
      <div class="ll-record-main">
        <div class="ll-record-title">${esc(row.reason || 'Seguimiento')} <span class="ll-status-pill ${tone(row.timing_status || row.status)}">${statusLabel(row.status === 'DONE' ? 'DONE' : row.timing_status)}</span></div>
        <div class="ll-record-meta">Prioridad: ${esc(row.priority || 'NORMAL')}${row.loan_start_date ? ` · Desembolso: ${formatDate(row.loan_start_date)}` : ''}</div>
        ${row.completed_notes ? `<div class="ll-record-note">${esc(row.completed_notes)}</div>` : ''}
      </div>
      ${row.status === 'DONE' ? '' : `<button type="button" class="ll-inline-action" data-complete-followup="${row.id}">Completar</button>`}
    </article>`).join('')}</div>`;
}

function contactRows(contacts) {
  if (!contacts.length) return emptyState('No hay notas o contactos registrados para este cliente.');
  return `<div class="ll-record-list">${contacts.map(row => `
    <article class="ll-record-row">
      <div class="ll-record-date"><strong>${formatDate(row.contact_date, { day:'2-digit', month:'short' })}</strong><small>${esc(row.contact_type || 'NOTA')}</small></div>
      <div class="ll-record-main">
        <div class="ll-record-title">${esc(row.outcome || 'Contacto registrado')}</div>
        <div class="ll-record-note">${esc(row.notes || '')}</div>
        <div class="ll-record-meta">Registrado por: ${esc(row.created_by_name || 'Usuario')}</div>
      </div>
    </article>`).join('')}</div>`;
}

function activityRows(data) {
  const events = [
    ...data.payments.slice(0, 5).map(row => ({ date:row.paid_on, type:'Pago', title:`Pago recibido por ${money(row.amount)}`, detail:paymentTypeLabel(row.payment_type) })),
    ...data.disbursements.slice(0, 4).map(row => ({ date:row.start_date, type:'Desembolso', title:`Capital agregado: ${money(row.principal_original)}`, detail:`Balance actual ${money(row.principal_outstanding)}` })),
    ...data.contacts.slice(0, 4).map(row => ({ date:row.contact_date, type:row.contact_type || 'Nota', title:row.outcome || 'Contacto registrado', detail:row.notes || '' })),
    ...data.followups.slice(0, 4).map(row => ({ date:row.due_date, type:'Seguimiento', title:row.reason || 'Seguimiento', detail:statusLabel(row.status === 'DONE' ? 'DONE' : row.timing_status) }))
  ].sort((a,b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 8);
  if (!events.length) return emptyState('Todavía no hay actividad en esta cuenta.');
  return `<div class="ll-activity-list">${events.map(event => `<article><span class="ll-activity-dot"></span><div><strong>${esc(event.title)}</strong><small>${esc(event.type)} · ${formatDate(event.date)}</small>${event.detail ? `<p>${esc(event.detail)}</p>` : ''}</div></article>`).join('')}</div>`;
}

function loanOptions(disbursements) {
  return `<option value="">Cuenta general</option>${disbursements.map(row => `<option value="${row.id}">${formatDate(row.start_date)} · ${money(row.principal_outstanding)} · ${statusLabel(row.status)}</option>`).join('')}`;
}

function summaryPanel(data) {
  const a = data.summary;
  const openFollowups = data.followups.filter(row => row.status !== 'DONE');
  const nextFollowup = openFollowups[0];
  const upcomingDues = [...data.dues].filter(row => !['PAID','CANCELLED'].includes(dueStatus(row))).sort((a,b) => String(a.due_date).localeCompare(String(b.due_date)));
  const nextDue = upcomingDues[0];
  return `<section class="ll-profile-panel" data-profile-panel="summary">
    <div class="ll-panel-grid">
      <div class="ll-panel-main">
        ${dataCard('Resumen financiero', `<div class="ll-summary-stat-grid">
          <div><span>Balance de capital</span><strong>${money(a.principal_balance)}</strong><small>${statusLabel(a.account_status)}</small></div>
          <div><span>Total desembolsado</span><strong>${money(a.total_disbursed)}</strong><small>${a.disbursement_count || 0} desembolsos</small></div>
          <div><span>Cuota mensual</span><strong>${money(a.current_monthly_fee)}</strong><small>${money(a.current_cycle_fee)} por ciclo</small></div>
          <div><span>Total pagado</span><strong>${money(a.total_paid)}</strong><small>${money(a.total_principal_paid)} a capital</small></div>
          <div><span>Próxima cuota</span><strong>${formatDate(nextDue?.due_date || a.next_due_date)}</strong><small>${dueTiming(nextDue?.due_date || a.next_due_date)}</small></div>
        </div>`)}
        ${dataCard('Próximas cuotas', upcomingDues.length ? `<div class="ll-summary-due-list">${upcomingDues.slice(0,4).map(row => `<button type="button" data-open-tab="dues"><span><strong>${formatDate(row.due_date)}</strong><small>${dueTiming(row.due_date)}</small></span><span>${money(row.amount_due)}<small>${statusLabel(dueStatus(row))}</small></span></button>`).join('')}</div>` : emptyState('No hay cuotas pendientes.'))}
        ${dataCard('Actividad reciente', activityRows(data))}
      </div>
      <aside class="ll-panel-side">
        ${dataCard('Próxima acción', nextFollowup ? `<div class="ll-next-action"><span class="ll-status-pill ${tone(nextFollowup.timing_status)}">${statusLabel(nextFollowup.timing_status)}</span><strong>${esc(nextFollowup.reason)}</strong><p>${formatDate(nextFollowup.due_date)} · ${dueTiming(nextFollowup.due_date)}</p><button type="button" class="ll-purple-btn" data-complete-followup="${nextFollowup.id}">Marcar como completada</button></div>` : `<div class="ll-next-action"><strong>Sin seguimientos pendientes</strong><p>La cuenta no tiene acciones abiertas.</p><button type="button" class="ll-soft-btn" data-open-tab="followups">Crear seguimiento</button></div>`)}
        ${dataCard('Estado de la cuenta', `<div class="ll-account-facts">
          <div><span>Estado</span><strong>${statusLabel(a.account_status)}</strong></div>
          <div><span>Atrasado</span><strong>${money(a.overdue_amount)}</strong></div>
          <div><span>Cuotas atrasadas</span><strong>${a.overdue_count || 0}</strong></div>
          <div><span>Días tarde</span><strong>${a.max_days_late || 0}</strong></div>
        </div>`)}
      </aside>
    </div>
  </section>`;
}

function duesPanel(data) {
  const dues = [...data.dues].sort((a,b) => String(b.due_date).localeCompare(String(a.due_date)));
  const pending = dues.filter(row => !['PAID','CANCELLED'].includes(dueStatus(row)));
  const overdue = pending.filter(row => dueStatus(row) === 'OVERDUE');
  const dueTotal = pending.reduce((sum,row) => sum + Number(row.amount_due || 0), 0);
  const paidTotal = dues.reduce((sum,row) => sum + Number(row.paid_total || 0), 0);
  return `<section class="ll-profile-panel" data-profile-panel="dues">
    ${dataCard('Cuotas de la cuenta', `<div class="ll-tab-stat-row"><div><span>Pendientes</span><strong>${pending.length}</strong></div><div><span>Atrasadas</span><strong>${overdue.length}</strong></div><div><span>Saldo pendiente</span><strong>${money(dueTotal)}</strong></div><div><span>Pagado en cuotas</span><strong>${money(paidTotal)}</strong></div></div>`)}
    ${dataCard('Calendario e historial de cuotas', dueRows(dues))}
  </section>`;
}

function paymentsPanel(data) {
  const suggested = Number(data.summary.current_cycle_fee || data.summary.current_monthly_fee || 0);
  return `<section class="ll-profile-panel" data-profile-panel="payments">
    <div class="ll-panel-grid ll-payment-layout">
      <div class="ll-panel-main">${dataCard('Historial de pagos', paymentRows(data.payments))}</div>
      <aside class="ll-panel-side">
        ${dataCard('Registrar pago', `<form id="llProfilePaymentForm" class="ll-profile-form">
          <label>Monto<input id="llProfilePayAmount" type="number" min="0.01" step="0.01" value="${suggested ? suggested.toFixed(2) : ''}" required></label>
          <label>Fecha<input id="llProfilePayDate" type="date" value="${today()}" required></label>
          <label>Tipo de pago<select id="llProfilePayType"><option value="INSTALLMENT">Pago de cuota/interés</option><option value="PRINCIPAL">Abono directo a capital</option><option value="MIXED">Mixto: cuota y sobrante a capital</option><option value="PAYOFF">Saldar capital</option></select></label>
          <label>Notas<input id="llProfilePayNotes" placeholder="Notas del pago"></label>
          <div class="ll-quick-profile-amounts">${[suggested/2,suggested,suggested*2].filter(v=>v>0).map(value => `<button type="button" data-profile-amount="${value.toFixed(2)}">${money(value)}</button>`).join('')}</div>
          <button type="submit" class="ll-primary-btn">Registrar pago</button>
          <div id="llProfilePayStatus" class="ll-form-status">Los pagos de cuota no reducen el capital.</div>
        </form>`)}
      </aside>
    </div>
  </section>`;
}

function disbursementsPanel(data) {
  const totalRate = Number(data.defaults.default_total_monthly_rate ?? 10);
  const mgmtRate = Number(data.defaults.default_management_rate ?? 3);
  const fundingHtml = data.funding.length ? data.funding.map((row,index) => `<label class="ll-funding-row"><span>${esc(row.partner_name || 'Socio')}</span><input type="number" min="0" max="100" step="0.01" value="${(Number(row.funding_percent || 0)*100).toFixed(2)}" data-funding-index="${index}" data-partner-user-id="${esc(row.partner_user_id)}"></label>`).join('') : emptyState('No hay distribución predeterminada. Configúrala antes de crear un desembolso.');
  return `<section class="ll-profile-panel" data-profile-panel="disbursements">
    <div class="ll-panel-grid ll-disbursement-layout">
      <div class="ll-panel-main">${dataCard('Historial de desembolsos', disbursementRows(data.disbursements))}</div>
      <aside class="ll-panel-side">
        ${dataCard('Nuevo desembolso', `<form id="llProfileDisbursementForm" class="ll-profile-form">
          <label>Capital desembolsado<input id="llProfilePrincipal" type="number" min="0.01" step="0.01" required></label>
          <label>Fecha de inicio<input id="llProfileStartDate" type="date" value="${today()}" required></label>
          <div class="ll-form-two"><label>Interés mensual total %<input id="llProfileTotalRate" type="number" min="0" step="0.01" value="${totalRate.toFixed(2)}" required></label><label>Administración %<input id="llProfileMgmtRate" type="number" min="0" step="0.01" value="${mgmtRate.toFixed(2)}" required></label></div>
          <label>Notas<input id="llProfileDisbursementNotes" placeholder="Notas opcionales"></label>
          <div class="ll-form-section-title">Distribución de inversión</div>
          <div id="llProfileFundingRows">${fundingHtml}</div>
          <div id="llProfileFundingTotal" class="ll-form-status"></div>
          <button type="submit" class="ll-primary-btn" ${data.funding.length ? '' : 'disabled'}>Guardar desembolso</button>
          <div id="llProfileDisbursementStatus" class="ll-form-status">Las cuotas futuras se calcularán automáticamente.</div>
        </form>`)}
      </aside>
    </div>
  </section>`;
}

function followupsPanel(data) {
  const options = loanOptions(data.disbursements);
  return `<section class="ll-profile-panel" data-profile-panel="followups">
    <div class="ll-form-card-grid">
      ${dataCard('Agregar nota o contacto', `<form id="llProfileContactForm" class="ll-profile-form">
        <div class="ll-form-two"><label>Tipo<select id="llProfileContactType"><option value="NOTE">Nota</option><option value="CALL">Llamada</option><option value="TEXT">Texto</option><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">Correo</option><option value="IN_PERSON">En persona</option><option value="OTHER">Otro</option></select></label><label>Fecha<input id="llProfileContactDate" type="date" value="${today()}" required></label></div>
        <label>Desembolso relacionado<select id="llProfileContactLoan">${options}</select></label>
        <label>Resultado<input id="llProfileContactOutcome" placeholder="Ej.: prometió pagar el viernes"></label>
        <label>Notas<textarea id="llProfileContactNotes" rows="4" required placeholder="Escribe la nota del contacto"></textarea></label>
        <button type="submit" class="ll-primary-btn">Guardar nota</button><div id="llProfileContactStatus" class="ll-form-status"></div>
      </form>`)}
      ${dataCard('Programar seguimiento', `<form id="llProfileFollowupForm" class="ll-profile-form">
        <div class="ll-form-two"><label>Fecha<input id="llProfileFollowupDate" type="date" value="${today()}" required></label><label>Prioridad<select id="llProfileFollowupPriority"><option value="NORMAL">Normal</option><option value="LOW">Baja</option><option value="HIGH">Alta</option><option value="URGENT">Urgente</option></select></label></div>
        <label>Desembolso relacionado<select id="llProfileFollowupLoan">${options}</select></label>
        <label>Motivo<textarea id="llProfileFollowupReason" rows="4" required placeholder="Motivo o recordatorio"></textarea></label>
        <button type="submit" class="ll-primary-btn">Crear seguimiento</button><div id="llProfileFollowupStatus" class="ll-form-status"></div>
      </form>`)}
    </div>
    <div class="ll-form-card-grid ll-followup-lists">
      ${dataCard('Seguimientos', followupRows(data.followups))}
      ${dataCard('Notas y contactos', contactRows(data.contacts))}
    </div>
  </section>`;
}

function renderHost(root, data) {
  root.classList.add('ll-tabs-ready');
  root.querySelector('.ll-profile-tabs-host')?.remove();
  const host = document.createElement('div');
  host.className = 'll-profile-tabs-host';
  host.innerHTML = `${summaryPanel(data)}${duesPanel(data)}${paymentsPanel(data)}${disbursementsPanel(data)}${followupsPanel(data)}`;
  root.querySelector('.ll-tabs')?.insertAdjacentElement('afterend', host);
  wireTabs(root);
  wireActions(root, data);
  showTab(root, activeTab, false);
}

function tabKey(label) {
  return { Resumen:'summary', Cuotas:'dues', Pagos:'payments', Desembolsos:'disbursements', Seguimientos:'followups' }[label] || 'summary';
}

function showTab(root, key, focus = true) {
  activeTab = key;
  root.querySelectorAll('.ll-tab').forEach(tab => {
    const selected = tab.dataset.profileTab === key;
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
  root.querySelectorAll('[data-profile-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.profilePanel === key));
  if (focus) root.querySelector(`[data-profile-panel="${key}"]`)?.scrollIntoView({ behavior:'smooth', block:'start' });
}

function wireTabs(root) {
  root.querySelectorAll('.ll-tab').forEach(tab => {
    const key = tabKey(tab.textContent.trim());
    tab.dataset.profileTab = key;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('tabindex', '0');
    tab.onclick = () => showTab(root, key);
    tab.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showTab(root, key); } };
  });
}

async function refreshProfile(root) {
  if (!currentBorrowerId || !document.contains(root)) return;
  const data = await loadProfileData(currentBorrowerId);
  if (!document.contains(root)) return;
  renderHost(root, data);
}

function setStatus(id, message, error = false) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('error', error);
}

function wireActions(root, data) {
  root.querySelectorAll('[data-open-tab]').forEach(button => button.onclick = () => showTab(root, button.dataset.openTab));
  root.querySelectorAll('[data-profile-amount]').forEach(button => button.onclick = () => {
    const input = document.getElementById('llProfilePayAmount');
    if (input) input.value = button.dataset.profileAmount;
  });

  const topButtons = [...root.querySelectorAll('.ll-action-row button')];
  const payButton = root.querySelector('#llFocusPay') || topButtons.find(button => button.textContent.includes('Registrar pago'));
  const noteButton = topButtons.find(button => button.textContent.includes('Agregar nota'));
  const whatsappButton = topButtons.find(button => button.textContent.includes('WhatsApp'));
  const disbursementButton = topButtons.find(button => button.textContent.includes('Nuevo desembolso'));
  if (payButton) payButton.onclick = () => { showTab(root, 'payments'); setTimeout(() => document.getElementById('llProfilePayAmount')?.focus(), 80); };
  if (noteButton) noteButton.onclick = () => { showTab(root, 'followups'); setTimeout(() => document.getElementById('llProfileContactNotes')?.focus(), 80); };
  if (disbursementButton) disbursementButton.onclick = () => { showTab(root, 'disbursements'); setTimeout(() => document.getElementById('llProfilePrincipal')?.focus(), 80); };
  if (whatsappButton) whatsappButton.onclick = () => {
    const phone = String(data.summary.phone || '').replace(/\D/g, '');
    if (!phone) return alert('Este cliente no tiene un teléfono registrado.');
    window.open(`https://wa.me/${phone}`, '_blank', 'noopener,noreferrer');
  };

  document.getElementById('llProfilePaymentForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const amount = Number(document.getElementById('llProfilePayAmount')?.value || 0);
    const paid_on = document.getElementById('llProfilePayDate')?.value;
    const payment_type = document.getElementById('llProfilePayType')?.value || 'INSTALLMENT';
    const notes = document.getElementById('llProfilePayNotes')?.value.trim() || null;
    if (!amount || !paid_on) return setStatus('llProfilePayStatus', 'Fecha y monto son requeridos.', true);
    setStatus('llProfilePayStatus', 'Aplicando pago...');
    const { error } = await db.rpc('apply_borrower_payment', { p_borrower_id:currentBorrowerId, p_paid_on:paid_on, p_amount:amount, p_payment_type:payment_type, p_notes:notes });
    if (error) return setStatus('llProfilePayStatus', error.message, true);
    setStatus('llProfilePayStatus', 'Pago registrado correctamente.');
    await refreshProfile(root);
  });

  document.getElementById('llProfileContactForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const contact_date = document.getElementById('llProfileContactDate')?.value;
    const contact_type = document.getElementById('llProfileContactType')?.value || 'NOTE';
    const loan_id = document.getElementById('llProfileContactLoan')?.value || null;
    const outcome = document.getElementById('llProfileContactOutcome')?.value.trim() || null;
    const notes = document.getElementById('llProfileContactNotes')?.value.trim();
    if (!contact_date || !notes) return setStatus('llProfileContactStatus', 'Fecha y notas son requeridas.', true);
    setStatus('llProfileContactStatus', 'Guardando nota...');
    const created_by = await currentUserId();
    const { error } = await db.from('borrower_contact_log').insert({ borrower_id:currentBorrowerId, loan_id, contact_date, contact_type, outcome, notes, created_by });
    if (error) return setStatus('llProfileContactStatus', error.message, true);
    setStatus('llProfileContactStatus', 'Nota guardada.');
    activeTab = 'followups';
    await refreshProfile(root);
  });

  document.getElementById('llProfileFollowupForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const due_date = document.getElementById('llProfileFollowupDate')?.value;
    const priority = document.getElementById('llProfileFollowupPriority')?.value || 'NORMAL';
    const loan_id = document.getElementById('llProfileFollowupLoan')?.value || null;
    const reason = document.getElementById('llProfileFollowupReason')?.value.trim();
    if (!due_date || !reason) return setStatus('llProfileFollowupStatus', 'Fecha y motivo son requeridos.', true);
    setStatus('llProfileFollowupStatus', 'Creando seguimiento...');
    const created_by = await currentUserId();
    const { error } = await db.from('borrower_followups').insert({ borrower_id:currentBorrowerId, loan_id, due_date, priority, reason, created_by });
    if (error) return setStatus('llProfileFollowupStatus', error.message, true);
    setStatus('llProfileFollowupStatus', 'Seguimiento creado.');
    activeTab = 'followups';
    await refreshProfile(root);
  });

  root.querySelectorAll('[data-complete-followup]').forEach(button => button.onclick = async () => {
    const note = prompt('Nota de finalización (opcional):', '');
    if (note === null) return;
    const { error } = await db.rpc('complete_followup', { p_followup_id:button.dataset.completeFollowup, p_completed_notes:note.trim() || null });
    if (error) return alert(error.message);
    await refreshProfile(root);
  });

  root.querySelectorAll('[data-void-payment]').forEach(button => button.onclick = async () => {
    const reason = prompt('Motivo de anulación (opcional):', '');
    if (reason === null) return;
    if (!confirm('¿Seguro que quieres anular este pago? Se revertirán las aplicaciones de cuota, capital y distribuciones.')) return;
    const { error } = await db.rpc('void_payment', { p_payment_id:button.dataset.voidPayment, p_reason:reason.trim() || null });
    if (error) return alert(error.message);
    activeTab = 'payments';
    await refreshProfile(root);
  });

  const fundingInputs = [...root.querySelectorAll('[data-partner-user-id]')];
  const updateFundingTotal = () => {
    const total = fundingInputs.reduce((sum,input) => sum + Number(input.value || 0), 0);
    setStatus('llProfileFundingTotal', `Total: ${total.toFixed(2)}%${Math.abs(total - 100) > 0.01 ? ' · Debe sumar 100%.' : ''}`, Math.abs(total - 100) > 0.01);
  };
  fundingInputs.forEach(input => input.addEventListener('input', updateFundingTotal));
  updateFundingTotal();

  document.getElementById('llProfileDisbursementForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const principal = Number(document.getElementById('llProfilePrincipal')?.value || 0);
    const start_date = document.getElementById('llProfileStartDate')?.value;
    const monthly_rate_total = Number(document.getElementById('llProfileTotalRate')?.value || 0) / 100;
    const monthly_rate_mgmt = Number(document.getElementById('llProfileMgmtRate')?.value || 0) / 100;
    const notes = document.getElementById('llProfileDisbursementNotes')?.value.trim() || null;
    const funding = fundingInputs.map(input => ({ partner_user_id:input.dataset.partnerUserId, funding_percent:Number(input.value || 0)/100 })).filter(row => row.partner_user_id && row.funding_percent > 0);
    const fundingTotal = funding.reduce((sum,row) => sum + row.funding_percent, 0);
    if (!principal || !start_date) return setStatus('llProfileDisbursementStatus', 'Fecha y capital son requeridos.', true);
    if (monthly_rate_mgmt > monthly_rate_total) return setStatus('llProfileDisbursementStatus', 'La administración no puede superar el interés total.', true);
    if (!funding.length || Math.abs(fundingTotal - 1) > 0.001) return setStatus('llProfileDisbursementStatus', 'La distribución debe sumar 100%.', true);
    setStatus('llProfileDisbursementStatus', 'Guardando desembolso...');
    const created_by = await currentUserId();
    const { data:loan, error:loanError } = await db.from('loans').insert({ borrower_id:currentBorrowerId, created_by, start_date, principal_original:principal, principal_outstanding:principal, monthly_rate_total, monthly_rate_mgmt, notes, status:'ACTIVE' }).select('id').single();
    if (loanError) return setStatus('llProfileDisbursementStatus', loanError.message, true);
    const { error:fundingError } = await db.from('loan_funding').insert(funding.map(row => ({ loan_id:loan.id, partner_user_id:row.partner_user_id, funding_percent:row.funding_percent })));
    if (fundingError) return setStatus('llProfileDisbursementStatus', fundingError.message, true);
    setStatus('llProfileDisbursementStatus', 'Desembolso guardado correctamente.');
    activeTab = 'disbursements';
    await refreshProfile(root);
  });
}

async function enhanceProfile(borrowerId) {
  currentBorrowerId = borrowerId || currentBorrowerId;
  if (!currentBorrowerId) return;
  const root = document.querySelector('#borrowerAccountContent .ll-account-shell');
  if (!root || root.dataset.functionalTabs === 'loading') return;
  const sequence = ++renderSequence;
  root.dataset.functionalTabs = 'loading';
  try {
    const data = await loadProfileData(currentBorrowerId);
    if (sequence !== renderSequence || !document.contains(root)) return;
    renderHost(root, data);
    root.dataset.functionalTabs = 'ready';
  } catch (error) {
    console.error(error);
    root.dataset.functionalTabs = 'error';
    root.querySelector('.ll-tabs')?.insertAdjacentHTML('afterend', `<div class="ll-card ll-tabs-error">No se pudieron cargar las pestañas: ${esc(error.message || error)}</div>`);
  }
}

function scheduleEnhance(borrowerId) {
  if (borrowerId) currentBorrowerId = borrowerId;
  setTimeout(() => enhanceProfile(currentBorrowerId), 180);
}

window.addEventListener('loan-ledger:account-rendered', event => scheduleEnhance(event.detail?.borrowerId));
window.addEventListener('loan-ledger:open-account', event => scheduleEnhance(event.detail?.borrowerId));

document.addEventListener('click', event => {
  const card = event.target.closest?.('[data-acct-borrower]');
  if (card?.dataset.acctBorrower) scheduleEnhance(card.dataset.acctBorrower);
}, true);

const content = document.getElementById('borrowerAccountContent');
if (content) new MutationObserver(() => {
  const root = content.querySelector('.ll-account-shell');
  if (root && root.dataset.functionalTabs !== 'ready' && currentBorrowerId) scheduleEnhance(currentBorrowerId);
}).observe(content, { childList:true, subtree:true });

console.log('functional client profile tabs active');
