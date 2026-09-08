# Atualização de segurança e confiabilidade

Esta etapa mantém o produto em uma instalação por provedor. Não implementa ainda
multiempresa, formulários configuráveis, licenciamento ou instalação PostgreSQL
independente de Supabase. O painel central de clientes fica para depois.

## Preparação antes da publicação

1. Faça backup do banco e teste a restauração em homologação.
2. Use um projeto Supabase separado para homologação.
3. Configure SUPABASE_URL, SUPABASE_KEY (somente anon/publishable) e
   SUPABASE_SERVICE_KEY (somente servidor). Nunca use a service key em SUPABASE_KEY.
4. Execute migrations/001_protect_reports.sql no banco de homologação.
   Nenhum relatório é excluído; as colunas faltantes são adicionadas.
5. Revise e atribua os cargos existentes através da administração do Supabase:
   app_metadata.role deve ser gestor, apoio ou tecnico. Não copie automaticamente
   cargos de user_metadata: esse campo é editável pelo usuário.
6. Entre novamente para renovar a sessão. Teste os três perfis.
7. Confira as políticas e permissões de RPCs já existentes. A migração revoga
   acesso direto à tabela para anon/authenticated, mas não altera funções externas.
8. Só depois publique em produção, coordenando aplicação, banco e cargos.

## Comportamento

- O backend confirma a sessão com Supabase Auth e usa identidade verificada.
- Somente gestor cria usuários ou administra o banco; apoio e gestor consultam.
- A service key executa operações apenas após as verificações do backend.
- Erro de persistência retorna 503 e não confirma envio nem notifica WhatsApp.
- O UUID de envio usa a chave primária do relatório: reenvio não sobrescreve.
- Sincronização offline precisa de uma sessão renovada no aplicativo aberto.
  Tokens não são persistidos na fila. Pendências de outro usuário não são enviadas.
- APIs privadas não entram no cache offline; a atualização limpa o cache antigo.
- O cadastro não compartilha dados entre provedores: use instalações/bancos separados.
- WHATSAPP_SECRET não tem valor padrão. Sem URL e segredo, notificações ficam inativas.
- ALLOWED_ORIGINS é uma lista de origens HTTPS separadas por vírgula, quando houver
  interfaces em domínios diferentes. Mesma origem não necessita dessa configuração.

## Testes

Instale requirements.txt e httpx==0.27.2 em um ambiente de teste.
Execute python -m unittest -v test_security test_accounts.
Configure também a recuperação de senha conforme AUTH_SETUP.md.
Os testes usam banco e identidade simulados; não acessam produção.

Antes de liberar: testar no navegador login, expiração da sessão, copiar relatório,
modo offline, troca de usuário, reenvio e confirmação do mesmo UUID no banco.
Não divulgar previews com variáveis do banco de produção.
