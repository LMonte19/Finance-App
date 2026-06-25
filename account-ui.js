import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient('https://eatxkhhpjruwwibhcubf.supabase.co','sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q',{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:'loan-ledger-auth'}});
const $ = id => document.getElementById(id);
const money = n => `$${Number(n || 0).toFixed(2)}`;
const today = () => new Date().toISOString().slice(0,10);
let borrowerId = null;
let loanListBusy = false;
let lastLoanHtml = '';
let lastActivePage = '';

function isPage(id){ return $(id)?.classList.contains('active-page'); }
function openPage(id){
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active-page'));
  document.querySelector(`.tab-btn[data-page="${id}"]`)?.classList.add('active');
  $(id)?.classList.add('active-page');
  $('sideMenu')?.classList.remove('open');
  $('menuOverlay')?.classList.remove('open');
}
function card(html, attrs=''){
  return `<div class="compact-card acct-card" ${attrs} style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;box-sizing:border-box;${attrs?'cursor:pointer;':''}">${html}</div>`;
}
function statusClass(status){ return status === 'ATRASADO' || status === 'OVERDUE' ? 'acct-danger' : 'acct-ok'; }
function statusLabel(status){ return { ACTIVE:'ACTIVO', CURRENT:'AL DÍA', OVERDUE:'ATRASADO', ATRASADO:'ATRASADO', 'AL DIA':'AL DÍA' }[status] || status || '—'; }
function paymentTypeLabel(type){ return {INSTALLMENT:'Cuota/interés',PRINCIPAL:'Abono a capital',MIXED:'Mixto',PAYOFF:'Saldar capital'}[type] || type || '—'; }

