/* Ative somente depois de publicar o serviço e configurar os envios no servidor.
   Este arquivo contém apenas configuração pública, nunca senhas ou tokens. */
globalThis.BancaAccountConfig=Object.freeze({
  enabled:false,
  serviceUrl:'https://southamerica-east1-avaliadortcc.cloudfunctions.net/accountService',
  timeoutMs:15000
});
