import { decodeHTML } from 'entities';

const origin = 'http://190.15.122.10:8080';
const reportPath = '/sapl/relatorios_administrativos/resumoPropositurasAutor/resumoPropositurasAutor_index_html';
const detailPath = '/sapl/consultas/materia/materia_mostrar_proc';
const clean = value => decodeHTML(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const normalizeName = name => name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
const verifiedHeadings = {
  'Miltinho Dantas': 'MILTINHO',
  'Pastor Diego': 'PR. DIEGO',
  'Professora Sonia Meire': 'PROFª SONIA MEIRE',
  'Rodrigo Fontes': 'Rodrigo Fontes Almeida',
  'Sávio Neto de Vardo': 'SÁVIO NETO DE VARDO LOTÉRICA',
  'Avilé Dantas': 'Avilé',
};

export function parseAuthorReport(html, year) {
  const report = new Map();
  const groups = html.matchAll(/<big>\s*<big>\s*<font\b[^>]*>\s*<center>([\s\S]*?)<\/center>\s*<\/font>\s*<\/big>\s*<\/big>([\s\S]*?)(?=<hr\b)/gi);
  let matched = 0;
  for (const [, heading, group] of groups) {
    const name = clean(heading);
    const count = clean(group).match(/^Nº de Matérias apresentadas:\s*(\d+)/i);
    if (!name || !count) throw new Error('Grupo de autoria inválido no relatório do SAPL');
    const entries = [...group.matchAll(/<a\b[^>]*?\bhref=(["'])(?:https?:\/\/[^\s"']+)?\/sapl\/consultas\/materia\/materia_mostrar_proc\?cod_materia=(\d+)\1[^>]*>([\s\S]*?)<\/a>/gi)];
    if (entries.length !== Number(count[1]) || new Set(entries.map(entry => entry[2])).size !== entries.length) {
      throw new Error('Quantidade de matérias diferente do total do autor no relatório do SAPL');
    }
    const rows = report.get(name) ?? new Map();
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const [, , id, label] = entry;
      const parts = clean(label).match(/^(.+?)\s+(\d+)\/(\d{4})$/);
      if (!parts || Number(parts[3]) !== year) throw new Error('Identificação de matéria fora do recorte do relatório');
      const [, officialType, number] = parts;
      const boundary = entries[i + 1]?.index ?? group.length;
      const subject = clean(group.slice(entry.index + entry[0].length, boundary).split(/<p\b/i, 1)[0]).replace(/^[-–]\s*/, '');
      rows.set(id, {
        id, year, number: Number(number),
        type: officialType === 'Projeto de Lei Ordinária' ? 'Projeto de Lei' : officialType,
        ...(subject && { subject }),
        source: origin + detailPath + '?cod_materia=' + id,
        sourceLabel: 'Relatório do SAPL',
        stage: 'Situação não informada no relatório',
        decision: 'unverified',
      });
    }
    report.set(name, rows);
    matched += entries.length;
  }
  const linked = [...html.matchAll(/\bhref=(["'])(?:https?:\/\/[^\s"']+)?\/sapl\/consultas\/materia\/materia_mostrar_proc\?cod_materia=\d+\1/gi)].length;
  if (!/<\/html\s*>/i.test(html) || !report.size || !matched || matched !== linked) {
    throw new Error('Relatório anual incompleto ou não reconhecido');
  }
  return new Map([...report].map(([name, rows]) => [name, [...rows.values()]]));
}

export async function fetchAuthorReport(year, getHtml) {
  const url = new URL(reportPath, origin);
  url.search = new URLSearchParams({ selAno: String(year), impressao: '1' }).toString();
  return parseAuthorReport(await getHtml(url.href), year);
}

export function indexAuthorReport(report, people) {
  const names = new Map();
  for (const person of people) {
    for (const heading of [person.name, verifiedHeadings[person.name]].filter(Boolean)) {
      const name = normalizeName(heading);
      const candidates = names.get(name) ?? new Set();
      candidates.add(person.id);
      names.set(name, candidates);
    }
  }
  const indexed = new Map();
  for (const [heading, rows] of report) {
    const candidates = names.get(normalizeName(heading));
    if (candidates?.size !== 1) continue;
    const [author] = candidates;
    for (const row of rows) {
      const existing = indexed.get(row.id);
      if (existing && (existing.year !== row.year || existing.number !== row.number || existing.type !== row.type)) {
        throw new Error('Identificação de matéria conflitante no relatório do SAPL');
      }
      if (!existing) indexed.set(row.id, { ...row, authors: [author] });
      else if (!existing.authors.includes(author)) existing.authors.push(author);
    }
  }
  return [...indexed.values()];
}
