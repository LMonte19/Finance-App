-- Operational access is shared. User access and resets remain privileged.
create or replace function public.app_role()
returns text language sql stable set search_path = ''
as $role$ select p.role from public.profiles p where p.user_id = auth.uid(); $role$;

CREATE OR REPLACE FUNCTION public.apply_borrower_mixed_payment(p_borrower_id uuid, p_paid_on date, p_amount numeric, p_installment_amount numeric, p_principal_amount numeric, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_context jsonb; v_anchor uuid; v_admin uuid; v_payment uuid;
  v_fee_left numeric:=p_installment_amount; v_capital_left numeric:=p_principal_amount;
  v_due record; v_loan record; v_apply numeric; v_mgmt numeric; v_funders numeric;
  v_mgmt_total numeric:=0; v_funders_total numeric:=0;
  v_due_apps jsonb:='[]'; v_principal_apps jsonb:='[]'; v_weights jsonb:='[]';
  v_weight numeric; v_weight_total numeric; v_allocation_left numeric; v_amount numeric;
  v_index bigint; v_partner record;
begin
  if auth.uid() is null or coalesce(public.app_role(),'') not in ('ADMIN','AGENT','PARTNER') then
    raise exception 'Tu cuenta no tiene permiso para registrar pagos.';
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
$function$;

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
  if coalesce(public.app_role(),'') not in ('ADMIN','AGENT','PARTNER') then
    raise exception 'Tu cuenta no tiene permiso para registrar pagos.';
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

CREATE OR REPLACE FUNCTION public.close_loan(p_loan_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(public.app_role(),'') not in ('ADMIN','AGENT','PARTNER') then
    raise exception 'Tu cuenta no tiene permiso para cerrar préstamos.';
  end if;

  update public.loans
  set
    status = 'CLOSED',
    notes = nullif(trim(coalesce(p_reason, notes, '')), ''),
    closed_at = coalesce(closed_at, now()),
    closed_by = coalesce(closed_by, auth.uid())
  where id = p_loan_id;

  if not found then
    raise exception 'Loan not found';
  end if;

  update public.loan_due_events
  set status = 'CANCELLED'
  where loan_id = p_loan_id
    and status in ('DUE','PARTIAL')
    and coalesce(paid_total, 0) = 0;
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_followup(p_followup_id uuid, p_completed_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(public.app_role(),'') not in ('ADMIN','AGENT','PARTNER') then
    raise exception 'Tu cuenta no tiene permiso para completar seguimientos.';
  end if;

  update public.borrower_followups
  set
    status = 'DONE',
    completed_at = now(),
    completed_by = auth.uid(),
    completed_notes = nullif(trim(coalesce(p_completed_notes, '')), '')
  where id = p_followup_id;

  if not found then
    raise exception 'Follow-up not found';
  end if;

  return p_followup_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_funded_disbursement(p_borrower_id uuid, p_start_date date, p_principal numeric, p_rate_total numeric, p_rate_mgmt numeric, p_notes text, p_contributions jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if auth.uid() is null or coalesce((select p.role from public.profiles p where p.user_id=auth.uid()),'') not in ('ADMIN','AGENT','PARTNER') then
    raise exception 'Tu cuenta no tiene permiso para guardar desembolsos.';
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
$function$;

CREATE OR REPLACE FUNCTION public.generate_loan_due_events(p_loan_id uuid, p_months_ahead integer DEFAULT 6)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_loan record;
  v_start date;
  v_y int;
  v_m int;
  v_d15 date;
  v_dlast date;
  v_i int;
  v_base_principal numeric;
  v_total_rate_per_cycle numeric;
  v_mgmt_rate_per_cycle numeric;
  v_funders_rate_per_cycle numeric;
  v_inserted int := 0;
  v_inserted_total int := 0;
begin
  if coalesce(public.app_role(),'') not in ('ADMIN','AGENT','PARTNER') then
    raise exception 'Only Admin/Agent can generate due events';
  end if;

  if p_months_ahead is null or p_months_ahead < 1 or p_months_ahead > 24 then
    raise exception 'Months ahead must be between 1 and 24';
  end if;

  select *
  into v_loan
  from public.loans
  where id = p_loan_id;

  if not found then
    raise exception 'Loan not found';
  end if;

  if v_loan.status = 'PAID_OFF' then
    raise exception 'Cannot generate due events for a paid off loan';
  end if;

  select coalesce(max(due_date) + 1, v_loan.start_date)
  into v_start
  from public.loan_due_events
  where loan_id = p_loan_id;

  v_base_principal := greatest(0, coalesce(v_loan.principal_outstanding, v_loan.principal_original, 0));

  if v_base_principal <= 0 then
    raise exception 'Loan principal is already zero';
  end if;

  v_total_rate_per_cycle := coalesce(v_loan.monthly_rate_total, 0.10) / 2;
  v_mgmt_rate_per_cycle := coalesce(v_loan.monthly_rate_mgmt, 0.03) / 2;
  v_funders_rate_per_cycle := v_total_rate_per_cycle - v_mgmt_rate_per_cycle;

  if v_funders_rate_per_cycle < 0 then
    raise exception 'Management rate cannot exceed total rate';
  end if;

  for v_i in 0..(p_months_ahead - 1) loop
    v_y := extract(year from (v_start + make_interval(months => v_i)))::int;
    v_m := extract(month from (v_start + make_interval(months => v_i)))::int;

    v_d15 := make_date(v_y, v_m, 15);
    v_dlast := (make_date(v_y, v_m, 1) + interval '1 month - 1 day')::date;

    if v_d15 >= v_start then
      insert into public.loan_due_events (
        loan_id,
        due_date,
        expected_interest,
        expected_total,
        expected_mgmt,
        expected_funders,
        status
      )
      values (
        p_loan_id,
        v_d15,
        round(v_base_principal * v_total_rate_per_cycle, 2),
        round(v_base_principal * v_total_rate_per_cycle, 2),
        round(v_base_principal * v_mgmt_rate_per_cycle, 2),
        round(v_base_principal * v_funders_rate_per_cycle, 2),
        'DUE'
      )
      on conflict (loan_id, due_date) do nothing;

      get diagnostics v_inserted = row_count;
      v_inserted_total := v_inserted_total + v_inserted;
    end if;

    if v_dlast >= v_start then
      insert into public.loan_due_events (
        loan_id,
        due_date,
        expected_interest,
        expected_total,
        expected_mgmt,
        expected_funders,
        status
      )
      values (
        p_loan_id,
        v_dlast,
        round(v_base_principal * v_total_rate_per_cycle, 2),
        round(v_base_principal * v_total_rate_per_cycle, 2),
        round(v_base_principal * v_mgmt_rate_per_cycle, 2),
        round(v_base_principal * v_funders_rate_per_cycle, 2),
        'DUE'
      )
      on conflict (loan_id, due_date) do nothing;

      get diagnostics v_inserted = row_count;
      v_inserted_total := v_inserted_total + v_inserted;
    end if;
  end loop;

  return v_inserted_total;
end;
$function$;

CREATE OR REPLACE FUNCTION public.generate_missing_borrower_due_events(p_borrower_id uuid, p_through_date date DEFAULT ((CURRENT_DATE + '1 year'::interval))::date, p_from_date date DEFAULT NULL::date, p_only_active boolean DEFAULT true)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_count integer;
begin
  if coalesce(public.app_role(),'') not in ('ADMIN','AGENT','PARTNER') then
    raise exception 'Only Admin/Agent can generate account due dates';
  end if;
  insert into public.borrower_due_events as booked
    (borrower_id,due_date,principal_snapshot,expected_total,expected_mgmt,expected_funders,status)
  select t.borrower_id,t.due_date,t.principal_snapshot,t.expected_total,t.expected_mgmt,t.expected_funders,t.status
  from public.borrower_due_timeline(p_borrower_id,
    greatest(coalesce(p_through_date,current_date+365),
      coalesce((select max(due_date) from public.borrower_due_events where borrower_id=p_borrower_id),p_through_date))) t
  where (p_from_date is null or t.due_date>=p_from_date)
    and (t.expected_total>0 or t.source_event_id is not null)
  on conflict (borrower_id,due_date) do update set
    principal_snapshot=excluded.principal_snapshot,expected_total=excluded.expected_total,
    expected_mgmt=excluded.expected_mgmt,expected_funders=excluded.expected_funders,status=excluded.status
  where (booked.principal_snapshot,booked.expected_total,booked.expected_mgmt,booked.expected_funders,booked.status)
    is distinct from (excluded.principal_snapshot,excluded.expected_total,excluded.expected_mgmt,excluded.expected_funders,excluded.status);
  get diagnostics v_count=row_count;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.generate_missing_due_events_all(p_months_ahead integer DEFAULT 12)
 RETURNS TABLE(loan_id uuid, borrower_name text, inserted_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(public.app_role(),'') not in ('ADMIN','AGENT','PARTNER') then
    raise exception 'Only Admin/Agent can generate due schedules';
  end if;

  if p_months_ahead is null or p_months_ahead < 1 then
    p_months_ahead := 12;
  end if;

  return query
  select
    l.id as loan_id,
    b.full_name as borrower_name,
    public.generate_missing_due_events_for_loan(
      l.id,
      (current_date + make_interval(months => p_months_ahead))::date,
      current_date,
      true
    ) as inserted_count
  from public.loans l
  join public.borrowers b on b.id = l.borrower_id
  where l.status = 'ACTIVE'
    and coalesce(l.principal_outstanding, 0) > 0
  order by b.full_name, l.start_date;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_loan_paid_off(p_loan_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(public.app_role(),'') not in ('ADMIN','AGENT','PARTNER') then
    raise exception 'Only Admin/Agent can mark a loan paid off';
  end if;

  update public.loans
  set
    principal_outstanding = 0,
    status = 'PAID_OFF',
    closed_at = coalesce(closed_at, now()),
    closed_by = coalesce(closed_by, auth.uid())
  where id = p_loan_id;

  if not found then
    raise exception 'Loan not found';
  end if;

  update public.loan_due_events
  set status = 'CANCELLED'
  where loan_id = p_loan_id
    and status in ('DUE','PARTIAL')
    and coalesce(paid_total, 0) = 0;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_borrower_payment(p_borrower_id uuid, p_paid_on date, p_amount numeric, p_payment_type text, p_notes text, p_installment_amount numeric DEFAULT NULL::numeric, p_principal_amount numeric DEFAULT NULL::numeric, p_due_dates date[] DEFAULT NULL::date[], p_partner_split jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  if auth.uid() is null or coalesce(public.app_role(),'') not in ('ADMIN','AGENT','PARTNER') then
    raise exception 'Tu cuenta no tiene permiso para registrar pagos.';
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
$function$;

CREATE OR REPLACE FUNCTION public.regenerate_future_borrower_due_events(p_borrower_id uuid, p_months_ahead integer DEFAULT 12)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(public.app_role(),'') not in ('ADMIN','AGENT','PARTNER') then
    raise exception 'Only Admin/Agent can regenerate account due dates';
  end if;
  return public.generate_missing_borrower_due_events(p_borrower_id,
    (current_date+make_interval(months=>greatest(coalesce(p_months_ahead,12),1)))::date,current_date,true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.regenerate_future_borrower_due_events_all(p_months_ahead integer DEFAULT 12)
 RETURNS TABLE(borrower_id uuid, borrower_name text, inserted_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_borrower record;
  v_count integer;
begin
  if coalesce(public.app_role(),'') not in ('ADMIN','AGENT','PARTNER') then
    raise exception 'Only Admin/Agent can regenerate account due dates';
  end if;

  for v_borrower in
    select distinct b.id, b.full_name
    from public.borrowers b
    join public.loans l on l.borrower_id = b.id
    where l.status = 'ACTIVE'
      and l.principal_outstanding > 0
  loop
    v_count := public.regenerate_future_borrower_due_events(v_borrower.id, coalesce(p_months_ahead, 12));
    borrower_id := v_borrower.id;
    borrower_name := v_borrower.full_name;
    inserted_count := coalesce(v_count, 0);
    return next;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.regenerate_future_due_events(p_loan_id uuid, p_months_ahead integer DEFAULT 6)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_loan record;
  v_start date := current_date;
  v_i integer;
  v_due_date date;
  v_expected_total numeric(12,2);
  v_expected_mgmt numeric(12,2);
  v_expected_funders numeric(12,2);
  v_inserted integer := 0;
  v_row_count integer := 0;
begin
  if coalesce(public.app_role(),'') not in ('ADMIN','AGENT','PARTNER') then
    raise exception 'Only Admin/Agent can regenerate due dates';
  end if;

  if p_months_ahead < 1 or p_months_ahead > 36 then
    raise exception 'Months ahead must be between 1 and 36';
  end if;

  select * into v_loan
  from public.loans
  where id = p_loan_id;

  if not found then
    raise exception 'Loan not found';
  end if;

  if v_loan.status not in ('ACTIVE','PAUSED','DEFAULTED') then
    raise exception 'Only active, paused, or defaulted loans can regenerate due dates';
  end if;

  delete from public.loan_due_events
  where loan_id = p_loan_id
    and due_date >= current_date
    and status = 'DUE'
    and coalesce(paid_total, 0) = 0;

  v_expected_total := round(v_loan.principal_outstanding * (v_loan.monthly_rate_total / 2), 2);
  v_expected_mgmt := round(v_loan.principal_outstanding * (v_loan.monthly_rate_mgmt / 2), 2);
  v_expected_funders := round(v_expected_total - v_expected_mgmt, 2);

  for v_i in 0..(p_months_ahead - 1) loop
    v_due_date := (date_trunc('month', v_start)::date + (v_i || ' months')::interval + interval '14 days')::date;
    if v_due_date >= v_start then
      insert into public.loan_due_events (
        loan_id, due_date, expected_interest, expected_total, expected_mgmt, expected_funders, status
      ) values (
        p_loan_id, v_due_date, v_expected_total, v_expected_total, v_expected_mgmt, v_expected_funders, 'DUE'
      ) on conflict (loan_id, due_date) do nothing;
      get diagnostics v_row_count = row_count;
      v_inserted := v_inserted + v_row_count;
    end if;

    v_due_date := (date_trunc('month', v_start)::date + ((v_i + 1) || ' months')::interval - interval '1 day')::date;
    if v_due_date >= v_start then
      insert into public.loan_due_events (
        loan_id, due_date, expected_interest, expected_total, expected_mgmt, expected_funders, status
      ) values (
        p_loan_id, v_due_date, v_expected_total, v_expected_total, v_expected_mgmt, v_expected_funders, 'DUE'
      ) on conflict (loan_id, due_date) do nothing;
      get diagnostics v_row_count = row_count;
      v_inserted := v_inserted + v_row_count;
    end if;
  end loop;

  return v_inserted;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reset_test_data()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or coalesce(public.app_role(),'') <> 'ADMIN' then
    raise exception 'Only Admin can reset test data';
  end if;

  truncate table
    public.payment_due_applications,
    public.payment_allocations,
    public.payments,
    public.loan_due_events,
    public.loan_funding,
    public.loans,
    public.borrowers
  restart identity cascade;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_app_setting(p_key text, p_value jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(public.app_role(),'') not in ('ADMIN','AGENT','PARTNER') then
    raise exception 'Tu cuenta no tiene permiso para cambiar la configuración.';
  end if;
  if public.app_role() <> 'ADMIN' and (p_key is null or p_key not in ('loan_defaults','default_funding_split')) then
    raise exception 'Esta configuración está reservada al propietario.';
  end if;

  insert into public.app_settings (setting_key, setting_value, updated_at)
  values (p_key, p_value, now())
  on conflict (setting_key)
  do update set
    setting_value = excluded.setting_value,
    updated_at = now();
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_loan_status(p_loan_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(public.app_role(),'') not in ('ADMIN','AGENT','PARTNER') then
    raise exception 'Only Admin/Agent can update loan status';
  end if;

  if p_status not in ('ACTIVE','PAID_OFF','PAUSED','DEFAULTED') then
    raise exception 'Invalid loan status';
  end if;

  update public.loans
  set status = p_status
  where id = p_loan_id;

  if not found then
    raise exception 'Loan not found';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_loan_details(p_loan_id uuid, p_start_date date, p_principal_original numeric, p_principal_outstanding numeric, p_monthly_rate_total numeric, p_monthly_rate_mgmt numeric, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(public.app_role(),'') not in ('ADMIN','AGENT','PARTNER') then
    raise exception 'Only Admin/Agent can update loan details';
  end if;

  if p_status not in ('ACTIVE','PAID_OFF','PAUSED','DEFAULTED','CLOSED','VOIDED') then
    raise exception 'Invalid loan status';
  end if;

  if p_principal_original < 0 or p_principal_outstanding < 0 then
    raise exception 'Principal values cannot be negative';
  end if;

  if p_monthly_rate_total < 0 or p_monthly_rate_mgmt < 0 or p_monthly_rate_mgmt > p_monthly_rate_total then
    raise exception 'Invalid rate values';
  end if;

  update public.loans
  set
    start_date = p_start_date,
    principal_original = round(p_principal_original, 2),
    principal_outstanding = round(p_principal_outstanding, 2),
    monthly_rate_total = p_monthly_rate_total,
    monthly_rate_mgmt = p_monthly_rate_mgmt,
    status = case
      when p_status not in ('VOIDED','CLOSED') and round(p_principal_outstanding, 2) <= 0 then 'PAID_OFF'
      else p_status
    end,
    closed_at = case
      when p_status in ('PAID_OFF','CLOSED','VOIDED') or round(p_principal_outstanding, 2) <= 0 then coalesce(closed_at, now())
      else null
    end,
    closed_by = case
      when p_status in ('PAID_OFF','CLOSED','VOIDED') or round(p_principal_outstanding, 2) <= 0 then coalesce(closed_by, auth.uid())
      else null
    end
  where id = p_loan_id;

  if not found then
    raise exception 'Loan not found';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_payment_notes(p_payment_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(public.app_role(),'') not in ('ADMIN','AGENT','PARTNER') then
    raise exception 'Only Admin/Agent can update payment notes';
  end if;

  update public.payments
  set notes = nullif(trim(coalesce(p_notes, '')), '')
  where id = p_payment_id;

  if not found then
    raise exception 'Payment not found';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_profile_admin(p_user_id uuid, p_full_name text, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or coalesce(public.app_role(),'') <> 'ADMIN' then
    raise exception 'Only Admin can update profiles';
  end if;

  if p_role is null or p_role not in ('ADMIN','AGENT','PARTNER') then
    raise exception 'Invalid role';
  end if;

  update public.profiles
  set
    full_name = nullif(trim(p_full_name), ''),
    role = p_role
  where user_id = p_user_id;

  if not found then
    raise exception 'Profile not found';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.void_loan(p_loan_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(public.app_role(),'') not in ('ADMIN','AGENT','PARTNER') then
    raise exception 'Tu cuenta no tiene permiso para anular préstamos.';
  end if;

  update public.loans
  set
    status = 'VOIDED',
    void_reason = nullif(trim(coalesce(p_reason, '')), ''),
    notes = nullif(trim(coalesce(p_reason, notes, '')), ''),
    principal_outstanding = 0,
    closed_at = coalesce(closed_at, now()),
    closed_by = coalesce(closed_by, auth.uid())
  where id = p_loan_id;

  if not found then
    raise exception 'Loan not found';
  end if;

  update public.loan_due_events
  set status = 'CANCELLED'
  where loan_id = p_loan_id
    and status in ('DUE','PARTIAL');
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
  if auth.uid() is null or coalesce(public.app_role(),'') not in ('ADMIN','AGENT','PARTNER') then
    raise exception 'Tu cuenta no tiene permiso para anular pagos.';
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

    perform finance_workflow_private.restore_voided_payment_dues(v_payment.borrower_id,
      (current_date + interval '12 months')::date, current_date, true);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION finance_workflow_private.set_loan_contributions(p_loan_id uuid, p_contributions jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_borrower uuid; v_principal numeric; v_count integer; v_unique integer; v_total numeric; v_invalid integer;
begin
  if auth.uid() is null or coalesce((select p.role from public.profiles p where p.user_id=auth.uid()),'') not in ('ADMIN','AGENT','PARTNER') then
    raise exception 'Tu cuenta no tiene permiso para guardar aportes.';
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
$function$;

alter policy "app_settings_insert_admin" on public.app_settings with check (((app_role() = 'ADMIN' or (app_role() in ('AGENT','PARTNER') and setting_key in ('loan_defaults','default_funding_split')))));
alter policy "app_settings_update_admin" on public.app_settings using (((app_role() = 'ADMIN' or (app_role() in ('AGENT','PARTNER') and setting_key in ('loan_defaults','default_funding_split'))))) with check (((app_role() = 'ADMIN' or (app_role() in ('AGENT','PARTNER') and setting_key in ('loan_defaults','default_funding_split')))));
alter policy "borrower_contact_log_insert_admin_agent" on public.borrower_contact_log with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = ANY (ARRAY['ADMIN'::text, 'AGENT'::text, 'PARTNER'::text]))))));
alter policy "borrower_contact_log_update_admin_agent" on public.borrower_contact_log using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = ANY (ARRAY['ADMIN'::text, 'AGENT'::text, 'PARTNER'::text])))))) with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = ANY (ARRAY['ADMIN'::text, 'AGENT'::text, 'PARTNER'::text]))))));
alter policy "borrower_due_events_write_admin_agent" on public.borrower_due_events using ((app_role() = ANY (ARRAY['ADMIN'::text, 'AGENT'::text, 'PARTNER'::text]))) with check ((app_role() = ANY (ARRAY['ADMIN'::text, 'AGENT'::text, 'PARTNER'::text])));
alter policy "borrower_followups_insert_admin_agent" on public.borrower_followups with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = ANY (ARRAY['ADMIN'::text, 'AGENT'::text, 'PARTNER'::text]))))));
alter policy "borrower_followups_update_admin_agent" on public.borrower_followups using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = ANY (ARRAY['ADMIN'::text, 'AGENT'::text, 'PARTNER'::text])))))) with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = ANY (ARRAY['ADMIN'::text, 'AGENT'::text, 'PARTNER'::text]))))));
alter policy "borrowers_insert_admin_agent" on public.borrowers with check ((app_role() = ANY (ARRAY['ADMIN'::text, 'AGENT'::text, 'PARTNER'::text])));
alter policy "borrowers_update_admin_agent" on public.borrowers using ((app_role() = ANY (ARRAY['ADMIN'::text, 'AGENT'::text, 'PARTNER'::text])));
alter policy "default_funding_delete_admin" on public.default_funding_splits using ((app_role() IN ('ADMIN','AGENT','PARTNER')));
alter policy "default_funding_insert_admin" on public.default_funding_splits with check ((app_role() IN ('ADMIN','AGENT','PARTNER')));
alter policy "default_funding_update_admin" on public.default_funding_splits using ((app_role() IN ('ADMIN','AGENT','PARTNER'))) with check ((app_role() IN ('ADMIN','AGENT','PARTNER')));
alter policy "due_insert_admin_agent" on public.loan_due_events with check ((app_role() = ANY (ARRAY['ADMIN'::text, 'AGENT'::text, 'PARTNER'::text])));
alter policy "due_update_admin_agent" on public.loan_due_events using ((app_role() = ANY (ARRAY['ADMIN'::text, 'AGENT'::text, 'PARTNER'::text])));
alter policy "funding_insert_admin_only" on public.loan_funding with check ((app_role() IN ('ADMIN','AGENT','PARTNER')));
alter policy "funding_update_admin_only" on public.loan_funding using ((app_role() IN ('ADMIN','AGENT','PARTNER')));
alter policy "payments_insert_admin_agent" on public.loan_payments with check ((app_role() = ANY (ARRAY['ADMIN'::text, 'AGENT'::text, 'PARTNER'::text])));
alter policy "loans_insert_admin_agent" on public.loans with check ((app_role() = ANY (ARRAY['ADMIN'::text, 'AGENT'::text, 'PARTNER'::text])));
alter policy "loans_update_admin_agent" on public.loans using ((app_role() = ANY (ARRAY['ADMIN'::text, 'AGENT'::text, 'PARTNER'::text])));
alter policy "alloc_insert_admin_agent" on public.payment_allocations with check ((app_role() = ANY (ARRAY['ADMIN'::text, 'AGENT'::text, 'PARTNER'::text])));
alter policy "payment_borrower_due_app_write_admin_agent" on public.payment_borrower_due_applications using ((app_role() = ANY (ARRAY['ADMIN'::text, 'AGENT'::text, 'PARTNER'::text]))) with check ((app_role() = ANY (ARRAY['ADMIN'::text, 'AGENT'::text, 'PARTNER'::text])));
alter policy "payment_due_applications_insert_admin_agent" on public.payment_due_applications with check ((app_role() = ANY (ARRAY['ADMIN'::text, 'AGENT'::text, 'PARTNER'::text])));
alter policy "payment_principal_app_write_admin_agent" on public.payment_principal_applications using ((app_role() = ANY (ARRAY['ADMIN'::text, 'AGENT'::text, 'PARTNER'::text]))) with check ((app_role() = ANY (ARRAY['ADMIN'::text, 'AGENT'::text, 'PARTNER'::text])));

