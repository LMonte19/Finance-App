-- Additive workflow changes. Existing clients, loans and receipts keep their data.
alter table public.borrowers
  add column if not exists additional_phones text[] not null default '{}',
  add column if not exists emails text[] not null default '{}',
  add column if not exists guarantor_name text,
  add column if not exists guarantor_phone text,
  add column if not exists guarantor_email text;

alter table public.borrower_contact_log
  add column if not exists execution_date date,
  add column if not exists installment_dates date[] not null default '{}';
alter table public.borrower_followups
  add column if not exists execution_date date,
  add column if not exists installment_dates date[] not null default '{}';

create or replace view public.borrower_contact_log_view with (security_invoker=true) as
select c.id,c.created_at,c.borrower_id,b.full_name as borrower_name,b.phone as borrower_phone,
  c.loan_id,l.start_date as loan_start_date,l.status as loan_status,c.contact_date,c.contact_type,
  c.outcome,c.notes,c.created_by,coalesce(p.full_name,'System') as created_by_name,p.role as created_by_role,
  c.execution_date,c.installment_dates
from public.borrower_contact_log c join public.borrowers b on b.id=c.borrower_id
left join public.loans l on l.id=c.loan_id left join public.profiles p on p.user_id=c.created_by;

create or replace view public.borrower_followups_view with (security_invoker=true) as
select f.id,f.created_at,f.borrower_id,b.full_name as borrower_name,b.phone as borrower_phone,
  f.loan_id,l.start_date as loan_start_date,l.status as loan_status,f.due_date,f.reason,f.priority,
  f.status,f.completed_at,f.completed_by,coalesce(done_by.full_name,'—') as completed_by_name,
  f.completed_notes,f.created_by,coalesce(created_by.full_name,'System') as created_by_name,
  created_by.role as created_by_role,
  case when f.status<>'OPEN' then f.status when f.due_date<current_date then 'OVERDUE'
    when f.due_date=current_date then 'DUE_TODAY' else 'UPCOMING' end as timing_status,
  greatest(0,current_date-f.due_date) as days_late,f.execution_date,f.installment_dates
from public.borrower_followups f join public.borrowers b on b.id=f.borrower_id
left join public.loans l on l.id=f.loan_id left join public.profiles created_by on created_by.user_id=f.created_by
left join public.profiles done_by on done_by.user_id=f.completed_by;

-- Additional contact data can also appear in audit snapshots.
revoke all on public.borrower_contact_log,public.borrower_followups,public.borrower_contact_log_view,
  public.borrower_followups_view,public.activity_log_view from public,anon;

create schema if not exists finance_workflow_private;
revoke all on schema finance_workflow_private from public,anon;
grant usage on schema finance_workflow_private to authenticated;

create or replace function finance_workflow_private.validate_installment_links()
returns trigger language plpgsql security invoker set search_path=public
as $links$
declare v_dates date[]; v_last date;
begin
  if new.loan_id is not null and not exists(select 1 from public.loans l
      where l.id=new.loan_id and l.borrower_id=new.borrower_id) then
    raise exception 'El desembolso no pertenece a este cliente.';
  end if;
  if cardinality(new.installment_dates)=0 then return new; end if;
  select array_agg(distinct d order by d),max(d) into v_dates,v_last from unnest(new.installment_dates) d;
  if cardinality(v_dates)>120 or v_last is null or not isfinite(v_last) or array_position(v_dates,null::date) is not null
    or v_last>(current_date+interval '2 years')::date then
    raise exception 'Revisa las fechas de cuota vinculadas.';
  end if;
  if (select count(*) from public.borrower_due_timeline(new.borrower_id,v_last) t
      where t.due_date=any(v_dates) and t.status<>'CANCELLED')<>cardinality(v_dates) then
    raise exception 'Al menos una cuota vinculada no pertenece a este cliente.';
  end if;
  new.installment_dates:=v_dates;
  return new;
end;
$links$;

revoke all on function finance_workflow_private.validate_installment_links() from public,anon,authenticated;
drop trigger if exists validate_installment_links on public.borrower_contact_log;
create trigger validate_installment_links before insert or update of borrower_id,loan_id,installment_dates
  on public.borrower_contact_log for each row execute function finance_workflow_private.validate_installment_links();
