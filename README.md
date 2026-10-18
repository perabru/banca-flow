# BancaFlow — Avaliação de TCC Univap

Aplicação estática em HTML, CSS e JavaScript, conectada ao projeto Firebase existente `avaliadortcc`. A atualização mantém os dados, a configuração do Firebase e as regras originais. Não exige publicar regras nem cria novos caminhos no banco.

`index.html` é a entrada principal. `BancaFlow_TCC_2026_Unico.html` oferece a mesma interface e funcionalidades, preservando o bloco de regras que já existia nesse arquivo. Os dois blocos de regras são mantidos byte a byte, sem uniformizar políticas diferentes. O layout começa em 320 px e se adapta a tablets e computadores.

## Publicação

Integre o pull request ou publique os dois HTMLs na hospedagem existente. Atualize a página. Nenhuma alteração de permissões ou configuração no Console do Firebase faz parte desta atualização.

Os cadastros, grupos, alunos, agendas, notas e entregas existentes são mantidos; não há migração, importação automática nem limpeza do banco. O cadastro criptografado de grupos permanece intacto.

## Encerramento e reabertura

As ações usam somente o caminho `seals/BANCA`, que já existe no sistema. O site pede confirmação e só confirma o sucesso após a resposta do Firebase. Uma recusa de permissão exibe uma mensagem específica e preserva o estado oficial e as notas. O site não simula encerramento ou reabertura local.

**Limitação das regras originais incluídas no `index.html`:** somente o coordenador pode encerrar uma banca; nem o coordenador nem professores podem remover o encerramento para reabri-la. Os botões de solicitação respeitam as permissões que já estão publicadas no banco. Se a política em produção já permitir essas ações, elas funcionarão; esta atualização não amplia permissões.

Para evitar concluir uma banca incompleta que não possa ser reaberta, o coordenador precisa ter todas as notas individuais e as entregas antes do encerramento. Professores precisam salvar suas próprias notas antes de solicitar o encerramento. Notas em edição são preservadas durante atualizações da tela; trocar de conta limpa os campos da sessão anterior.

Somente o coordenador continua lançando e consultando a nota de entregas e emitindo relatórios finais. Cada professor acessa apenas suas notas, como antes.

## Cronômetro e tempo no PDF

O cronômetro usa **minutos:segundos,centésimos**, por exemplo `12:34,56`. O tempo fica no armazenamento deste navegador, separado por conta e banca. Ele continua contando ao trocar de tela ou recarregar a página e funciona sem conexão. O cronômetro não é sincronizado entre dispositivos nem gravado no Firebase. Iniciar, pausar, continuar e zerar não acessam o banco. Zerar pede confirmação.

Quando a banca é encerrada com sucesso ou o site recebe um encerramento oficial, o cronômetro local é pausado. Uma tentativa negada pelo Firebase não pausa permanentemente o tempo. Se o navegador bloquear o armazenamento, a tela informa que o tempo está temporário e orienta exportá-lo antes de sair.

Para levar o tempo medido pelo professor ao PDF:

1. O professor pausa o cronômetro e clica em **Exportar tempo atual**. O arquivo JSON contém o identificador da banca e o tempo medido, sem notas dos alunos.
2. O professor entrega esse arquivo à coordenação por um meio escolhido por ele.
3. O coordenador abre **Relatórios → Tempo / detalhes → Importar tempo do professor** e escolhe o arquivo da mesma banca.
4. O tempo fica disponível no navegador da coordenação para o PDF. Também é possível digitar o valor em **Tempo para o relatório PDF** e clicar em **Registrar tempo neste navegador**.

A importação verifica o projeto e a banca para impedir registros trocados. O coordenador pode registrar ou importar o tempo mesmo depois do encerramento; isso não modifica as notas nem o banco. Uma duração de `00:00,00` é aceita. Sem um tempo registrado na conta e navegador da coordenação, o PDF informa **Não registrado**.

## Relatórios e cálculo

O PDF de avaliação baixa diretamente. Inclui os dados da banca, tempo com centésimos, cada aluno, as quatro notas de cada professor, a média de cada avaliador, a média da banca, a nota bruta das entregas, as parcelas ponderadas e a nota final. A emissão exige uma banca oficialmente encerrada e todas as notas válidas.

- Média do avaliador: média aritmética de Apresentação, Parte prática, Domínio do código e Domínio do tempo.
- Média da banca: média aritmética das médias dos avaliadores.
- Nota final: **média da banca × 0,60 + entregas × 0,40**.
- O cálculo usa os valores completos; o relatório exibe duas casas decimais. Zero é uma nota válida; campos ausentes mantêm o relatório pendente.

O PDF da agenda e o sorteio continuam disponíveis. O CSV de avaliação também inclui o tempo local disponível na coordenação.

## Verificação local

O site continua sem etapa de compilação. Sirva os HTMLs por HTTPS ou por um servidor local. Os testes usam apenas dados fictícios e o emulador local, sem acessar o banco de produção:

```bash
node --test tests/app.test.cjs
```

As instruções para o navegador real e a verificação das permissões originais estão em `tests/README.md`.
