begin;
create table if not exists public.avisos_operacao (
 id integer primary key check(id=1),
 mensagem text not null default '' check(length(mensagem)<=3000),
 bloqueado boolean not null default false,
 atualizado_por uuid,
 atualizado_em timestamptz not null default now(),
 check(not bloqueado or length(trim(mensagem))>0)
);
insert into public.avisos_operacao(id) values(1) on conflict do nothing;
alter table public.avisos_operacao enable row level security;
revoke all on public.avisos_operacao from public,anon,authenticated;
grant select,insert,update on public.avisos_operacao to service_role;
commit;
