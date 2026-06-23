import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(
  "https://eatxkhhpjruwwibhcubf.supabase.co",
  "sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
      storageKey: "loan-ledger-auth",
    },
  }
);

let currentBorrowerId = null;
let historyBusy = false;
let lastHistoryKey = "";

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

function typeLabel(type) {
  return {
    INSTALLMENT: "Cuota/interés",
    PRINCIPAL: "Abono a capital",
    MIXED: "Mixto",
    PAYOFF: "Saldar capital",
  }[type] || type || "—";
}

function rememberBorrowerFromCard(card) {
  if (!card) return;
  currentBorrowerId = card.dataset.acctBorrower || currentBorrowerId;
  lastHistoryKey = "";
}

function accountPageActive() {
  return document.getElementById("borrowerAccountPage")?.classList.contains("active-page");
}

function findPaymentHistoryCard() {
  const content = document.getElementById("borrowerAccountContent");
  if (!content) return null;

  return Array.from(content.querySelectorAll(".card")).find((card) => {
    const title = card.querySelector("div[style*='font-weight:800']")?.textContent?.trim() || "";
    return title === "Historial de pagos" || title === "Payment History";
  });
}

function paymentHtml(payment) {
  const voided = payment.is_voided;
  const badge = voided
    ? "<span class='acct-pill acct-danger'>ANULADO</span>"
    : "<span class='acct-pill acct-ok'>ACTIVO</span>";

  const voidBtn = voided
    ? ""
    : `<button type="button" class="acctVoidPaymentBtn" data-payment-id="${payment.id}" style="background:#7a2b2b;margin-top:10px;">Anular pago</button>`;

  return `
    <div class="compact-card" style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;box-sizing:border-box;">
      <strong>${payment.paid_on}</strong> — ${money(payment.amount)} <span class="acct-pill">${typeLabel(payment.payment_type)}</span> ${badge}<br>
      Cuota/interés: ${money(payment.applied_interest)} | Capital: ${money(payment.applied_principal)}<br>
      Administración: ${money(payment.applied_mgmt)} | Socios: ${money(payment.applied_funders)}
      ${payment.notes ? `<br><span class="muted">${payment.notes}</span>` : ""}
      ${payment.is_voided && payment.void_reason ? `<br><span class="muted">Motivo anulación: ${payment.void_reason}</span>` : ""}
      ${voidBtn}
    </div>
  `;
}

async function renderPaymentHistory(force = false) {
  if (!accountPageActive() || !currentBorrowerId || historyBusy) return;

  const historyCard = findPaymentHistoryCard();
  if (!historyCard) return;

  historyBusy = true;
  try {
    const { data, error } = await db
      .from("borrower_account_payments_view")
      .select("*")
      .eq("borrower_id", currentBorrowerId)
      .order("paid_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(80);

    if (error) throw error;

    const key = JSON.stringify((data || []).map((p) => [
      p.id,
      p.amount,
      p.applied_interest,
      p.applied_principal,
      p.is_voided,
      p.void_reason,
      p.payment_type,
    ]));

    if (!force && key === lastHistoryKey && historyCard.dataset.voidEnhanced === "true") return;

    lastHistoryKey = key;
    historyCard.dataset.voidEnhanced = "true";
    historyCard.setAttribute("data-no-translate", "true");
    historyCard.innerHTML = `
      <div style="font-weight:800">Historial de pagos</div>
      ${(data || []).length ? (data || []).map(paymentHtml).join("") : "No hay pagos."}
    `;
  } catch (error) {
    console.error(error);
  } finally {
    historyBusy = false;
  }
}

async function voidPayment(paymentId) {
  const reason = prompt("Motivo de anulación (opcional):") || null;
  const ok = confirm("¿Seguro que quieres anular este pago? Esto va a revertir cuotas/capital y distribuciones.");
  if (!ok) return;

  const { error } = await db.rpc("void_payment", {
    p_payment_id: paymentId,
    p_reason: reason,
  });

  if (error) return alert(error.message);

  alert("Pago anulado y revertido.");
  lastHistoryKey = "";
  window.dispatchEvent(new CustomEvent("loan-ledger:open-account", { detail: { borrowerId: currentBorrowerId } }));
  setTimeout(() => renderPaymentHistory(true), 900);
}

document.addEventListener(
  "click",
  (event) => {
    const borrowerCard = event.target.closest?.("[data-acct-borrower]");
    if (borrowerCard) {
      rememberBorrowerFromCard(borrowerCard);
      setTimeout(() => renderPaymentHistory(true), 900);
      setTimeout(() => renderPaymentHistory(true), 1600);
      return;
    }

    const voidBtn = event.target.closest?.(".acctVoidPaymentBtn");
    if (voidBtn) {
      event.preventDefault();
      event.stopPropagation();
      voidPayment(voidBtn.dataset.paymentId);
    }
  },
  true
);

window.addEventListener("loan-ledger:open-account", (event) => {
  if (event.detail?.borrowerId) {
    currentBorrowerId = event.detail.borrowerId;
    lastHistoryKey = "";
  }
  setTimeout(() => renderPaymentHistory(true), 900);
});

setInterval(() => {
  renderPaymentHistory(false);
}, 1500);

console.log("account payment void controls active");
