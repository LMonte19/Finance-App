-- This application already pins access management to the owner's auth identity.
create or replace function public.is_finance_owner()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(auth.uid() = '984c2e7c-2506-4c7a-8510-15d1a14815b0'::uuid
    and public.app_role() = 'ADMIN', false)
$$;
revoke all on function public.is_finance_owner() from public, anon;
grant execute on function public.is_finance_owner() to authenticated;

create or replace function public.update_profile_admin(p_user_id uuid,p_full_name text,p_role text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_finance_owner() then
    raise exception 'Solo la propietaria puede editar roles.' using errcode='42501';
  end if;
  if p_role is null or p_role not in ('ADMIN','AGENT','PARTNER')
     or (p_role='ADMIN') is distinct from (p_user_id=auth.uid()) then
    raise exception 'El rol de propietaria está reservado para su cuenta.';
  end if;
  if coalesce(length(trim(p_full_name)),0) not between 1 and 120 then
    raise exception 'Escribe un nombre válido.';
  end if;
  update public.profiles set full_name=trim(p_full_name),role=p_role where user_id=p_user_id;
  if not found then raise exception 'No se encontró este perfil.'; end if;
end;
$$;
revoke all on function public.update_profile_admin(uuid,text,text) from public,anon;
grant execute on function public.update_profile_admin(uuid,text,text) to authenticated;
revoke update on public.profiles from public,anon,authenticated;

revoke all on public.system_check_results,public.role_permission_matrix,public.loan_health_issues,
  public.borrower_account_health_issues from public,anon,authenticated;
create or replace function public.get_owner_review()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_issues jsonb;
begin
  if not public.is_finance_owner() then
    raise exception 'Revisión reservada para la propietaria.' using errcode='42501';
  end if;
  with funds as (
    select l.id,l.borrower_id,count(f.id) as parts,
      coalesce(sum(coalesce(f.contributed_amount/nullif(l.principal_original,0),f.funding_percent)),0) as share
    from public.loans l left join public.loan_funding f on f.loan_id=l.id
    where l.status='ACTIVE' and l.principal_outstanding>0 group by l.id
  ), allocations as (
    select payment_id,sum(amount) as total,count(*) as entries from public.payment_allocations group by payment_id
  ), issues as (
    select f.borrower_id,f.id as loan_id,null::uuid as payment_id,
      'FUNDING_VALIDITY' as check_code,'HIGH' as severity,'Revisar aportes del desembolso' as title,
      case when f.parts=0 then 'Este desembolso no tiene aportes.' else concat('Los aportes suman ',round(f.share*100,2),'%. Deben sumar 100%.') end as details,'funding' as action
    from funds f where abs(f.share-1)>.001
    union all
    select l.borrower_id,l.id,null,'ACCOUNT_HEALTH','MEDIUM','Tasa del desembolso inválida',
      concat('Interés mensual: ',l.monthly_rate_total*100,'%. Administración: ',l.monthly_rate_mgmt*100,'%.'),'loan'
    from public.loans l where l.status='ACTIVE' and l.principal_outstanding>0
      and (l.monthly_rate_total<=0 or l.monthly_rate_mgmt<0 or l.monthly_rate_mgmt>l.monthly_rate_total)
    union all
    select s.borrower_id,null,null,'ACCOUNT_HEALTH','LOW','Cuotas atrasadas',
      concat(s.overdue_count,' cuotas · ',round(s.overdue_amount,2),' pendientes.'),'account'
    from public.borrower_account_summary s where s.overdue_amount>0
    union all
    select p.borrower_id,null,p.id,'ACCOUNT_HEALTH','MEDIUM','Pago sin tipo',
      concat('Pago del ',p.paid_on,' por ',p.amount,'. Verifica el comprobante.'),'payment'
    from public.payments p where not coalesce(p.is_voided,false) and coalesce(p.payment_type,'')=''
    union all
    select p.borrower_id,null,p.id,'PAYMENT_REVERSAL_SAFETY','HIGH','Abono a capital sin rastreo',
      concat('Pago del ',p.paid_on,' por ',p.amount,'. Comprueba las aplicaciones antes de anularlo.'),'payment'
    from public.payments p where not coalesce(p.is_voided,false) and p.applied_principal>0
      and not exists(select 1 from public.payment_principal_applications a where a.payment_id=p.id)
    union all
    select p.borrower_id,null,p.id,'VOID_AND_ALLOCATION_SAFETY','MEDIUM','Distribución no coincide con el pago',
      concat('Pago del ',p.paid_on,'. Esperado: ',round(coalesce(p.applied_mgmt,0)+coalesce(p.applied_funders,0),2),
        '. Distribuido: ',round(coalesce(a.total,0),2),'. Comprueba el desglose antes de corregir el pago.'),'payment'
    from public.payments p left join allocations a on a.payment_id=p.id
    where not coalesce(p.is_voided,false)
      and abs(coalesce(a.total,0)-coalesce(p.applied_mgmt,0)-coalesce(p.applied_funders,0))>.05
    union all
    select p.borrower_id,null,p.id,'VOID_AND_ALLOCATION_SAFETY','HIGH','Pago anulado con distribuciones',
      concat('Pago del ',p.paid_on,' con ',a.entries,' distribuciones registradas. Revisa el historial de anulación.'),'payment'
    from public.payments p join allocations a on a.payment_id=p.id where p.is_voided
  )
  select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('borrower_name',b.full_name)
    order by i.severity,b.full_name,i.title),'[]') into v_issues from issues i left join public.borrowers b on b.id=i.borrower_id;
  return jsonb_build_object(
    'checks',(select jsonb_agg(to_jsonb(c)||case when c.check_code in
      ('ACCOUNT_HEALTH','FUNDING_VALIDITY','VOID_AND_ALLOCATION_SAFETY','PAYMENT_REVERSAL_SAFETY') then
      jsonb_build_object('status',case when x.high>0 then 'FAIL' when x.medium>0 then 'WARN' else 'PASS' end,
        'details',case when x.total=0 then 'Sin incidencias detectadas.' else concat(x.total,' incidencias · ',x.high,' altas · ',x.medium,' medias.') end)
      else '{}'::jsonb end order by c.sort_order)
      from public.system_check_results c cross join lateral (
        select count(*) as total,count(*) filter(where i->>'severity'='HIGH') as high,
          count(*) filter(where i->>'severity'='MEDIUM') as medium
        from jsonb_array_elements(v_issues) i where i->>'check_code'=c.check_code
      ) x),
    'permissions',(select jsonb_agg(to_jsonb(m)||jsonb_build_object('owner_only',m.capability in
      ('Restablecer datos','Editar roles','Métodos de acceso','Administrar acceso')) order by m.role,m.capability) from public.role_permission_matrix m),
    'profiles',(select coalesce(jsonb_agg(jsonb_build_object('user_id',p.user_id,'full_name',p.full_name,'role',p.role) order by p.full_name),'[]') from public.profiles p),
    'issues',v_issues);
