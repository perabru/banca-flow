# Verificações locais

Os testes usam dados fictícios. Eles não autenticam usuários reais nem leem ou gravam dados de produção.

## Lógica da aplicação

Requer apenas Node.js atual; não precisa instalar pacotes:

```bash
node --test tests/app.test.cjs
```

A suíte executa o JavaScript do próprio `index.html` com adaptadores de DOM e Firebase em memória. Verifica notas individuais e médias ponderadas, nota zero, dados incompletos, cronômetro compartilhado com centésimos, repetição de transações, confirmação/cancelamento, encerramento/reabertura por avaliadores e coordenação, exclusividade das entregas, preservação de rascunhos, atualização consistente do relatório e PDF nativo. Também verifica snapshots oficiais e parciais, filtro por aluno, privacidade das notas de outros professores, bloqueio de prévias desatualizadas e mudança de sessão durante operações assíncronas.

A gestão de professores e grupos também é verificada: gestão por todos os coordenadores ativos, conta secundária durante o cadastro, reversão de criação incompleta, dados imutáveis de login, edição de contato, concorrência, remoção e restauração sem apagar histórico, identidade dos alunos, proteção após agendamento e confirmação da importação.

A consulta **Todas as notas** é verificada separadamente dos relatórios finais: Alberson consulta todas as bancas, inclusive abertas, incompletas e de grupos arquivados, com notas por aluno, professor e critério. A suíte cobre notas zero, médias incompletas, entregas pendentes, cálculo de 60%/40%, identificação de resultados provisórios, professores desativados no histórico, filtros independentes da agenda e dos PDFs, busca, escape do conteúdo salvo e bloqueio de acesso pelo professor ou sem sessão. A consulta mantém os critérios dos avaliadores somente para leitura. Alberson pode preencher a nota individual de monografia / entregas na mesma tela, sem alterar as avaliações dos professores.

O consolidado geral cobre todas as bancas salvas, abertas, incompletas, encerradas e arquivadas, além de alunos sem banca. Sua exportação não depende dos filtros da consulta ou dos relatórios oficiais. Os testes conferem os PDFs com notas e gráficos, o CSV detalhado, valores zero, notas pendentes, leitura atualizada de todo o catálogo, bloqueio sem conexão, rascunhos pendentes e troca de sessão. O PDF oficial continua exigindo notas completas. O salvamento da monografia rejeita aluno inexistente, banca arquivada ou encerrada, falta de sessão e perfil de professor.

A coordenação também é testada como avaliadora: **Minhas avaliações** considera somente bancas em que o usuário autenticado é membro ativo, mantém a escolha de uma banca atribuída e apresenta os próprios formulários antes da consulta geral. As regressões salvam notas zero e decimais no UID do Alberson, verificam os colegas e as entregas sem alterações, bloqueiam a edição após encerramento e permitem retomá-la após reabertura. O acesso a bancas sem participação permanece somente para consulta.

O parser local do Excel tem uma suíte própria, sem dependências adicionais:

```bash
node --test tests/import.test.cjs tests/board-import.test.cjs
```

Ela lê arquivos XLSX, XLS e CSV reais com a biblioteca local, verifica cabeçalhos e orientadores, agrupamento e identidades estáveis, importações repetidas, cursos distintos, fórmulas e limites de arquivo.

## Gráficos e PDFs analíticos

As suítes dos gráficos e do consolidado também usam apenas Node.js e os arquivos locais:

```bash
node --test tests/analytics.test.cjs tests/analytics-pdf.test.cjs tests/coordinator-report.test.cjs tests/coordinator-report-pdf.test.cjs
```

A primeira verifica as médias por aluno e por banca, composição de 60%/40%, notas individuais por professor e critério, tempo com centésimos, ausência de cronômetro distinta de tempo zero, escalas, rótulos, tabelas acessíveis e escape de conteúdo nos gráficos SVG. A segunda valida a saída vetorial no PDF, sua paginação e o tratamento de dados ausentes e rótulos extensos.

