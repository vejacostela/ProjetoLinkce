# Integração de gestão Linkce

## Fluxo

Relatorio-Linkce captura e grava relatórios no Supabase. ProjetoLinkce apresenta a gestão em `/` e `/dashboard`. `/tecnico` abre o aplicativo de captura. A API do painel encaminha somente configuração pública, consulta de relatórios e cadastro de usuários ao serviço de captura. A verificação de cada sessão e perfil continua no backend Relatorio-Linkce, que já detém a chave de serviço.

Não há cópia de banco, senha padrão embutida, transferência de token por URL ou chave de serviço no painel. Cada domínio mantém sua própria sessão; o usuário pode precisar entrar nos dois aplicativos.

## Publicação

1. Publicar primeiro a atualização de `/api/relatorios` no Relatorio-Linkce: ela acrescenta paginação, filtros de datas e contagem, preservando os campos antigos. O envio do técnico não muda.
2. Publicar este ProjetoLinkce. `RELATORIO_API_URL` é opcional e aponta, por padrão, para `https://relatorio-linkce.vercel.app`. Para outra instalação, definir somente a origem HTTPS do serviço correto. Previews de homologação devem apontar para serviço de homologação, pois o padrão aponta para produção.
3. Não copiar SUPABASE_SERVICE_KEY para este painel. A configuração pública é obtida do serviço de captura. Não é necessário liberar CORS entre os domínios: as consultas à API são feitas servidor a servidor.
4. O banco existente deve conter latitude, longitude e user_id. Nenhuma migração é exigida se o envio com GPS já está funcionando. Índices recomendados: criado_em e (tecnico, criado_em); o SQL anteriormente utilizado para recriar relatorios já os inclui.
5. Abrir o painel e testar com contas gestor, apoio e tecnico. Gestor consulta e cadastra; apoio consulta e envia no coletor; técnico envia no coletor e recebe 403 ao consultar relatórios ou cadastrar usuários.

## Uso

- O período inicial é o mês atual, no fuso de Brasília. Datas finais incluem o dia inteiro. O nome do técnico é um filtro exato.
- A lista possui 50 registros por página; total corresponde ao período e filtros, mapa e indicadores de técnicos/GPS correspondem à página exibida.
- A localização é a registrada no envio do relatório, não rastreamento ao vivo. Registros sem GPS continuam visíveis na tabela. Coordenadas zero são válidas.
- Detalhes e cópia usam texto, sem interpretar conteúdo dos relatórios como HTML.
- O mapa usa Leaflet e mosaicos OpenStreetMap; indisponibilidade do mapa não impede ler coordenadas nos detalhes. O navegador consulta esses serviços externos.
- Falhas de consulta limpam resultados anteriores e exibem erro; não são apresentadas como lista vazia. Saída fecha detalhes e limpa dados em tela.

## Validação

`python -m unittest -v test_integration`

No repositório Relatorio-Linkce: `python -m unittest -v test_security test_accounts test_report_listing`.

Os testes usam serviços e identidades simulados, sem criação de usuários ou envio de mensagens reais. Validar o login e a consulta com as contas do provedor após publicação. A troca obrigatória de senha, bloqueio de usuários, formulário configurável, licenciamento e banco independente continuam fora desta etapa.

## Painel único e limpeza por período

`https://relatorio-linkce.vercel.app/dashboard` redireciona ao ProjetoLinkce. O formulário dos técnicos e as APIs permanecem no Relatorio-Linkce. O redirecionamento não transfere tokens; pode ser necessário entrar no novo domínio.

O gestor encontra **Banco de relatórios** no ProjetoLinkce: informa quantos dias manter, calcula uma prévia e digita EXCLUIR para executar. A API usa exatamente o corte apresentado, preservando pelo menos as últimas 24 horas. A operação afeta todos os técnicos, sem relação com o filtro de consulta do painel; remove os registros completos. A prévia é uma contagem daquele instante e pode mudar se houver outras operações no banco. Não há limpeza agendada.

Nenhum relatório é apagado na implantação. Os endpoints de banco continuam exigindo gestor no servidor. Publicar o coletor e depois o painel. Não é necessária migração de banco.

## Reversão

Reverter os commits restaura as interfaces anteriores, mas não recupera registros que um gestor tenha excluído usando a função de limpeza. A implantação não altera registros, permissões do banco ou o formato de gravação.
