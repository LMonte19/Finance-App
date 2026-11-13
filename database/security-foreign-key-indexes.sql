-- Index existing foreign keys; no financial values are changed.
create index if not exists app_settings_updated_by_idx on public.app_settings (updated_by);
create index if not exists borrower_contact_log_created_by_idx on public.borrower_contact_log (created_by);
create index if not exists borrower_followups_completed_by_idx on public.borrower_followups (completed_by);
create index if not exists borrower_followups_created_by_idx on public.borrower_followups (created_by);
create index if not exists borrowers_created_by_idx on public.borrowers (created_by);
create index if not exists default_funding_splits_updated_by_idx on public.default_funding_splits (updated_by);
create index if not exists loan_funding_partner_user_id_idx on public.loan_funding (partner_user_id);
create index if not exists loan_payments_loan_id_idx on public.loan_payments (loan_id);
create index if not exists loan_payments_received_by_idx on public.loan_payments (received_by);
create index if not exists loans_borrower_id_idx on public.loans (borrower_id);
create index if not exists loans_closed_by_idx on public.loans (closed_by);
create index if not exists loans_created_by_idx on public.loans (created_by);
create index if not exists payment_allocations_operational_administrator_id_idx on public.payment_allocations (operational_administrator_id);
create index if not exists payments_created_by_idx on public.payments (created_by);
create index if not exists payments_voided_by_idx on public.payments (voided_by);