A suíte `app.test.cjs` também verifica que somente a coordenação acessa a análise oficial, que apenas bancas encerradas e completas entram nos gráficos e que PDFs respeitam os filtros de data, curso, turma e banca. A emissão relê as notas salvas e é cancelada quando a banca é reaberta ou a seleção muda durante a leitura. Os relatórios oficiais podem incluir ou omitir gráficos; o compartilhamento individual inclui apenas o aluno selecionado, e o PDF parcial do professor nunca incorpora a análise oficial.

## Navegador real

Instale Playwright em um ambiente de desenvolvimento e indique um executável Chromium existente:

```bash
BANCAFLOW_CHROMIUM=/caminho/do/chromium node --test tests/browser.test.cjs
```

Sem Playwright ou sem essa variável, os testes de navegador aparecem como ignorados. Eles executam a página real com Firebase em memória e requisições interceptadas localmente. Verificam larguras de 320 a 1440 px, os eventos reais de formulário e botões, cronômetro compartilhado, encerramento e reabertura por professores/coordenador, permissão das entregas, rascunhos durante atualizações e confirmação de salvamento, além do download efetivo do PDF com notas e médias ponderadas.

Os testes dos gráficos conferem o carregamento dos recursos locais sob a política CSP, rótulos e descrições dos SVGs, estado vazio, distinção entre tempo zero e não registrado, filtros, exploração de uma banca e os downloads reais dos PDFs analíticos e oficiais com ou sem gráficos. Também conferem a ausência de rolagem horizontal e o bloqueio da análise no perfil de professor.

A consulta de notas também passa pela navegação real de desktop e pelo atalho direto “Notas” no celular. São verificados os filtros por curso, turma, data e situação, a busca, a limpeza da seleção, as médias atualizadas após um snapshot do Firebase e a preservação das bancas expandidas. Os detalhes da banca exibem todas as notas ao coordenador mesmo quando ele não é avaliador, sem abrir campos para editar a nota de outro professor. A troca de sessão remove o acesso e limpa as expansões. A tela é conferida de 320 a 1440 px; capturas são salvas quando `BANCAFLOW_SCREENSHOT_DIR` estiver definido.

O navegador também salva a monografia pelo formulário individual de **Todas as notas**, confirma os critérios dos avaliadores preservados, consulta os gráficos de bancas abertas e incompletas e baixa os três arquivos completos mesmo com a consulta filtrada. Capturas em 320, 390 e 1440 px e PDFs gerados ficam no diretório de QA configurado.

O fluxo real do Alberson percorre **Minhas avaliações** no desktop e **Avaliar** diretamente na navegação do celular, salva critérios no próprio UID e confere a atualização da tabela de consulta. Verifica o bloqueio e a reabertura, os atalhos de notas/bancas/relatórios, a preservação das entregas e dos demais avaliadores e sua seleção como avaliador na criação de outra banca. A tela de lançamento é conferida em 320, 390 e 1440 px.

O compartilhamento é verificado com `navigator.share`, clipboard e links do WhatsApp interceptados: arquivo PDF real, notas individuais, ativação por clique, cancelamento sem envio automático, alternativa de download/texto, escolha de um aluno, privacidade do relatório parcial e bloqueio de dados desatualizados. Os testes não abrem conversas reais nem enviam mensagens.

Os fluxos de administração cobrem cadastro, edição e reativação de professor, criação e arquivamento de grupo e carregamento de um arquivo Excel real com prévia, cancelamento, confirmação e preservação do catálogo na reimportação. O HTML de produção também é aberto sem alterações, com módulos Firebase simulados, para conferir os hashes da política CSP, os recursos locais e o formulário de acesso. Os demais cenários usam o mesmo CSP com o hash recalculado apenas para o módulo de teste.

