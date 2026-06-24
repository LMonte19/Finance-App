// Visual polish / Spanish normalization layer.
// This file does not own business logic. It only normalizes visible labels,
// menu order, status wording, and small layout inconsistencies after modules render.

const qs = (id) => document.getElementById(id);

const EXACT_TEXT = new Map([
  ["Dashboard", "Inicio"],
  ["Home", "Inicio"],
  ["Loans", "Préstamos"],
  ["Loan", "Desembolso"],
  ["Payments", "Pagos"],
  ["Payment", "Pago"],
  ["Borrowers", "Clientes"],
  ["Borrower", "Cliente"],
  ["Partners", "Socios"],
  ["Partner", "Socio"],
  ["Settings", "Configuración"],
  ["Defaults", "Configuración"],
  ["Reports / Export", "Reportes / Exportar"],
  ["Profiles / Users", "Perfiles / Usuarios"],
  ["Maintenance", "Mantenimiento"],
  ["Activity / History", "Actividad / Historial"],
  ["System Check", "Revisión del sistema"],
  ["Loan Health", "Revisión de cuentas"],
  ["Payment View", "Vista de pagos"],
  ["Payment Details", "Detalle del pago"],
  ["Payment Notes", "Notas del pago"],
  ["Partner Allocations", "Distribuciones a socios"],
  ["Due Events Paid", "Cuotas afectadas"],
  ["Actions", "Acciones"],
  ["Back", "Volver"],
  ["Refresh", "Actualizar"],
  ["Save", "Guardar"],
  ["Save Notes", "Guardar notas"],
  ["Void Payment", "Anular pago"],
  ["Active", "Activos"],
  ["All", "Todos"],
  ["Voided", "Anulados"],
  ["This Month", "Este mes"],
  ["All borrowers", "Todos los clientes"],
  ["All loans", "Todos los desembolsos"],
  ["All actions", "Todas las acciones"],
  ["All sections", "Todas las secciones"],
  ["Loading...", "Cargando..."],
  ["Loading", "Cargando"],
  ["No payments yet.", "No hay pagos todavía."],
  ["No allocations.", "No hay distribuciones."],
  ["No activity found for this view.", "No hay actividad para esta vista."],
  ["Not signed in", "Sesión no iniciada"],
  ["role", "rol"],
]);

const PHRASE_REPLACEMENTS = [
  [/\bBorrowers\b/g, "Clientes"],
  [/\bBorrower\b/g, "Cliente"],
  [/\bLoans\b/g, "Préstamos"],
  [/\bLoan Details\b/g, "Detalle del desembolso"],
  [/\bLoan status\b/g, "Estado del desembolso"],
  [/\bLoan\b/g, "Desembolso"],
  [/\bPayments\b/g, "Pagos"],
  [/\bPayment Details\b/g, "Detalle del pago"],
  [/\bPayment Notes\b/g, "Notas del pago"],
  [/\bPayment\b/g, "Pago"],
  [/\bPartners\b/g, "Socios"],
  [/\bPartner\b/g, "Socio"],
  [/\bDue Events Paid\b/g, "Cuotas afectadas"],
  [/\bDue Events\b/g, "Cuotas"],
  [/\bDue event\b/g, "Cuota"],
  [/\bDue\b/g, "Cuota"],
  [/\bOverdue\b/g, "Atrasado"],
  [/\bOVERDUE\b/g, "ATRASADO"],
  [/\bPaid on\b/g, "Pagado el"],
  [/\bPaid\b/g, "Pagado"],
  [/\bExpected\b/g, "Esperado"],
  [/\bRemaining\b/g, "Pendiente"],
  [/\bInterest\b/g, "Cuota/interés"],
  [/\bPrincipal\b/g, "Capital"],
  [/\bMgmt\b/g, "Administración"],
  [/\bManagement\b/g, "Administración"],
  [/\bFunders\b/g, "Socios"],
  [/\bFunding Splits\b/g, "Distribución de inversión"],
  [/\bDefault Splits\b/g, "Distribución predeterminada"],
  [/\bSettings\b/g, "Configuración"],
  [/\bProfiles\b/g, "Perfiles"],
  [/\bUsers\b/g, "Usuarios"],
  [/\bActions\b/g, "Acciones"],
  [/\bRefresh\b/g, "Actualizar"],
  [/\bBack\b/g, "Volver"],
  [/\bClick for details\b/g, "Clic para detalle"],
  [/\bVOIDED\b/g, "ANULADO"],
  [/\bVoided\b/g, "Anulado"],
  [/\bVoid reason\b/g, "Motivo de anulación"],
  [/\bActive\b/g, "Activo"],
  [/\bUnknown\b/g, "Sin nombre"],
  [/\bSystem\b/g, "Sistema"],
  [/\bLoading\.{0,3}\b/g, "Cargando..."],
];

function normalizeTextNode(node) {
  const original = node.nodeValue;
  const trimmed = original.trim();
  if (!trimmed) return;
  let next = EXACT_TEXT.get(trimmed) || original;
  PHRASE_REPLACEMENTS.forEach(([pattern, replacement]) => {
    next = next.replace(pattern, replacement);
  });
  if (next !== original) node.nodeValue = next;
}

