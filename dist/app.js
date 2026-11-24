import { catalog } from './data.js';
import { attendance } from './attendance.js';

const $ = id => document.getElementById(id);
const make = (tag, value, className) => {
  const element = document.createElement(tag);
  if (value !== undefined) element.textContent = value;
  if (className) element.className = className;
  return element;
};
const format = new Intl.NumberFormat('pt-BR');
const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });
const collator = new Intl.Collator('pt-BR');
const normalize = s => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const people = catalog.people.toSorted((a, b) => collator.compare(a.name, b.name));
const byPerson = new Map(people.map(p => [p.id, p]));
const types = [...new Set([...catalog.records, ...(catalog.archive ?? [])].map(r => r.type))].sort(collator.compare);
const colors = ['#197a60', '#39799a', '#cc8429', '#6c5c9b', '#a84b67', '#5b7340', '#537179', '#a56143'];
const decisions = {
  deferida: { label: 'Deferida', color: '#197a60' },
  indeferida: { label: 'Indeferida', color: '#6c5c9b' },
  unrecorded: { label: 'Sem decisão registrada', color: '#527d97' },
  unverified: { label: 'Não verificado', color: '#9d783d' },
};
const decisionKeys = Object.keys(decisions);
const checkedDecisions = new Map();
const checkingDecisions = new Set();
const attemptedDecisions = new Set();
const selected = new Set();
const live = new Map();
const liveReports = new Map();
const missing = new Set((catalog.missing ?? []).map(({ id, year }) => id + '/' + year));
const stale = new Set((catalog.stale ?? []).map(({ id, year }) => id + '/' + year));
const failedQueries = new Set();
const publishedByQuery = new Map();
for (const record of catalog.records) {
  for (const id of record.authors) {
    const key = id + '/' + record.year;
    if (!publishedByQuery.has(key)) publishedByQuery.set(key, []);
    publishedByQuery.get(key).push(record);
  }
}
const pageSize = 12;
const verificationBatchSize = 16;
let page = 1;
let filtered = [];
let refreshing = false;
let verifyingBatch = false;

for (const type of types) $('type').add(new Option(type, type));
for (const period of attendance) $('attendance-period').add(new Option(period.label, period.id));
$('coverage-text').textContent = 'O painel cruza a busca de matérias do SAPL com o relatório anual oficial. Matérias do relatório podem ter a situação pendente de consulta. As linhas sinalizadas usam a base anterior em pelo menos uma autoria selecionada.';
$('coverage-date').textContent = 'Base do SAPL coletada em ' + catalog.updated + '.';

function missingYears(id) {
  const chosen = $('year').value;
  return (chosen ? [chosen] : ['2025', '2026']).filter(year => {
    const key = id + '/' + year;
    return missing.has(key) && !live.has(key);
  });
}

function previousYears(id) {
  const chosen = $('year').value;
  return (chosen ? [chosen] : ['2025', '2026']).filter(year => {
    const key = id + '/' + year;
    return failedQueries.has(key) || retainedDetails(id, year) || (!live.has(key) && stale.has(key));
  });
}

function confirmedByReport(record, id) {
  return record.sourceLabel === 'Relatório do SAPL'
    && liveReports.get(String(record.year))?.byAuthor.get(id)?.has(record.id);
}

function retainedDetails(id, year) {
  const latest = live.get(id + '/' + year);
  return latest?.rows.some(record => latest.preserved.has(record.id) && !confirmedByReport(record, id));
}

function usesEarlierData(record) {
  return record.authors.some(id => {
    if (!selected.has(id)) return false;
    const key = id + '/' + record.year;
    const latest = live.get(key);
    if (confirmedByReport(record, id)) return false;
    return failedQueries.has(key) || (latest ? latest.preserved.has(record.id) : stale.has(key));
  });
}