Para usar um pacote Chromium de servidor, `BANCAFLOW_CHROMIUM_MODULE` pode apontar para o módulo que exporta `default.args`. `FONTCONFIG_PATH` pode indicar o diretório de fontes desse pacote. Para salvar capturas da página real, inclusive dos gráficos em 320, 390 e 1440 px, defina `BANCAFLOW_SCREENSHOT_DIR`. Para guardar os PDFs reais gerados nos testes de gráficos, defina também `BANCAFLOW_QA_DIR` com o diretório de destino. As capturas isoladas dos gráficos ocultam temporariamente a navegação fixa durante a captura, sem modificar o aplicativo.

As suítes da aplicação, importação, gráficos e navegador podem rodar juntas:

```bash
BANCAFLOW_CHROMIUM=/caminho/do/chromium node --test tests/*.cjs
```

## Chat dos professores

O chat possui testes próprios da interface e regressões nos testes da aplicação e do navegador:

```bash
node --test tests/chat-ui.test.cjs tests/chat-notifications.test.cjs tests/chat-worker.test.cjs tests/app.test.cjs
BANCAFLOW_CHROMIUM=/caminho/do/chromium node --test --test-name-pattern=chat tests/browser.test.cjs
```

A aplicação verifica a sala geral de professores ativos e as salas de bancas restritas aos participantes e à coordenação. As regressões cobrem autoria canônica, horário do servidor, texto simples, mensagens vazias ou acima de 2.000 caracteres, falta de conexão, mudança de sala/sessão, duplo envio, falhas de gravação, preservação de novos rascunhos e paginação de 130 mensagens por horário e identificador. Uma regressão com 200 mensagens no mesmo horário confirma a ordenação de chaves do Firebase; outra impede que uma leitura atrasada de histórico restaure mensagens após a revogação de acesso. A presença registra a limpeza no desconectar, considera uma pessoa apenas uma vez mesmo com várias abas, ignora conexões antigas e limpa os dados da sessão anterior. Uma confirmação atrasada de presença também é removida sem afetar uma conexão nova.

Há regressões específicas para professores já cadastrados com perfil antigo, sem os campos `active` e `key`, e para o primeiro acesso de um professor criado pelo Alberson. Ambos usam mensagens e presença na sala geral sem participar de banca e sem cadastro adicional de permissões. O atalho do cabeçalho abre a sala geral mesmo quando havia uma sala privada selecionada. Após uma recusa de leitura, a aplicação repete a conexão automaticamente quando a autorização fica disponível; preserva o rascunho, não o envia sozinha e cancela tentativas da sessão encerrada. Professores desativados e sessões sem autenticação continuam bloqueados.

Uma falha apenas na presença durante a leitura de mensagens antigas também é reproduzida. A reconexão dos professores online mantém a assinatura saudável das mensagens e conclui a paginação em andamento. O botão para atualizar a conversa renova somente a leitura das mensagens e descarta resultados de uma paginação anterior sem reconectar a presença.

Os adaptadores também reproduzem a sequência real do Firebase: evento local otimista, confirmação ou rollback do servidor. A própria mensagem fica marcada como **Enviando** até a confirmação. Quando a gravação é recusada, ela sai da conversa, o texto permanece no campo e o erro continua visível junto ao formulário, inclusive após outras atualizações. O teste confere a nova tentativa sem duplicação, confirmação atrasada sem perder um novo rascunho, leitura atualizada do nome canônico e bloqueio de um professor desativado antes da gravação. Snapshots da janela recente removem registros locais desfeitos e conservam as páginas antigas já carregadas.

O teste de navegador abre duas abas como professores diferentes. Um adaptador de Firebase em memória compartilha somente os caminhos do chat por `BroadcastChannel`, permitindo conferir envio, recebimento e resposta em tempo real sem acesso a contas ou dados de produção. Verifica Enter para enviar e Shift + Enter para quebrar linha, escape de HTML, rascunho e cursor durante mensagens recebidas, erro de envio, reconexão sem envio automático, presença online, troca de sala, acesso do coordenador e ausência de acesso à banca por um professor de fora. As notas e entregas dos alunos são comparadas antes e depois da conversa.

