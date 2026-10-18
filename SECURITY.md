# Segurança e privacidade do BancaFlow

O sistema apoia a organização e a avaliação de bancas acadêmicas. Responsável: Prof. Bruno Michel Pera. Administração dos acessos: coordenador Alberson. Hospedagem atual: GitHub Pages. Autenticação e dados: Firebase, projeto `avaliadortcc`.

O login usa uma conta própria do aplicativo. Senhas não são armazenadas em `users`, nas planilhas ou nos relatórios. A configuração pública do SDK identifica o projeto e não é uma credencial administrativa. O acesso aos dados depende da autenticação e das regras do Realtime Database.

## Comunicar falhas

Procure a coordenação por um canal já conhecido. Informe a URL, a ação realizada, a data e a mensagem de erro, sem expor credenciais ou notas de alunos. Não publique dados pessoais, tokens ou senhas em issues públicas.

## Avisos do navegador

Em 18/10/2026, o endereço público respondeu HTTP 200 por HTTPS e redirecionou HTTP para HTTPS. Não foi observado erro de certificado no cliente de teste nem recurso de rede em HTTP no código. Essas verificações não comprovam a ausência de classificação no Safe Browsing ou em um antivírus.

A consulta pública do Google Transparency Report em 18/10/2026 retornou status 2 para `perabru.github.io/banca-flow/`. O código do próprio serviço associa esse status a **Este site não é seguro**; a resposta também contém uma sinalização de conteúdo que pode enganar visitantes a compartilhar informações pessoais ou baixar programas. Isso confirma uma classificação externa do Google, distinta de um erro TLS. A consulta não comprova a causa exata, um comprometimento ou a legitimidade de cada conteúdo.

Alterar o HTML não remove automaticamente essa classificação. Não desative as proteções do navegador como solução. Consulte o [resultado público](https://transparencyreport.google.com/safe-browsing/search?url=perabru.github.io%2Fbanca-flow%2F) e solicite revisão após conferir as correções.

Para um alerta do Google:

1. O responsável verifica a propriedade no [Search Console](https://search.google.com/search-console) e consulta **Problemas de segurança**.
2. Confere os URLs sinalizados e corrige os problemas identificados.
3. Solicita a revisão no relatório. Se a classificação estiver incorreta, também pode usar o [formulário oficial de classificação incorreta](https://safebrowsing.google.com/safebrowsing/report_error/).

Texto de apoio para a revisão, a ser conferido pelo responsável:

> O BancaFlow é uma ferramenta acadêmica de organização e avaliação de bancas de TCC, administrada pelo Prof. Bruno Michel Pera e pela coordenação do Prof. Alberson para uso por professores da Univap. O endereço é https://perabru.github.io/banca-flow/. O site identifica os responsáveis, a finalidade, a hospedagem e o uso de uma conta própria do aplicativo; a autenticação utiliza Firebase Authentication. Não solicita senhas de outros portais. Solicitamos a verificação da classificação desse endereço.

O texto descreve o aplicativo e a finalidade informada pelo responsável; não substitui a análise do Google nem comprova uma aprovação institucional independente. Nenhuma revisão externa foi submetida automaticamente.

Referências: [Google e serviços de terceiros](https://developers.google.com/search/docs/monitor-debug/security/social-engineering), [relatório de problemas de segurança](https://support.google.com/webmasters/answer/9044101), [HTTPS no GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https).

## Publicação e manutenção

- Nunca publique senhas, tokens, chaves de serviço ou planilhas reais no repositório público.
- Publique `database.rules.json` no Realtime Database para ativar as permissões. Atualizar o GitHub não publica regras no Firebase.
- Depois de editar o JavaScript embutido ou as regras, execute `node scripts/sync-html.cjs`. O comando incorpora as regras, recalcula o hash da Content Security Policy e espelha o segundo HTML, sem acessar o banco.
- A CSP limita scripts ao conteúdo embutido cujo hash foi conferido, aos arquivos locais, aos módulos oficiais Firebase e ao transporte Realtime Database em HTTPS. O navegador permite conexões Firebase/Google necessárias ao aplicativo. A política não equivale a uma certificação de segurança.
- A importação usa a versão local do SheetJS identificada em `assets/vendor/README.md`, sem executar fórmulas de planilhas.