-- Staff records do not require an Auth user. Capture the fee recipient when a payment is recorded.
create table if not exists public.operational_administrators (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  user_id uuid unique references auth.users(id) on delete set null,
  receives_management_fee boolean not null default false
);
alter table public.operational_administrators enable row level security;
revoke all on table public.operational_administrators from public, anon, authenticated;
grant select on table public.operational_administrators to authenticated;
create policy operating_team_reads_administrators on public.operational_administrators for select to authenticated
  using (coalesce(public.app_role(),'') in ('ADMIN','AGENT','PARTNER'));
create unique index if not exists one_active_management_fee_recipient on public.operational_administrators (receives_management_fee) where receives_management_fee;
insert into public.operational_administrators (full_name, receives_management_fee)
select 'Carlos', true where not exists(select 1 from public.operational_administrators where receives_management_fee);
alter table public.payment_allocations add column if not exists operational_administrator_id uuid references public.operational_administrators(id);

create or replace function finance_workflow_private.assign_payment_administrator()
returns trigger language plpgsql set search_path = ''
as $assign$
begin
  if new.allocation_type = 'MANAGEMENT_FEE' then
    select a.id, a.user_id into new.operational_administrator_id, new.partner_user_id
    from public.operational_administrators a where a.receives_management_fee;
    if not found then raise exception 'No hay administrador operativo para asignar la comisión.'; end if;
  else
    new.operational_administrator_id := null;
  end if;
  return new;