function listPeople() {
  const term = normalize($('people-search').value.trim());
  const entries = people.filter(person => normalize(person.name + ' ' + person.party).includes(term));
  $('people-list').replaceChildren(...entries.map(person => {
    const label = make('label');
    const input = make('input');
    input.type = 'checkbox';
    input.checked = selected.has(person.id);
    input.addEventListener('change', () => {
      if (input.checked) selected.add(person.id);
      else selected.delete(person.id);
      update();
    });
    const party = person.group === 'former' ? person.party + ' · ex-integrante' : person.party;
    label.append(input, make('span', person.name), make('small', party));
    return label;
  }));
  if (!entries.length) $('people-list').append(make('p', 'Nenhum vereador encontrado.', 'empty-table'));
}

function setMenu(open, restoreFocus = false) {
  $('people-menu').hidden = !open;
  $('people-button').setAttribute('aria-expanded', String(open));
  if (open) {
    $('people-search').value = '';
    listPeople();
    $('people-search').focus();
  } else if (restoreFocus) $('people-button').focus();
}

function renderSelection() {
  const current = people.filter(person => selected.has(person.id));
  $('people-value').textContent = current.length === 1 ? current[0].name
    : current.length ? format.format(current.length) + ' vereadores selecionados' : 'Selecionar vereadores';
  const chips = current.map(person => {
    const button = make('button', person.name + ' ×', 'chip');
    button.type = 'button';
    button.setAttribute('aria-label', 'Remover ' + person.name);
    button.addEventListener('click', () => {
      selected.delete(person.id);
      update();
      if (!$('people-menu').hidden) listPeople();
      $('people-button').focus();
    });
    return button;
  });
  $('selected').replaceChildren(...chips);
  $('selected').hidden = !current.length;
  const officialLinks = current.filter(person => person.saplUrl).map(person => {
    const item = make('li');
    const link = make('a', person.name);
    link.href = person.saplUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    item.append(link);
    return item;
  });
  $('sapl-people').replaceChildren(...officialLinks);
  $('sapl-links').hidden = !officialLinks.length;
}

function emptyChart(symbol, message) {
  const box = make('div', undefined, 'chart-empty');
  const icon = make('span', symbol);
  icon.setAttribute('aria-hidden', 'true');
  box.append(icon, make('div', message));
  return box;
}

function renderAttendance() {
  const chart = $('attendance-chart');
  const period = attendance.find(item => item.id === $('attendance-period').value);
  const year = $('year').value;
  const source = $('attendance-source');
  if (period) source.href = period.source;
  if (!selected.size || !period || (year && year !== String(period.year))) {
    const message = !selected.size ? 'Selecione vereadores para consultar as faltas.'
      : 'As planilhas de frequência disponíveis no painel são de 2026.';
    chart.replaceChildren(emptyChart('▥', message));
    return;
  }
  const shown = people.filter(person => selected.has(person.id));
  const max = Math.max(1, ...shown.flatMap(person => {
    const counts = period.counts[person.id];
    return counts ? [counts.justified, counts.unjustified] : [];
  }));
  const groups = make('div', undefined, 'bars');
  for (const person of shown) {
    const group = make('div', undefined, 'attendance-person');
    group.append(make('h3', person.name));
    const counts = period.counts[person.id];
    if (!counts) {
      group.append(make('p', 'Sem registro na planilha deste período.'));
    } else {
      for (const [key, label] of [['justified', 'Justificadas'], ['unjustified', 'Não justificadas']]) {
        const series = make('div', undefined, 'attendance-series attendance-' + key);
        const track = make('div', undefined, 'track');
        track.setAttribute('aria-hidden', 'true');
        const bar = make('span');
        bar.style.width = (counts[key] / max * 100) + '%';
        track.append(bar);
        series.append(make('span', label), track, make('strong', format.format(counts[key])));
        group.append(series);
      }
    }
    groups.append(group);
  }
  chart.replaceChildren(groups);
}

function decisionFor(record) {
  const verified = checkedDecisions.get(record.id) ?? record;
  const explicit = record.decision === 'deferida' || record.decision === 'indeferida';
  const newer = explicit && (verified.decision === 'unrecorded'
    || (record.decisionDate && record.decisionDate > (verified.decisionDate ?? '')));
  const current = newer ? record : verified;
  return Object.hasOwn(decisions, current.decision) ? current : { decision: 'unverified' };
}

