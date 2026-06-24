import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient("https://eatxkhhpjruwwibhcubf.supabase.co", "sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage, storageKey: "loan-ledger-auth" },
});

let currentBorrowerId = null;
let historyBusy = false;
let calendarBusy = false;
let calendarOffset = 0;
let selectedDueIso = null;
let lastHistoryKey = "";
let lastCalendarKey = "";
let newDisbursementFunding = [];

const byId = (id) => document.getElementById(id);
const money = (n) => `$${Number(n || 0).toFixed(2)}`;

function accountPageActive() { return byId("borrowerAccountPage")?.classList.contains("active-page"); }
function typeLabel(type) { return { INSTALLMENT: "Cuota/interés", PRINCIPAL: "Abono a capital", MIXED: "Mixto", PAYOFF: "Saldar capital" }[type] || type || "—"; }
async function currentUserId() { const { data, error } = await db.auth.getUser(); if (error) throw error; return data.user?.id; }

function rememberBorrower(card) {
  if (!card) return;
  currentBorrowerId = card.dataset.acctBorrower || currentBorrowerId;
  lastHistoryKey = "";
  lastCalendarKey = "";
  calendarOffset = 0;
  selectedDueIso = null;
}

function findCardByTitle(titles) {
  const content = byId("borrowerAccountContent");
  if (!content) return null;
  return Array.from(content.querySelectorAll(".card")).find((card) => {
    const title = card.querySelector("div[style*='font-weight:800']")?.textContent?.trim() || "";
    return titles.includes(title);
  });
}

function hideManualGenerationUi() {
  const maintenance = findCardByTitle(["Mantenimiento de cuotas", "Due Schedule Maintenance"]);
  if (maintenance) maintenance.style.display = "none";
  const quick = byId("quickGenerateDue");
  if (quick) quick.style.display = "none";
}

function ensureCalendarStyle() {
  if (byId("dueCalendarStyle")) return;
  const style = document.createElement("style");
  style.id = "dueCalendarStyle";
  style.textContent = `
    .due-cal-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;}
    .due-cal-month{font-weight:800;font-size:18px;}
    .due-cal-nav{width:auto;background:#333;border-radius:999px;padding:8px 12px;margin:0;}
    .due-cal-strip{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;align-items:stretch;}
    .due-cal-day{background:#fff;color:#16161a;border:1px solid #2a2a2e;border-radius:999px;padding:10px 6px;text-align:center;cursor:pointer;min-height:58px;box-sizing:border-box;}
    .due-cal-day:hover{filter:brightness(.95);}
    .due-cal-day.selected{background:#7b5cff;color:white;border-color:#7b5cff;box-shadow:0 8px 22px rgba(123,92,255,.35);}
    .due-cal-dow{font-size:12px;font-weight:700;opacity:.75;}
    .due-cal-num{font-size:20px;font-weight:900;line-height:1.15;}
    .due-cal-detail{background:#7b5cff;color:white;border-radius:18px;padding:14px;margin-top:12px;box-shadow:0 10px 24px rgba(123,92,255,.25);}
    .due-cal-detail .muted{color:rgba(255,255,255,.78);}
    @media(max-width:650px){.due-cal-strip{grid-template-columns:repeat(3,1fr)}.due-cal-day{border-radius:22px}}
  `;
  document.head.appendChild(style);
}

