create table if not exists subscriptions (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  plan text not null default 'basic',
  status text not null default 'active',
  starts_at timestamptz not null default current_timestamp,
  expires_at timestamptz,
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp
);

create table if not exists telegram_groups (
  id text primary key,
  subscription_id text not null references subscriptions (id) on delete cascade,
  chat_id bigint not null unique,
  title text not null,
  username text,
  chat_type text not null,
  status text not null default 'active',
  added_by_telegram_user_id bigint,
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp
);

create index if not exists subscriptions_user_id_idx
  on subscriptions (user_id);

create index if not exists telegram_groups_subscription_id_idx
  on telegram_groups (subscription_id);

create index if not exists telegram_groups_chat_id_idx
  on telegram_groups (chat_id);