function dateLabel(iso) {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso ?? '') ? iso.split('-').reverse().join('/') : '';
}

function renderPie(target, entries, total) {
  const layout = make('div', undefined, 'pie-layout');
  const ring = make('div', undefined, 'pie');
  ring.setAttribute('aria-hidden', 'true');
  ring.append(make('span', format.format(total)));
  const legend = make('ul', undefined, 'legend');
  const segments = [];
  let end = 0;
  for (const { label, count, color } of entries) {
    const fraction = count / total;
    const start = end;
    end += fraction * 100;
    const entry = make('li');
    const dot = make('i');
    dot.style.backgroundColor = color;
    entry.append(dot, make('span', label), make('strong', format.format(count) + ' · ' + percent.format(fraction)));
    legend.append(entry);
    if (count) segments.push(color + ' ' + start + '% ' + end + '%');
  }
  ring.style.background = 'conic-gradient(' + segments.join(', ') + ')';
  layout.append(ring, legend);
  target.replaceChildren(layout);
}

function renderDecisionCharts() {
  const bars = $('decision-bars');
  const pie = $('decision-pie');
  const button = $('check-decisions');
  button.disabled = verifyingBatch || !filtered.some(record => record.id
    && decisionFor(record).decision === 'unverified' && !checkingDecisions.has(record.id));
  if (!filtered.length) {
    const message = selected.size ? 'Nenhuma matéria no recorte selecionado.' : 'Selecione vereadores para ver as decisões.';
    $('decision-coverage').textContent = message;
    bars.replaceChildren(emptyChart('▥', message));
    pie.replaceChildren(emptyChart('◔', message));
    return;
  }
  const blank = () => Object.fromEntries(decisionKeys.map(key => [key, 0]));
  const totals = blank();
  const byAuthor = new Map(people.filter(person => selected.has(person.id)).map(person => [person.id, blank()]));
  for (const record of filtered) {
    const { decision } = decisionFor(record);
    totals[decision]++;
    for (const id of record.authors) {
      const counts = byAuthor.get(id);
      if (counts) counts[decision]++;
    }
  }
  $('decision-coverage').textContent = format.format(filtered.length - totals.unverified)
    + ' de ' + format.format(filtered.length) + ' matérias com verificação no recorte.';
  const groups = [...byAuthor].map(([id, counts]) => ({
    id, counts, sum: decisionKeys.reduce((sum, key) => sum + counts[key], 0),
  }));
  const largest = Math.max(1, ...groups.map(group => group.sum));
  const rows = make('div', undefined, 'bars');
  for (const { id, counts, sum } of groups) {
    const row = make('div');
    const caption = make('div', undefined, 'bar-caption');
    const partial = missingYears(id).length ? ' · parcial' : '';
    caption.append(make('span', byPerson.get(id).name), make('span', format.format(sum) + partial));
    const track = make('div', undefined, 'track decision-track');
    track.setAttribute('aria-hidden', 'true');
    const keyList = make('ul', undefined, 'decision-breakdown');
    for (const key of decisionKeys) {
      const { label, color } = decisions[key];
      const count = counts[key];
      if (count) {
        const segment = make('span');
        segment.style.width = (count / largest * 100) + '%';
        segment.style.backgroundColor = color;
        track.append(segment);
      }
      const entry = make('li');
      const dot = make('i');
      dot.style.backgroundColor = color;
      entry.append(dot, make('span', label + ' · ' + format.format(count)));
      keyList.append(entry);
    }
    row.append(caption, track, keyList);
    rows.append(row);
  }
  bars.replaceChildren(rows);
  renderPie(pie, decisionKeys.map(key => ({ ...decisions[key], count: totals[key] })), filtered.length);
}

