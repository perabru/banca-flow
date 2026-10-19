# Verificações locais

Os testes usam dados fictícios. Eles não autenticam usuários reais nem leem ou gravam dados de produção.

## Lógica da aplicação

Requer apenas Node.js atual; não precisa instalar pacotes:

```bash
node --test tests/app.test.cjs
```

A suíte executa o JavaScript do próprio `index.html` com adaptadores de DOM e Firebase em memória. Verifica notas individuais e médias ponderadas, nota zero, dados incompletos, cronômetro compartilhado com centésimos, repetição de transações, confirmação/cancelamento, encerramento/reabertura por avaliadores e coordenação, exclusividade das entregas, preservação de rascunhos, atualização consistente do relatório e PDF nativo. Também verifica snapshots oficiais e parciais, filtro por aluno, privacidade das notas de outros professores, bloqueio de prévias desatualizadas e mudança de sessão durante operações assíncronas.

A gestão de professores e grupos também é verificada: exclusividade do Alberson, conta secundária durante o cadastro, reversão de criação incompleta, dados imutáveis de login, edição de contato, concorrência, remoção e restauração sem apagar histórico, identidade dos alunos, proteção após agendamento e confirmação da importação.

A consulta **Todas as notas** é verificada separadamente dos relatórios finais: Alberson consulta todas as bancas, inclusive abertas, incompletas e de grupos arquivados, com notas por aluno, professor e critério. A suíte cobre notas zero, médias incompletas, entregas pendentes, cálculo de 60%/40%, identificação de resultados provisórios, professores desativados no histórico, filtros independentes da agenda e dos PDFs, busca, escape do conteúdo salvo e bloqueio de acesso pelo professor ou sem sessão. A consulta não grava nem altera notas.

A coordenação também é testada como avaliadora: **Minhas avaliações** considera somente bancas em que o usuário autenticado é membro ativo, mantém a escolha de uma banca atribuída e apresenta os próprios formulários antes da consulta geral. As regressões salvam notas zero e decimais no UID do Alberson, verificam os colegas e as entregas sem alterações, bloqueiam a edição após encerramento e permitem retomá-la após reabertura. O acesso a bancas sem participação permanece somente para consulta.

O parser local do Excel tem uma suíte própria, sem dependências adicionais:

```bash
node --test tests/import.test.cjs
```

Ela lê arquivos XLSX, XLS e CSV reais com a biblioteca local, verifica cabeçalhos e orientadores, agrupamento e identidades estáveis, importações repetidas, cursos distintos, fórmulas e limites de arquivo.

## Gráficos e PDFs analíticos

As duas suítes dos gráficos também usam apenas Node.js e os arquivos locais:

```bash
node --test tests/analytics.test.cjs tests/analytics-pdf.test.cjs
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

A consulta de notas também passa pela navegação real de desktop e pelo menu “Mais” no celular. São verificados os filtros por curso, turma, data e situação, a busca, a limpeza da seleção, as médias atualizadas após um snapshot do Firebase e a preservação das bancas expandidas. Os detalhes da banca exibem todas as notas ao coordenador mesmo quando ele não é avaliador, sem abrir campos para editar a nota de outro professor. A troca de sessão remove o acesso e limpa as expansões. A tela é conferida de 320 a 1440 px; capturas são salvas quando `BANCAFLOW_SCREENSHOT_DIR` estiver definido.

O fluxo real do Alberson percorre **Minhas avaliações** no desktop e **Avaliar** diretamente na navegação do celular, salva critérios no próprio UID e confere a atualização da tabela de consulta. Verifica o bloqueio e a reabertura, os atalhos de notas/bancas/relatórios, a preservação das entregas e dos demais avaliadores e sua seleção como avaliador na criação de outra banca. A tela de lançamento é conferida em 320, 390 e 1440 px.

O compartilhamento é verificado com `navigator.share`, clipboard e links do WhatsApp interceptados: arquivo PDF real, notas individuais, ativação por clique, cancelamento sem envio automático, alternativa de download/texto, escolha de um aluno, privacidade do relatório parcial e bloqueio de dados desatualizados. Os testes não abrem conversas reais nem enviam mensagens.

Os fluxos de administração cobrem cadastro, edição e reativação de professor, criação e arquivamento de grupo e carregamento de um arquivo Excel real com prévia, cancelamento, confirmação e preservação do catálogo na reimportação. O HTML de produção também é aberto sem alterações, com módulos Firebase simulados, para conferir os hashes da política CSP, os recursos locais e o formulário de acesso. Os demais cenários usam o mesmo CSP com o hash recalculado apenas para o módulo de teste.

Para usar um pacote Chromium de servidor, `BANCAFLOW_CHROMIUM_MODULE` pode apontar para o módulo que exporta `default.args`. `FONTCONFIG_PATH` pode indicar o diretório de fontes desse pacote. Para salvar capturas da página real, inclusive dos gráficos em 320, 390 e 1440 px, defina `BANCAFLOW_SCREENSHOT_DIR`. Para guardar os PDFs reais gerados nos testes de gráficos, defina também `BANCAFLOW_QA_DIR` com o diretório de destino. As capturas isoladas dos gráficos ocultam temporariamente a navegação fixa durante a captura, sem modificar o aplicativo.

As suítes da aplicação, importação, gráficos e navegador podem rodar juntas:

```bash
BANCAFLOW_CHROMIUM=/caminho/do/chromium node --test tests/app.test.cjs tests/import.test.cjs tests/analytics.test.cjs tests/analytics-pdf.test.cjs tests/browser.test.cjs
```

## Regras do Firebase

Requer Node.js 20 ou 22 e Java 17 ou posterior. O Firebase CLI 14.22.0 permite usar Java 17. Na raiz do repositório:

```bash
npm install --no-save --package-lock=false firebase-tools@14.22.0 firebase @firebase/rules-unit-testing
npx firebase emulators:exec --project demo-banca-flow --only database --config tests/firebase.json "node --test tests/rules.test.mjs"
```

O primeiro uso baixa o emulador. Nenhum login no Firebase é necessário. As dependências também podem ser instaladas fora do repositório com `npm install --prefix DIRETORIO ...`. Nesse caso, defina `BANCAFLOW_RULES_DEPS` com o caminho absoluto desse diretório e use o executável Firebase instalado nele. Para conectar a um emulador já iniciado, defina `FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000`.

A suíte carrega a política atualizada incorporada ao `index.html` e confirma sua correspondência com `database.rules.json`. Verifica a leitura restrita das notas individuais, exclusividade da coordenação nas entregas, encerramento/reabertura por membros ativos da banca e coordenador, cronômetro compartilhado com validação de revisão e rejeição atômica de gravações antigas. As permissões das demais coleções existentes são verificadas para evitar alterações não relacionadas. Os testes não publicam regras nem alteram dados no projeto real. O projeto `demo-banca-flow` e o endereço explícito do emulador mantêm essas verificações locais.