function normalizePlaceholdersAndValues(root = document) {
  root.querySelectorAll("input[placeholder], textarea[placeholder]").forEach((el) => {
    let next = el.getAttribute("placeholder") || "";
    PHRASE_REPLACEMENTS.forEach(([pattern, replacement]) => { next = next.replace(pattern, replacement); });
    next = next
      .replace(/Search user, cliente, action, summary\.\.\./i, "Buscar usuario, cliente, acción o resumen...")
      .replace(/Search user, borrower, action, summary\.\.\./i, "Buscar usuario, cliente, acción o resumen...")
      .replace(/Payment notes/i, "Notas del pago")
      .replace(/Full name/i, "Nombre completo")
      .replace(/Phone/i, "Teléfono")
      .replace(/Notes/i, "Notas");
    el.setAttribute("placeholder", next);
  });

  root.querySelectorAll("option").forEach((el) => {
    const original = el.textContent;
    const trimmed = original.trim();
    let next = EXACT_TEXT.get(trimmed) || original;
    PHRASE_REPLACEMENTS.forEach(([pattern, replacement]) => { next = next.replace(pattern, replacement); });
    if (next !== original) el.textContent = next;
  });
}

function normalizeText(root = document) {
  const walker = document.createTreeWalker(root.body || root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (["SCRIPT", "STYLE", "TEXTAREA", "INPUT"].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(normalizeTextNode);
  normalizePlaceholdersAndValues(root);
}

function normalizeStatuses() {
  const replacements = new Map([
    ["ACTIVE", "ACTIVO"],
    ["PAID", "PAGADO"],
    ["PAID_OFF", "SALDADO"],
    ["CLOSED", "CERRADO"],
    ["VOIDED", "ANULADO"],
    ["CANCELLED", "CANCELADO"],
    ["DUE", "PENDIENTE"],
    ["PARTIAL", "PARCIAL"],
    ["UPCOMING", "PRÓXIMO"],
    ["DUE_TODAY", "VENCE HOY"],
    ["OVERDUE", "ATRASADO"],
    ["CURRENT", "AL DÍA"],
    ["OPEN", "ABIERTO"],
    ["COMPLETED", "COMPLETADO"],
    ["HIGH", "ALTA"],
    ["MEDIUM", "MEDIA"],
    ["LOW", "BAJA"],
  ]);
  document.querySelectorAll(".pill, .acct-pill, option, select").forEach((el) => {
    const txt = el.textContent?.trim();
    if (replacements.has(txt)) el.textContent = replacements.get(txt);
  });
}

function orderMenu() {
  const menu = qs("sideMenu");
  if (!menu) return;

  const labels = [
    ["dashboardPage", "Inicio"],
    ["loansPage", "Préstamos / Cuentas"],
    ["paymentsPage", "Pagos"],
    ["borrowersPage", "Clientes"],
    ["partnersPage", "Socios"],
    ["followupsPage", "Seguimientos"],
    ["activityPage", "Actividad / Historial"],
    ["reportsPage", "Reportes / Exportar"],
    ["loanHealthPage", "Revisión de cuentas"],
    ["systemCheckPage", "Revisión del sistema"],
    ["profilesPage", "Perfiles / Usuarios"],
    ["defaultsPage", "Configuración"],
    ["maintenancePage", "Mantenimiento"],
  ];

  labels.forEach(([page, label]) => {
    const btn = Array.from(menu.querySelectorAll(".menu-link, button[data-page]")).find((b) => b.dataset.page === page);
    if (btn) {
      btn.textContent = label;
      menu.appendChild(btn);
    }
  });
}

function polishCards() {
  document.querySelectorAll(".card, .compact-card, .acct-card").forEach((card) => {
    card.style.boxSizing = "border-box";
    card.style.maxWidth = "100%";
  });
  document.querySelectorAll("button").forEach((button) => {
    button.style.cursor = "pointer";
  });
}

function removeEnglishDebugFlash() {
  const debug = qs("debug");
  if (debug) {
    debug.textContent = debug.textContent
      .replace(/Signing in/i, "Iniciando sesión")
      .replace(/Loading borrowers/i, "Cargando clientes")
      .replace(/Loading loans/i, "Cargando préstamos")
      .replace(/Loading payments/i, "Cargando pagos")
      .replace(/Loading partners/i, "Cargando socios")
      .replace(/Loading dashboard/i, "Cargando inicio");
  }
}

function applyVisualPolish() {
  normalizeText(document);
  normalizeStatuses();
  orderMenu();
  polishCards();
  removeEnglishDebugFlash();
}

let timer = null;
const observer = new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(applyVisualPolish, 120);
});

observer.observe(document.body, { childList: true, subtree: true, characterData: true });
setInterval(applyVisualPolish, 1500);
applyVisualPolish();
console.log("visual polish Spanish normalization active");