function renderCharts() {
  const bars = $('bar-chart');
  const pie = $('pie-chart');
  if (!selected.size) {
    bars.replaceChildren(emptyChart('▥', 'Selecione vereadores para comparar.'));
    pie.replaceChildren(emptyChart('◔', 'Selecione vereadores para ver a distribuição.'));
    return;
  }
  const counts = new Map([...selected].map(id => [id, 0]));
  const categories = new Map();
  for (const record of filtered) {
    categories.set(record.type, (categories.get(record.type) || 0) + 1);
    for (const id of record.authors) {
      if (counts.has(id)) counts.set(id, counts.get(id) + 1);
    }
  }
  const ordered = [...counts].sort(([idA, a], [idB, b]) => b - a || collator.compare(byPerson.get(idA).name, byPerson.get(idB).name));
  const max = Math.max(1, ordered[0][1]);
  const result = make('div', undefined, 'bars');
  for (const [id, count] of ordered) {
    const row = make('div');
    const label = make('div', undefined, 'bar-caption');
    const track = make('div', undefined, 'track');
    const bar = make('span');
    bar.style.width = (count / max * 100) + '%';
    track.setAttribute('aria-hidden', 'true');
    track.append(bar);
    const unavailable = missingYears(id);
    const countLabel = !count && unavailable.length === ($('year').value ? 1 : 2)
      ? 'Sem consulta'
      : format.format(count) + (unavailable.length ? ' · parcial' : '');
    label.append(make('span', byPerson.get(id).name), make('span', countLabel));
    row.append(label, track);
    result.append(row);
  }
  bars.replaceChildren(result);
  if (!filtered.length) {
    pie.replaceChildren(emptyChart('◔', 'Nenhuma matéria no recorte selecionado.'));
    return;
  }
  const entries = [...categories].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]))
    .map(([label, count]) => ({ label, count, color: colors[types.indexOf(label) % colors.length] }));
  renderPie(pie, entries, filtered.length);
}

function fillDecisionCell(cell, record) {
  const { decision, decisionDate } = decisionFor(record);
  cell.replaceChildren(make('span', decisions[decision].label, 'decision-label'));
  const date = dateLabel(decisionDate);
  if (date) {
    const time = make('time', date, 'decision-date');
    time.dateTime = decisionDate;
    cell.append(time);
  }
  if (decision !== 'unverified' || !record.id) return;
  const checking = checkingDecisions.has(record.id);
  const button = make('button', checking ? 'Verificando…' : 'Verificar no SAPL', 'link');
  button.type = 'button';
  button.disabled = checking;
  button.setAttribute('aria-label', 'Verificar decisão de ' + record.type + ' ' + record.number + '/' + record.year);
  button.addEventListener('click', () => verifyDecision(cell, record, button));
  cell.append(button);
}

async function checkDecision(record) {
  checkingDecisions.add(record.id);
  let verified = { decision: 'unverified' };
  try {
    const url = '/api/decisao?' + new URLSearchParams({ materia: record.id });
    const response = await fetch(url, { signal: AbortSignal.timeout(21000) });
    if (response.status === 429) verified.rateLimited = true;
    const result = response.ok ? await response.json() : null;
    if (result && Object.hasOwn(decisions, result.decision)) verified = result;
  } catch {
    // The row remains unverified if its official record cannot be read.
  }
  if (verified.decision !== 'unverified') checkedDecisions.set(record.id, verified);
  checkingDecisions.delete(record.id);
  return verified;
}

async function verifyDecision(cell, record, button) {
  if (checkingDecisions.has(record.id)) return;
  button.disabled = true;
  button.textContent = 'Verificando…';
  const verified = await checkDecision(record);
  const visibleCell = document.getElementById('decision-' + record.id);
  if (visibleCell) {
    const restoreFocus = cell === visibleCell && (document.activeElement === button || document.activeElement === document.body);
    fillDecisionCell(visibleCell, record);
    if (restoreFocus) (visibleCell.querySelector('button') ?? visibleCell).focus();
  }
  $('decision-status').textContent = record.type + ' ' + record.number + '/' + record.year + '. ' + decisions[verified.decision].label + '.';
  renderDecisionCharts();
}

