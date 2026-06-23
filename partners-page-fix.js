import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient("https://eatxkhhpjruwwibhcubf.supabase.co", "sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage, storageKey: "loan-ledger-auth" },
});

const qs = (id) => document.getElementById(id);
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
let busy = false;
let lastHtml = "";
let cached = [];

function activePage() { return qs("partnersPage")?.classList.contains("active-page"); }
function card(html, attrs = "") { return `<div class="compact-card" ${attrs} style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;box-sizing:border-box;${attrs ? "cursor:pointer;" : ""}">${html}</div>`; }
function typeName(t) { const v = String(t || ""); return v.includes("MANAGEMENT") ? "Administración" : "Ganancia socio"; }
function row(p = {}) {
  return {
    id: p.user_id,
    name: p.full_name || "Sin nombre",
    role: p.role || "—",
    activeCapital: Number(p.active_capital || 0),
    originalCapital: Number(p.original_capital || 0),
    activeBorrowers: Number(p.active_borrowers || 0),
    disbursements: Number(p.funded_disbursements || 0),
    totalEarned: Number(p.total_earned || 0),
    mgmtEarned: Number(p.management_earned || 0),
    fundingEarned: Number(p.funding_earned || 0),
    allocations: Number(p.allocation_count || 0),
    voidedEarned: Number(p.voided_earned || 0),
    voidedCount: Number(p.voided_allocation_count || 0),
  };
}
function stats(items) {
  return `<div class="stats-grid">${items.map(i => `<div class="stat-card"><div class="stat-label">${i.label}</div><div class="stat-value">${i.value}</div></div>`).join("")}</div>`;
}

async function renderPartners(force = false) {
  const page = qs("partnersPage");
  if (!page || !activePage() || busy) return;
  if (page.dataset.partnerDetailOpen === "true" && !force) return;
  busy = true;
  try {
    const [sRes, aRes] = await Promise.all([
      supabase.from("partner_earnings_summary").select("*").order("active_capital", { ascending: false }),
      supabase.from("partner_allocation_details").select("*").order("created_at", { ascending: false }).limit(30),
    ]);
    if (sRes.error) throw sRes.error;
    if (aRes.error) throw aRes.error;

    const partners = (sRes.data || []).map(row);
    cached = partners;
    const allocs = aRes.data || [];
    const activeAllocs = allocs.filter(a => !a.is_voided);
    const voidedAllocs = allocs.filter(a => a.is_voided);
    const total = partners.reduce((x, p) => {
      x.activeCapital += p.activeCapital; x.totalEarned += p.totalEarned; x.fundingEarned += p.fundingEarned; x.mgmtEarned += p.mgmtEarned; x.disbursements += p.disbursements; x.borrowers += p.activeBorrowers; x.voidedEarned += p.voidedEarned; return x;
    }, { activeCapital: 0, totalEarned: 0, fundingEarned: 0, mgmtEarned: 0, disbursements: 0, borrowers: 0, voidedEarned: 0 });

    const html = `
      <div class="card" data-no-translate="true">
        <div style="font-weight:800;">Socios / Inversionistas</div>
        <div class="muted">Resumen basado en capital activo y distribuciones de pagos no anulados.</div>
        ${stats([
          { label: "Capital activo", value: money(total.activeCapital) },
          { label: "Ganancia recibida", value: money(total.totalEarned) },
          { label: "Ganancia socios", value: money(total.fundingEarned) },
          { label: "Administración", value: money(total.mgmtEarned) },
          { label: "Clientes activos", value: total.borrowers },
          { label: "Desembolsos", value: total.disbursements },
        ])}
        ${total.voidedEarned ? `<div class="muted" style="margin-top:10px;">Anulado separado: ${money(total.voidedEarned)}</div>` : ""}
      </div>
      <div class="card" data-no-translate="true">
        <div style="font-weight:800;">Resumen por socio</div>
        ${partners.length ? partners.map(p => card(`
          <strong>${p.name}</strong> <span class="muted">${p.role}</span><br>
          <span class="muted">Capital activo: ${money(p.activeCapital)} | Capital original: ${money(p.originalCapital)}</span><br>
          <span class="muted">Ganancia: ${money(p.totalEarned)} | Socio: ${money(p.fundingEarned)} | Administración: ${money(p.mgmtEarned)}</span><br>
          <span class="muted">Clientes: ${p.activeBorrowers} | Desembolsos: ${p.disbursements} | Clic para detalle</span>
        `, `data-partner-detail-id="${p.id}"`)).join("") : "No hay socios."}
      </div>
      <div class="card" data-no-translate="true">
        <div style="font-weight:800;">Distribuciones recientes</div>
        ${activeAllocs.length ? activeAllocs.slice(0, 20).map(a => card(`<strong>${a.partner_name || "Socio"}</strong> — ${money(a.amount)}<br><span class="muted">${typeName(a.allocation_type)} | ${a.borrower_name || "Sin cliente"} | ${a.paid_on || "—"}</span>`)).join("") : "No hay distribuciones."}
      </div>
      ${voidedAllocs.length ? `<div class="card" data-no-translate="true"><div style="font-weight:800;">Anuladas recientes</div>${voidedAllocs.slice(0, 8).map(a => card(`<strong>${a.partner_name || "Socio"}</strong> — ${money(a.amount)} <span class="pill acct-danger">ANULADO</span><br><span class="muted">${a.borrower_name || "Sin cliente"}</span>`)).join("")}</div>` : ""}
    `;
    if (!force && html === lastHtml) return;
    lastHtml = html;
    page.dataset.partnerDetailOpen = "false";
    page.innerHTML = html;
    document.querySelectorAll("[data-partner-detail-id]").forEach(el => el.onclick = () => renderPartnerDetails(el.dataset.partnerDetailId));
  } catch (e) {
    console.error(e);
    page.innerHTML = `<div class="card"><strong>Socios</strong><br><span class="muted">${e.message || String(e)}</span></div>`;
  } finally { busy = false; }
}

