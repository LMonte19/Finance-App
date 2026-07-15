const STORAGE_KEY = "loanLedger.language";
const DEFAULT_LANG = "es";
let currentLang = localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG;
let timer = null;
let isApplying = false;

const pairs = {
  "Loan Ledger": "Control de Préstamos",
  "Not signed in": "Sesión no iniciada",
  "Sign in": "Iniciar sesión",
  "Sign out": "Cerrar sesión",
  "Menu": "Menú",
  "Home": "Inicio",
  "Dashboard": "Inicio",
  "Loans": "Préstamos",
  "Loans / Accounts": "Préstamos / Cuentas",
  "Payments": "Pagos",
  "Borrowers": "Clientes",
  "Clients": "Clientes",
  "Partners": "Socios",
  "Follow-ups": "Seguimientos",
  "Activity / History": "Actividad / Historial",
  "Reports / Export": "Reportes / Exportar",
  "Reports / Export CSV": "Reportes / Exportar CSV",
  "Loan Health": "Revisión de cuentas",
  "Account Review": "Revisión de cuentas",
  "System Check": "Revisión del sistema",
  "Profiles / Users": "Perfiles / Usuarios",
  "Maintenance": "Mantenimiento",
  "Settings": "Configuración",
  "Defaults / Settings": "Valores predeterminados / Configuración",

  "Account Summary": "Resumen de cuenta",
  "Client Account": "Cuenta del cliente",
  "Customer Account": "Cuenta del cliente",
  "Client Accounts": "Cuentas de clientes",
  "New disbursement / added capital": "Nuevo desembolso / capital agregado",
  "This form adds capital to the client account. Future dues are calculated automatically.": "Este formulario agrega capital a la cuenta del cliente. Las cuotas futuras se calculan automáticamente.",
  "+ New client": "+ Nuevo cliente",
  "+ New Borrower": "+ Nuevo cliente",
  "Use existing client": "Usar cliente existente",
  "Use Existing Borrower": "Usar cliente existente",
  "Funding Split": "Distribución de inversión",
  "Investment split": "Distribución de inversión",
  "Add / update": "Agregar / actualizar",
  "Save disbursement": "Guardar desembolso",
  "Client Accounts": "Cuentas de clientes",
  "Loading accounts...": "Cargando cuentas...",
  "Click to open full account.": "Clic para abrir cuenta completa.",
  "No clients/accounts to show.": "No hay clientes/cuentas para mostrar.",

  "Capital balance": "Balance de capital",
  "Active capital": "Capital activo",
  "Total disbursed": "Total desembolsado",
  "Current monthly fee": "Cuota mensual actual",
  "Fee per cycle": "Cuota por ciclo",
  "Next due": "Próxima cuota",
  "Overdue": "Atrasado",
  "Days late": "Días tarde",
  "Status": "Estado",
  "Disbursements / added capital": "Desembolsos / capital agregado",
  "Pay calendar": "Calendario de cuotas",
  "Due calendar": "Calendario de cuotas",
  "Due Schedule": "Calendario de cuotas",
  "Payment History": "Historial de pagos",
  "Contact Notes": "Notas de contacto",
  "No disbursements.": "No hay desembolsos.",
  "No payments.": "No hay pagos.",
  "No follow-ups.": "No hay seguimientos.",
  "No notes.": "No hay notas.",
  "Back": "Volver",

  "Record payment": "Registrar pago",
  "Record payment by client/account": "Registrar pago por cliente/cuenta",
  "Applies payments to the complete client account, not to an individual disbursement.": "Aplica pagos a la cuenta completa del cliente, no a un desembolso individual.",
  "Payment of fee/interest": "Pago de cuota/interés",
  "Direct principal payment": "Abono directo a capital",
  "Mixed: fee and leftover to principal": "Mixto: cuota y sobrante a capital",
  "Pay off principal": "Saldar capital",
  "Apply payment": "Aplicar pago",
  "Payment applied.": "Pago aplicado.",
  "Applying payment...": "Aplicando pago...",
  "Fee payments do not reduce capital. Capital only goes down with principal payment, mixed, or payoff.": "Los pagos de cuota no rebajan capital. El capital solo baja con abono a capital, mixto o saldo.",
  "Fee payments do not reduce capital.": "Los pagos de cuota no rebajan capital.",
  "Active": "Activos",
  "All": "Todos",
  "Voided": "Anulados",
  "This Month": "Este mes",
  "All clients": "Todos los clientes",
  "All borrowers": "Todos los clientes",
  "Payment Details": "Detalle del pago",
  "Affected dues": "Cuotas afectadas",
  "Affected capital": "Capital afectado",
  "Allocations": "Distribuciones",
  "Actions": "Acciones",
  "Void Payment": "Anular pago",
  "Click for detail": "Clic para detalle",
  "No payments for this view.": "No hay pagos para esta vista.",
  "Did not affect dues.": "No afectó cuotas.",
  "Did not affect capital.": "No afectó capital.",
  "No allocations.": "No hay distribuciones.",

  "Overview": "Resumen",
  "Fast view of accounts, virtual dues, and payments.": "Vista rápida de cuentas, cuotas virtuales y pagos.",
  "Refresh": "Actualizar",
  "Current projection": "Proyección actual",
  "Based on active balances. Upcoming dues are calculated virtually.": "Basado en balances activos. Las próximas cuotas se calculan virtualmente.",
  "Quick Actions": "Acciones rápidas",
  "New disbursement": "Nuevo desembolso",
  "Contact note": "Nota de contacto",
  "Future dues are calculated automatically.": "Las cuotas futuras se calculan automáticamente.",
  "Today priority": "Prioridad de hoy",
  "The most important things to review first.": "Lo más importante para revisar primero.",
  "No urgent actions now.": "No hay acciones urgentes ahora.",
  "Virtual dues": "Cuotas virtuales",
  "Due today": "Vencen hoy",
  "Upcoming dues": "Próximas cuotas",
  "No dues due today.": "No hay cuotas venciendo hoy.",
  "No upcoming dues.": "No hay próximas cuotas.",
  "Recent payments": "Pagos recientes",
  "Recent activity": "Actividad reciente",
  "Recent contact notes": "Notas de contacto recientes",

  "Activity": "Actividad",
  "Recent Activity": "Actividad reciente",
  "Activity / History": "Actividad / Historial",
  "All actions": "Todas las acciones",
  "All sections": "Todas las secciones",
  "Clients": "Clientes",
  "Disbursements / Capital": "Desembolsos / Capital",
  "Payments": "Pagos",
  "Investment split": "Distribución de inversión",
  "Partner allocations": "Distribuciones a socios",
  "Principal payments": "Abonos a capital",
  "Contact notes": "Notas de contacto",
  "Default splits": "Distribuciones predeterminadas",
  "Profiles": "Perfiles",
  "No activity for this view.": "No hay actividad para esta vista.",

  "Account/system review": "Revisión de cuentas / sistema",
  "Review view": "Vista de revisión",
  "Alerts": "Alertas",
  "High": "Alta",
  "Medium": "Media",
  "Low": "Baja",
  "All alerts": "Todas",
  "No alerts for this view.": "No hay alertas para esta vista.",
  "System Review": "Revisión del sistema",
  "Results": "Resultados",
  "Role permissions": "Permisos por rol",
  "Manual checklist": "Checklist manual",
  "All good": "Todo bien",
  "Review": "Revisar",
  "Fail": "Falla",

  "Reports": "Reportes",
  "Export": "Exportar",
  "Accounts and payments": "Cuentas y pagos",
  "Export client accounts": "Exportar cuentas de clientes",
  "Export payments": "Exportar pagos",
  "Export virtual dues / overdue": "Exportar cuotas virtuales / atrasos",
  "Export partner summary": "Exportar resumen de socios",
  "Export partner disbursements": "Exportar desembolsos por socio",
  "Export partner allocations": "Exportar distribuciones a socios",
  "Download CSV": "Descargar CSV",
  "No data to export.": "No hay datos para exportar.",

  "Partner Details": "Detalles del socio",
  "Partner Summary": "Resumen de socio",
  "Active borrowers": "Clientes activos",
  "Funded disbursements": "Desembolsos financiados",
  "Total earned": "Ganancia total",
  "Management earned": "Administración ganada",
  "Funding earned": "Ganancia de inversión",

  "Loading...": "Cargando...",
  "Loading": "Cargando",
  "Save": "Guardar",
  "Save Profile": "Guardar perfil",
  "Save Changes": "Guardar cambios",
  "Cancel": "Cancelar",
  "Open": "Abierto",
  "Completed": "Completado",
  "Current": "Al día",
  "ACTIVE": "ACTIVO",
  "PAID": "PAGADO",
  "PAID_OFF": "SALDADO",
  "CLOSED": "CERRADO",
  "VOIDED": "ANULADO",
  "CANCELLED": "CANCELADO",
  "DUE": "PENDIENTE",
  "PARTIAL": "PARCIAL",
  "UPCOMING": "PRÓXIMO",
  "DUE_TODAY": "VENCE HOY",
  "OVERDUE": "ATRASADO",
  "HIGH": "ALTA",
  "MEDIUM": "MEDIA",
  "LOW": "BAJA",
  "PASS": "BIEN",
  "WARN": "REVISAR",
  "FAIL": "FALLA",

  "Only Admin can edit profile roles.": "Solo Admin puede editar roles de perfiles.",
  "Unnamed": "Sin nombre",
  "Display name": "Nombre visible",
  "No profiles found.": "No hay perfiles.",
  "Profile updated.": "Perfil actualizado.",
  "Maintenance": "Mantenimiento",
  "Admin-only maintenance tools.": "Herramientas de mantenimiento para Admin.",
  "Reset Test Data": "Borrar datos de prueba",
  "Only Admin can reset test data.": "Solo Admin puede borrar los datos de prueba.",
  "Reset cancelled.": "Borrado cancelado.",
  "Test data reset. Hard refresh the app.": "Datos de prueba borrados. Haz hard refresh en la app."
};

