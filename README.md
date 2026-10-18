# BancaFlow — Avaliação de TCC Univap

Aplicação estática em HTML, CSS e JavaScript, conectada ao projeto Firebase existente `avaliadortcc`. A atualização preserva os cadastros, grupos, alunos, agenda, notas, entregas, configuração Firebase e lista criptografada de grupos. Não faz migração destrutiva nem importação automática.

`index.html` e `BancaFlow_TCC_2026_Unico.html` oferecem a mesma versão, incluindo a mesma política de acesso atualizada. O layout começa em 320 px e se adapta a tablets e computadores. O site continua sem etapa de compilação.

## Ativar a atualização

1. No Console do Firebase, abra **avaliadortcc → Realtime Database → Regras** e publique o conteúdo completo de **database.rules.json**. A mesma política fica incorporada aos HTMLs e disponível no botão **Copiar política de acesso**.
2. Integre o pull request ou publique os dois HTMLs na hospedagem existente, usando HTTPS. Atualize a página e entre novamente; os demais professores também devem atualizar o site.
3. Mantenha os perfis já cadastrados em `users` e os dados existentes. Não reimporte os grupos nem substitua o conteúdo do banco.

O arquivo `firebase.json` também permite publicar somente as regras com `firebase deploy --only database --project avaliadortcc`, após autenticar uma conta autorizada.

Publicar arquivos no GitHub não publica as regras no Firebase. A nova política é necessária para o cronômetro compartilhado e para o encerramento/reabertura pelos avaliadores. As regras preservam a privacidade e os demais caminhos originais; não existe acesso público ao banco nem cadastro público de coordenadores.

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

## Verificação local

Sirva os HTMLs por HTTPS ou um servidor local. Os testes usam dados fictícios, um adaptador Firebase em memória ou o emulador local, sem acessar o banco de produção e sem enviar mensagens reais:

```bash
node --test tests/app.test.cjs
```

As instruções para navegador e emulador estão em `tests/README.md`.