function ensureAccountStyles(){
  if($('accountUiStyle')) return;
  const style = document.createElement('style');
  style.id = 'accountUiStyle';
  style.textContent = `
    .acct-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:12px}
    .acct-stat{background:#0f0f11;border:1px solid #2a2a2e;border-radius:14px;padding:14px}
    .acct-label{color:#b8b8c2;font-size:13px;margin-bottom:6px}
    .acct-value{font-size:22px;font-weight:800}
    .acct-danger{color:#ff8b8b}.acct-ok{color:#9ff5b2}.acct-warn{color:#ffd27a}
    .acct-pill{display:inline-block;min-height:18px;line-height:18px;padding:4px 10px;border:1px solid #333;border-radius:999px;font-size:12px;white-space:nowrap}
    .acct-click:hover{filter:brightness(1.08)}
    @media(max-width:650px){.acct-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}
function ensureAccountPage(){
  const app = $('app');
  if(!app) return;
  if(!$('borrowerAccountPage')){
    const page = document.createElement('div');
    page.id = 'borrowerAccountPage';
    page.className = 'page';
    page.innerHTML = '<div id="borrowerAccountContent" class="muted">Cargando cuenta...</div>';
    app.appendChild(page);
  }
}

async function renderLoanList(force=false){
  const list = $('loanList');
  if(!isPage('loansPage') || loanListBusy || !list) return;
  loanListBusy = true;
  try{
    const [accountsRes, disbRes] = await Promise.all([
      db.from('borrower_account_summary').select('*').order('full_name',{ascending:true}),
      db.from('borrower_disbursements_view').select('*').order('start_date',{ascending:false})
    ]);
    if(accountsRes.error) throw accountsRes.error;
    if(disbRes.error) throw disbRes.error;

    const byBorrower = new Map();
    (disbRes.data || []).forEach(d => {
      if(!byBorrower.has(d.borrower_id)) byBorrower.set(d.borrower_id, []);
      byBorrower.get(d.borrower_id).push(d);
    });

    const html = (accountsRes.data || []).map(a => {
      const status = statusLabel(a.account_status);
      const recent = (byBorrower.get(a.borrower_id) || []).slice(0,3).map(d => `<div style="margin:6px 0"><strong>${d.start_date}</strong> — Desembolso ${money(d.principal_original)} | Balance ${money(d.principal_outstanding)} | ${statusLabel(d.status)}</div>`).join('') || 'Sin desembolsos.';
      return card(`<div style="display:flex;justify-content:space-between;gap:10px"><div><strong>${a.full_name}</strong><br><span class="muted">${a.phone || 'Sin teléfono'}</span></div><span class="acct-pill ${statusClass(a.account_status)}">${status}</span></div><div style="margin-top:8px">Balance de capital: <strong>${money(a.principal_balance)}</strong> | Total desembolsado: ${money(a.total_disbursed)}<br>Cuota mensual actual: <strong>${money(a.current_monthly_fee)}</strong> | Cuota por ciclo: ${money(a.current_cycle_fee)}<br>Próxima cuota: ${a.next_due_date || '—'} | Atrasado: ${money(a.overdue_amount)}</div><div style="border-top:1px solid #2a2a2e;margin-top:10px;padding-top:10px">${recent}</div><div class="muted" style="margin-top:10px">Clic para abrir cuenta completa.</div>`, `data-acct-borrower="${a.borrower_id}" class="acct-click"`);
    }).join('') || 'No hay clientes/cuentas para mostrar.';

    if(force || html !== lastLoanHtml || list.dataset.accountOwned !== 'true'){
      list.innerHTML = html;
      list.dataset.accountOwned = 'true';
      lastLoanHtml = html;
    }
  }catch(error){
    console.error(error);
    list.innerHTML = `<div style="color:#ff8b8b;">${error.message || String(error)}</div>`;
  }finally{
    loanListBusy = false;
  }
}

async function openAccount(id){
  borrowerId = id;
  ensureAccountStyles();
  ensureAccountPage();
  openPage('borrowerAccountPage');
  await renderAccount();
}
async function renderAccount(){
  if(!borrowerId || !isPage('borrowerAccountPage')) return;
  const content = $('borrowerAccountContent');
  if(content) content.innerHTML = '<div class="card muted">Cargando cuenta...</div>';
  try{
    const [summaryRes, disbRes, payRes, contactRes, followRes] = await Promise.all([
      db.from('borrower_account_summary').select('*').eq('borrower_id',borrowerId).single(),
      db.from('borrower_disbursements_view').select('*').eq('borrower_id',borrowerId).order('start_date',{ascending:false}),
      db.from('borrower_account_payments_view').select('*').eq('borrower_id',borrowerId).order('paid_on',{ascending:false}).limit(80),
      db.from('borrower_contact_log_view').select('*').eq('borrower_id',borrowerId).order('created_at',{ascending:false}).limit(12),
      db.from('borrower_followups_view').select('*').eq('borrower_id',borrowerId).order('due_date',{ascending:true}).limit(12)
    ]);
    for(const res of [summaryRes,disbRes,payRes,contactRes,followRes]) if(res.error) throw res.error;
    const a = summaryRes.data;
    const disb = (disbRes.data || []).map(d => card(`<strong>${d.start_date}</strong> — Desembolso ${money(d.principal_original)}<br>Balance asignado: ${money(d.principal_outstanding)} | Estado: ${statusLabel(d.status)}<br><span class="muted">Interés mensual ${(Number(d.monthly_rate_total || 0)*100).toFixed(2)}% | Administración ${(Number(d.monthly_rate_mgmt || 0)*100).toFixed(2)}%</span>`)).join('') || 'No hay desembolsos.';
    const pays = (payRes.data || []).map(p => card(`<strong>${p.paid_on}</strong> — ${money(p.amount)} <span class="acct-pill">${paymentTypeLabel(p.payment_type)}</span>${p.is_voided ? " <span class='acct-pill acct-danger'>ANULADO</span>" : ''}<br>Cuota/interés: ${money(p.applied_interest)} | Capital: ${money(p.applied_principal)}<br>Administración: ${money(p.applied_mgmt)} | Socios: ${money(p.applied_funders)}${p.notes ? `<br><span class="muted">${p.notes}</span>` : ''}`)).join('') || 'No hay pagos.';
    const contacts = (contactRes.data || []).map(c => card(`<strong>${c.contact_type}</strong> — ${c.contact_date}<br><span class="muted">${c.outcome || '—'}</span><br>${c.notes || ''}`)).join('') || 'No hay notas.';
    const follows = (followRes.data || []).map(f => card(`<strong>${f.due_date}</strong> — ${f.priority} | ${statusLabel(f.timing_status)}<br><span class="muted">${f.reason || '—'}</span>`)).join('') || 'No hay seguimientos.';

    content.innerHTML = `
      <div class="card" data-no-translate="true">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
          <div><div style="font-weight:800;font-size:22px">Cuenta del cliente</div><div class="muted">${a.full_name} ${a.phone ? `| ${a.phone}` : ''}</div></div>
          <button id="acctBack" type="button" style="width:auto;background:#333;padding:10px 14px">Volver</button>
        </div>
        <div class="acct-grid">
          <div class="acct-stat"><div class="acct-label">Balance de capital</div><div class="acct-value">${money(a.principal_balance)}</div></div>
          <div class="acct-stat"><div class="acct-label">Cuota mensual actual</div><div class="acct-value">${money(a.current_monthly_fee)}</div></div>
          <div class="acct-stat"><div class="acct-label">Cuota por ciclo</div><div class="acct-value">${money(a.current_cycle_fee)}</div></div>
          <div class="acct-stat"><div class="acct-label">Estado</div><div class="acct-value ${statusClass(a.account_status)}">${statusLabel(a.account_status)}</div></div>
        </div>
        <div class="muted" style="margin-top:12px">Próxima cuota: ${a.next_due_date || '—'} | Atrasado: ${money(a.overdue_amount)} | Días tarde: ${a.max_days_late || 0}<br>Los pagos de cuota no rebajan capital. El capital solo baja con abono a capital, mixto o saldo.</div>
      </div>
      <div class="card" data-no-translate="true">
        <div style="font-weight:800">Registrar pago</div>
        <div class="row"><input id="acctPayDate" type="date" value="${today()}"><input id="acctPayAmount" type="number" step="0.01" placeholder="Monto pagado"></div>
        <select id="acctPayType"><option value="INSTALLMENT">Pago de cuota/interés</option><option value="PRINCIPAL">Abono directo a capital</option><option value="MIXED">Mixto: cuota y sobrante a capital</option><option value="PAYOFF">Saldar capital</option></select>
        <input id="acctPayNotes" placeholder="Notas del pago"><button id="acctPayBtn" type="button">Aplicar pago</button>
        <div id="acctPayStatus" class="muted">Los pagos de cuota no rebajan capital.</div>
      </div>
      <div class="card"><div style="font-weight:800">Desembolsos / capital agregado</div>${disb}</div>
      <div class="card"><div style="font-weight:800">Historial de pagos</div>${pays}</div>
      <div class="card"><div style="font-weight:800">Seguimientos</div>${follows}</div>
      <div class="card"><div style="font-weight:800">Notas de contacto</div>${contacts}</div>
    `;
    $('acctBack').onclick = () => { openPage('loansPage'); renderLoanList(true); };
    $('acctPayBtn').onclick = applyAccountPayment;
  }catch(error){
    console.error(error);
    if(content) content.innerHTML = `<div class="card" style="color:#ff8b8b;">${error.message || String(error)}</div>`;
  }
}
async function applyAccountPayment(){
  const amount = Number($('acctPayAmount')?.value || 0);
  const paid_on = $('acctPayDate')?.value;
  const payment_type = $('acctPayType')?.value || 'INSTALLMENT';
  const notes = $('acctPayNotes')?.value?.trim() || null;
  const status = $('acctPayStatus');
  if(!borrowerId || !amount || !paid_on) return alert('Fecha y monto son requeridos.');
  if(status) status.textContent = 'Aplicando pago...';
  const {error} = await db.rpc('apply_borrower_payment',{p_borrower_id:borrowerId,p_paid_on:paid_on,p_amount:amount,p_payment_type:payment_type,p_notes:notes});
  if(error){ if(status) status.textContent = error.message; return alert(error.message); }
  if(status) status.textContent = 'Pago aplicado.';
  await renderAccount();
  lastLoanHtml = '';
}

document.addEventListener('click', event => {
  const acctCard = event.target.closest?.('[data-acct-borrower]');
  if(acctCard){
    event.preventDefault();
    openAccount(acctCard.dataset.acctBorrower);
  }
}, true);
window.addEventListener('loan-ledger:open-account', event => {
  if(event.detail?.borrowerId) openAccount(event.detail.borrowerId);
});

async function tick(){
  ensureAccountStyles();
  ensureAccountPage();
  const activePage = document.querySelector('.page.active-page')?.id || '';
  if(activePage !== lastActivePage){
    lastActivePage = activePage;
    if(activePage === 'loansPage') await renderLoanList(true);
  }
  if(isPage('loansPage')) await renderLoanList(false);
}

setInterval(tick, 2500);
setTimeout(tick, 300);
setTimeout(tick, 1200);
tick();
