import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getPageSessionId } from './page-read-runtime.js?v=1';
import { today } from './combined-workspace-ui.js?v=1';
const supabase=createClient('https://eatxkhhpjruwwibhcubf.supabase.co','sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q',{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:'loan-ledger-auth'}});
const money=value=>Number(value||0).toFixed(2);
export const REPORTS=[
  {key:'accounts',title:'Cuentas de clientes',description:'Capital, cuotas y atrasos de la cartera actual.',scope:'Estado actual',icon:'users',view:'borrower_account_summary',order:['borrower_id'],format:formatAccountRows},
  {key:'payments',title:'Pagos',description:'Monto, capital, interés y estado de cada pago.',scope:'Período seleccionado',icon:'dollar',view:'borrower_account_payments_view',date:'paid_on',order:['id'],format:formatPaymentRows},
  {key:'dues',title:'Cuotas y pendientes',description:'Cuotas esperadas, pagadas y pendientes por cliente.',scope:'Período seleccionado',icon:'calendar'},
  {key:'partners',title:'Resumen de socios',description:'Capital e ingresos acumulados por persona.',scope:'Acumulado actual',icon:'users',view:'partner_earnings_summary',order:['user_id'],format:formatPartnerRows},
  {key:'disbursements',title:'Desembolsos por socio',description:'Capital financiado y porcentaje de participación.',scope:'Período seleccionado',icon:'wallet',view:'partner_funded_loans',date:'start_date',order:['loan_id','partner_user_id'],format:formatDisbursementRows},
  {key:'allocations',title:'Distribuciones a socios',description:'Ingreso de socios, administración y anulaciones.',scope:'Período seleccionado',icon:'chart',view:'partner_allocation_details',date:'paid_on',order:['id'],format:formatAllocationRows}
];
function checkSession(owner){if(!owner||owner!==getPageSessionId()){const e=new Error('La sesión cambió. Vuelve a iniciar la exportación.');e.code='STALE_PAGE_SESSION';throw e;}}
export function validateRange({start,end}={}){if((start&&!end)||(!start&&end)||start&&end&&start>end)throw new Error('Selecciona un rango completo, con la fecha inicial anterior a la final.');}
export async function collectRows(factory){
  const owner=getPageSessionId();checkSession(owner);const rows=[];
  for(let offset=0;;offset+=500){
    checkSession(owner);const {data,error}=await factory().range(offset,offset+499);checkSession(owner);if(error)throw error;
    rows.push(...(data||[]));if(!data||data.length<500)return rows;
  }
}
export function toCsv(rows){
  if(!rows.length)return '';const headers=[...new Set(rows.flatMap(row=>Object.keys(row)))];
  const cell=value=>{if(value==null)return '';let text=typeof value==='object'?JSON.stringify(value):String(value);
    if(typeof value!=='number'&&!/^-?\d+(?:\.\d+)?$/.test(text)&&/^\s*[=+@\-\t\r]/.test(text))text="'"+text;
    return /[",\n\r]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;};
  return [headers.map(cell).join(','),...rows.map(row=>headers.map(h=>cell(row[h])).join(','))].join('\r\n');
}
export function downloadCsv(name,rows){
  if(!rows.length)throw new Error('No hay registros para exportar con estos filtros.');
  const blob=new Blob(['\uFEFF'+toCsv(rows)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`prestamos-${name}-${today()}.csv`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function exportReport(key,range){
  validateRange(range);const owner=getPageSessionId();checkSession(owner);const report=REPORTS.find(r=>r.key===key);if(!report)throw new Error('Reporte no disponible.');
  let rows;
  if(key==='dues'){
    if(!range.start||!range.end)throw new Error('Selecciona fechas para exportar las cuotas.');
    const accounts=await collectRows(()=>supabase.from('borrower_account_summary').select('borrower_id,full_name,phone,principal_balance').gt('principal_balance',0).order('borrower_id'));
    rows=[];
    for(let offset=0;offset<accounts.length;offset+=10){
      checkSession(owner);const chunks=await Promise.all(accounts.slice(offset,offset+10).map(async a=>{
        const {data,error}=await supabase.rpc('get_borrower_due_calendar',{p_borrower_id:a.borrower_id,p_start_date:range.start,p_end_date:range.end});checkSession(owner);if(error)throw error;
        return (data||[]).filter(d=>Number(d.amount_due||0)>0||['PAID','PARTIAL'].includes(d.status)).map(d=>({cliente:d.borrower_name||a.full_name,telefono:a.phone,fecha_cuota:d.due_date,estado:d.status,estado_tiempo:d.timing_status,capital_base:money(d.principal_snapshot),cuota_esperada:money(d.expected_total),pagado:money(d.paid_total),pendiente:money(d.amount_due),administracion_esperada:money(d.expected_mgmt),socios_esperado:money(d.expected_funders),virtual:d.is_virtual?'SI':'NO'}));
      }));rows.push(...chunks.flat());
    }
  }else rows=report.format(await collectRows(()=>{
    let query=supabase.from(report.view).select('*');if(report.date&&range.start)query=query.gte(report.date,range.start).lte(report.date,range.end);
    report.order.forEach(column=>{query=query.order(column,{ascending:true});});return query;
  }));
  checkSession(owner);downloadCsv(key,rows);return rows.length;
}
function formatAccountRows(rows) {
  return rows.map((r) => ({
    cliente: r.full_name,
    telefono: r.phone,
    capital_activo: money(r.principal_balance),
    total_desembolsado: money(r.total_disbursed),
    cuota_mensual: money(r.current_monthly_fee),
    cuota_por_ciclo: money(r.current_cycle_fee),
    administracion_mensual: money(r.current_monthly_mgmt),
    socios_mensual: money(r.current_monthly_funders),
    proxima_cuota: r.next_due_date,
    monto_atrasado_guardado: money(r.overdue_amount),
    cuotas_atrasadas_guardadas: r.overdue_count,
    dias_tarde_guardado: r.max_days_late,
    estado: r.account_status,
  }));
}
function formatPaymentRows(rows) {
  return rows.map((p) => ({
    cliente: p.borrower_name,
    fecha_pago: p.paid_on,
    monto: money(p.amount),
    tipo_pago: p.payment_type,
    cuota_interes: money(p.applied_interest),
    capital: money(p.applied_principal),
    administracion: money(p.applied_mgmt),
    socios: money(p.applied_funders),
    anulado: p.is_voided ? "SI" : "NO",
    motivo_anulacion: p.void_reason,
    notas: p.notes,
    creado: p.created_at,
  }));
}
function formatPartnerRows(rows) {
  return rows.map((p) => ({
    socio: p.full_name,
    rol: p.role,
    capital_activo: money(p.active_capital),
    capital_original: money(p.original_capital),
    clientes_activos: p.active_borrowers,
    desembolsos: p.funded_disbursements,
    ganancia_total: money(p.total_earned),
    ganancia_administracion: money(p.management_earned),
    ganancia_socio: money(p.funding_earned),
    distribuciones: p.allocation_count,
    distribuciones_anuladas: p.voided_allocation_count,
    monto_anulado: money(p.voided_earned),
  }));
}
function formatDisbursementRows(rows) {
  return rows.map((l) => ({
    socio: l.partner_name,
    cliente: l.borrower_name,
    telefono_cliente: l.borrower_phone,
    fecha_inicio: l.start_date,
    estado: l.status,
    porcentaje_socio: `${(Number(l.funding_percent || 0) * 100).toFixed(2)}%`,
    capital_original_prestamo: money(l.principal_original),
    capital_activo_prestamo: money(l.principal_outstanding),
    capital_original_socio: money(l.partner_original_capital),
    capital_activo_socio: money(l.partner_active_capital),
  }));
}
function formatAllocationRows(rows) {
  return rows.map((a) => ({
    socio: a.partner_name,
    tipo_distribucion: a.allocation_type,
    monto: money(a.amount),
    cliente: a.borrower_name,
    fecha_pago: a.paid_on,
    monto_pago: money(a.payment_amount),
    tipo_pago: a.payment_type,
    anulado: a.is_voided ? "SI" : "NO",
    motivo_anulacion: a.void_reason,
    creado: a.created_at,
  }));
}
