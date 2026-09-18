create table if not exists bot_studio_panel (
  id integer primary key default 1,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default current_timestamp
);

insert into bot_studio_panel (id, config)
values (1, '{"version":"2.0","phases":[],"commands":{},"responses":{},"permissions":{}}'::jsonb)
on conflict (id) do nothing;
