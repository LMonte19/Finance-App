import { invalidatePageReads, getPageSessionId } from './page-read-runtime.js?v=1';

export const CLIENT_CHANGED = 'loan-ledger:client-details-updated';
export const CLIENT_FIELDS = 'id,full_name,phone,notes,additional_phones,emails,guarantor_name,guarantor_phone,guarantor_email,created_at';
export const escapeText = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const collator = new Intl.Collator('es',{sensitivity:'base'});
export function mergeClientAccount(accounts, client) {
  const id=String(client.id??client.borrower_id);
  const existing=accounts.find(row=>String(row.borrower_id)===id);
  const row={...existing,...client,borrower_id:id};
  return [...accounts.filter(a=>String(a.borrower_id)!==id),row].sort((a,b)=>collator.compare(a.full_name,b.full_name));
}
export function fillClientSelect(select, rows, selected=select?.value||'') {
  if(!select)return;
  const initial='<option value="">Selecciona un cliente</option>';
  const html=initial+rows.map(row=>`<option value="${escapeText(row.borrower_id??row.id)}">${escapeText(row.full_name)}</option>`).join('');
  if(select.dataset.clientOptions!==html){select.innerHTML=html;select.dataset.clientOptions=html;}
  select.value=rows.some(row=>String(row.borrower_id??row.id)===String(selected))?String(selected):'';
}
export function publishClientChange(client,{created=false}={}) {
  invalidatePageReads();
  window.dispatchEvent(new CustomEvent(CLIENT_CHANGED,{detail:{client,created}}));
}
export async function clientWriter(db) {
  const {data,error}=await db.auth.getUser();
  if(error)throw error;
  if(!data?.user?.id)throw new Error('No se encontró una sesión activa.');
  return data.user.id;
}
export async function createClientRecord(db,fields) {
  const owner=getPageSessionId(),created_by=await clientWriter(db);
  if(owner!==getPageSessionId())throw new Error('La sesión cambió. Abre el formulario de nuevo.');
  const {data,error}=await db.from('borrowers').insert({...fields,created_by}).select(CLIENT_FIELDS).single();
  if(error)throw error;
  if(owner===getPageSessionId())publishClientChange(data,{created:true});
  return data;
}
