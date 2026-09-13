# Linkce — sistema único

Painel, formulário dos técnicos e API são executados no mesmo aplicativo FastAPI, pelo projeto **projeto-linkce** da Vercel. O projeto Vercel relatorio-linkce não é mais necessário.

| Função | Endereço |
| --- | --- |
| Painel | https://projeto-linkce.vercel.app/ |
| Formulário técnico | https://projeto-linkce.vercel.app/tecnico |
| Recuperar senha | https://projeto-linkce.vercel.app/recuperar-senha |
| Nova senha pelo link de email | https://projeto-linkce.vercel.app/nova-senha |

## Configuração na Vercel

Usar apenas o projeto **projeto-linkce**, repositório **vejacostela/ProjetoLinkce**, branch **main**, Root Directory na raiz (vazio / padrão). A pasta Relatorio-Linkce contém o módulo de captura e API, importado pelo main.py da raiz; não é um segundo deploy.

No ambiente Production desse projeto, configurar **SUPABASE_URL**, **SUPABASE_KEY** (anon/publishable) e **SUPABASE_SERVICE_KEY** (somente servidor), todas do Supabase que já contém os usuários e relatórios. As variáveis do projeto Vercel desativado não são transferidas automaticamente. Depois de alterá-las, fazer Redeploy.

RELATORIO_API_URL deixou de ser utilizada. Não há chamadas à aplicação desativada. Se havia integração WhatsApp, manter WHATSAPP_SERVICE_URL e WHATSAPP_SECRET no projeto único; sem essas variáveis, notificações permanecem inativas.

No Supabase, configurar Site URL como https://projeto-linkce.vercel.app e permitir Redirect URL https://projeto-linkce.vercel.app/nova-senha. Manter o provedor Email ativo. As tabelas existentes são reutilizadas; para ativar status de envio, backup completo e ambientes por cliente, execute uma vez o arquivo [supabase/20260913_operacao.sql](supabase/20260913_operacao.sql) no SQL Editor.

## Sessão e perfis

Painel, captura e recuperação compartilham a sessão no mesmo domínio. Técnico que entra no painel é direcionado a /tecnico; gestor e apoio consultam o painel e também podem abrir a área técnica. As permissões de cada operação são verificadas na API com a identidade do Supabase.

O cache offline é limitado à área /tecnico. O painel e as APIs privadas não são armazenados por esse cache. Rascunhos offline do domínio antigo não migram automaticamente para o domínio novo.

## Código e testes

main.py na raiz carrega Relatorio-Linkce/main.py como módulo e publica o painel. Assets do painel usam /panel-assets; captura usa /static. Somente o vercel.json e requirements.txt da raiz definem o deploy.

Na raiz: instalar requirements.txt e executar `python -m unittest -v test_integration`.
Dentro de Relatorio-Linkce: `python -m unittest -v test_security test_accounts test_report_listing test_bank_retirement`.

Os testes usam banco e identidade simulados. Validar acesso, geração, gravação, localização, consulta e recuperação por email no ambiente configurado. Não executar exclusões reais como teste.

Código do coletor originalmente importado do commit 51a92b5ba800626024a282f0d7edb247c32cfbeb de vejacostela/Relatorio-Linkce. Novas alterações devem ocorrer neste repositório unificado.

### Redefinição de senhas pelo gestor

O botão **Senhas e histórico** permite ao gestor informar o email, uma nova senha e um motivo opcional. A senha anterior é substituída e o painel registra data, gestor, usuário e motivo — nunca a senha.

Antes de usar esta função, execute no SQL Editor do mesmo projeto Supabase o arquivo [`supabase/20260909_historico_redefinicao_senhas.sql`](supabase/20260909_historico_redefinicao_senhas.sql). Apenas gestores autenticados podem consultar o histórico ou redefinir senhas.

### Evidências por imagem

O técnico pode tirar fotos pela câmera ou escolher imagens da galeria antes de gerar o relatório. Elas aparecem em miniaturas e são enviadas depois que o relatório é salvo. No painel, **Imagens** abre a galeria privada do relatório e permite anexar fotos complementares.

Execute uma vez no Supabase o arquivo [`supabase/20260909_evidencias_relatorios.sql`](supabase/20260909_evidencias_relatorios.sql). Ele cria o bucket privado `relatorio-evidencias` e a tabela de vínculo das imagens.


## Operação, backup e empresas

O painel mostra relatórios por técnico, quantidade de fotos, localização, pendências de revisão, falhas de envio e itens na fila offline. Relatórios com erro podem ser colocados novamente na fila pelo botão **Tentar de novo**.

O gestor pode exportar a página atual em CSV ou baixar o backup completo em CSV/ZIP. O ZIP inclui os metadados e, quando disponíveis, até 100 imagens por execução. O endpoint JSON autenticado é `/api/backup?formato=json`.

A área **Empresas** permite criar ambientes separados. A empresa ativa é enviada no cabeçalho `X-Empresa-ID` e os relatórios, avisos e auditoria são filtrados por ela. Após criar empresas, associe os usuários pela tabela `public.usuarios_empresas` ou crie-os pelo painel para vinculá-los automaticamente.

A área **Saúde** consulta conectividade, latência e recursos opcionais. A auditoria da gestão aceita filtros por usuário, ação, resultado e período.

A área técnica funciona como PWA e mantém relatórios e fotos em uma fila local quando a rede falha. Ao voltar a conexão, a sincronização tenta novamente com limite de oito tentativas; falhas persistentes ficam visíveis para revisão.

Para uma validação rápida da implantação, use `python scripts/smoke_production.py` com `LINKCE_BASE_URL` definido.