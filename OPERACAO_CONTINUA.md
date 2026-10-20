# BancaFlow — operação ao longo dos anos

O sistema organiza vários anos letivos no mesmo projeto Firebase. Professores continuam com a mesma conta; grupos, alunos, bancas e notas conservam seus identificadores. Não é necessário apagar o banco, reimportar o acervo ou criar um novo site a cada ano.

## Começar um novo ano

1. Entre com uma conta de coordenação e escolha o novo período no seletor **Ano letivo**. O seletor oferece o ano atual, o próximo e os anos encontrados no acervo. No cadastro de grupo, o campo de ano também permite informar outro período válido.
2. Confira os professores ativos. Desabilite quem não deve mais entrar e adicione os novos avaliadores; preserve os perfis ligados a avaliações antigas.
3. Cadastre ou importe os novos grupos e confira **Ano letivo do grupo**. Os alunos do novo período recebem novos registros. Nome de grupo, turma e curso podem se repetir em outro ano sem substituir o histórico.
4. Monte as bancas manualmente, por planilha ou por sorteio. Revise o período, a data e os avaliadores antes de confirmar.
5. Ao terminar, conclua as avaliações e exporte os relatórios necessários. Se quiser retirar um grupo dos novos agendamentos, use o arquivamento da aplicação; as notas e o histórico permanecem.

O ano letivo explícito do grupo prevalece sobre o ano da apresentação. Isso permite, por exemplo, apresentar em janeiro um trabalho do período anterior. Em registros antigos sem marcação, o sistema usa a data da banca, depois a data de criação válida; sem essas informações, usa 2026, origem do acervo. Essa leitura não altera os registros antigos.

## Consultar o histórico e emitir arquivos

**Todos os anos** é a seleção inicial. Escolher um período filtra as áreas acadêmicas sem excluir dados. Os cadastros de professores, as contas e as permissões são compartilhados entre os anos.

Em **Relatórios e médias**, os atalhos **Todos os alunos** abrangem todos os cursos e turmas do período selecionado. Para um consolidado de todo o acervo, escolha **Todos os anos** antes de gerar o arquivo. Os relatórios identificam o ano letivo. O cálculo oficial continua com banca de 60% e monografia de 40%; os modelos personalizados continuam separados das notas registradas.

## Guardar uma cópia acadêmica

A coordenação encontra **Baixar cópia acadêmica** em **Visão geral → Histórico e cópia de segurança**. Salve as notas que estiverem em edição e mantenha a conexão ativa antes de baixar.

O JSON usa o formato `BancaFlowAcademicBackup`, `schemaVersion: 1`, identifica o projeto, a versão da aplicação e a data de emissão. A cópia sempre contém **todos os anos**, independentemente do filtro da tela, com os caminhos:

- `users`, `groups`, `boards` e `groupBoards`;
- `grades`, `deliveries`, `seals` e `timers`;
- `locks` e `roomLocks`, que representam as reservas da agenda.

O arquivo não contém senhas do Firebase Authentication, mensagens do chat, presença, celulares de recuperação nem segredos ou desafios de segurança. Cadastros e notas são dados pessoais: guarde o arquivo em um local institucional de acesso restrito, separado do repositório público.

As leituras são recentes, mas feitas separadamente por caminho. Se houver alterações durante o download, os caminhos podem refletir instantes diferentes. Essa exportação não substitui uma política institucional de backup do Firebase e do Authentication. Baixe uma cópia após o fechamento de cada período e antes de atualizações importantes. Confira se o arquivo abre e guarde mais de uma versão, com data.

Não há restauração automática desse JSON na interface. Uma eventual recuperação deve ser planejada por um responsável autorizado, com conferência de versão, identificadores e dados atuais. Não envie o arquivo inteiro ao banco de produção para testar uma restauração.

## Recuperar senha ou trocar e-mail

