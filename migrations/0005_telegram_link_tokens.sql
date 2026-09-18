create table if not exists telegram_link_tokens (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  token text not null unique,
  telegram_user_id bigint,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default current_timestamp
);

create index if not exists telegram_link_tokens_user_id_idx
  on telegram_link_tokens (user_id);

create index if not exists telegram_link_tokens_token_idx
  on telegram_link_tokens (token);
