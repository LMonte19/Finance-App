-- Harden the current operating model without changing financial records.
create or replace function public.app_role() returns text language sql stable security definer set search_path=''
as $$ select p.role from public.profiles p where p.user_id=auth.uid() $$;
revoke all on function public.app_role() from public,anon;
grant execute on function public.app_role() to authenticated;

-- Financial writes only go through validated transactional workflows.
alter function public.record_borrower_payment(uuid,date,numeric,text,text,numeric,numeric,date[],jsonb) security definer;
alter function public.apply_borrower_mixed_payment(uuid,date,numeric,numeric,numeric,text) security definer;
alter function public.create_funded_disbursement(uuid,date,numeric,numeric,numeric,text,jsonb) security definer;
alter function public.generate_missing_borrower_due_events(uuid,date,date,boolean) security definer;
alter function public.regenerate_future_borrower_due_events(uuid,integer) security definer;

revoke all on public.activity_log from authenticated;
grant select on public.activity_log to authenticated;
alter table public.activity_log enable row level security;
drop policy if exists "activity_log_select_authenticated" on public.activity_log;
create policy team_read on public.activity_log for select to authenticated using ((select public.app_role()) in ('ADMIN','AGENT','PARTNER'));

revoke all on public.app_settings from authenticated;
grant select on public.app_settings to authenticated;
alter table public.app_settings enable row level security;
drop policy if exists "app_settings_insert_admin" on public.app_settings;
drop policy if exists "app_settings_read_authenticated" on public.app_settings;
drop policy if exists "app_settings_update_admin" on public.app_settings;
create policy team_read on public.app_settings for select to authenticated using ((select public.app_role()) in ('ADMIN','AGENT','PARTNER'));

revoke all on public.borrower_contact_log from authenticated;
grant select on public.borrower_contact_log to authenticated;
alter table public.borrower_contact_log enable row level security;
drop policy if exists "borrower_contact_log_insert_admin_agent" on public.borrower_contact_log;
drop policy if exists "borrower_contact_log_select_authenticated" on public.borrower_contact_log;
drop policy if exists "borrower_contact_log_update_admin_agent" on public.borrower_contact_log;
create policy team_read on public.borrower_contact_log for select to authenticated using ((select public.app_role()) in ('ADMIN','AGENT','PARTNER'));
grant insert,update on public.borrower_contact_log to authenticated;
create policy team_insert on public.borrower_contact_log for insert to authenticated with check ((select public.app_role()) in ('ADMIN','AGENT','PARTNER') and created_by=(select auth.uid()));
create policy team_update on public.borrower_contact_log for update to authenticated using ((select public.app_role()) in ('ADMIN','AGENT','PARTNER')) with check ((select public.app_role()) in ('ADMIN','AGENT','PARTNER'));

revoke all on public.borrower_due_events from authenticated;
grant select on public.borrower_due_events to authenticated;
alter table public.borrower_due_events enable row level security;
drop policy if exists "borrower_due_events_write_admin_agent" on public.borrower_due_events;
drop policy if exists "borrower_due_events_select_authenticated" on public.borrower_due_events;
create policy team_read on public.borrower_due_events for select to authenticated using ((select public.app_role()) in ('ADMIN','AGENT','PARTNER'));

revoke all on public.borrower_followups from authenticated;
grant select on public.borrower_followups to authenticated;
alter table public.borrower_followups enable row level security;
drop policy if exists "borrower_followups_insert_admin_agent" on public.borrower_followups;
drop policy if exists "borrower_followups_select_authenticated" on public.borrower_followups;
drop policy if exists "borrower_followups_update_admin_agent" on public.borrower_followups;
create policy team_read on public.borrower_followups for select to authenticated using ((select public.app_role()) in ('ADMIN','AGENT','PARTNER'));
grant insert,update on public.borrower_followups to authenticated;
create policy team_insert on public.borrower_followups for insert to authenticated with check ((select public.app_role()) in ('ADMIN','AGENT','PARTNER') and created_by=(select auth.uid()));
create policy team_update on public.borrower_followups for update to authenticated using ((select public.app_role()) in ('ADMIN','AGENT','PARTNER')) with check ((select public.app_role()) in ('ADMIN','AGENT','PARTNER'));

