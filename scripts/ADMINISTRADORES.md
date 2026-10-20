# Ativação administrativa preservando os dados

`provision-administrators.cjs` é uma operação administrativa pontual para o projeto Firebase `avaliadortcc`. Ele não é executado pelo navegador nem pelo GitHub Pages.

A operação promove o cadastro existente com o identificador `wagner` para `coordinator`, preservando seu UID, login, contato e vínculo com as avaliações. Também cria ou vincula o acesso `admin@univap.br` com o identificador `admin` e a função `coordinator`, que dá acesso à gestão e aos relatórios do sistema. Não é criado um terceiro tipo de função incompatível com os cadastros atuais.

## Preparação

Use uma máquina administrativa com Node.js, o pacote oficial `firebase-admin` e uma credencial administrativa padrão autorizada para o projeto. Não inclua credenciais, senhas, arquivos de conta de serviço ou tokens no repositório.

O pacote pode ficar fora do projeto. Nesse caso, `BANCAFLOW_ADMIN_DEPS` deve apontar para o diretório onde ele foi instalado, contendo `node_modules/firebase-admin`.

O endereço do banco é lido da configuração existente do `index.html`. Uma eventual variável `BANCAFLOW_DATABASE_URL` só é aceita se apontar para o mesmo banco autorizado do projeto. O script recusa outros projetos, caminhos de banco e variáveis de emulador.

## Conferir antes de aplicar

Execute primeiro a simulação:

```bash
node scripts/provision-administrators.cjs --project avaliadortcc
```

A simulação faz as leituras administrativas e mostra os UIDs e as ações previstas, sem criar contas nem gravar perfis. Wagner e Alberson precisam ter identificadores únicos e contas de autenticação ativas com os UIDs correspondentes. Perfis legados sem e-mail são preservados; quando existe e-mail no perfil, ele deve corresponder ao login no Firebase Authentication.

Duplicidade de identificador, divergência de UID/e-mail, conta desabilitada e perfil administrativo incompatível interrompem a operação. Nenhum cadastro é substituído para resolver uma divergência automaticamente.

Se o cadastro antigo de Wagner não tiver o identificador `wagner`, a administração pode informar explicitamente o UID conferido em Firebase Authentication. Nesse modo, é obrigatório existir um perfil ativo com o mesmo e-mail da conta autenticada. A seleção não usa uma aproximação pelo nome. Se o identificador `wagner` já apontar para outro UID, a divergência bloqueia a operação.

```bash
node scripts/provision-administrators.cjs --project avaliadortcc --wagner-uid UID_CONFERIDO
```

Mantenha a mesma opção `--wagner-uid` ao acrescentar `--apply` depois da conferência.

## Aplicar

Se a conta administrativa ainda não existir, forneça a senha inicial solicitada pelo responsável somente na variável de ambiente `BANCAFLOW_ADMIN_PASSWORD` da sessão do terminal. A senha não é salva no código, no perfil do banco ou no relatório da operação. Remova essa variável ao terminar.

```bash
node scripts/provision-administrators.cjs --project avaliadortcc --apply
```

Uma conta que já exista em Firebase Authentication é vinculada pelo mesmo UID e sua senha permanece como está. O script não redefine senhas existentes. Se for necessário alterá-la, isso deve ser feito separadamente pela administração da autenticação.

Somente o catálogo `users` participa da transação. Bancas, grupos, alunos, notas, monografias, cronômetros, encerramentos e conversas não são lidos nem modificados por este procedimento. A transação preserva os demais usuários e novas alterações que ocorram simultaneamente. Executar novamente depois da conclusão não recria a conta nem altera os perfis já configurados.

Se a gravação falhar, apenas uma conta de autenticação que esta execução acabou de criar pode ser desfeita. Antes disso, o script confere se seu perfil foi gravado. Uma confirmação de gravação perdida por falha de rede não provoca a exclusão de uma conta cujo perfil já exista. Quando não é possível conferir esse estado, a conta é preservada e o terminal orienta a revisão no Firebase.

## Regras e verificação

A publicação no GitHub não publica regras de segurança no Firebase. Publique também a versão atual de `database.rules.json` com uma conta autorizada, para habilitar a gestão compartilhada de professores pelos coordenadores.

Após concluir, entre no sistema com o login administrativo e confira **Professores**, **Bancas**, **Todas as notas**, **Relatórios** e **Modelos e relatórios**. Wagner deve sair e entrar novamente para carregar o novo papel, caso sua sessão ainda esteja aberta.

Os testes locais usam contas fictícias e não acessam o projeto real:

```bash
node --test tests/admin-provisioning.test.cjs
```
