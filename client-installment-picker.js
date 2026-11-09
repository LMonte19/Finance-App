import { floatingHeader, openFloatingPanel } from './floating-panel.js?v=1';

const TITLE = 'Calendario completo';
const MONTHS = new Intl.DateTimeFormat('es', {month:'long', timeZone:'UTC'});
const FULL_MONTH = new Intl.DateTimeFormat('es', {month:'long', year:'numeric', timeZone:'UTC'});
const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const monthOf = iso => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
const range = (from, to) => Array.from({length:to - from + 1}, (_, index) => from + index);
const dayIso = (year, month, day) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

export function openClientInstallmentPicker({rows, selectedIso, asOf, borrowerName, describeDate, trigger, onSelect, onClose}) {
  const byDate = new Map(rows.map(row => [row.due_date, row]));
  const dates = [...byDate.keys()].sort();
  const first = monthOf(dates[0] || asOf);
  const last = monthOf(dates.at(-1) || asOf);
  const firstYear = Math.floor(first / 12), lastYear = Math.floor(last / 12);
  const clamp = value => Math.min(last, Math.max(first, value));
  let monthIndex = clamp(monthOf(selectedIso || asOf));

  const panel = openFloatingPanel({label:TITLE, trigger, onClose, html:`
    ${floatingHeader(TITLE, borrowerName)}
    <div class="ll-floating-scroll cp-installment-picker">
      <div class="cp-picker-navigation">
        <button type="button" data-picker-move="-1" aria-label="Mes anterior">‹</button>
        <select data-picker-month aria-label="Mes"></select>
        <select data-picker-year aria-label="Año">${range(firstYear, lastYear).map(year => `<option value="${year}">${year}</option>`).join('')}</select>
        <button type="button" data-picker-move="1" aria-label="Mes siguiente">›</button>
      </div>
      <div class="cp-picker-calendar" data-picker-calendar role="group">
        <div class="cp-picker-week" aria-hidden="true">${WEEKDAYS.map(day => `<span>${day}</span>`).join('')}</div>
        <div class="cp-picker-days" data-picker-days></div>
      </div>
      <div class="cp-picker-legend" aria-label="Estados de las cuotas">
        <span class="ok">Saldadas</span><span class="danger">Atrasadas</span><span class="pending">Pendientes</span>
      </div>
      <p class="ll-floating-help" data-picker-hint role="status"></p>
    </div>`});
  if (!panel) return null;

  const find = selector => panel.body.querySelector(selector);
  const monthSelect = find('[data-picker-month]'), yearSelect = find('[data-picker-year]');
  const back = find('[data-picker-move="-1"]'), forward = find('[data-picker-move="1"]');
  const days = find('[data-picker-days]'), hint = find('[data-picker-hint]');
  let renderedYear;
  function render() {
    const year = Math.floor(monthIndex / 12), month = monthIndex % 12;
    const start = new Date(Date.UTC(year, month, 1));
    if (year !== renderedYear) {
      monthSelect.innerHTML = range(Math.max(0, first - year * 12), Math.min(11, last - year * 12))
        .map(value => `<option value="${value}">${MONTHS.format(new Date(Date.UTC(year, value, 1)))}</option>`).join('');
      renderedYear = year;
    }
    monthSelect.value = String(month);
    yearSelect.value = String(year);
    yearSelect.disabled = firstYear === lastYear;
    monthSelect.disabled = monthSelect.options.length === 1;
    back.disabled = monthIndex <= first;
    forward.disabled = monthIndex >= last;
    find('[data-picker-calendar]').setAttribute('aria-label', FULL_MONTH.format(start));
    const offset = (start.getUTCDay() + 6) % 7;
    const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    let installments = 0;
    days.innerHTML = '<span aria-hidden="true"></span>'.repeat(offset) + range(1, count).map(day => {
      const iso = dayIso(year, month, day), row = byDate.get(iso);
      if (!row) return `<span aria-hidden="true">${day}</span>`;
      installments++;
      const {style, description} = describeDate(iso, row);
      const selected = iso === selectedIso;
      return `<button type="button" class="cp-picker-date ${style}" data-picker-date="${iso}" aria-label="${esc(description)}" aria-pressed="${selected}">${day}</button>`;
    }).join('');
    hint.textContent = installments ? 'Elige una cuota para ver su detalle en el resumen.'
      : dates.length ? 'No hay cuotas en este mes.' : 'Este cliente todavía no tiene cuotas.';
  }
  render();
  panel.focus(!monthSelect.disabled ? '[data-picker-month]' : !yearSelect.disabled ? '[data-picker-year]' : '[data-picker-date], [data-close-floating-panel]');

  const content = find('.cp-installment-picker');
  content.addEventListener('change', event => {
    if (event.target !== monthSelect && event.target !== yearSelect) return;
    monthIndex = clamp(Number(yearSelect.value) * 12 + Number(monthSelect.value));
    render();
  });
  content.addEventListener('click', event => {
    if (!panel.isCurrent()) return;
    const move = event.target.closest('[data-picker-move]');
    if (move) {
      monthIndex = clamp(monthIndex + Number(move.dataset.pickerMove));
      render();
      if (move.disabled) panel.focus(!monthSelect.disabled ? '[data-picker-month]' : '[data-picker-move]:not(:disabled)');
      return;
    }
    const date = event.target.closest('[data-picker-date]');
    if (!date) return;
    panel.close(false, false);
    onSelect(date.dataset.pickerDate);
  });
  return panel;
}
