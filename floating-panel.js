import { getPageSessionId } from './page-read-runtime.js?v=1';

let active = null;
let sequence = 0;

function panelHost() {
  let host = document.getElementById('llFloatingPanel');
  if (host) return host;
  host = document.createElement('div');
  host.id = 'llFloatingPanel';
  host.hidden = true;
  host.dataset.noTranslate = 'true';
  host.innerHTML = '<div class="ll-floating-backdrop" data-close-floating-panel></div><aside class="ll-floating-dialog" role="dialog" aria-modal="true" tabindex="-1"><div class="ll-floating-content"></div></aside>';
  document.getElementById('app')?.appendChild(host);
  host.addEventListener('click', event => {
    if (event.target.closest('[data-close-floating-panel]')) active?.close();
  });
  host.addEventListener('keydown', event => {
    if (!active) return;
    if (event.key === 'Escape') { event.preventDefault(); active.close(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...host.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')]
      .filter(node => !node.disabled && !node.closest('[hidden]') && node.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (!first) { event.preventDefault(); host.querySelector('[role="dialog"]').focus(); return; }
    if (event.shiftKey && (document.activeElement === first || !host.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !host.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  });
  const app = document.getElementById('app');
  if (app) new MutationObserver(() => { if (app.style.display === 'none') active?.close(true, false); })
    .observe(app, { attributes: true, attributeFilter: ['style'] });
  return host;
}

// One portal for actions and receipts, independent of the currently active page.
export function openFloatingPanel({ label, html, trigger = document.activeElement, onClose, canClose = () => true }) {
  if (active && !active.close(false, false)) return null;
  const host = panelHost(), body = host.querySelector('.ll-floating-content');
  const id = ++sequence, owner = getPageSessionId();
  const backgrounds = [...new Set([...document.getElementById('app').children,
    ...document.querySelectorAll('#llGlobalSidebar,#sideMenu,#menuOverlay')])].filter(node => node !== host && !node.contains(host))
    .map(node => ({ node, inert: node.hasAttribute('inert') }));
  const previousOverflow = document.body.style.overflow;
  backgrounds.forEach(({ node }) => node.setAttribute('inert', ''));
  document.body.style.overflow = 'hidden';
  body.innerHTML = html;
  host.querySelector('[role="dialog"]').setAttribute('aria-label', label);
  host.querySelector('[role="dialog"]').removeAttribute('aria-busy');
  host.hidden = false;
  const handle = {
    body,
    isCurrent: () => active === handle && id === sequence && owner === getPageSessionId(),
    close(force = false, restoreFocus = true) {
      if (active !== handle) return true;
      if (!force && !canClose()) return false;
      active = null; sequence++; host.hidden = true;
      backgrounds.forEach(({ node, inert }) => { if (!inert) node.removeAttribute('inert'); });
      document.body.style.overflow = previousOverflow;
      onClose?.();
      body.replaceChildren();
      if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
      return true;
    },
    focus(selector) { if (handle.isCurrent()) (body.querySelector(selector) || host.querySelector('[role="dialog"]')).focus({ preventScroll: true }); },
    setBusy(busy) { if(handle.isCurrent())host.querySelector('[role="dialog"]').setAttribute('aria-busy', String(busy)); }
  };
  active = handle;
  handle.focus('input:not([disabled]),select:not([disabled]),[data-close-floating-panel],button');
  return handle;
}

export function floatingHeader(title, subtitle = '') {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return `<header class="ll-floating-head"><div>${subtitle ? `<p>${escape(subtitle)}</p>` : ''}<h2>${escape(title)}</h2></div><button type="button" data-close-floating-panel aria-label="Cerrar panel">×</button></header>`;
}

export function closeFloatingPanel(force = true) { return active?.close(force, false); }
