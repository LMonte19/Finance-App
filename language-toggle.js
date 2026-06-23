const STORAGE_KEY = "loanLedger.language";
const DEFAULT_LANG = "es";
let currentLang = localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG;
let timer = null;
let translating = false;

const textMap = {
  "Loan Ledger": "Control de Préstamos",
  "Not signed in": "Sesión no iniciada",
  "Sign in": "Iniciar sesión",
  "Sign out": "Cerrar sesión",
  "Email": "Correo electrónico",
  "Password": "Contraseña",
  "Admin creates users in Supabase (so no one self-registers).": "El administrador crea los usuarios en Supabase para evitar registros no autorizados.",
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
  "Borrowers": "Clientes",
  "Recent Payments": "Pagos recientes",
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
  "No urgent actions right now.": "No hay acciones urgentes por ahora.",
  "No loan payments due today.": "No hay pagos que venzan hoy.",
  "No upcoming due rows found.": "No hay próximos vencimientos registrados.",
  "No overdue or due-today follow-ups.": "No hay seguimientos atrasados ni para hoy.",
  "No borrower risk data yet.": "Todavía no hay datos de riesgo de clientes.",
  "No loan health issues found.": "No se encontraron alertas de préstamos.",
  "No payments yet.": "Todavía no hay pagos.",
  "No activity yet.": "Todavía no hay actividad.",
  "No contact notes yet.": "Todavía no hay notas de contacto.",

  "New Loan": "Nuevo préstamo",
  "Create loan (Agent/Admin)": "Crear préstamo (Agente/Admin)",
  "Save Loan": "Guardar préstamo",
  "Create loan + generate due dates": "Crear préstamo y generar cuotas",
  "Borrower full name": "Nombre completo del cliente",
  "Phone (optional)": "Teléfono (opcional)",
  "Notes (late payer, etc.)": "Notas (paga tarde, etc.)",
  "Notes (optional)": "Notas (opcional)",
  "+ New Borrower": "+ Nuevo cliente",
  "Use Existing Borrower": "Usar cliente existente",
  "Principal (e.g. 1000)": "Capital (ej. 1000)",
  "Principal (e.g., 1000)": "Capital (ej. 1000)",
  "Total monthly interest % (e.g. 10)": "Interés mensual total % (ej. 10)",
  "Management share % (e.g. 3)": "Porcentaje de administración % (ej. 3)",
  "Funding Split": "Distribución de inversión",
  "Add / Update Split": "Agregar / actualizar distribución",
  "Funders share:": "Porción de socios:",
  "Loans": "Préstamos",
  "Loan Details": "Detalles del préstamo",
  "Back": "Volver",
  "Funding Split": "Distribución de inversión",
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
  "Amount paid (e.g., 120)": "Monto pagado (ej. 120)",
  "Add payment": "Agregar pago",
  "Recent payments": "Pagos recientes",
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
  "Payment applied.": "Pago aplicado.",
  "Payment voided and reversed.": "Pago anulado y reversado.",
  "Payment notes saved.": "Notas del pago guardadas.",

  "Add borrower": "Agregar cliente",
  "Borrower list": "Lista de clientes",
  "Borrower Details": "Detalles del cliente",
  "Name:": "Nombre:",
  "Phone:": "Teléfono:",
  "Notes:": "Notas:",
  "Total Borrowed:": "Total prestado:",
  "Total Outstanding:": "Total pendiente:",
  "Total Paid:": "Total pagado:",
  "Overdue Items:": "Cuotas atrasadas:",
  "Overdue Amount:": "Monto atrasado:",
  "Risk / Late Summary": "Resumen de riesgo / atraso",
  "Contact / Follow-ups": "Contacto / Seguimientos",
  "Contact History": "Historial de contacto",
  "Open Follow-ups": "Seguimientos abiertos",
  "Schedule Follow-up": "Programar seguimiento",
  "Save Contact Note": "Guardar nota de contacto",
  "Add Follow-up": "Agregar seguimiento",
  "Contact notes": "Notas de contacto",
  "Outcome (optional)": "Resultado (opcional)",
  "Follow-up reason": "Motivo del seguimiento",
  "No open follow-ups.": "No hay seguimientos abiertos.",

  "Follow-ups": "Seguimientos",
  "Track calls, WhatsApp/texts, promises to pay, and reminders.": "Registra llamadas, WhatsApp/textos, promesas de pago y recordatorios.",
  "Open": "Abiertos",
  "Overdue": "Atrasados",
  "Completed": "Completados",
  "Add Follow-up": "Agregar seguimiento",
  "Select borrower": "Seleccionar cliente",
  "Optional loan": "Préstamo opcional",
  "Reason / reminder note (e.g., promised to pay Friday)": "Motivo / recordatorio (ej. prometió pagar el viernes)",
  "Log Contact": "Registrar contacto",
  "Contact notes": "Notas de contacto",
  "Follow-up View": "Vista de seguimientos",
  "Due Today": "Vence hoy",
  "Follow-up List": "Lista de seguimientos",
  "Recent Contact Notes": "Notas de contacto recientes",
  "Mark Done": "Marcar como completado",
  "No follow-ups in this view.": "No hay seguimientos en esta vista.",

  "Activity / History": "Actividad / Historial",
  "Shows edits, voids, status changes, settings changes, and other tracked actions.": "Muestra cambios, anulaciones, estados, configuración y otras acciones registradas.",
  "All actions": "Todas las acciones",
  "All sections": "Todas las secciones",
  "Funding Splits": "Distribuciones de inversión",
  "Default Splits": "Distribuciones predeterminadas",
  "Settings": "Configuración",
  "Search user, borrower, action, summary...": "Buscar usuario, cliente, acción, resumen...",
  "Refresh": "Actualizar",
  "Recent Activity": "Actividad reciente",
  "No activity found for this view.": "No se encontró actividad para esta vista.",

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

  "System Check": "Revisión del Sistema",
  "Readiness checks before using real data.": "Revisiones antes de usar datos reales.",
  "Refresh Checks": "Actualizar revisiones",
  "Check Results": "Resultados de revisión",
  "Role Permissions": "Permisos por rol",
  "Manual Test Checklist": "Lista de prueba manual",
  "Permissions active": "Permisos activos",
  "Signed in as": "Sesión iniciada como",
  "Role:": "Rol:",

  "Partners": "Socios",
  "Partner Details": "Detalles del socio",
  "Partner earnings and allocation summaries will go here.": "Aquí se mostrarán las ganancias y distribuciones de los socios.",
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
  "ADMIN": "ADMIN",
  "AGENT": "AGENTE",
  "PARTNER": "SOCIO",
  "LOW": "BAJA",
  "NORMAL": "NORMAL",
  "HIGH": "ALTA",
  "URGENT": "URGENTE",
  "NOTE": "NOTA",
  "CALL": "LLAMADA",
  "TEXT": "TEXTO",
  "WHATSAPP": "WHATSAPP",
  "EMAIL": "CORREO",
  "IN_PERSON": "EN PERSONA",
  "OTHER": "OTRO",
  "PASS": "OK",
  "WARN": "AVISO",
  "FAIL": "FALLA",

  "Search loans by borrower, amount, status, due date...": "Buscar préstamos por cliente, monto, estado o fecha...",
  "Search borrowers by name, phone, notes...": "Buscar clientes por nombre, teléfono o notas...",
  "Search payments by borrower, date, notes...": "Buscar pagos por cliente, fecha o notas...",
  "Search borrower, phone, reason, priority...": "Buscar cliente, teléfono, motivo o prioridad...",
  "Search borrower, issue, details...": "Buscar cliente, alerta o detalles..."
};

