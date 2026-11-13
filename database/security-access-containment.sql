-- Immediate containment: keep current authorized workflows available.
revoke all on all tables in schema public from public, anon;
revoke all on all sequences in schema public from public, anon;
revoke execute on all functions in schema public from public, anon;
revoke create on schema public from public, anon, authenticated;
alter table public.payments enable row level security;
create policy payments_team_read on public.payments for select to authenticated
 using ((select public.app_role()) in ('ADMIN','AGENT','PARTNER'));
create policy payments_team_insert on public.payments for insert to authenticated
 with check ((select public.app_role()) in ('ADMIN','AGENT','PARTNER') and created_by=(select auth.uid()));
revoke update,delete,truncate,references,trigger on public.payments from authenticated;
grant select,insert on public.payments to authenticated;
alter function public.sync_loan_paid_off_status() set search_path = '';
revoke execute on function public.attach_activity_trigger(text), public.audit_activity_trigger(),
 public.reduce_borrower_principal(uuid,numeric),public.account_anchor_loan(uuid),
 public.generate_missing_due_events_for_loan(uuid,date,date,boolean),
 public.generate_missing_due_events_for_payment(uuid,date) from authenticated;

