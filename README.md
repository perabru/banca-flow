# BancaFlow — Avaliação de TCC Univap

[Abrir BancaFlow no GitHub Pages](https://perabru.github.io/banca-flow/)

Aplicação estática em HTML, CSS e JavaScript, conectada ao projeto Firebase existente `avaliadortcc`. A atualização preserva os cadastros, grupos, alunos, agenda, notas, entregas, configuração Firebase e lista criptografada de grupos. Não faz migração destrutiva nem importação automática.

`index.html` e `BancaFlow_TCC_2026_Unico.html` oferecem a mesma versão, incluindo a mesma política de acesso atualizada. O layout começa em 320 px e se adapta a tablets e computadores. O site continua sem etapa de compilação. A importação de Excel usa arquivos locais em `assets/`, que devem ser publicados junto dos HTMLs. `privacidade.html` identifica o sistema, os responsáveis e o tratamento dos dados.

## Ativar a atualização

1. No Console do Firebase, abra **avaliadortcc → Realtime Database → Regras** e publique o conteúdo completo de **database.rules.json**. A mesma política fica incorporada aos HTMLs e disponível no botão **Copiar política de acesso**.
2. Integre o pull request ou publique os dois HTMLs na hospedagem existente, usando HTTPS. Atualize a página e entre novamente; os demais professores também devem atualizar o site.
3. Mantenha os perfis já cadastrados em `users` e os dados existentes. Não reimporte os grupos nem substitua o conteúdo do banco.

O arquivo `firebase.json` também permite publicar somente as regras com `firebase deploy --only database --project avaliadortcc`, após autenticar uma conta autorizada.

Publicar arquivos no GitHub não publica as regras no Firebase. A política atualizada é necessária para o cronômetro compartilhado, o encerramento/reabertura pelos avaliadores, a edição de contatos e a gestão de grupos e cursos. Se você publicou uma versão anterior das regras, publique novamente o arquivo desta versão. As regras preservam a privacidade e os demais caminhos originais; não existe acesso público ao banco nem cadastro público de coordenadores.

## Permissões e bancas

| Ação | Avaliador da banca | Coordenador |
| --- | --- | --- |
| Lançar suas próprias notas com banca aberta | Sim | Sim, quando participa como avaliador |
| Consultar notas dos demais avaliadores | Não | Sim |
| Encerrar e reabrir com confirmação | Sim | Sim, em qualquer banca |
| Controlar o cronômetro compartilhado | Sim | Sim |
| Consultar e lançar entregas | Não | Sim |
| Emitir/compartilhar resultado oficial completo | Não | Sim |
| Compartilhar sua própria avaliação parcial | Sim | Usa o resultado oficial, após a finalização |

Somente professores ativos que participam da banca podem controlar essa banca. O coordenador pode agir mesmo sem ser um avaliador dela. Encerrar bloqueia as notas e pausa o cronômetro. Reabrir preserva todas as avaliações e permite correções; o tempo fica pausado até clicar em **Continuar**. O coordenador pode reabrir para lançar ou corrigir entregas e encerrar novamente depois.

O encerramento pode ocorrer antes de todos os lançamentos. O relatório e o resultado oficial só ficam disponíveis com a banca encerrada e todas as notas completas, incluindo as entregas. Campos em edição devem ser salvos antes do encerramento. Rascunhos são preservados durante atualizações da tela e salvamentos pendentes; a troca de conta limpa os campos e qualquer prévia de compartilhamento da sessão anterior.

## Todas as notas — coordenação

O Alberson pode consultar **Todas as notas** pelo menu lateral, pelo atalho da visão geral ou por **Mais → Todas as notas** no celular. A consulta inclui todas as bancas, abertas ou encerradas, com notas completas ou pendentes, inclusive o histórico de grupos removidos. Há filtros independentes por curso, turma, data e situação, além da busca por grupo, aluno ou professor. **Expandir todas** mostra os detalhes das bancas selecionadas.

Cada aluno tem suas notas separadas por avaliador e critério, média do avaliador, média da banca, entregas e parcelas de 60%/40%. Uma nota ausente aparece como **Pendente**; zero continua sendo uma nota válida. A média da banca é exibida quando todos os avaliadores concluíram os quatro critérios, mesmo sem entregas. A nota final só é calculada com todas as notas necessárias e fica identificada como provisória enquanto a banca estiver aberta.

O mesmo detalhamento fica disponível em **Bancas → Ver detalhes** e **Relatórios → Consultar notas**, mesmo quando o coordenador não participa da banca. Essa consulta é somente leitura: cada professor continua responsável pelas próprias notas, e as entregas permanecem exclusivas da coordenação. Os valores acompanham os lançamentos salvos no Firebase. Não há alteração nos dados, nas regras ou nas exigências dos PDFs oficiais.

## Filtrar bancas por data

Em **Bancas**, selecione **Data da banca** para ver os grupos daquele dia, combinando o filtro com curso e turma. **Hoje** escolhe o dia atual e **Todas as datas** limpa somente a data. Os professores continuam vendo apenas as bancas às quais estão atribuídos. O PDF da agenda inclui exatamente os resultados dessa seleção.

Em **Relatórios**, a data também restringe a lista, o PDF consolidado e o CSV de bancas concluídas. Com uma data escolhida, grupos sem agendamento não pertencem à seleção daquele dia; todas as bancas selecionadas ainda precisam estar encerradas e com notas completas para o PDF consolidado. Sem data, a verificação de conclusão de todos os grupos do curso/turma permanece.

O filtro considera o dia no fuso do dispositivo, o mesmo utilizado na apresentação da agenda. Ele é limpo ao trocar de conta. A atualização não altera dados nem exige novas regras no Firebase.

## Cronômetro com centésimos

O tempo aparece em **minutos:segundos,centésimos**, por exemplo `12:34,56`. Ele é compartilhado entre os avaliadores e a coordenação pelo Firebase e continua contando após trocar de tela ou recarregar a página. Apenas os controles de iniciar, pausar, continuar e zerar gravam no banco; os centésimos são calculados na tela usando o relógio ajustado ao servidor.

Os controles exigem conexão. Durante uma interrupção, o tempo já iniciado continua sendo contado; ao reconectar, o site recebe o registro compartilhado. Zerar pede confirmação. Encerramento e pausa são gravados juntos; revisões impedem que uma ação antiga sobrescreva um controle mais recente.

Os caminhos originais conservam seus formatos. A coleção nova `timers/BANCA` contém `elapsedMs`, `startedAt` (zero quando pausado), `updatedAt`, `updatedBy` e `revision`. Registros antigos sem tempo continuam válidos e aparecem no relatório como **Não registrado**.

## PDF, notas e cálculo

O relatório PDF baixa diretamente e contém os dados da banca, o tempo com centésimos, cada aluno, as quatro notas de cada professor, a média de cada avaliador, a média da banca, a nota bruta das entregas, as parcelas ponderadas e a nota final.

- Média do avaliador: média aritmética de Apresentação, Parte prática, Domínio do código e Domínio do tempo.
- Média da banca: média aritmética das médias dos avaliadores.
- Nota final: **média da banca × 0,60 + entregas × 0,40**.
- O cálculo usa os valores completos; a exibição usa duas casas decimais. Zero é uma nota válida; campos ausentes mantêm o resultado oficial pendente.

O PDF da agenda e o sorteio continuam disponíveis. O CSV de avaliação também contém o tempo registrado.

## Gráficos da coordenação

Em **Relatórios**, o painel **Análise dos resultados** acompanha os filtros de data, curso e turma. Ele inclui apenas bancas encerradas com todas as notas completas e mostra:

- Médias da banca, entregas e nota final por grupo, na escala fixa de 0 a 10.
- Tempo de apresentação com centésimos comparado ao intervalo reservado na agenda. Esse intervalo inclui o horário completo da banca, podendo conter arguição e transição; não é uma meta de tempo de fala.
- Composição da nota final de cada aluno, separando banca × 60% e entregas × 40%.
- Ao escolher uma banca em **Banca analisada**, comparação dos alunos e notas individuais de cada professor nos quatro critérios.

Os valores exatos também ficam disponíveis em tabelas expansíveis. A média geral considera cada aluno uma vez, sem fazer uma média das médias dos grupos. O tempo médio considera cada banca com cronômetro uma vez; um registro zerado é válido, e ausência de tempo aparece como **Não registrado**.

**Incluir gráficos nos relatórios PDF** vem marcado e acrescenta a análise aos relatórios individuais, ao consolidado e aos PDFs oficiais preparados para compartilhar. Desmarque para emitir apenas as tabelas. O botão **Baixar PDF dos gráficos** gera um documento analítico da seleção atual: visão geral e detalhes das bancas completas do filtro, ou somente da banca escolhida. Os dados são conferidos novamente no Firebase antes do download; o documento não inclui bancas abertas ou notas pendentes. O consolidado oficial mantém sua exigência de conclusão de todos os grupos selecionados.

O PDF oficial de compartilhamento inclui gráficos apenas dos alunos selecionados na prévia. PDFs parciais de professores preservam o acesso exclusivo às próprias notas. Os gráficos são vetoriais nos PDFs, com texto selecionável e paginação para listas e nomes extensos.

Esta melhoria não altera dados nem regras do Firebase. Publique também `assets/analytics.js`, `assets/analytics-pdf.js` e `assets/analytics.css`, junto dos HTMLs. Não é necessário instalar bibliotecas de gráficos ou usar serviços externos.

## Compartilhar no WhatsApp

### Resultado oficial da coordenação

Em **Relatórios → WhatsApp / compartilhar** ou **Bancas → Ver detalhes → Compartilhar resultado**, prepare a prévia de uma banca encerrada e completa. O seletor permite incluir todos os alunos ou somente um. O PDF e a mensagem usam exatamente a mesma seleção e incluem as notas por professor, médias e nota final ponderada.

### Avaliação de um professor

Na avaliação, use **Compartilhar minhas avaliações** para o grupo ou **Compartilhar avaliação deste aluno**. A prévia contém somente as notas salvas desse professor e a média de seus quatro critérios, identificadas como **parciais**, sem nota final, entregas ou avaliações de outros professores. Um aluno já avaliado pode ser compartilhado mesmo se os demais ainda estiverem pendentes.

### Escolher o envio

1. **Compartilhar PDF (escolha WhatsApp):** em aparelho/navegador compatível, abre o compartilhamento do sistema com arquivo PDF e texto. Escolha WhatsApp e o contato ou grupo. Se o WhatsApp não incluir o texto junto do arquivo, envie as notas pelo botão de texto.
2. **Abrir notas no WhatsApp:** abre o WhatsApp com o texto preparado. Você escolhe o destinatário e confirma o envio. O link de texto não anexa arquivos.
3. **Baixar PDF para anexar:** alternativa para computadores ou navegadores sem compartilhamento de arquivos. Abra a conversa e anexe o PDF como documento.
4. **Copiar notas individuais:** copia o texto completo. Se o navegador bloquear a cópia, a prévia é selecionada para copiar manualmente. Mensagens extensas também podem ser copiadas e coladas, sem cortar notas; é possível escolher um aluno por vez.

Nada é enviado automaticamente. A prévia é preparada antes do clique que abre o compartilhamento, para manter a ativação exigida pelo navegador. Se notas, tempo, sessão ou estado da banca mudarem, prepare uma nova prévia antes de compartilhar. O site não guarda números de telefone nem pede acesso aos contatos.

Compatibilidade: [Web Share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share), [canShare](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/canShare) e [WhatsApp click to chat](https://faq.whatsapp.com/425247423114725/).


## Professores: administração do Alberson

Em **Professores**, o coordenador com perfil `role: "coordinator"` e `key: "alberson"` pode criar uma conta de professor ou vincular um UID existente, editar nome/e-mail de contato, remover e reativar acessos. A sessão do Alberson permanece aberta durante o cadastro. O acesso da coordenação não pode ser removido ou promovido por essa tela.

O **e-mail de contato** pode ser alterado sem afetar o login. O e-mail de acesso e o identificador nas planilhas permanecem vinculados à conta existente; a alteração de login é administrada no Firebase Authentication. Os nomes já registrados nas bancas não são reescritos ao editar o professor. A remoção bloqueia o acesso ao aplicativo, conserva o perfil e as avaliações e exige concluir as bancas em aberto.

## Grupos, cursos e planilhas

Em **Grupos e cursos**, o Alberson pode:

- Cadastrar um grupo com curso, turma, título, orientador ativo e de 1 a 20 alunos.
- Editar grupos antes de agendar uma banca, preservando os identificadores dos alunos.
- Remover e restaurar grupos. A remoção é um arquivamento: o grupo sai de novos agendamentos, mas os alunos, notas, bancas e relatórios permanecem. Bancas em aberto precisam ser encerradas primeiro.
- Buscar grupos ou alunos e filtrar por curso e turma. A agenda, o sorteio e os relatórios também oferecem seleção de curso.
- Importar arquivos `.xlsx`, `.xls` e `.csv` (UTF-8), selecionar a aba e conferir a prévia antes de confirmar. Nenhum dado é gravado enquanto houver erros.

Os dados acadêmicos do grupo ficam protegidos após o agendamento, para que alterações de alunos ou orientador não invalidem avaliações existentes. Para corrigir notas de uma banca de um grupo removido, restaure o grupo e depois reabra a banca.

### Formato da planilha

Use as colunas **Curso, Turma, Grupo, Título, Orientador, Aluno**, uma linha por aluno, repetindo os dados do grupo. Também são aceitas colunas **Aluno 1, Aluno 2…** na mesma linha. Se não houver coluna Curso, informe-o no campo da importação. O botão **Baixar modelo CSV** gera um modelo fictício para abrir no Excel.

Em Orientador, use o e-mail, o identificador, o UID ou o nome completo de um professor ativo. Nomes ambíguos são recusados; use um identificador exclusivo. Grupos repetidos são identificados por curso, turma e nome, inclusive os removidos, e não são sobrescritos. O sistema informa conflitos de título/orientador e nomes repetidos de alunos. Fórmulas são recusadas; use valores.

Limites: 5 MB, 10.000 linhas, 200 colunas, 1.000 grupos por arquivo e 20 alunos por grupo. O arquivo original é lido no navegador e não é enviado para um conversor. Somente os novos registros confirmados são enviados, em uma atualização atômica. Uma conferência recente detecta alterações desde a prévia e exige confirmação renovada. Evite operar o mesmo cadastro simultaneamente em duas abas: sem um índice global no servidor, a checagem de nomes/chaves entre novas criações simultâneas não é uma restrição de unicidade absoluta.

Os grupos antigos, sem `courseName` ou `active`, continuam válidos e ativos. Não há migração automática. `active: false` identifica grupos removidos; campos de criação, edição e remoção guardam o responsável e a data. Os caminhos de notas, entregas e cronômetros são preservados.

## Segurança do endereço

O login apresenta BancaFlow, responsáveis, finalidade e o uso de conta própria. [Sobre e privacidade](privacidade.html) explica a hospedagem e os dados. A versão utiliza HTTPS, Referrer Policy e uma Content Security Policy com hash do código embutido. Não há anúncios, solicitação de senha de outro portal ou envio automático de resultados.

HTTPS não remove uma classificação externa de phishing. O diagnóstico e os passos oficiais de revisão estão em [SECURITY.md](SECURITY.md). A consulta pública de 18/10/2026 confirmou uma classificação do Google como inseguro, com indicador de engenharia social. Isso não demonstra a causa específica nem comprova phishing na versão atual; a retirada continua dependendo de revisão pelo fornecedor. Não foi declarada a remoção do alerta. O responsável deve consultar o Search Console e, se houver classificação incorreta, solicitar revisão pelo canal oficial.

Depois de editar o código embutido ou as regras, execute `node scripts/sync-html.cjs` para atualizar os hashes CSP e o segundo HTML. Publique também `assets/`, `privacidade.html`, os HTMLs e os demais arquivos do repositório.

## Verificação local

Sirva os HTMLs por HTTPS ou um servidor local. Os testes usam dados fictícios, um adaptador Firebase em memória ou o emulador local, sem acessar o banco de produção e sem enviar mensagens reais:

```bash
node --test tests/app.test.cjs
```

As instruções para navegador e emulador estão em `tests/README.md`.