end;
$$;
revoke all on function public.get_owner_review() from public,anon;
grant execute on function public.get_owner_review() to authenticated;

create or replace function public.get_portfolio_open_installments()
returns table(borrower_id uuid, borrower_name text,due_date date,amount_due numeric,expected_total numeric,
  paid_total numeric,timing_status text,as_of_date date)
language sql stable security invoker set search_path = ''
as $$
  select t.borrower_id,t.borrower_name,t.due_date,t.amount_due,t.expected_total,t.paid_total,t.timing_status,current_date
  from public.borrowers b
  cross join lateral public.borrower_due_timeline(b.id,current_date+60) t
  where public.app_role() in ('ADMIN','AGENT','PARTNER') and t.amount_due>0 and t.status<>'CANCELLED'
  order by t.due_date,t.borrower_id
$$;
revoke all on function public.get_portfolio_open_installments() from public,anon;
grant execute on function public.get_portfolio_open_installments() to authenticated;

-- Correct recipients only. Payment dates, amounts, applications and investor shares stay intact.
do $$
declare v_manager public.operational_administrators%rowtype;
begin
  select * into strict v_manager from public.operational_administrators where receives_management_fee;
  if lower(trim(v_manager.full_name)) <> 'carlos' then
    raise exception 'El administrador activo no es Carlos; se canceló la corrección.';
  end if;
  update public.payment_allocations
  set operational_administrator_id=v_manager.id,partner_user_id=v_manager.user_id
  where allocation_type='MANAGEMENT_FEE'
    and (operational_administrator_id,partner_user_id) is distinct from (v_manager.id,v_manager.user_id);
end;
$$;
