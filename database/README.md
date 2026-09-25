# Instalação do Sistema de Campo: cloud e servidor próprio

O mesmo código atende painel e relatório técnico. O pacote cria a estrutura do banco,
o bucket privado de evidências, as permissões e os registros de versão. Não contém
senhas, fotos de clientes ou cópias dos dados de produção.

## Escolha da instalação

| Modo | Aplicação | Banco, login e fotos |
| --- | --- | --- |
| Cloud | Vercel | Supabase Cloud |
| Servidor próprio | Docker no provedor, com domínio HTTPS | Supabase self-hosted do provedor |

PostgreSQL sozinho não substitui os serviços Auth, REST e Storage usados pelo código.
O modo escolhido em Gestão → Empresas é um cadastro; não provisiona máquinas,
não transfere dados e não muda as variáveis de conexão da instalação atual.
Para usar uma empresa em outro servidor, instale uma cópia do sistema naquele servidor.
Não é necessário que a instalação isolada tenha o mesmo UUID da cloud: a associação
central entre instalações será parte do controle comercial futuro.

## Cloud: instalar ou atualizar

1. Faça backup antes de atualizar uma base existente. Confirme o projeto de destino.
2. Execute TODO `database/install/install_cloud.sql` no SQL Editor do Supabase.
   Não execute as migrações individualmente: o instalador controla ordem, transação e versões.
3. O resultado deve mostrar todas as migrações versionadas aplicadas. Reexecutar o mesmo arquivo não
   reaplica migrações e não reativa empresas ou usuários bloqueados.
4. Configure no projeto Vercel `SUPABASE_URL`, `SUPABASE_KEY` (pública) e
   `SUPABASE_SERVICE_KEY` (privada), todas do mesmo Supabase. Preserve as variáveis
   que já estão corretas. Faça novo deploy após o SQL para renovar a detecção do esquema.
5. Em Authentication, habilite login por email e configure a URL do site e as URLs
   de recuperação de senha para o domínio usado. Restrinja cadastro público conforme
   sua operação; usuários operacionais são criados pela gestão.
6. Em uma instalação vazia, crie o primeiro gestor com `deploy/bootstrap_admin.py`.
   Em uma instalação existente, os usuários da empresa principal são vinculados
   preservando os perfis administrativos registrados no Auth.

O usuário só acessa empresas com vínculo ativo em `usuarios_empresas`. O papel é
consultado por empresa. Informações editáveis pelo próprio usuário não autorizam
acesso. A conta da plataforma é a única autorizada a criar empresas; os gestores de
clientes administram apenas a própria empresa e não veem o seletor quando têm um único
vínculo. Após criar uma empresa, selecione-a no painel e crie um usuário do tipo
**Gestor** com o e-mail do cliente. Esse será o login administrativo do cliente.

Em uma instalação cloud que já existia antes dessa separação, execute uma vez
`database/admin_plataforma.sql` no SQL Editor. Ele habilita a conta interna
`gestor@gestor.linkce` como administradora da plataforma, sem conceder esse poder aos
gestores de clientes.

## Servidor próprio: instalar

