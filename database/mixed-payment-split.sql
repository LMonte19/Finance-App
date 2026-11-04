-- A mixed payment has two explicit budgets and creates one auditable payment.
-- Previewing or editing the split never writes financial records.
create or replace function public.get_borrower_mixed_payment_context(p_borrower_id uuid,p_paid_on date)
returns jsonb language sql stable security invoker set search_path=public
as $context$
with allowed as (select id from public.borrowers where id=p_borrower_id),
next_cycle as (
  select min(due_date) as due_date from public.payment_schedule_dates(p_paid_on,p_paid_on+32)
), timeline as materialized (
  select * from public.borrower_due_timeline(p_borrower_id,(p_paid_on+interval '1 year')::date)
  where exists(select 1 from allowed)
)
select jsonb_build_object(
  'cycle_due_date',(select due_date from next_cycle),
  'cycle_amount',coalesce((select amount_due from timeline where due_date=(select due_date from next_cycle)),0),
  'pending_interest',coalesce((select sum(amount_due) from timeline),0),
  'overdue_amount',coalesce((select sum(amount_due) from timeline where due_date<p_paid_on),0),
  'principal_balance',coalesce((select sum(principal_outstanding) from public.loans
    where borrower_id=p_borrower_id and status='ACTIVE' and start_date<=p_paid_on),0))
where exists(select 1 from allowed);
$context$;

create or replace function public.apply_borrower_mixed_payment(
  p_borrower_id uuid,p_paid_on date,p_amount numeric,
  p_installment_amount numeric,p_principal_amount numeric,p_notes text default null)
returns uuid language plpgsql security invoker set search_path=public
as $mixed$
declare
  v_context jsonb; v_anchor uuid; v_admin uuid; v_payment uuid;
  v_fee_left numeric:=p_installment_amount; v_capital_left numeric:=p_principal_amount;
  v_due record; v_loan record; v_apply numeric; v_mgmt numeric; v_funders numeric;
  v_mgmt_total numeric:=0; v_funders_total numeric:=0;
  v_due_apps jsonb:='[]'; v_principal_apps jsonb:='[]'; v_weights jsonb:='[]';
  v_weight numeric; v_weight_total numeric; v_allocation_left numeric; v_amount numeric;
  v_index bigint; v_partner record;
