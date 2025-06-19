-- Ensure there is AT MOST one ACTIVE/TRIALING subscription per user.
-- You can drop it and recreate with different statuses at any time.

-- 0)  CLEAN existing duplicates  (index creation will FAIL if any remain)
--     Keep the most-recent row, cancel the rest.
with dups as (
  select id,
         row_number() over (
           partition by user_id
           order by current_period_end desc nulls last
         ) as rn
    from public.subscriptions
   where status in ('trialing','active')
)
update public.subscriptions
   set status = 'canceled'   -- or whatever non-live status you prefer
 where id in (select id from dups where rn > 1);

-- 1)  Add partial unique index
create unique index if not exists unique_live_sub_per_user
  on public.subscriptions(user_id)
  where status in ('trialing','active');
