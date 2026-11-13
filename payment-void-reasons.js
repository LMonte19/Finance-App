import { getPageSessionId } from './page-read-runtime.js?v=1';

// Store these labels as written so new payment reversals use the same wording.
export const PAYMENT_VOID_REASONS = Object.freeze([
  'Pago duplicado',
  'Monto incorrecto',
  'Fecha incorrecta',
  'Cliente incorrecto',
  'Tipo de pago incorrecto',
  'Cuota incorrecta',
  'Distribución incorrecta',
  'Pago devuelto o rechazado',
  'Registrado por error',
]);

export function choosePaymentVoidReason(trigger) {
  const app = document.getElementById('app');
  const owner = getPageSessionId();
  if (!app || !owner || app.querySelector('.ll-void-dialog')) {
    return Promise.resolve(null);
  }

  const dialog = document.createElement('dialog');
  dialog.className = 'll-void-dialog';
  dialog.setAttribute('aria-labelledby', 'llVoidDialogTitle');
  dialog.innerHTML = `
    <form method="dialog">
      <h2 id="llVoidDialogTitle">Anular pago</h2>
      <p>Al anular este pago, se revertirán sus aplicaciones a cuotas, capital y distribuciones.</p>
      <label>Motivo de anulación
        <select name="reason" required autofocus>
          <option value="">Selecciona un motivo</option>
          ${PAYMENT_VOID_REASONS.map(reason => `<option>${reason}</option>`).join('')}
        </select>
      </label>
      <footer>
        <button type="button" data-cancel-void>Cancelar</button>
        <button type="submit" value="confirm">Confirmar anulación</button>
      </footer>
    </form>`;
  // Keep the chooser inside the drawer when invoked there, preserving its focus trap.
  (trigger?.closest('.ll-floating-content') || app).append(dialog);
  return new Promise(resolve => {
    let settled = false;
    const finish = reason => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      dialog.remove();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      resolve(reason);
    };
    const observer = new MutationObserver(() => {
      if (!dialog.isConnected || getPageSessionId() !== owner) finish(null);
    });
    observer.observe(app, { attributes: true, attributeFilter: ['style'], childList: true, subtree: true });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape' || event.key === 'Tab') event.stopPropagation();
    });
    dialog.querySelector('[data-cancel-void]').onclick = () => dialog.close();
    dialog.addEventListener('close', () => {
      const reason = dialog.querySelector('select').value;
      finish(dialog.returnValue === 'confirm' && getPageSessionId() === owner &&
        PAYMENT_VOID_REASONS.includes(reason) ? reason : null);
    }, { once: true });
    dialog.showModal();
  });
}
