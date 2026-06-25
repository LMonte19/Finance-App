// Login interaction guard.
// Prevents a stuck menu overlay or disabled controls from blocking the login screen.

function qs(id) {
  return document.getElementById(id);
}

function loginVisible() {
  const auth = qs('authCard');
  if (!auth) return false;
  return getComputedStyle(auth).display !== 'none';
}

function closeBlockingOverlayOnLogin() {
  if (!loginVisible()) return;

  document.body.classList.add('auth-visible');
  qs('menuOverlay')?.classList.remove('open');
  qs('sideMenu')?.classList.remove('open');

  const overlay = qs('menuOverlay');
  if (overlay) {
    overlay.style.display = 'none';
    overlay.style.pointerEvents = 'none';
  }

  const sideMenu = qs('sideMenu');
  if (sideMenu) {
    sideMenu.style.pointerEvents = 'none';
  }

  ['email', 'password', 'btnSignIn'].forEach((id) => {
    const el = qs(id);
    if (!el) return;
    el.disabled = false;
    el.style.pointerEvents = 'auto';
  });

  const auth = qs('authCard');
  if (auth) {
    auth.style.position = 'relative';
    auth.style.zIndex = '100';
    auth.style.pointerEvents = 'auto';
  }
}

function restoreOverlayWhenSignedIn() {
  if (loginVisible()) return;

  document.body.classList.remove('auth-visible');

  const overlay = qs('menuOverlay');
  if (overlay) {
    overlay.style.display = '';
    overlay.style.pointerEvents = '';
  }

  const sideMenu = qs('sideMenu');
  if (sideMenu) {
    sideMenu.style.pointerEvents = '';
  }
}

function tick() {
  closeBlockingOverlayOnLogin();
  restoreOverlayWhenSignedIn();
}

document.addEventListener('pointerdown', () => setTimeout(tick, 0), true);
document.addEventListener('focusin', () => setTimeout(tick, 0), true);
new MutationObserver(tick).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'disabled'] });
setInterval(tick, 700);
tick();

console.log('login interaction guard active');