1. Instale a distribuição oficial do [Supabase com Docker](https://supabase.com/docs/guides/self-hosting/docker).
   Configure Auth, REST, Storage, credenciais próprias e o endereço público HTTPS,
   por exemplo `https://supabase.provedor.com.br`. Guarde a versão instalada.
2. Clone este repositório no servidor. Execute `database/install/install_servidor_proprio.sql`
   no SQL Editor do Supabase local, ou usando `psql` com conexão ao banco desse servidor:

   ```sh
   psql -v ON_ERROR_STOP=1 -f database/install/install_servidor_proprio.sql
   ```

   Configure conexão via `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` e `.pgpass`.
   Os dois instaladores possuem o mesmo esquema e exigem Supabase completo.
3. Copie `deploy/.env.example` para `deploy/.env` e preencha os valores. O navegador
   precisa alcançar `SUPABASE_URL`; não use o hostname interno do container.
4. Aponte o DNS de `LINKCE_DOMAIN` para o servidor. O Compose fornecido usa portas
   80/443 para Caddy obter o certificado. Se já houver proxy nessas portas, integre
   a aplicação ao proxy existente em vez de iniciar um segundo proxy concorrente.
5. Na raiz do repositório:

   ```sh
   docker compose --env-file deploy/.env -f deploy/compose.yml up -d --build
   docker compose --env-file deploy/.env -f deploy/compose.yml exec app python deploy/bootstrap_admin.py
   docker compose --env-file deploy/.env -f deploy/compose.yml ps
   ```

6. Acesse `https://SEU-DOMINIO/` e `https://SEU-DOMINIO/tecnico`. Autorize câmera e
   localização no celular. Envie um relatório com foto e confirme sua leitura no painel.

### Segurança e diagnóstico do host

1. Execute `python3 deploy/server_security_check.py` no host após definir
   `LINKCE_DOMAIN`. O diagnóstico é somente leitura e grava um JSON sem segredos em
   `/var/lib/sistema-campo/security/status.json`.
2. Agende essa execução a cada cinco minutos pelo agendador do sistema. O painel marca
   o diagnóstico como desatualizado depois de 15 minutos.
3. Mantenha somente 80/443 públicos. A porta do PostgreSQL/Supabase deve ficar na rede
   privada; administração deve ocorrer por VPN ou rede explicitamente autorizada.
4. O container da aplicação já executa com usuário sem root, filesystem somente leitura,
   capacidades removidas e `no-new-privileges`.
5. Em Gestão → Servidor próprio, compare as verificações automáticas com o ambiente e
   registre o checklist. O registro identifica usuário, empresa e data na auditoria.

### Backup completo

Copie `deploy/.backup.env.example` para um arquivo privado fora do Git e configure uma
conta exclusiva de backup. Guarde a senha em `.pgpass` com permissão `600`, sem senha na
linha de comando. Use esse ambiente ao executar `deploy/backup_database.sh`. O script
gera dump comprimido, SHA-256, retenção local e, quando configurado,
cópia externa por um destino `rclone` já autenticado. Nenhuma senha deve ser salva no Git.
Registre cada execução em Gestão → Servidor próprio. Um backup só é considerado validado
depois de uma restauração bem-sucedida em ambiente separado.

O script de primeiro gestor pede a senha no terminal, confirma o vínculo e não redefine
contas existentes. Se o banco já possuir usuários, use o painel para criar os demais.
O template não configura DNS, instala Docker nem cria o Supabase automaticamente.

## Backup e atualização

Backups devem incluir o banco Supabase (inclusive Auth), objetos do Storage e configuração
privada da instalação. O ZIP de instalação contém apenas estrutura. O backup do painel
não substitui o backup completo do Supabase. Siga também os guias oficiais de
[migração de banco](https://supabase.com/docs/guides/self-hosting/restore-from-platform)
e de [cópia de Storage](https://supabase.com/docs/guides/self-hosting/copy-storage).
Valide restauração em ambiente separado antes de trocar uma instalação em uso.

Para atualizar o app: obtenha a versão do GitHub, faça backup, aplique o instalador
atualizado no banco correto e reconstrua o container. Mantenha o pacote e o banco
na mesma versão. Não edite uma migração já aplicada: crie a próxima e gere os instaladores:

```sh
python database/build_installers.py
python database/build_installers.py --check
```

## Limites e verificação

- O teste SQL em CI valida instalação nova, atualização do esquema legado, repetição,
  criação atômica de empresa e bloqueio do acesso direto às tabelas. Usa PostgreSQL
  com contratos mínimos de Auth e Storage; não substitui um teste real desses serviços.
- Para produção, valide login, relatório com foto, localização, avisos, troca de empresa
  e recuperação de senha no destino. Sem acesso ao Supabase/servidor não há ativação remota.
- A administração comercial global, cobrança, licenciamento e provisionamento automático
  de servidores não fazem parte deste pacote.