async function renderPartnerDetails(id) {
  const page = qs("partnersPage");
  if (!page) return;
  page.dataset.partnerDetailOpen = "true";
  page.innerHTML = `<div class="card"><strong>Detalle del socio</strong><br><span class="muted">Cargando...</span></div>`;
  try {
    const [sRes, fRes, aRes] = await Promise.all([
      supabase.from("partner_earnings_summary").select("*").eq("user_id", id).single(),
      supabase.from("partner_funded_loans").select("*").eq("partner_user_id", id).order("start_date", { ascending: false }),
      supabase.from("partner_allocation_details").select("*").eq("partner_user_id", id).order("created_at", { ascending: false }).limit(100),
    ]);
    if (sRes.error) throw sRes.error;
    if (fRes.error) throw fRes.error;
    if (aRes.error) throw aRes.error;
    const p = row(sRes.data || cached.find(x => x.id === id));
    const funded = fRes.data || [];
    const allocs = (aRes.data || []).filter(a => !a.is_voided);
    const borrowers = new Map();
    funded.forEach(l => {
      const key = l.borrower_id || l.borrower_name || "x";
      if (!borrowers.has(key)) borrowers.set(key, { name: l.borrower_name || "Sin cliente", active: 0, original: 0, loans: 0 });
      const b = borrowers.get(key); b.active += Number(l.partner_active_capital || 0); b.original += Number(l.partner_original_capital || 0); b.loans += 1;
    });
    page.innerHTML = `
      <div class="card" data-no-translate="true">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;"><div style="font-weight:800;">Detalle del socio</div><button id="btnBackToPartners" type="button" style="width:auto;background:#333;padding:10px 14px;">Volver</button></div>
        <div style="margin-top:12px;"><strong>${p.name}</strong> <span class="muted">${p.role}</span><br><span class="muted">Capital activo: ${money(p.activeCapital)} | Ganancia total: ${money(p.totalEarned)}</span></div>
        ${stats([{ label: "Clientes", value: p.activeBorrowers }, { label: "Desembolsos", value: p.disbursements }, { label: "Distribuciones", value: p.allocations }, { label: "Anuladas", value: p.voidedCount }])}
      </div>
      <div class="card" data-no-translate="true"><div style="font-weight:800;">Clientes donde participa</div>${borrowers.size ? Array.from(borrowers.values()).map(b => card(`<strong>${b.name}</strong><br><span class="muted">Capital activo: ${money(b.active)} | Original: ${money(b.original)} | Desembolsos: ${b.loans}</span>`)).join("") : "Sin clientes activos."}</div>
      <div class="card" data-no-translate="true"><div style="font-weight:800;">Desembolsos financiados</div>${funded.length ? funded.map(l => card(`<strong>${l.borrower_name || "Sin cliente"}</strong><br><span class="muted">Participación: ${(Number(l.funding_percent || 0) * 100).toFixed(2)}% | ${l.start_date} | ${l.status}</span><br><span class="muted">Capital socio activo: ${money(l.partner_active_capital)} | Original: ${money(l.partner_original_capital)}</span>`)).join("") : "Sin desembolsos."}</div>
      <div class="card" data-no-translate="true"><div style="font-weight:800;">Distribuciones recibidas</div>${allocs.length ? allocs.map(a => card(`<strong>${money(a.amount)}</strong> — ${typeName(a.allocation_type)}<br><span class="muted">${a.borrower_name || "Sin cliente"} | ${a.paid_on || "—"} | ${a.payment_type || "—"}</span>`)).join("") : "Sin distribuciones."}</div>
    `;
    qs("btnBackToPartners").onclick = () => { page.dataset.partnerDetailOpen = "false"; lastHtml = ""; renderPartners(true); };
  } catch (e) {
    console.error(e);
    page.innerHTML = `<div class="card"><strong>Detalle del socio</strong><br><span class="muted">${e.message || String(e)}</span><br><button id="btnBackToPartners" type="button">Volver</button></div>`;
    qs("btnBackToPartners").onclick = () => { page.dataset.partnerDetailOpen = "false"; renderPartners(true); };
  }
}

new MutationObserver(() => setTimeout(() => renderPartners(false), 200)).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
setInterval(() => renderPartners(false), 4000);
renderPartners(true);