drop trigger if exists validate_installment_links on public.borrower_followups;
create trigger validate_installment_links before insert or update of borrower_id,loan_id,installment_dates
  on public.borrower_followups for each row execute function finance_workflow_private.validate_installment_links();

alter table public.loan_funding add column if not exists contributed_amount numeric(12,2)
  check (contributed_amount>0);

-- Replace the current ownership of a disbursement atomically. The private
-- function only elevates the removal of a previous contributor, and validates
-- the same administrator role as the existing loan_funding write policies.
create or replace function finance_workflow_private.set_loan_contributions(p_loan_id uuid,p_contributions jsonb)
returns void language plpgsql security definer set search_path=''
as $funding$
declare
  v_borrower uuid; v_principal numeric; v_count integer; v_unique integer; v_total numeric; v_invalid integer;
begin
  if auth.uid() is null or coalesce((select p.role from public.profiles p where p.user_id=auth.uid()),'')<>'ADMIN' then
    raise exception 'Solo un administrador puede guardar la distribución de inversión.';
  end if;
  select borrower_id into v_borrower from public.loans where id=p_loan_id;
  if not found then raise exception 'No se encontró el desembolso.'; end if;
  perform 1 from public.borrowers where id=v_borrower for update;
  select principal_original into v_principal from public.loans where id=p_loan_id and status<>'VOIDED' for update;
  if not found or v_principal<=0 then raise exception 'Este desembolso no admite cambios de distribución.'; end if;
  if jsonb_typeof(p_contributions) is distinct from 'array' then
    raise exception 'Agrega al menos un socio y su aporte.';
  end if;
  if jsonb_array_length(p_contributions) not between 1 and 50 then
    raise exception 'Agrega entre 1 y 50 socios.';
  end if;
  select count(*),count(distinct x.partner_user_id),sum(x.amount),
    count(*) filter(where p.user_id is null or x.amount is null or
      x.amount::text in ('NaN','Infinity','-Infinity') or x.amount<=0 or x.amount<>round(x.amount,2))
    into v_count,v_unique,v_total,v_invalid
  from jsonb_to_recordset(p_contributions) x(partner_user_id uuid,amount numeric)
  left join public.profiles p on p.user_id=x.partner_user_id and p.role in ('ADMIN','PARTNER');
  if v_invalid>0 or v_count<>v_unique then raise exception 'Selecciona socios distintos y aporta importes válidos.'; end if;
  if v_total<>v_principal then raise exception 'Los aportes deben sumar exactamente el capital desembolsado.'; end if;

  -- Preserve the legacy four-decimal percentage for reports and keep cents
  -- in contributed_amount. Give any rounding residual to the largest share.
  delete from public.loan_funding f where f.loan_id=p_loan_id and not exists(
    select 1 from jsonb_to_recordset(p_contributions) x(partner_user_id uuid) where x.partner_user_id=f.partner_user_id);
  insert into public.loan_funding as existing(loan_id,partner_user_id,contributed_amount,funding_percent)
  select p_loan_id,x.partner_user_id,x.amount,
    (x.units+case when x.rank=1 then 10000-sum(x.units) over() else 0 end)/10000
  from (
    select x.*,greatest(1,floor(x.amount*10000/v_principal)) as units,
      row_number() over(order by x.amount desc,x.partner_user_id) as rank
    from jsonb_to_recordset(p_contributions) x(partner_user_id uuid,amount numeric)
  ) x
  on conflict(loan_id,partner_user_id) do update
    set contributed_amount=excluded.contributed_amount,funding_percent=excluded.funding_percent
  where (existing.contributed_amount,existing.funding_percent) is distinct from
    (excluded.contributed_amount,excluded.funding_percent);
end;
$funding$;

create or replace function public.update_loan_contributions(p_loan_id uuid,p_contributions jsonb)
returns void language sql security invoker set search_path=public
as $edit$ select finance_workflow_private.set_loan_contributions(p_loan_id,p_contributions); $edit$;

