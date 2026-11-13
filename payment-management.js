import { choosePaymentVoidReason } from './payment-void-reasons.js?v=1';
import { CLIENT_CHANGED, fillClientSelect, mergeClientAccount } from './client-directory.js?v=1';
import { paymentDistributionMarkup, attachPaymentDistribution } from './payment-distribution.js?v=1';
import { getPageSessionId, invalidatePageReads, readPageQuery, watchPage, isStalePageSession } from './page-read-runtime.js?v=1';
import { setStableMarkup } from './dashboard-presentation.js?v=1';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mixedPaymentMarkup, attachMixedPaymentSplit } from './mixed-payment-split.js?v=2';
import { openFloatingPanel, closeFloatingPanel } from './floating-panel.js?v=1';
import { paymentCalendarMarkup, attachPaymentCalendar, paymentCalendarEnd } from './payment-calendar.js?v=2';

const supabase = createClient("https://eatxkhhpjruwwibhcubf.supabase.co", "sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage, storageKey: "loan-ledger-auth" },
});

function ensurePaymentsStyle() {
  const href = "./payment-management.css?v=5";
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
const money = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(n || 0));
const todayIso = () => new Date().toISOString().slice(0, 10);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const initials = (name = "?") => String(name || "?").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "?";

let statusFilter = localStorage.getItem("loanLedger.paymentFilter") || "all";
let accountsCache = [];
let paymentsCache = [];
let refreshBusy = false;
let requestSequence = 0;
let pendingRefresh = null;
let pageNumber = 1;
let drawerMode = "closed";
let activeDetailId = null;
let lastRefreshAt = 0;
let paymentSaving = false;
let paymentPanel = null;
const PAGE_SIZE = 10;
const HISTORY_BATCH_SIZE = 250;

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
function previousMonthKey(date) { return monthKey(new Date(date.getFullYear(), date.getMonth() - 1, 1)); }
const monthLabel = new Intl.DateTimeFormat("es", { month: "long", year: "numeric" });
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

        <section aria-labelledby="paymentSummaryHeading">
          <h2 id="paymentSummaryHeading" class="ll-payment-summary-heading">Resumen mensual <time id="paymentSummaryPeriod"></time></h2>
          <div id="paymentKpis" class="ll-payment-kpis">
            ${kpiSkeleton("Pagado este mes")}${kpiSkeleton("Cuota / interés")}${kpiSkeleton("Capital recuperado")}${kpiSkeleton("Pagos anulados")}
          </div>
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
              <option value="month">Este mes</option>
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
            <span id="paymentResultCount" aria-live="polite">—</span>
            <div><button id="llPayPrev" type="button" aria-label="Página anterior">‹</button><span id="llPayPage">1</span><button id="llPayNext" type="button" aria-label="Página siguiente">›</button></div>
          </footer>
        </section>
      </main>

    </div>
  `;
  updateSummaryPeriod();
  wireWorkspace();
}
function kpiSkeleton(label) {
  return `<article class="ll-payment-kpi ll-kpi-skeleton"><div class="ll-payment-kpi-main"><div class="ll-payment-kpi-icon"></div><div class="ll-payment-kpi-copy"><span>${label}</span><strong>—</strong><small>—</small></div></div><span class="ll-kpi-trend neutral">—</span></article>`;
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

function readPaymentAccounts(force = false) {
  return readPageQuery('payments-accounts', () => supabase.from("borrower_account_summary")
      .select("borrower_id, full_name, principal_balance, current_cycle_fee, account_status, next_due_date, overdue_amount")
      .order("full_name", { ascending: true }), {force, ttl:45000});
}
async function fetchPaymentHistory() {
  const owner = getPageSessionId();
  const rows = [];
  for (let offset = 0; ; offset += HISTORY_BATCH_SIZE) {
    const { data, error } = await supabase.from("borrower_account_payments_view")
      .select("id,borrower_id,borrower_name,paid_on,amount,payment_type,applied_interest,applied_principal,is_voided,notes,void_reason")
      .order("paid_on", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + HISTORY_BATCH_SIZE - 1);
    if (getPageSessionId() !== owner) return { error: { code: "STALE_PAGE_SESSION" } };
    if (error) return { error };
    rows.push(...data);
    if (data.length < HISTORY_BATCH_SIZE) return { data: rows };
  }
}
function readPaymentData(force = false) {
  return Promise.all([
    readPaymentAccounts(force),
    readPageQuery('payments-history', fetchPaymentHistory, {force, ttl:45000})
  ]);
}

async function refreshData(force = false) {
  ensurePaymentsDom();
  if (!isPaymentsPage()) return;
  if (refreshBusy) { pendingRefresh=!!force||!!pendingRefresh; return; }
  refreshBusy=true;const sequence=++requestSequence;
  try {
    const [accounts, payments] = await readPaymentData(force);
    if (sequence!==requestSequence) return;
    if (accounts.error) throw accounts.error;
    if (payments.error) throw payments.error;
    accountsCache=accounts.data||[];
    paymentsCache=payments.data||[];
    lastRefreshAt = Date.now();
    populateFilterBorrowers();
    renderKpis();
    renderPayments();
    if (drawerMode === "register") {
      populatePaymentBorrowers();
      updateBorrowerContext();
    }
  } catch (error) {
    if (isStalePageSession(error)) return;
    console.error("payments workspace refresh failed", error);
    const list = qs("accountPaymentList");
    if (!lastRefreshAt) setStableMarkup(list, `<div class="ll-payment-empty">${esc(error.message || error)}</div>`);
  } finally {
    refreshBusy=false;
    if (pendingRefresh!==null) {const pending=pendingRefresh;pendingRefresh=null;queueMicrotask(()=>refreshData(pending));}
  }
}

function populateFilterBorrowers() {
  const select = qs("payFilterBorrower");
  if (!select) return;
  const current = select.value;
  const html = `<option value="">Todos los clientes</option>${accountsCache.map((a) => `<option value="${esc(a.borrower_id)}">${esc(a.full_name || "Cliente")}</option>`).join("")}`;
  if (select.innerHTML !== html) select.innerHTML = html;
  select.value = accountsCache.some((account) => String(account.borrower_id) === current) ? current : "";
}
function populatePaymentBorrowers() {
  fillClientSelect(qs("acctPaymentBorrower"),accountsCache);
}

function metricRows(rows, key) { return rows.filter((p) => !p.is_voided && String(p.paid_on || "").slice(0, 7) === key); }
function metricTrend(current, previous) {
  if (!previous && !current) return `<span class="ll-kpi-trend neutral">Sin cambio vs. mes anterior</span>`;
  if (!previous) return `<span class="ll-kpi-trend up">${svg("arrowUp", 12)} Nuevo vs. mes anterior</span>`;
  const percent = ((current - previous) / Math.abs(previous)) * 100;
  const direction = percent >= 0 ? "up" : "down";
  return `<span class="ll-kpi-trend ${direction}">${svg(percent >= 0 ? "arrowUp" : "arrowDown", 12)} ${Math.abs(percent).toFixed(1)}% vs. mes anterior</span>`;
}
function updateSummaryPeriod(date = new Date()) {
  const period = qs("paymentSummaryPeriod");
  if (!period) return;
  period.dateTime = monthKey(date);
  period.textContent = monthLabel.format(date);
}
function renderKpis() {
  const host = qs("paymentKpis");
  if (!host) return;
  const now = new Date(), currentMonth = monthKey(now), previousMonth = previousMonthKey(now);
  updateSummaryPeriod(now);
  const currentRows = metricRows(paymentsCache, currentMonth);
  const previousRows = metricRows(paymentsCache, previousMonth);
  const currentVoided = paymentsCache.filter((p) => p.is_voided && String(p.paid_on || "").slice(0, 7) === currentMonth);
  const previousVoided = paymentsCache.filter((p) => p.is_voided && String(p.paid_on || "").slice(0, 7) === previousMonth);
  const sum = (rows, field) => rows.reduce((total, row) => total + Number(row[field] || 0), 0);
  const uniqueInterestClients = new Set(currentRows.filter((p) => Number(p.applied_interest || 0) > 0).map((p) => p.borrower_id)).size;
  const metrics = [
    { tone: "purple", icon: "dollar", label: "Pagado este mes", value: sum(currentRows, "amount"), sub: `${currentRows.length} ${currentRows.length === 1 ? "pago" : "pagos"}`, previous: sum(previousRows, "amount") },
    { tone: "lime", icon: "percent", label: "Cuota / interés", value: sum(currentRows, "applied_interest"), sub: `${uniqueInterestClients} ${uniqueInterestClients === 1 ? "cliente" : "clientes"}`, previous: sum(previousRows, "applied_interest") },
    { tone: "blue", icon: "capital", label: "Capital recuperado", value: sum(currentRows, "applied_principal"), sub: "Total aplicado", previous: sum(previousRows, "applied_principal") },
    { tone: "coral", icon: "voided", label: "Pagos anulados", value: sum(currentVoided, "amount"), sub: `${currentVoided.length} ${currentVoided.length === 1 ? "pago" : "pagos"}`, previous: sum(previousVoided, "amount") },
  ];
  setStableMarkup(host, metrics.map((metric) => `<article class="ll-payment-kpi ${metric.tone}"><div class="ll-payment-kpi-main"><div class="ll-payment-kpi-icon">${svg(metric.icon, 19)}</div><div class="ll-payment-kpi-copy"><span>${metric.label}</span><strong>${money(metric.value)}</strong><small>${metric.sub}</small></div></div>${metricTrend(metric.value, metric.previous)}</article>`).join(""));
}

function setStatusFilter(next) {
  statusFilter = next;
  localStorage.setItem("loanLedger.paymentFilter", next);
  pageNumber = 1;
  renderPayments();
}
function historyPeriod() {
  const now = new Date();
  switch (qs("payFilterPeriod")?.value) {
    case "month": return { prefix: monthKey(now), label: "este mes" };
    case "previous": return { prefix: previousMonthKey(now), label: "el mes anterior" };
    case "year": return { prefix: `${now.getFullYear()}-`, label: "este año" };
    default: return { prefix: "", label: "" };
  }
}
function filteredPayments(periodRows) {
  const borrowerId = qs("payFilterBorrower")?.value || "";
  const typeFilter = qs("payFilterType")?.value || "";
  const term = String(qs("paySearch")?.value || "").trim().toLowerCase();
  return periodRows.filter((p) => {
    if (statusFilter === "active" && p.is_voided) return false;
    if (statusFilter === "voided" && !p.is_voided) return false;
    if (borrowerId && String(p.borrower_id) !== String(borrowerId)) return false;
    if (typeFilter && p.payment_type !== typeFilter) return false;
    if (term) {
      const haystack = [p.borrower_name, p.paid_on, p.amount, p.payment_type, p.notes, p.void_reason].map((value) => String(value || "").toLowerCase()).join(" ");
      if (!haystack.includes(term)) return false;
    }
    return true;
  });
}
function emptyPaymentHistory(period, periodRows) {
  if (!paymentsCache.length) return '<div class="ll-payment-empty"><p>Aún no hay pagos registrados.</p></div>';
  const hasPeriod = !!period.label && !periodRows.length;
  return `<div class="ll-payment-empty"><p>${hasPeriod ? `No hay pagos para ${period.label}.` : "No hay pagos que coincidan con estos filtros."}</p>
    <button class="ll-payment-empty-action" type="button" data-payment-empty-action="${hasPeriod ? "all-periods" : "reset"}">${hasPeriod ? "Ver todos los periodos" : "Limpiar filtros"}</button></div>`;
}
function renderPayments() {
  const host = qs("accountPaymentList");
  if (!host) return;
  document.querySelectorAll("[data-status-filter]").forEach((button) => button.classList.toggle("active", button.dataset.statusFilter === statusFilter));
  if (!lastRefreshAt) return;
  const period = historyPeriod();
  const periodRows = period.prefix ? paymentsCache.filter((p) => p.paid_on?.startsWith(period.prefix)) : paymentsCache;
  const rows = filteredPayments(periodRows);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  if (pageNumber > totalPages) pageNumber = totalPages;
  const start = (pageNumber - 1) * PAGE_SIZE;
  const visible = rows.slice(start, start + PAGE_SIZE);
  setStableMarkup(host, visible.length ? visible.map(paymentRowHtml).join("") : emptyPaymentHistory(period, periodRows));
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

function mountPaymentPanel(html, label, mode, detailId = null) {
  const panel = openFloatingPanel({label,html:`<div id="paymentDrawer">${html}</div>`,canClose:()=>!paymentSaving,
    onClose:()=>{drawerMode='closed';activeDetailId=null;paymentPanel=null;}});
  if(!panel)return null;
  paymentPanel=panel;drawerMode=mode;activeDetailId=detailId;
  const root=qs('paymentDrawer');
  root.addEventListener('click',handleWorkspaceClick);
  root.addEventListener('change',handleWorkspaceChange);
  root.addEventListener('input',handleWorkspaceInput);
  root.addEventListener('loan-ledger:payment-target-changed',updatePaymentPreview);
  return panel;
}
export async function openRegisterDrawer({borrowerId = '', accounts = null} = {}) {
  if(paymentSaving)return;
  const panel=mountPaymentPanel(registerDrawerHtml(),'Registrar pago','register');
  if(!panel)return;
  if(accounts&&!accountsCache.length)accountsCache=accounts;
  if(accountsCache.length){populatePaymentBorrowers();if(borrowerId)qs('acctPaymentBorrower').value=borrowerId;updateBorrowerContext();}
  try{
    const result=await readPaymentAccounts();
    if(!panel.isCurrent())return;
    if(result.error)throw result.error;
    accountsCache=result.data||[];populatePaymentBorrowers();
    if(borrowerId)qs('acctPaymentBorrower').value=borrowerId;
    updateBorrowerContext();
  }catch(error){if(panel.isCurrent())qs('acctPagePaymentStatus').textContent=error.message||'No se pudieron consultar los clientes.';}
}
function registerDrawerHtml() {
  return `<div class="ll-payment-drawer-inner">
    <header class="ll-payment-drawer-head"><div><h2>Registrar pago</h2><p>Aplica el pago a la cuenta completa del cliente.</p></div><button type="button" data-close-payment-drawer aria-label="Cerrar">${svg("close", 17)}</button></header>
    <div class="ll-payment-drawer-scroll">
      <label class="ll-payment-field"><span>Cliente</span><select id="acctPaymentBorrower"><option value="">Cargando clientes...</option></select></label>
      <div id="paymentBorrowerContext" class="ll-payment-borrower-context is-empty"><div class="ll-context-placeholder">Selecciona un cliente para ver el estado de su cuenta.</div></div>
      <div class="ll-payment-form-two">
        <label class="ll-payment-field"><span>Fecha</span><input id="acctPagePaidOn" type="date" value="${todayIso()}" /></label>
        <label class="ll-payment-field"><span>Monto</span><div class="ll-payment-money-input"><input id="acctPageAmount" type="number" min="0.01" step="0.01" placeholder="0" /><b>$</b></div></label>
      </div>
      <div class="ll-payment-quick-block"><span>Sugerencias rápidas</span><div id="paymentQuickAmounts" class="ll-payment-quick-buttons"><button type="button" data-quick-payment="half" disabled>½ cuota</button><button type="button" data-quick-payment="one" disabled>1 cuota</button><button type="button" data-quick-payment="two" disabled>2 cuotas</button><button type="button" data-quick-payment="payoff" disabled>Saldar</button></div></div>
      <label class="ll-payment-field"><span>Tipo de pago</span><select id="acctPageType"><option value="INSTALLMENT">Pago de cuota / interés</option><option value="PRINCIPAL">Abono directo a capital</option><option value="MIXED">Mixto: cuota + abono al capital</option><option value="PAYOFF">Saldar capital</option></select></label>
      ${mixedPaymentMarkup('acctMixed')}
      ${paymentCalendarMarkup('acctPaymentCalendar')}
      ${paymentDistributionMarkup()}
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
function paymentsMixedSplit(){
  const host=qs('paymentDrawer')?.querySelector('[data-mixed-payment]');
  return attachMixedPaymentSplit(host,{
    readPayment:()=>({...paymentDraft(),targeted:(qs('paymentDrawer')?.querySelector('[data-pcal-target]')?.value||'oldest')!=='oldest'}),
    loadContext:async(borrowerId,paidOn)=>{
      const {data,error}=await supabase.rpc('get_borrower_mixed_payment_context',{p_borrower_id:borrowerId,p_paid_on:paidOn});
      if(error)throw error;return data;
    }
  });
}
function paymentDraft(){
  return {borrowerId:qs('acctPaymentBorrower')?.value,paidOn:qs('acctPagePaidOn')?.value,
    amount:Number(qs('acctPageAmount')?.value||0),type:qs('acctPageType')?.value,
    installment:Number(qs('acctMixedInstallment')?.value||0)};
}
function paymentsDistribution(){
  return attachPaymentDistribution(qs('paymentDrawer')?.querySelector('[data-payment-distribution]'),{db:supabase,readPayment:paymentDraft});
}
function paymentsCalendar(){
  return attachPaymentCalendar(qs('paymentDrawer')?.querySelector('[data-payment-calendar]'),{
    readPayment:paymentDraft,
    loadCalendar:async(borrowerId,paidOn,force)=>{
      const end=paymentCalendarEnd(paidOn);
      const {data,error}=await readPageQuery(`payment-calendar:${borrowerId}:${end}`,()=>supabase.rpc('get_borrower_calendar_workspace',
        {p_borrower_id:borrowerId,p_end_date:end}),{force,ttl:45000});
      if(error)throw error;if(!data)throw new Error('No se pudo consultar el calendario.');return data;
    }
  });
}
async function updatePaymentPreview(){
  const panel=paymentPanel;
  paymentsDistribution()?.refresh();
  await paymentsMixedSplit()?.refresh();
  if(panel?.isCurrent()&&drawerMode==='register')paymentsCalendar()?.refresh();
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
    updatePaymentPreview();
    return;
  }
  host.className = "ll-payment-borrower-context";
  host.innerHTML = `<div class="ll-context-client"><span>${esc(initials(account.full_name))}</span><div><strong>${esc(account.full_name || "Cliente")}</strong><small>${esc(accountStatus(account.account_status))}</small></div></div><div class="ll-context-stats"><div><strong>${money(account.principal_balance)}</strong><small>Balance actual</small></div><div><strong>${money(account.current_cycle_fee)}</strong><small>Cuota por ciclo</small></div><div><strong>${esc(fmtDate(account.next_due_date))}</strong><small>Próxima fecha</small></div><div class="${Number(account.overdue_amount || 0) > 0 ? "danger" : ""}"><strong>${money(account.overdue_amount)}</strong><small>Atrasado</small></div></div>`;
  const fee = Number(account.current_cycle_fee || 0), balance = Number(account.principal_balance || 0);
  const values = { half: fee / 2, one: fee, two: fee * 2, payoff: balance };
  buttons.forEach((button) => { const amount = values[button.dataset.quickPayment] || 0; button.disabled = amount <= 0; button.dataset.amount = String(Number(Number(amount).toFixed(2))); });
  updatePaymentPreview();
}
function applyQuickAmount(kind, amount) {
  const input = qs("acctPageAmount");
  const type = qs("acctPageType");
  if (input) input.value = String(Number(Number(amount || 0).toFixed(2)));
  if (type) type.value = kind === "payoff" ? "PAYOFF" : "INSTALLMENT";
  document.querySelectorAll("[data-quick-payment]").forEach((button) => button.classList.toggle("active", button.dataset.quickPayment === kind));
  updatePaymentPreview();
}

