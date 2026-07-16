import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient('https://eatxkhhpjruwwibhcubf.supabase.co','sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q',{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:'loan-ledger-auth'}});
const $ = id => document.getElementById(id);
const money = n => `$${Number(n || 0).toFixed(2)}`;
const today = () => new Date().toISOString().slice(0,10);
let activeBorrowerId = null;
let rendering = false;

function statusLabel(status){
  return {ACTIVE:'ACTIVO',CURRENT:'AL DÍA',OVERDUE:'ATRASADO',ATRASADO:'ATRASADO',PAID:'PAGADO',PAID_OFF:'SALDADO',CLOSED:'CERRADO',VOIDED:'ANULADO',DUE:'PENDIENTE',UPCOMING:'PRÓXIMO',DUE_TODAY:'VENCE HOY'}[status] || status || '—';
}
function statusTone(status){
  const s = String(status || '').toUpperCase();
  if(['OVERDUE','ATRASADO','VENCIDO'].includes(s)) return 'danger';
  if(['DUE','PENDING','PENDIENTE'].includes(s)) return 'pending';
  if(['PAID_OFF','CLOSED','SALDADO'].includes(s)) return 'closed';
  return 'ok';
}
function paymentTypeLabel(type){
  return {INSTALLMENT:'Cuota/interés',PRINCIPAL:'Abono a capital',MIXED:'Mixto',PAYOFF:'Saldar capital'}[type] || type || '—';
}
function initials(name='?'){
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0,2).map(x => x[0]?.toUpperCase()).join('') || '?';
}
function clientIdShort(id){ return id ? `CLI-${String(id).slice(0,4).toUpperCase()}` : 'CLI'; }
function fmtDate(iso){
  if(!iso) return '—';
  try{return new Date(`${iso}T00:00:00`).toLocaleDateString('es',{day:'2-digit',month:'short',year:'numeric'}).replace('.','');}catch{return iso;}
}
function daysUntil(iso){
  if(!iso) return null;
  const a = new Date(`${today()}T00:00:00`);
  const b = new Date(`${iso}T00:00:00`);
  return Math.round((b-a)/86400000);
}
function dueSubtext(iso){
  const d = daysUntil(iso);
  if(d === null || Number.isNaN(d)) return 'Sin fecha';
  if(d < 0) return `Hace ${Math.abs(d)} días`;
  if(d === 0) return 'Hoy';
  if(d === 1) return 'Mañana';
  return `En ${d} días`;
}
function miniDateChips(baseIso){
  const base = baseIso ? new Date(`${baseIso}T00:00:00`) : new Date(`${today()}T00:00:00`);
  const dates = [];
  for(let i=-2;i<=3;i++){
    const d = new Date(base);
    d.setDate(base.getDate()+i);
    dates.push(d);
  }
  return dates.map((d, idx) => {
    const selected = idx === 2;
    const dow = d.toLocaleDateString('es',{weekday:'short'}).replace('.','');
    const mon = d.toLocaleDateString('es',{month:'short'}).replace('.','').toUpperCase();
    return `<button type="button" class="ll-date-chip ${selected?'selected':''}"><span>${dow}</span><strong>${d.getDate()}</strong><small>${mon}</small></button>`;
  }).join('');
}
function simpleCard(html){
  return `<div class="compact-card" style="background:#fff!important;color:#17181c!important;border:1px solid #e8e8ee!important;border-radius:14px;padding:12px;margin:10px 0;box-sizing:border-box;">${html}</div>`;
}