const placeholderMap = {
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

function reverseMap(map) {
  return Object.fromEntries(Object.entries(map).map(([en, es]) => [es, en]));
}

const esToEnText = reverseMap(textMap);
const esToEnPlaceholder = reverseMap(placeholderMap);

function normalizeText(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function translateTextValue(value) {
  const text = normalizeText(value);
  if (!text) return value;

  if (currentLang === "es") return textMap[text] || value;
  return esToEnText[text] || value;
}

function translateCompositeText(value) {
  let output = value;
  const map = currentLang === "es" ? textMap : esToEnText;

  Object.entries(map)
    .sort((a, b) => b[0].length - a[0].length)
    .forEach(([from, to]) => {
      if (!from || !to) return;
      output = output.replaceAll(from, to);
    });

  return output;
}

function shouldTranslateNode(node) {
  if (!node || node.nodeType !== Node.TEXT_NODE) return false;
  const parent = node.parentElement;
  if (!parent) return false;
  if (["SCRIPT", "STYLE", "TEXTAREA"].includes(parent.tagName)) return false;
  if (parent.closest("input, textarea")) return false;
  return normalizeText(node.nodeValue).length > 0;
}

function translateTextNodes(root = document.body) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return shouldTranslateNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  nodes.forEach((node) => {
    const original = node.nodeValue;
    const exact = translateTextValue(original);
    if (exact !== original) {
      node.nodeValue = original.replace(normalizeText(original), exact);
      return;
    }

    const composite = translateCompositeText(original);
    if (composite !== original) node.nodeValue = composite;
  });
}

function translateAttributes(root = document) {
  const pMap = currentLang === "es" ? placeholderMap : esToEnPlaceholder;
  root.querySelectorAll("input[placeholder], textarea[placeholder]").forEach((el) => {
    const text = normalizeText(el.getAttribute("placeholder"));
    if (pMap[text]) el.setAttribute("placeholder", pMap[text]);
  });

  root.querySelectorAll("option").forEach((el) => {
    const text = normalizeText(el.textContent);
    const next = translateTextValue(text);
    if (next !== text) el.textContent = next;
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

function setDocumentLang() {
  document.documentElement.lang = currentLang === "es" ? "es" : "en";
}

function applyTranslations(force = false) {
  if (translating) return;
  translating = true;
  try {
    ensureLanguageButton();
    updateLanguageButton();
    setDocumentLang();
    translateTextNodes(document.body);
    translateAttributes(document);
  } finally {
    translating = false;
  }
}

const observer = new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(() => applyTranslations(false), 120);
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true,
});

localStorage.setItem(STORAGE_KEY, currentLang);
applyTranslations(true);
setInterval(() => applyTranslations(false), 1500);