async function applyAccountPayment() {
  if(paymentSaving)return;
  const submittedPanel=paymentPanel;
  const borrowerId = qs("acctPaymentBorrower")?.value;
  const paidOn = qs("acctPagePaidOn")?.value;
  const amount = Number(qs("acctPageAmount")?.value || 0);
  const paymentType = qs("acctPageType")?.value || "INSTALLMENT";
  const notes = qs("acctPageNotes")?.value?.trim() || null;
  const status = qs("acctPagePaymentStatus");
  const submit = qs("acctPageApplyPayment");
  if (!borrowerId || !paidOn || !amount) { if (status) status.textContent = "Cliente, fecha y monto son requeridos."; return; }
  paymentSaving=true;if (submit) submit.disabled = true;
  if (status) { status.textContent = "Aplicando pago..."; status.className = "ll-payment-form-status"; }
  try {
    const parts=paymentType==='MIXED'?await paymentsMixedSplit().values():null;
    const installment=parts?.installment??(paymentType==='INSTALLMENT'?amount:0);
    const dueDates=await paymentsCalendar()?.values(installment)??null;
    const partnerSplit=await paymentsDistribution()?.values(installment)??null;
    const draft=paymentDraft();
    if(!submittedPanel?.isCurrent())return;
    if(draft.borrowerId!==borrowerId||draft.paidOn!==paidOn||draft.amount!==amount||draft.type!==paymentType||
      (parts&&draft.installment!==installment))throw new Error('El pago cambió. Revisa los datos y vuelve a guardarlo.');
    const { error } = await supabase.rpc('record_borrower_payment',{
      p_borrower_id:borrowerId,p_paid_on:paidOn,p_amount:amount,p_payment_type:paymentType,p_notes:notes,
      p_installment_amount:parts?.installment??null,p_principal_amount:parts?.principal??null,
      p_due_dates:dueDates,p_partner_split:partnerSplit});
    if (error) throw error;
    if (status) { status.textContent = "Pago registrado correctamente."; status.classList.add("success"); }
    invalidatePageReads();
    window.dispatchEvent(new CustomEvent('loan-ledger:account-changed',{detail:{borrowerId}}));
    await refreshData(true);
    setTimeout(() => { if (submittedPanel?.isCurrent() && drawerMode === "register") closeDrawer(); }, 650);
  } catch (error) {
    if (status) { status.textContent = error.message || String(error); status.classList.add("error"); }
  } finally { paymentSaving=false;if (submit) submit.disabled = false; }
}

