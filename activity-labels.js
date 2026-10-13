import { esc, money, percent, dateLabel } from './combined-workspace-ui.js?v=1';
export const actionLabels = {
  BORROWER_DUE_EVENTS_INSERT:'Cuota calculada',
  BORROWER_DUE_EVENTS_UPDATE:'Cuota recalculada',
  BORROWER_DUE_EVENTS_DELETE:'Cuota eliminada',
  PAYMENT_BORROWER_DUE_APPLICATIONS_INSERT:'Pago aplicado a una cuota',
  PAYMENT_BORROWER_DUE_APPLICATIONS_UPDATE:'Aplicación a cuota actualizada',
  PAYMENT_BORROWER_DUE_APPLICATIONS_DELETE:'Aplicación a cuota revertida',
  CLIENT_CREATED: "Cliente creado",
  CLIENT_EDITED: "Cliente editado",
  CLIENT_DELETED: "Cliente eliminado",
  DISBURSEMENT_CREATED: "Desembolso creado",
  DISBURSEMENT_EDITED: "Desembolso editado",
  DISBURSEMENT_DELETED: "Desembolso eliminado",
  DISBURSEMENT_CLOSED: "Desembolso cerrado",
  DISBURSEMENT_VOIDED: "Desembolso anulado",
  DISBURSEMENT_REACTIVATED: "Desembolso reactivado",
  DISBURSEMENT_STATUS_CHANGED: "Estado de desembolso cambiado",
  PRINCIPAL_BALANCE_CHANGED: "Balance de capital cambiado",
  ACCOUNT_PRINCIPAL_PAID_OFF: "Capital saldado",
  ACCOUNT_MARKED_DEFAULTED: "Cuenta marcada en default",
  ACCOUNT_PAUSED: "Cuenta pausada",
  ACCOUNT_PAYMENT_RECORDED: "Pago registrado",
  ACCOUNT_PAYMENT_VOIDED: "Pago anulado",
  PAYMENT_EDITED: "Pago editado",
  PAYMENT_DELETED: "Pago eliminado",
  PAYMENT_NOTES_EDITED: "Notas del pago editadas",
  FUNDING_SPLIT_ADDED: "Distribución de inversión agregada",
  FUNDING_SPLIT_EDITED: "Distribución de inversión editada",
  FUNDING_SPLIT_REMOVED: "Distribución de inversión removida",
  PARTNER_ALLOCATION_CREATED: "Distribución a socio creada",
  PARTNER_ALLOCATION_EDITED: "Distribución a socio editada",
  PARTNER_ALLOCATION_REVERSED: "Distribución a socio revertida",
  PRINCIPAL_PAYMENT_APPLIED: "Abono a capital aplicado",
  PRINCIPAL_PAYMENT_EDITED: "Abono a capital editado",
  PRINCIPAL_PAYMENT_REVERSED: "Abono a capital revertido",
  CONTACT_NOTE_CREATED: "Nota de contacto creada",
  CONTACT_NOTE_EDITED: "Nota de contacto editada",
  CONTACT_NOTE_DELETED: "Nota de contacto eliminada",
  FOLLOWUP_CREATED: "Seguimiento creado",
  FOLLOWUP_EDITED: "Seguimiento editado",
  FOLLOWUP_DELETED: "Seguimiento eliminado",
  DEFAULT_SPLIT_ADDED: "Distribución predeterminada agregada",
  DEFAULT_SPLIT_EDITED: "Distribución predeterminada editada",
  DEFAULT_SPLIT_REMOVED: "Distribución predeterminada removida",
  SETTING_CREATED: "Configuración creada",
  SETTING_EDITED: "Configuración editada",
  SETTING_DELETED: "Configuración eliminada",
  PROFILE_CREATED: "Perfil creado",
  PROFILE_EDITED: "Perfil editado",
  PROFILE_DELETED: "Perfil eliminado",
};

export const tableLabels = {
  borrower_due_events:'Cuotas calculadas',
  payment_borrower_due_applications:'Aplicaciones a cuotas',
  borrowers: "Clientes",
  loans: "Desembolsos / Capital",
  payments: "Pagos",
  loan_funding: "Distribución de inversión",
  payment_allocations: "Distribuciones a socios",
  payment_principal_applications: "Abonos a capital",
  borrower_contact_log: "Notas de contacto",
  borrower_followups: "Seguimientos",
  default_funding_splits: "Distribuciones predeterminadas",
  app_settings: "Configuración",
  profiles: "Socios y usuarios",
};