async function verifyDecisionBatch() {
  if (verifyingBatch) return;
  const pending = filtered.filter(record => record.id && decisionFor(record).decision === 'unverified'
    && !checkingDecisions.has(record.id));
  const unattempted = pending.filter(record => !attemptedDecisions.has(record.id));
  const batch = (unattempted.length ? unattempted : pending).slice(0, verificationBatchSize);
  if (!batch.length) return;
  verifyingBatch = true;
  $('check-decisions').disabled = true;
  const notice = $('batch-status');
  notice.hidden = false;
  let resolved = 0;
  let completed = 0;
  let rateLimited = false;
  const announce = () => {
    notice.textContent = 'Consultadas ' + completed + ' de ' + batch.length + ' matérias nesta rodada.';
  };
  announce();
  for (let start = 0; start < batch.length; start += 2) {
    const pair = batch.slice(start, start + 2);
    await Promise.all(pair.map(async record => {
      if (checkingDecisions.has(record.id) || decisionFor(record).decision !== 'unverified') return;
      attemptedDecisions.add(record.id);
      const result = await checkDecision(record);
      if (result.decision !== 'unverified') resolved++;
      rateLimited ||= Boolean(result.rateLimited);
      completed++;
    }));
    announce();
    if (rateLimited) break;
  }
  verifyingBatch = false;
  notice.textContent = resolved + ' de ' + completed + ' consultas concluíram a verificação nesta rodada. '
    + (completed - resolved) + ' ficaram inconclusivas.'
    + (rateLimited ? ' O SAPL limitou as consultas desta rodada.' : '');
  const focused = document.activeElement?.closest?.('.decision-cell');
  const focusedId = focused?.id;
  renderDecisionCharts();
  renderTable();
  if (focusedId) {
    const current = document.getElementById(focusedId);
    (current?.querySelector('button') ?? current)?.focus();
  }
}

function renderTable() {
  $('empty-table').hidden = Boolean(filtered.length);
  $('table-wrap').hidden = !filtered.length;
  $('export').disabled = !filtered.length;
  if (!filtered.length) {
    $('empty-table').textContent = !selected.size ? 'Selecione vereadores para consultar as matérias.'
      : [...selected].some(id => missingYears(id).length)
        ? 'Sem matérias nos dados disponíveis para este recorte. Há consultas pendentes.'
        : 'Nenhuma matéria localizada no SAPL para estes filtros.';
    $('rows').replaceChildren();
    return;
  }
  const start = (page - 1) * pageSize;
  $('rows').replaceChildren(...filtered.slice(start, start + pageSize).map(record => {
    const row = make('tr');
    const matter = make('td');
    matter.append(make('strong', record.type + ' ' + record.number + '/' + record.year), make('span', record.subject));
    const decision = make('td', undefined, 'decision-cell');
    if (record.id) {
      decision.id = 'decision-' + record.id;
      decision.tabIndex = -1;
    }
    fillDecisionCell(decision, record);
    const source = make('td');
    const link = make('a', record.sourceLabel);
    link.href = record.source;
    link.target = '_blank';
    link.rel = 'noopener';
    source.append(link);
    if (usesEarlierData(record)) source.append(make('span', 'Base anterior', 'source-note'));
    row.append(matter, make('td', authors(record)), decision, make('td', record.stage), source);
    return row;
  }));
  $('page-info').textContent = (start + 1) + '–' + Math.min(start + pageSize, filtered.length) + ' de ' + format.format(filtered.length);
  $('prev').disabled = page === 1;
  $('next').disabled = start + pageSize >= filtered.length;
}

function authors(record) {
  return record.authors.map(id => byPerson.get(id).name).sort(collator.compare).join(', ');
}

