import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decisionFromEntries } from '../lib/decision.js';
import { parseDecisionHistory, parsePage } from '../lib/sapl.js';

const records = (...rows) => `<b>Resultado da Pesquisa: ${rows.length} matéria(s)</b>${rows.join('')}`;
const listing = (stage, action, id = 123) => `<td>
  <a href="http://190.15.122.10:8080/sapl/consultas/materia/materia_mostrar_proc?cod_materia=${id}"><b>IND 2/2026 - Indicação</b></a><br>
  Ementa original<br><b>Autor:</b> Pessoa<br><b>Situação:</b> ${stage}<br>
  <b>Última Ação:</b> ${action} <b>Em:</b> 17/02/2026<br></td>`;
const event = (date, stage, action) => `<tr><td><b>Data:</b> ${date}</td></tr>
  <tr><td><b>Situação:</b> ${stage}</td></tr><tr><td><b>Última Ação:</b> ${action}</td></tr>`;
const history = (...entries) => `<fieldset><legend>Tramitação</legend><table>${entries.join('')}</table></fieldset>`;

test('extracts an explicit decision and date while discarding the reason', () => {
  const { rows } = parsePage(records(listing('Proposição arquivada por duplicidade',
    'Propositura indeferida por motivo reservado.')), 2026);
  assert.equal(rows[0].decision, 'indeferida');
  assert.equal(rows[0].decisionDate, '2026-02-17');
  assert.equal(rows[0].stage, 'Proposição arquivada');
  assert.doesNotMatch(JSON.stringify(rows[0]), /motivo reservado|duplicidade|Última Ação/);
});

test('keeps generic stages and third-party mentions outside the binary decision', () => {
  for (const stage of ['Proposição arquivada', 'Proposição rejeitada pelo Plenário', 'Proposição aprovada', 'Proposição retirada pelo autor']) {
    assert.deepEqual(decisionFromEntries([{ stage, action: 'Solicita análise de pedido indeferido.' }]),
      { decision: 'unverified' });
  }
  assert.deepEqual(decisionFromEntries([{ stage: 'Proposição aprovada', action: 'Propositura indeferida.' }], true),
    { decision: 'unverified' });
});

test('uses only the latest dated explicit decision in a readable history', () => {
  assert.deepEqual(parseDecisionHistory(history(
    event('20/02/2026', 'Proposição arquivada', 'Encaminhada ao arquivo.'),
    event('18/02/2026', '', 'Indicação indeferida por motivo reservado.'),
    event('17/02/2026', '', 'Indicação deferida e encaminhada ao setor.')
  )), { decision: 'indeferida', decisionDate: '2026-02-18' });
});

test('distinguishes reviewed, unknown and inconclusive histories', () => {
  assert.deepEqual(parseDecisionHistory(history(event('20/02/2026', 'Proposição rejeitada pelo Plenário', 'Encaminhada ao arquivo.'))),
    { decision: 'unrecorded' });
  assert.deepEqual(parseDecisionHistory('<h1>Serviço indisponível</h1>'), { decision: 'unverified' });
  assert.deepEqual(parseDecisionHistory(history(
    event('20/02/2026', '', 'Proposição deferida.'),
    event('20/02/2026', '', 'Proposição indeferida.')
  )), { decision: 'unverified' });
  assert.deepEqual(parseDecisionHistory(history(event('20/02/2026', '', 'Proposição deferida parcialmente.'))),
    { decision: 'unverified' });
});