begin
  if auth.uid() is null or coalesce(public.app_role(),'') not in ('ADMIN','AGENT') then
    raise exception 'Solo un administrador o agente puede registrar pagos.';
  end if;
  if p_paid_on is null or p_amount is null or p_installment_amount is null or p_principal_amount is null
    or p_amount::text in ('NaN','Infinity','-Infinity')
    or p_installment_amount::text in ('NaN','Infinity','-Infinity')
    or p_principal_amount::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Completa la fecha y los importes del pago.';
  end if;
  if p_amount<=0 or p_installment_amount<0 or p_principal_amount<0
    or p_amount<>round(p_amount,2) or p_installment_amount<>round(p_installment_amount,2)
    or p_principal_amount<>round(p_principal_amount,2) then
    raise exception 'Usa importes válidos con un máximo de dos decimales.';
  end if;
  if p_installment_amount+p_principal_amount<>p_amount then
    raise exception 'La cuota y el abono al capital deben sumar el monto total del pago.';
  end if;

  perform 1 from public.borrowers where id=p_borrower_id for update;
  if not found then raise exception 'No se encontró la cuenta del cliente.'; end if;
  v_context:=public.get_borrower_mixed_payment_context(p_borrower_id,p_paid_on);
  if p_principal_amount>coalesce((v_context->>'principal_balance')::numeric,0) then
    raise exception 'El abono supera el capital pendiente de la cuenta.';
  end if;
  if p_installment_amount>coalesce((v_context->>'pending_interest')::numeric,0) then
    raise exception 'La parte de cuota supera las cuotas pendientes disponibles. Ajusta el desglose.';
  end if;
  select id into v_anchor from public.loans
  where borrower_id=p_borrower_id and status not in ('VOIDED','VOID') and start_date<=p_paid_on
  order by start_date,created_at,id limit 1;
  if v_anchor is null then raise exception 'No hay un desembolso disponible para esa fecha.'; end if;

  -- Snapshot participation before reducing capital, including a full payoff.
  with weights as (
    select lf.partner_user_id,
      sum(case when exists(select 1 from public.loans x where x.borrower_id=p_borrower_id
          and x.status='ACTIVE' and x.start_date<=p_paid_on and x.principal_outstanding>0)
        then case when l.status='ACTIVE' then l.principal_outstanding else 0 end
        else l.principal_original end * lf.funding_percent) as weight
    from public.loans l join public.loan_funding lf on lf.loan_id=l.id
    where l.borrower_id=p_borrower_id and l.status not in ('VOIDED','VOID') and l.start_date<=p_paid_on
    group by lf.partner_user_id
  ) select coalesce(jsonb_agg(jsonb_build_object('partner_user_id',partner_user_id,'weight',weight)
      order by partner_user_id) filter(where weight>0),'[]'::jsonb),coalesce(sum(weight),0)
    into v_weights,v_weight_total from weights;

  if v_fee_left>0 then
    perform public.generate_missing_borrower_due_events(p_borrower_id,
      (p_paid_on+interval '1 year')::date,null,true);
    for v_due in
      select t.*,t.source_event_id as id
      from public.borrower_due_timeline(p_borrower_id,(p_paid_on+interval '1 year')::date) t
      where t.amount_due>0 and t.source_event_id is not null order by t.due_date
    loop
      exit when v_fee_left<=0;
      v_apply:=least(v_due.amount_due,v_fee_left);
      v_mgmt:=least(greatest(0,round(v_due.expected_mgmt-v_due.paid_mgmt,2)),v_apply);
      v_funders:=v_apply-v_mgmt;
      update public.borrower_due_events set
        paid_total=round(paid_total+v_apply,2),paid_mgmt=round(paid_mgmt+v_mgmt,2),
        paid_funders=round(paid_funders+v_funders,2),
        status=case when v_due.paid_total+v_apply>=expected_total then 'PAID' else 'PARTIAL' end,
        resolved_at=case when v_due.paid_total+v_apply>=expected_total then now() else null end
      where id=v_due.id;
      v_due_apps:=v_due_apps||jsonb_build_array(jsonb_build_object('due_id',v_due.id,
        'total',v_apply,'mgmt',v_mgmt,'funders',v_funders));
      v_mgmt_total:=v_mgmt_total+v_mgmt; v_funders_total:=v_funders_total+v_funders;
      v_fee_left:=v_fee_left-v_apply;
    end loop;
  end if;
  if v_fee_left<>0 then raise exception 'No se pudo aplicar el importe exacto de cuota. Actualiza la cuenta.'; end if;

  for v_loan in
    select id,principal_outstanding from public.loans
    where borrower_id=p_borrower_id and status='ACTIVE' and start_date<=p_paid_on and principal_outstanding>0
    order by start_date,created_at,id for update
  loop
    exit when v_capital_left<=0;
    v_apply:=least(v_capital_left,v_loan.principal_outstanding);
    update public.loans set principal_outstanding=round(principal_outstanding-v_apply,2),
      status=case when principal_outstanding-v_apply<=0 then 'PAID_OFF' else status end,
      closed_at=case when principal_outstanding-v_apply<=0 then now() else closed_at end,
      closed_by=case when principal_outstanding-v_apply<=0 then auth.uid() else closed_by end
    where id=v_loan.id;
    v_principal_apps:=v_principal_apps||jsonb_build_array(jsonb_build_object('loan_id',v_loan.id,'amount',v_apply));
    v_capital_left:=v_capital_left-v_apply;
  end loop;
  if v_capital_left<>0 then raise exception 'No se pudo aplicar el abono exacto al capital. Actualiza la cuenta.'; end if;

  insert into public.payments(loan_id,borrower_id,paid_on,amount,applied_interest,applied_mgmt,
    applied_funders,applied_principal,notes,created_by,payment_type,account_payment)
  values(v_anchor,p_borrower_id,p_paid_on,p_amount,p_installment_amount,v_mgmt_total,
    v_funders_total,p_principal_amount,nullif(trim(p_notes),''),auth.uid(),'MIXED',true)
  returning id into v_payment;
  insert into public.payment_borrower_due_applications(payment_id,borrower_due_event_id,applied_total,applied_mgmt,applied_funders)
    select v_payment,(a->>'due_id')::uuid,(a->>'total')::numeric,(a->>'mgmt')::numeric,(a->>'funders')::numeric
    from jsonb_array_elements(v_due_apps) a;
  insert into public.payment_principal_applications(payment_id,loan_id,borrower_id,amount)
    select v_payment,(a->>'loan_id')::uuid,p_borrower_id,(a->>'amount')::numeric
    from jsonb_array_elements(v_principal_apps) a;

  if v_mgmt_total>0 then
    select user_id into v_admin from public.profiles where role='ADMIN' order by created_at,user_id limit 1;
    if v_admin is null then raise exception 'No hay un administrador para asignar la administración.'; end if;
    insert into public.payment_allocations(payment_id,partner_user_id,amount,allocation_type)
      values(v_payment,v_admin,v_mgmt_total,'MANAGEMENT_FEE');
  end if;
  if v_funders_total>0 then
    if v_weight_total<=0 then raise exception 'Revisa la distribución de socios de esta cuenta antes de registrar el pago.'; end if;
    v_allocation_left:=v_funders_total;
    for v_partner in select value,ordinality from jsonb_array_elements(v_weights) with ordinality loop
      v_amount:=case when v_partner.ordinality=jsonb_array_length(v_weights) then v_allocation_left
        else least(v_allocation_left,round(v_funders_total*(v_partner.value->>'weight')::numeric/v_weight_total,2)) end;
      if v_amount>0 then
        insert into public.payment_allocations(payment_id,partner_user_id,amount,allocation_type)
          values(v_payment,(v_partner.value->>'partner_user_id')::uuid,v_amount,'PARTNER_DISTRIBUTION');
      end if;
      v_allocation_left:=v_allocation_left-v_amount;
    end loop;
  end if;
  if p_principal_amount>0 then perform public.regenerate_future_borrower_due_events(p_borrower_id,12); end if;
  return v_payment;