const placeholdersEs = {
  "Email": "Correo electrónico",
  "Password": "Contraseña",
  "Borrower full name": "Nombre completo del cliente",
  "Client full name": "Nombre completo del cliente",
  "Full client name": "Nombre completo del cliente",
  "Phone (optional)": "Teléfono (opcional)",
  "Notes": "Notas",
  "Notes (optional)": "Notas (opcional)",
  "Principal (e.g., 1000)": "Capital (ej. 1000)",
  "Disbursed capital": "Capital desembolsado",
  "Total monthly interest %": "Interés mensual total %",
  "Management %": "Administración %",
  "Amount paid": "Monto pagado",
  "Payment notes": "Notas del pago",
  "Payment notes (optional)": "Notas del pago (opcional)",
  "Percent": "Porcentaje",
  "Search payment...": "Buscar pago...",
  "Search user, client, action, summary...": "Buscar usuario, cliente, acción o resumen...",
  "Search user, borrower, action, summary...": "Buscar usuario, cliente, acción o resumen...",
  "Search client, phone, reason, priority...": "Buscar cliente, teléfono, motivo o prioridad...",
  "Search borrower, phone, reason, priority...": "Buscar cliente, teléfono, motivo o prioridad...",
  "Search client, alert, details...": "Buscar cliente, alerta o detalles...",
  "Search borrower, issue, details...": "Buscar cliente, alerta o detalles...",
  "Display name": "Nombre visible"
};