end;
$assign$;
revoke all on function finance_workflow_private.assign_payment_administrator() from public,anon,authenticated;
create trigger assign_payment_administrator before insert on public.payment_allocations
for each row execute function finance_workflow_private.assign_payment_administrator();

create or replace view public.partner_allocation_details as
SELECT pa.id,
    pa.payment_id,
    coalesce(pa.operational_administrator_id, pa.partner_user_id) as partner_user_id,
    coalesce(oa.full_name, prof.full_name) AS partner_name,
    case when oa.id is not null then 'AGENT' else prof.role end AS partner_role,
    pa.allocation_type,
    pa.amount,
    pa.created_at,
    pay.loan_id,
    pay.borrower_id,
    b.full_name AS borrower_name,
    b.phone AS borrower_phone,
    pay.paid_on,
    pay.amount AS payment_amount,
    pay.payment_type,
    pay.account_payment,
    pay.is_voided,
    pay.voided_at,
    pay.void_reason,
    pay.applied_interest,
    pay.applied_mgmt,
    pay.applied_funders,
    pay.applied_principal
   FROM payment_allocations pa
     LEFT JOIN public.operational_administrators oa ON oa.id = pa.operational_administrator_id
     LEFT JOIN profiles prof ON prof.user_id = pa.partner_user_id
     LEFT JOIN payments pay ON pay.id = pa.payment_id
     LEFT JOIN borrowers b ON b.id = pay.borrower_id;

