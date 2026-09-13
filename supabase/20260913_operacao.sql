begin;
create index if not exists relatorios_criado_em_idx
  on public.relatorios (criado_em desc);
create index if not exists relatorios_tecnico_criado_em_idx
  on public.relatorios (tecnico, criado_em desc);
create index if not exists relatorios_user_id_criado_em_idx
  on public.relatorios (user_id, criado_em desc);
create index if not exists relatorio_imagens_relatorio_id_idx
  on public.relatorio_imagens (relatorio_id, criado_em);
create index if not exists auditoria_gestao_criado_em_idx
  on public.auditoria_gestao (criado_em desc);
commit;