export const technicalTables=['borrower_due_events','payment_borrower_due_applications'];
export const actionName=action=>actionLabels[action]||'Movimiento registrado';
export const tableName=table=>tableLabels[table]||'Otros movimientos';
const fields={full_name:'Nombre',phone:'Teléfono',role:'Rol de acceso',amount:'Monto',paid_on:'Fecha de pago',payment_type:'Tipo de pago',principal_original:'Capital desembolsado',principal_outstanding:'Capital pendiente',applied_principal:'Capital aplicado',applied_interest:'Cuota / interés aplicado',applied_mgmt:'Administración asignada',applied_funders:'Ingreso asignado a socios',funding_percent:'Participación de inversión',allocation_type:'Tipo de distribución',due_date:'Fecha de cuota',status:'Estado',is_voided:'Anulado',voided_at:'Fecha de anulación',void_reason:'Motivo de anulación',notes:'Notas',priority:'Prioridad',contact_type:'Tipo de contacto',setting_key:'Configuración',setting_value:'Valores',monthly_rate_total:'Interés mensual',monthly_rate_mgmt:'Administración mensual',completed_at:'Completado',completed_notes:'Nota de cierre',expected_total:'Cuota esperada',paid_total:'Pagado',remaining_amount:'Pendiente'};
const values={ADMIN:'Administrador',AGENT:'Agente',PARTNER:'Socio',INSTALLMENT:'Cuota / interés',PRINCIPAL:'Abono a capital',MIXED:'Pago mixto',PAYOFF:'Saldo de capital',MANAGEMENT_FEE:'Administración',FUNDER_FEE:'Ingreso de socio',FUNDING_FEE:'Ingreso de socio',ACTIVE:'Activo',PENDING:'Pendiente',PAID:'Pagado',PARTIAL:'Pago parcial',VOID:'Anulado',CURRENT:'Al día',OVERDUE:'Atrasado',PAID_OFF:'Saldado',CLOSED:'Cerrado',OPEN:'Abierto',DONE:'Completado',loan_defaults:'Tasas predeterminadas',default_funding_split:'Distribución predeterminada'};
export function fieldName(key){return fields[key]||String(key).replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());}
export function fieldValue(key,value){
  if(value==null||value==='')return '—';if(typeof value==='boolean')return value?'Sí':'No';
  if(key==='setting_value'&&Array.isArray(value))return value.map(r=>`${r.partner_name||'Persona'}: ${percent(r.funding_percent)}`).join(' · ');
  if(key==='setting_value'&&value&&typeof value==='object'&&value.default_total_monthly_rate!=null)return `Interés mensual: ${value.default_total_monthly_rate}% · Administración: ${value.default_management_rate}%`;
  if(['amount','principal_original','principal_outstanding','applied_principal','applied_interest','applied_mgmt','applied_funders','expected_total','paid_total','remaining_amount','expected_funders','expected_mgmt','paid_funders','paid_mgmt','principal_snapshot','applied_total'].includes(key))return money(value);
  if(['funding_percent','monthly_rate_total','monthly_rate_mgmt'].includes(key))return percent(value);
  if(/(?:_on|_date|_at)$/.test(key))return dateLabel(value);
  if(typeof value==='object')return JSON.stringify(value);return values[String(value)]||String(value);
}
const ignored=key=>['id','created_at','updated_at','account_payment'].includes(key)||key.endsWith('_id')||key.endsWith('_by');
Object.assign(fields,{expected_funders:'Ingreso esperado de socios',expected_mgmt:'Administración esperada',paid_funders:'Ingreso pagado de socios',paid_mgmt:'Administración pagada',principal_snapshot:'Capital base de la cuota',applied_total:'Monto aplicado',resolved_at:'Fecha de cierre'});
Object.assign(values,{PARTNER_DISTRIBUTION:'Ingreso de socio',VOIDED:'Anulado',HIGH:'Alta',MEDIUM:'Media',LOW:'Baja',CANCELLED:'Cancelado'});
export function changeDetails(row){
  const before=row.old_data||{},after=row.new_data||{},updated=!!row.old_data&&!!row.new_data;
  const keys=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>!ignored(key)&&(!updated||JSON.stringify(before[key])!==JSON.stringify(after[key])));
  if(!keys.length)return '';
  if(updated)return `<table class="cw-change-table"><thead><tr><th>Campo</th><th>Antes</th><th>Después</th></tr></thead><tbody>${keys.map(key=>`<tr><th>${esc(fieldName(key))}</th><td>${esc(fieldValue(key,before[key]))}</td><td>${esc(fieldValue(key,after[key]))}</td></tr>`).join('')}</tbody></table>`;
  return `<dl class="cw-facts">${keys.map(key=>`<div><dt>${esc(fieldName(key))}</dt><dd>${esc(fieldValue(key,(row.new_data||row.old_data)[key]))}</dd></div>`).join('')}</dl>`;
}
export function groupActivity(rows){
  const parents=rows.filter(row=>row.entity_table==='payments'),children=new Map(),attached=new Set();
  rows.forEach(row=>{if(!['payment_allocations','payment_principal_applications'].includes(row.entity_table))return;const id=row.payment_id||row.new_data?.payment_id||row.old_data?.payment_id;
    const parent=parents.find(p=>p.payment_id===id&&p.actor_user_id===row.actor_user_id&&Math.abs(new Date(p.created_at)-new Date(row.created_at))<=2000);
    if(!parent)return;if(!children.has(parent.id))children.set(parent.id,[]);children.get(parent.id).push(row);attached.add(row.id);
  });
  return rows.filter(row=>!attached.has(row.id)).map(row=>({row,children:children.get(row.id)||[]}));
}

