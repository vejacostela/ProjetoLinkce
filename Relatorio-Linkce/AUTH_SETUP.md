# Login, usuários e recuperação de senha

As alterações são publicadas pelo GitHub/Vercel. Não é necessário executar Python no computador do usuário.

## Configuração antes de publicar

1. Na Vercel, configure `SUPABASE_URL`, `SUPABASE_KEY` (anon ou publishable) e `SUPABASE_SERVICE_KEY` (segredo exclusivo do servidor). Nunca coloque a chave de serviço no HTML, GitHub ou em SUPABASE_KEY.
2. No Supabase, em Authentication / URL Configuration, configure a Site URL como `https://relatorio-linkce.vercel.app` e adicione às Redirect URLs `https://relatorio-linkce.vercel.app/nova-senha`. Para outro domínio, autorize a URL equivalente nesse domínio. A aplicação usa o domínio em que está aberta.
3. Mantenha no modelo de email de recuperação o link padrão `{{ .ConfirmationURL }}`. Verifique a configuração de envio de emails do projeto e teste a entrega com uma conta de homologação.
4. Conclua a migração e configuração de cargos descritas em DEPLOYMENT.md. O primeiro gestor precisa ter `app_metadata.role = gestor`, atribuído pela administração do Supabase. Entre novamente depois de alterar o cargo.
5. Valide em homologação antes de integrar o PR e publicar na Vercel.

## Uso

- Clique em **Esqueci minha senha** no login e informe o email.
- Abra o link recebido para escolher uma senha de 12 a 128 caracteres; confirme a senha e entre novamente.
- Link expirado ou já usado exige uma nova solicitação. Uma sessão comum, sem o evento de recuperação, não libera essa tela.
- O gestor cadastra usuários pelo painel, escolhendo técnico, apoio ou gestor. O servidor verifica a permissão e grava o cargo em app_metadata. A senha inicial não é alterada por este código para contas existentes.
- Apoio e técnico não podem criar contas. Permissões detalhadas das outras funções estão em DEPLOYMENT.md.

## Verificação

`python -m unittest -v test_security test_accounts`

Os testes usam identidades e serviços simulados. Não enviam emails nem alteram usuários reais. A entrega do email, a abertura do link e o login com a senha alterada precisam ser validados no projeto Supabase configurado.

Referências: https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail e https://supabase.com/docs/reference/javascript/auth-updateuser
