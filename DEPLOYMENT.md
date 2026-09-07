# Correções do gerador

Validação do relatório no servidor, remoção de rotas de depuração/recarga públicas,
origens CORS configuráveis, correção da seleção antiga de material e confirmação
real de cópia. A aplicação continua sendo um gerador público sem persistência.

Use ALLOWED_ORIGINS com origens separadas por vírgula apenas para acesso entre
domínios. Acesso no mesmo domínio funciona sem essa variável.

Execute python -m unittest -v test_validation em ambiente com requirements.txt
e httpx==0.27.2. Os testes não enviam dados a servidores externos.

O dashboard compartilhado, banco independente, formulários configuráveis e painel
de licenças não fazem parte desta correção. A evolução partirá do Relatorio-Linkce.
O database.db versionado não é utilizado pelo servidor; avaliar seu conteúdo e
histórico separadamente antes de qualquer remoção.