Outro cenário cadastra uma professora pelo formulário do Alberson e abre sua primeira sessão em uma segunda aba. Ela conversa com um professor de perfil antigo, ambos sem banca. A primeira leitura do professor antigo é recusada; a autorização é liberada no adaptador e a conversa se recupera sem atualizar a página. O cenário confere a presença dos dois professores, as mensagens em ambas as direções, as larguras de 320, 390 e 1440 px e a preservação das notas, entregas, bancas e cronômetros. Capturas desse fluxo usam o nome `chat-all-teachers`.

O fluxo de entrega usa duas abas e adia a confirmação da gravação. Ele confere que o colega não recebe uma mensagem apenas local, que a recusa remove o item do remetente e mantém o erro, e que uma nova tentativa confirmada aparece uma única vez nas duas telas. Também exercita **Atualizar conversa**, **Últimas mensagens** e a preservação de outro rascunho enquanto a confirmação chega. Capturas usam os nomes `chat-rejected-send` e `chat-delivery-confirmed`.

O chat flutuante é aberto pelo botão fixo sem sair da avaliação. O cenário navega entre **Bancas**, **Avaliar** e **Início** com a conversa aberta, mantém a assinatura das mensagens e preserva a nota ainda não salva. Uma mensagem recebida atualiza a conversa sem substituir o campo de nota nem tirar seu foco. Minimizar e fechar conservam a sala e o rascunho; uma mensagem recebida enquanto minimizado atualiza o contador e aparece ao reabrir. O teste também confere o tamanho da janela em 320, 390 e 1440 px e a compatibilidade da tela completa, com um único formulário de conversa. Capturas usam o nome `chat-floating`.

A interface é conferida em 320, 390, 768 e 1440 px. Capturas do chat ficam em `BANCAFLOW_SCREENSHOT_DIR` ou `/tmp/bancaflow-chat-qa`. Outro cenário percorre o histórico e confere que uma falha de leitura do chat não bloqueia a avaliação da banca. A abertura do HTML sem alterações também valida os novos arquivos locais e os imports do SDK sob a política CSP.

Os testes modificam apenas dados fictícios locais. Não publicam o site, não atualizam regras no projeto real e não enviam mensagens para professores reais.

## Avisos de novas mensagens

O navegador simula a permissão de notificações, o registro do Service Worker e a exibição do aviso do sistema. Os cenários verificam que abrir o aplicativo, navegar e enviar mensagens não solicitam permissão automaticamente: a solicitação ocorre pelo botão de ativação. Uma mensagem de outro professor recebida fora da conversa mostra o aviso na página e a contagem de não lidas; clicar no aviso abre a sala correta. Com a permissão concedida e a aba em segundo plano, o teste registra a notificação enviada ao Service Worker. A mensagem do Service Worker abre a conversa indicada e respeita a identidade da conta que recebeu o aviso.

O botão **Silenciar** é exercitado sem bloquear o recebimento das mensagens. A preferência permanece após recarregar a página, é separada por conta neste dispositivo e pode ser desfeita pelo mesmo controle. Outro cenário recusa a permissão do navegador e confirma que os avisos na página e a conversa continuam funcionando. O teste dos helpers da aplicação confere que apenas a sala geral e as bancas autorizadas recebem assinaturas de alerta, inclusive fora da tela do chat, e que um professor desativado não pode reiniciá-las.

O HTML de produção também carrega o manifesto, o script do Service Worker e as imagens locais com seus tipos de conteúdo corretos. O teste confere escopo e endereço inicial relativos, modo de exibição instalado, ícones locais, decodificação real dos PNGs e tamanhos de 180, 192 e 512 px.