function recordsForSelection() {
  const records = new Map();
  for (const record of catalog.records) {
    const remaining = record.authors.filter(id => !live.has(id + '/' + record.year));
    if (remaining.length) records.set(record.id, { ...record, authors: remaining });
  }
  for (const [key, { rows, preserved }] of live) {
    const id = key.split('/')[0];
    for (const record of rows) {
      const previous = records.get(record.id);
      const details = previous && preserved.has(record.id) ? previous : record;
      records.set(record.id, { ...details, authors: [...(previous?.authors ?? []), id] });
    }
  }
  for (const { rows } of liveReports.values()) {
    for (const record of rows) {
      const previous = records.get(record.id);
      records.set(record.id, {
        ...(previous ?? record),
        authors: [...new Set([...(previous?.authors ?? []), ...record.authors])],
      });
    }
  }
  const keyOf = record => JSON.stringify([record.type, record.year, record.number]);
  const present = new Map([...records.values()].map(record => [keyOf(record), record]));
  for (const record of catalog.archive ?? []) {
    const authors = record.authors.filter(id => {
      const key = id + '/' + record.year;
      return missing.has(key) && !live.has(key);
    });
    if (!authors.length) continue;
    const key = keyOf(record);
    const existing = present.get(key);
    if (existing) existing.authors = [...new Set([...existing.authors, ...authors])];
    else records.set(key, { ...record, authors });
  }
  return [...records.values()];
}

function saveLiveResults(key, rows, total, year) {
  if (!Array.isArray(rows) || total !== rows.length) return false;
  const present = new Set();
  for (const record of rows) {
    if (!record || record.year !== Number(year) || typeof record.id !== 'string'
      || !/^\d{1,8}$/.test(record.id) || present.has(record.id)) return false;
    present.add(record.id);
  }
  const previous = live.get(key)?.rows ?? publishedByQuery.get(key) ?? [];
  const retained = previous.filter(record => !present.has(record.id));
  live.set(key, { rows: [...rows, ...retained], preserved: new Set(retained.map(record => record.id)) });
  failedQueries.delete(key);
  return true;
}

async function refresh() {
  if (refreshing || !selected.size) return;
  const chosenYear = $('year').value;
  const years = chosenYear ? [chosenYear] : ['2025', '2026'];
  const queries = [...selected].flatMap(id => years.map(year => ({ id, year })));
  refreshing = true;
  $('refresh').disabled = true;
  $('refresh-status').hidden = false;
  $('refresh-status').textContent = 'Consultando dados no SAPL…';
  let successes = 0;
  let rateLimited = false;
  await Promise.all(years.map(async year => {
    try {
      const response = await fetch('/api/sapl-relatorio?' + new URLSearchParams({ ano: year }),
        { signal: AbortSignal.timeout(13000) });
      rateLimited ||= response.status === 429;
      if (!response.ok) return;
      const { rows, total } = await response.json();
      if (!Array.isArray(rows) || !rows.length || total !== rows.length
          || rows.some(record => record.year !== Number(year) || !record.authors?.every(id => byPerson.has(id)))) return;
      const byAuthor = new Map();
      for (const record of rows) {
        for (const id of record.authors) {
          if (!byAuthor.has(id)) byAuthor.set(id, new Set());
          byAuthor.get(id).add(record.id);
        }
      }
      liveReports.set(year, { rows, byAuthor });
    } catch {
      // The last available report remains in use if this request fails.
    }
  }));
  for (let start = 0; !rateLimited && start < queries.length; start += 2) {
    await Promise.all(queries.slice(start, start + 2).map(async ({ id, year }) => {
      const key = id + '/' + year;
      try {
        const params = new URLSearchParams({ vereador: id, ano: year });
        const response = await fetch('/api/sapl?' + params, { signal: AbortSignal.timeout(48000) });
        rateLimited ||= response.status === 429;
        if (!response.ok) throw new Error('Consulta indisponível');
        const { rows, total } = await response.json();
        if (!saveLiveResults(key, rows, total, year)) throw new Error('Resposta incompleta');
        successes++;
      } catch {
        failedQueries.add(key);
      }
    }));
    if (rateLimited) break;
  }
  refreshing = false;
  const retainedQueries = queries.filter(({ id, year }) => retainedDetails(id, year)).length;
  $('refresh-status').textContent = 'Consultas concluídas no SAPL: ' + successes + ' de ' + queries.length + '.'
    + (successes < queries.length ? ' Consultas com falha mantêm os últimos dados disponíveis.' : '')
    + (retainedQueries ? ' Resultados com lacunas mantêm as matérias ausentes na base anterior.' : '')
    + (rateLimited ? ' O SAPL limitou as consultas desta rodada.' : '');
  update();
}