async function loadAccountData(borrowerId){
  const [accountsRes, summaryRes, disbRes, payRes, contactRes, followRes] = await Promise.all([
    db.from('borrower_account_summary').select('*').order('full_name',{ascending:true}),
    db.from('borrower_account_summary').select('*').eq('borrower_id',borrowerId).single(),
    db.from('borrower_disbursements_view').select('*').eq('borrower_id',borrowerId).order('start_date',{ascending:false}),
    db.from('borrower_account_payments_view').select('*').eq('borrower_id',borrowerId).order('paid_on',{ascending:false}).order('created_at',{ascending:false}).limit(80),
    db.from('borrower_contact_log_view').select('*').eq('borrower_id',borrowerId).order('created_at',{ascending:false}).limit(12),
    db.from('borrower_followups_view').select('*').eq('borrower_id',borrowerId).order('due_date',{ascending:true}).limit(12)
  ]);
  for(const res of [accountsRes, summaryRes, disbRes, payRes, contactRes, followRes]) if(res.error) throw res.error;
  return {accounts:accountsRes.data || [], summary:summaryRes.data, disb:disbRes.data || [], pays:payRes.data || [], contacts:contactRes.data || [], follows:followRes.data || []};
}
function renderClientRail(accounts, selectedId){
  return `<aside class="ll-client-rail" data-no-translate="true">
    <div class="ll-rail-top"><div class="ll-logo-mark">✱</div><div class="ll-rail-title">Clientes</div><button class="ll-icon-btn" type="button">⌕</button></div>
    <div class="ll-filter-row"><span>Todos los clientes</span><span>☷</span></div>
    <div class="ll-client-list">
      ${accounts.map(a => {
        const active = a.borrower_id === selectedId;
        const tone = statusTone(a.account_status);
        return `<div class="ll-client-card ${active?'active':''}" data-acct-borrower="${a.borrower_id}">
          <div class="ll-client-avatar">${initials(a.full_name)}</div>
          <div><div class="ll-client-name">${a.full_name || 'Sin nombre'}</div><div class="ll-client-id">ID: ${clientIdShort(a.borrower_id)}</div><div class="ll-client-balance">${money(a.principal_balance)}</div></div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:14px"><span>↗</span><span class="ll-rail-badge ${tone}">${statusLabel(a.account_status)}</span></div>
        </div>`;
      }).join('')}
    </div>
    <button id="acctBack" type="button" class="ll-soft-btn" style="justify-content:center;margin-top:auto!important;">Volver</button>
  </aside>`;
}
function renderActivity(pays, disb, contacts, follows){
  const items = [];
  pays.slice(0,2).forEach(p => items.push({icon:'$', cls:'green', title:'Pago recibido', desc:`Se recibió un pago de ${money(p.amount)}.`, date:p.paid_on || ''}));
  contacts.slice(0,1).forEach(c => items.push({icon:'☎', cls:'purple', title:'Contacto registrado', desc:c.notes || c.outcome || 'Nota de contacto registrada.', date:c.contact_date || ''}));
  follows.slice(0,1).forEach(f => items.push({icon:'✓', cls:'purple', title:'Seguimiento', desc:f.reason || 'Seguimiento pendiente.', date:f.due_date || ''}));
  disb.slice(0,1).forEach(d => items.push({icon:'↓', cls:'lime', title:'Nuevo desembolso', desc:`Desembolso por ${money(d.principal_original)} registrado.`, date:d.start_date || ''}));
  return items.slice(0,4).map(i => `<div class="ll-timeline-item"><div class="ll-timeline-dot ${i.cls}">${i.icon}</div><div><div class="ll-time-title">${i.title}</div><div class="ll-time-desc">${i.desc}</div></div><div class="ll-time-date">${fmtDate(i.date)}</div></div>`).join('') || '<div class="muted">No hay actividad reciente.</div>';
}

async function applyAccountPayment(){
  const amount = Number($('acctPayAmount')?.value || 0);
  const paid_on = $('acctPayDate')?.value;
  const payment_type = $('acctPayType')?.value || 'INSTALLMENT';
  const notes = $('acctPayNotes')?.value?.trim() || null;
  const status = $('acctPayStatus');
  if(!activeBorrowerId || !amount || !paid_on) return alert('Fecha y monto son requeridos.');
  if(status) status.textContent = 'Aplicando pago...';
  const {error} = await db.rpc('apply_borrower_payment',{p_borrower_id:activeBorrowerId,p_paid_on:paid_on,p_amount:amount,p_payment_type:payment_type,p_notes:notes});
  if(error){ if(status) status.textContent = error.message; return alert(error.message); }
  if(status) status.textContent = 'Pago aplicado.';
  await renderDesktopClient(activeBorrowerId);
}

