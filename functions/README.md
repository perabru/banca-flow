# BancaFlow: e-mails personalizados e recuperação por SMS

Este serviço roda no Firebase, separado do GitHub Pages. Ele não migra, substitui ou exclui professores, bancas, notas, grupos ou relatórios. O mesmo UID continua identificando o professor depois da troca de e-mail ou senha.

O site usa o envio nativo do Firebase como alternativa quando o serviço de e-mail personalizado não estiver configurado. SMS só aparece habilitado quando o servidor informa que o provedor está configurado. Publicar os arquivos no GitHub **não ativa** as Cloud Functions, o SMTP ou o SMS. Nenhuma conta de envio foi criada e nenhum SMS real foi enviado pelos testes.

## Ativação pela administração

1. Use uma conta autorizada no projeto **avaliadortcc**. Cloud Functions de segunda geração, Secret Manager e o agendamento exigem configuração de faturamento compatível; o projeto deve estar no plano Blaze. Configure os limites de gastos e envio do provedor contratado.
2. Em **Authentication → Settings → Authorized domains**, mantenha `perabru.github.io` autorizado. Mantenha o provedor de e-mail/senha ativo e configure a política de senhas desejada. O fluxo por SMS termina com `confirmPasswordReset` do SDK Firebase, respeitando essa política; o servidor não recebe a nova senha nem usa `updateUser` para contorná-la.
3. Configure um remetente SMTP autorizado pela instituição. Verifique o domínio do remetente e os registros SPF/DKIM conforme o seu provedor. O campo `from` não torna automaticamente um endereço `@univap.br` autorizado a enviar mensagens.
4. Para SMS, configure na Twilio um número/remetente ou Messaging Service habilitado para envio ao Brasil. Informe `accountSid`, `authToken` e **um** dos campos `from` ou `messagingServiceSid`. Credenciais de teste não entregam mensagens a celulares reais. O código aceita SMS convencional, sem depender de WhatsApp.
5. Copie `account-config.example.json` para um arquivo **fora do repositório**, preencha os dados e substitua `otpPepper` por pelo menos 32 bytes aleatórios, por exemplo gerados com `crypto.randomBytes(32).toString('hex')`. Nunca coloque o JSON preenchido no GitHub, no HTML ou no JavaScript do navegador. SMTP ou Twilio podem ficar vazios para manter somente o canal disponível.
6. Autentique o Firebase CLI na sua própria máquina, instale as dependências com `npm ci --prefix functions` e guarde o JSON preenchido no Secret Manager:

   ```bash
   firebase functions:secrets:set BANCAFLOW_ACCOUNT_CONFIG --data-file /caminho/privado/bancaflow-account-config.json --project avaliadortcc
   ```

7. A configuração do projeto deve conter a origem das funções e as regras, preservando as demais opções existentes:

   ```json
   {
     "functions": {
       "source": "functions",
       "codebase": "bancaflow-account"
     },
     "database": {
       "rules": "database.rules.json"
     }
   }
   ```

8. Publique o código e as regras:

   ```bash
   firebase deploy --only functions:bancaflow-account,database --project avaliadortcc
   ```

9. A URL padrão é `https://southamerica-east1-avaliadortcc.cloudfunctions.net/accountService`. Depois de verificar a implantação e os canais, altere `enabled:false` para `enabled:true` em `assets/account-config.js`, execute `node scripts/sync-html.cjs` e publique os arquivos atualizados no GitHub Pages. Antes dessa etapa o site mantém o e-mail nativo do Firebase e não habilita SMS. Se mudar de projeto ou região, revise também a validação da URL no módulo principal e a política CSP; mantenha o destino fixo e HTTPS. Não aceite URLs fornecidas por formulários como destino da API.
10. Em **Authentication → Templates**, personalize o nome do aplicativo como **BancaFlow**, o remetente permitido e os textos em português. Configure o URL do manipulador de ações como `https://perabru.github.io/banca-flow/account-action.html` para os fluxos nativos. As mensagens enviadas pelo SMTP já usam esse manipulador por padrão e incluem o nome do professor. Não altere os parâmetros `mode` e `oobCode` dos links.