create or replace view public.partner_earnings_summary as
WITH partner_base AS (
         SELECT p.user_id,
            COALESCE(p.full_name, 'Unknown'::text) AS full_name,
            p.role
           FROM profiles p
          WHERE p.role = ANY (ARRAY['ADMIN'::text, 'PARTNER'::text])
         UNION ALL SELECT id, full_name, 'AGENT'::text FROM public.operational_administrators
        ), active_capital AS (
         SELECT lf.partner_user_id AS user_id,
            round(COALESCE(sum(l.principal_outstanding * lf.funding_percent), 0::numeric), 2) AS active_capital,
            round(COALESCE(sum(l.principal_original * lf.funding_percent), 0::numeric), 2) AS original_capital,
            count(DISTINCT l.borrower_id)::integer AS active_borrowers,
            count(DISTINCT l.id)::integer AS funded_disbursements
           FROM loan_funding lf
             JOIN loans l ON l.id = lf.loan_id
          WHERE l.status = 'ACTIVE'::text AND l.principal_outstanding > 0::numeric
          GROUP BY lf.partner_user_id
        ), earned AS (
         SELECT coalesce(pa.operational_administrator_id,pa.partner_user_id) AS user_id,
            round(COALESCE(sum(pa.amount) FILTER (WHERE pay.is_voided = false), 0::numeric), 2) AS total_earned,
            round(COALESCE(sum(pa.amount) FILTER (WHERE pay.is_voided = false AND pa.allocation_type = 'MANAGEMENT_FEE'::text), 0::numeric), 2) AS management_earned,
            round(COALESCE(sum(pa.amount) FILTER (WHERE pay.is_voided = false AND pa.allocation_type = 'PARTNER_DISTRIBUTION'::text), 0::numeric), 2) AS funding_earned,
            count(pa.id) FILTER (WHERE pay.is_voided = false)::integer AS allocation_count,
            round(COALESCE(sum(pa.amount) FILTER (WHERE pay.is_voided = true), 0::numeric), 2) AS voided_earned,
            count(pa.id) FILTER (WHERE pay.is_voided = true)::integer AS voided_allocation_count
           FROM payment_allocations pa
             LEFT JOIN payments pay ON pay.id = pa.payment_id
          GROUP BY coalesce(pa.operational_administrator_id,pa.partner_user_id)
        )
 SELECT pb.user_id,
    pb.full_name,
    pb.role,
    COALESCE(ac.active_capital, 0::numeric)::numeric(12,2) AS active_capital,
    COALESCE(ac.original_capital, 0::numeric)::numeric(12,2) AS original_capital,
    COALESCE(ac.active_borrowers, 0) AS active_borrowers,
    COALESCE(ac.funded_disbursements, 0) AS funded_disbursements,
    COALESCE(e.total_earned, 0::numeric)::numeric(12,2) AS total_earned,
    COALESCE(e.management_earned, 0::numeric)::numeric(12,2) AS management_earned,
    COALESCE(e.funding_earned, 0::numeric)::numeric(12,2) AS funding_earned,
    COALESCE(e.allocation_count, 0) AS allocation_count,
    COALESCE(e.voided_earned, 0::numeric)::numeric(12,2) AS voided_earned,
    COALESCE(e.voided_allocation_count, 0) AS voided_allocation_count
   FROM partner_base pb
     LEFT JOIN active_capital ac ON ac.user_id = pb.user_id
     LEFT JOIN earned e ON e.user_id = pb.user_id
  ORDER BY (COALESCE(ac.active_capital, 0::numeric)) DESC, (COALESCE(e.total_earned, 0::numeric)) DESC, pb.full_name;