function update() {
  page = 1;
  const year = $('year').value;
  const type = $('type').value;
  $('clear').disabled = !selected.size && !year && !type;
  const records = live.size || liveReports.size || missing.size ? recordsForSelection() : catalog.records;
  const availableTypes = [...new Set(records.map(r => r.type))].sort(collator.compare);
  for (const newType of availableTypes) {
    if (!types.includes(newType)) {
      types.push(newType);
      $('type').add(new Option(newType, newType));
    }
  }
  $('refresh').disabled = refreshing || !selected.size;
  filtered = records.filter(r => (!year || String(r.year) === year) && (!type || r.type === type) && r.authors.some(id => selected.has(id)));
  if (live.size || liveReports.size || missing.size) filtered.sort((a, b) => b.year - a.year || collator.compare(a.type, b.type) || b.number - a.number);
  const active = Boolean(selected.size);
  const pending = [...selected].flatMap(id => missingYears(id).map(y => byPerson.get(id).name + ' (' + y + ')'));
  const prior = [...selected].flatMap(id => previousYears(id).map(y => byPerson.get(id).name + ' (' + y + ')'));
  const hasData = active && (filtered.length > 0 || pending.length < selected.size * (year ? 1 : 2));
  $('summary').textContent = !active ? 'Selecione vereadores para ver os indicadores.'
    : pending.length ? 'Consultas pendentes no SAPL: ' + pending.join(', ') + '.'
    : prior.length ? 'Resultados com dados da base anterior: ' + prior.join(', ') + '.'
    : 'Indicadores das matérias localizadas no SAPL para a seleção atual.';
  $('total').textContent = hasData ? format.format(filtered.length) : '—';
  $('bills').textContent = hasData ? format.format(filtered.filter(r => r.type.startsWith('Projeto de Lei')).length) : '—';
  $('authors').textContent = active ? format.format(selected.size) : '—';
  renderSelection();
  renderCharts();
  renderDecisionCharts();
  renderTable();
  renderAttendance();
}

$('people-button').addEventListener('click', () => setMenu($('people-menu').hidden));
$('people-search').addEventListener('input', listPeople);
$('people-done').addEventListener('click', () => setMenu(false, true));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('people-menu').hidden) setMenu(false, true);
});
document.addEventListener('click', event => {
  if (!event.target.closest('.people') && !$('people-menu').hidden) setMenu(false);
});
$('year').addEventListener('change', update);
$('attendance-period').addEventListener('change', renderAttendance);
$('type').addEventListener('change', update);
$('refresh').addEventListener('click', refresh);
$('check-decisions').addEventListener('click', verifyDecisionBatch);
$('clear').addEventListener('click', () => {
  selected.clear();
  $('year').value = '';
  $('type').value = '';
  if (!refreshing) $('refresh-status').hidden = true;
  if (!verifyingBatch) $('batch-status').hidden = true;
  update();
});
$('prev').addEventListener('click', () => { page--; renderTable(); });
$('next').addEventListener('click', () => { page++; renderTable(); });
$('export').addEventListener('click', () => {
  const lines = [['Tipo', 'Número', 'Ano', 'Assunto', 'Autoria', 'Decisão', 'Data da decisão', 'Estágio registrado', 'Fonte', 'Cobertura'],
    ...filtered.map(r => {
      const { decision, decisionDate } = decisionFor(r);
      return [r.type, r.number, r.year, r.subject ?? '', authors(r), decisions[decision].label, dateLabel(decisionDate), r.stage, r.source,
        usesEarlierData(r) ? 'Base anterior' : ''];
    })];
  const quote = value => {
    const text = String(value);
    const literal = /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
    return '"' + literal.replaceAll('"', '""') + '"';
  };
  const csv = '\uFEFF' + lines.map(columns => columns.map(quote).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = make('a');
  link.href = url;
  link.download = 'materias-legislativas-aracaju.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
for (const link of document.querySelectorAll('nav a')) {
  link.addEventListener('click', () => {
    document.querySelector('nav .active')?.classList.remove('active');
    link.classList.add('active');
  });
}
update();