create or replace function public.create_funded_disbursement(
  p_borrower_id uuid,p_start_date date,p_principal numeric,p_rate_total numeric,p_rate_mgmt numeric,
  p_notes text,p_contributions jsonb
)
returns uuid language plpgsql security invoker set search_path=public
as $loan$
declare v_id uuid;
begin
  if auth.uid() is null or coalesce((select p.role from public.profiles p where p.user_id=auth.uid()),'')<>'ADMIN' then
    raise exception 'Solo un administrador puede guardar desembolsos con distribución de inversión.';
  end if;
  if p_start_date is null or not isfinite(p_start_date) or p_principal is null
    or p_principal not between .01 and 9999999999.99 or p_principal<>round(p_principal,2) then
    raise exception 'Indica una fecha y un importe válido para el desembolso.';
  end if;
  if p_rate_total is null or p_rate_mgmt is null or p_rate_total not between 0 and 99.9999
    or p_rate_mgmt not between 0 and p_rate_total or p_rate_total<>round(p_rate_total,4) or p_rate_mgmt<>round(p_rate_mgmt,4) then
    raise exception 'Revisa el interés mensual y la administración.';
  end if;
  perform 1 from public.borrowers where id=p_borrower_id for update;
  if not found then raise exception 'No se encontró el cliente.'; end if;
  insert into public.loans(borrower_id,created_by,start_date,principal_original,principal_outstanding,
    monthly_rate_total,monthly_rate_mgmt,notes,status)
  values(p_borrower_id,auth.uid(),p_start_date,p_principal,p_principal,p_rate_total,p_rate_mgmt,nullif(btrim(p_notes),''),'ACTIVE')
  returning id into v_id;
  perform finance_workflow_private.set_loan_contributions(v_id,p_contributions);
  return v_id;
end;
$loan$;

revoke all on function finance_workflow_private.set_loan_contributions(uuid,jsonb),
  public.update_loan_contributions(uuid,jsonb),
  public.create_funded_disbursement(uuid,date,numeric,numeric,numeric,text,jsonb) from public,anon;
grant execute on function finance_workflow_private.set_loan_contributions(uuid,jsonb),
  public.update_loan_contributions(uuid,jsonb),
  public.create_funded_disbursement(uuid,date,numeric,numeric,numeric,text,jsonb) to authenticated;

-- Date-targeted payments share one exact ledger path for installments, capital,
-- mixed payments and payoffs. A null date array retains oldest-first application.
create or replace function public.record_borrower_payment(
  p_borrower_id uuid,p_paid_on date,p_amount numeric,p_payment_type text,p_notes text,
  p_installment_amount numeric default null,p_principal_amount numeric default null,
  p_due_dates date[] default null,p_partner_split jsonb default null
)
returns uuid language plpgsql security invoker set search_path=public
as $payment$
declare
  v_type text:=upper(coalesce(p_payment_type,'INSTALLMENT'));
  v_anchor uuid; v_payment uuid; v_admin uuid; v_due_id uuid;
  v_fee numeric; v_capital numeric; v_fee_left numeric; v_capital_left numeric; v_balance numeric;
  v_due record; v_loan record; v_apply numeric; v_mgmt numeric; v_funders numeric;
  v_mgmt_total numeric:=0; v_funders_total numeric:=0;
  v_due_apps jsonb:='[]'; v_principal_apps jsonb:='[]';
  v_current date; v_through date; v_dates date[]; v_due_count integer:=0;
  v_weights jsonb; v_missing boolean; v_weight_total numeric;