revoke all on public.borrowers from authenticated;
grant select on public.borrowers to authenticated;
alter table public.borrowers enable row level security;
drop policy if exists "borrowers_insert_admin_agent" on public.borrowers;
drop policy if exists "borrowers_read_all_roles" on public.borrowers;
drop policy if exists "borrowers_update_admin_agent" on public.borrowers;
create policy team_read on public.borrowers for select to authenticated using ((select public.app_role()) in ('ADMIN','AGENT','PARTNER'));
grant insert,update on public.borrowers to authenticated;
create policy team_insert on public.borrowers for insert to authenticated with check ((select public.app_role()) in ('ADMIN','AGENT','PARTNER') and created_by=(select auth.uid()));
create policy team_update on public.borrowers for update to authenticated using ((select public.app_role()) in ('ADMIN','AGENT','PARTNER')) with check ((select public.app_role()) in ('ADMIN','AGENT','PARTNER'));

revoke all on public.default_funding_splits from authenticated;
grant select on public.default_funding_splits to authenticated;
alter table public.default_funding_splits enable row level security;
drop policy if exists "default_funding_delete_admin" on public.default_funding_splits;
drop policy if exists "default_funding_insert_admin" on public.default_funding_splits;
drop policy if exists "default_funding_read_authenticated" on public.default_funding_splits;
drop policy if exists "default_funding_update_admin" on public.default_funding_splits;
create policy team_read on public.default_funding_splits for select to authenticated using ((select public.app_role()) in ('ADMIN','AGENT','PARTNER'));

revoke all on public.loan_due_events from authenticated;
grant select on public.loan_due_events to authenticated;
alter table public.loan_due_events enable row level security;
drop policy if exists "due_insert_admin_agent" on public.loan_due_events;
drop policy if exists "due_read_all_roles" on public.loan_due_events;
drop policy if exists "due_update_admin_agent" on public.loan_due_events;
create policy team_read on public.loan_due_events for select to authenticated using ((select public.app_role()) in ('ADMIN','AGENT','PARTNER'));

revoke all on public.loan_funding from authenticated;
grant select on public.loan_funding to authenticated;
alter table public.loan_funding enable row level security;
drop policy if exists "funding_insert_admin_only" on public.loan_funding;
drop policy if exists "funding_read_all_roles" on public.loan_funding;
drop policy if exists "funding_update_admin_only" on public.loan_funding;
create policy team_read on public.loan_funding for select to authenticated using ((select public.app_role()) in ('ADMIN','AGENT','PARTNER'));

revoke all on public.loan_payments from authenticated;
grant select on public.loan_payments to authenticated;
alter table public.loan_payments enable row level security;
drop policy if exists "payments_insert_admin_agent" on public.loan_payments;
drop policy if exists "payments_read_all_roles" on public.loan_payments;
create policy team_read on public.loan_payments for select to authenticated using ((select public.app_role()) in ('ADMIN','AGENT','PARTNER'));

revoke all on public.loans from authenticated;
grant select on public.loans to authenticated;
alter table public.loans enable row level security;
drop policy if exists "loans_insert_admin_agent" on public.loans;
drop policy if exists "loans_read_all_roles" on public.loans;
drop policy if exists "loans_update_admin_agent" on public.loans;
create policy team_read on public.loans for select to authenticated using ((select public.app_role()) in ('ADMIN','AGENT','PARTNER'));

revoke all on public.operational_administrators from authenticated;
grant select on public.operational_administrators to authenticated;
alter table public.operational_administrators enable row level security;
drop policy if exists "operating_team_reads_administrators" on public.operational_administrators;
create policy team_read on public.operational_administrators for select to authenticated using ((select public.app_role()) in ('ADMIN','AGENT','PARTNER'));

revoke all on public.payment_allocations from authenticated;
grant select on public.payment_allocations to authenticated;
alter table public.payment_allocations enable row level security;
drop policy if exists "alloc_insert_admin_agent" on public.payment_allocations;
drop policy if exists "alloc_read_all_roles" on public.payment_allocations;
create policy team_read on public.payment_allocations for select to authenticated using ((select public.app_role()) in ('ADMIN','AGENT','PARTNER'));

revoke all on public.payment_borrower_due_applications from authenticated;
grant select on public.payment_borrower_due_applications to authenticated;
alter table public.payment_borrower_due_applications enable row level security;
drop policy if exists "payment_borrower_due_app_write_admin_agent" on public.payment_borrower_due_applications;
drop policy if exists "payment_borrower_due_app_select_authenticated" on public.payment_borrower_due_applications;
create policy team_read on public.payment_borrower_due_applications for select to authenticated using ((select public.app_role()) in ('ADMIN','AGENT','PARTNER'));

