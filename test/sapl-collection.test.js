import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeSnapshot } from '../lib/collection.js';
import { fetchYear } from '../lib/sapl.js';

function page(total, ids = []) {
  const rows = ids.map(id => `<td><a href="/sapl/consultas/materia/materia_mostrar_proc?cod_materia=${id}"><b>IND ${id}/2026 - Indicação</b></a><br>Ementa<br><b>Autor:</b> Pessoa</td>`);
  return `<b>Resultado da Pesquisa: ${total} matéria(s)</b>${rows.join('')}`;
}

test('retries a malformed or repeated page and verifies its unique rows', async () => {
  const requests = [];
  const records = await fetchYear('138', 2026, async address => {
    const number = new URL(address).searchParams.get('page');
    requests.push(number);
    if (requests.length === 1) throw new Error('Falha transitória');
    if (number === '1') return page(501, Array.from({ length: 500 }, (_, i) => i + 1));
    return page(501, [requests.length === 3 ? 1 : 501]);
  });
  assert.deepEqual(requests, ['1', '1', '2', '2']);
  assert.equal(records.length, 501);
  assert.equal(records.at(-1).id, '501');
});

test('rejects persistent partial responses and skips retry after abort', async () => {
  await assert.rejects(fetchYear('138', 2026, async () => page(2, [1])), /Página incompleta/);
  let rateLimitedRequests = 0;
  await assert.rejects(fetchYear('138', 2026, async () => {
    rateLimitedRequests++;
    throw Object.assign(new Error('HTTP 429'), { status: 429 });
  }), { status: 429 });
  assert.equal(rateLimitedRequests, 1);
  const controller = new AbortController();
  let requests = 0;
  await assert.rejects(fetchYear('138', 2026, async () => {
    requests++;
    controller.abort();
    throw new Error('Consulta interrompida');
  }, undefined, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(requests, 1);
});

test('splits a capped search into nonoverlapping date ranges', async () => {
  const requests = [];
  const records = await fetchYear('138', 2026, async address => {
    const params = new URL(address).searchParams;
    const range = [params.get('dt_apres'), params.get('dt_apres2')];
    requests.push(range);
    if (!range[0]) return page(2000);
    const offset = (range[0] === '01/01/2026' ? 0 : 1000) + (Number(params.get('page')) - 1) * 500;
    return page(1000, Array.from({ length: 500 }, (_, i) => offset + i + 1));
  });
  assert.deepEqual(requests, [['', ''], ['01/01/2026', '02/07/2026'], ['01/01/2026', '02/07/2026'],
    ['03/07/2026', '31/12/2026'], ['03/07/2026', '31/12/2026']]);
  assert.equal(records.length, 2000);
  assert.equal(records.at(-1).id, '2000');
});

test('supplements records from the named report without overwriting a verified decision', () => {
  const row = { id: '1', year: 2026, type: 'Indicação', number: 1, authors: ['first'] };
  const completed = [{ id: 'first', year: 2026, fresh: true }];
  const snapshot = { records: [{ ...row, decision: 'deferida' }], missing: [] };
  const withReport = mergeSnapshot(snapshot, [], completed, [], '23/11/2026', [row]);
  assert.deepEqual(withReport.records, [{ ...row, decision: 'deferida', reportAuthors: ['first'] }]);
  const retained = mergeSnapshot(withReport, [], completed, [], '24/11/2026');
  assert.deepEqual(retained.records, withReport.records);
  assert.deepEqual(retained.stale, [{ id: 'first', year: 2026 }]);
});

test('keeps previous records from failed, empty or incomplete slices, including coauthorship', () => {
  const matter = (id, authors) => ({ id, authors, number: Number(id), year: 2026, type: 'Indicação' });
  const snapshot = {
    updated: '22/11/2026',
    records: [matter('1', ['first', 'second']), matter('2', ['first']), matter('3', ['third'])],
    missing: [{ id: 'absent', year: 2026 }],
  };
  const completed = [{ id: 'first', year: 2026, fresh: true }, { id: 'third', year: 2026, fresh: true }];
  const failed = [{ id: 'second', year: 2026 }, { id: 'absent', year: 2026 }];
  const merged = mergeSnapshot(snapshot, [matter('1', ['first']), matter('4', ['first'])],
    completed, failed, '23/11/2026');
  assert.deepEqual(merged.records, [matter('4', ['first']), matter('3', ['third']), matter('2', ['first']), matter('1', ['second', 'first'])]);
  assert.deepEqual(merged.stale, [{ id: 'second', year: 2026 }, { id: 'first', year: 2026 }, { id: 'third', year: 2026 }]);
  assert.deepEqual(merged.missing, [{ id: 'absent', year: 2026 }]);
});