begin
  if auth.uid() is null or coalesce(public.app_role(),'') not in ('ADMIN','AGENT') then
    raise exception 'Solo un administrador o agente puede registrar pagos.';
  end if;
  if p_paid_on is null or not isfinite(p_paid_on) or p_amount is null
    or p_amount not between .01 and 9999999999.99 or p_amount<>round(p_amount,2) then
    raise exception 'Completa la fecha y un monto de pago válido.';
  end if;
  if v_type not in ('INSTALLMENT','MIXED','PRINCIPAL','PAYOFF') then raise exception 'Tipo de pago inválido.'; end if;
  v_fee:=case v_type when 'MIXED' then p_installment_amount when 'INSTALLMENT' then p_amount else 0 end;
  v_capital:=case v_type when 'MIXED' then p_principal_amount when 'INSTALLMENT' then 0 else p_amount end;
  if v_fee is null or v_capital is null or v_fee not between 0 and p_amount or v_capital not between 0 and p_amount
    or v_fee<>round(v_fee,2) or v_capital<>round(v_capital,2) or v_fee+v_capital<>p_amount then
    raise exception 'La cuota y el abono al capital deben sumar el monto total del pago.';
  end if;
  if v_fee=0 and (p_due_dates is not null or p_partner_split is not null) then
    raise exception 'Solo la parte de cuota admite fechas o distribución entre socios.';
  end if;
  v_fee_left:=v_fee; v_capital_left:=v_capital;
  perform 1 from public.borrowers where id=p_borrower_id for update;
  if not found then raise exception 'No se encontró la cuenta del cliente.'; end if;
  select id into v_anchor from public.loans
    where borrower_id=p_borrower_id and status<>'VOIDED' and start_date<=p_paid_on
    order by start_date,created_at,id limit 1;
  if v_anchor is null then raise exception 'No hay un desembolso disponible para esa fecha.'; end if;
  select coalesce(sum(principal_outstanding),0) into v_balance from public.loans
    where borrower_id=p_borrower_id and status='ACTIVE' and start_date<=p_paid_on;
  if v_capital>v_balance then raise exception 'El abono supera el capital pendiente a la fecha del pago.'; end if;
  if v_type='PAYOFF' and v_capital<>v_balance then raise exception 'Para saldar capital, ingresa el capital pendiente completo.'; end if;

  if v_fee>0 then
    if p_due_dates is not null then
      if cardinality(p_due_dates) not between 1 and 120 or array_position(p_due_dates,null::date) is not null then
        raise exception 'Selecciona al menos una cuota válida.';
      end if;
      select array_agg(distinct d order by d),max(d) into v_dates,v_through from unnest(p_due_dates) d;
      if not isfinite(v_through) or v_through>greatest((p_paid_on+interval '1 year')::date,
          (date_trunc('month',current_date)+interval '19 months' - interval '1 day')::date) then
        raise exception 'La fecha seleccionada queda fuera del calendario disponible.';
      end if;
    elsif v_type='MIXED' then
      v_through:=(p_paid_on+interval '1 year')::date;
    else
      select min(due_date) into v_current from public.payment_schedule_dates(p_paid_on,p_paid_on+31);
      v_through:=greatest(current_date,p_paid_on,v_current,
        (select max(due_date) from public.borrower_due_events where borrower_id=p_borrower_id));
    end if;

    for v_due in
      select t.* from public.borrower_due_timeline(p_borrower_id,v_through) t
      where t.amount_due>0 and (v_dates is null or t.due_date=any(v_dates)) order by t.due_date
    loop
      v_due_count:=v_due_count+1;
      if v_fee_left<=0 then
        exit when v_dates is null;
        continue;
      end if;
      v_apply:=least(v_due.amount_due,v_fee_left);
      v_mgmt:=least(greatest(0,round(v_due.expected_mgmt-v_due.paid_mgmt,2)),v_apply);
      v_funders:=v_apply-v_mgmt;
      insert into public.borrower_due_events as booked
        (borrower_id,due_date,principal_snapshot,expected_total,expected_mgmt,expected_funders,
          paid_total,paid_mgmt,paid_funders,status,resolved_at)
      values(p_borrower_id,v_due.due_date,v_due.principal_snapshot,v_due.expected_total,v_due.expected_mgmt,
        v_due.expected_funders,v_apply,v_mgmt,v_funders,
        case when v_apply=v_due.amount_due then 'PAID' else 'PARTIAL' end,
        case when v_apply=v_due.amount_due then now() else null end)
      on conflict(borrower_id,due_date) do update set principal_snapshot=excluded.principal_snapshot,
        expected_total=excluded.expected_total,expected_mgmt=excluded.expected_mgmt,expected_funders=excluded.expected_funders,
        paid_total=booked.paid_total+excluded.paid_total,paid_mgmt=booked.paid_mgmt+excluded.paid_mgmt,
        paid_funders=booked.paid_funders+excluded.paid_funders,status=excluded.status,resolved_at=excluded.resolved_at
      returning id into v_due_id;
      v_due_apps:=v_due_apps||jsonb_build_array(jsonb_build_object('due_id',v_due_id,'due_date',v_due.due_date,
        'total',v_apply,'mgmt',v_mgmt,'funders',v_funders));
      v_mgmt_total:=v_mgmt_total+v_mgmt; v_funders_total:=v_funders_total+v_funders;
      v_fee_left:=v_fee_left-v_apply;
    end loop;
    if v_dates is not null and v_due_count<>cardinality(v_dates) then
      raise exception 'Alguna cuota seleccionada ya está saldada o no existe. Revisa el calendario.';
    end if;
    if v_fee_left<>0 then
      raise exception 'La parte de cuota supera el saldo disponible en las fechas elegidas.';
    end if;
  end if;

  if p_partner_split is not null and v_funders_total<=0 then
    raise exception 'Este pago no tiene una parte para distribuir entre socios.';
  end if;
  if v_funders_total>0 then
    if p_partner_split is not null then
      if jsonb_typeof(p_partner_split) is distinct from 'array' then raise exception 'Distribución de pago inválida.'; end if;
      if jsonb_array_length(p_partner_split) not between 1 and 50 then raise exception 'Elige al menos un socio.'; end if;
      select coalesce(jsonb_agg(to_jsonb(x) order by x.partner_user_id),'[]'),sum(x.weight),
        count(*)<>count(distinct x.partner_user_id) or bool_or(x.weight is null or x.weight not between .01 and 100
          or x.weight<>round(x.weight,2) or not exists(select 1 from public.loans l
            join public.loan_funding f on f.loan_id=l.id where l.borrower_id=p_borrower_id
            and l.status<>'VOIDED' and f.partner_user_id=x.partner_user_id))
        into v_weights,v_weight_total,v_missing
      from jsonb_to_recordset(p_partner_split) x(partner_user_id uuid,weight numeric);
      if v_missing or v_weight_total is distinct from 100::numeric then
        raise exception 'Selecciona socios de esta cuenta y porcentajes que sumen 100%%.';
      end if;
    else
      -- Each fee follows the loans that generated that particular installment.
      -- A later disbursement does not get a share of an earlier installment.
      with dues as (
        select * from jsonb_to_recordset(v_due_apps) d(due_date date,funders numeric) where funders>0
      ), loans as materialized (
        select l.* from public.loans l where l.borrower_id=p_borrower_id and l.status<>'VOIDED'
          and l.start_date<=(select max(due_date) from dues)
      ), principal_moves as materialized (
        select a.loan_id,greatest(p.paid_on,l.start_date) as effective_on,a.amount
        from public.payment_principal_applications a join loans l on l.id=a.loan_id
          join public.payments p on p.id=a.payment_id and not coalesce(p.is_voided,false)
        union all
        select p.loan_id,greatest(p.paid_on,l.start_date),p.applied_principal
        from public.payments p join loans l on l.id=p.loan_id
        where not coalesce(p.is_voided,false) and p.applied_principal>0 and not exists(
          select 1 from public.payment_principal_applications a where a.payment_id=p.id)
      ), loan_fees as materialized (
        select d.due_date,l.id as loan_id,l.principal_original,
          greatest(0,l.principal_original-coalesce((select sum(m.amount) from principal_moves m
            where m.loan_id=l.id and m.effective_on<d.due_date),0)) *
          greatest(0,coalesce(l.monthly_rate_total,.10)-coalesce(l.monthly_rate_mgmt,.03)) as fee_weight
        from dues d join loans l on l.start_date<=d.due_date
      ), shares as materialized (
        select l.due_date,f.partner_user_id,l.fee_weight*coalesce(
          f.contributed_amount/nullif(l.principal_original,0),f.funding_percent) as weight
        from loan_fees l join public.loan_funding f on f.loan_id=l.loan_id
        where l.fee_weight>0
      ), totals as (
        select due_date,sum(weight) as total from shares group by due_date
      ), split as (
        select s.partner_user_id,sum(d.funders*s.weight/t.total) as weight
        from shares s join dues d using(due_date) join totals t using(due_date)
        where t.total>0 group by s.partner_user_id
      )
      select coalesce(jsonb_agg(to_jsonb(split) order by partner_user_id),'[]'),sum(weight),
        exists(select 1 from loan_fees l where l.fee_weight>0 and
          abs(1-coalesce((select sum(coalesce(f.contributed_amount/nullif(l.principal_original,0),f.funding_percent))
            from public.loan_funding f where f.loan_id=l.loan_id),0))>.001)
        or exists(select 1 from dues d where not exists(select 1 from totals t where t.due_date=d.due_date and t.total>0))
        into v_weights,v_weight_total,v_missing from split;
      if v_missing or coalesce(v_weight_total,0)<=0 then
        raise exception 'Revisa la distribución de inversión de los desembolsos que generaron estas cuotas.';
      end if;
    end if;
  end if;

  -- Snapshot the fee weights before applying any principal from this payment.
  for v_loan in
    select id,principal_outstanding from public.loans where borrower_id=p_borrower_id
      and status='ACTIVE' and start_date<=p_paid_on and principal_outstanding>0
    order by start_date,created_at,id for update
  loop
    exit when v_capital_left<=0;
    v_apply:=least(v_capital_left,v_loan.principal_outstanding);
    update public.loans set principal_outstanding=principal_outstanding-v_apply,
      status=case when principal_outstanding=v_apply then 'PAID_OFF' else status end,
      closed_at=case when principal_outstanding=v_apply then now() else closed_at end,
      closed_by=case when principal_outstanding=v_apply then auth.uid() else closed_by end
    where id=v_loan.id;
    v_principal_apps:=v_principal_apps||jsonb_build_array(jsonb_build_object('loan_id',v_loan.id,'amount',v_apply));
    v_capital_left:=v_capital_left-v_apply;
  end loop;
  if v_capital_left<>0 then raise exception 'No se pudo aplicar el abono exacto al capital.'; end if;

  insert into public.payments(loan_id,borrower_id,paid_on,amount,applied_interest,applied_mgmt,
    applied_funders,applied_principal,notes,created_by,payment_type,account_payment)
  values(v_anchor,p_borrower_id,p_paid_on,p_amount,v_fee,v_mgmt_total,v_funders_total,v_capital,
    nullif(btrim(p_notes),''),auth.uid(),v_type,true)
  returning id into v_payment;
  insert into public.payment_borrower_due_applications(payment_id,borrower_due_event_id,applied_total,applied_mgmt,applied_funders)
    select v_payment,a.due_id,a.total,a.mgmt,a.funders
    from jsonb_to_recordset(v_due_apps) a(due_id uuid,total numeric,mgmt numeric,funders numeric);
  insert into public.payment_principal_applications(payment_id,loan_id,borrower_id,amount)
    select v_payment,a.loan_id,p_borrower_id,a.amount from jsonb_to_recordset(v_principal_apps) a(loan_id uuid,amount numeric);
  if v_mgmt_total>0 then
    select user_id into v_admin from public.profiles where role='ADMIN' order by created_at,user_id limit 1;
    if v_admin is null then raise exception 'No hay un administrador para asignar la administración.'; end if;
    insert into public.payment_allocations(payment_id,partner_user_id,amount,allocation_type)
      values(v_payment,v_admin,v_mgmt_total,'MANAGEMENT_FEE');
  end if;
  if v_funders_total>0 then
    insert into public.payment_allocations(payment_id,partner_user_id,amount,allocation_type)
    select v_payment,partner_user_id,portion,'PARTNER_DISTRIBUTION' from (
      select partner_user_id,round(v_funders_total*running/v_weight_total,2)
        -round(v_funders_total*(running-weight)/v_weight_total,2) as portion
      from (
        select partner_user_id,weight,sum(weight) over(order by partner_user_id) as running
        from jsonb_to_recordset(v_weights) w(partner_user_id uuid,weight numeric)
      ) cumulative
    ) portions where portion>0;
  end if;
  if v_capital>0 then perform public.regenerate_future_borrower_due_events(p_borrower_id,12); end if;
  return v_payment;
end;
$payment$;

revoke all on function public.record_borrower_payment(uuid,date,numeric,text,text,numeric,numeric,date[],jsonb) from public,anon;
grant execute on function public.record_borrower_payment(uuid,date,numeric,text,text,numeric,numeric,date[],jsonb) to authenticated;

-- Read only the contributor choices for the selected account.
create or replace function public.get_borrower_payment_partners(p_borrower_id uuid)
returns table(user_id uuid,full_name text) language sql stable security invoker set search_path=public
as $partners$
  select distinct p.user_id,p.full_name from public.loans l
  join public.loan_funding f on f.loan_id=l.id join public.profiles p on p.user_id=f.partner_user_id
  where l.borrower_id=p_borrower_id and l.status<>'VOIDED' order by p.full_name,p.user_id
$partners$;
revoke all on function public.get_borrower_payment_partners(uuid) from public,anon;
grant execute on function public.get_borrower_payment_partners(uuid) to authenticated;
