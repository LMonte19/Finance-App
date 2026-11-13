import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { openFloatingPanel, floatingHeader } from './floating-panel.js?v=1';
import { openPaymentDetails } from './payment-management.js?v=13';
import { actionName, changeDetails } from './activity-labels.js?v=1';

const db=createClient('https://eatxkhhpjruwwibhcubf.supabase.co','sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q',{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:'loan-ledger-auth'}});
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(value||0));
const dateLabel=iso=>iso?new Date(String(iso).slice(0,10)+'T00:00:00').toLocaleDateString('es',{day:'numeric',month:'short',year:'numeric'}).replace('.',''):'—';
const status=value=>({ACTIVE:'Activo',PAID_OFF:'Saldado',CLOSED:'Cerrado',VOIDED:'Anulado',VOID:'Anulado',OPEN:'Pendiente',DONE:'Completado',NORMAL:'Normal',HIGH:'Alta',LOW:'Baja',URGENT:'Urgente'}[value]||value||'—');
const contact=value=>({NOTE:'Nota',CALL:'Llamada',TEXT:'Texto',WHATSAPP:'WhatsApp',EMAIL:'Correo',IN_PERSON:'En persona',OTHER:'Otro'}[value]||value||'Nota');
const fact=(label,value)=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
const section=(title,text)=>text?`<section class="ll-floating-section"><h3>${esc(title)}</h3><p>${esc(text)}</p></section>`:'';

function recordHtml(kind,row,name){
  const dates=`${row.execution_date?fact('Fecha de ejecución',dateLabel(row.execution_date)):''}${row.installment_dates?.length?fact('Cuotas vinculadas',row.installment_dates.map(dateLabel).join(', ')):''}`;
  if(kind==='disbursement')return `<dl class="ll-floating-facts">${fact('Capital desembolsado',money(row.principal_original))}${fact('Capital pendiente',money(row.principal_outstanding))}${fact('Fecha de inicio',dateLabel(row.start_date))}${fact('Estado',status(row.status))}${fact('Interés mensual',Number(Number(row.monthly_rate_total||0)*100).toFixed(2)+'%')}${fact('Administración mensual',Number(Number(row.monthly_rate_mgmt||0)*100).toFixed(2)+'%')}</dl>${section('Notas',row.notes)}<section class="ll-floating-section"><h3>Distribución de inversión</h3>${row.funding?.length?row.funding.map(f=>`<div class="ll-floating-line"><span>${esc(f.partner_name||'Socio')}</span><strong>${f.contributed_amount==null?(Number(f.funding_percent||0)*100).toFixed(2)+'%':money(f.contributed_amount)+' · '+(Number(f.contributed_amount)/Number(row.principal_original)*100).toFixed(2)+'%'}</strong></div>`).join(''):'<p>Sin distribución vinculada.</p>'}</section>`;
  if(kind==='note')return `<dl class="ll-floating-facts">${fact('Tipo de contacto',contact(row.contact_type))}${fact('Fecha',dateLabel(row.contact_date))}${fact('Registrado por',row.created_by_name||'—')}${fact('Cuenta',name||row.borrower_name||'Cliente')}${dates}</dl>${section('Resultado',row.outcome)}${section('Nota de contacto',row.notes)}`;
  return `<dl class="ll-floating-facts">${fact('Fecha de seguimiento',dateLabel(row.due_date))}${fact('Prioridad',status(row.priority))}${fact('Estado',status(row.status))}${fact('Registrado por',row.created_by_name||'—')}${dates}</dl>${section('Motivo',row.reason)}${section('Nota de cierre',row.completed_notes)}`;
}

export async function openActivityDetails({kind,id,record=null,borrowerName=''}){
  if(kind==='payment')return openPaymentDetails(id,record?{...record,borrower_name:record.borrower_name||borrowerName}:null);
  const titles={disbursement:'Detalle del desembolso',note:'Detalle del contacto',followup:'Detalle del seguimiento'};
  const title=titles[kind];if(!title)return;
  const cached=record&&(kind!=='disbursement'||Array.isArray(record.funding));
  const panel=openFloatingPanel({label:title,html:floatingHeader(title,borrowerName)+`<div class="ll-floating-scroll" data-activity-detail>${cached?recordHtml(kind,record,borrowerName):'<p class="ll-floating-help">Consultando el movimiento…</p>'}</div>`});
  if(!panel||cached)return;
  try{
    const table={disbursement:'borrower_disbursements_view',note:'borrower_contact_log_view',followup:'borrower_followups_view'}[kind];
    const result=await db.from(table).select('*').eq('id',id).single();
    if(result.error)throw result.error;
    let row=result.data;
    if(kind==='disbursement'){
      const [funding,profiles]=await Promise.all([db.from('loan_funding').select('partner_user_id,funding_percent,contributed_amount').eq('loan_id',id),db.from('profiles').select('user_id,full_name')]);
      if(funding.error)throw funding.error;if(profiles.error)throw profiles.error;
      const names=new Map((profiles.data||[]).map(p=>[p.user_id,p.full_name]));
      row={...row,funding:(funding.data||[]).map(f=>({...f,partner_name:names.get(f.partner_user_id)||'Socio'}))};
    }
    if(panel.isCurrent())panel.body.querySelector('[data-activity-detail]').innerHTML=recordHtml(kind,row,borrowerName);
  }catch(error){if(panel.isCurrent())panel.body.querySelector('[data-activity-detail]').innerHTML=`<p class="ll-floating-status error">${esc(error.message||'No se pudo consultar el movimiento.')}</p>`;}
}

export function openActivityEntry(row){
  const id=row.entity_id||row.new_data?.id||row.old_data?.id;
  const paymentId=row.payment_id||(row.entity_table==='payments'?id:null);
  if(paymentId&&!/DELETED/.test(row.action_type))return openActivityDetails({kind:'payment',id:paymentId,borrowerName:row.borrower_name});
  const kind={loans:'disbursement',borrower_contact_log:'note',borrower_followups:'followup'}[row.entity_table];
  if(kind&&id&&!/DELETED/.test(row.action_type))return openActivityDetails({kind,id,borrowerName:row.borrower_name});
  return openFloatingPanel({label:'Detalle de actividad',html:floatingHeader(actionName(row.action_type),row.borrower_name||'Actividad de la aplicación')+`<div class="ll-floating-scroll"><dl class="ll-floating-facts">${fact('Fecha',dateLabel(row.created_at))}${fact('Registrado por',row.actor_name||'Sistema')}</dl>${section('Descripción',row.summary)}<section class="ll-floating-section"><h3>Detalles del movimiento</h3>${changeDetails(row)||'<p>No hay cambios adicionales registrados.</p>'}</section></div>`});
}
