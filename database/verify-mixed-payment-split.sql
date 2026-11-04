-- Tests run under authenticated permissions and roll every fixture back.
do $verify$
declare
  b uuid:=gen_random_uuid(); l1 uuid:=gen_random_uuid(); l2 uuid:=gen_random_uuid();
  admin_id uuid; partner_id uuid; test_payment uuid; context jsonb; row record;
  principal_before numeric; principal_after numeric; payment_count integer;
  rejected boolean; passed boolean:=false; reference_date date:=current_date;
begin
  select user_id into admin_id from public.profiles where role='ADMIN' order by created_at limit 1;
  select user_id into partner_id from public.profiles where role='PARTNER' order by created_at limit 1;
  assert admin_id is not null and partner_id is not null,'Admin and partner profiles are required for verification';
  begin
    perform set_config('request.jwt.claim.sub',admin_id::text,true);
    insert into public.borrowers(id,full_name,created_by) values(b,'Mixed rollback verification',admin_id);
    insert into public.loans(id,borrower_id,created_by,start_date,principal_original,principal_outstanding,monthly_rate_total,monthly_rate_mgmt,status)
      values(l1,b,admin_id,(reference_date-interval '3 months')::date,200000,200000,.1,.03,'ACTIVE'),
            (l2,b,admin_id,(reference_date-interval '3 months')::date,185000,185000,.1,.03,'ACTIVE');
    insert into public.loan_funding(loan_id,partner_user_id,funding_percent)
      values(l1,admin_id,.6),(l1,partner_id,.4),(l2,admin_id,.6),(l2,partner_id,.4);
    execute 'set local role authenticated';
    context:=public.get_borrower_mixed_payment_context(b,reference_date);
    assert (context->>'cycle_amount')::numeric=19250,'Preview must suggest the current cycle amount';
    assert (context->>'pending_interest')::numeric>30000,'Fixture must have enough arrears to swallow an automatic mixed payment';
    assert (context->>'principal_balance')::numeric=385000,'Preview must use the available principal';
    test_payment:=public.apply_borrower_mixed_payment(b,reference_date,30000,19250,10750,'Exact split verification');
    select * into row from public.payments where id=test_payment;
    assert row.amount=30000 and row.applied_interest=19250 and row.applied_principal=10750 and row.payment_type='MIXED','One payment must preserve the exact split';
    assert row.applied_mgmt+row.applied_funders=row.applied_interest,'Fee components must reconcile';
    assert (select sum(applied_total) from public.payment_borrower_due_applications where payment_id=row.id)=19250,'Only the chosen installment budget goes to dues';
    assert (select sum(amount) from public.payment_principal_applications where payment_id=row.id)=10750,'Only the chosen capital budget reduces loans';
    assert (select sum(principal_outstanding) from public.loans where borrower_id=b)=374250,'Arrears must not consume the chosen capital budget';
    assert (select sum(amount) from public.payment_allocations where payment_id=row.id)=19250,'Partner/management allocations exclude principal';
    assert exists(select 1 from public.borrower_due_timeline(b,reference_date) where amount_due>0),'Unpaid arrears must stay outstanding';
    perform public.void_payment(test_payment,'Rollback verification');
    assert (select sum(principal_outstanding) from public.loans where borrower_id=b)=385000,'Void must restore capital exactly';
    assert not exists(select 1 from public.payment_allocations where payment_id=row.id),'Void must reverse income allocations';
    assert (select is_voided from public.payments where id=row.id),'The original receipt must remain in voided history';

    test_payment:=public.apply_borrower_mixed_payment(b,reference_date,30000,10000,20000,'Custom split');
    select * into row from public.payments where id=test_payment;
    assert row.applied_interest=10000 and row.applied_principal=20000,'A custom split must replace the suggestion exactly';
    test_payment:=public.apply_borrower_mixed_payment(b,reference_date,1000,0,1000,'Zero installment');
    assert (select applied_interest from public.payments where id=test_payment)=0,'Zero installment must remain zero';
    test_payment:=public.apply_borrower_mixed_payment(b,reference_date,1000,1000,0,'Zero principal');
    assert (select applied_principal from public.payments where id=test_payment)=0,'Zero capital must remain zero';
    test_payment:=public.apply_borrower_mixed_payment(b,reference_date,.10,.05,.05,'Exact cents');
    select * into row from public.payments where id=test_payment;
    assert row.amount=.10 and row.applied_interest=.05 and row.applied_principal=.05,'Both budgets must preserve cents';
    assert (select sum(amount) from public.payment_allocations where payment_id=row.id)=.05,'Rounded partner shares must add up to the exact fee';

    select count(*) into payment_count from public.payments where borrower_id=b;
    select sum(principal_outstanding) into principal_before from public.loans where borrower_id=b;
    rejected:=false;begin perform public.apply_borrower_mixed_payment(b,reference_date,30000,10000,19000,null);exception when raise_exception then rejected:=true;end;
    assert rejected,'A split that does not equal the total must fail';
    rejected:=false;begin perform public.apply_borrower_mixed_payment(b,reference_date,999999,0,999999,null);exception when raise_exception then rejected:=true;end;
    assert rejected,'A capital overpayment must fail';
    rejected:=false;begin perform public.apply_borrower_mixed_payment(b,reference_date,99999999,99999999,0,null);exception when raise_exception then rejected:=true;end;
    assert rejected,'An installment budget above the available dues must fail';
    rejected:=false;begin perform public.apply_borrower_mixed_payment(b,reference_date,.001,.001,0,null);exception when raise_exception then rejected:=true;end;
    assert rejected,'Fractions smaller than one cent must fail';
    rejected:=false;begin perform public.apply_borrower_mixed_payment(b,reference_date,10,-1,11,null);exception when raise_exception then rejected:=true;end;
    assert rejected,'Negative allocations must fail';
    rejected:=false;begin perform public.apply_borrower_mixed_payment(b,reference_date,'NaN'::numeric,0,0,null);exception when raise_exception then rejected:=true;end;
    assert rejected,'Non-finite amounts must fail';
    perform set_config('request.jwt.claim.sub',partner_id::text,true);
    rejected:=false;begin perform public.apply_borrower_mixed_payment(b,reference_date,10,5,5,null);exception when raise_exception then rejected:=true;end;
    assert rejected,'A partner must not write payments';
    perform set_config('request.jwt.claim.sub',admin_id::text,true);
    assert (select count(*) from public.payments where borrower_id=b)=payment_count,'Rejected requests must not leave partial payments';
    assert (select sum(principal_outstanding) from public.loans where borrower_id=b)=principal_before,'Rejected requests must not change principal';
    assert not has_function_privilege('anon','public.apply_borrower_mixed_payment(uuid,date,numeric,numeric,numeric,text)','EXECUTE'),'Anonymous execution must be revoked';

    test_payment:=public.apply_borrower_mixed_payment(b,reference_date,principal_before+19250,19250,principal_before,'Full payoff with interest');
    assert (select sum(principal_outstanding) from public.loans where borrower_id=b)=0,'A chosen full principal payoff must clear capital';
    select * into row from public.payments where id=test_payment;
    assert row.applied_funders>0,'The full payoff test must include partner income';
    assert (select sum(amount) from public.payment_allocations where payment_id=row.id)=19250,'Partner income must not disappear when capital reaches zero';
    perform public.void_payment(test_payment,'Rollback verification');
    assert (select sum(principal_outstanding) from public.loans where borrower_id=b)=principal_before,'Voiding a full mixed payoff must restore its exact capital';
    execute 'reset role';
    passed:=true;raise sqlstate 'ZX002' using message='Rollback mixed verification fixtures';
  exception when sqlstate 'ZX002' then null;
  end;
  assert passed,'Mixed payment verification did not finish';
  assert not exists(select 1 from public.borrowers where id=b),'All verification fixtures must roll back';
end;
$verify$;
