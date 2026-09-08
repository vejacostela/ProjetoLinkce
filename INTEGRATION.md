# Integração interna — sistema único

Este documento substitui as instruções anteriores de dois projetos Vercel.

O painel está em /, o formulário em /tecnico e a API em /api/* e /gerar_relatorio, todos no domínio projeto-linkce.vercel.app. O backend conecta diretamente ao Supabase. Não há proxy para relatorio-linkce.vercel.app nem necessidade de RELATORIO_API_URL.

## Operação

- Login compartilhado entre painel, captura e recuperação. Gestor e apoio consultam; técnico envia. Só gestor cadastra usuários e administra a limpeza.
- Relatórios com período inclusivo no fuso de Brasília, nome exato de técnico e páginas de 50 registros. Total corresponde ao filtro; mapa e indicadores de técnicos/GPS correspondem à página.
- Localização é a registrada no envio, não rastreamento ao vivo. Sem GPS, o relatório permanece visível; zero é coordenada válida.
- Banco de relatórios permite ao gestor calcular uma prévia por dias a manter e confirmar digitando EXCLUIR. É uma operação manual e permanente, sobre todos os técnicos, que preserva ao menos as últimas 24 horas. Não há agendamento automático.
- Rascunhos offline pertencem ao navegador e ao domínio onde foram criados. Não são migrados do endereço antigo.

## Implantação

Usar o projeto Vercel projeto-linkce na raiz do repositório. Configurar nele as três variáveis Supabase e atualizar as URLs de autenticação no Supabase, conforme README.md. A tabela e os usuários existentes não mudam. Se houver notificações WhatsApp, transferir suas variáveis também.

O módulo Relatorio-Linkce/main.py preserva as verificações de sessão e cargo. Assets do painel usam /panel-assets; os do coletor usam /static. /dashboard redireciona a / no mesmo domínio. O service worker tem escopo /tecnico e não controla a página de gestão.

## Reversão

Reverter esta unificação volta a exigir o serviço externo antigo, que foi desativado pelo usuário. Reativá-lo e restaurar sua configuração seria necessário antes de tal reversão. Nenhum dado foi apagado por esta implantação.
