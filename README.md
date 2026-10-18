# BancaFlow — Avaliação de TCC Univap

Aplicação estática em HTML, CSS e JavaScript, conectada ao projeto Firebase existente `avaliadortcc`. `index.html` é a entrada principal; `BancaFlow_TCC_2026_Unico.html` mantém o mesmo conteúdo para preservar os acessos por esse endereço. O layout começa em 320 px e se adapta a tablets e computadores.

## Publicar a atualização

1. Publique os dois arquivos HTML da atualização no mesmo local em que o site já está hospedado (ou integre o pull request se a hospedagem acompanha `main`).
2. No Console do Firebase, abra **avaliadortcc → Realtime Database → Regras**. Publique o conteúdo de `database.rules.json`. A mesma política está no botão **Copiar política de acesso** do site.
3. Atualize a página e entre novamente. Professores que já estavam conectados devem atualizar o site.

Publicar somente o HTML não altera as regras do Firebase. O cronômetro e o encerramento/reabertura pelos professores precisam da política atualizada. Os cadastros, grupos, alunos, agendas, notas e entregas existentes são mantidos; não há migração, importação automática nem limpeza do banco. O cadastro criptografado de grupos permanece intacto.

## Permissões e avaliação

| Ação | Professor avaliador da banca | Coordenador |
| --- | --- | --- |
| Consultar/alterar suas notas com banca aberta | Sim | Sim, quando participa como avaliador |
| Consultar notas dos demais avaliadores | Não | Sim |
| Encerrar/reabrir a banca com confirmação | Sim | Sim, em qualquer banca |
| Iniciar, pausar, continuar e zerar o cronômetro | Sim | Sim |
| Consultar e lançar notas de entregas | Não | Sim |
| Emitir relatório final PDF/CSV | Não | Sim |

Professores sem vínculo com uma banca não podem encerrá-la, reabri-la nem controlar seu cronômetro. O encerramento bloqueia as notas e pausa o tempo. Pode ocorrer antes de todas as entregas; a emissão do relatório final exige a banca encerrada e todas as notas válidas. Reabrir preserva as notas e permite correções. Notas em edição precisam ser salvas antes de encerrar a banca. Se outro avaliador encerrar enquanto você edita, o rascunho é preservado e pode ser recuperado ao reabrir, sem bloquear a reabertura.

O cronômetro é compartilhado e aparece em **minutos:segundos,centésimos**, por exemplo `12:34,56`. O relógio é ajustado ao servidor e continua contando após trocar de tela, suspender a aba ou recarregar a página. Apenas as ações dos controles gravam no banco; cada centésimo é calculado na tela. Iniciar/pausar/zerar e encerrar/reabrir exigem conexão. Ao reabrir, o tempo permanece pausado até clicar em **Continuar**. Zerar pede confirmação e substitui o tempo anterior.

O PDF de avaliação baixa diretamente, sem depender da janela de impressão. Inclui os dados da banca, o tempo com centésimos, cada aluno, as quatro notas de cada professor, a média de cada avaliador, a média da banca, a nota bruta das entregas e as parcelas ponderadas. Bancas antigas sem registro de tempo apresentam **Não registrado**.

- Média do avaliador: média aritmética de Apresentação, Parte prática, Domínio do código e Domínio do tempo.
- Média da banca: média aritmética das médias dos avaliadores.
- Nota final: **média da banca × 0,60 + entregas × 0,40**.
- O cálculo usa os valores completos; o relatório exibe duas casas decimais. Zero é uma nota válida; campo ausente mantém o relatório pendente.

O PDF da agenda e o sorteio continuam disponíveis. O CSV de avaliação também inclui o tempo registrado.

## Dados e compatibilidade

As coleções originais `users`, `groups`, `boards`, `groupBoards`, `locks`, `roomLocks`, `grades`, `deliveries` e `seals` conservam seus caminhos e formatos. Encerrar cria `seals/BANCA` com `by` e `at`; reabrir remove somente esse bloqueio, preservando as avaliações.

A única coleção nova é `timers/BANCA`, com `elapsedMs`, `startedAt` (zero quando pausado), `updatedBy`, `updatedAt` e `revision`. As regras verificam a revisão para impedir que uma ação antiga sobrescreva um controle mais recente. A alteração do estado da banca e a pausa do cronômetro são atômicas.

A configuração pública do Firebase é mantida. As permissões são verificadas no banco, incluindo a exclusividade da coordenação sobre `deliveries`. A atualização não usa acesso administrativo aos dados de produção.

## Verificação local

O site continua sem etapa de compilação. Sirva os HTMLs por HTTPS ou por um servidor local; o acesso real usa Firebase Authentication, perfis já cadastrados e as regras publicadas. Para alterações de código, execute a suíte de lógica com `node --test tests/app.test.cjs`. As instruções para as verificações de regras e navegador estão em `tests/README.md`; todas usam dados fictícios e o emulador, sem gravar no banco de produção.