revoke all on public.payment_due_applications from authenticated;
grant select on public.payment_due_applications to authenticated;
alter table public.payment_due_applications enable row level security;
drop policy if exists "payment_due_applications_insert_admin_agent" on public.payment_due_applications;
drop policy if exists "payment_due_applications_read_all_roles" on public.payment_due_applications;
create policy team_read on public.payment_due_applications for select to authenticated using ((select public.app_role()) in ('ADMIN','AGENT','PARTNER'));

revoke all on public.payment_principal_applications from authenticated;
grant select on public.payment_principal_applications to authenticated;
alter table public.payment_principal_applications enable row level security;
drop policy if exists "payment_principal_app_write_admin_agent" on public.payment_principal_applications;
drop policy if exists "payment_principal_app_select_authenticated" on public.payment_principal_applications;
create policy team_read on public.payment_principal_applications for select to authenticated using ((select public.app_role()) in ('ADMIN','AGENT','PARTNER'));

revoke all on public.payments from authenticated;
grant select on public.payments to authenticated;
alter table public.payments enable row level security;
drop policy if exists payments_team_read on public.payments;
drop policy if exists payments_team_insert on public.payments;
create policy team_read on public.payments for select to authenticated using ((select public.app_role()) in ('ADMIN','AGENT','PARTNER'));

revoke all on public.profiles from authenticated;
grant select on public.profiles to authenticated;
alter table public.profiles enable row level security;
drop policy if exists "debug_read_profiles_authenticated" on public.profiles;
drop policy if exists "read_own_profile" on public.profiles;
drop policy if exists "admin_read_profiles" on public.profiles;
drop policy if exists "admin_update_profiles" on public.profiles;
create policy team_read on public.profiles for select to authenticated using (user_id=(select auth.uid()) or (select public.app_role()) in ('ADMIN','AGENT','PARTNER'));

alter view public.activity_log_view set (security_invoker=true);
revoke insert,update,delete,truncate,references,trigger on public.activity_log_view from authenticated;

alter view public.borrower_account_health_issues set (security_invoker=true);
revoke insert,update,delete,truncate,references,trigger on public.borrower_account_health_issues from authenticated;

alter view public.borrower_account_payments_view set (security_invoker=true);
revoke insert,update,delete,truncate,references,trigger on public.borrower_account_payments_view from authenticated;

alter view public.borrower_account_summary set (security_invoker=true);
revoke insert,update,delete,truncate,references,trigger on public.borrower_account_summary from authenticated;

alter view public.borrower_contact_log_view set (security_invoker=true);
revoke insert,update,delete,truncate,references,trigger on public.borrower_contact_log_view from authenticated;

alter view public.borrower_disbursements_view set (security_invoker=true);
revoke insert,update,delete,truncate,references,trigger on public.borrower_disbursements_view from authenticated;

alter view public.borrower_due_events_view set (security_invoker=true);
revoke insert,update,delete,truncate,references,trigger on public.borrower_due_events_view from authenticated;

alter view public.borrower_followups_view set (security_invoker=true);
revoke insert,update,delete,truncate,references,trigger on public.borrower_followups_view from authenticated;

alter view public.borrower_loan_summary set (security_invoker=true);
revoke insert,update,delete,truncate,references,trigger on public.borrower_loan_summary from authenticated;

alter view public.borrower_risk_summary set (security_invoker=true);
revoke insert,update,delete,truncate,references,trigger on public.borrower_risk_summary from authenticated;

alter view public.export_borrowers set (security_invoker=true);
revoke insert,update,delete,truncate,references,trigger on public.export_borrowers from authenticated;

alter view public.export_loans set (security_invoker=true);
revoke insert,update,delete,truncate,references,trigger on public.export_loans from authenticated;

alter view public.export_payments set (security_invoker=true);
revoke insert,update,delete,truncate,references,trigger on public.export_payments from authenticated;

alter view public.loan_health_issues set (security_invoker=true);
revoke insert,update,delete,truncate,references,trigger on public.loan_health_issues from authenticated;

alter view public.loan_next_due set (security_invoker=true);
revoke insert,update,delete,truncate,references,trigger on public.loan_next_due from authenticated;

alter view public.partner_allocation_details set (security_invoker=true);
revoke insert,update,delete,truncate,references,trigger on public.partner_allocation_details from authenticated;

alter view public.partner_earnings_summary set (security_invoker=true);
revoke insert,update,delete,truncate,references,trigger on public.partner_earnings_summary from authenticated;

alter view public.partner_funded_loans set (security_invoker=true);
revoke insert,update,delete,truncate,references,trigger on public.partner_funded_loans from authenticated;

