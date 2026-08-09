import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient("https://eatxkhhpjruwwibhcubf.supabase.co", "sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage, storageKey: "loan-ledger-auth" },
});

function ensurePaymentsStyle() {
  const href = "./payment-management.css?v=1";
  let link = document.getElementById("paymentManagementCss");
  if (!link) {
    link = document.createElement("link");
    link.id = "paymentManagementCss";
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  link.href = href;
}
ensurePaymentsStyle();

const qs = (id) => document.getElementById(id);
const money = (n) => `$${Math.round(Number(n || 0)).toLocaleString("en-US")}`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const initials = (name = "?") => String(name || "?").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "?";

let statusFilter = localStorage.getItem("loanLedger.paymentFilter") || "all";
let periodFilter = "month";
let typeFilter = "";
let accountsCache = [];
let paymentsCache = [];
let accountBusy = false;
let paymentBusy = false;
let pageNumber = 1;
let drawerMode = "closed";
let activeDetailId = null;
let lastRefreshAt = 0;
const PAGE_SIZE = 10;

const ICONS = {
  dollar: '<circle cx="12" cy="12" r="8.5"/><path d="M15.2 8.5c-.7-.8-1.7-1.2-3.2-1.2-1.8 0-3 .8-3 2 0 3 6 1.2 6 4.2 0 1.3-1.2 2.2-3.2 2.2-1.6 0-2.8-.5-3.6-1.4M12 5.5v13"/>',
  percent: '<path d="M7 17 17 7"/><circle cx="7.5" cy="7.5" r="2.2"/><circle cx="16.5" cy="16.5" r="2.2"/>',
  capital: '<path d="M4 8.5 12 4l8 4.5-8 4.5-8-4.5Z"/><path d="m4 12 8 4.5 8-4.5M4 15.5 12 20l8-4.5"/>',
  voided: '<circle cx="12" cy="12" r="8.5"/><path d="m6 18 12-12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14" rx="2.5"/><path d="M8 3.5v4M16 3.5v4M4 9.5h16"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  arrowUp: '<path d="m7 14 5-5 5 5"/>',
  arrowDown: '<path d="m7 10 5 5 5-5"/>',
  user: '<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20c.6-4.4 2.8-6.6 6.5-6.6s5.9 2.2 6.5 6.6"/>',
};
function svg(name, size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.dollar}</svg>`;
}

function isPaymentsPage() { return qs("paymentsPage")?.classList.contains("active-page"); }
function typeLabel(type) { return { INSTALLMENT: "Cuota / interés", PRINCIPAL: "Abono a capital", MIXED: "Mixto", PAYOFF: "Saldar capital" }[type] || type || "—"; }
function typeClass(type) { return { INSTALLMENT: "installment", PRINCIPAL: "principal", MIXED: "mixed", PAYOFF: "payoff" }[type] || "installment"; }
function fmtDate(iso) {
  if (!iso) return "—";
  try { return new Date(`${iso}T00:00:00`).toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" }).replace(".", ""); }
  catch { return iso; }
}
function monthKey(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
function previousMonthKey() { const date = new Date(); date.setMonth(date.getMonth() - 1); return monthKey(date); }
function accountStatus(value) {
  const key = String(value || "").toUpperCase();
  return { ACTIVE: "ACTIVO", CURRENT: "AL DÍA", OVERDUE: "ATRASADO", PAID_OFF: "SALDADO", CLOSED: "CERRADO" }[key] || value || "—";
}

function ensurePaymentsDom() {
  const page = qs("paymentsPage");
  if (!page || qs("paymentsWorkspace")) return;
  page.classList.add("ll-payments-page");
  page.innerHTML = `
    <div id="paymentsWorkspace" class="ll-payments-shell" data-no-translate="true">
      <main class="ll-payments-main">
        <header class="ll-payments-header">
          <div>
            <h1>Pagos</h1>
            <p>Registra, revisa y administra todos los pagos.</p>
          </div>
          <button id="llOpenPaymentDrawer" class="ll-payments-primary" type="button">${svg("plus", 15)}<span>Registrar pago</span></button>
        </header>

        <section id="paymentKpis" class="ll-payment-kpis" aria-label="Resumen de pagos">
          ${kpiSkeleton("Pagado este mes")}${kpiSkeleton("Cuota / interés")}${kpiSkeleton("Capital recuperado")}${kpiSkeleton("Pagos anulados")}
        </section>

        <section class="ll-payment-history-card">
          <div class="ll-payment-history-head"><h2>Historial de pagos</h2></div>
          <div class="ll-payment-controls">
            <div class="ll-payment-status-tabs" role="tablist">
              <button id="payFilterAll" type="button" data-status-filter="all">Todos</button>
              <button id="payFilterActive" type="button" data-status-filter="active">Activos</button>
              <button id="payFilterVoided" type="button" data-status-filter="voided">Anulados</button>
            </div>
            <select id="payFilterBorrower" aria-label="Filtrar por cliente"><option value="">Todos los clientes</option></select>
            <select id="payFilterPeriod" aria-label="Filtrar por periodo">
              <option value="all">Todos los periodos</option>
              <option value="month" selected>Este mes</option>
              <option value="previous">Mes anterior</option>
              <option value="year">Este año</option>
            </select>
            <select id="payFilterType" aria-label="Filtrar por tipo">
              <option value="">Todos los tipos</option>
              <option value="INSTALLMENT">Cuota / interés</option>
              <option value="PRINCIPAL">Abono a capital</option>
              <option value="MIXED">Mixto</option>
              <option value="PAYOFF">Saldar capital</option>
            </select>
            <label class="ll-payment-search">${svg("search", 15)}<input id="paySearch" type="search" placeholder="Buscar pago..." /></label>
          </div>

          <div class="ll-payment-table-head" aria-hidden="true">
            <span>Fecha</span><span>Cliente</span><span>Monto</span><span>Tipo</span><span>Cuota</span><span>Capital</span><span>Estado</span><span></span>
          </div>
          <div id="accountPaymentList" class="ll-payment-table-body"><div class="ll-payment-loading">Cargando pagos...</div></div>
          <footer class="ll-payment-pagination">
            <span id="paymentResultCount">—</span>
            <div><button id="llPayPrev" type="button" aria-label="Página anterior">‹</button><span id="llPayPage">1</span><button id="llPayNext" type="button" aria-label="Página siguiente">›</button></div>
          </footer>
        </section>
      </main>

      <div id="paymentDrawerBackdrop" class="ll-payment-drawer-backdrop"></div>
      <aside id="paymentDrawer" class="ll-payment-drawer" aria-hidden="true"></aside>
    </div>
  `;
  wireWorkspace();
}
function kpiSkeleton(label) {
  return `<article class="ll-payment-kpi ll-kpi-skeleton"><div class="ll-payment-kpi-icon"></div><div><span>${label}</span><strong>—</strong><small>Cargando...</small></div></article>`;
}

function wireWorkspace() {
  const root = qs("paymentsWorkspace");
  if (!root || root.dataset.bound === "1") return;
  root.dataset.bound = "1";
  root.addEventListener("click", handleWorkspaceClick);
  root.addEventListener("change", handleWorkspaceChange);
  root.addEventListener("input", handleWorkspaceInput);
  root.addEventListener("keydown", (event) => {
    const row = event.target.closest?.("[data-account-payment-id]");
    if (row && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openPaymentDetails(row.dataset.accountPaymentId); }
    if (event.key === "Escape" && drawerMode !== "closed") closeDrawer();
  });
}

async function loadAccounts(force = false) {
  if (accountBusy) return accountsCache;
  if (!force && accountsCache.length) return accountsCache;
  accountBusy = true;
  try {
    const { data, error } = await supabase.from("borrower_account_summary")
      .select("borrower_id, full_name, principal_balance, current_cycle_fee, account_status, next_due_date, overdue_amount")
      .order("full_name", { ascending: true });
    if (error) throw error;
    accountsCache = data || [];
    return accountsCache;
  } finally { accountBusy = false; }
}
async function loadPayments(force = false) {
  if (paymentBusy) return paymentsCache;
  if (!force && paymentsCache.length) return paymentsCache;
  paymentBusy = true;
  try {
    const { data, error } = await supabase.from("borrower_account_payments_view").select("*")
      .order("paid_on", { ascending: false }).order("created_at", { ascending: false }).limit(250);
    if (error) throw error;
    paymentsCache = data || [];
    return paymentsCache;
  } finally { paymentBusy = false; }
}

async function refreshData(force = false) {
  ensurePaymentsDom();
  if (!isPaymentsPage()) return;
  try {
    await Promise.all([loadAccounts(force), loadPayments(force)]);
    populateFilterBorrowers();
    renderKpis();
    renderPayments();
    if (drawerMode === "register") {
      populatePaymentBorrowers();
      updateBorrowerContext();
    }
    lastRefreshAt = Date.now();
  } catch (error) {
    console.error("payments workspace refresh failed", error);
    const list = qs("accountPaymentList");
    if (list) list.innerHTML = `<div class="ll-payment-empty">${esc(error.message || error)}</div>`;
  }
}

function populateFilterBorrowers() {
  const select = qs("payFilterBorrower");
  if (!select) return;
  const current = select.value;
  const html = `<option value="">Todos los clientes</option>${accountsCache.map((a) => `<option value="${esc(a.borrower_id)}">${esc(a.full_name || "Cliente")}</option>`).join("")}`;
  if (select.innerHTML !== html) select.innerHTML = html;
  select.value = current;
}
function populatePaymentBorrowers() {
  const select = qs("acctPaymentBorrower");
  if (!select) return;
  const current = select.value;
  const active = accountsCache.filter((a) => Number(a.principal_balance || 0) > 0);
  const html = `<option value="">Selecciona un cliente</option>${active.map((a) => `<option value="${esc(a.borrower_id)}">${esc(a.full_name || "Cliente")}</option>`).join("")}`;
  if (select.innerHTML !== html) select.innerHTML = html;
  select.value = active.some((a) => String(a.borrower_id) === String(current)) ? current : "";
}

function metricRows(rows, key) { return rows.filter((p) => !p.is_voided && String(p.paid_on || "").slice(0, 7) === key); }
function metricTrend(current, previous) {
  if (!previous && !current) return `<span class="ll-kpi-trend neutral">Sin cambio vs. mes anterior</span>`;
  if (!previous) return `<span class="ll-kpi-trend up">${svg("arrowUp", 12)} Nuevo vs. mes anterior</span>`;
  const percent = ((current - previous) / Math.abs(previous)) * 100;
  const direction = percent >= 0 ? "up" : "down";
  return `<span class="ll-kpi-trend ${direction}">${svg(percent >= 0 ? "arrowUp" : "arrowDown", 12)} ${Math.abs(percent).toFixed(1)}% vs. mes anterior</span>`;
}
function renderKpis() {
  const host = qs("paymentKpis");
  if (!host) return;
  const currentRows = metricRows(paymentsCache, monthKey());
  const previousRows = metricRows(paymentsCache, previousMonthKey());
  const currentVoided = paymentsCache.filter((p) => p.is_voided && String(p.paid_on || "").slice(0, 7) === monthKey());
  const previousVoided = paymentsCache.filter((p) => p.is_voided && String(p.paid_on || "").slice(0, 7) === previousMonthKey());
  const sum = (rows, field) => rows.reduce((total, row) => total + Number(row[field] || 0), 0);
  const uniqueInterestClients = new Set(currentRows.filter((p) => Number(p.applied_interest || 0) > 0).map((p) => p.borrower_id)).size;
  const metrics = [
    { tone: "purple", icon: "dollar", label: "Pagado este mes", value: sum(currentRows, "amount"), sub: `${currentRows.length} ${currentRows.length === 1 ? "pago" : "pagos"}`, previous: sum(previousRows, "amount") },
    { tone: "lime", icon: "percent", label: "Cuota / interés", value: sum(currentRows, "applied_interest"), sub: `${uniqueInterestClients} ${uniqueInterestClients === 1 ? "cliente" : "clientes"}`, previous: sum(previousRows, "applied_interest") },
    { tone: "blue", icon: "capital", label: "Capital recuperado", value: sum(currentRows, "applied_principal"), sub: "Total aplicado", previous: sum(previousRows, "applied_principal") },
    { tone: "coral", icon: "voided", label: "Pagos anulados", value: sum(currentVoided, "amount"), sub: `${currentVoided.length} ${currentVoided.length === 1 ? "pago" : "pagos"}`, previous: sum(previousVoided, "amount") },
  ];
  host.innerHTML = metrics.map((metric) => `<article class="ll-payment-kpi ${metric.tone}"><div class="ll-payment-kpi-icon">${svg(metric.icon, 19)}</div><div><span>${metric.label}</span><strong>${money(metric.value)}</strong><small>${metric.sub}</small>${metricTrend(metric.value, metric.previous)}</div></article>`).join("");
}

function setStatusFilter(next) {
  statusFilter = next;
  localStorage.setItem("loanLedger.paymentFilter", next);
  pageNumber = 1;
  renderPayments();
}
function matchesPeriod(payment) {
  const date = String(payment.paid_on || "");
  if (periodFilter === "month") return date.slice(0, 7) === monthKey();
  if (periodFilter === "previous") return date.slice(0, 7) === previousMonthKey();
  if (periodFilter === "year") return date.slice(0, 4) === String(new Date().getFullYear());
  return true;
}
function filteredPayments() {
  const borrowerId = qs("payFilterBorrower")?.value || "";
  const term = String(qs("paySearch")?.value || "").trim().toLowerCase();
  return paymentsCache.filter((p) => {
    if (statusFilter === "active" && p.is_voided) return false;
    if (statusFilter === "voided" && !p.is_voided) return false;
    if (borrowerId && String(p.borrower_id) !== String(borrowerId)) return false;
    if (typeFilter && p.payment_type !== typeFilter) return false;
    if (!matchesPeriod(p)) return false;
    if (term) {
      const haystack = [p.borrower_name, p.paid_on, p.amount, p.payment_type, p.notes, p.void_reason].map((value) => String(value || "").toLowerCase()).join(" ");
      if (!haystack.includes(term)) return false;
    }
    return true;
  });
}
function renderPayments() {
  const host = qs("accountPaymentList");
  if (!host) return;
  document.querySelectorAll("[data-status-filter]").forEach((button) => button.classList.toggle("active", button.dataset.statusFilter === statusFilter));
  const rows = filteredPayments();
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  if (pageNumber > totalPages) pageNumber = totalPages;
  const start = (pageNumber - 1) * PAGE_SIZE;
  const visible = rows.slice(start, start + PAGE_SIZE);
  host.innerHTML = visible.length ? visible.map(paymentRowHtml).join("") : `<div class="ll-payment-empty">No hay pagos para esta vista.</div>`;
  const resultCount = qs("paymentResultCount");
  if (resultCount) resultCount.textContent = rows.length ? `Mostrando ${start + 1}–${Math.min(start + PAGE_SIZE, rows.length)} de ${rows.length} pagos` : "0 pagos";
  const page = qs("llPayPage"); if (page) page.textContent = String(pageNumber);
  const prev = qs("llPayPrev"); if (prev) prev.disabled = pageNumber <= 1;
  const next = qs("llPayNext"); if (next) next.disabled = pageNumber >= totalPages;
}
function paymentRowHtml(p) {
  const voided = !!p.is_voided;
  return `<div class="ll-payment-row ${voided ? "is-voided" : ""}" role="button" tabindex="0" data-account-payment-id="${esc(p.id)}">
    <span class="ll-payment-date">${esc(fmtDate(p.paid_on))}</span>
    <span class="ll-payment-client"><i>${esc(initials(p.borrower_name || "Cliente"))}</i><b>${esc(p.borrower_name || "Cliente")}</b></span>
    <strong class="ll-payment-amount">${money(p.amount)}</strong>
    <span><em class="ll-payment-type ${typeClass(p.payment_type)}">${esc(typeLabel(p.payment_type))}</em></span>
    <span class="ll-payment-money">${money(p.applied_interest)}</span>
    <span class="ll-payment-money">${money(p.applied_principal)}</span>
    <span><em class="ll-payment-state ${voided ? "voided" : "applied"}">${voided ? "Anulado" : "Aplicado"}</em></span>
    <span class="ll-payment-chevron">${svg("chevronRight", 15)}</span>
  </div>`;
}

function openRegisterDrawer() {
  drawerMode = "register";
  activeDetailId = null;
  const drawer = qs("paymentDrawer");
  if (!drawer) return;
  drawer.innerHTML = registerDrawerHtml();
  openDrawer();
  populatePaymentBorrowers();
  updateBorrowerContext();
}
function registerDrawerHtml() {
  return `<div class="ll-payment-drawer-inner">
    <header class="ll-payment-drawer-head"><div><h2>Registrar pago</h2><p>Aplica el pago a la cuenta completa del cliente.</p></div><button type="button" data-close-payment-drawer aria-label="Cerrar">${svg("close", 17)}</button></header>
    <div class="ll-payment-drawer-scroll">
      <label class="ll-payment-field"><span>Cliente</span><select id="acctPaymentBorrower"><option value="">Cargando clientes...</option></select></label>
      <div id="paymentBorrowerContext" class="ll-payment-borrower-context is-empty"><div class="ll-context-placeholder">Selecciona un cliente para ver el estado de su cuenta.</div></div>
      <div class="ll-payment-form-two">
        <label class="ll-payment-field"><span>Fecha</span><input id="acctPagePaidOn" type="date" value="${todayIso()}" /></label>
        <label class="ll-payment-field"><span>Monto</span><div class="ll-payment-money-input"><input id="acctPageAmount" type="number" min="1" step="1" placeholder="0" /><b>$</b></div></label>
      </div>
      <div class="ll-payment-quick-block"><span>Sugerencias rápidas</span><div id="paymentQuickAmounts" class="ll-payment-quick-buttons"><button type="button" data-quick-payment="half" disabled>½ cuota</button><button type="button" data-quick-payment="one" disabled>1 cuota</button><button type="button" data-quick-payment="two" disabled>2 cuotas</button><button type="button" data-quick-payment="payoff" disabled>Saldar</button></div></div>
      <label class="ll-payment-field"><span>Tipo de pago</span><select id="acctPageType"><option value="INSTALLMENT">Pago de cuota / interés</option><option value="PRINCIPAL">Abono directo a capital</option><option value="MIXED">Mixto: cuota y sobrante a capital</option><option value="PAYOFF">Saldar capital</option></select></label>
      <label class="ll-payment-field"><span>Notas del pago <small>(opcional)</small></span><textarea id="acctPageNotes" rows="4" placeholder="Escribe una nota o referencia..."></textarea></label>
      <div id="acctPagePaymentStatus" class="ll-payment-form-status"></div>
    </div>
    <footer class="ll-payment-drawer-foot"><button id="acctPageApplyPayment" class="ll-payments-primary ll-payment-submit" type="button">Registrar pago</button><p>${svg("info", 14)} Los pagos de cuota no rebajan capital. El capital solo baja con abono a capital, mixto o saldo.</p></footer>
  </div>`;
}
function selectedAccount() {
  const id = qs("acctPaymentBorrower")?.value;
  return accountsCache.find((account) => String(account.borrower_id) === String(id));
}
function updateBorrowerContext() {
  const account = selectedAccount();
  const host = qs("paymentBorrowerContext");
  const buttons = [...document.querySelectorAll("[data-quick-payment]")];
  if (!host) return;
  if (!account) {
    host.className = "ll-payment-borrower-context is-empty";
    host.innerHTML = `<div class="ll-context-placeholder">Selecciona un cliente para ver el estado de su cuenta.</div>`;
    buttons.forEach((button) => { button.disabled = true; delete button.dataset.amount; });
    return;
  }
  host.className = "ll-payment-borrower-context";
  host.innerHTML = `<div class="ll-context-client"><span>${esc(initials(account.full_name))}</span><div><strong>${esc(account.full_name || "Cliente")}</strong><small>${esc(accountStatus(account.account_status))}</small></div></div><div class="ll-context-stats"><div><strong>${money(account.principal_balance)}</strong><small>Balance actual</small></div><div><strong>${money(account.current_cycle_fee)}</strong><small>Cuota pendiente</small></div><div><strong>${esc(fmtDate(account.next_due_date))}</strong><small>Próxima fecha</small></div><div class="${Number(account.overdue_amount || 0) > 0 ? "danger" : ""}"><strong>${money(account.overdue_amount)}</strong><small>Atrasado</small></div></div>`;
  const fee = Number(account.current_cycle_fee || 0), balance = Number(account.principal_balance || 0);
  const values = { half: fee / 2, one: fee, two: fee * 2, payoff: balance };
  buttons.forEach((button) => { const amount = values[button.dataset.quickPayment] || 0; button.disabled = amount <= 0; button.dataset.amount = String(Math.round(amount)); });
}
function applyQuickAmount(kind, amount) {
  const input = qs("acctPageAmount");
  const type = qs("acctPageType");
  if (input) input.value = String(Math.round(Number(amount || 0)));
  if (type) type.value = kind === "payoff" ? "PAYOFF" : "INSTALLMENT";
  document.querySelectorAll("[data-quick-payment]").forEach((button) => button.classList.toggle("active", button.dataset.quickPayment === kind));
}

async function applyAccountPayment() {
  const borrowerId = qs("acctPaymentBorrower")?.value;
  const paidOn = qs("acctPagePaidOn")?.value;
  const amount = Number(qs("acctPageAmount")?.value || 0);
  const paymentType = qs("acctPageType")?.value || "INSTALLMENT";
  const notes = qs("acctPageNotes")?.value?.trim() || null;
  const status = qs("acctPagePaymentStatus");
  const submit = qs("acctPageApplyPayment");
  if (!borrowerId || !paidOn || !amount) { if (status) status.textContent = "Cliente, fecha y monto son requeridos."; return; }
  if (submit) submit.disabled = true;
  if (status) { status.textContent = "Aplicando pago..."; status.className = "ll-payment-form-status"; }
  try {
    const { error } = await supabase.rpc("apply_borrower_payment", { p_borrower_id: borrowerId, p_paid_on: paidOn, p_amount: amount, p_payment_type: paymentType, p_notes: notes });
    if (error) throw error;
    if (status) { status.textContent = "Pago registrado correctamente."; status.classList.add("success"); }
    accountsCache = [];
    paymentsCache = [];
    await refreshData(true);
    setTimeout(() => { if (drawerMode === "register") closeDrawer(); }, 650);
  } catch (error) {
    if (status) { status.textContent = error.message || String(error); status.classList.add("error"); }
  } finally { if (submit) submit.disabled = false; }
}

async function openPaymentDetails(paymentId) {
  drawerMode = "detail";
  activeDetailId = paymentId;
  const drawer = qs("paymentDrawer");
  if (!drawer) return;
  drawer.innerHTML = `<div class="ll-payment-drawer-inner"><header class="ll-payment-drawer-head"><div><h2>Detalle del pago</h2><p>Desglose y aplicaciones del movimiento.</p></div><button type="button" data-close-payment-drawer aria-label="Cerrar">${svg("close", 17)}</button></header><div class="ll-payment-detail-loading">Cargando detalle...</div></div>`;
  openDrawer();
  try {
    const [paymentRes, dueRes, principalRes, allocRes] = await Promise.all([
      supabase.from("borrower_account_payments_view").select("*").eq("id", paymentId).single(),
      supabase.from("payment_borrower_due_applications").select("applied_total, applied_mgmt, applied_funders, borrower_due_event_id, borrower_due_events(due_date,status)").eq("payment_id", paymentId),
      supabase.from("payment_principal_applications").select("amount, loan_id").eq("payment_id", paymentId),
      supabase.from("partner_allocation_details").select("partner_name, allocation_type, amount, is_voided").eq("payment_id", paymentId),
    ]);
    if (paymentRes.error) throw paymentRes.error;
    if (drawerMode !== "detail" || activeDetailId !== paymentId) return;
    drawer.innerHTML = detailDrawerHtml(paymentRes.data, dueRes.data || [], principalRes.data || [], allocRes.data || []);
  } catch (error) {
    if (drawerMode === "detail") drawer.innerHTML = `<div class="ll-payment-drawer-inner"><header class="ll-payment-drawer-head"><div><h2>Detalle del pago</h2></div><button type="button" data-close-payment-drawer>${svg("close", 17)}</button></header><div class="ll-payment-detail-loading error">${esc(error.message || error)}</div></div>`;
  }
}
function detailDrawerHtml(p, dues, principals, allocs) {
  const voided = !!p.is_voided;
  return `<div class="ll-payment-drawer-inner">
    <header class="ll-payment-drawer-head"><div><h2>Detalle del pago</h2><p>${esc(fmtDate(p.paid_on))}</p></div><button type="button" data-close-payment-drawer aria-label="Cerrar">${svg("close", 17)}</button></header>
    <div class="ll-payment-drawer-scroll ll-payment-detail-scroll">
      <section class="ll-payment-detail-hero"><div class="ll-payment-detail-person"><span>${esc(initials(p.borrower_name || "Cliente"))}</span><div><strong>${esc(p.borrower_name || "Cliente")}</strong><small>${esc(typeLabel(p.payment_type))}</small></div></div><strong class="ll-payment-detail-total">${money(p.amount)}</strong><em class="ll-payment-state ${voided ? "voided" : "applied"}">${voided ? "Anulado" : "Aplicado"}</em></section>
      <section class="ll-payment-detail-grid"><div><small>Cuota / interés</small><strong>${money(p.applied_interest)}</strong></div><div><small>Capital</small><strong>${money(p.applied_principal)}</strong></div><div><small>Administración</small><strong>${money(p.applied_mgmt)}</strong></div><div><small>Socios</small><strong>${money(p.applied_funders)}</strong></div></section>
      ${p.notes ? `<section class="ll-payment-detail-section"><h3>Notas</h3><p>${esc(p.notes)}</p></section>` : ""}
      ${p.void_reason ? `<section class="ll-payment-detail-section danger"><h3>Motivo de anulación</h3><p>${esc(p.void_reason)}</p></section>` : ""}
      <section class="ll-payment-detail-section"><h3>Cuotas afectadas</h3>${dues.length ? dues.map((row) => `<div class="ll-detail-line"><span><strong>${esc(fmtDate(row.borrower_due_events?.due_date))}</strong><small>${esc(row.borrower_due_events?.status || "—")}</small></span><b>${money(row.applied_total)}</b></div>`).join("") : `<p class="ll-detail-empty">No afectó cuotas.</p>`}</section>
      <section class="ll-payment-detail-section"><h3>Capital afectado</h3>${principals.length ? principals.map((row) => `<div class="ll-detail-line"><span><strong>Abono a capital</strong><small>Desembolso ${esc(String(row.loan_id || "").slice(0, 8))}…</small></span><b>${money(row.amount)}</b></div>`).join("") : `<p class="ll-detail-empty">No afectó capital.</p>`}</section>
      <section class="ll-payment-detail-section"><h3>Distribuciones</h3>${allocs.length ? allocs.map((row) => `<div class="ll-detail-line"><span><strong>${esc(row.partner_name || "Socio")}</strong><small>${esc(row.allocation_type || "Distribución")}${row.is_voided ? " · ANULADO" : ""}</small></span><b>${money(row.amount)}</b></div>`).join("") : `<p class="ll-detail-empty">No hay distribuciones.</p>`}</section>
      <div id="paymentActionStatus" class="ll-payment-form-status"></div>
    </div>
    <footer class="ll-payment-drawer-foot ll-detail-foot"><button id="btnVoidPaymentDetail" type="button" class="ll-payment-danger-btn" ${voided ? "disabled" : ""}>${voided ? "Pago anulado" : "Anular pago"}</button></footer>
  </div>`;
}
async function voidActivePayment() {
  if (!activeDetailId) return;
  const reason = prompt("Motivo de anulación:", "Registrado incorrectamente");
  if (reason === null) return;
  if (!confirm("¿Anular este pago y revertir cuotas, capital y distribuciones?")) return;
  const status = qs("paymentActionStatus");
  if (status) status.textContent = "Anulando pago...";
  const { error } = await supabase.rpc("void_payment", { p_payment_id: activeDetailId, p_reason: reason });
  if (error) { if (status) { status.textContent = error.message; status.classList.add("error"); } return; }
  accountsCache = [];
  paymentsCache = [];
  await refreshData(true);
  await openPaymentDetails(activeDetailId);
}

function openDrawer() {
  const shell = qs("paymentsWorkspace"), drawer = qs("paymentDrawer");
  shell?.classList.add("ll-drawer-open");
  if (drawer) drawer.setAttribute("aria-hidden", "false");
}
function closeDrawer() {
  drawerMode = "closed";
  activeDetailId = null;
  const shell = qs("paymentsWorkspace"), drawer = qs("paymentDrawer");
  shell?.classList.remove("ll-drawer-open");
  if (drawer) drawer.setAttribute("aria-hidden", "true");
}

function handleWorkspaceClick(event) {
  const target = event.target;
  if (target.closest("#llOpenPaymentDrawer")) { openRegisterDrawer(); return; }
  if (target.closest("[data-close-payment-drawer]") || target.closest("#paymentDrawerBackdrop")) { closeDrawer(); return; }
  const filter = target.closest("[data-status-filter]"); if (filter) { setStatusFilter(filter.dataset.statusFilter); return; }
  const row = target.closest("[data-account-payment-id]"); if (row) { openPaymentDetails(row.dataset.accountPaymentId); return; }
  const quick = target.closest("[data-quick-payment]"); if (quick && !quick.disabled) { applyQuickAmount(quick.dataset.quickPayment, quick.dataset.amount); return; }
  if (target.closest("#acctPageApplyPayment")) { applyAccountPayment(); return; }
  if (target.closest("#btnVoidPaymentDetail")) { voidActivePayment(); return; }
  if (target.closest("#llPayPrev")) { pageNumber = Math.max(1, pageNumber - 1); renderPayments(); return; }
  if (target.closest("#llPayNext")) { pageNumber += 1; renderPayments(); return; }
}
function handleWorkspaceChange(event) {
  if (event.target.id === "payFilterBorrower") { pageNumber = 1; renderPayments(); }
  if (event.target.id === "payFilterPeriod") { periodFilter = event.target.value; pageNumber = 1; renderPayments(); }
  if (event.target.id === "payFilterType") { typeFilter = event.target.value; pageNumber = 1; renderPayments(); }
  if (event.target.id === "acctPaymentBorrower") updateBorrowerContext();
}
function handleWorkspaceInput(event) {
  if (event.target.id === "paySearch") { pageNumber = 1; renderPayments(); }
}

function tick() {
  if (!isPaymentsPage()) return;
  ensurePaymentsDom();
  if (!lastRefreshAt || Date.now() - lastRefreshAt > 10000) refreshData(false);
}

const observer = new MutationObserver(() => setTimeout(tick, 80));
observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ["class"] });
setInterval(tick, 5000);
ensurePaymentsDom();
tick();

console.log("modern payments workspace active");
