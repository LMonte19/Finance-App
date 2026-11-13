-- Allow Socios to reverse payments without giving them direct access to regenerate schedules.
CREATE OR REPLACE FUNCTION finance_workflow_private.restore_voided_payment_dues(p_borrower_id uuid, p_through_date date DEFAULT ((CURRENT_DATE + '1 year'::interval))::date, p_from_date date DEFAULT NULL::date, p_only_active boolean DEFAULT true)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_count integer;
begin
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
revoke all on function finance_workflow_private.restore_voided_payment_dues(uuid,date,date,boolean) from public,anon,authenticated;

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
  if auth.uid() is null or coalesce(public.app_role(),'') not in ('ADMIN','PARTNER') then
    raise exception 'Solo un administrador o socio puede anular pagos.';
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
revoke all on function public.void_payment(uuid,text) from public,anon;
grant execute on function public.void_payment(uuid,text) to authenticated;