As verificações usam notificações simuladas e abas visíveis ou em segundo plano. Elas não enviam notificações reais a celulares nem validam recebimento com o aplicativo completamente fechado; esse fluxo depende de um serviço de push conectado ao projeto.

## Relatórios personalizados da coordenação

A área **Relatórios e médias** apresenta os arquivos de todos os alunos e o acesso aos cálculos personalizados antes das opções oficiais avançadas. O navegador verifica que o PDF completo pode ser baixado com os detalhes oficiais recolhidos. Filtros de data/curso/turma, consolidação oficial, gráficos oficiais e compartilhamento continuam cobertos depois de abrir essas opções.

O fluxo personalizado começa com curso, turma, resumo da média e os três formatos de arquivo. Os testes baixam PDF, CSV e gráficos com o modelo padrão sem abrir configurações. Depois abrem os pesos, filtros adicionais, conteúdo do PDF, notas individuais e gráficos, verificando que todos os recursos continuam disponíveis. Alterar as seções do PDF mantém a tabela de resultados visível na prévia. As capturas `reports-simple` mostram a tela inicial em 320, 390 e 1440 px.

As expansões de opções, o texto ainda não aplicado da busca, o modelo em edição e o foco/cursor de campos de texto são preservados durante navegação e atualizações do Firebase. Essas preferências da interface são limpas na troca de conta; os modelos salvos continuam isolados por coordenador.

Os cálculos, controles, preferências locais e PDF possuem suítes próprias:

```bash
node --test tests/weighted-model.test.cjs tests/weighted-report-ui.test.cjs tests/weighted-workbench.test.cjs tests/weighted-report-pdf.test.cjs
```

A integração da aplicação usa um modelo com banca de 75%, monografia de 25%, critérios de 50% / 25% / 25% / 0% e pesos relativos dos avaliadores de 3 e 1. O resultado da primeira aluna fica exatamente em 8,15625, exibido como 8,156 com três casas, enquanto seu resultado oficial permanece 7,80. Alterar a precisão muda apenas a exibição. Os testes conferem totais de 100%, notas zero, dados pendentes, conservação das notas salvas e dos cálculos oficiais, modelos separados por conta e importação/exportação JSON.

O navegador preenche os controles reais e mantém o modelo em edição durante mensagens do chat flutuante, snapshots do Firebase e navegação entre áreas. Confere gerar prévia, salvar, restaurar o padrão, selecionar um modelo salvo, importar JSON e apresentar erro para pesos inválidos. Os arquivos são emitidos depois da leitura atualizada dos sete conjuntos de dados; falta de conexão, notas ainda não salvas ou troca de sessão impedem a exportação. A seleção de uma aluna é respeitada no CSV e nos gráficos, com a precisão completa preservada.

O cenário salva `weighted-full.pdf`, com título personalizado, fórmula, observações, notas individuais e gráficos, além de `weighted-model.json`, `weighted-ana.csv` e `weighted-charts.pdf`. Capturas da área completa em 320, 390 e 1440 px usam o nome `weighted-report`. Os arquivos de QA ficam no diretório configurado, sem alterações nas avaliações ou nos relatórios oficiais.

## Coordenadores, bancas por Excel e alerta de tempo

Os testes verificam que todos os coordenadores ativos podem criar professores e outros coordenadores, usando uma conta secundária para preservar a sessão atual. O administrador usa o perfil compatível `role: "coordinator"`, com identificador `admin`, e recebe as mesmas permissões. São conferidos função inválida, vínculo a conta existente, reversão de cadastro incompleto, edição de contato, desabilitação e reativação sem excluir usuários, bancas ou notas. A própria conta e o acesso principal do Alberson permanecem protegidos. A revogação da permissão no catálogo remoto bloqueia a operação mesmo quando a tela ainda possui um perfil local antigo.

