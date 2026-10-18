# Verificações locais

Os testes usam dados fictícios. Eles não autenticam usuários reais nem leem ou gravam dados de produção.

## Lógica da aplicação

Requer apenas Node.js atual; não precisa instalar pacotes:

```bash
node --test tests/app.test.cjs
```

A suíte executa o JavaScript do próprio `index.html` com adaptadores de DOM, armazenamento local e Firebase em memória. Verifica notas individuais e médias ponderadas, nota zero, dados incompletos, cronômetro local com centésimos e funcionamento offline, persistência após recarregar, separação entre contas, importação/exportação e registro manual de tempo, confirmação/cancelamento, tratamento de permissões negadas sem simular encerramento/reabertura, preservação de rascunhos, atualização consistente do relatório e o PDF nativo. O cronômetro não usa nenhum caminho no Firebase.

## Navegador real

Instale Playwright em um ambiente de desenvolvimento e indique um executável Chromium existente:

```bash
BANCAFLOW_CHROMIUM=/caminho/do/chromium node --test tests/browser.test.cjs
```

Sem Playwright ou sem essa variável, os testes de navegador aparecem como ignorados. Eles executam a página real com Firebase em memória, armazenamento local real e requisições interceptadas localmente. Verificam larguras de 320 a 1440 px, incluindo o formulário de tempo da coordenação, os eventos reais de formulário e botões, recarregamento do cronômetro e separação entre contas, download/importação do registro de tempo, permissão das entregas e download efetivo do PDF com notas e centésimos. Também verificam a negação de encerramento por professor e de reabertura pelas permissões originais, a reversão de alterações otimistas do Firebase sem pausar o tempo, rascunhos durante atualizações, recebimento inicial das notas, confirmação de salvamento e troca de conta.

Para usar um pacote Chromium de servidor, `BANCAFLOW_CHROMIUM_MODULE` pode apontar para o módulo que exporta `default.args`. `FONTCONFIG_PATH` pode indicar o diretório de fontes desse pacote. Para salvar capturas da página real em 390 e 1440 px, defina `BANCAFLOW_SCREENSHOT_DIR`.

As duas suítes podem rodar juntas:

```bash
BANCAFLOW_CHROMIUM=/caminho/do/chromium node --test tests/app.test.cjs tests/browser.test.cjs
```

## Regras do Firebase

Requer Node.js 20 ou 22 e Java 17 ou posterior. O Firebase CLI 14.22.0 permite usar Java 17. Na raiz do repositório:

```bash
npm install --no-save --package-lock=false firebase-tools@14.22.0 firebase @firebase/rules-unit-testing
npx firebase emulators:exec --project demo-banca-flow --only database --config tests/firebase.json "node --test tests/rules.test.mjs"
```

O primeiro uso baixa o emulador. Nenhum login no Firebase é necessário. As dependências também podem ser instaladas fora do repositório com `npm install --prefix DIRETORIO ...`. Nesse caso, defina `BANCAFLOW_RULES_DEPS` com o caminho absoluto desse diretório e use o executável Firebase instalado nele. Para conectar a um emulador já iniciado, defina `FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000`.

A suíte confirma a identidade exata das regras originais incorporadas aos dois arquivos HTML e executa a política original do `index.html` no emulador. Verifica a leitura restrita de notas, exclusividade da coordenação nas entregas, encerramento permitido à coordenação, encerramento negado aos professores, reabertura negada inclusive à coordenação, rejeição de novos caminhos de cronômetro e preservação dos dados em gravações rejeitadas. Os testes não publicam nem alteram regras no projeto real. O projeto `demo-banca-flow` e o endereço explícito do emulador mantêm essas verificações locais.