alter view public.payment_detail_view set (security_invoker=true);
revoke insert,update,delete,truncate,references,trigger on public.payment_detail_view from authenticated;

alter view public.payment_summary set (security_invoker=true);
revoke insert,update,delete,truncate,references,trigger on public.payment_summary from authenticated;

alter view public.role_permission_matrix set (security_invoker=true);
revoke insert,update,delete,truncate,references,trigger on public.role_permission_matrix from authenticated;

alter view public.system_check_results set (security_invoker=true);
revoke insert,update,delete,truncate,references,trigger on public.system_check_results from authenticated;

revoke truncate,references,trigger on all tables in schema public from authenticated;
revoke all on all sequences in schema public from authenticated;
alter function public.set_app_setting(text,jsonb) set search_path = public, pg_temp;
alter function public.apply_payment(uuid,date,numeric,text) set search_path = public, pg_temp;
alter function public.set_loan_status(uuid,text) set search_path = public, pg_temp;
alter function public.update_payment_notes(uuid,text) set search_path = public, pg_temp;
alter function public.generate_loan_due_events(uuid,integer) set search_path = public, pg_temp;
alter function public.update_loan_details(uuid,date,numeric,numeric,numeric,numeric,text) set search_path = public, pg_temp;
alter function public.update_loan_details_v2(uuid,date,numeric,numeric,numeric,numeric,text,text) set search_path = public, pg_temp;
alter function public.close_loan(uuid,text) set search_path = public, pg_temp;
alter function public.mark_loan_paid_off(uuid) set search_path = public, pg_temp;
alter function public.complete_followup(uuid,text) set search_path = public, pg_temp;
alter function public.reset_test_data() set search_path = public, pg_temp;
alter function public.void_loan(uuid,text) set search_path = public, pg_temp;
alter function public.regenerate_future_due_events(uuid,integer) set search_path = public, pg_temp;
alter function public.attach_activity_trigger(text) set search_path = public, pg_temp;
alter function public.audit_activity_trigger() set search_path = public, pg_temp;
alter function public.generate_missing_due_events_for_loan(uuid,date,date,boolean) set search_path = public, pg_temp;
alter function public.generate_missing_due_events_for_payment(uuid,date) set search_path = public, pg_temp;
alter function public.generate_missing_due_events_all(integer) set search_path = public, pg_temp;
alter function public.account_anchor_loan(uuid) set search_path = public, pg_temp;
alter function public.void_payment(uuid,text) set search_path = public, pg_temp;
alter function public.apply_borrower_payment(uuid,date,numeric,text,text) set search_path = public, pg_temp;
alter function public.reduce_borrower_principal(uuid,numeric) set search_path = public, pg_temp;
alter function public.regenerate_future_borrower_due_events_all(integer) set search_path = public, pg_temp;
alter function public.regenerate_future_borrower_due_events(uuid,integer) set search_path = public, pg_temp;
alter function public.payment_schedule_dates(date,date) set search_path = public, pg_temp;
alter function public.borrower_due_timeline(uuid,date) set search_path = public, pg_temp;
alter function public.get_borrower_due_calendar(uuid,date,date) set search_path = public, pg_temp;
alter function public.get_borrower_calendar_workspace(uuid,date) set search_path = public, pg_temp;
alter function public.get_borrower_mixed_payment_context(uuid,date) set search_path = public, pg_temp;
alter function public.apply_borrower_mixed_payment(uuid,date,numeric,numeric,numeric,text) set search_path = public, pg_temp;
alter function finance_workflow_private.validate_installment_links() set search_path = public, pg_temp;
alter function public.update_loan_contributions(uuid,jsonb) set search_path = public, pg_temp;
alter function public.create_funded_disbursement(uuid,date,numeric,numeric,numeric,text,jsonb) set search_path = public, pg_temp;
alter function public.get_borrower_payment_partners(uuid) set search_path = public, pg_temp;
alter function finance_workflow_private.restore_voided_payment_dues(uuid,date,date,boolean) set search_path = public, pg_temp;
alter function public.generate_missing_borrower_due_events(uuid,date,date,boolean) set search_path = public, pg_temp;
alter function public.record_borrower_payment(uuid,date,numeric,text,text,numeric,numeric,date[],jsonb) set search_path = public, pg_temp;

alter default privileges for role postgres in schema public revoke all on tables from anon,authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon,authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.reset_test_data()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.is_finance_owner() then
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
$function$


