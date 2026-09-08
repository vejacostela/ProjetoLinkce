# ProjetoLinkce

Repositório unificado da gestão e da captura de relatórios Linkce.

| Aplicativo | Pasta | Projeto Vercel | Endereço |
| --- | --- | --- | --- |
| Painel de gestão | raiz deste repositório | projeto-linkce | https://projeto-linkce.vercel.app/ |
| Captura e API | Relatorio-Linkce/ | relatorio-linkce | https://relatorio-linkce.vercel.app/ |

O painel consulta a API autenticada do coletor. O Supabase continua sendo o banco; não há migração de dados nesta reorganização. As duas aplicações e seus domínios permanecem separados, mas o código passa a ser mantido neste único repositório.

## Concluir a conexão na Vercel

A cópia do código não altera automaticamente a origem Git do projeto Vercel existente.

No projeto **relatorio-linkce** da Vercel:

1. Em Settings / Git, trocar o repositório conectado para **vejacostela/ProjetoLinkce**.
2. Em Settings / Build and Deployment, definir **Root Directory** como **Relatorio-Linkce** (respeitar maiúsculas).
3. Manter a branch de produção **main**, os domínios e as variáveis existentes, incluindo SUPABASE_URL, SUPABASE_KEY e SUPABASE_SERVICE_KEY. Não publicar valores de chaves no GitHub.
4. Publicar a branch main do repositório unificado depois de salvar a configuração. O vercel.json e requirements.txt da subpasta são os usados pelo coletor.
5. Verificar login, envio de relatório, localização e consulta no painel.

O projeto **projeto-linkce** da Vercel permanece conectado a este repositório com Root Directory na raiz (vazio / padrão).

Até concluir a troca na Vercel, a produção do coletor ainda vem do repositório antigo. Não remover o projeto Vercel relatorio-linkce nem seu domínio. Não arquivar o repositório antigo antes de validar a troca. Após a troca, fazer as próximas alterações do coletor em Relatorio-Linkce/ neste repositório, evitando divergência entre as cópias.

## Referência da importação

Código do coletor importado de vejacostela/Relatorio-Linkce, commit 51a92b5ba800626024a282f0d7edb247c32cfbeb. Os arquivos importados preservam seu conteúdo, incluindo PNGs, testes e migrações. O arquivo legado database.db não foi copiado; a aplicação usa Supabase e não lê esse SQLite. O histórico anterior permanece no repositório de origem.

## Desenvolvimento e testes

Executar cada aplicativo a partir de sua própria pasta, em ambientes separados para evitar conflito entre módulos main.py e dependências.

- Painel: instalar requirements.txt e executar python -m unittest -v test_integration na raiz.
- Coletor: dentro de Relatorio-Linkce/, instalar requirements.txt e httpx==0.27.2; executar python -m unittest -v test_security test_accounts test_report_listing test_bank_retirement.

A configuração de publicação em subpasta não requer mudar as rotas HTTP: /gerar_relatorio, /api/* e /static/* continuam relativas ao domínio do coletor.

Leia [INTEGRATION.md](INTEGRATION.md), [configuração de acesso](Relatorio-Linkce/AUTH_SETUP.md) e [implantação do coletor](Relatorio-Linkce/DEPLOYMENT.md).

Referência Vercel: https://vercel.com/docs/monorepos