end;
$mixed$;

revoke all on function public.get_borrower_mixed_payment_context(uuid,date) from public,anon;
revoke all on function public.apply_borrower_mixed_payment(uuid,date,numeric,numeric,numeric,text) from public,anon;
grant execute on function public.get_borrower_mixed_payment_context(uuid,date) to authenticated,service_role;
grant execute on function public.apply_borrower_mixed_payment(uuid,date,numeric,numeric,numeric,text) to authenticated;

-- Serialize payment entry and reversal for a borrower across both entry points.
CREATE OR REPLACE FUNCTION public.apply_borrower_payment(p_borrower_id uuid, p_paid_on date, p_amount numeric, p_payment_type text DEFAULT 'INSTALLMENT'::text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_type text := upper(coalesce(p_payment_type, 'INSTALLMENT'));
  v_anchor_loan_id uuid;
  v_remaining numeric := round(coalesce(p_amount,0), 2);
  v_due record;
  v_loan record;
  v_apply_to_due numeric;
  v_apply_mgmt numeric;
  v_apply_funders numeric;
  v_apply_principal numeric;
  v_interest_total numeric := 0;
  v_mgmt_total numeric := 0;
  v_funders_total numeric := 0;
  v_principal_total numeric := 0;
  v_payment_id uuid;
  v_admin_id uuid;
  v_funding_total numeric;
begin
  if coalesce(public.app_role(),'') not in ('ADMIN','AGENT') then
    raise exception 'Only Admin/Agent can record payments';
  end if;

  if v_remaining <= 0 then
    raise exception 'Payment amount must be > 0';
  end if;

  if v_type not in ('INSTALLMENT','PRINCIPAL','MIXED','PAYOFF') then
    raise exception 'Invalid payment type';
  end if;

  perform 1 from public.borrowers where id=p_borrower_id for update;
  if not found then raise exception 'No se encontró la cuenta del cliente.'; end if;

  v_anchor_loan_id := public.account_anchor_loan(p_borrower_id);

  create temp table if not exists tmp_borrower_due_apps (
    borrower_due_event_id uuid not null,
    applied_total numeric(12,2) not null,
    applied_mgmt numeric(12,2) not null,
    applied_funders numeric(12,2) not null
  ) on commit drop;
  truncate table tmp_borrower_due_apps;

  create temp table if not exists tmp_principal_apps (
    loan_id uuid not null,
    amount numeric(12,2) not null
  ) on commit drop;
  truncate table tmp_principal_apps;

  if v_type in ('INSTALLMENT','MIXED') then
    perform public.generate_missing_borrower_due_events(p_borrower_id, greatest(coalesce(p_paid_on,current_date), current_date), null, true);

    for v_due in
      select t.*, t.source_event_id as id
      from public.borrower_due_timeline(p_borrower_id,
        greatest(current_date, coalesce((select max(due_date) from public.borrower_due_events where borrower_id=p_borrower_id),current_date))) t
      where t.amount_due > 0 and t.source_event_id is not null
      order by t.due_date asc
    loop
      exit when v_remaining <= 0;

      v_apply_to_due := greatest(0, round(v_due.expected_total - v_due.paid_total, 2));
      if v_apply_to_due <= 0 then
        continue;
      end if;

      v_apply_to_due := least(v_apply_to_due, v_remaining);
      v_apply_mgmt := least(greatest(0, round(v_due.expected_mgmt - v_due.paid_mgmt, 2)), v_apply_to_due);
      v_apply_funders := round(v_apply_to_due - v_apply_mgmt, 2);

      update public.borrower_due_events
      set
        paid_total = round(paid_total + v_apply_to_due, 2),
        paid_mgmt = round(paid_mgmt + v_apply_mgmt, 2),
        paid_funders = round(paid_funders + v_apply_funders, 2),
        status = case when round(v_due.paid_total + v_apply_to_due, 2) >= round(expected_total, 2) then 'PAID' else 'PARTIAL' end,
        resolved_at = case when round(v_due.paid_total + v_apply_to_due, 2) >= round(expected_total, 2) then now() else resolved_at end
      where id = v_due.id;

      insert into tmp_borrower_due_apps values (v_due.id, v_apply_to_due, v_apply_mgmt, v_apply_funders);

      v_remaining := round(v_remaining - v_apply_to_due, 2);
      v_interest_total := round(v_interest_total + v_apply_to_due, 2);
      v_mgmt_total := round(v_mgmt_total + v_apply_mgmt, 2);
      v_funders_total := round(v_funders_total + v_apply_funders, 2);
    end loop;
  end if;

  if v_type in ('PRINCIPAL','PAYOFF') or (v_type = 'MIXED' and v_remaining > 0) then
    for v_loan in
      select id, principal_outstanding
      from public.loans
      where borrower_id = p_borrower_id
        and status = 'ACTIVE'
        and principal_outstanding > 0
      order by start_date asc, created_at asc
    loop
      exit when v_remaining <= 0;

      v_apply_principal := least(v_remaining, v_loan.principal_outstanding);

      update public.loans
      set
        principal_outstanding = round(principal_outstanding - v_apply_principal, 2),
        status = case when round(principal_outstanding - v_apply_principal, 2) <= 0 then 'PAID_OFF' else status end,
        closed_at = case when round(principal_outstanding - v_apply_principal, 2) <= 0 then now() else closed_at end,
        closed_by = case when round(principal_outstanding - v_apply_principal, 2) <= 0 then auth.uid() else closed_by end
      where id = v_loan.id;

      insert into tmp_principal_apps values (v_loan.id, v_apply_principal);

      v_remaining := round(v_remaining - v_apply_principal, 2);
      v_principal_total := round(v_principal_total + v_apply_principal, 2);
    end loop;
  end if;

  insert into public.payments (
    loan_id,
    borrower_id,
    paid_on,
    amount,
    applied_interest,
    applied_mgmt,
    applied_funders,
    applied_principal,
    notes,
    created_by,
    payment_type,
    account_payment
  ) values (
    v_anchor_loan_id,
    p_borrower_id,
    p_paid_on,
    round(p_amount, 2),
    v_interest_total,
    v_mgmt_total,
    v_funders_total,
    v_principal_total,
    p_notes,
    auth.uid(),
    v_type,
    true
  ) returning id into v_payment_id;

  insert into public.payment_borrower_due_applications (
    payment_id, borrower_due_event_id, applied_total, applied_mgmt, applied_funders
  )
  select v_payment_id, borrower_due_event_id, applied_total, applied_mgmt, applied_funders
  from tmp_borrower_due_apps;

  insert into public.payment_principal_applications (
    payment_id, loan_id, borrower_id, amount
  )
  select v_payment_id, loan_id, p_borrower_id, amount
  from tmp_principal_apps;

  select user_id into v_admin_id
  from public.profiles
  where role = 'ADMIN'
  order by created_at asc
  limit 1;

  if v_mgmt_total > 0 and v_admin_id is not null then
    insert into public.payment_allocations(payment_id, partner_user_id, amount, allocation_type)
    values (v_payment_id, v_admin_id, v_mgmt_total, 'MANAGEMENT_FEE');
  end if;

  if v_funders_total > 0 then
    select coalesce(sum(l.principal_outstanding * lf.funding_percent), 0)
    into v_funding_total
    from public.loans l
    join public.loan_funding lf on lf.loan_id = l.id
    where l.borrower_id = p_borrower_id
      and l.status = 'ACTIVE'
      and l.principal_outstanding > 0;

    if coalesce(v_funding_total, 0) > 0 then
      insert into public.payment_allocations(payment_id, partner_user_id, amount, allocation_type)
      select
        v_payment_id,
        x.partner_user_id,
        round(v_funders_total * x.weight / v_funding_total, 2),
        'PARTNER_DISTRIBUTION'
      from (
        select lf.partner_user_id, sum(l.principal_outstanding * lf.funding_percent) as weight
        from public.loans l
        join public.loan_funding lf on lf.loan_id = l.id
        where l.borrower_id = p_borrower_id
          and l.status = 'ACTIVE'
          and l.principal_outstanding > 0
        group by lf.partner_user_id
      ) x;
    end if;
  end if;

  if v_type = 'PAYOFF' then
    update public.borrower_due_events
    set status = 'CANCELLED', resolved_at = now()
    where borrower_id = p_borrower_id
      and status in ('DUE','PARTIAL')
      and due_date > coalesce(p_paid_on, current_date);
  elsif v_principal_total > 0 then
    perform public.regenerate_future_borrower_due_events(p_borrower_id, 12);
  end if;

  return v_payment_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.void_payment(p_payment_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_payment record;
  v_app record;
  v_principal_app record;
  v_remaining_due numeric;
  v_has_old_due_apps boolean;
  v_has_account_due_apps boolean;
  v_has_principal_apps boolean;
begin
  if coalesce(public.app_role(),'') <> 'ADMIN' then
    raise exception 'Only Admin can void payments';
  end if;

  select *
  into v_payment
  from public.payments
  where id = p_payment_id;

  if not found then
    raise exception 'Payment not found';
  end if;

  perform 1 from public.borrowers where id=v_payment.borrower_id for update;
  select * into v_payment from public.payments where id=p_payment_id for update;

  if v_payment.is_voided then
    raise exception 'Payment is already voided';
  end if;

  select exists(select 1 from public.payment_due_applications where payment_id = p_payment_id)
  into v_has_old_due_apps;

  select exists(select 1 from public.payment_borrower_due_applications where payment_id = p_payment_id)
  into v_has_account_due_apps;

  select exists(select 1 from public.payment_principal_applications where payment_id = p_payment_id)
  into v_has_principal_apps;

  if coalesce(v_payment.applied_interest, 0) > 0 and not v_has_old_due_apps and not v_has_account_due_apps then
    raise exception 'This payment cannot be safely voided automatically because it has no due-event tracking rows';
  end if;

  -- Old loan-level due reversals.
  for v_app in
    select *
    from public.payment_due_applications
    where payment_id = p_payment_id
  loop
    update public.loan_due_events
    set
      paid_total = greatest(0, round(coalesce(paid_total, 0) - coalesce(v_app.applied_total, 0), 2)),
      paid_mgmt = greatest(0, round(coalesce(paid_mgmt, 0) - coalesce(v_app.applied_mgmt, 0), 2)),
      paid_funders = greatest(0, round(coalesce(paid_funders, 0) - coalesce(v_app.applied_funders, 0), 2))
    where id = v_app.loan_due_event_id;

    select round(coalesce(expected_total, 0) - coalesce(paid_total, 0), 2)
    into v_remaining_due
    from public.loan_due_events
    where id = v_app.loan_due_event_id;

    update public.loan_due_events
    set status = case
      when coalesce(paid_total, 0) <= 0 then 'DUE'
      when v_remaining_due <= 0 then 'PAID'
      else 'PARTIAL'
    end,
    resolved_at = case
      when coalesce(paid_total, 0) <= 0 then null
      when v_remaining_due <= 0 then coalesce(resolved_at, now())
      else null
    end
    where id = v_app.loan_due_event_id;
  end loop;

  -- New borrower/account-level due reversals.
  for v_app in
    select *
    from public.payment_borrower_due_applications
    where payment_id = p_payment_id
  loop
    update public.borrower_due_events
    set
      paid_total = greatest(0, round(coalesce(paid_total, 0) - coalesce(v_app.applied_total, 0), 2)),
      paid_mgmt = greatest(0, round(coalesce(paid_mgmt, 0) - coalesce(v_app.applied_mgmt, 0), 2)),
      paid_funders = greatest(0, round(coalesce(paid_funders, 0) - coalesce(v_app.applied_funders, 0), 2))
    where id = v_app.borrower_due_event_id;

    select round(coalesce(expected_total, 0) - coalesce(paid_total, 0), 2)
    into v_remaining_due
    from public.borrower_due_events
    where id = v_app.borrower_due_event_id;

    update public.borrower_due_events
    set status = case
      when coalesce(paid_total, 0) <= 0 then 'DUE'
      when v_remaining_due <= 0 then 'PAID'
      else 'PARTIAL'
    end,
    resolved_at = case
      when coalesce(paid_total, 0) <= 0 then null
      when v_remaining_due <= 0 then coalesce(resolved_at, now())
      else null
    end
    where id = v_app.borrower_due_event_id;
  end loop;

  -- Principal reversals for new tracked account payments.
  if v_has_principal_apps then
    for v_principal_app in
      select *
      from public.payment_principal_applications
      where payment_id = p_payment_id
    loop
      update public.loans
      set
        principal_outstanding = round(coalesce(principal_outstanding, 0) + coalesce(v_principal_app.amount, 0), 2),
        status = case when status in ('PAID_OFF','CLOSED') then 'ACTIVE' else status end,
        closed_at = case when status in ('PAID_OFF','CLOSED') then null else closed_at end,
        closed_by = case when status in ('PAID_OFF','CLOSED') then null else closed_by end
      where id = v_principal_app.loan_id;
    end loop;
  elsif coalesce(v_payment.applied_principal, 0) > 0 then
    -- Fallback for old payments before principal application tracking existed.
    update public.loans
    set
      principal_outstanding = round(coalesce(principal_outstanding, 0) + coalesce(v_payment.applied_principal, 0), 2),
      status = case when status in ('PAID_OFF','CLOSED') then 'ACTIVE' else status end,
      closed_at = case when status in ('PAID_OFF','CLOSED') then null else closed_at end,
      closed_by = case when status in ('PAID_OFF','CLOSED') then null else closed_by end
    where id = v_payment.loan_id;
  end if;

  delete from public.payment_allocations
  where payment_id = p_payment_id;

  update public.payments
  set
    is_voided = true,
    voided_at = now(),
    voided_by = auth.uid(),
    void_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_payment_id;

  if v_payment.account_payment and coalesce(v_payment.applied_principal, 0) > 0 then
    delete from public.borrower_due_events
    where borrower_id = v_payment.borrower_id
      and due_date >= current_date
      and status = 'CANCELLED'
      and coalesce(paid_total,0) = 0;

    perform public.regenerate_future_borrower_due_events(v_payment.borrower_id, 12);
  end if;
end;
$function$;
