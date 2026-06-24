import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient("https://eatxkhhpjruwwibhcubf.supabase.co", "sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage, storageKey: "loan-ledger-auth" },
});

let currentBorrowerId = null;
let historyBusy = false;
let lastHistoryKey = "";
let calendarBusy = false;
let calendarOffset = 0;
let selectedDueIso = null;
let lastCalendarKey = "";

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const byId = (id) => document.getElementById(id);

function accountPageActive() {
  return byId("borrowerAccountPage")?.classList.contains("active-page");
}

function rememberBorrower(card) {
  if (!card) return;
  currentBorrowerId = card.dataset.acctBorrower || currentBorrowerId;
  lastHistoryKey = "";
  lastCalendarKey = "";
  calendarOffset = 0;
  selectedDueIso = null;
}

function typeLabel(type) {
  return { INSTALLMENT: "Cuota/interés", PRINCIPAL: "Abono a capital", MIXED: "Mixto", PAYOFF: "Saldar capital" }[type] || type || "—";
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
  if (quick) {
    quick.style.display = "none";
    const status = byId("quickActionStatus");
    if (status && /Recalculando|cuotas futuras|created|recalculated/i.test(status.textContent || "")) status.textContent = "";
  }
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

function parseIso(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, m - 1, d);
}
function toIso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}
function lastDay(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}
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
  const all = paymentDatesAround(from, 1, 3);
  return toIso(all.find((d) => d >= today) || all[0]);
}
function visibleDates() {
  const now = new Date();
  const all = paymentDatesAround(now);
  const baseIso = selectedDueIso || nextPaymentIso(now);
  const baseIndex = Math.max(0, all.findIndex((d) => toIso(d) === baseIso));
  let start = baseIndex - 2 + calendarOffset;
  start = Math.max(0, Math.min(start, Math.max(0, all.length - 6)));
  return all.slice(start, start + 6);
}
function weekdayLabel(date) {
  return ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"][date.getDay()];
}
function monthTitle(dates) {
  const fmt = new Intl.DateTimeFormat("es", { month: "long", year: "numeric" });
  const cap = (s) => s.replace(/^./, (c) => c.toUpperCase());
  const first = cap(fmt.format(dates[0]));
  const last = cap(fmt.format(dates[dates.length - 1]));
  return first === last ? first : `${first} – ${last}`;
}
function timingStatus(iso, row) {
  if (row?.status === "PAID") return "PAGADA";
  if (row?.status === "PARTIAL") return "PARCIAL";
  const today = toIso(new Date());
  if (iso < today) return "ATRASADA";
  if (iso === today) return "VENCE HOY";
  return "PENDIENTE";
}
function detailHtml(date, row, summary) {
  const iso = toIso(date);
  const expected = row ? Number(row.expected_total || 0) : Number(summary?.current_cycle_fee || 0);
  const paid = row ? Number(row.paid_total || 0) : 0;
  const remaining = Math.max(0, expected - paid);
  const principal = row ? Number(row.principal_snapshot || 0) : Number(summary?.principal_balance || 0);
  const pretty = date.toLocaleDateString("es", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).replace(/^./, (c) => c.toUpperCase());
  return `<div class="due-cal-detail" data-no-translate="true"><div style="font-weight:900;font-size:18px;">${pretty}</div><div class="muted" style="margin-top:4px;">Estado: ${timingStatus(iso, row)}</div><div style="margin-top:10px;">Cuota por ciclo: <strong>${money(expected)}</strong><br>Pagado: ${money(paid)} | Pendiente: <strong>${money(remaining)}</strong><br>Capital base: ${money(principal)}</div></div>`;
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
    const [summaryRes, dueRes] = await Promise.all([
      db.from("borrower_account_summary").select("*").eq("borrower_id", currentBorrowerId).single(),
      db.from("borrower_due_events_view").select("*").eq("borrower_id", currentBorrowerId).gte("due_date", startIso).lte("due_date", endIso).order("due_date", { ascending: true }),
    ]);
    if (summaryRes.error) throw summaryRes.error;
    if (dueRes.error) throw dueRes.error;
    const rows = new Map((dueRes.data || []).map((r) => [r.due_date, r]));
    const selectedDate = parseIso(selectedDueIso);
    const selectedRow = rows.get(selectedDueIso);
    const key = JSON.stringify([currentBorrowerId, calendarOffset, selectedDueIso, summaryRes.data?.principal_balance, summaryRes.data?.current_cycle_fee, dueRes.data]);
    if (!force && key === lastCalendarKey && dueCard.dataset.virtualCalendar === "true") return;
    lastCalendarKey = key;
    dueCard.dataset.virtualCalendar = "true";
    dueCard.setAttribute("data-no-translate", "true");
    dueCard.innerHTML = `<div class="due-cal-head"><button id="dueCalPrev" type="button" class="due-cal-nav">‹</button><div><div style="font-weight:800;">Calendario de cuotas</div><div class="due-cal-month">${monthTitle(dates)}</div></div><button id="dueCalNext" type="button" class="due-cal-nav">›</button></div><div class="due-cal-strip">${dates.map((d) => { const iso = toIso(d); return `<button type="button" class="due-cal-day ${iso === selectedDueIso ? "selected" : ""}" data-due-iso="${iso}"><div class="due-cal-dow">${weekdayLabel(d)}</div><div class="due-cal-num">${d.getDate()}</div></button>`; }).join("")}</div>${detailHtml(selectedDate, selectedRow, summaryRes.data)}<div class="muted" style="margin-top:10px;">Las cuotas son los días 15 y último día de cada mes. Las fechas futuras se calculan automáticamente mientras haya capital pendiente.</div>`;
    byId("dueCalPrev").onclick = () => { calendarOffset -= 2; lastCalendarKey = ""; renderDueCalendar(true); };
    byId("dueCalNext").onclick = () => { calendarOffset += 2; lastCalendarKey = ""; renderDueCalendar(true); };
    dueCard.querySelectorAll("[data-due-iso]").forEach((btn) => btn.onclick = () => { selectedDueIso = btn.dataset.dueIso; lastCalendarKey = ""; renderDueCalendar(true); });
  } catch (error) {
    console.error(error);
  } finally {
    calendarBusy = false;
  }
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
  } catch (error) {
    console.error(error);
  } finally {
    historyBusy = false;
  }
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
  setTimeout(() => renderPaymentHistory(true), 900);
  setTimeout(() => renderDueCalendar(true), 900);
}

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
  if (voidBtn) {
    event.preventDefault();
    event.stopPropagation();
    voidPayment(voidBtn.dataset.paymentId);
  }
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

setInterval(() => {
  hideManualGenerationUi();
  renderPaymentHistory(false);
  renderDueCalendar(false);
}, 1500);

console.log("compact due calendar active; manual due generation UI hidden");
