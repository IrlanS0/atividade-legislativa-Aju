import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchAuthorReport, indexAuthorReport, parseAuthorReport } from '../lib/sapl-report.js';

const group = (heading, rows, count = rows.length) => `<div>
  <big><big><font color=#000000><center>${heading}</center></font></big></big>
  <br><b><center><font color=gray>Nº de Matérias apresentadas:</font></b> ${count}</center>
  ${rows.join('')}
  <hr>
</div>`;
const matter = (id, label = 'Indicação 18/2026', subject = 'Ementa &amp; conteúdo.') => `<p><a href="http://190.15.122.10:8080/sapl/consultas/materia/materia_mostrar_proc?cod_materia=${id}">${label}</a></b> - ${subject}`;
const html = (...groups) => '<html><body>' + groups.join('') + '</body></html>';

test('validates each official heading and preserves exact names, metadata and coauthors', () => {
  const report = parseAuthorReport(html(
    group('VINICIUS PORTO', [matter(10)]),
    group('VINICIUS PORTO', [matter(10), matter(11, 'Projeto de Lei Ordinária 12/2026')]),
    group('Vinícius Porto', [matter(12)]),
    group('PR. DIEGO', [matter(12)]),
    group('Executivo Municipal', [matter(13)]),
  ), 2026);
  assert.deepEqual([...report.keys()], ['VINICIUS PORTO', 'Vinícius Porto', 'PR. DIEGO', 'Executivo Municipal']);
  assert.equal(report.get('VINICIUS PORTO').length, 2);
  const rows = indexAuthorReport(report, [{ id: '1', name: 'Vinicius Porto' }, { id: '2', name: 'Pastor Diego' }]);
  assert.deepEqual(rows.map(({ id, authors }) => [id, authors]), [['10', ['1']], ['11', ['1']], ['12', ['1', '2']]]);
  assert.equal(rows[1].type, 'Projeto de Lei');
  assert.equal(rows[1].number, 12);
  assert.equal(rows[1].subject, 'Ementa & conteúdo.');
  assert.equal(rows[1].decision, 'unverified');
});

test('rejects incomplete or wrong-year results', () => {
  assert.throws(() => parseAuthorReport(html(group('Alex', [matter(10)], 2)), 2026));
  assert.throws(() => parseAuthorReport(html(group('Alex', [matter(10, 'Indicação 18/2025')])), 2026));
  assert.throws(() => parseAuthorReport(html(group('Alex', [matter(10), matter(10)])), 2026));
  assert.throws(() => parseAuthorReport(html(group('Alex', [matter(10)])).replace('</html>', ''), 2026));
});

test('requests the public report and skips ambiguous identity matches', async () => {
  const report = await fetchAuthorReport(2026, url => {
    assert.match(url, /resumoPropositurasAutor_index_html\?selAno=2026&impressao=1$/);
    return html(group('Vinícius Porto', [matter(10)]));
  });
  const rows = indexAuthorReport(report, [{ id: '1', name: 'Vinicius Porto' }, { id: '2', name: 'VINÍCIUS PORTO' }]);
  assert.deepEqual(rows, []);
});
