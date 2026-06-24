import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient("https://eatxkhhpjruwwibhcubf.supabase.co", "sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage, storageKey: "loan-ledger-auth" },
});

const qs = (id) => document.getElementById(id);
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const todayIso = () => new Date().toISOString().slice(0, 10);
let paymentFilter = localStorage.getItem("loanLedger.paymentFilter") || "active";
let paymentBusy = false;
let accountBusy = false;
let lastHtml = "";
let detailOpen = false;
let accountsCache = [];

function isPaymentsPage() { return qs("paymentsPage")?.classList.contains("active-page"); }
function card(html, attrs = "") { return `<div class="compact-card" ${attrs} style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;box-sizing:border-box;${attrs ? "cursor:pointer;" : ""}">${html}</div>`; }
function typeLabel(type) { return { INSTALLMENT: "Cuota/interés", PRINCIPAL: "Abono a capital", MIXED: "Mixto", PAYOFF: "Saldar capital" }[type] || type || "—"; }

function ensurePaymentsDom() {
  const page = qs("paymentsPage");
  if (!page) return;
  if (qs("accountPaymentForm") && qs("accountPaymentList")) return;
  page.innerHTML = `
    <div class="card" id="accountPaymentForm" data-no-translate="true">
      <div style="font-weight:800;">Registrar pago por cliente/cuenta</div>
      <div class="muted">Aplica pagos a la cuenta completa del cliente, no a un desembolso individual.</div>
      <select id="acctPaymentBorrower"><option value="">Cargando clientes...</option></select>
      <div class="row">
        <input id="acctPagePaidOn" type="date" value="${todayIso()}" />
        <input id="acctPageAmount" type="number" step="0.01" placeholder="Monto pagado" />
      </div>
      <select id="acctPageType">
        <option value="INSTALLMENT">Pago de cuota/interés</option>
        <option value="PRINCIPAL">Abono directo a capital</option>
        <option value="MIXED">Mixto: cuota y sobrante a capital</option>
        <option value="PAYOFF">Saldar capital</option>
      </select>
      <input id="acctPageNotes" placeholder="Notas del pago (opcional)" />
      <button id="acctPageApplyPayment" type="button">Aplicar pago</button>
      <div id="acctPagePaymentStatus" class="muted">Los pagos de cuota no rebajan capital. El capital solo baja con abono a capital, mixto o saldo.</div>
    </div>

    <div class="card" data-no-translate="true">
      <div style="font-weight:800;">Historial de pagos</div>
      <div id="paymentFilterBox">
        <div class="row"><button id="payFilterActive" type="button">Activos</button><button id="payFilterAll" type="button">Todos</button></div>
        <div class="row"><button id="payFilterVoided" type="button">Anulados</button><button id="payFilterMonth" type="button">Este mes</button></div>
        <div class="row"><select id="payFilterBorrower"><option value="">Todos los clientes</option></select><input id="paySearch" placeholder="Buscar pago..." /></div>
      </div>
      <div id="accountPaymentList" class="muted">Cargando pagos...</div>
    </div>
  `;
  qs("payFilterActive").onclick = () => setFilter("active");
  qs("payFilterAll").onclick = () => setFilter("all");
  qs("payFilterVoided").onclick = () => setFilter("voided");
  qs("payFilterMonth").onclick = () => setFilter("month");
  qs("payFilterBorrower").onchange = () => renderPayments(true);
  qs("paySearch").oninput = () => renderPayments(true);
  qs("acctPageApplyPayment").onclick = applyAccountPayment;
}