function parseIso(iso) { const [y, m, d] = String(iso).split("-").map(Number); return new Date(y, m - 1, d); }
function toIso(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
function addMonths(date, months) { return new Date(date.getFullYear(), date.getMonth() + months, 1); }
function lastDay(year, monthIndex) { return new Date(year, monthIndex + 1, 0).getDate(); }
function paymentDatesAround(baseDate, before = 18, after = 24) {
  const dates = [];
  for (let dt = addMonths(baseDate, -before); dt <= addMonths(baseDate, after); dt = addMonths(dt, 1)) {
    dates.push(new Date(dt.getFullYear(), dt.getMonth(), 15));
    dates.push(new Date(dt.getFullYear(), dt.getMonth(), lastDay(dt.getFullYear(), dt.getMonth())));
  }
  return dates.sort((a, b) => a - b);
}
function nextPaymentIso(from = new Date()) {
  const today = parseIso(toIso(from));
  return toIso(paymentDatesAround(from, 1, 3).find((d) => d >= today) || from);
}
function visibleDates() {
  const all = paymentDatesAround(new Date());
  const baseIso = selectedDueIso || nextPaymentIso(new Date());
  const baseIndex = Math.max(0, all.findIndex((d) => toIso(d) === baseIso));
  let start = baseIndex - 2 + calendarOffset;
  start = Math.max(0, Math.min(start, Math.max(0, all.length - 6)));
  return all.slice(start, start + 6);
}
function weekdayLabel(date) { return ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"][date.getDay()]; }
function monthTitle(dates) {
  const fmt = new Intl.DateTimeFormat("es", { month: "long", year: "numeric" });
  const cap = (s) => s.replace(/^./, (c) => c.toUpperCase());
  const first = cap(fmt.format(dates[0]));
  const last = cap(fmt.format(dates[dates.length - 1]));
  return first === last ? first : `${first} – ${last}`;
}
function statusEs(row) {
  if (row?.timing_status === "PAID" || row?.status === "PAID") return "PAGADA";
  if (row?.status === "PARTIAL") return "PARCIAL";
  if (row?.timing_status === "OVERDUE") return "ATRASADA";
  if (row?.timing_status === "DUE_TODAY") return "VENCE HOY";
  if (row?.timing_status === "CANCELLED" || row?.status === "CANCELLED") return "CANCELADA";
  return "PENDIENTE";
}
function detailHtml(date, row) {
  const expected = Number(row?.expected_total || 0);
  const paid = Number(row?.paid_total || 0);
  const remaining = Number(row?.amount_due ?? Math.max(0, expected - paid));
  const principal = Number(row?.principal_snapshot || 0);
  const pretty = date.toLocaleDateString("es", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).replace(/^./, (c) => c.toUpperCase());
  return `<div class="due-cal-detail" data-no-translate="true"><div style="font-weight:900;font-size:18px;">${pretty}</div><div class="muted" style="margin-top:4px;">Estado: ${statusEs(row)}</div><div style="margin-top:10px;">Cuota por ciclo: <strong>${money(expected)}</strong><br>Pagado: ${money(paid)} | Pendiente: <strong>${money(remaining)}</strong><br>Capital base: ${money(principal)}${row?.is_virtual ? `<br><span class="muted">Fecha calculada automáticamente</span>` : ""}</div></div>`;
}

async function renderDueCalendar(force = false) {
  if (!accountPageActive() || !currentBorrowerId || calendarBusy) return;
  const dueCard = findCardByTitle(["Calendario de cuotas de la cuenta", "Due Schedule", "Calendario de cuotas"]);
  if (!dueCard) return;
  calendarBusy = true;
  try {
    ensureCalendarStyle();
    hideManualGenerationUi();
    const dates = visibleDates();
    if (!selectedDueIso) selectedDueIso = nextPaymentIso(new Date());
    if (!dates.some((d) => toIso(d) === selectedDueIso)) selectedDueIso = toIso(dates[2] || dates[0]);
    const startIso = toIso(dates[0]);
    const endIso = toIso(dates[dates.length - 1]);
    const { data, error } = await db.rpc("get_borrower_due_calendar", { p_borrower_id: currentBorrowerId, p_start_date: startIso, p_end_date: endIso });
    if (error) throw error;
    const rows = new Map((data || []).map((r) => [r.due_date, r]));
    const selectedDate = parseIso(selectedDueIso);
    const selectedRow = rows.get(selectedDueIso) || { due_date: selectedDueIso, expected_total: 0, paid_total: 0, amount_due: 0, principal_snapshot: 0, timing_status: "UPCOMING", is_virtual: true };
    const key = JSON.stringify([currentBorrowerId, calendarOffset, selectedDueIso, data]);
    if (!force && key === lastCalendarKey && dueCard.dataset.virtualCalendar === "true") return;
    lastCalendarKey = key;
    dueCard.dataset.virtualCalendar = "true";
    dueCard.setAttribute("data-no-translate", "true");
    dueCard.innerHTML = `<div class="due-cal-head"><button id="dueCalPrev" type="button" class="due-cal-nav">‹</button><div><div style="font-weight:800;">Calendario de cuotas</div><div class="due-cal-month">${monthTitle(dates)}</div></div><button id="dueCalNext" type="button" class="due-cal-nav">›</button></div><div class="due-cal-strip">${dates.map((d) => { const iso = toIso(d); return `<button type="button" class="due-cal-day ${iso === selectedDueIso ? "selected" : ""}" data-due-iso="${iso}"><div class="due-cal-dow">${weekdayLabel(d)}</div><div class="due-cal-num">${d.getDate()}</div></button>`; }).join("")}</div>${detailHtml(selectedDate, selectedRow)}<div class="muted" style="margin-top:10px;">Las cuotas son los días 15 y último día de cada mes. Las fechas futuras se calculan automáticamente mientras haya capital pendiente.</div>`;
    byId("dueCalPrev").onclick = () => { calendarOffset -= 2; lastCalendarKey = ""; renderDueCalendar(true); };
    byId("dueCalNext").onclick = () => { calendarOffset += 2; lastCalendarKey = ""; renderDueCalendar(true); };
    dueCard.querySelectorAll("[data-due-iso]").forEach((btn) => btn.onclick = () => { selectedDueIso = btn.dataset.dueIso; lastCalendarKey = ""; renderDueCalendar(true); });
  } catch (error) { console.error(error); } finally { calendarBusy = false; }
}

function paymentHtml(payment) {
  const voided = payment.is_voided;
  const badge = voided ? "<span class='acct-pill acct-danger'>ANULADO</span>" : "<span class='acct-pill acct-ok'>ACTIVO</span>";
  const voidBtn = voided ? "" : `<button type="button" class="acctVoidPaymentBtn" data-payment-id="${payment.id}" style="background:#7a2b2b;margin-top:10px;">Anular pago</button>`;
  return `<div class="compact-card" style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;box-sizing:border-box;"><strong>${payment.paid_on}</strong> — ${money(payment.amount)} <span class="acct-pill">${typeLabel(payment.payment_type)}</span> ${badge}<br>Cuota/interés: ${money(payment.applied_interest)} | Capital: ${money(payment.applied_principal)}<br>Administración: ${money(payment.applied_mgmt)} | Socios: ${money(payment.applied_funders)}${payment.notes ? `<br><span class="muted">${payment.notes}</span>` : ""}${payment.is_voided && payment.void_reason ? `<br><span class="muted">Motivo anulación: ${payment.void_reason}</span>` : ""}${voidBtn}</div>`;
}
async function renderPaymentHistory(force = false) {
  if (!accountPageActive() || !currentBorrowerId || historyBusy) return;
  const historyCard = findCardByTitle(["Historial de pagos", "Payment History"]);
  if (!historyCard) return;
  historyBusy = true;
  try {
    const { data, error } = await db.from("borrower_account_payments_view").select("*").eq("borrower_id", currentBorrowerId).order("paid_on", { ascending: false }).order("created_at", { ascending: false }).limit(80);
    if (error) throw error;
    const key = JSON.stringify((data || []).map((p) => [p.id, p.amount, p.applied_interest, p.applied_principal, p.is_voided, p.void_reason, p.payment_type]));
    if (!force && key === lastHistoryKey && historyCard.dataset.voidEnhanced === "true") return;
    lastHistoryKey = key;
    historyCard.dataset.voidEnhanced = "true";
    historyCard.setAttribute("data-no-translate", "true");
    historyCard.innerHTML = `<div style="font-weight:800">Historial de pagos</div>${(data || []).length ? (data || []).map(paymentHtml).join("") : "No hay pagos."}`;
  } catch (error) { console.error(error); } finally { historyBusy = false; }
}
async function voidPayment(paymentId) {
  const reason = prompt("Motivo de anulación (opcional):") || null;
  if (!confirm("¿Seguro que quieres anular este pago? Esto va a revertir cuotas/capital y distribuciones.")) return;
  const { error } = await db.rpc("void_payment", { p_payment_id: paymentId, p_reason: reason });
  if (error) return alert(error.message);
  alert("Pago anulado y revertido.");
  lastHistoryKey = "";
  lastCalendarKey = "";
  window.dispatchEvent(new CustomEvent("loan-ledger:open-account", { detail: { borrowerId: currentBorrowerId } }));
}

function renderNewFundingList() {
  const el = byId("newLoanFundingList");
  if (!el) return;
  const total = newDisbursementFunding.reduce((s, r) => s + Number(r.funding_percent || 0), 0);
  el.innerHTML = newDisbursementFunding.length ? `${newDisbursementFunding.map(r => `<div style="margin:8px 0"><strong>${r.partner_name}</strong><br><span class="muted">${(r.funding_percent * 100).toFixed(2)}%</span></div>`).join("")}<div><strong>Total:</strong> ${(total * 100).toFixed(2)}%</div>` : "Sin distribución agregada todavía.";
}
function loadDefaultFundingFromDom() {
  if (newDisbursementFunding.length) return;
  const rows = Array.from(document.querySelectorAll("#defaultFundingList [data-partner-id]"));
  newDisbursementFunding = rows.map(row => ({ partner_user_id: row.dataset.partnerId, funding_percent: Number(row.dataset.percent || 0), partner_name: row.dataset.partnerName || "Socio" })).filter(r => r.partner_user_id && r.funding_percent > 0);
}
function addNewDisbursementFunding(event) {
  const btn = event.target.closest?.("#btnAddNewLoanFunding");
  if (!btn) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  const sel = byId("newLoanFundingPartner");
  const input = byId("newLoanFundingPercent");
  const partner_user_id = sel?.value;
  const pct = Number(input?.value || 0);
  if (!partner_user_id || !pct) return alert("Socio y porcentaje son requeridos.");
  const partner_name = sel.selectedOptions?.[0]?.textContent || "Socio";
  const funding_percent = pct / 100;
  const idx = newDisbursementFunding.findIndex(x => x.partner_user_id === partner_user_id);
  if (idx >= 0) newDisbursementFunding[idx] = { partner_user_id, funding_percent, partner_name };
  else newDisbursementFunding.push({ partner_user_id, funding_percent, partner_name });
  if (input) input.value = "";
  renderNewFundingList();
}
async function createVirtualDisbursement(event) {
  const btn = event.target.closest?.("#btnCreateLoan");
  if (!btn) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  try {
    let borrower_id = byId("loanBorrower")?.value;
    const newFields = byId("newBorrowerFields");
    const creatingNew = newFields && getComputedStyle(newFields).display !== "none";
    const created_by = await currentUserId();
    if (creatingNew) {
      const full_name = byId("newBorrowerName")?.value?.trim();
      if (!full_name) return alert("El nombre del cliente es requerido.");
      const { data, error } = await db.from("borrowers").insert({ full_name, phone: byId("newBorrowerPhone")?.value?.trim() || null, notes: byId("newBorrowerNotes")?.value?.trim() || null, created_by }).select("id").single();
      if (error) throw error;
      borrower_id = data.id;
    }
    const principal = Number(byId("principal")?.value || 0);
    const start_date = byId("startDate")?.value;
    const monthly_rate_total = Number(byId("loanTotalRate")?.value || 10) / 100;
    const monthly_rate_mgmt = Number(byId("loanMgmtRate")?.value || 3) / 100;
    if (!borrower_id || !principal || !start_date) return alert("Cliente, fecha y capital son requeridos.");
    if (monthly_rate_mgmt > monthly_rate_total) return alert("La administración no puede ser mayor que el interés total.");
    loadDefaultFundingFromDom();
    const fundingTotal = newDisbursementFunding.reduce((s, r) => s + Number(r.funding_percent || 0), 0);
    if (!newDisbursementFunding.length) return alert("Agrega la distribución de inversión antes de guardar el desembolso.");
    if (Math.abs(fundingTotal - 1) > 0.001) return alert("La distribución de inversión debe sumar 100%.");
    const { data: loan, error: loanErr } = await db.from("loans").insert({ borrower_id, created_by, start_date, principal_original: principal, principal_outstanding: principal, monthly_rate_total, monthly_rate_mgmt, status: "ACTIVE" }).select("id").single();
    if (loanErr) throw loanErr;
    const { error: fundErr } = await db.from("loan_funding").insert(newDisbursementFunding.map(r => ({ loan_id: loan.id, partner_user_id: r.partner_user_id, funding_percent: r.funding_percent })));
    if (fundErr) throw fundErr;
    ["principal", "startDate", "newBorrowerName", "newBorrowerPhone", "newBorrowerNotes"].forEach(id => { if (byId(id)) byId(id).value = ""; });
    if (newFields) newFields.style.display = "none";
    if (byId("btnToggleNewBorrower")) byId("btnToggleNewBorrower").textContent = "+ Nuevo cliente";
    newDisbursementFunding = [];
    renderNewFundingList();
    alert("Desembolso guardado. Las cuotas futuras se calcularán automáticamente.");
    window.location.reload();
  } catch (error) {
    console.error(error);
    alert(error.message || String(error));
  }
}

document.addEventListener("click", addNewDisbursementFunding, true);
document.addEventListener("click", createVirtualDisbursement, true);
document.addEventListener("click", (event) => {
  const borrowerCard = event.target.closest?.("[data-acct-borrower]");
  if (borrowerCard) {
    rememberBorrower(borrowerCard);
    setTimeout(() => renderPaymentHistory(true), 900);
    setTimeout(() => renderDueCalendar(true), 900);
    setTimeout(hideManualGenerationUi, 900);
    return;
  }
  const voidBtn = event.target.closest?.(".acctVoidPaymentBtn");
  if (voidBtn) { event.preventDefault(); event.stopPropagation(); voidPayment(voidBtn.dataset.paymentId); }
}, true);
window.addEventListener("loan-ledger:open-account", (event) => {
  if (event.detail?.borrowerId) {
    currentBorrowerId = event.detail.borrowerId;
    lastHistoryKey = "";
    lastCalendarKey = "";
    calendarOffset = 0;
    selectedDueIso = null;
  }
  setTimeout(() => renderPaymentHistory(true), 900);
  setTimeout(() => renderDueCalendar(true), 900);
  setTimeout(hideManualGenerationUi, 900);
});
setInterval(() => { hideManualGenerationUi(); renderPaymentHistory(false); renderDueCalendar(false); }, 1500);

console.log("virtual due calendar active; future due generation bypassed");
