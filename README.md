# BancaFlow — Avaliação de TCC Univap

[Abrir BancaFlow no GitHub Pages](https://perabru.github.io/banca-flow/)

Aplicação estática em HTML, CSS e JavaScript, conectada ao projeto Firebase existente `avaliadortcc`. A atualização preserva os cadastros, grupos, alunos, agenda, notas, entregas, configuração Firebase e lista criptografada de grupos. Não faz migração destrutiva nem importação automática.

`index.html` e `BancaFlow_TCC_2026_Unico.html` oferecem a mesma versão, incluindo a mesma política de acesso atualizada. O segundo nome é mantido por compatibilidade com links antigos: o sistema aceita vários anos letivos. O layout começa em 320 px e se adapta a tablets e computadores. O site continua sem etapa de compilação. A importação de Excel usa arquivos locais em `assets/`, que devem ser publicados junto dos HTMLs. `privacidade.html` identifica o sistema, os responsáveis e o tratamento dos dados.

## Ativar a atualização

1. No Console do Firebase, abra **avaliadortcc → Realtime Database → Regras** e publique o conteúdo completo de **database.rules.json**. A mesma política fica incorporada aos HTMLs e disponível no botão **Copiar política de acesso**.
2. Integre o pull request ou publique os dois HTMLs na hospedagem existente, usando HTTPS. Atualize a página e entre novamente; os demais professores também devem atualizar o site.
3. Mantenha os perfis já cadastrados em `users` e os dados existentes. Não reimporte os grupos nem substitua o conteúdo do banco.

O arquivo `firebase.json` também permite publicar somente as regras com `firebase deploy --only database --project avaliadortcc`, após autenticar uma conta autorizada.

Publicar arquivos no GitHub não publica as regras no Firebase. A política atualizada é necessária para o cronômetro compartilhado, o encerramento/reabertura pelos avaliadores, a edição de contatos, a gestão de grupos e cursos, o ano letivo dos grupos, a sincronização do próprio e-mail já verificado e a edição/exclusão de mensagens próprias no chat. Se você publicou uma versão anterior das regras, publique novamente o arquivo desta versão. As regras preservam a privacidade e os demais caminhos originais; não existe acesso público ao banco nem cadastro público de coordenadores.

## Anos letivos e histórico

O seletor **Ano letivo** começa em **Todos os anos**, para manter todo o acervo visível. Escolha um ano para consultar a agenda, os grupos, as notas e os relatórios desse período. Volte a **Todos os anos** para consultar o histórico completo. Equipe, contas e permissões permanecem compartilhadas; o filtro não remove professores nem encerra bancas.

Novos grupos recebem o campo `academicYear`, informado no cadastro ou na importação. O ano atual é sugerido quando o filtro está em **Todos os anos**; o ano selecionado é sugerido quando há um período específico. Confira o campo antes de confirmar. Grupos de anos diferentes podem repetir o nome, curso e turma, mantendo identificadores próprios. Cadastre os novos alunos como novos grupos, sem reaproveitar um grupo histórico já avaliado.

Grupos antigos continuam nos mesmos caminhos, sem migração: o ano é identificado pela data da banca, depois pela data de criação válida; registros sem essas informações permanecem em 2026, ano de origem do acervo. Uma marcação explícita de ano letivo tem prioridade sobre a data da apresentação. Os relatórios incluem a identificação do período.

Em **Visão geral → Histórico e cópia de segurança → Baixar cópia acadêmica**, a coordenação pode baixar um JSON de todos os anos, mesmo com um ano filtrado. O arquivo inclui os cadastros e dados acadêmicos salvos, com `schemaVersion: 1`; não contém senhas de acesso, chat ou segredos de envio. As leituras dos caminhos são feitas separadamente, portanto a cópia não representa uma única transação instantânea. Guarde-a com acesso restrito e mantenha também as cópias institucionais do Firebase. A aplicação não restaura nem sobrescreve o banco automaticamente a partir desse arquivo.

O [guia de operação contínua](OPERACAO_CONTINUA.md) descreve a abertura de cada ano, as cópias e a manutenção do sistema.

## Minha conta, senha e e-mail

Na entrada, **Esqueci minha senha** abre a recuperação de acesso. Depois de entrar, **Minha conta**, no cabeçalho ou no menu do celular, reúne a redefinição de senha, a troca de e-mail e o cadastro de celular para recuperação. As mensagens da interface usam o nome do professor quando ele está autenticado.

- **Senha por e-mail:** o envio nativo do Firebase continua disponível quando o serviço personalizado está desligado. A resposta não revela se um endereço está cadastrado. O link permite escolher uma nova senha conforme a política de segurança do projeto.
- **Troca de e-mail:** confirme a senha atual e informe o novo endereço. O login antigo continua válido até confirmar a mensagem recebida no novo e-mail. Use **Já confirmei o e-mail** ou entre novamente para atualizar os dados. O mesmo UID conserva as bancas, avaliações, função e histórico.
- **SMS:** exige ativação do serviço de envio e um celular previamente confirmado por código na própria conta. Apenas digitar um número não o habilita para recuperar a senha. A redefinição termina no SDK Firebase; a API de mensagens não recebe a nova senha.
- **Mensagens personalizadas:** o backend preparado em [functions/README.md](functions/README.md) envia e-mails com o nome salvo do professor e a identidade do BancaFlow, além de SMS de confirmação/recuperação e avisos de segurança de troca de e-mail. O aviso por SMS não substitui a confirmação do novo e-mail.

Nesta entrega, o backend de mensagens **não foi publicado**, SMTP/Twilio **não foram conectados** e `assets/account-config.js` permanece com `enabled: false`. Não há promessa de SMS ou de corpo de e-mail personalizado antes dessa configuração. Para os e-mails nativos, a administração pode ajustar os modelos em **Firebase Authentication → Templates** e definir o manipulador `https://perabru.github.io/banca-flow/account-action.html`. Essa configuração no Console não é alterada pela publicação no GitHub. Ative o arquivo público de configuração somente depois de publicar e verificar o servidor; nunca inclua nele senhas ou tokens.

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

Em **Minha avaliação**, preencha os quatro critérios de um aluno e clique em **Replicar Nota** para aplicar essas mesmas notas a todos os alunos da mesma banca, na sua avaliação. O botão usa os valores que estão nos campos, inclusive antes de clicar em Salvar notas, e pede confirmação para substituir lançamentos e rascunhos dos demais alunos. A gravação é feita de uma só vez, com a banca aberta e conexão ativa; as notas dos outros avaliadores e da monografia são preservadas. Se houver falha, os campos em edição permanecem disponíveis.

## Relatórios e médias

A coordenação encontra as exportações em **Relatórios e médias**. No celular, abra **Mais → Relatórios e médias**.

- **Todos os alunos:** baixe diretamente o PDF completo, a planilha CSV ou o PDF dos gráficos. Estes arquivos abrangem todos os cursos e turmas do ano letivo selecionado, incluindo bancas abertas, encerradas, arquivadas e alunos sem banca. Use **Todos os anos** para exportar o acervo completo. Notas ausentes continuam pendentes.
- **Escolher alunos e pesos → Preparar relatório:** siga os três passos **Escolha os alunos → Confira a média → Baixe o arquivo**. Curso e turma ficam visíveis; os demais filtros estão em **Mais filtros**.
- **Relatórios oficiais por banca:** abra a seção para acessar filtros de curso, turma e data, relatórios individuais, consolidado oficial, CSV de bancas concluídas, compartilhamento e gráficos oficiais. As exigências de conclusão e a fórmula de 60% / 40% permanecem as mesmas.

Os ajustes avançados ficam recolhidos até serem necessários. As opções abertas, a busca em digitação e os campos do modelo são preservados durante atualizações da tela e navegação na mesma sessão. O fechamento das opções não muda os cálculos, filtros aplicados ou conteúdo escolhido para os arquivos.

### Médias e relatórios personalizados

Alberson e todos os coordenadores ativos, inclusive novos coordenadores, têm acesso à preparação personalizada em **Relatórios e médias → Preparar relatório**. O atalho também aparece no consolidado de **Todas as notas**.

- Em **Ajustar média e modelos**, configure os percentuais da banca e da monografia, os quatro critérios individuais, o peso relativo de cada avaliador e de 0 a 4 casas decimais. Os percentuais das etapas somam 100%; os critérios também somam 100%. Os pesos relativos dos avaliadores são normalizados dentro de cada banca; professores sem peso configurado usam 1.
- Clique em **Gerar prévia** para aplicar a configuração. O cálculo usa as notas salvas, mantém a precisão completa e arredonda somente a exibição. Zero é válido; dados exigidos que estejam ausentes permanecem pendentes. Peso zero desconsidera o componente no modelo.
- Filtre por curso, turma, banca, situação e busca. Os filtros desta área definem os alunos dos arquivos personalizados. Em **Conteúdo do PDF**, escolha resumo, notas individuais e gráficos e acrescente observações da coordenação. A prévia dos resultados permanece disponível independentemente das seções escolhidas para o PDF. Notas individuais, gráficos e fórmula podem ser abertos separadamente para consulta.
- **Baixar relatório PDF** inclui o modelo, a fórmula, os pesos, as seções selecionadas e a identificação da emissão. **Planilha CSV** inclui cada aluno, avaliador, critério e resultado com precisão completa. **Gráficos PDF** sempre gera os gráficos vetoriais da seleção, acompanhados do contexto do modelo, mesmo quando a seção de gráficos do relatório completo estiver desmarcada. Antes de exportar, o sistema relê o catálogo salvo e confere novamente a sessão e a permissão de coordenação.
- **Salvar neste dispositivo** guarda até 20 modelos por conta e navegador. **Exportar modelo JSON** e **Importar modelo JSON** permitem levar a configuração a outro dispositivo. Esses arquivos e as preferências locais contêm a configuração, sem notas ou dados dos alunos.

Os modelos calculam resultados personalizados de consulta. As notas registradas, o resultado oficial de banca 60% / monografia 40% e os relatórios oficiais existentes permanecem preservados. Bancas abertas continuam identificadas como provisórias nos arquivos. Esta área não acrescenta caminhos ao Firebase nem exige regras adicionais.

## Chat dos professores e das bancas

O chat integra a mesma aplicação de avaliações, com acesso pelas contas já cadastradas.

O botão flutuante **Chat** fica disponível em todas as áreas e mostra o total de mensagens não lidas. A conversa abre em um painel sobre a página, sem trocar a área atual. O painel continua aberto ao navegar entre bancas, avaliações e relatórios; novas mensagens não recriam o formulário de notas. **Minimizar**, **Fechar** ou **Esc** recolhem o painel e conservam a sala e o rascunho. Ao reabrir a sala, seu contador é atualizado como lido.

Todos os professores ativos e a coordenação podem abrir **Chat dos professores** no menu, pelo ícone de conversa no cabeçalho ou pelo botão **Abrir chat** na visão geral. Esses atalhos sempre abrem a sala geral, inclusive após uma mudança de banca. No celular, o professor também tem **Chat** na navegação inferior; para a coordenação, a opção fica em **Mais**. O botão **Chat da banca** abre diretamente a conversa daquela banca.

- **Sala dos professores** reúne todos os professores e a coordenação. Professores já cadastrados, inclusive perfis antigos sem os campos `active` ou `key`, e novos cadastros ativos têm acesso sem convite, autorização individual para o chat ou atribuição a uma banca.
- **Sala da banca** é restrita aos avaliadores participantes e à coordenação. O encerramento das notas não encerra a conversa.
- As mensagens mostram nome, data e horário, aceitam até 2.000 caracteres e ficam salvas no histórico. Não há envio automático; cada autor pode editar ou apagar suas próprias mensagens confirmadas.
- O envio aparece como **Enviando…** até o servidor confirmar a gravação. **Enviada** confirma que a mensagem foi salva na sala. O cadastro do autor é conferido antes da gravação para usar o nome atual e verificar o acesso.
- Se o servidor recusar a mensagem, ela é retirada da conversa do remetente, o texto permanece no campo e o erro fica visível junto ao formulário. Um novo envio depende da ação do professor. Em caso de bloqueio de permissão, a coordenação pode usar **Copiar regras de acesso** no próprio aviso e publicar a política atualizada no Firebase.
- Cada professor pode **Editar** ou **Apagar** suas próprias mensagens confirmadas. A edição aparece com a indicação **editada**; apagar exige confirmação e remove o texto para todos, deixando **Mensagem apagada** no histórico. As alterações também chegam às páginas antigas já carregadas. Outros professores e coordenadores não alteram mensagens alheias. Alterações simultâneas são bloqueadas para evitar sobrescrever uma versão mais recente.
- Edições e exclusões só são confirmadas depois da gravação no servidor. Se a alteração falhar, o texto em edição permanece disponível. Elas não geram novos avisos; apagar remove a mensagem do contador de não lidas e recolhe a notificação correspondente.
- **Enter** envia e **Shift + Enter** insere uma nova linha. No celular, o botão **Enviar** também está disponível.
- Os rascunhos de cada sala permanecem durante a navegação e as atualizações da conversa. Sair da conta limpa os rascunhos e os dados da sessão.
- A lista **Professores online** considera as conexões ativas. Cada aba ou dispositivo tem sua própria presença; fechar uma aba não desconecta as demais. A conexão é removida ao sair ou desconectar e registros sem atualização recente deixam de aparecer.
- O chat abre as 100 mensagens mais recentes. **Carregar mensagens anteriores** recupera o histórico sem perder a posição da leitura. Campos em edição e o cursor são preservados quando novas mensagens chegam.
- **Atualizar conversa** refaz a leitura das mensagens e conserva os rascunhos; a presença que está funcionando continua conectada. **Últimas mensagens** leva ao fim da conversa. A confirmação de um envio também mostra o texto mais recente, sem deslocar outra sala aberta durante o envio.
- As atualizações da janela de mensagens são reconciliadas com o servidor. Uma mensagem local recusada é removida sem apagar as páginas anteriores do histórico. Se a primeira leitura não chegar em 10 segundos, o chat informa a demora e tenta recuperar a conversa automaticamente.
- Se uma leitura for recusada ou interrompida, o chat refaz a conexão automaticamente, com intervalo crescente de 2 a 30 segundos enquanto a sala estiver aberta. Depois da publicação das regras no Firebase, a conversa pode se recuperar sem recarregar a página. A reconexão conserva os rascunhos e não envia mensagens automaticamente. Trocar de conta ou sair da área de chat cancela as tentativas pendentes.
- O indicador mostra **Chat conectado** apenas quando as mensagens carregaram. Falhas de autorização aparecem como **Chat indisponível**, com uma orientação para a coordenação conferir as regras do Firebase.

Os caminhos novos são `chatMessages/SALA/MENSAGEM` e `chatPresence/UID/CONEXAO`. A sala geral usa `geral`; as salas de banca usam o identificador da banca. As regras validam o autor pela conta autenticada, bloqueiam professores desativados e permitem editar ou apagar apenas mensagens do próprio autor. O horário e a identidade original são preservados; mensagens apagadas não podem ser restauradas pelo chat. As notas, monografias e relatórios não são incluídos nas mensagens nem alterados pelo chat.

Para ativar a comunicação entre dispositivos, aplique a versão atualizada de `database.rules.json`. Os HTMLs precisam ser publicados com `assets/board-chat.js` e `assets/board-chat.css`. Publicar no GitHub não atualiza as regras do Firebase. Os testes usam somente contas fictícias e um Firebase em memória ou o emulador local.

## Avisos de mensagens no celular

Em **Chat → Avisos de mensagens**, toque em **Ativar notificações** e permita os avisos no navegador. A permissão só é solicitada após esse toque. **Silenciar** desativa sons, vibração e avisos na página e no sistema; **Reativar avisos** restaura os alertas. A preferência é lembrada por conta neste navegador e sincronizada entre abas do mesmo dispositivo. As mensagens continuam disponíveis para leitura.

Enquanto a página estiver executando, o sistema acompanha a sala geral e as bancas às quais o professor tem acesso, inclusive em outras áreas da aplicação. Novas mensagens de outros professores mostram um aviso com atalho para a conversa e uma contagem no botão do chat. Com a página oculta, navegadores compatíveis podem mostrar uma notificação do sistema. O clique abre a sala depois de conferir o acesso da conta. Mensagens antigas carregadas ao entrar, mensagens próprias e gravações recusadas não geram avisos.

No Android, use um navegador com suporte a notificações e autorize a permissão do site. No iPhone/iPad, adicione o BancaFlow à **Tela de Início** e abra pelo ícone; as notificações requerem uma versão compatível do sistema, a partir do iOS/iPadOS 16.4. Se o navegador bloquear a permissão, libere os avisos nas configurações do site ou do aparelho e use **Verificar permissão**.

Os avisos dependem de a página continuar executando. O celular pode suspender a página em segundo plano. Receber novas mensagens com o navegador totalmente fechado exige um serviço Web Push/FCM no servidor, ainda não conectado nesta versão. O manifesto e o service worker permitem a instalação e a exibição local dos avisos; o worker não guarda páginas, sessões, notas ou relatórios em cache.

Publique também `assets/chat-notifications.js`, `chat-sw.js`, `manifest.webmanifest` e os ícones locais. As regras de acesso do chat permanecem as mesmas.

## Todas as notas — coordenação

O Alberson pode consultar **Todas as notas** pelo menu lateral, pelo atalho da visão geral ou por **Notas** na navegação inferior do celular. A consulta inclui todas as bancas, abertas ou encerradas, com notas completas ou pendentes, inclusive o histórico de grupos removidos. Há filtros independentes por curso, turma, data e situação, além da busca por grupo, aluno ou professor. **Expandir todas** mostra os detalhes das bancas selecionadas.

Cada aluno tem suas notas separadas por avaliador e critério, média do avaliador, média da banca, entregas e parcelas de 60%/40%. Uma nota ausente aparece como **Pendente**; zero continua sendo uma nota válida. A média da banca é exibida quando todos os avaliadores concluíram os quatro critérios, mesmo sem entregas. A nota final só é calculada com todas as notas necessárias e fica identificada como provisória enquanto a banca estiver aberta.

O mesmo detalhamento fica disponível em **Bancas → Ver detalhes** e **Relatórios → Consultar notas**, mesmo quando o coordenador não participa da banca. Os critérios de cada professor permanecem somente para consulta. Alberson pode preencher **Monografia e entregas · 40%** na própria ficha de cada aluno. Reabra a banca para corrigir uma nota bloqueada; grupos removidos precisam ser restaurados antes da edição. Os valores acompanham os lançamentos salvos no Firebase. A consulta não altera os lançamentos nem as exigências dos PDFs oficiais.

## Consolidado completo e monografia

Em **Todas as notas**, o painel **Todos os alunos** oferece:

- **PDF completo**: resumo de todos os alunos, todas as notas individuais por avaliador e critério, monografia, parcelas de 60%/40%, resultados e gráficos.
- **Planilha de notas (CSV)**: uma linha por aluno e avaliador, com curso, turma, banca, situação e todas as notas. Alunos sem banca também aparecem, com os campos de nota vazios. O arquivo abre no Excel com acentos e separador de ponto e vírgula.
- **PDF dos gráficos**: comparação de todos os alunos, médias dos critérios salvos com suas quantidades, tempos de apresentação e detalhamento por aluno, professor e critério em todas as bancas.

Os três arquivos sempre incluem todos os cursos e turmas, independentemente dos filtros da consulta. Incluem bancas abertas, encerradas ou incompletas, grupos removidos e alunos cadastrados sem banca. Resultados de bancas abertas são **provisórios**; notas ausentes não viram zero. Em **Gráficos e resumo de todos os alunos**, é possível explorar uma banca na tela sem limitar o conteúdo dos arquivos completos.

A nota individual de **Monografia e entregas** usa o mesmo campo numérico de entregas já existente (`deliveries/BANCA/ALUNO`). Informe uma nota de 0 a 10; o sistema calcula os 40%. Os valores anteriores e a fórmula original estão preservados. A coordenação pode salvar essa nota na consulta geral ou em **Monografia**, mesmo sem ser membro da banca. Os próprios critérios do Alberson continuam em **Minhas avaliações** e entram nos 60% da banca.

Antes do download, o sistema atualiza os cadastros, bancas, notas, monografias, encerramentos e tempos salvos no Firebase. Exige conexão e que os campos em edição estejam salvos. Esse consolidado é uma consulta da coordenação; os relatórios oficiais em **Relatórios** conservam a exigência de banca encerrada e todas as notas completas. A atualização não modifica a composição das bancas, o banco existente ou as regras de acesso.

Publique `assets/coordinator-report.js` e `assets/coordinator-report-pdf.js` junto dos dois HTMLs e dos demais recursos locais.

## Alberson como avaliador

O coordenador também participa das avaliações. Use **Minhas avaliações** no menu lateral ou **Avaliar** na navegação inferior do celular. Essa área lista somente as bancas em que a conta está cadastrada como avaliador. O atalho **Lançar minhas notas** também aparece na visão geral e nas bancas atribuídas, inclusive em Todas as notas e Relatórios.

O formulário **Minha avaliação** aparece antes da consulta geral. Alberson registra Apresentação, Parte prática, Domínio do código e Domínio do tempo por aluno, como os demais avaliadores. Os lançamentos são salvos na conta dele e participam da média da banca. As avaliações dos demais professores permanecem independentes; **Monografia e entregas · 40%** continua sendo uma nota separada, lançada pela coordenação.

Ao criar uma banca manualmente, o coordenador aparece na lista como **coordenador e avaliador**; ele também integra o conjunto de professores disponíveis para o sorteio. As bancas existentes mantêm sua composição e suas notas. Em uma banca não atribuída ao Alberson, ele conserva o acesso de consulta da coordenação. Bancas encerradas exigem reabertura com confirmação para alterar notas.

## Montagem manual e importação de bancas por Excel

Qualquer coordenador ativo pode usar **Bancas → Nova banca** ou **Sorteio → Montagem manual**. Selecione um grupo já cadastrado, data e horário, sala e dois ou três avaliadores ativos. A lista inclui professores e coordenadores. O sistema confere os dados atuais e reserva professores e salas em uma única gravação; conflitos impedem todo o cadastro.

Para importar a agenda, use **Importar bancas** em Bancas ou **Importar bancas do Excel** em Sorteio. **Baixar modelo Excel** gera um `.xlsx` com uma aba de exemplos e outra de instruções. São aceitos `.xlsx`, `.xls` e `.csv`, até 5 MB e 500 bancas por arquivo.

1. Cadastre ou importe primeiro os grupos e os professores.
2. Preencha uma linha por banca: **Curso, Turma, Grupo, Data, Hora, Duração, Sala, Avaliador 1, Avaliador 2** e, se necessário, **Avaliador 3**. **ID do grupo** é uma coluna opcional que evita ambiguidades.
3. Use datas `dd/mm/aaaa` ou `aaaa-mm-dd`, horários `HH:mm` a cada 15 minutos e durações de 30, 45, 60 ou 90 minutos. Datas e horas nativas do Excel também são aceitas. Os horários usam o fuso do navegador.
4. Identifique os avaliadores por e-mail, identificador, UID ou nome completo exclusivo. Nomes ambíguos, professores desativados, fórmulas, grupos removidos ou já agendados e conflitos de professor/sala bloqueiam o lote.
5. Escolha a aba, confira a prévia e confirme a importação. O sistema consulta novamente os dados antes de salvar. Mudanças na prévia exigem nova confirmação.

A importação acrescenta apenas bancas novas. Ela não substitui grupos, alunos, notas, monografias, cronômetros ou conversas existentes. Publique também `assets/board-import.js` junto dos recursos locais de Excel.

## Filtrar bancas por data

Em **Bancas**, selecione **Data da banca** para ver os grupos daquele dia, combinando o filtro com curso e turma. **Hoje** escolhe o dia atual e **Todas as datas** limpa somente a data. Os professores continuam vendo apenas as bancas às quais estão atribuídos. O PDF da agenda inclui exatamente os resultados dessa seleção.

Em **Relatórios**, a data também restringe a lista, o PDF consolidado e o CSV de bancas concluídas. Com uma data escolhida, grupos sem agendamento não pertencem à seleção daquele dia; todas as bancas selecionadas ainda precisam estar encerradas e com notas completas para o PDF consolidado. Sem data, a verificação de conclusão de todos os grupos do curso/turma permanece.

O filtro considera o dia no fuso do dispositivo, o mesmo utilizado na apresentação da agenda. Ele é limpo ao trocar de conta. Os filtros não alteram os dados das bancas.

## Cronômetro com centésimos

O tempo aparece em **minutos:segundos,centésimos**, por exemplo `12:34,56`. Ao ultrapassar **15 minutos**, os números ficam vermelhos e aparece um aviso. Em `15:00,00` o alerta ainda não está ativo; a partir de `15:00,01`, ele fica visível. A contagem continua normalmente. O alerta acompanha o tempo salvo, inclusive pausado ou encerrado, e some ao zerar o cronômetro. Ele é compartilhado entre os avaliadores e a coordenação pelo Firebase e continua contando após trocar de tela ou recarregar a página. Apenas os controles de iniciar, pausar, continuar e zerar gravam no banco; os centésimos são calculados na tela usando o relógio ajustado ao servidor.

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


## Professores e novos coordenadores

Em **Professores**, todos os coordenadores ativos podem selecionar **Professor avaliador** ou **Coordenador e avaliador**, criar uma conta ou vincular um UID ainda sem perfil. O cadastro usa uma sessão secundária e mantém a conta principal aberta. Se a criação do perfil falhar, somente a conta nova criada pela operação é desfeita; contas existentes não são apagadas.

Uma conta ativa com `role: "coordinator"` gerencia os professores e coordenadores, consulta todas as notas, lança monografia, organiza bancas e emite os PDFs oficiais, individuais, analíticos e personalizados disponíveis no sistema. **Tornar coordenador** promove um professor na conta existente, com confirmação do nome e login. Wagner recebe os mesmos acessos ao ser promovido pelo seu UID; suas bancas e avaliações continuam vinculadas à mesma conta. A própria conta e o perfil principal com identificador `alberson` ficam protegidos de alteração por esta gestão.

O **e-mail de contato** pode ser alterado sem afetar o login. O identificador nas planilhas permanece vinculado à conta existente. O próprio professor pode trocar o e-mail de acesso em **Minha conta**, com senha atual e confirmação do novo endereço pelo Firebase Authentication; a tela administrativa de contatos não altera o login de outra pessoa. Os nomes já registrados nas bancas não são reescritos ao editar o professor. **Desabilitar** bloqueia o acesso ao aplicativo e conserva o perfil, as bancas, as atribuições e todas as notas, inclusive em bancas abertas. **Reativar** restaura o acesso na mesma conta.

O atalho **Preparar cadastro de administrador** preenche nome, e-mail `admin@univap.br`, identificador `admin` e função de coordenador. A senha é informada no campo protegido pelo responsável e nunca fica publicada no HTML ou no cadastro de perfis. Esse administrador tem os mesmos acessos de gestão, avaliação e relatórios dos demais coordenadores. O provisionamento administrativo de Wagner e dessa conta também pode ser feito pelo [procedimento de ativação](scripts/ADMINISTRADORES.md), usando uma conexão administrativa autorizada com o Firebase. A publicação do site não cria contas nem publica regras no banco automaticamente.

### Atribuir avaliadores a bancas existentes

Em **Bancas → Ver detalhes → Atribuir avaliadores**, a coordenação seleciona 2 ou 3 professores para uma banca aberta de grupo ativo. A alteração relê usuários, notas, composição, encerramento e reservas de horário antes de salvar. Novos avaliadores precisam estar ativos e livres naquele horário. Professores desabilitados permanecem no histórico; participantes sem notas podem ser retirados, e as reservas correspondentes são liberadas.

Quem já registrou qualquer nota, inclusive zero ou uma avaliação incompleta, permanece na composição para preservar sua participação. Notas, alunos, monografia, cronômetro, data e sala não são alterados. As mudanças de composição e reservas são gravadas em uma única operação com `assignmentRevision`, que rejeita edições concorrentes desatualizadas. Bancas encerradas precisam ser reabertas antes da alteração.

## Grupos, cursos e planilhas

Em **Grupos e cursos**, qualquer coordenador ativo pode:

- Cadastrar um grupo com curso, turma, título, orientador ativo e de 1 a 20 alunos.
- Editar grupos antes de agendar uma banca, preservando os identificadores dos alunos.
- Remover e restaurar grupos. A remoção é um arquivamento: o grupo sai de novos agendamentos, mas os alunos, notas, bancas e relatórios permanecem. Bancas em aberto precisam ser encerradas primeiro.
- Buscar grupos ou alunos e filtrar por curso e turma. A agenda, o sorteio e os relatórios também oferecem seleção de curso.
- Importar arquivos `.xlsx`, `.xls` e `.csv` (UTF-8), selecionar a aba e conferir a prévia antes de confirmar. Nenhum dado é gravado enquanto houver erros.

Os dados acadêmicos do grupo ficam protegidos após o agendamento, para que alterações de alunos ou orientador não invalidem avaliações existentes. Para corrigir notas de uma banca de um grupo removido, restaure o grupo e depois reabra a banca.

### Formato da planilha

Use as colunas **Curso, Turma, Grupo, Título, Orientador, Aluno**, uma linha por aluno, repetindo os dados do grupo. Também são aceitas colunas **Aluno 1, Aluno 2…** na mesma linha. Se não houver coluna Curso, informe-o no campo da importação. O botão **Baixar modelo CSV** gera um modelo fictício para abrir no Excel.

Na importação, informe também o **Ano letivo dos grupos**; o valor se aplica aos novos grupos daquele lote. Em Orientador, use o e-mail, o identificador, o UID ou o nome completo de um professor ativo. Nomes ambíguos são recusados; use um identificador exclusivo. Grupos repetidos são identificados dentro do mesmo ano por curso, turma e nome, inclusive os removidos, e não são sobrescritos. O sistema informa conflitos de título/orientador e nomes repetidos de alunos. Fórmulas são recusadas; use valores.

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
