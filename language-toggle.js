const STORAGE_KEY = "loanLedger.language";
const DEFAULT_LANG = "es";
let currentLang = localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG;
let timer = null;
let isApplying = false;

const es = {
  "Loan Ledger": "Control de Préstamos",
  "Not signed in": "Sesión no iniciada",
  "Sign in": "Iniciar sesión",
  "Sign out": "Cerrar sesión",
  "Menu": "Menú",
  "Home": "Inicio",
  "Dashboard": "Inicio",
  "Loans": "Préstamos",
  "Payments": "Pagos",
  "Borrowers": "Clientes",
  "Partners": "Socios",
  "Defaults / Settings": "Valores predeterminados / Configuración",
  "Reports / Export": "Reportes / Exportar",
  "Maintenance": "Mantenimiento",
  "Due / Overdue": "Cuotas / Atrasos",
  "Activity / History": "Actividad / Historial",
  "Follow-ups": "Seguimientos",
  "Loan Health": "Revisión de Préstamos",
  "System Check": "Revisión del Sistema",

  "Overview": "Resumen",
  "Active Loans": "Préstamos activos",
  "Outstanding": "Balance pendiente",
  "Payments Logged": "Pagos registrados",
  "Recent Payments": "Pagos recientes",
  "Recent payments": "Pagos recientes",
  "Loans Snapshot": "Vista rápida de préstamos",
  "Command Center": "Centro de Control",
  "Fast view of what needs attention today.": "Vista rápida de lo que necesita atención hoy.",
  "Total Outstanding": "Total pendiente",
  "Overdue Amount": "Monto atrasado",
  "Due Today": "Vence hoy",
  "Open Follow-ups": "Seguimientos abiertos",
  "Health Issues": "Alertas del sistema",
  "Payments This Month": "Pagos del mes",
  "Quick Actions": "Acciones rápidas",
  "New Loan": "Nuevo préstamo",
  "Record Payment": "Registrar pago",
  "Add Follow-up": "Agregar seguimiento",
  "Log Contact": "Registrar contacto",
  "Generate Missing Due Dates": "Generar cuotas faltantes",
  "Action Queue": "Cola de acciones",
  "The most urgent things to handle first.": "Lo más urgente para revisar primero.",
  "Today / Upcoming": "Hoy / Próximamente",
  "Upcoming Due": "Próximos vencimientos",
  "Follow-ups Due": "Seguimientos pendientes",
  "Borrower Risk Snapshot": "Riesgo de clientes",
  "Loan Health Preview": "Vista rápida de revisión",
  "Recent Activity": "Actividad reciente",
  "Recent Contact Notes": "Notas de contacto recientes",

  "Create loan (Agent/Admin)": "Crear préstamo (Agente/Admin)",
  "Save Loan": "Guardar préstamo",
  "Create loan + generate due dates": "Crear préstamo y generar cuotas",
  "+ New Borrower": "+ Nuevo cliente",
  "Use Existing Borrower": "Usar cliente existente",
  "Funding Split": "Distribución de inversión",
  "Add / Update Split": "Agregar / actualizar distribución",
  "Loan Details": "Detalles del préstamo",
  "Back": "Volver",
  "Save funding split": "Guardar distribución",
  "Due Schedule": "Calendario de cuotas",
  "Payment History": "Historial de pagos",
  "Loan Actions": "Acciones del préstamo",
  "Edit Loan": "Editar préstamo",
  "Save Changes": "Guardar cambios",
  "Mark Paid Off": "Marcar como pagado",
  "Close Loan": "Cerrar préstamo",
  "Void Loan": "Anular préstamo",

  "Record payment (Agent/Admin)": "Registrar pago (Agente/Admin)",
  "Add payment": "Agregar pago",
  "Payment View": "Vista de pagos",
  "Active": "Activos",
  "All": "Todos",
  "Voided": "Anulados",
  "This Month": "Este mes",
  "All borrowers": "Todos los clientes",
  "All loans": "Todos los préstamos",
  "Payment Details": "Detalles del pago",
  "Payment Notes": "Notas del pago",
  "Save Notes": "Guardar notas",
  "Due Events Paid": "Cuotas pagadas",
  "Partner Allocations": "Distribución a socios",
  "Actions": "Acciones",
  "Void Payment": "Anular pago",
  "Click for details": "Clic para ver detalles",

  "Add borrower": "Agregar cliente",
  "Borrower list": "Lista de clientes",
  "Borrower Details": "Detalles del cliente",
  "Name:": "Nombre:",
  "Phone:": "Teléfono:",
  "Notes:": "Notas:",
  "Total Borrowed:": "Total prestado:",
  "Total Paid:": "Total pagado:",
  "Overdue Items:": "Cuotas atrasadas:",
  "Risk / Late Summary": "Resumen de riesgo / atraso",
  "Contact / Follow-ups": "Contacto / Seguimientos",
  "Contact History": "Historial de contacto",
  "Schedule Follow-up": "Programar seguimiento",
  "Save Contact Note": "Guardar nota de contacto",
  "Open Follow-ups": "Seguimientos abiertos",

  "Track calls, WhatsApp/texts, promises to pay, and reminders.": "Registra llamadas, WhatsApp/textos, promesas de pago y recordatorios.",
  "Open": "Abiertos",
  "Overdue": "Atrasados",
  "Completed": "Completados",
  "Select borrower": "Seleccionar cliente",
  "Optional loan": "Préstamo opcional",
  "Follow-up View": "Vista de seguimientos",
  "Follow-up List": "Lista de seguimientos",
  "Mark Done": "Marcar como completado",

  "Shows edits, voids, status changes, settings changes, and other tracked actions.": "Muestra cambios, anulaciones, estados, configuración y otras acciones registradas.",
  "All actions": "Todas las acciones",
  "All sections": "Todas las secciones",
  "Funding Splits": "Distribuciones de inversión",
  "Default Splits": "Distribuciones predeterminadas",
  "Settings": "Configuración",
  "Refresh": "Actualizar",

  "Loan Health / Due Schedule": "Revisión de préstamos / calendario de cuotas",
  "Checks active loans, future due dates, funding splits, and due-row consistency.": "Revisa préstamos activos, cuotas futuras, distribuciones y consistencia de cuotas.",
  "Total Issues": "Total de alertas",
  "High": "Alta",
  "Medium": "Media",
  "Last Generated": "Último generado",
  "Due Schedule Maintenance": "Mantenimiento de cuotas",
  "Next 6 months": "Próximos 6 meses",
  "Next 12 months": "Próximos 12 meses",
  "Next 18 months": "Próximos 18 meses",
  "Next 24 months": "Próximos 24 meses",
  "This only inserts missing due rows. It does not overwrite existing historical amounts.": "Esto solo agrega cuotas faltantes. No sobrescribe montos históricos existentes.",
  "Health View": "Vista de revisión",
  "Issues": "Alertas",
  "Generate Due Dates": "Generar cuotas",

  "Readiness checks before using real data.": "Revisiones antes de usar datos reales.",
  "Refresh Checks": "Actualizar revisiones",
  "Check Results": "Resultados de revisión",
  "Role Permissions": "Permisos por rol",
  "Manual Test Checklist": "Lista de prueba manual",
  "Permissions active": "Permisos activos",
  "Role:": "Rol:",

  "Partner Details": "Detalles del socio",
  "Reports": "Reportes",
  "Export": "Exportar",
  "Download CSV": "Descargar CSV",
  "Profiles": "Perfiles",
  "Users": "Usuarios",
  "Save Profile": "Guardar perfil",

  "Total": "Total",
  "Balance": "Balance",
  "Original": "Original",
  "Status": "Estado",
  "Current": "Al día",
  "CURRENT": "AL DÍA",
  "OVERDUE": "ATRASADO",
  "DUE TODAY": "VENCE HOY",
  "ACTIVE": "ACTIVO",
  "PAID": "PAGADO",
  "PARTIAL": "PARCIAL",
  "DUE": "PENDIENTE",
  "VOIDED": "ANULADO",
  "CLOSED": "CERRADO",
  "PAID_OFF": "SALDADO",
  "AGENT": "AGENTE",
  "PARTNER": "SOCIO",
  "LOW": "BAJA",
  "NORMAL": "NORMAL",
  "HIGH": "ALTA",
  "URGENT": "URGENTE",
  "NOTE": "NOTA",
  "CALL": "LLAMADA",
  "TEXT": "TEXTO",
  "EMAIL": "CORREO",
  "IN_PERSON": "EN PERSONA",
  "OTHER": "OTRO",
  "PASS": "OK",
  "WARN": "AVISO",
  "FAIL": "FALLA"
};

