// Day / Night theme toggle.
// Saves the selected theme in localStorage and applies it globally.

const THEME_KEY = "loanLedger.theme";

function currentTheme() {
  return localStorage.getItem(THEME_KEY) || "night";
}

function setTheme(theme) {
  const next = theme === "day" ? "day" : "night";
  localStorage.setItem(THEME_KEY, next);
  document.documentElement.dataset.theme = next;
  document.body.dataset.theme = next;
  updateButton(next);
}

function toggleTheme() {
  setTheme(currentTheme() === "day" ? "night" : "day");
}

function updateButton(theme = currentTheme()) {
  const btn = document.getElementById("btnThemeToggle");
  if (!btn) return;
  btn.textContent = theme === "day" ? "🌙 Noche" : "☀️ Día";
  btn.title = theme === "day" ? "Cambiar a modo noche" : "Cambiar a modo día";
}

function ensureThemeStyles() {
  if (document.getElementById("themeToggleStyles")) return;
  const style = document.createElement("style");
  style.id = "themeToggleStyles";
  style.textContent = `
    :root[data-theme="day"] {
      color-scheme: light;
    }

    body[data-theme="day"] {
      background: #f4f5f8 !important;
      color: #171820 !important;
    }

    body[data-theme="day"] header,
    body[data-theme="day"] .side-menu {
      background: #ffffff !important;
      border-color: #d9dce5 !important;
      color: #171820 !important;
    }

    body[data-theme="day"] .card,
    body[data-theme="day"] .compact-card,
    body[data-theme="day"] .acct-card,
    body[data-theme="day"] .stat-card,
    body[data-theme="day"] .command-card,
    body[data-theme="day"] .acct-stat,
    body[data-theme="day"] .command-grid > div,
    body[data-theme="day"] .due-cal-detail {
      background: #ffffff !important;
      border-color: #d9dce5 !important;
      color: #171820 !important;
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
    }

    body[data-theme="day"] .due-cal-detail {
      background: #6f55ff !important;
      color: #ffffff !important;
      border-color: #6f55ff !important;
    }

    body[data-theme="day"] .due-cal-detail .muted {
      color: rgba(255,255,255,0.78) !important;
    }

    body[data-theme="day"] input,
    body[data-theme="day"] select,
    body[data-theme="day"] textarea {
      background: #ffffff !important;
      color: #171820 !important;
      border-color: #cfd3df !important;
    }

    body[data-theme="day"] input::placeholder,
    body[data-theme="day"] textarea::placeholder,
    body[data-theme="day"] .muted,
    body[data-theme="day"] .stat-label,
    body[data-theme="day"] .command-label,
    body[data-theme="day"] .acct-label {
      color: #5f6678 !important;
    }

    body[data-theme="day"] .tab-btn,
    body[data-theme="day"] .menu-link,
    body[data-theme="day"] button:not(.active):not(.tab-btn.active) {
      background: #ffffff !important;
      color: #171820 !important;
      border: 1px solid #cfd3df !important;
    }

    body[data-theme="day"] .tab-btn.active,
    body[data-theme="day"] button[style*="2b63ff"],
    body[data-theme="day"] button[style*="#2b63ff"] {
      background: #2b63ff !important;
      color: #ffffff !important;
      border-color: #2b63ff !important;
    }

    body[data-theme="day"] .pill,
    body[data-theme="day"] .acct-pill,
    body[data-theme="day"] .activity-chip {
      background: #f6f7fb !important;
      border-color: #d9dce5 !important;
      color: #252836 !important;
    }

    body[data-theme="day"] .due-cal-day {
      background: #ffffff !important;
      color: #171820 !important;
      border-color: #d9dce5 !important;
    }

    body[data-theme="day"] .due-cal-day.selected {
      background: #6f55ff !important;
      color: #ffffff !important;
      border-color: #6f55ff !important;
    }

    body[data-theme="day"] a {
      color: #2757d8 !important;
    }

    body[data-theme="day"] .menu-overlay {
      background: rgba(15, 23, 42, 0.25) !important;
    }

    #btnThemeToggle {
      width: auto !important;
      min-width: 92px;
      background: #333 !important;
      color: #fff !important;
      border: 1px solid #444 !important;
      padding: 10px 14px !important;
      margin: 0 8px 0 0 !important;
      border-radius: 12px !important;
      white-space: nowrap;
    }

    body[data-theme="day"] #btnThemeToggle {
      background: #ffffff !important;
      color: #171820 !important;
      border-color: #cfd3df !important;
    }
  `;
  document.head.appendChild(style);
}

function ensureThemeButton() {
  let btn = document.getElementById("btnThemeToggle");
  if (btn) {
    updateButton();
    return;
  }

  const signOut = document.getElementById("btnSignOut");
  const container = signOut?.parentElement;
  if (!container) return;

  btn = document.createElement("button");
  btn.id = "btnThemeToggle";
  btn.type = "button";
  btn.onclick = toggleTheme;
  container.insertBefore(btn, signOut);
  updateButton();
}

function initThemeToggle() {
  ensureThemeStyles();
  setTheme(currentTheme());
  ensureThemeButton();
}

const observer = new MutationObserver(() => {
  ensureThemeButton();
  updateButton();
});

observer.observe(document.body, { childList: true, subtree: true });
initThemeToggle();
setInterval(initThemeToggle, 1500);

console.log("day/night theme toggle active");
