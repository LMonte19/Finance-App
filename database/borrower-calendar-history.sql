-- Historical charges are derived from disbursements and dated principal payments.
-- Reading a calendar never inserts, edits, reallocates or voids financial records.
create or replace function public.borrower_due_timeline(p_borrower_id uuid, p_end_date date)
returns table(borrower_id uuid, borrower_name text, due_date date, principal_snapshot numeric,
  expected_total numeric, expected_mgmt numeric, expected_funders numeric,
  paid_total numeric, paid_mgmt numeric, paid_funders numeric, amount_due numeric,
  status text, timing_status text, is_virtual boolean, source_event_id uuid)
language sql stable security invoker set search_path = public
as $timeline$
with eligible_loans as materialized (
  select l.* from public.loans l
  where l.borrower_id=p_borrower_id and l.status not in ('VOIDED','VOID')
), principal_moves as materialized (
  select a.loan_id, greatest(p.paid_on,l.start_date) as effective_on, a.amount
  from public.payment_principal_applications a
  join public.payments p on p.id=a.payment_id and not coalesce(p.is_voided,false)
  join eligible_loans l on l.id=a.loan_id
  union all
  select p.loan_id, greatest(p.paid_on,l.start_date), p.applied_principal
  from public.payments p join eligible_loans l on l.id=p.loan_id
  where not coalesce(p.is_voided,false) and p.applied_principal>0
    and not exists(select 1 from public.payment_principal_applications a where a.payment_id=p.id)
), dates as (
  select s.due_date from public.payment_schedule_dates(
    (select min(start_date) from eligible_loans), coalesce(p_end_date,current_date+365)) s
  union
  select e.due_date from public.borrower_due_events e
  where e.borrower_id=p_borrower_id and e.due_date<=coalesce(p_end_date,current_date+365)
), balances as (
  select d.due_date,l.id,l.monthly_rate_total,l.monthly_rate_mgmt,
    greatest(0,l.principal_original-coalesce((select sum(m.amount) from principal_moves m
      where m.loan_id=l.id and m.effective_on<d.due_date),0)) as principal
  from dates d join eligible_loans l on l.start_date<=d.due_date
), charges as (
  select d.due_date,round(coalesce(sum(b.principal),0),2) as principal_snapshot,
    round(coalesce(sum(b.principal*coalesce(b.monthly_rate_total,.10))/2,0),2) as expected_total,
    round(coalesce(sum(b.principal*coalesce(b.monthly_rate_mgmt,.03))/2,0),2) as expected_mgmt
  from dates d left join balances b on b.due_date=d.due_date group by d.due_date
), legacy_paid as (
  -- Preserve imported paid cycles as well as linked legacy payments.
  select e.due_date,sum(coalesce(e.paid_total,0)) as total,
    sum(coalesce(e.paid_mgmt,0)) as mgmt,sum(coalesce(e.paid_funders,0)) as funders
  from public.loan_due_events e join eligible_loans l on l.id=e.loan_id
  group by e.due_date
), amounts as (
  select p_borrower_id as borrower_id,b.full_name as borrower_name,c.*,
    round(c.expected_total-c.expected_mgmt,2) as expected_funders,
    round(coalesce(e.paid_total,0)+coalesce(lp.total,0),2) as paid_total,
    round(coalesce(e.paid_mgmt,0)+coalesce(lp.mgmt,0),2) as paid_mgmt,
    round(coalesce(e.paid_funders,0)+coalesce(lp.funders,0),2) as paid_funders,
    (e.id is null) as is_virtual,e.id as source_event_id
  from charges c join public.borrowers b on b.id=p_borrower_id
  left join public.borrower_due_events e on e.borrower_id=p_borrower_id and e.due_date=c.due_date
  left join legacy_paid lp on lp.due_date=c.due_date
), states as (
  select a.*,greatest(0,round(a.expected_total-a.paid_total,2)) as amount_due,
    case when a.expected_total<=0 and a.paid_total<=0 then 'CANCELLED'
      when a.paid_total>=a.expected_total then 'PAID'
      when a.paid_total>0 then 'PARTIAL' else 'DUE' end as status
  from amounts a
)
select s.borrower_id,s.borrower_name,s.due_date,s.principal_snapshot,
  s.expected_total,s.expected_mgmt,s.expected_funders,s.paid_total,s.paid_mgmt,s.paid_funders,
  s.amount_due,s.status,
  case when s.status in ('PAID','CANCELLED') then s.status
    when s.due_date<current_date then 'OVERDUE'
    when s.due_date=current_date then 'DUE_TODAY' else 'UPCOMING' end,
  s.is_virtual,s.source_event_id
from states s order by s.due_date;
$timeline$;

create or replace function public.get_borrower_due_calendar(p_borrower_id uuid,p_start_date date,p_end_date date)
returns table(borrower_id uuid,borrower_name text,due_date date,principal_snapshot numeric,
  expected_total numeric,expected_mgmt numeric,expected_funders numeric,
  paid_total numeric,paid_mgmt numeric,paid_funders numeric,amount_due numeric,
  status text,timing_status text,is_virtual boolean,source_event_id uuid)