const es = pairs;
const en = Object.fromEntries(Object.entries(pairs).map(([english, spanish]) => [spanish, english]));
const placeholdersEn = Object.fromEntries(Object.entries(placeholdersEs).map(([english, spanish]) => [spanish, english]));

function norm(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function exactTranslate(value, map) {
  const clean = norm(value);
  if (!clean) return null;
  return map[clean] || null;
}

function shouldSkipElement(el) {
  if (!el) return true;
  if (["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SELECT", "OPTION"].includes(el.tagName)) return true;
  if (el.closest("script,style,textarea,input")) return true;
  if (el.closest('[translate="no"], .no-translate')) return true;
  if (el.id === "debug") return true;
  return false;
}

function translateTextNodes(root = document.body) {
  if (!root) return;
  const map = currentLang === "es" ? es : en;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (const node of nodes) {
    const parent = node.parentElement;
    if (shouldSkipElement(parent)) continue;
    const clean = norm(node.nodeValue);
    if (!clean || clean.length > 140) continue;
    const translated = exactTranslate(clean, map);
    if (!translated || translated === clean) continue;
    node.nodeValue = node.nodeValue.replace(clean, translated);
  }
}

function translateAttributes(root = document) {
  const pMap = currentLang === "es" ? placeholdersEs : placeholdersEn;
  root.querySelectorAll("input[placeholder], textarea[placeholder]").forEach((el) => {
    if (el.closest('[translate="no"], .no-translate')) return;
    const clean = norm(el.getAttribute("placeholder"));
    const translated = pMap[clean];
    if (translated) el.setAttribute("placeholder", translated);
  });

  const map = currentLang === "es" ? es : en;
  root.querySelectorAll("option").forEach((el) => {
    const clean = norm(el.textContent);
    const translated = map[clean];
    if (translated) el.textContent = translated;
  });

  document.title = currentLang === "es" ? "Control de Préstamos" : "Loan Ledger";
}

function ensureLanguageButton() {
  if (document.getElementById("btnLangToggle")) return;
  const signOut = document.getElementById("btnSignOut");
  const container = signOut?.parentElement || document.querySelector("header .wrap > div > div:last-child");
  if (!container) return;

  const btn = document.createElement("button");
  btn.id = "btnLangToggle";
  btn.type = "button";
  btn.style.width = "auto";
  btn.style.background = "#16161a";
  btn.style.border = "1px solid #2b2b31";
  btn.style.padding = "10px 14px";
  btn.style.marginRight = "8px";
  btn.style.cursor = "pointer";
  btn.onclick = () => {
    currentLang = currentLang === "es" ? "en" : "es";
    localStorage.setItem(STORAGE_KEY, currentLang);
    applyTranslations();
  };

  container.insertBefore(btn, signOut || container.firstChild);
}

function updateLanguageButton() {
  const btn = document.getElementById("btnLangToggle");
  if (!btn) return;
  btn.textContent = currentLang === "es" ? "EN" : "ES";
  btn.title = currentLang === "es" ? "Cambiar a inglés" : "Switch to Spanish";
}

function applyTranslations() {
  if (isApplying) return;
  isApplying = true;
  try {
    localStorage.setItem(STORAGE_KEY, currentLang);
    document.documentElement.lang = currentLang;
    ensureLanguageButton();
    updateLanguageButton();
    translateTextNodes(document.body);
    translateAttributes(document);
  } finally {
    isApplying = false;
  }
}

const observer = new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(applyTranslations, 180);
});

observer.observe(document.body, { childList: true, subtree: true });
applyTranslations();
setInterval(applyTranslations, 4000);
