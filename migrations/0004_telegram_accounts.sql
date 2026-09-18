create table if not exists telegram_accounts (
  id text primary key,
  user_id text not null unique references "user" ("id") on delete cascade,
  telegram_user_id bigint not null unique,
  username text,
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp
);

create index if not exists telegram_accounts_telegram_user_id_idx
  on telegram_accounts (telegram_user_id);