Na entrada, **Esqueci minha senha** abre a recuperação. Para gerenciar os dados depois de entrar, use **Minha conta** no cabeçalho ou no menu do celular.

Para redefinir por e-mail, informe o endereço da conta, solicite as instruções e abra o link recebido. O sistema evita revelar se um endereço está cadastrado. A nova senha deve atender à política configurada no Firebase.

Para trocar o e-mail, confirme a senha atual e informe o novo endereço. Abra a mensagem enviada ao novo e-mail e confirme a alteração. Até essa confirmação, o endereço antigo continua sendo o login. Depois, use **Já confirmei o e-mail** ou entre novamente com o novo endereço. A conta mantém o mesmo UID, função, bancas e notas; a troca não cria outro professor.

Para recuperação por SMS, o serviço de envio precisa estar ativado. Em **Minha conta**, confirme primeiro o celular por código, usando a senha atual. Na recuperação, informe o e-mail da conta e o mesmo número confirmado. Um número digitado sem confirmação não passa a ser um destino de recuperação.

Na troca de e-mail, o aviso opcional por SMS informa a solicitação e, quando o serviço confirma a conclusão, a alteração efetuada. A comprovação de que o novo endereço pertence ao professor continua sendo feita pelo link recebido naquele e-mail.

## Ativar mensagens personalizadas e SMS

O envio nativo de recuperação por e-mail continua disponível. A administração pode personalizar o nome do aplicativo, remetente permitido e textos em **Firebase Authentication → Templates** e configurar `https://perabru.github.io/banca-flow/account-action.html` como manipulador dos links. Os parâmetros de ação do Firebase devem ser preservados.

Os corpos de e-mail com o nome salvo de cada professor e os SMS personalizados usam o serviço preparado em [functions/README.md](functions/README.md). Ele exige publicação das Cloud Functions, configuração de SMTP e provedor SMS, remetentes autorizados e faturamento compatível. Publicar o GitHub Pages não executa essas etapas.

Nesta entrega, esse serviço **não foi publicado**, os provedores **não foram conectados** e `assets/account-config.js` permanece com `enabled: false`. A recuperação nativa por e-mail é a alternativa enquanto isso. Só altere para `enabled: true` depois de concluir e testar a implantação descrita no guia das funções. O arquivo público deve conter apenas a configuração do endereço do serviço; credenciais ficam no Secret Manager.

Se as regras ainda forem da versão anterior, o cadastro do ano atual conserva o formato anterior somente quando o ano puder ser inferido com segurança. Anos diferentes exigem a política nova; o sistema não descarta essa informação para forçar uma gravação.

Publique também a versão completa de `database.rules.json` no Realtime Database. As novas regras validam o ano dos grupos e permitem sincronizar somente o e-mail da própria conta, depois que o Firebase confirmar sua identidade. Elas também mantêm as permissões do chat e dos demais módulos.

## Manutenção regular

Use o repositório como fonte da versão publicada e mantenha o projeto Firebase sob responsabilidade institucional. Registre quem administra a hospedagem, o banco, as contas e os provedores de mensagem, inclusive quando mudar a equipe.

Antes de cada período, revise as permissões de professores e coordenadores, os remetentes, os limites de envio e a política de senhas. Periodicamente, atualize as dependências do navegador e das funções de forma controlada; versões fixadas facilitam a reprodução, mas também precisam de manutenção.

Depois de uma atualização, execute as verificações documentadas em [tests/README.md](tests/README.md), confira o acesso de um professor e de um coordenador e teste cadastro, nota, cronômetro, chat e exportação com dados fictícios. Para mensagens, use inicialmente emuladores ou destinatários de teste autorizados. Mantenha uma cópia anterior dos dados e a referência da versão anterior do site para investigar falhas.

A estrutura permite continuar usando o mesmo acervo nos próximos anos. A continuidade também depende da manutenção da hospedagem, do Firebase, das contas administrativas e dos serviços contratados.