export async function openPaymentDetails(paymentId, record = null) {
  if(paymentSaving)return;
  const cached=record&&Array.isArray(record.due_applications)&&Array.isArray(record.principal_applications)&&Array.isArray(record.allocations);
  const initial=cached?detailDrawerHtml(record,record.due_applications.map(row=>({...row,borrower_due_events:{due_date:row.due_date,status:row.status}})),record.principal_applications,record.allocations):`<div class="ll-payment-drawer-inner"><header class="ll-payment-drawer-head"><div><h2>Detalle del pago</h2><p>${record?esc(fmtDate(record.paid_on)):'Desglose y aplicaciones del movimiento.'}</p></div><button type="button" data-close-payment-drawer aria-label="Cerrar">${svg("close", 17)}</button></header><div class="ll-payment-detail-loading">Consultando aplicaciones del pago…</div></div>`;
  const panel=mountPaymentPanel(initial,'Detalle del pago','detail',paymentId);
  if(!panel||cached)return;
  const drawer=qs('paymentDrawer');
  try {
    const [paymentRes, dueRes, principalRes, allocRes, legacyRes] = await Promise.all([
      supabase.from("borrower_account_payments_view").select("*").eq("id", paymentId).single(),
      supabase.from("payment_borrower_due_applications").select("applied_total, applied_mgmt, applied_funders, borrower_due_event_id, borrower_due_events(due_date,status)").eq("payment_id", paymentId),
      supabase.from("payment_principal_applications").select("amount, loan_id").eq("payment_id", paymentId),
      supabase.from("partner_allocation_details").select("partner_name, allocation_type, amount, is_voided").eq("payment_id", paymentId),
      supabase.from("payment_due_applications").select("applied_total, applied_mgmt, applied_funders, loan_due_events(due_date,status)").eq("payment_id", paymentId),
    ]);
    for(const result of [paymentRes,dueRes,principalRes,allocRes,legacyRes])if(result.error)throw result.error;
    if (!panel.isCurrent() || activeDetailId !== paymentId) return;
    const dues=[...(dueRes.data||[]),...(legacyRes.data||[]).map(row=>({...row,borrower_due_events:row.loan_due_events}))].sort((a,b)=>String(a.borrower_due_events?.due_date).localeCompare(String(b.borrower_due_events?.due_date)));
    const principals=principalRes.data?.length?principalRes.data:Number(paymentRes.data.applied_principal)>0?[{loan_id:paymentRes.data.loan_id,amount:paymentRes.data.applied_principal}]:[];
    drawer.innerHTML = detailDrawerHtml(paymentRes.data, dues, principals, allocRes.data || []);
  } catch (error) {
    if (panel.isCurrent()) drawer.innerHTML = `<div class="ll-payment-drawer-inner"><header class="ll-payment-drawer-head"><div><h2>Detalle del pago</h2></div><button type="button" data-close-payment-drawer aria-label="Cerrar">${svg("close", 17)}</button></header><div class="ll-payment-detail-loading error">${esc(error.message || error)}</div></div>`;
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
      <section class="ll-payment-detail-section"><h3>Cuotas afectadas</h3>${dues.length ? dues.map((row) => `<div class="ll-detail-line"><span><strong>${esc(fmtDate(row.borrower_due_events?.due_date))}</strong><small>Monto aplicado a esta cuota</small></span><b>${money(row.applied_total)}</b></div>`).join("") : `<p class="ll-detail-empty">No afectó cuotas.</p>`}</section>
      <section class="ll-payment-detail-section"><h3>Capital afectado</h3>${principals.length ? principals.map((row) => `<div class="ll-detail-line"><span><strong>Abono a capital</strong><small>Desembolso ${esc(String(row.loan_id || "").slice(0, 8))}…</small></span><b>${money(row.amount)}</b></div>`).join("") : `<p class="ll-detail-empty">No afectó capital.</p>`}</section>
      <section class="ll-payment-detail-section"><h3>Distribuciones</h3>${allocs.length ? allocs.map((row) => `<div class="ll-detail-line"><span><strong>${esc(row.partner_name || "Socio")}</strong><small>${String(row.allocation_type).includes('MANAGEMENT')?'Administración':'Ingreso de socio'}${row.is_voided ? " · ANULADO" : ""}</small></span><b>${money(row.amount)}</b></div>`).join("") : `<p class="ll-detail-empty">No hay distribuciones.</p>`}</section>
      <div id="paymentActionStatus" class="ll-payment-form-status"></div>
    </div>
    <footer class="ll-payment-drawer-foot ll-detail-foot"><button id="btnVoidPaymentDetail" type="button" class="ll-payment-danger-btn" ${voided ? "disabled" : ""}>${voided ? "Pago anulado" : "Anular pago"}</button></footer>
  </div>`;
}
async function voidActivePayment() {
  if (!activeDetailId || paymentSaving) return;
  const status = qs("paymentActionStatus"), button=qs('btnVoidPaymentDetail'), panel=paymentPanel, paymentId=activeDetailId;
  if (!button || button.disabled) return;
  const reason = await choosePaymentVoidReason(button);
  if (!reason || !panel?.isCurrent() || activeDetailId !== paymentId) return;
  paymentSaving=true;if(button)button.disabled=true;
  let saved=false;
  try{
    if (status) status.textContent = "Anulando pago...";
    const { error } = await supabase.rpc("void_payment", { p_payment_id: paymentId, p_reason: reason });
    if (error) throw error;
    invalidatePageReads();
    window.dispatchEvent(new CustomEvent('loan-ledger:account-changed',{detail:{borrowerId:paymentsCache.find(row=>row.id===paymentId)?.borrower_id}}));
    await refreshData(true);saved=true;
  }catch(error){if(panel?.isCurrent()&&status){status.textContent=error.message||String(error);status.classList.add('error');}}
  finally{paymentSaving=false;if(button)button.disabled=false;}
  if(saved&&panel?.isCurrent())await openPaymentDetails(paymentId);
}

function closeDrawer(force=false) {
  if(paymentSaving&&!force)return;
  paymentPanel?.close(force);
}

function handleWorkspaceClick(event) {
  const target = event.target;
  if (target.closest("#llOpenPaymentDrawer")) { openRegisterDrawer(); return; }
  if (target.closest("[data-close-payment-drawer]") || target.closest("#paymentDrawerBackdrop")) { closeDrawer(); return; }
  const filter = target.closest("[data-status-filter]"); if (filter) { setStatusFilter(filter.dataset.statusFilter); return; }
  const emptyAction = target.closest("[data-payment-empty-action]");
  if (emptyAction) {
    qs("payFilterPeriod").value = "all";
    pageNumber = 1;
    if (emptyAction.dataset.paymentEmptyAction === "reset") {
      ["payFilterBorrower", "payFilterType", "paySearch"].forEach((id) => { qs(id).value = ""; });
      setStatusFilter("all");
    } else renderPayments();
    qs("payFilterPeriod").focus();
    return;
  }
  const row = target.closest("[data-account-payment-id]"); if (row) { openPaymentDetails(row.dataset.accountPaymentId); return; }
  const quick = target.closest("[data-quick-payment]"); if (quick && !quick.disabled) { applyQuickAmount(quick.dataset.quickPayment, quick.dataset.amount); return; }
  if (target.closest("#acctPageApplyPayment")) { applyAccountPayment(); return; }
  if (target.closest("#btnVoidPaymentDetail")) { voidActivePayment(); return; }
  if (target.closest('[data-split-reset]')) {updatePaymentPreview();return;}
  if (target.closest("#llPayPrev")) { pageNumber = Math.max(1, pageNumber - 1); renderPayments(); return; }
  if (target.closest("#llPayNext")) { pageNumber += 1; renderPayments(); return; }
}
function handleWorkspaceChange(event) {
  if (["payFilterBorrower", "payFilterPeriod", "payFilterType"].includes(event.target.id)) { pageNumber = 1; renderPayments(); }
  if (event.target.id === "acctPaymentBorrower") updateBorrowerContext();
  if(['acctPageType','acctPagePaidOn'].includes(event.target.id))updatePaymentPreview();
}
function handleWorkspaceInput(event) {
  if(event.target.id==='acctPageAmount'||event.target.matches('[data-split-part]'))updatePaymentPreview();
  if (event.target.id === "paySearch") { pageNumber = 1; renderPayments(); }
}

window.addEventListener(CLIENT_CHANGED,event=>{
  const client=event.detail?.client;
  if(!client)return;
  accountsCache=mergeClientAccount(accountsCache,client);
  populateFilterBorrowers();
  if(drawerMode==='register'){populatePaymentBorrowers();updateBorrowerContext();}
});
watchPage('paymentsPage', () => refreshData(false), {interval:45000, prefetch:() => readPaymentData(false), reset:() => {
  requestSequence++;accountsCache=[];paymentsCache=[];lastRefreshAt=0;pageNumber=1;
  closeDrawer(true);
  closeFloatingPanel(true);
  setStableMarkup(qs('paymentKpis'), ['Pagado este mes','Cuota / interés','Capital recuperado','Pagos anulados'].map(kpiSkeleton).join(''));
  setStableMarkup(qs('accountPaymentList'), '<div class="ll-payment-loading">Cargando pagos...</div>');
  setStableMarkup(qs('payFilterBorrower'),'<option value="">Todos los clientes</option>');
  ['payFilterType','paySearch'].forEach(id=>{if(qs(id))qs(id).value='';});
  if(qs('payFilterPeriod'))qs('payFilterPeriod').value='all';
  if(qs('paymentResultCount'))qs('paymentResultCount').textContent='—';
}});
ensurePaymentsDom();

console.log("modern payments workspace active");