O Secret Manager é o único local usado pelo código para obter as credenciais. A função declara explicitamente o segredo `BANCAFLOW_ACCOUNT_CONFIG`. Depois de alterar um segredo, publique novamente as funções para que as novas instâncias recebam o valor atualizado. Use TLS na conexão SMTP e nunca desabilite a validação do certificado.

## Como os fluxos funcionam

- **E-mail para redefinição:** o servidor gera um link de ação do Firebase e envia um e-mail com o nome salvo em `users/UID/name`, identidade do BancaFlow e link para criar uma senha. A resposta pública é a mesma para contas desconhecidas, desabilitadas ou habilitadas, e não informa se o endereço está cadastrado.
- **Troca de e-mail:** exige uma autenticação de no máximo cinco minutos. A mensagem personalizada chega ao novo endereço; o e-mail antigo continua sendo o acesso até a confirmação do link. O serviço nunca troca diretamente a identidade por uma solicitação sem confirmação. Uma mensagem opcional por SMS informa que houve uma **solicitação**. Depois que o Firebase confirmar o novo e-mail, `getAccount` ou `notifyEmailChange` detecta a identidade canônica e reclama atomicamente um único aviso de conclusão ao e-mail anterior e, se escolhido, ao celular confirmado. O envio é de melhor esforço e não determina se a troca já ocorreu no Firebase.
- **Cadastrar celular:** exige autenticação recente e um código enviado ao próprio número. Digitar um número no formulário não basta para habilitar a recuperação por SMS.
- **SMS para redefinição:** o e-mail e o número completo devem corresponder a um celular anteriormente confirmado nessa conta. Um código de seis dígitos vale por dez minutos. Após conferir o código de uso único, o serviço retorna um código de redefinição do Firebase; o navegador usa o SDK para definir a senha segundo a política do projeto. Não se recebe nem se armazena senha nesta API.
- **Falhas:** envio não configurado retorna `unavailable-channel`. Rejeições no envio autenticado mantêm o formulário disponível para nova tentativa. Solicitações públicas de recuperação conservam a resposta genérica mesmo se o provedor recusar o envio, para não revelar contas existentes; o servidor registra apenas o tipo de falha, sem telefone, endereço, código ou conteúdo da mensagem. A aceitação pela API do provedor não garante a entrega final pela operadora.

E-mail é necessário para provar a propriedade do novo endereço. Um aviso por SMS não substitui essa confirmação.

## API

Somente `POST`, `Content-Type: application/json`, corpo de até 16 KiB e `Origin` explicitamente autorizado. O endpoint responde `Cache-Control: no-store`. Operações autenticadas usam `Authorization: Bearer ID_TOKEN_FIREBASE`; o servidor verifica o token com revogação e confere o perfil ativo no banco. O CORS não substitui essa autorização. Senhas e códigos nunca devem ser enviados em URL, query string ou logs.

| `action` | Campos adicionais | Autorização | Retorno útil |
| --- | --- | --- | --- |
| `getCapabilities` | nenhum | público | `emailAvailable`, `smsAvailable` |
| `getAccount` | nenhum | conta ativa | capacidades e o próprio `phone`, `phoneVerified` |
| `requestPasswordResetEmail` | `email` | público | mensagem genérica |
| `requestEmailChange` | `newEmail`, `notifySms` opcional | conta ativa, autenticação recente | instruções e `smsNoticeSent` |
| `notifyEmailChange` | nenhum | conta ativa | confirmação genérica da checagem |
| `enrollPhoneStart` | `phone` em E.164 | conta ativa, autenticação recente | prazo e intervalo de reenvio |
| `enrollPhoneConfirm` | `phone`, `code` | conta ativa, autenticação recente | `phone`, `phoneVerified` |
| `requestPasswordResetSms` | `email`, `phone` | público | mensagem genérica |
| `confirmPasswordResetSms` | `email`, `phone`, `code` | prova por código | `oobCode` de uso único |