create or replace view public.role_permission_matrix as
select r.role, c.capability, (not c.restricted or r.role='ADMIN') as allowed,
  case when c.restricted then 'Solo propietario de la app' else 'Acceso operativo' end::text as notes
from (values ('ADMIN'),('AGENT'),('PARTNER')) r(role)
cross join (values ('Clientes',false),('Préstamos y desembolsos',false),('Registrar y anular pagos',false),
 ('Aportes, distribución y tasas',false),('Seguimientos y cuotas',false),('Reportes',false),
 ('Restablecer datos',true),('Editar roles',true),('Métodos de acceso',true),('Administrar acceso',true)) c(capability,restricted);

revoke all on public.partner_allocation_details, public.partner_earnings_summary from public, anon;

CREATE OR REPLACE FUNCTION public.apply_payment(p_loan_id uuid, p_paid_on date, p_amount numeric, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_loan record;
  v_due record;
  v_remaining numeric := round(p_amount, 2);

  v_apply_to_due numeric;
  v_apply_mgmt numeric;
  v_apply_funders numeric;

  v_interest_total numeric := 0;
  v_mgmt_total numeric := 0;
  v_funders_total numeric := 0;
  v_principal_total numeric := 0;

  v_payment_id uuid;
begin
  if auth.uid() is null or coalesce(public.app_role(),'') not in ('ADMIN','AGENT','PARTNER') then
    raise exception 'Tu cuenta no tiene permiso para registrar pagos.';
  end if;
  if v_remaining <= 0 then
    raise exception 'Payment amount must be > 0';
  end if;

  select l.*
  into v_loan
  from public.loans l
  where l.id = p_loan_id;

  if not found then
    raise exception 'Loan not found';
  end if;

  if v_loan.status <> 'ACTIVE' then
    raise exception 'Payments can only be applied to ACTIVE loans';
  end if;

  perform public.generate_missing_due_events_for_payment(p_loan_id, p_paid_on);

  create temp table if not exists tmp_payment_due_applications (
    loan_due_event_id uuid not null,
    applied_total numeric(12,2) not null,
    applied_mgmt numeric(12,2) not null,
    applied_funders numeric(12,2) not null
  ) on commit drop;

  truncate table tmp_payment_due_applications;

  -- Apply to oldest due events first
  for v_due in
    select *
    from public.loan_due_events
    where loan_id = p_loan_id
      and status in ('DUE','PARTIAL')
    order by due_date asc
  loop
    exit when v_remaining <= 0;

    v_apply_to_due := greatest(0, round(coalesce(v_due.expected_total, 0) - coalesce(v_due.paid_total, 0), 2));
    if v_apply_to_due <= 0 then
      continue;
    end if;

    v_apply_to_due := least(v_apply_to_due, v_remaining);

    v_apply_mgmt := least(
      greatest(0, round(coalesce(v_due.expected_mgmt, 0) - coalesce(v_due.paid_mgmt, 0), 2)),
      v_apply_to_due
    );

    v_apply_funders := v_apply_to_due - v_apply_mgmt;

    update public.loan_due_events
    set
      paid_total = round(paid_total + v_apply_to_due, 2),
      paid_mgmt = round(paid_mgmt + v_apply_mgmt, 2),
      paid_funders = round(paid_funders + v_apply_funders, 2),
      status = case
        when round(paid_total + v_apply_to_due, 2) >= round(coalesce(expected_total, 0), 2) then 'PAID'
        else 'PARTIAL'
      end,
      resolved_at = case
        when round(paid_total + v_apply_to_due, 2) >= round(coalesce(expected_total, 0), 2) then now()
        else resolved_at
      end
    where id = v_due.id;

    insert into tmp_payment_due_applications (
      loan_due_event_id,
      applied_total,
      applied_mgmt,
      applied_funders
    ) values (
      v_due.id,
      v_apply_to_due,
      v_apply_mgmt,
      v_apply_funders
    );

    v_remaining := round(v_remaining - v_apply_to_due, 2);

    v_interest_total := round(v_interest_total + v_apply_to_due, 2);
    v_mgmt_total := round(v_mgmt_total + v_apply_mgmt, 2);
    v_funders_total := round(v_funders_total + v_apply_funders, 2);
  end loop;

  -- Remaining goes to principal
  if v_remaining > 0 then
    v_principal_total := v_remaining;

    update public.loans
    set principal_outstanding = greatest(0, round(principal_outstanding - v_remaining, 2))
    where id = p_loan_id;

    v_remaining := 0;
  end if;

  -- Insert payment record
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
    created_by
  )
  values (
    p_loan_id,
    v_loan.borrower_id,
    p_paid_on,
    round(p_amount, 2),
    v_interest_total,
    v_mgmt_total,
    v_funders_total,
    v_principal_total,
    p_notes,
    auth.uid()
  )
  returning id into v_payment_id;

  insert into public.payment_due_applications (
    payment_id,
    loan_due_event_id,
    applied_total,
    applied_mgmt,
    applied_funders
  )
  select
    v_payment_id,
    loan_due_event_id,
    applied_total,
    applied_mgmt,
    applied_funders
  from tmp_payment_due_applications;

  -- Management allocation. Must match payment_allocations_allocation_type_check.
  if v_mgmt_total > 0 then
    insert into public.payment_allocations (
      payment_id,
      partner_user_id,
      amount,
      allocation_type
    )
    select
      v_payment_id,
      user_id,
      v_mgmt_total,
      'MANAGEMENT_FEE'
    from public.profiles
    where role = 'ADMIN'
    order by created_at asc
    limit 1;
  end if;

  -- Partner/funder distributions. Must match payment_allocations_allocation_type_check.
  if v_funders_total > 0 then
    insert into public.payment_allocations (
      payment_id,
      partner_user_id,
      amount,
      allocation_type
    )
    select
      v_payment_id,
      lf.partner_user_id,
      round(v_funders_total * lf.funding_percent, 2),
      'PARTNER_DISTRIBUTION'
    from public.loan_funding lf
    where lf.loan_id = p_loan_id;
  end if;

  return v_payment_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.audit_activity_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end;
  v_row jsonb := coalesce(v_new, v_old);
  v_action text;
  v_actor uuid;
  v_entity_id uuid;
  v_entity_text text;
  v_borrower_id uuid;
  v_loan_id uuid;
  v_payment_id uuid;
  v_summary text;
  v_borrower_name text;
  v_partner_name text;
