// Safe day/night theme toggle.
// No MutationObserver. No page rewriting. Only body/html theme attributes + button click.

const THEME_KEY = 'loanLedger.theme';

function qs(id) { return document.getElementById(id); }
function getTheme() { return localStorage.getItem(THEME_KEY) || 'night'; }

function applyTheme(theme) {
  const next = theme === 'day' ? 'day' : 'night';
  localStorage.setItem(THEME_KEY, next);
  document.documentElement.dataset.theme = next;
  document.body.dataset.theme = next;
  const btn = qs('btnThemeToggle');
  if (btn) {
    btn.textContent = next === 'day' ? '🌙 Noche' : '☀️ Día';
    btn.title = next === 'day' ? 'Cambiar a modo noche' : 'Cambiar a modo día';
  }
}

function toggleTheme() {
  applyTheme(getTheme() === 'day' ? 'night' : 'day');
}

function injectThemeStyles() {
  if (qs('themeSimpleStyle')) return;
  const style = document.createElement('style');
  style.id = 'themeSimpleStyle';
  style.textContent = `
    body[data-theme="day"] { background:#f4f5f8 !important; color:#161820 !important; }
    body[data-theme="day"] header,
    body[data-theme="day"] .side-menu { background:#ffffff !important; color:#161820 !important; border-color:#d9dce5 !important; }
    body[data-theme="day"] .card,
    body[data-theme="day"] .compact-card,
    body[data-theme="day"] .acct-card,
    body[data-theme="day"] .stat-card,
    body[data-theme="day"] .acct-stat { background:#ffffff !important; color:#161820 !important; border-color:#d9dce5 !important; }
    body[data-theme="day"] input,
    body[data-theme="day"] select,
    body[data-theme="day"] textarea { background:#ffffff !important; color:#161820 !important; border-color:#cfd3df !important; }
    body[data-theme="day"] .muted,
    body[data-theme="day"] .stat-label,
    body[data-theme="day"] .acct-label { color:#5f6678 !important; }
    body[data-theme="day"] .tab-btn,
    body[data-theme="day"] .menu-link { background:#ffffff !important; color:#161820 !important; border-color:#cfd3df !important; }
    body[data-theme="day"] .tab-btn.active { background:#2b63ff !important; color:#ffffff !important; border-color:#2b63ff !important; }
    body[data-theme="day"] button { border-color:#cfd3df; }
    body[data-theme="day"] .pill,
    body[data-theme="day"] .acct-pill { background:#f6f7fb !important; border-color:#d9dce5 !important; color:#252836 !important; }
    body[data-theme="day"] .due-cal-day { background:#ffffff !important; color:#161820 !important; border-color:#d9dce5 !important; }
    body[data-theme="day"] .due-cal-day.selected,
    body[data-theme="day"] .due-cal-detail { background:#7b5cff !important; color:#ffffff !important; border-color:#7b5cff !important; }
    body[data-theme="day"] .due-cal-detail .muted { color:rgba(255,255,255,.78) !important; }
    #btnThemeToggle { width:auto !important; display:none; margin:0 !important; padding:10px 14px !important; background:#333 !important; color:#fff !important; border:1px solid #444 !important; border-radius:12px !important; white-space:nowrap; }
    body[data-theme="day"] #btnThemeToggle { background:#ffffff !important; color:#161820 !important; border-color:#cfd3df !important; }
  `;
  document.head.appendChild(style);
}

function initThemeButton() {
  injectThemeStyles();
  const btn = qs('btnThemeToggle');
  if (btn) {
    btn.onclick = toggleTheme;
    btn.type = 'button';
  }
  applyTheme(getTheme());
}

window.loanLedgerTheme = { applyTheme, toggleTheme, initThemeButton };
initThemeButton();
console.log('safe theme toggle ready');
