-- All supported payment forms use record_borrower_payment, which validates amounts, dates and allocations.
-- Keep legacy engines callable internally, not as alternate client write APIs.
revoke execute on function public.apply_payment(uuid,date,numeric,text),
  public.apply_borrower_payment(uuid,date,numeric,text,text),
  public.apply_borrower_mixed_payment(uuid,date,numeric,numeric,numeric,text)
from authenticated;