Sucesso: `{ "ok": true, ... }`. Falha: `{ "ok": false, "error": { "code": "...", "message": "..." } }`.

Códigos principais: `unavailable-channel`, `unauthenticated`, `requires-recent-login`, `permission-denied`, `invalid-email`, `invalid-phone`, `same-email`, `email-already-in-use`, `invalid-code`, `too-many-requests`, `delivery-failed`, `service-unavailable`. O frontend deve preservar o formulário em falhas recuperáveis e pedir nova autenticação para `requires-recent-login`.

## Dados privados e manutenção

- `accountContacts/UID`: somente o próprio usuário lê segundo as regras publicadas; clientes não escrevem. Contém somente celular confirmado e horário da confirmação. O serviço também fornece esses dados por `getAccount`.
- `accountSecurity/challenges/enroll|reset`: desafios com HMAC, sal aleatório, validade, contador de tentativas e estado; nunca contém o código em texto. As chaves não expõem UID, e-mail ou telefone.
- `accountSecurity/rateLimits`: contadores com chaves HMAC, janela e validade; não contêm IP ou e-mail em texto.
- `accountSecurity/emailChanges`: correlação temporária do endereço anterior/novo, escolha do aviso e estado da notificação. Sem leitura ou gravação pelo navegador.
- Toda a árvore `accountSecurity` deve permanecer fechada ao cliente. As regras devem declarar índice `expiresAt` em `rateLimits`, `challenges/enroll`, `challenges/reset` e `emailChanges`, para a limpeza agendada.

Limites: cinco solicitações de recuperação por e-mail/hora por endereço; cinco códigos/hora por conta e celular; trinta operações de conta/hora por IP; cinco tentativas por código; intervalo de um minuto entre envios. Solicitações simultâneas reservam o desafio antes do envio; códigos consumidos ou expirados não são reutilizados. A confirmação do SMS revalida a conta e o celular antes de emitir o código Firebase. Tokens revogados, perfis desabilitados e sessões sem autenticação recente não gerenciam contatos.

`cleanupAccountSecurity` remove somente registros de segurança expirados há pelo menos 24 horas. Executa diariamente às 03:00, no fuso `America/Sao_Paulo`, em lotes limitados e com rechecagem por transação. Não lê nem altera bancas e notas. Mudança do `otpPepper` invalida códigos pendentes, sem remover os celulares já confirmados ou qualquer histórico acadêmico. Guarde as credenciais e cópias de segurança em local institucional protegido e revise acessos e dependências periodicamente.

## Verificação local

```bash
node --test tests/account-backend.test.cjs
npm run check --prefix functions
```

Os testes usam apenas registros fictícios e gateways em memória. Cobrem autorização, personalização/escape, falhas, dados acadêmicos preservados, ausência de enumeração, concorrência de confirmação/reenvio, uso único, expiração, tentativas e limites. Não enviam e-mails ou SMS reais. Para testar Cloud Functions localmente, use um projeto `demo-...`, Authentication e Database Emulators e `.secret.local` fora do controle de versão; não aponte os emuladores para credenciais ou destinatários reais.

Referências oficiais: [Admin email action links](https://firebase.google.com/docs/auth/admin/email-action-links), [generateVerifyAndChangeEmailLink](https://firebase.google.com/docs/reference/admin/node/firebase-admin.auth.baseauth#baseauthgenerateverifyandchangeemaillink), [Secret Manager nas Cloud Functions](https://firebase.google.com/docs/functions/config-env?gen=2nd), [Twilio Message Resource](https://www.twilio.com/docs/messaging/api/message-resource).