Coordenadores adicionais podem cadastrar grupos, importar a lista de alunos e criar bancas manualmente ou por uma planilha de agenda. As regressões usam uma planilha XLSX real e conferem a prévia, o cancelamento sem gravação, o modelo Excel, a confirmação, as reservas atômicas de professores e salas, a rejeição de conflito e de reimportação, a troca de sessão e a revogação de permissão durante a leitura. A importação de grupos permanece separada da importação de bancas agendadas; os dados anteriores são comparados antes e depois.

O cronômetro é verificado em `15:00,00` sem alerta e a partir de `15:00,01` com exibição e painel vermelhos. São testados a passagem do limite pelo relógio real, a pausa, o encerramento, a reabertura e o retorno à cor normal após zerar. A atualização do tempo não recria os formulários de avaliação. Capturas das bancas, da prévia Excel e do cronômetro ficam em `BANCAFLOW_SCREENSHOT_DIR` ou `/tmp/bancaflow-coordinators-qa`.

A suíte completa conserva os testes do chat entre duas abas, avaliações individuais, monografia, gráficos, PDFs e importação de grupos. Os cenários usam adaptadores e dados fictícios; não autenticam contas reais nem alteram o banco de produção.

O fluxo do Wagner promove o professor já cadastrado para coordenador no mesmo UID, após confirmação com nome e e-mail. Os testes comparam todas as bancas, critérios, entregas e cronômetros antes e depois, conferem cancelamento, usuário inativo, alteração concorrente e troca de sessão, e validam o acesso de gestão após a promoção. Nenhuma nova conta Auth é criada durante a promoção.

O navegador também confere o atalho **Preparar cadastro de administrador** com e-mail `admin@univap.br`, função de coordenador e senha inicialmente vazia. O cadastro não grava a senha no perfil nem publica uma senha fixa no HTML. Dados e credenciais dos cenários são fictícios. Coordenadores adicionais e o administrador emitem os PDFs de agenda, avaliações oficiais, análises, consolidado geral e modelos personalizados, mantendo os registros acadêmicos inalterados. Capturas em 320, 390 e 1440 px ficam no diretório de QA configurado ou em `/tmp/bancaflow-administration-qa`.

A atribuição de avaliadores em bancas existentes tem uma suíte pura própria (`node --test tests/board-assignment.test.cjs`) e cenários integrados. O diálogo preserva os autores com notas registradas, inclusive nota zero e professores desabilitados, e permite incluir ou retirar um terceiro avaliador sem notas. Os testes conferem reservas de horário atômicas e a liberação imediata das reservas locais e remotas, conflitos, leitura recente das notas, catálogo alterado em outra janela, banca encerrada, grupo arquivado, sessão revogada e rascunhos pendentes. Apenas a composição e suas reservas mudam; agenda, alunos, critérios, entregas e cronômetro são comparados antes e depois. Desabilitar um professor não apaga sua participação nem suas avaliações anteriores.

## Anos letivos, contas e cópia de segurança

Os módulos de anos letivos, segurança da conta, página de confirmação e serviço de mensagens têm testes sem dependências externas:

```bash
node --test tests/academic-years.test.cjs tests/account-security.test.cjs tests/account-action.test.cjs tests/account-backend.test.cjs
```

As regressões conferem inferência compatível do ano de registros antigos, limites de calendário em São Paulo, filtros sem regravar dados, mensagens personalizadas, confirmação antes de mudar senha/e-mail, reautenticação, proteção contra respostas atrasadas e falhas de envio. O serviço SMS é testado com telefone previamente verificado, códigos de uso único, expiração, limite de tentativas, intervalo de reenvio e armazenamento protegido. Nenhum e-mail ou SMS real é enviado.

`app.test.cjs` e `browser.test.cjs` cobrem a integração: troca de ano sem perder rascunhos, permanência do histórico, conta no celular e exportação da cópia acadêmica em JSON. O backup tem versão de formato, inclui todos os anos e preserva notas e bancas; exclui credenciais, contatos privados e segredos de recuperação. Somente coordenadores podem exportá-lo. Os testes também mantêm as verificações anteriores de chat, cronômetro, relatórios e PDFs.

