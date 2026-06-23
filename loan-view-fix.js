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
let currentBorrowerName = "";
let renderTimer = null;

const today = () => new Date().toISOString().slice(0, 10);
const qs = (id) => document.getElementById(id);

function rememberFromCard(card) {
  if (!card) return;
  currentBorrowerId = card.dataset.acctBorrower || currentBorrowerId;
  const name = card.querySelector("strong")?.textContent?.trim();
  if (name) currentBorrowerName = name;
}

function ensureStablePaymentCard() {
  const page = qs("borrowerAccountPage");
  const content = qs("borrowerAccountContent");
  if (!page || !content || !currentBorrowerId) return;

  let card = qs("stableAccountPaymentCard");
  if (!card) {
    card = document.createElement("div");
    card.id = "stableAccountPaymentCard";
    card.className = "card";
    card.innerHTML = `
      <div style="font-weight:800">Registrar pago</div>
      <div class="muted" id="stablePayBorrowerName"></div>
      <div class="row">
        <input id="stablePayDate" type="date" />
        <input id="stablePayAmount" type="number" step="0.01" placeholder="Monto pagado" />
      </div>
      <select id="stablePayType">
        <option value="INSTALLMENT">Pago de cuota/interés</option>
        <option value="PRINCIPAL">Abono directo a capital</option>
        <option value="MIXED">Mixto: cuota y sobrante a capital</option>
        <option value="PAYOFF">Saldar capital</option>
      </select>
      <input id="stablePayNotes" placeholder="Notas del pago" />
      <button id="stablePayBtn" type="button">Aplicar pago</button>
      <div class="muted">Los pagos de cuota no rebajan capital.</div>
    `;
    page.insertBefore(card, content);
    qs("stablePayDate").value = today();
    qs("stablePayBtn").onclick = applyStablePayment;
  }

  const label = qs("stablePayBorrowerName");
  if (label) label.textContent = currentBorrowerName ? `Cliente: ${currentBorrowerName}` : "Cliente seleccionado";

  hideBuiltInPaymentCards();
}

function hideBuiltInPaymentCards() {
  const content = qs("borrowerAccountContent");
  if (!content) return;
  Array.from(content.querySelectorAll(".card")).forEach((card) => {
    const title = card.querySelector("div[style*='font-weight:800']")?.textContent?.trim();
    if (title === "Registrar pago") {
      card.style.display = "none";
    }
  });
}

async function applyStablePayment() {
  const amount = Number(qs("stablePayAmount")?.value || 0);
  const paid_on = qs("stablePayDate")?.value;
  const payment_type = qs("stablePayType")?.value || "INSTALLMENT";
  const notes = qs("stablePayNotes")?.value?.trim() || null;

  if (!currentBorrowerId) return alert("Abre un cliente primero.");
  if (!paid_on || !amount) return alert("Fecha y monto son requeridos.");

  const btn = qs("stablePayBtn");
  if (btn) btn.disabled = true;

  const { error } = await db.rpc("apply_borrower_payment", {
    p_borrower_id: currentBorrowerId,
    p_paid_on: paid_on,
    p_amount: amount,
    p_payment_type: payment_type,
    p_notes: notes,
  });

  if (btn) btn.disabled = false;

  if (error) return alert(error.message);

  qs("stablePayAmount").value = "";
  qs("stablePayNotes").value = "";
  alert("Pago aplicado.");
  window.location.reload();
}

document.addEventListener(
  "click",
  (event) => {
    const card = event.target.closest?.("[data-acct-borrower]");
    if (card) {
      rememberFromCard(card);
      setTimeout(ensureStablePaymentCard, 500);
      setTimeout(ensureStablePaymentCard, 1200);
    }
  },
  true
);

window.addEventListener("loan-ledger:open-account", (event) => {
  if (event.detail?.borrowerId) currentBorrowerId = event.detail.borrowerId;
  setTimeout(ensureStablePaymentCard, 500);
  setTimeout(ensureStablePaymentCard, 1200);
});

function tick() {
  if (qs("borrowerAccountPage")?.classList.contains("active-page")) {
    ensureStablePaymentCard();
  }
}

setInterval(tick, 600);
tick();

console.log("stable account payment form active");
