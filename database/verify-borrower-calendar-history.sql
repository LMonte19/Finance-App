do $verify$
declare
  b uuid:=gen_random_uuid(); l1 uuid:=gen_random_uuid(); l2 uuid:=gen_random_uuid(); l3 uuid:=gen_random_uuid();
  admin_id uuid; original_payment uuid:=gen_random_uuid(); partial_payment uuid:=gen_random_uuid();
  legacy_id uuid:=gen_random_uuid(); event_id uuid:=gen_random_uuid(); future_event uuid:=gen_random_uuid();
  principal_payment uuid; fee_payment uuid; future_payment uuid:=gen_random_uuid(); voided_payment uuid:=gen_random_uuid();
  row record; payload jsonb; passed boolean:=false; n integer;
begin
  select user_id into admin_id from public.profiles where role='ADMIN' order by created_at limit 1;
  assert admin_id is not null,'An admin profile is required for the rollback-only contract test';
  begin
    perform set_config('request.jwt.claim.sub',admin_id::text,true);
    insert into public.borrowers(id,full_name,created_by) values(b,'Calendar rollback verification',admin_id);
    insert into public.loans(id,borrower_id,created_by,start_date,principal_original,principal_outstanding,monthly_rate_total,monthly_rate_mgmt,status)
      values(l1,b,admin_id,'2026-01-01',1000,800,.1,.03,'ACTIVE'),
            (l2,b,admin_id,'2026-01-20',500,500,.1,.03,'ACTIVE'),
            (l3,b,admin_id,'2027-01-01',200,200,.1,.03,'ACTIVE');
    insert into public.payments(id,loan_id,borrower_id,paid_on,amount,applied_principal,applied_interest,applied_mgmt,applied_funders,created_by,payment_type,account_payment)
      values(original_payment,l1,b,'2026-01-31',200,200,0,0,0,admin_id,'PRINCIPAL',true),
            (partial_payment,l1,b,'2026-01-16',10,0,10,3,7,admin_id,'INSTALLMENT',true),
            (future_payment,l1,b,current_date,5,0,5,1.5,3.5,admin_id,'INSTALLMENT',true);
    insert into public.payment_principal_applications(payment_id,loan_id,borrower_id,amount) values(original_payment,l1,b,200);
    insert into public.payments(id,loan_id,borrower_id,paid_on,amount,applied_principal,created_by,payment_type,account_payment,is_voided)
      values(voided_payment,l1,b,'2026-01-10',700,700,admin_id,'PRINCIPAL',true,true);
    insert into public.payment_principal_applications(payment_id,loan_id,borrower_id,amount) values(voided_payment,l1,b,700);
    insert into public.borrower_due_events(id,borrower_id,due_date,principal_snapshot,expected_total,expected_mgmt,expected_funders,paid_total,paid_mgmt,paid_funders,status)
      values(event_id,b,'2026-01-15',1300,65,19.5,45.5,10,3,7,'PARTIAL'),
            (future_event,b,'2027-01-15',1300,65,19.5,45.5,5,1.5,3.5,'PARTIAL');
    insert into public.payment_borrower_due_applications(payment_id,borrower_due_event_id,applied_total,applied_mgmt,applied_funders)
      values(partial_payment,event_id,10,3,7),(future_payment,future_event,5,1.5,3.5);
    insert into public.loan_due_events(id,loan_id,due_date,expected_interest,expected_total,expected_mgmt,expected_funders,paid_total,paid_mgmt,paid_funders,status)
      values(legacy_id,l1,'2026-01-15',50,50,15,35,20,6,14,'PARTIAL');
    select * into row from public.borrower_due_timeline(b,'2027-02-28') where due_date='2026-01-15';
    assert row.expected_total=50 and row.paid_total=30 and row.amount_due=20,'Historical amount and legacy/current payments must combine exactly once';
    assert (select expected_total from public.borrower_due_events where id=event_id)=65,'Reading must not edit booked charges';
    select * into row from public.borrower_due_timeline(b,'2027-02-28') where due_date='2026-01-31';
    assert row.principal_snapshot=1500 and row.expected_total=75,'A same-day principal payment affects subsequent cycles';
    select * into row from public.borrower_due_timeline(b,'2027-02-28') where due_date='2026-02-15';
    assert row.principal_snapshot=1300 and row.expected_total=65,'Subsequent cycles use the dated principal balance and ignore voided payments';
    select * into row from public.borrower_due_timeline(b,'2027-02-28') where due_date='2027-01-15';
    assert row.expected_total=75 and row.amount_due=70,'A dated future disbursement updates the partially paid future cycle';
    assert not exists(select 1 from public.get_borrower_due_calendar(b,'2025-12-31','2025-12-31')),'No invented charge before the first disbursement';
    assert not has_function_privilege('anon','public.get_borrower_calendar_workspace(uuid,date)','EXECUTE'),'Anonymous RPC access must be revoked';
    execute 'set local role authenticated';
    payload:=public.get_borrower_calendar_workspace(b,'2027-02-28');
    assert jsonb_array_length(payload->'rows')=28,'An authenticated admin can read the complete calendar under RLS';
    assert jsonb_array_length(payload->'payments')=4,'All receipts including voided history remain accessible';
    perform public.generate_missing_borrower_due_events(b,'2027-02-28',null,true);
    assert (select expected_total from public.borrower_due_events where id=event_id)=50,'Generation corrects the charge from its dated capital';
    assert (select paid_total from public.borrower_due_events where id=event_id)=10,'Generation must not rewrite the payment applications';
    fee_payment:=public.apply_borrower_payment(b,'2026-01-31',20,'INSTALLMENT','Rollback-only test');
    select * into row from public.borrower_due_timeline(b,'2027-02-28') where due_date='2026-01-15';
    assert row.amount_due=0 and row.paid_total=50,'FIFO payment must collect only the remaining amount after legacy credits';
    assert (select applied_total from public.payment_borrower_due_applications where payment_id=fee_payment and borrower_due_event_id=event_id)=20,'Payment receipt links to the actual installment';
    principal_payment:=public.apply_borrower_payment(b,'2026-02-10',100,'PRINCIPAL','Rollback-only test');
    select * into row from public.borrower_due_timeline(b,'2027-02-28') where due_date='2026-02-15';
    assert row.expected_total=60,'A capital payment changes the next cycle';
    select * into row from public.borrower_due_timeline(b,'2027-02-28') where due_date='2026-01-31';
    assert row.expected_total=75,'Later capital payments never change earlier charges';
    perform public.regenerate_future_borrower_due_events(b,12);
    assert (select id from public.borrower_due_events where borrower_id=b and due_date='2027-01-15')=future_event,'Regeneration preserves existing cycle and payment IDs';
    assert (select paid_total from public.borrower_due_events where id=future_event)=5,'Future partial payments remain applied';
    perform public.void_payment(principal_payment,'Rollback-only test');
    select * into row from public.borrower_due_timeline(b,'2027-02-28') where due_date='2026-02-15';
    assert row.expected_total=65,'Voiding principal restores subsequent charges';
    perform public.void_payment(fee_payment,'Rollback-only test');
    select * into row from public.borrower_due_timeline(b,'2027-02-28') where due_date='2026-01-15';
    assert row.amount_due=20 and row.paid_total=30,'Voiding an installment reopens only its original application';
    principal_payment:=public.apply_borrower_payment(b,'2026-02-10',.10,'PRINCIPAL','Rollback-only cents test');
    assert (select applied_principal from public.payments where id=principal_payment)=.10,'Exact sub-dollar amounts must be recorded';
    assert (select principal_outstanding from public.loans where id=l1)=799.90,'Cents must reach the principal application without rounding to an integer';
    perform public.void_payment(principal_payment,'Rollback-only cents test');
    assert (select principal_outstanding from public.loans where id=l1)=800,'Cents must reverse exactly';
    execute 'reset role';
    passed:=true;
    raise sqlstate 'ZX001' using message='Rollback verification fixtures';
  exception when sqlstate 'ZX001' then null;
  end;
  assert passed,'Calendar verification did not complete';
  assert not exists(select 1 from public.borrowers where id=b),'All verification data must roll back';
  assert not exists(select 1 from public.payments where id in (original_payment,partial_payment,future_payment,voided_payment)),'No test payments may remain';
end;
$verify$;