language sql stable security invoker set search_path = public
as $calendar$
  select * from public.borrower_due_timeline(p_borrower_id,coalesce(p_end_date,current_date+365)) t
  where t.due_date>=coalesce(p_start_date,t.due_date) order by t.due_date;
$calendar$;

create or replace function public.get_borrower_calendar_workspace(p_borrower_id uuid,p_end_date date default null)
returns jsonb language sql stable security invoker set search_path = public
as $workspace$
with allowed as materialized (
  select b.id from public.borrowers b where b.id=p_borrower_id
), account_payments as materialized (
  select p.* from public.borrower_account_payments_view p
  where p.borrower_id in (select id from allowed)
), due_apps as materialized (
  select a.payment_id,e.due_date,a.applied_total,a.applied_mgmt,a.applied_funders
  from public.payment_borrower_due_applications a join public.borrower_due_events e on e.id=a.borrower_due_event_id
  where e.borrower_id in (select id from allowed)
  union all
  select a.payment_id,e.due_date,a.applied_total,a.applied_mgmt,a.applied_funders
  from public.payment_due_applications a join public.loan_due_events e on e.id=a.loan_due_event_id
  join public.loans l on l.id=e.loan_id where l.borrower_id in (select id from allowed)
), principal_apps as materialized (
  select a.payment_id,a.loan_id,a.amount from public.payment_principal_applications a
  where a.borrower_id in (select id from allowed)
  union all
  select p.id,p.loan_id,p.applied_principal from account_payments p
  where p.applied_principal>0 and not exists(select 1 from public.payment_principal_applications a where a.payment_id=p.id)
), enriched_payments as (
  select p.*,
    coalesce((select jsonb_agg(to_jsonb(a)-'payment_id' order by a.due_date) from due_apps a where a.payment_id=p.id),'[]'::jsonb) as due_applications,
    coalesce((select jsonb_agg(to_jsonb(a)-'payment_id') from principal_apps a where a.payment_id=p.id),'[]'::jsonb) as principal_applications,
    coalesce((select jsonb_agg(jsonb_build_object('partner_name',a.partner_name,'allocation_type',a.allocation_type,'amount',a.amount,'is_voided',a.is_voided))
      from public.partner_allocation_details a where a.payment_id=p.id),'[]'::jsonb) as allocations
  from account_payments p
)
select jsonb_build_object('as_of_date',current_date,
  'rows',coalesce((select jsonb_agg(to_jsonb(t) order by t.due_date)
    from public.borrower_due_timeline(p_borrower_id,coalesce(p_end_date,(current_date+interval '18 months')::date)) t),'[]'::jsonb),
  'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.paid_on desc,p.created_at desc) from enriched_payments p),'[]'::jsonb))
where exists(select 1 from allowed);
$workspace$;

-- Keep booked charge amounts in sync when writing payments, without moving any
-- prior payment applications or changing principal/payment/distribution records.
create or replace function public.generate_missing_borrower_due_events(
  p_borrower_id uuid,p_through_date date default ((current_date+interval '1 year')::date),
  p_from_date date default null,p_only_active boolean default true)
returns integer language plpgsql security invoker set search_path = public
as $generate$
declare v_count integer;
begin
  if coalesce(public.app_role(),'') not in ('ADMIN','AGENT') then
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
$generate$;

create or replace function public.regenerate_future_borrower_due_events(p_borrower_id uuid,p_months_ahead integer default 12)
returns integer language plpgsql security invoker set search_path = public
as $regenerate$
begin
  if coalesce(public.app_role(),'') not in ('ADMIN','AGENT') then
    raise exception 'Only Admin/Agent can regenerate account due dates';
  end if;
  return public.generate_missing_borrower_due_events(p_borrower_id,
    (current_date+make_interval(months=>greatest(coalesce(p_months_ahead,12),1)))::date,current_date,true);
end;
$regenerate$;

revoke all on function public.borrower_due_timeline(uuid,date) from public,anon;
revoke all on function public.get_borrower_due_calendar(uuid,date,date) from public,anon;
revoke all on function public.get_borrower_calendar_workspace(uuid,date) from public,anon;
revoke all on function public.generate_missing_borrower_due_events(uuid,date,date,boolean) from public,anon;
revoke all on function public.regenerate_future_borrower_due_events(uuid,integer) from public,anon;
grant execute on function public.borrower_due_timeline(uuid,date),public.get_borrower_due_calendar(uuid,date,date),
  public.get_borrower_calendar_workspace(uuid,date),public.generate_missing_borrower_due_events(uuid,date,date,boolean),
  public.regenerate_future_borrower_due_events(uuid,integer) to authenticated,service_role;

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
  if public.app_role() not in ('ADMIN','AGENT') then
    raise exception 'Only Admin/Agent can record payments';
  end if;

  if v_remaining <= 0 then
    raise exception 'Payment amount must be > 0';
  end if;

  if v_type not in ('INSTALLMENT','PRINCIPAL','MIXED','PAYOFF') then
    raise exception 'Invalid payment type';
  end if;

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


create or replace view public.borrower_account_summary with (security_invoker=true) as
 WITH loan_totals AS (
         SELECT b.id AS borrower_id,
            b.full_name,
            b.phone,
            b.notes,
            count(l.id) FILTER (WHERE (l.status <> 'VOIDED'::text)) AS disbursement_count,
            count(l.id) FILTER (WHERE (l.status = 'ACTIVE'::text)) AS active_disbursement_count,
            COALESCE(sum(l.principal_original) FILTER (WHERE (l.status <> 'VOIDED'::text)), (0)::numeric) AS total_disbursed,
            COALESCE(sum(l.principal_outstanding) FILTER (WHERE (l.status = 'ACTIVE'::text)), (0)::numeric) AS principal_balance,
            COALESCE(sum((l.principal_outstanding * COALESCE(l.monthly_rate_total, 0.10))) FILTER (WHERE (l.status = 'ACTIVE'::text)), (0)::numeric) AS monthly_fee_amount,
            COALESCE(sum((l.principal_outstanding * COALESCE(l.monthly_rate_mgmt, 0.03))) FILTER (WHERE (l.status = 'ACTIVE'::text)), (0)::numeric) AS monthly_mgmt_amount,
            min(l.start_date) FILTER (WHERE (l.status = 'ACTIVE'::text)) AS first_active_date,
            max(l.start_date) FILTER (WHERE (l.status <> 'VOIDED'::text)) AS last_disbursement_date
           FROM (borrowers b
             LEFT JOIN loans l ON ((l.borrower_id = b.id)))
          GROUP BY b.id, b.full_name, b.phone, b.notes
        ), pay_totals AS (
         SELECT payments.borrower_id,
            COALESCE(sum(payments.amount) FILTER (WHERE (COALESCE(payments.is_voided, false) = false)), (0)::numeric) AS total_paid,
            COALESCE(sum(payments.applied_interest) FILTER (WHERE (COALESCE(payments.is_voided, false) = false)), (0)::numeric) AS total_fee_paid,
            COALESCE(sum(payments.applied_principal) FILTER (WHERE (COALESCE(payments.is_voided, false) = false)), (0)::numeric) AS total_principal_paid,
            max(payments.paid_on) FILTER (WHERE (COALESCE(payments.is_voided, false) = false)) AS last_payment_date
           FROM payments
          GROUP BY payments.borrower_id
        ), due_totals AS (
  select b.id as borrower_id,
    coalesce(sum(t.amount_due) filter(where t.due_date<current_date),0) as overdue_amount,
    count(*) filter(where t.due_date<current_date and t.amount_due>0) as overdue_count,
    max(current_date-t.due_date) filter(where t.due_date<current_date and t.amount_due>0) as max_days_late,
    min(t.due_date) filter(where t.amount_due>0) as next_due_date,
    coalesce(sum(t.amount_due) filter(where t.due_date=current_date),0) as due_today_amount
  from public.borrowers b
  cross join lateral public.borrower_due_timeline(b.id,current_date+365) t
  group by b.id
)
 SELECT lt.borrower_id,
    lt.full_name,
    lt.phone,
    lt.notes,
    lt.disbursement_count,
    lt.active_disbursement_count,
    lt.total_disbursed,
    lt.principal_balance,
    lt.monthly_fee_amount,
    lt.monthly_mgmt_amount,
    lt.first_active_date,
    lt.last_disbursement_date,
    round(lt.monthly_fee_amount, 2) AS current_monthly_fee,
    round((lt.monthly_fee_amount / (2)::numeric), 2) AS current_cycle_fee,
    round(lt.monthly_mgmt_amount, 2) AS current_monthly_mgmt,
    round(GREATEST((0)::numeric, (lt.monthly_fee_amount - lt.monthly_mgmt_amount)), 2) AS current_monthly_funders,
    COALESCE(pt.total_paid, (0)::numeric) AS total_paid,
    COALESCE(pt.total_fee_paid, (0)::numeric) AS total_fee_paid,
    COALESCE(pt.total_principal_paid, (0)::numeric) AS total_principal_paid,
    pt.last_payment_date,
    COALESCE(dt.overdue_amount, (0)::numeric) AS overdue_amount,
    COALESCE(dt.overdue_count, (0)::bigint) AS overdue_count,
    COALESCE(dt.max_days_late, 0) AS max_days_late,
    dt.next_due_date,
    COALESCE(dt.due_today_amount, (0)::numeric) AS due_today_amount,
        CASE
            WHEN (COALESCE(lt.principal_balance, (0)::numeric) <= (0)::numeric) THEN 'SALDADO'::text
            WHEN (COALESCE(dt.overdue_amount, (0)::numeric) > (0)::numeric) THEN 'ATRASADO'::text
            ELSE 'AL DIA'::text
        END AS account_status
   FROM ((loan_totals lt
     LEFT JOIN pay_totals pt ON ((pt.borrower_id = lt.borrower_id)))
     LEFT JOIN due_totals dt ON ((dt.borrower_id = lt.borrower_id)));
