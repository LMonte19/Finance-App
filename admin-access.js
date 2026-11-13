import { floatingHeader, openFloatingPanel } from './floating-panel.js?v=1';
import { esc } from './combined-workspace-ui.js?v=2';

export const ACCESS_OWNER_ID = '984c2e7c-2506-4c7a-8510-15d1a14815b0';

export async function openAdminAccess(db, trigger) {
  let busy = false;
  const panel = openFloatingPanel({
    label: 'Administrar acceso', trigger, canClose: () => !busy,
    html: floatingHeader('Administrar acceso') + '<div class="ll-floating-scroll"><p class="ll-floating-help">Cambia el correo de acceso o restablece una contraseña sin enviar enlaces. El perfil, el rol y el historial se conservan.</p><div data-access-users></div><p class="ll-floating-status" data-access-status role="status">Cargando cuentas…</p></div>',
  });
  if (!panel) return;
  const host = panel.body.querySelector('[data-access-users]');
  const status = panel.body.querySelector('[data-access-status]');
  async function request(input) {
    const { data, error } = await db.functions.invoke('manage-app-access', { body: input });
    if (!error) return data;
    const details = await error.context?.json?.().catch(() => null);
    throw new Error(details?.message || 'No se pudo comunicar con el servicio de acceso.');
  }
  let users;
  try {
    ({ users } = await request({ action: 'list' }));
    if (!panel.isCurrent()) return;
    showList();
  } catch (error) {
    if (panel.isCurrent()) status.textContent = error.message;
  }
  function showList(message = '') {
    host.innerHTML = users.map(user => `<div class="ll-floating-line"><span><strong>${esc(user.full_name || 'Usuario')}</strong><small>${esc(user.email || 'Sin correo')} · ${user.role === 'PARTNER' ? 'Socio' : 'Agente'}${user.google ? ' · Google conectado' : ''}</small></span><div class="ll-floating-actions" style="border:0;padding:0"><button type="button" data-edit-access="${esc(user.user_id)}">Editar</button></div></div>`).join('');
    status.textContent = message || (users.length ? '' : 'No hay cuentas de socios o agentes.');
    panel.focus('[data-edit-access]');
  }
  host.addEventListener('click', event => {
    const id = event.target.closest('[data-edit-access]')?.dataset.editAccess;
    const user = users?.find(row => row.user_id === id);
    if (user) showForm(user);
  });
  function showForm(user) {
    host.innerHTML = `<form class="ll-floating-form" style="margin-top:18px">
      <div><strong>${esc(user.full_name)}</strong><p class="ll-floating-help">${esc(user.email)}</p></div>
      <label>Qué deseas cambiar<select name="action">${user.google ? '' : '<option value="email">Correo de acceso</option>'}<option value="password">Contraseña de la app</option></select></label>
      <label data-field="email">Nuevo correo<input type="email" name="email" autocomplete="off" maxlength="254"></label>
      <label data-field="password" hidden>Nueva contraseña<input type="password" name="password" autocomplete="new-password" minlength="12" maxlength="72"></label>
      <p class="ll-floating-help" data-access-help></p>
      <label style="display:flex;align-items:center;gap:8px"><input name="confirm" type="checkbox" style="width:auto;min-height:0" required>Confirmo que esta persona debe usar los nuevos datos.</label>
      <div class="ll-floating-actions"><button type="button" data-access-back>Volver</button><button type="submit">Guardar cambio</button></div>
    </form>`;
    const form = host.querySelector('form');
    const field = name => form.elements.namedItem(name);
    const back = form.querySelector('[data-access-back]');
    const save = form.querySelector('[type=submit]');
    const sync = () => {
      const action = field('action').value;
      for (const name of ['email', 'password']) {
        const input = field(name);
        input.closest('label').hidden = name !== action;
        input.closest('label').style.display = name === action ? 'grid' : 'none';
        input.disabled = name !== action;
        input.required = name === action;
      }
      field('confirm').checked = false;
      form.querySelector('[data-access-help]').textContent = action === 'email'
        ? 'Verifica el correo con la persona antes de guardarlo. Si es Gmail, después podrá elegir «Continuar con Google» con esa misma dirección.'
        : 'Usa al menos 12 caracteres. La app no te mostrará la contraseña después de guardarla.';
    };
    field('action').addEventListener('change', sync);
    back.onclick = () => showList();
    sync();
    status.textContent = '';
    panel.focus('[name=action]');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      const action = field('action').value;
      const payload = { action, id: user.user_id, currentEmail: user.email, confirm: field('confirm').checked, [action]: field(action).value };
      const controls = [...form.elements].filter(node => !node.disabled);
      controls.forEach(node => { node.disabled = true; });
      status.textContent = 'Guardando…';
      try {
        const data = await request(payload);
        if (!panel.isCurrent()) return;
        user.email = data.email;
        showList(action === 'email' ? 'Correo actualizado. El perfil y el historial se conservaron.' : 'Contraseña actualizada.');
      } catch (error) {
        if (panel.isCurrent()) status.textContent = error.message;
      } finally {
        busy = false;
        delete payload.password;
        field('password').value = '';
        controls.forEach(node => { node.disabled = false; });
      }
    });
  }
}
