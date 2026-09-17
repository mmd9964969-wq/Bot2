create table if not exists bot_config (
  id integer primary key default 1,
  config jsonb not null default '{}'::jsonb,
  alias_overrides jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default current_timestamp
);

insert into bot_config (id)
values (1)
on conflict (id) do nothing;
