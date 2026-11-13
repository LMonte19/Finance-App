-- Verify real API roles in a transaction. Every fixture is rolled back.
begin;
do $verify$
declare r record; n bigint; uid uuid; b uuid; l uuid; p uuid; rejected boolean;
begin
  select user_id into uid from public.profiles where role='PARTNER' limit 1;
  assert uid is not null;
  -- Simulate an operational administrator without creating a sign-in account.
  update public.profiles set role='AGENT' where user_id=uid;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  execute 'set local role authenticated';
  assert public.app_role()='AGENT';
  for r in select c.relname from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
    where ns.nspname='public' and c.relkind in ('r','v') and has_table_privilege('authenticated',c.oid,'SELECT')
  loop
    execute format('select count(*) from public.%I',r.relname) into n;
  end loop;
  insert into public.borrowers(full_name,created_by) values('SECURITY TEST - ROLLBACK',uid) returning id into b;
  l:=public.create_funded_disbursement(b,current_date-30,1000,.10,.03,'ROLLBACK',
    jsonb_build_array(jsonb_build_object('partner_user_id','984c2e7c-2506-4c7a-8510-15d1a14815b0','amount',1000)));
  p:=public.record_borrower_payment(b,current_date,50,'INSTALLMENT','ROLLBACK',null,null,null,null);
  assert (select principal_outstanding=1000 from public.loans where id=l),'Interest must not reduce principal';
  perform public.update_payment_notes(p,'Verification');
  perform public.void_payment(p,'Pago duplicado');
  assert (select is_voided from public.payments where id=p);
  assert not has_table_privilege('authenticated','public.payments','UPDATE');
  assert not has_table_privilege('authenticated','public.payments','DELETE');
  assert not has_table_privilege('authenticated','public.payments','INSERT');
  assert not has_table_privilege('authenticated','public.borrowers','TRUNCATE');
  rejected:=false;
  begin perform public.get_owner_review(); exception when insufficient_privilege then rejected:=true; end;
  assert rejected;
  rejected:=false;
  begin perform public.reset_test_data(); exception when raise_exception then rejected:=true; end;
  assert rejected;
  -- An authenticated Google account without an approved profile sees no business data.
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  assert public.app_role() is null;
  for r in select c.relname from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
    where ns.nspname='public' and c.relkind in ('r','v') and has_table_privilege('authenticated',c.oid,'SELECT')
  loop
    execute format('select count(*) from public.%I',r.relname) into n;
    if r.relname='payment_summary' then
      assert (select payment_count=0 and total_collected=0 from public.payment_summary);
    else assert n=0,format('Unapproved user can read %s',r.relname); end if;
  end loop;
  rejected:=false;
  begin perform public.record_borrower_payment(b,current_date,50,'INSTALLMENT',null,null,null,null,null);
  exception when raise_exception then rejected:=true; end;
  assert rejected;
  rejected:=false;
  begin insert into public.borrowers(full_name,created_by) values('UNAUTHORIZED',auth.uid());
  exception when insufficient_privilege then rejected:=true; end;
  assert rejected;
  execute 'reset role';
  -- Anonymous has no exposed data or private finance helper access.
  assert not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','v') and
      (has_table_privilege('anon',c.oid,'SELECT') or has_table_privilege('anon',c.oid,'INSERT')
       or has_table_privilege('anon',c.oid,'UPDATE') or has_table_privilege('anon',c.oid,'DELETE')));
  assert not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','finance_workflow_private') and has_function_privilege('anon',p.oid,'EXECUTE'));
  perform set_config('request.jwt.claim.sub','984c2e7c-2506-4c7a-8510-15d1a14815b0',true);
  execute 'set local role authenticated';
  assert public.is_finance_owner();
  perform public.get_owner_review();
end;
$verify$;
rollback;

