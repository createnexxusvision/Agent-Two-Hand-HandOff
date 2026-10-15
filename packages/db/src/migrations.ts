export type Migration = { id: string; sql: string };

export const MIGRATIONS: readonly Migration[] = [
  {
    id: "001_core",
    sql: `
create table keys (
  kid text primary key,
  record jsonb not null,
  created_at timestamptz not null default now()
);

-- The system of record. Every row is a signed, hash-chained receipt.
create table receipts (
  seq integer primary key check (seq >= 1),
  type text not null,
  actor text not null,
  ts timestamptz not null,
  prev text not null,
  hash text not null unique,
  receipt jsonb not null,
  created_at timestamptz not null default now()
);
create index receipts_type on receipts (type);

create table checkpoints (
  tree_size integer primary key check (tree_size >= 1),
  checkpoint jsonb not null,
  note text not null,
  created_at timestamptz not null default now()
);

create function reject_change() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'P0001';
end
$$;

create trigger receipts_append_only before update or delete on receipts
  for each row execute function reject_change();
create trigger receipts_no_truncate before truncate on receipts
  for each statement execute function reject_change();
create trigger checkpoints_append_only before update or delete on checkpoints
  for each row execute function reject_change();
create trigger checkpoints_no_truncate before truncate on checkpoints
  for each statement execute function reject_change();

-- Payout addresses and names, encrypted per record. Receipts only hold salted references.
create table payee_secrets (
  payee_id text primary key,
  envelope jsonb not null,
  updated_at timestamptz not null default now()
);

-- Webhook deliveries already processed; PayPal retries up to 25 times over 3 days.
create table webhook_events (
  event_id text primary key,
  event_type text not null,
  receipt_seq integer references receipts (seq),
  received_at timestamptz not null default now()
);

-- Worker state for paying decisions. Rows can be updated; the receipts they point to cannot.
create table payout_jobs (
  decision_key text primary key,
  decision_seq integer not null references receipts (seq),
  state text not null check (state in ('waiting_approval', 'ready', 'submitted', 'done', 'failed')),
  sender_batch_id text,
  payout_batch_id text,
  attempts integer not null default 0,
  last_error text,
  updated_at timestamptz not null default now()
);
create index payout_jobs_ready on payout_jobs (state) where state = 'ready';

-- Every agent is a registered principal with a default-deny tool list.
create table agents (
  agent_id text primary key,
  role text not null,
  key_id text not null,
  allowed_tools text[] not null default '{}',
  model_id text,
  prompt_version text,
  revoked_at timestamptz
);

create table eval_runs (
  id bigint generated always as identity primary key,
  suite text not null,
  model_id text not null,
  prompt_version text not null,
  policy_version text not null,
  passed integer not null,
  total integer not null,
  details jsonb not null,
  ran_at timestamptz not null default now()
);
`,
  },
];