Com as dependências de emulador descritas abaixo, a validação nativa de Auth e banco pode ser executada junto das regras e do chat:

```bash
npx firebase emulators:exec --project demo-banca-flow-account --only auth,database --config tests/firebase-account.json "node --test --test-force-exit tests/account-auth-sdk.test.mjs tests/rules.test.mjs tests/chat-sdk.test.mjs"
```

O cenário usa Auth em `127.0.0.1:9099` e banco em `127.0.0.1:9000`, com identidades fictícias e regras carregadas por namespace. Os códigos são lidos pela API local do emulador. São verificadas a recuperação nativa de senha, a troca de e-mail somente após confirmação, a preservação do UID e dos registros acadêmicos e a sincronização do e-mail pelo token verificado, inclusive para Alberson. Códigos inválidos ou já utilizados são recusados. `--test-force-exit` encerra os temporizadores internos do SDK após os testes.

O Auth Emulator 14.22 não modela o prazo de expiração dos links de e-mail. A resposta a links expirados é testada com adaptadores em `account-action.test.cjs`; a expiração dos códigos SMS do servidor é exercitada separadamente em `account-backend.test.cjs`. Essa suíte não comprova entrega por provedores reais nem publica configurações em produção.

## Regras do Firebase

Requer Node.js 20 ou 22 e Java 17 ou posterior. O Firebase CLI 14.22.0 permite usar Java 17. Na raiz do repositório:

```bash
npm install --no-save --package-lock=false firebase-tools@14.22.0 firebase@12.19.0 @firebase/rules-unit-testing@5.0.0
npx firebase emulators:exec --project demo-banca-flow --only database --config tests/firebase.json "node --test tests/rules.test.mjs tests/chat-sdk.test.mjs"
```

O primeiro uso baixa o emulador. Nenhum login no Firebase é necessário. As dependências também podem ser instaladas fora do repositório com `npm install --prefix DIRETORIO ...`. Nesse caso, defina `BANCAFLOW_RULES_DEPS` com o caminho absoluto desse diretório e use o executável Firebase instalado nele. Para conectar a um emulador já iniciado, defina `FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000`.

A suíte carrega a política atualizada incorporada ao `index.html` e confirma sua correspondência com `database.rules.json`. Verifica a leitura restrita das notas individuais, exclusividade da coordenação nas entregas, encerramento/reabertura por membros ativos da banca e coordenador, cronômetro compartilhado com validação de revisão e rejeição atômica de gravações antigas. As permissões das demais coleções existentes são verificadas para evitar alterações não relacionadas. Os testes não publicam regras nem alteram dados no projeto real. O projeto `demo-banca-flow` e o endereço explícito do emulador mantêm essas verificações locais.

As regras também são exercitadas com um perfil antigo contendo apenas nome e função de professor e com um professor criado por uma gravação autorizada do Alberson. A sala geral e a presença ficam acessíveis imediatamente, sem alterar o perfil nem atribuir uma banca. A sala privada da banca e as notas dos avaliadores continuam protegidas; professores desativados, usuários autenticados sem perfil e conexões anônimas são recusados.

`chat-sdk.test.mjs` executa a fonte da aplicação com o Firebase SDK real contra o emulador, em namespaces fictícios isolados. Confere mensagens nos dois sentidos entre professores sem banca, chaves geradas por `push`, `serverTimestamp` resolvido e dados de avaliação preservados. Outro cenário permite presença e leitura, mas nega a gravação das mensagens: o SDK emite seu evento otimista real, o servidor recusa, o item pendente é removido e o colega não o recebe. Depois da liberação local das regras, uma tentativa manual grava e entrega exatamente uma mensagem. Essa suíte cobre o comportamento de confirmação do SDK além dos adaptadores em memória; nenhum projeto de produção é acessado.