begin
  v_actor := auth.uid();

  if v_actor is null then v_actor := nullif(v_row->>'updated_by', '')::uuid; end if;
  if v_actor is null then v_actor := nullif(v_row->>'created_by', '')::uuid; end if;
  if v_actor is null then v_actor := nullif(v_row->>'voided_by', '')::uuid; end if;
  if v_actor is null then v_actor := nullif(v_row->>'closed_by', '')::uuid; end if;

  if (v_row ? 'id') then
    v_entity_id := nullif(v_row->>'id', '')::uuid;
  elsif (v_row ? 'setting_key') then
    v_entity_text := v_row->>'setting_key';
  end if;

  if tg_table_name = 'borrowers' then
    v_borrower_id := v_entity_id;
    v_summary := coalesce(v_row->>'full_name', 'Cliente');
    v_action := case tg_op when 'INSERT' then 'CLIENT_CREATED' when 'UPDATE' then 'CLIENT_EDITED' when 'DELETE' then 'CLIENT_DELETED' end;

  elsif tg_table_name = 'loans' then
    v_loan_id := v_entity_id;
    v_borrower_id := nullif(v_row->>'borrower_id', '')::uuid;
    select full_name into v_borrower_name from public.borrowers where id = v_borrower_id;

    if tg_op = 'INSERT' then
      v_action := 'DISBURSEMENT_CREATED';
      v_summary := concat(coalesce(v_borrower_name, 'Cliente'), ' recibió desembolso de $', coalesce(v_row->>'principal_original','0'));
    elsif tg_op = 'DELETE' then
      v_action := 'DISBURSEMENT_DELETED';
      v_summary := concat('Desembolso eliminado: $', coalesce(v_row->>'principal_original','0'));
    elsif tg_op = 'UPDATE' and coalesce(v_old->>'status','') <> coalesce(v_new->>'status','') then
      v_action := case v_new->>'status'
        when 'PAID_OFF' then 'ACCOUNT_PRINCIPAL_PAID_OFF'
        when 'CLOSED' then 'DISBURSEMENT_CLOSED'
        when 'VOIDED' then 'DISBURSEMENT_VOIDED'
        when 'DEFAULTED' then 'ACCOUNT_MARKED_DEFAULTED'
        when 'PAUSED' then 'ACCOUNT_PAUSED'
        when 'ACTIVE' then 'DISBURSEMENT_REACTIVATED'
        else 'DISBURSEMENT_STATUS_CHANGED'
      end;
      v_summary := concat(coalesce(v_borrower_name, 'Cliente'), ' cambió estado de desembolso a ', coalesce(v_new->>'status',''));
    elsif tg_op = 'UPDATE' and coalesce(v_old->>'principal_outstanding','') <> coalesce(v_new->>'principal_outstanding','') then
      v_action := 'PRINCIPAL_BALANCE_CHANGED';
      v_summary := concat(coalesce(v_borrower_name, 'Cliente'), ' capital: $', coalesce(v_old->>'principal_outstanding','0'), ' → $', coalesce(v_new->>'principal_outstanding','0'));
    else
      v_action := 'DISBURSEMENT_EDITED';
      v_summary := concat(coalesce(v_borrower_name, 'Cliente'), ' desembolso editado');
    end if;

  elsif tg_table_name = 'payments' then
    v_payment_id := v_entity_id;
    v_loan_id := nullif(v_row->>'loan_id', '')::uuid;
    v_borrower_id := nullif(v_row->>'borrower_id', '')::uuid;
    select full_name into v_borrower_name from public.borrowers where id = v_borrower_id;

    if tg_op = 'INSERT' then
      v_action := 'ACCOUNT_PAYMENT_RECORDED';
      v_summary := concat(coalesce(v_borrower_name, 'Cliente'), ' pagó $', coalesce(v_row->>'amount','0'), ' el ', coalesce(v_row->>'paid_on',''), ' tipo ', coalesce(v_row->>'payment_type',''));
    elsif tg_op = 'DELETE' then
      v_action := 'PAYMENT_DELETED';
      v_summary := concat('Pago eliminado $', coalesce(v_row->>'amount','0'));
    elsif tg_op = 'UPDATE' and coalesce((v_old->>'is_voided')::boolean, false) = false and coalesce((v_new->>'is_voided')::boolean, false) = true then
      v_action := 'ACCOUNT_PAYMENT_VOIDED';
      v_summary := concat(coalesce(v_borrower_name, 'Cliente'), ' pago anulado $', coalesce(v_row->>'amount','0'), case when coalesce(v_row->>'void_reason','') <> '' then concat(' | ', v_row->>'void_reason') else '' end);
    elsif tg_op = 'UPDATE' and coalesce(v_old->>'notes','') <> coalesce(v_new->>'notes','') then
      v_action := 'PAYMENT_NOTES_EDITED';
      v_summary := concat(coalesce(v_borrower_name, 'Cliente'), ' notas del pago editadas');
    else
      v_action := 'PAYMENT_EDITED';
      v_summary := concat(coalesce(v_borrower_name, 'Cliente'), ' pago editado');
    end if;

  elsif tg_table_name = 'loan_funding' then
    v_loan_id := nullif(v_row->>'loan_id', '')::uuid;
    select l.borrower_id into v_borrower_id from public.loans l where l.id = v_loan_id;
    select full_name into v_partner_name from public.profiles where user_id = nullif(v_row->>'partner_user_id','')::uuid;
    v_summary := concat(coalesce(v_partner_name, 'Socio'), ' participación ', round(coalesce((v_row->>'funding_percent')::numeric, 0) * 100, 2), '%');
    v_action := case tg_op when 'INSERT' then 'FUNDING_SPLIT_ADDED' when 'UPDATE' then 'FUNDING_SPLIT_EDITED' when 'DELETE' then 'FUNDING_SPLIT_REMOVED' end;

  elsif tg_table_name = 'payment_allocations' then
    v_payment_id := nullif(v_row->>'payment_id','')::uuid;
    select p.borrower_id into v_borrower_id from public.payments p where p.id = v_payment_id;
    select full_name into v_partner_name from public.operational_administrators
    where id = nullif(v_row->>'operational_administrator_id','')::uuid;
    if v_partner_name is null then
      select full_name into v_partner_name from public.profiles where user_id = nullif(v_row->>'partner_user_id','')::uuid;
    end if;
    v_summary := concat(coalesce(v_partner_name, 'Socio'), ' distribución $', coalesce(v_row->>'amount','0'), ' ', coalesce(v_row->>'allocation_type',''));
    v_action := case tg_op when 'INSERT' then 'PARTNER_ALLOCATION_CREATED' when 'UPDATE' then 'PARTNER_ALLOCATION_EDITED' when 'DELETE' then 'PARTNER_ALLOCATION_REVERSED' end;

  elsif tg_table_name = 'payment_principal_applications' then
    v_payment_id := nullif(v_row->>'payment_id','')::uuid;
    v_loan_id := nullif(v_row->>'loan_id','')::uuid;
    v_borrower_id := nullif(v_row->>'borrower_id','')::uuid;
    v_summary := concat('Abono a capital aplicado $', coalesce(v_row->>'amount','0'));
    v_action := case tg_op when 'INSERT' then 'PRINCIPAL_PAYMENT_APPLIED' when 'UPDATE' then 'PRINCIPAL_PAYMENT_EDITED' when 'DELETE' then 'PRINCIPAL_PAYMENT_REVERSED' end;

  elsif tg_table_name = 'borrower_contact_log' then
    v_borrower_id := nullif(v_row->>'borrower_id','')::uuid;
    v_summary := concat(coalesce(v_row->>'contact_type','Contacto'), ' ', coalesce(v_row->>'contact_date',''), ' ', coalesce(v_row->>'outcome',''));
    v_action := case tg_op when 'INSERT' then 'CONTACT_NOTE_CREATED' when 'UPDATE' then 'CONTACT_NOTE_EDITED' when 'DELETE' then 'CONTACT_NOTE_DELETED' end;

  elsif tg_table_name = 'borrower_followups' then
    v_borrower_id := nullif(v_row->>'borrower_id','')::uuid;
    v_summary := concat('Seguimiento ', coalesce(v_row->>'due_date',''), ' ', coalesce(v_row->>'priority',''), ' ', coalesce(v_row->>'status',''));
    v_action := case tg_op when 'INSERT' then 'FOLLOWUP_CREATED' when 'UPDATE' then 'FOLLOWUP_EDITED' when 'DELETE' then 'FOLLOWUP_DELETED' end;

  elsif tg_table_name = 'default_funding_splits' then
    v_summary := concat('Default funding split ', round(coalesce((v_row->>'funding_percent')::numeric, 0) * 100, 2), '%');
    v_action := case tg_op when 'INSERT' then 'DEFAULT_SPLIT_ADDED' when 'UPDATE' then 'DEFAULT_SPLIT_EDITED' when 'DELETE' then 'DEFAULT_SPLIT_REMOVED' end;

  elsif tg_table_name = 'app_settings' then
    v_summary := concat('Setting ', coalesce(v_row->>'setting_key', 'updated'));
    v_action := case tg_op when 'INSERT' then 'SETTING_CREATED' when 'UPDATE' then 'SETTING_EDITED' when 'DELETE' then 'SETTING_DELETED' end;

  elsif tg_table_name = 'profiles' then
    v_entity_id := nullif(v_row->>'user_id', '')::uuid;
    v_summary := concat('Profile ', coalesce(v_row->>'full_name', ''), ' ', coalesce(v_row->>'role', ''));
    v_action := case tg_op when 'INSERT' then 'PROFILE_CREATED' when 'UPDATE' then 'PROFILE_EDITED' when 'DELETE' then 'PROFILE_DELETED' end;

  else
    v_action := upper(tg_table_name || '_' || tg_op);
    v_summary := tg_table_name || ' changed';
  end if;

  insert into public.activity_log (
    actor_user_id, action_type, entity_table, entity_id, entity_text,
    borrower_id, loan_id, payment_id, summary, old_data, new_data
  ) values (
    v_actor, v_action, tg_table_name, v_entity_id, v_entity_text,
    v_borrower_id, v_loan_id, v_payment_id, v_summary, v_old, v_new
  );

  return coalesce(new, old);
end;
$function$;
