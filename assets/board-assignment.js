/* Planeja alterações de avaliadores sem modificar notas, alunos ou agenda. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BancaBoardAssignment = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const read = (value, key) => record(value) && own(value, key) ? value[key] : undefined;
  const activeTeacher = value => record(value) && value.active !== false && ['teacher', 'coordinator'].includes(value.role);
  const validName = value => typeof value === 'string' && value.trim() && value.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value);
  const identifier = (value, label, maximum = 128) => {
    if (typeof value !== 'string' || !value || value.length > maximum || /[.#$\[\]\/\s\u0000-\u001f\u007f]/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) {
      throw new Error(`${label} inválido.`);
    }
    return value;
  };
  const hasStoredValue = value => {
    if (value === null || value === undefined) return false;
    if (typeof value !== 'object') return true;
    return Object.values(value).some(hasStoredValue);
  };
  function schedule(board) {
    if (!record(board) || !Number.isSafeInteger(board.startAt) || board.startAt < 0 || board.startAt % 900000 !== 0 || ![30, 45, 60, 90].includes(board.durationMin)) {
      throw new Error('A banca possui data ou duração inválida. Confira sua agenda antes de alterar os avaliadores.');
    }
    const end = board.startAt + board.durationMin * 60000;
    if (!Number.isSafeInteger(end)) throw new Error('O horário da banca excede o limite permitido.');
    return { start: board.startAt, end };
  }
  function slices(board) {
    const { start, end } = schedule(board), result = [];
    for (let time = Math.floor(start / 900000) * 900000; time < end; time += 900000) result.push(String(time));
    return result;
  }
  function plan(input) {
    if (!record(input)) throw new Error('Informe os dados da atribuição da banca.');
    const { users, groups, boards, grades, seals, locks } = input;
    const actorUid = identifier(input.actorUid, 'Identificador da coordenação');
    const actor = read(users, actorUid);
    if (!activeTeacher(actor) || actor.role !== 'coordinator') throw new Error('Somente a coordenação ativa pode atribuir avaliadores às bancas.');
    const boardId = identifier(input.boardId, 'Identificador da banca', 768), board = read(boards, boardId);
    if (!record(board)) throw new Error('A banca não está disponível. Atualize a lista de bancas.');
    const revision = own(board, 'assignmentRevision') ? board.assignmentRevision : 0;
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('A revisão dos avaliadores é inválida. Atualize o cadastro da banca antes de continuar.');
    if (hasStoredValue(read(seals, boardId))) throw new Error('Reabra a banca antes de alterar seus avaliadores.');
    const group = read(groups, board.groupId);
    if (!record(group) || group.active === false) throw new Error('O grupo da banca não está ativo. Restaure o grupo antes de alterar os avaliadores.');
    const targetSchedule = schedule(board), slots = slices(board);
    if (!record(board.members) || Object.values(board.members).some(value => value !== true)) throw new Error('A composição atual da banca é inválida. Confira o cadastro antes de alterar os avaliadores.');
    const current = Object.keys(board.members);
    current.forEach(uid => identifier(uid, 'Identificador do avaliador cadastrado'));
    if (!Array.isArray(input.memberUids) || input.memberUids.length < 2 || input.memberUids.length > 3) throw new Error('Selecione exatamente 2 ou 3 professores avaliadores.');
    const selected = input.memberUids.map(uid => identifier(uid, 'Identificador do avaliador'));
    if (new Set(selected).size !== selected.length) throw new Error('Selecione professores diferentes para compor a banca.');
    for (const uid of selected) {
      const profile = read(users, uid);
      // Manter uma participação histórica não concede um novo acesso. Um
      // cadastro desabilitado ou ausente continua representado pelo nome que
      // já foi registrado na banca, inclusive ao incluir um terceiro avaliador.
      if (own(board.members, uid)) {
        if (!activeTeacher(profile) && !validName(read(board.memberNames, uid))) throw new Error('O nome histórico de um avaliador não está disponível. Confira o cadastro da banca antes de alterar a composição.');
        continue;
      }
      if (!activeTeacher(profile)) throw new Error('Todos os avaliadores selecionados precisam ter um cadastro ativo de professor ou coordenador.');
      if (!validName(profile.name)) throw new Error('O nome de um avaliador está inválido. Atualize seu cadastro antes de atribuir a banca.');
    }
    const added = selected.filter(uid => !own(board.members, uid)), removed = current.filter(uid => !selected.includes(uid)), unchanged = selected.filter(uid => own(board.members, uid));
    const boardGrades = read(grades, boardId);
    for (const uid of removed) if (hasStoredValue(read(boardGrades, uid))) throw new Error('Não é possível retirar um avaliador que já possui notas nesta banca. As avaliações registradas precisam ser preservadas.');
    // As bancas e as reservas são verificadas separadamente: um catálogo com
    // reservas incompletas não pode permitir duas atribuições no mesmo horário.
    for (const uid of added) {
      for (const [otherId, other] of Object.entries(record(boards) ? boards : {})) {
        if (otherId === boardId || read(other?.members, uid) !== true) continue;
        const otherSchedule = schedule(other);
        if (targetSchedule.start < otherSchedule.end && otherSchedule.start < targetSchedule.end) throw new Error(`${read(users, uid).name} já participa de outra banca neste horário.`);
      }
      for (const slot of slots) {
        const occupied = read(read(locks, slot), uid);
        if (occupied !== undefined && occupied !== null && occupied !== boardId) throw new Error(`${read(users, uid).name} possui uma reserva de horário em outra banca.`);
      }
    }
    const changes = {};
    for (const uid of added) {
      changes[`boards/${boardId}/members/${uid}`] = true;
      changes[`boards/${boardId}/memberNames/${uid}`] = read(users, uid).name;
      for (const slot of slots) if (read(read(locks, slot), uid) !== boardId) changes[`locks/${slot}/${uid}`] = boardId;
    }
    for (const uid of removed) {
      changes[`boards/${boardId}/members/${uid}`] = null;
      changes[`boards/${boardId}/memberNames/${uid}`] = null;
      for (const slot of slots) if (read(read(locks, slot), uid) === boardId) changes[`locks/${slot}/${uid}`] = null;
    }
    if (added.length || removed.length) {
      if (revision >= Number.MAX_SAFE_INTEGER) throw new Error('A revisão dos avaliadores atingiu o limite permitido.');
      changes[`boards/${boardId}/assignmentRevision`] = revision + 1;
    }
    return { changes, members: Object.fromEntries(selected.map(uid => [uid, true])), added, removed, unchanged };
  }
  return Object.freeze({ plan });
});
