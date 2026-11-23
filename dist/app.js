import { catalog } from './data.js';

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
const selected = new Set();
const live = new Map();
const missing = new Set((catalog.missing ?? []).map(({ id, year }) => id + '/' + year));
const pageSize = 12;
let page = 1;
let filtered = [];
let refreshing = false;

for (const type of types) $('type').add(new Option(type, type));
$('coverage-text').textContent = 'A fonte principal é o SAPL da Câmara de Aracaju. Quando uma consulta por vereador e ano fica pendente, o painel pode mostrar matérias já verificadas em atas e notícias oficiais. A fonte aparece em cada linha.';
$('coverage-date').textContent = 'Base do SAPL coletada em ' + catalog.updated + '.';

function missingYears(id) {
  const chosen = $('year').value;
  return (chosen ? [chosen] : ['2025', '2026']).filter(year => {
    const key = id + '/' + year;
    return missing.has(key) && !live.has(key);
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
  const layout = make('div', undefined, 'pie-layout');
  const ring = make('div', undefined, 'pie');
  ring.setAttribute('aria-hidden', 'true');
  ring.append(make('span', format.format(filtered.length)));
  const legend = make('ul', undefined, 'legend');
  let end = 0;
  const segments = [...categories].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0])).map(([label, count]) => {
    const color = colors[types.indexOf(label) % colors.length];
    const start = end;
    const fraction = count / filtered.length;
    end += fraction * 100;
    const entry = make('li');
    const dot = make('i');
    dot.style.backgroundColor = color;
    entry.append(dot, make('span', label), make('strong', format.format(count) + ' · ' + percent.format(fraction)));
    legend.append(entry);
    return color + ' ' + start + '% ' + end + '%';
  });
  ring.style.background = 'conic-gradient(' + segments.join(', ') + ')';
  layout.append(ring, legend);
  pie.replaceChildren(layout);
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
    const source = make('td');
    const link = make('a', record.sourceLabel);
    link.href = record.source;
    link.target = '_blank';
    link.rel = 'noopener';
    source.append(link);
    row.append(matter, make('td', authors(record)), make('td', record.stage), source);
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
  for (const [key, rows] of live) {
    const id = key.split('/')[0];
    for (const record of rows) {
      const authors = records.get(record.id)?.authors ?? [];
      records.set(record.id, { ...record, authors: [...authors, id] });
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
  for (let start = 0; start < queries.length; start += 4) {
    await Promise.all(queries.slice(start, start + 4).map(async ({ id, year }) => {
      try {
        const params = new URLSearchParams({ vereador: id, ano: year });
        const response = await fetch('/api/sapl?' + params, { signal: AbortSignal.timeout(48000) });
        if (!response.ok) return;
        const { rows } = await response.json();
        if (!Array.isArray(rows)) return;
        live.set(id + '/' + year, rows);
        successes++;
      } catch {
        // Keep the last successful result for this author and year.
      }
    }));
  }
  refreshing = false;
  $('refresh-status').textContent = successes === queries.length
    ? 'Dados atualizados nesta sessão.'
    : successes
      ? 'Atualização parcial. As demais consultas usam os últimos dados disponíveis.'
      : 'O painel não conseguiu consultar o SAPL. Exibindo os últimos dados disponíveis.';
  update();
}

function update() {
  page = 1;
  const year = $('year').value;
  const type = $('type').value;
  $('clear').disabled = !selected.size && !year && !type;
  const records = live.size || missing.size ? recordsForSelection() : catalog.records;
  const availableTypes = [...new Set(records.map(r => r.type))].sort(collator.compare);
  for (const newType of availableTypes) {
    if (!types.includes(newType)) {
      types.push(newType);
      $('type').add(new Option(newType, newType));
    }
  }
  $('refresh').disabled = refreshing || !selected.size;
  filtered = records.filter(r => (!year || String(r.year) === year) && (!type || r.type === type) && r.authors.some(id => selected.has(id)));
  if (live.size || missing.size) filtered.sort((a, b) => b.year - a.year || collator.compare(a.type, b.type) || b.number - a.number);
  const active = Boolean(selected.size);
  const pending = [...selected].flatMap(id => missingYears(id).map(y => byPerson.get(id).name + ' (' + y + ')'));
  const hasData = active && (filtered.length > 0 || pending.length < selected.size * (year ? 1 : 2));
  $('summary').textContent = !active ? 'Selecione vereadores para ver os indicadores.'
    : pending.length ? 'Consultas pendentes no SAPL: ' + pending.join(', ') + '.'
    : 'Indicadores das matérias localizadas no SAPL para a seleção atual.';
  $('total').textContent = hasData ? format.format(filtered.length) : '—';
  $('bills').textContent = hasData ? format.format(filtered.filter(r => r.type.startsWith('Projeto de Lei')).length) : '—';
  $('authors').textContent = active ? format.format(selected.size) : '—';
  renderSelection();
  renderCharts();
  renderTable();
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
$('type').addEventListener('change', update);
$('refresh').addEventListener('click', refresh);
$('clear').addEventListener('click', () => {
  selected.clear();
  $('year').value = '';
  $('type').value = '';
  if (!refreshing) $('refresh-status').hidden = true;
  update();
});
$('prev').addEventListener('click', () => { page--; renderTable(); });
$('next').addEventListener('click', () => { page++; renderTable(); });
$('export').addEventListener('click', () => {
  const lines = [['Tipo', 'Número', 'Ano', 'Assunto', 'Autoria', 'Estágio registrado', 'Fonte'],
    ...filtered.map(r => [r.type, r.number, r.year, r.subject, authors(r), r.stage, r.source])];
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
