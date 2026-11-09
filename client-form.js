import { openFloatingPanel, floatingHeader } from './floating-panel.js?v=1';
import { createClientRecord, escapeText as esc } from './client-directory.js?v=1';

const editors=new WeakMap();
const groups={additional_phones:{label:'Teléfono adicional',type:'tel'},emails:{label:'Correo electrónico',type:'email'}};
export function clientFieldsMarkup() {
  return `<label>Nombre completo<input name="full_name" autocomplete="name" required></label>
    <label>Teléfono principal<input name="phone" type="tel" autocomplete="tel"></label>
    <div class="ll-contact-inputs">
      <div data-contact-list="additional_phones"></div><button type="button" class="ll-flow-link" data-contact-add="additional_phones">+ Agregar teléfono</button>
      <div data-contact-list="emails"></div><button type="button" class="ll-flow-link" data-contact-add="emails">+ Agregar correo</button>
    </div>
    <details class="ll-flow-details" data-guarantor><summary>Garante <small>(opcional)</small></summary><div class="ll-flow-fields">
      <label>Nombre del garante<input name="guarantor_name"></label><label>Teléfono del garante<input name="guarantor_phone" type="tel"></label>
      <label>Correo del garante<input name="guarantor_email" type="email"></label>
    </div></details>
    <label>Notas del cliente<textarea name="notes" rows="3"></textarea></label>`;
}
export function clientFields(form) {
  if(editors.has(form))return editors.get(form);
  const input=name=>form.querySelector(`[name="${name}"]`);
  const list=key=>form.querySelector(`[data-contact-list="${key}"]`);
  function add(key,value='',focus=false){
    const group=groups[key],row=document.createElement('div');
    row.className='ll-flow-contact-row';
    row.innerHTML=`<label>${group.label}<input type="${group.type}" data-contact-value value="${esc(value)}"></label><button type="button" class="ll-flow-remove" data-contact-remove aria-label="Quitar ${group.label.toLowerCase()}">×</button>`;
    list(key).appendChild(row);
    if(focus)row.querySelector('input').focus();
  }
  form.addEventListener('click',event=>{
    const addButton=event.target.closest('[data-contact-add]'),remove=event.target.closest('[data-contact-remove]');
    if(addButton){add(addButton.dataset.contactAdd,'',true);return;}
    if(remove){const row=remove.closest('.ll-flow-contact-row'),key=row.parentElement.dataset.contactList;row.remove();form.querySelector(`[data-contact-add="${key}"]`)?.focus();}
  });
  form.addEventListener('invalid',event=>{const details=event.target.closest('[data-guarantor]');if(details)details.open=true;},true);
  const controller={
    set(record={}){
      for(const name of ['full_name','phone','notes','guarantor_name','guarantor_phone','guarantor_email'])input(name).value=record[name]||'';
      for(const key of Object.keys(groups)){list(key).replaceChildren();for(const value of record[key]||[])add(key,value);}
      form.querySelector('[data-guarantor]').open=!!(record.guarantor_name||record.guarantor_phone||record.guarantor_email);
    },
    values(){
      const value=name=>input(name).value.trim()||null;
      const full_name=value('full_name'),phone=value('phone');
      if(!full_name)throw new Error('Escribe el nombre del cliente.');
      const values=key=>[...new Set([...list(key).querySelectorAll('input')].map(node=>node.value.trim()).filter(Boolean))];
      return {full_name,phone,notes:value('notes'),additional_phones:values('additional_phones').filter(v=>v!==phone),emails:values('emails'),
        guarantor_name:value('guarantor_name'),guarantor_phone:value('guarantor_phone'),guarantor_email:value('guarantor_email')};
    }
  };
  editors.set(form,controller);return controller;
}

export function attachNewClientForm(host,{db,onSave,onCancel,onBusy=()=>{},inline=false}){
  host.innerHTML=`${inline?'<h3 class="ll-flow-inline-title">Nuevo cliente</h3>':''}<form class="ll-floating-form">
    ${clientFieldsMarkup()}<p class="ll-floating-status" data-new-client-status role="status"></p>
    <div class="ll-floating-actions"><button type="button" data-cancel-new-client>${inline?'Volver al desembolso':'Cancelar'}</button><button type="submit">Crear cliente</button></div>
  </form>`;
  const form=host.querySelector('form'),fields=clientFields(form),status=form.querySelector('[data-new-client-status]');
  let saving=false;
  form.querySelector('[data-cancel-new-client]').onclick=()=>{if(!saving)onCancel();};
  form.onsubmit=async event=>{
    event.preventDefault();if(saving)return;
    const submit=form.querySelector('[type="submit"]');
    saving=true;submit.disabled=true;onBusy(true);
    status.classList.remove('error');status.textContent='Guardando cliente…';
    try{const row=await createClientRecord(db,fields.values());onSave(row);}
    catch(error){status.classList.add('error');status.textContent=error.message||'No se pudo crear el cliente.';}
    finally{saving=false;submit.disabled=false;onBusy(false);}
  };
  return {focus:()=>form.querySelector('[name="full_name"]').focus({preventScroll:true})};
}

export function openNewClientPanel(db,{trigger}={}){
  let saving=false;
  const panel=openFloatingPanel({label:'Nuevo cliente',trigger,html:floatingHeader('Nuevo cliente')+'<div class="ll-floating-scroll" data-new-client></div>',canClose:()=>!saving});
  if(!panel)return;
  const host=panel.body.querySelector('[data-new-client]');
  attachNewClientForm(host,{db,onCancel:()=>panel.close(),onBusy:busy=>{saving=busy;panel.setBusy(busy);},onSave:row=>{
    if(!panel.isCurrent())return;
    host.innerHTML=`<p class="ll-floating-status success" role="status">${esc(row.full_name)} se agregó a Clientes.</p><div class="ll-floating-actions"><button type="button" data-close-floating-panel>Listo</button></div>`;
    panel.focus('[data-close-floating-panel]');
  }}).focus();
}