async function loadAccounts(force = false) {
  if (accountBusy) return accountsCache;
  if (!force && accountsCache.length) return accountsCache;
  accountBusy = true;
  try {
    const { data, error } = await supabase.from("borrower_account_summary").select("borrower_id, full_name, principal_balance, current_cycle_fee, account_status").order("full_name", { ascending: true });
    if (error) throw error;
    accountsCache = data || [];
    return accountsCache;
  } finally { accountBusy = false; }
}
async function populateAccountSelects() {
  const accounts = await loadAccounts();
  const active = accounts.filter((a) => Number(a.principal_balance || 0) > 0);
  const options = `<option value="">Selecciona un cliente</option>${active.map((a) => `<option value="${a.borrower_id}">${a.full_name} (${a.account_status}, ${money(a.principal_balance)})</option>`).join("")}`;
  if (qs("acctPaymentBorrower") && qs("acctPaymentBorrower").innerHTML !== options) qs("acctPaymentBorrower").innerHTML = options;
  const filterOptions = `<option value="">Todos los clientes</option>${accounts.map((a) => `<option value="${a.borrower_id}">${a.full_name}</option>`).join("")}`;
  if (qs("payFilterBorrower") && qs("payFilterBorrower").innerHTML !== filterOptions) qs("payFilterBorrower").innerHTML = filterOptions;
}
function setFilter(next) {
  paymentFilter = next;
  localStorage.setItem("loanLedger.paymentFilter", next);
  detailOpen = false;
  lastHtml = "";
  renderPayments(true);
}
function updateButtons() {
  const buttons = { active: qs("payFilterActive"), all: qs("payFilterAll"), voided: qs("payFilterVoided"), month: qs("payFilterMonth") };
  Object.entries(buttons).forEach(([key, btn]) => { if (btn) btn.style.background = paymentFilter === key ? "#2b63ff" : "#333"; });
}
function filterRows(rows) {
  const borrowerId = qs("payFilterBorrower")?.value || "";
  const term = String(qs("paySearch")?.value || "").trim().toLowerCase();
  const month = new Date().toISOString().slice(0, 7);
  return rows.filter((p) => {
    if (borrowerId && p.borrower_id !== borrowerId) return false;
    if (paymentFilter === "active" && p.is_voided) return false;
    if (paymentFilter === "voided" && !p.is_voided) return false;
    if (paymentFilter === "month" && String(p.paid_on || "").slice(0, 7) !== month) return false;
    if (term) {
      const hay = [p.borrower_name, p.paid_on, p.amount, p.payment_type, p.notes, p.void_reason].map((x) => String(x || "").toLowerCase()).join(" ");
      if (!hay.includes(term)) return false;
    }
    return true;
  });
}
async function applyAccountPayment() {
  const borrowerId = qs("acctPaymentBorrower")?.value;
  const paidOn = qs("acctPagePaidOn")?.value;
  const amount = Number(qs("acctPageAmount")?.value || 0);
  const paymentType = qs("acctPageType")?.value || "INSTALLMENT";
  const notes = qs("acctPageNotes")?.value?.trim() || null;
  const status = qs("acctPagePaymentStatus");
  if (!borrowerId || !paidOn || !amount) return alert("Cliente, fecha y monto son requeridos.");
  if (status) status.textContent = "Aplicando pago...";
  const { error } = await supabase.rpc("apply_borrower_payment", { p_borrower_id: borrowerId, p_paid_on: paidOn, p_amount: amount, p_payment_type: paymentType, p_notes: notes });
  if (error) { if (status) status.textContent = error.message; return alert(error.message); }
  if (status) status.textContent = "Pago aplicado.";
  qs("acctPageAmount").value = "";
  qs("acctPageNotes").value = "";
  accountsCache = [];
  lastHtml = "";
  await populateAccountSelects();
  await renderPayments(true);
}
async function renderPayments(force = false) {
  ensurePaymentsDom();
  if (!isPaymentsPage() || !qs("accountPaymentList") || paymentBusy || (detailOpen && !force)) return;
  paymentBusy = true;
  try {
    await populateAccountSelects();
    updateButtons();
    const { data, error } = await supabase.from("borrower_account_payments_view").select("*").order("paid_on", { ascending: false }).order("created_at", { ascending: false }).limit(200);
    if (error) throw error;
    const rows = filterRows(data || []);
    const html = rows.length ? rows.map((p) => card(`
      <strong>${p.borrower_name || "Cliente"}</strong> — ${money(p.amount)} ${p.is_voided ? "<span class='acct-pill acct-danger'>ANULADO</span>" : ""}<br>
      <span class="muted">${p.paid_on} | ${typeLabel(p.payment_type)} | Cuota/interés: ${money(p.applied_interest)} | Capital: ${money(p.applied_principal)}</span><br>
      <span class="muted">Administración: ${money(p.applied_mgmt)} | Socios: ${money(p.applied_funders)} | Clic para detalle</span>
    `, `data-account-payment-id="${p.id}"`)).join("") : "No hay pagos para esta vista.";
    if (force || html !== lastHtml) {
      qs("accountPaymentList").innerHTML = html;
      lastHtml = html;
      document.querySelectorAll("[data-account-payment-id]").forEach((el) => el.onclick = () => openPaymentDetails(el.dataset.accountPaymentId));
    }
  } catch (error) {
    console.error(error);
    qs("accountPaymentList").textContent = error.message || String(error);
  } finally { paymentBusy = false; }
}
async function openPaymentDetails(paymentId) {
  detailOpen = true;
  const list = qs("accountPaymentList");
  if (!list) return;
  list.innerHTML = card(`<strong>Detalle del pago</strong><br><span class="muted">Cargando...</span>`);
  try {
    const [paymentRes, dueRes, principalRes, allocRes] = await Promise.all([
      supabase.from("borrower_account_payments_view").select("*").eq("id", paymentId).single(),
      supabase.from("payment_borrower_due_applications").select("applied_total, applied_mgmt, applied_funders, borrower_due_event_id, borrower_due_events(due_date,status)").eq("payment_id", paymentId),
      supabase.from("payment_principal_applications").select("amount, loan_id").eq("payment_id", paymentId),
      supabase.from("partner_allocation_details").select("partner_name, allocation_type, amount, is_voided").eq("payment_id", paymentId),
    ]);
    if (paymentRes.error) throw paymentRes.error;
    const p = paymentRes.data;
    const dues = dueRes.data || [];
    const principals = principalRes.data || [];
    const allocs = allocRes.data || [];
    list.innerHTML = `
      <div class="card" data-no-translate="true">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;"><div style="font-weight:800;">Detalle del pago</div><button id="btnBackToPayments" type="button" style="width:auto;background:#333;padding:10px 14px;">Volver</button></div>
        <div style="margin-top:12px;"><strong>${p.borrower_name || "Cliente"}</strong> — ${money(p.amount)} ${p.is_voided ? "ANULADO" : ""}<br><span class="muted">Fecha: ${p.paid_on} | Tipo: ${typeLabel(p.payment_type)}</span><br><span class="muted">Cuota/interés: ${money(p.applied_interest)} | Capital: ${money(p.applied_principal)} | Administración: ${money(p.applied_mgmt)} | Socios: ${money(p.applied_funders)}</span>${p.notes ? `<br><span class="muted">${p.notes}</span>` : ""}${p.void_reason ? `<br><span class="muted">Motivo anulación: ${p.void_reason}</span>` : ""}</div>
      </div>
      <div class="card" data-no-translate="true"><div style="font-weight:800;">Cuotas afectadas</div>${dues.length ? dues.map((a) => card(`<strong>${a.borrower_due_events?.due_date || "Cuota"}</strong><br><span class="muted">Total: ${money(a.applied_total)} | Administración: ${money(a.applied_mgmt)} | Socios: ${money(a.applied_funders)} | ${a.borrower_due_events?.status || "—"}</span>`)).join("") : "No afectó cuotas."}</div>
      <div class="card" data-no-translate="true"><div style="font-weight:800;">Capital afectado</div>${principals.length ? principals.map((a) => card(`<strong>${money(a.amount)}</strong><br><span class="muted">Desembolso: ${String(a.loan_id).slice(0, 8)}…</span>`)).join("") : "No afectó capital."}</div>
      <div class="card" data-no-translate="true"><div style="font-weight:800;">Distribuciones</div>${allocs.length ? allocs.map((a) => card(`<strong>${a.partner_name || "Socio"}</strong> — ${money(a.amount)}<br><span class="muted">${a.allocation_type}${a.is_voided ? " | ANULADO" : ""}</span>`)).join("") : "No hay distribuciones."}</div>
      <div class="card" data-no-translate="true"><div style="font-weight:800;">Acciones</div><button id="btnVoidPaymentDetail" type="button" style="background:#7a2b2b;" ${p.is_voided ? "disabled" : ""}>Anular pago</button><div id="paymentActionStatus" class="muted" style="margin-top:8px;"></div></div>
    `;
    qs("btnBackToPayments").onclick = () => { detailOpen = false; lastHtml = ""; renderPayments(true); };
    qs("btnVoidPaymentDetail").onclick = async () => {
      const reason = prompt("Motivo de anulación:", "Registrado incorrectamente");
      if (reason === null) return;
      if (!confirm("¿Anular este pago y revertir cuotas/capital/distribuciones?")) return;
      const { error } = await supabase.rpc("void_payment", { p_payment_id: paymentId, p_reason: reason });
      if (error) return alert(error.message);
      alert("Pago anulado y revertido.");
      accountsCache = [];
      lastHtml = "";
      await openPaymentDetails(paymentId);
    };
  } catch (error) {
    console.error(error);
    list.innerHTML = card(`<strong>Detalle del pago</strong><br><span class="muted">${error.message || String(error)}</span><br><button id="btnBackToPayments" type="button">Volver</button>`);
    qs("btnBackToPayments").onclick = () => { detailOpen = false; lastHtml = ""; renderPayments(true); };
  }
}
function tick() { if (isPaymentsPage()) renderPayments(false); }
const observer = new MutationObserver(() => setTimeout(tick, 200));
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
setInterval(tick, 2500);
tick();