async function renderDesktopClient(borrowerId){
  if(rendering) return;
  rendering = true;
  activeBorrowerId = borrowerId;
  const content = $('borrowerAccountContent');
  if(!content){ rendering = false; return; }
  try{
    const {accounts, summary:a, disb, pays, contacts, follows} = await loadAccountData(borrowerId);
    const tone = statusTone(a.account_status);
    const nextDue = a.next_due_date;
    const dueDateText = fmtDate(nextDue);
    const dueDays = daysUntil(nextDue);
    const cycleFee = Number(a.current_cycle_fee || 0);
    const overdue = Number(a.overdue_amount || 0);
    const quickDefault = cycleFee || Number(a.current_monthly_fee || 0) || 0;
    const paysHtml = pays.map(p => simpleCard(`<strong>${p.paid_on}</strong> — ${money(p.amount)} <span class="acct-pill">${paymentTypeLabel(p.payment_type)}</span>${p.is_voided ? " <span class='acct-pill acct-danger'>ANULADO</span>" : ''}<br>Cuota/interés: ${money(p.applied_interest)} | Capital: ${money(p.applied_principal)}<br>Administración: ${money(p.applied_mgmt)} | Socios: ${money(p.applied_funders)}${p.notes ? `<br><span class="muted">${p.notes}</span>` : ''}`)).join('') || 'No hay pagos.';
    const disbHtml = disb.map(d => simpleCard(`<strong>${d.start_date}</strong> — Desembolso ${money(d.principal_original)}<br>Balance asignado: ${money(d.principal_outstanding)} | Estado: ${statusLabel(d.status)}<br><span class="muted">Interés mensual ${(Number(d.monthly_rate_total || 0)*100).toFixed(2)}% | Administración ${(Number(d.monthly_rate_mgmt || 0)*100).toFixed(2)}%</span>`)).join('') || 'No hay desembolsos.';
    const followsHtml = follows.map(f => simpleCard(`<strong>${f.due_date}</strong> — ${f.priority} | ${statusLabel(f.timing_status)}<br><span class="muted">${f.reason || '—'}</span>`)).join('') || 'No hay seguimientos.';
    const contactsHtml = contacts.map(c => simpleCard(`<strong>${c.contact_type}</strong> — ${c.contact_date}<br><span class="muted">${c.outcome || '—'}</span><br>${c.notes || ''}`)).join('') || 'No hay notas.';

    content.innerHTML = `<div class="ll-account-shell">
      ${renderClientRail(accounts, borrowerId)}
      <main class="ll-workspace" data-no-translate="true">
        <section class="ll-client-header">
          <div class="ll-avatar-xl">${initials(a.full_name)}</div>
          <div><div class="ll-title-row"><div class="ll-client-title">${a.full_name || 'Cuenta del cliente'}</div><span class="ll-status-pill ${tone}">${statusLabel(a.account_status)}</span></div><div class="ll-client-meta"><span>☎ ${a.phone || 'Sin teléfono'}</span><span>ID: ${clientIdShort(a.borrower_id)}</span><span>Próxima cuota: ${dueDateText}</span><span>Atrasado: ${money(overdue)}</span></div></div>
          <div class="ll-action-row"><button class="ll-soft-btn" type="button" id="llFocusPay">$ Registrar pago</button><button class="ll-soft-btn" type="button">▣ Agregar nota</button><button class="ll-soft-btn" type="button">☏ WhatsApp</button><button class="ll-primary-btn" type="button">↓ Nuevo desembolso</button></div>
        </section>
        <nav class="ll-tabs"><div class="ll-tab active">Resumen</div><div class="ll-tab">Cuotas</div><div class="ll-tab">Pagos</div><div class="ll-tab">Desembolsos</div><div class="ll-tab">Seguimientos</div></nav>
        <section class="ll-body-grid"><div>
          <div class="ll-card"><div class="ll-card-title">Resumen financiero</div><div class="ll-stat-strip">
            <div class="ll-stat"><div class="ll-stat-icon">$</div><div class="ll-stat-label">Balance de capital</div><div class="ll-stat-value">${money(a.principal_balance)}</div><div class="ll-stat-sub">Activo</div></div>
            <div class="ll-stat"><div class="ll-stat-icon">▣</div><div class="ll-stat-label">Total desembolsado</div><div class="ll-stat-value">${money(a.total_disbursed)}</div><div class="ll-stat-sub">Histórico</div></div>
            <div class="ll-stat"><div class="ll-stat-icon">◴</div><div class="ll-stat-label">Cuota mensual</div><div class="ll-stat-value">${money(a.current_monthly_fee)}</div><div class="ll-stat-sub">Actual</div></div>
            <div class="ll-stat"><div class="ll-stat-icon">↔</div><div class="ll-stat-label">Cuota por ciclo</div><div class="ll-stat-value">${money(a.current_cycle_fee)}</div><div class="ll-stat-sub">15 y fin de mes</div></div>
            <div class="ll-stat"><div class="ll-stat-icon">↗</div><div class="ll-stat-label">Próxima cuota</div><div class="ll-stat-value" style="color:var(--ll-purple);font-size:17px">${dueDateText}</div><div class="ll-stat-sub">${dueSubtext(nextDue)}</div></div>
          </div></div>
          <div class="ll-card card" data-no-translate="true"><div style="font-weight:800;" class="ll-card-title">Calendario de cuotas</div><div class="ll-date-head"><strong>Próximas fechas de pago</strong><span>${nextDue ? new Date(`${nextDue}T00:00:00`).toLocaleDateString('es',{month:'long',year:'numeric'}).replace(/^./,c=>c.toUpperCase()) : 'Calendario'}</span></div><div class="ll-date-row">${miniDateChips(nextDue)}</div><div class="ll-due-highlight"><div><strong>Cuota del ${dueDateText}</strong><div class="muted">Fecha calculada automáticamente</div></div><div><small>Monto esperado</small><br><strong>${money(cycleFee)}</strong></div><div><small>Estado</small><br><span class="ll-mini-pill">Pendiente</span></div><div><small>Días restantes</small><br><strong>${dueDays ?? '—'} días</strong></div></div></div>
          <div class="ll-card"><div class="ll-card-title">Actividad reciente</div><div class="ll-timeline">${renderActivity(pays, disb, contacts, follows)}</div></div>
          <div class="ll-section-grid"><div class="ll-card ll-mini-list"><div class="ll-card-title">Historial de pagos</div>${paysHtml}</div><div class="ll-card ll-mini-list"><div class="ll-card-title">Desembolsos / capital agregado</div>${disbHtml}</div><div class="ll-card ll-mini-list"><div class="ll-card-title">Seguimientos</div>${followsHtml}</div><div class="ll-card ll-mini-list"><div class="ll-card-title">Notas de contacto</div>${contactsHtml}</div></div>
        </div><aside class="ll-side-stack">
          <div class="ll-side-card"><div class="ll-side-title"><span class="ll-side-icon">☑</span>Próxima acción</div><div class="muted">Confirmar pago de la cuota</div><div style="margin-top:10px;font-weight:850">${dueDateText}</div><div class="muted">${dueSubtext(nextDue)}</div><button type="button" class="ll-purple-btn">Marcar como completada</button></div>
          <div class="ll-side-card"><div class="ll-side-title"><span class="ll-side-icon">◴</span>Cuota pendiente</div><div class="muted">Cuota próxima</div><div style="font-size:25px;font-weight:900;margin:8px 0">${money(cycleFee)}</div><div style="display:flex;justify-content:space-between;margin:8px 0"><span class="muted">Estado</span><span class="ll-mini-pill">Pendiente</span></div><div style="display:flex;justify-content:space-between"><span class="muted">Días restantes</span><strong>${dueDays ?? '—'} días</strong></div></div>
          <div class="ll-side-card ll-pay-card" data-no-translate="true"><div class="ll-side-title"><span class="ll-side-icon" style="background:#dff7d9;color:#2e8e31">$</span>Pago rápido</div><div class="muted">Abona a la cuenta del cliente</div><div class="ll-quick-grid"><button type="button" class="ll-quick-amount" data-amount="${Math.max(0,quickDefault/2).toFixed(2)}">${money(Math.max(0,quickDefault/2))}</button><button type="button" class="ll-quick-amount active" data-amount="${quickDefault.toFixed(2)}">${money(quickDefault)}</button><button type="button" class="ll-quick-amount" data-amount="${(quickDefault*2).toFixed(2)}">${money(quickDefault*2)}</button><button type="button" class="ll-quick-amount" data-amount="${(quickDefault*4).toFixed(2)}">${money(quickDefault*4)}</button></div><input id="acctPayAmount" type="number" step="0.01" value="${quickDefault ? quickDefault.toFixed(2) : ''}" placeholder="Otro monto"><input id="acctPayDate" type="date" value="${today()}"><select id="acctPayType"><option value="INSTALLMENT">Pago de cuota/interés</option><option value="PRINCIPAL">Abono directo a capital</option><option value="MIXED">Mixto: cuota y sobrante a capital</option><option value="PAYOFF">Saldar capital</option></select><input id="acctPayNotes" placeholder="Notas del pago"><button id="acctPayBtn" type="button" class="ll-primary-btn">Registrar pago</button><div id="acctPayStatus" class="muted" style="margin-top:8px">Los pagos de cuota no rebajan capital.</div></div>
          <div class="ll-side-card"><div class="ll-side-title"><span class="ll-side-icon">▣</span>Información de la cuenta</div><div style="display:grid;gap:9px;font-size:13px"><div style="display:flex;justify-content:space-between"><span class="muted">Cliente</span><strong>${a.full_name || '—'}</strong></div><div style="display:flex;justify-content:space-between"><span class="muted">Balance</span><strong>${money(a.principal_balance)}</strong></div><div style="display:flex;justify-content:space-between"><span class="muted">Cuotas atrasadas</span><strong>${a.overdue_count || 0}</strong></div><div style="display:flex;justify-content:space-between"><span class="muted">Días tarde</span><strong>${a.max_days_late || 0}</strong></div></div></div>
        </aside></section>
      </main>
    </div>`;
    $('acctBack')?.addEventListener('click', () => window.history.length > 1 ? window.history.back() : null);
    $('llFocusPay')?.addEventListener('click', () => $('acctPayAmount')?.focus());
    $('acctPayBtn')?.addEventListener('click', applyAccountPayment);
    document.querySelectorAll('.ll-quick-amount').forEach(btn => btn.addEventListener('click', () => {document.querySelectorAll('.ll-quick-amount').forEach(b => b.classList.remove('active'));btn.classList.add('active');if($('acctPayAmount')) $('acctPayAmount').value = btn.dataset.amount || '';}));
  }catch(error){
    console.error(error);
    const content = $('borrowerAccountContent');
    if(content) content.innerHTML = `<div class="card" style="color:#ff8b8b;">${error.message || String(error)}</div>`;
  }finally{ rendering = false; }
}

window.addEventListener('loan-ledger:account-rendered', event => {
  const id = event.detail?.borrowerId;
  if(id) setTimeout(() => renderDesktopClient(id), 80);
});

console.log('desktop client detail renderer active');