const placeholdersEs = {
  "Email": "Correo electrónico",
  "Password": "Contraseña",
  "Borrower full name": "Nombre completo del cliente",
  "Phone (optional)": "Teléfono (opcional)",
  "Notes (late payer, etc.)": "Notas (paga tarde, etc.)",
  "Notes (optional)": "Notas (opcional)",
  "Principal (e.g., 1000)": "Capital (ej. 1000)",
  "Principal (e.g. 1000)": "Capital (ej. 1000)",
  "Total monthly interest % (e.g. 10)": "Interés mensual total % (ej. 10)",
  "Management share % (e.g. 3)": "Porcentaje de administración % (ej. 3)",
  "Amount paid (e.g., 120)": "Monto pagado (ej. 120)",
  "Payment notes": "Notas del pago",
  "Percent (e.g. 60)": "Porcentaje (ej. 60)",
  "Outcome (optional)": "Resultado (opcional)",
  "Contact notes": "Notas de contacto",
  "Follow-up reason": "Motivo del seguimiento",
  "Reason / reminder note (e.g., promised to pay Friday)": "Motivo / recordatorio (ej. prometió pagar el viernes)",
  "Search loans by borrower, amount, status, due date...": "Buscar préstamos por cliente, monto, estado o fecha...",
  "Search borrowers by name, phone, notes...": "Buscar clientes por nombre, teléfono o notas...",
  "Search payments by borrower, date, notes...": "Buscar pagos por cliente, fecha o notas...",
  "Search user, borrower, action, summary...": "Buscar usuario, cliente, acción o resumen...",
  "Search borrower, phone, reason, priority...": "Buscar cliente, teléfono, motivo o prioridad...",
  "Search borrower, issue, details...": "Buscar cliente, alerta o detalles..."
};

const en = Object.fromEntries(Object.entries(es).map(([k, v]) => [v, k]));
const placeholdersEn = Object.fromEntries(Object.entries(placeholdersEs).map(([k, v]) => [v, k]));

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
  if (el.id === "debug") return true;
  return false;
}

function translateTextNodes(root = document.body) {
  const map = currentLang === "es" ? es : en;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (const node of nodes) {
    const parent = node.parentElement;
    if (shouldSkipElement(parent)) continue;

    const clean = norm(node.nodeValue);
    if (!clean || clean.length > 80) continue;

    const translated = exactTranslate(clean, map);
    if (!translated || translated === clean) continue;

    node.nodeValue = node.nodeValue.replace(clean, translated);
  }
}

function translateAttributes(root = document) {
  const pMap = currentLang === "es" ? placeholdersEs : placeholdersEn;
  root.querySelectorAll("input[placeholder], textarea[placeholder]").forEach((el) => {
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
    applyTranslations(true);
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
  timer = setTimeout(applyTranslations, 150);
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});

applyTranslations();
setInterval(applyTranslations, 3000);
