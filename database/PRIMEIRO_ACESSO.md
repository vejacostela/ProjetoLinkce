# Convite e primeiro acesso

1. Configure SMTP próprio em Supabase Authentication → Email/SMTP.
   O envio padrão do Supabase é restrito e não serve para convidar clientes externos em produção.
2. Nas URLs de redirecionamento do Supabase, autorize exatamente
   https://SEU-DOMINIO/primeiro-acesso e mantenha /nova-senha para recuperação.
3. Configure na Vercel/servidor:
   - APP_PUBLIC_URL=https://SEU-DOMINIO (sem caminho)
   - PRIVACY_NOTICE_URL=https://SEU-DOMINIO/aviso-de-privacidade (documento publicado)
   - PRIVACY_NOTICE_VERSION=identificador-da-versao-publicada
4. Publique um aviso que corresponda ao tratamento real, com identificação dos
   responsáveis, finalidades, dados, compartilhamento, retenção, direitos e canal de contato.
   O checkbox registra ciência; não substitui a definição das bases legais ou a adequação à LGPD.
5. Em Authentication → Email Templates, personalize Invite user mantendo
   {{ .ConfirmationURL }} no botão. O reenvio de primeiro acesso utiliza o
   template de recuperação, também com {{ .ConfirmationURL }}.
6. Criar empresa solicita nome e email do administrador. O convite não contém
   senha: o link temporário autentica o destinatário, que define uma senha e
   depois confirma ciência do aviso. Não são armazenadas senhas em auditoria.
7. Para empresas existentes, use Enviar / reenviar convite. Uma conta já ativa ou
   de outra empresa não é promovida nem transferida por este fluxo.

Os estados e datas ficam em app_metadata do Auth, editáveis somente pelo servidor.
As APIs recusam operações com HTTP 428 enquanto o primeiro acesso estiver pendente.
Contas antigas não são obrigadas a passar por esse processo retroativamente.
Não é necessária migração SQL adicional.

Se o SMTP falhar, a empresa pode ter sido criada: não crie outra com o mesmo nome.
Use a opção de convite para a empresa existente. Se houver uma conta parcialmente
criada sem vínculo, revise em Authentication; o sistema não promove automaticamente
essa conta quando não consegue comprovar a empresa.

Antes de liberar comercialmente: validar entrega real e spam com um endereço
de teste autorizado, expiração/reuso do link, definição de senha, retorno à etapa
de privacidade após recarregar, acesso ao painel e isolamento de outra empresa.
