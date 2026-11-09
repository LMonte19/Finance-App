-- Exercise the workflows under the app role, with all fixtures rolled back.
do $verify$
declare
  admin_id uuid; agent_id uuid; partner_id uuid;
  b uuid; l1 uuid; l2 uuid; p_current uuid; p_older uuid; p_custom uuid; p_mixed uuid;
  earlier date; later date; current_cycle date; remaining date;
  rejected boolean; passed boolean:=false;
begin
  select user_id into admin_id from public.profiles where role='ADMIN' order by created_at limit 1;
  select user_id into agent_id from public.profiles where role='AGENT' order by created_at limit 1;
  select user_id into partner_id from public.profiles where role='PARTNER' order by created_at limit 1;
  assert admin_id is not null and partner_id is not null;
  begin
    perform set_config('request.jwt.claim.sub',admin_id::text,true);
    execute 'set local role authenticated';
    insert into public.borrowers(full_name,phone,notes,additional_phones,emails,guarantor_name,guarantor_phone,guarantor_email,created_by)
      values('Workflow verification','5550101','Original notes',array['5550102'],array['demo@example.test'],'Demo Guarantor','5550103','demo-guarantor@example.test',admin_id)
      returning id into b;
    assert (select cardinality(additional_phones)=1 and guarantor_name='Demo Guarantor' from public.borrowers where id=b);
    select min(due_date) into current_cycle from public.payment_schedule_dates(current_date,current_date+31);
    earlier:=(date_trunc('month',current_date)-interval '3 months'+interval '14 days')::date;
    later:=(date_trunc('month',current_date)-interval '2 months'+interval '14 days')::date;
    remaining:=(date_trunc('month',current_date)-interval '1 months'+interval '14 days')::date;
    l1:=public.create_funded_disbursement(b,earlier-14,1000,.10,.03,'one contributor',
      jsonb_build_array(jsonb_build_object('partner_user_id',admin_id,'amount',1000)));
    l2:=public.create_funded_disbursement(b,date_trunc('month',current_date)::date,500,.10,.03,'different contributor',
      jsonb_build_array(jsonb_build_object('partner_user_id',partner_id,'amount',500)));
    assert (select funding_percent=1 and contributed_amount=1000 from public.loan_funding where loan_id=l1);
    rejected:=false;
    begin
      perform public.create_funded_disbursement(b,current_date,1000,.1,.03,null,
        jsonb_build_array(jsonb_build_object('partner_user_id',admin_id,'amount',999.99)));
    exception when raise_exception then rejected:=true;
    end;
    assert rejected and (select count(*) from public.loans where borrower_id=b)=2,'Invalid contributions must roll back the entire loan';

    p_current:=public.record_borrower_payment(b,current_date,75,'INSTALLMENT','current only',null,null,array[current_cycle],null);
    assert (select sum(applied_total)=75 and count(*)=1 from public.payment_borrower_due_applications where payment_id=p_current);
    assert (select amount_due=50 from public.borrower_due_timeline(b,current_cycle) where due_date=earlier),'Current-cycle payment must leave older dues untouched';
    assert (select sum(amount)=17.50 from public.payment_allocations where payment_id=p_current and partner_user_id=partner_id),
      'Both loans generated the current fee, so both funders receive the appropriate share';
    p_older:=public.record_borrower_payment(b,current_date,75,'INSTALLMENT','two selected dates',null,null,array[later,earlier],null);
    assert (select count(*)=2 from public.payment_borrower_due_applications where payment_id=p_older);
    assert not exists(select 1 from public.payment_allocations where payment_id=p_older and partner_user_id=partner_id),
      'A later loan must not receive a distribution from earlier installments';
    assert (select amount_due=25 from public.borrower_due_timeline(b,current_cycle) where due_date=later);
    rejected:=false;
    begin
      perform public.record_borrower_payment(b,current_date,26,'INSTALLMENT',null,null,null,array[later],null);
    exception when raise_exception then rejected:=true;
    end;
    assert rejected and (select amount_due=25 from public.borrower_due_timeline(b,current_cycle) where due_date=later),
      'An overpayment must not change even a selected installment';
    rejected:=false;
    begin
      perform public.record_borrower_payment(b,current_date,1,'INSTALLMENT',null,null,null,array[earlier],null);
    exception when raise_exception then rejected:=true;
    end;
    assert rejected,'A settled installment must be rejected';

    p_custom:=public.record_borrower_payment(b,current_date,25,'INSTALLMENT',null,null,null,array[later],
      jsonb_build_array(jsonb_build_object('partner_user_id',partner_id,'weight',100)));
    assert (select sum(amount)=25 from public.payment_allocations where payment_id=p_custom),'Admin and investor amounts must reconcile';
    assert exists(select 1 from public.payment_allocations where payment_id=p_custom and partner_user_id=partner_id and allocation_type='PARTNER_DISTRIBUTION');

    perform public.update_loan_contributions(l1,jsonb_build_array(
      jsonb_build_object('partner_user_id',admin_id,'amount',333.33),jsonb_build_object('partner_user_id',partner_id,'amount',666.67)));
    assert (select sum(contributed_amount)=1000 and sum(funding_percent)=1 from public.loan_funding where loan_id=l1);
    perform public.update_loan_contributions(l1,jsonb_build_array(jsonb_build_object('partner_user_id',partner_id,'amount',1000)));
    assert (select count(*)=1 from public.loan_funding where loan_id=l1),'A takeover removes the prior contributor';
    assert not exists(select 1 from public.payment_allocations where payment_id=p_older and partner_user_id=partner_id),
      'Changing the current funding must leave saved receipts intact';
    p_mixed:=public.record_borrower_payment(b,current_date,150,'MIXED',null,50,100,array[remaining],null);
    assert (select applied_interest=50 and applied_principal=100 from public.payments where id=p_mixed);
    assert (select amount=35 from public.payment_allocations where payment_id=p_mixed and allocation_type='PARTNER_DISTRIBUTION' and partner_user_id=partner_id);
    perform public.void_payment(p_mixed,'Rollback verification');
    assert (select sum(principal_outstanding)=1500 from public.loans where borrower_id=b);
    assert (select amount_due=50 from public.borrower_due_timeline(b,current_cycle) where due_date=remaining);

    insert into public.borrower_contact_log(borrower_id,contact_date,contact_type,notes,execution_date,installment_dates,created_by)
      values(b,current_date,'NOTE','demo note',current_date+2,array[later,earlier,earlier],admin_id);
    insert into public.borrower_followups(borrower_id,due_date,reason,execution_date,installment_dates,created_by)
      values(b,current_date+1,'demo follow-up',current_date+2,array[earlier,later],admin_id);
    assert (select installment_dates=array[earlier,later] and execution_date=current_date+2 from public.borrower_contact_log_view where borrower_id=b);
    assert (select installment_dates=array[earlier,later] and execution_date=current_date+2 from public.borrower_followups_view where borrower_id=b);
    rejected:=false;
    begin
      insert into public.borrower_contact_log(borrower_id,contact_date,contact_type,notes,installment_dates,created_by)
        values(b,current_date,'NOTE','invalid date',array[earlier-1],admin_id);
    exception when raise_exception then rejected:=true;
    end;
    assert rejected,'Only real installments on this account can be linked';
    if agent_id is not null then
      perform set_config('request.jwt.claim.sub',agent_id::text,true);
      rejected:=false;
      begin
        perform public.update_loan_contributions(l1,jsonb_build_array(jsonb_build_object('partner_user_id',agent_id,'amount',1000)));
      exception when raise_exception then rejected:=true;
      end;
      assert rejected,'Existing admin-only funding permissions must be retained';
      p_mixed:=public.record_borrower_payment(b,current_date,1,'INSTALLMENT',null,null,null,array[remaining],null);
      assert (select amount=1 from public.payments where id=p_mixed),'Agents retain payment entry';
    end if;
    perform set_config('request.jwt.claim.sub',partner_id::text,true);
    rejected:=false;
    begin
      perform public.record_borrower_payment(b,current_date,1,'INSTALLMENT',null,null,null,array[remaining],null);
    exception when raise_exception then rejected:=true;
    end;
    assert rejected,'Read-only partners must not record payments';
    assert not has_table_privilege('anon','public.borrower_followups_view','SELECT')
       and not has_table_privilege('anon','public.activity_log_view','SELECT');
    assert not has_function_privilege('anon','public.record_borrower_payment(uuid,date,numeric,text,text,numeric,numeric,date[],jsonb)','EXECUTE');
    execute 'reset role';
    passed:=true;
    raise sqlstate 'ZX003' using message='Rollback workflow verification fixtures';
  exception when sqlstate 'ZX003' then null;
  end;
  assert passed and not exists(select 1 from public.borrowers where id=b);
end;
$verify$;
