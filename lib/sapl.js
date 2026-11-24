import { decodeHTML } from 'entities';
import { setTimeout as wait } from 'node:timers/promises';
import { decisionFromEntries } from './decision.js';

const origin = 'http://190.15.122.10:8080';
const searchPath = '/sapl/generico/materia_pesquisar_proc';
const detailPath = '/sapl/consultas/materia/materia_mostrar_proc';
const step = 500;
const resultLimit = 2000;
const day = 86_400_000;
export const years = [2025, 2026];
export const isPermanentFailure = error => error?.status >= 400 && error.status < 500 && error.status !== 408;

export function authorCode(person) {
  return new URL(person.saplUrl).searchParams.get('cod_parlamentar');
}

const clean = value => decodeHTML(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const valueOf = (field, label) => field.find(value => label.test(value))?.replace(label, '') ?? '';
export const displayStage = value => value
  .replace(/^(Proposi(?:ção|tura) arquivada)\b.*$/i, '$1')
  .replace(/^(.*?\b(?:in)?deferid[oa])\b.*$/i, '$1');
const latin9 = { 164: '€', 166: 'Š', 168: 'š', 180: 'Ž', 184: 'ž', 188: 'Œ', 189: 'œ', 190: 'Ÿ' };

export function readHtml(buffer) {
  const bytes = new Uint8Array(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return Array.from(bytes, byte => latin9[byte] ?? String.fromCharCode(byte)).join('');
  }
}

export function parsePage(html, year) {
  const count = html.match(/Resultado da Pesquisa:\s*(\d+)/i);
  if (!count) {
    if (/Nenhuma ocorr(?:ê|&ecirc;)ncia encontrada\./i.test(html)) return { total: 0, rows: [] };
    throw new Error('Resultado do SAPL não reconhecido');
  }
  const rows = [];
  const cells = html.matchAll(/<a\s+href="[^"]*\/materia_mostrar_proc\?cod_materia=(\d+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)<\/td>/gi);
  for (const [, id, header, body] of cells) {
    const label = clean(header).match(/^([A-Z0-9]+)\s+(\d+)\/(\d{4})\s*[-–]\s*(.+)$/);
    if (!label || Number(label[3]) !== year) throw new Error('Identificação de matéria fora do recorte');
    const [, abbreviation, number, , officialType] = label;
    const fields = body.replace(/^\s*<br\s*\/?\s*>/i, '').split(/<br\s*\/?\s*>/i).map(clean);
    const stage = valueOf(fields, /^Situação\s*:\s*/i);
    const actionIndex = fields.findIndex(field => /^Última Ação\s*:/i.test(field));
    const action = actionIndex === -1 ? '' : fields[actionIndex].replace(/^Última Ação\s*:\s*/i, '');
    const date = action.match(/\bEm:\s*(\d{2}\/\d{2}\/\d{4})\s*$/i)?.[1];
    const author = fields.find(field => /^Autor(?:es)?\s*:/i.test(field))?.replace(/^Autor(?:es)?\s*:\s*/i, '');
    rows.push({
      id,
      type: abbreviation === 'PLO' ? 'Projeto de Lei' : officialType,
      number: Number(number),
      year,
      subject: fields[0] || 'Ementa não informada no SAPL',
      stage: displayStage(stage) || 'Situação não informada no SAPL',
      ...decisionFromEntries([{ stage, action, date }]),
      officialAuthor: author || '',
      source: origin + detailPath + '?cod_materia=' + id,
      sourceLabel: 'SAPL',
    });
  }
  return { total: Number(count[1]), rows };
}

export function parseDecisionHistory(html) {
  const section = [...html.matchAll(/<fieldset\b[^>]*>\s*<legend[^>]*>([\s\S]*?)<\/legend>([\s\S]*?)<\/fieldset>/gi)]
    .find(([, title]) => clean(title).toLowerCase() === 'tramitação')?.[2];
  if (!section) return { decision: 'unverified' };
  const entries = [];
  for (const [, date, body] of section.matchAll(/<b>\s*Data\s*:\s*<\/b>\s*(\d{2}\/\d{2}\/\d{4})([\s\S]*?)(?=<b>\s*Data\s*:|$)/gi)) {
    const fields = [...body.matchAll(/<td\b[^>]*>\s*<b>([\s\S]*?)<\/b>([\s\S]*?)<\/td>/gi)]
      .map(([, label, value]) => clean(label) + ' ' + clean(value));
    entries.push({
      date,
      stage: valueOf(fields, /^Situação\s*:\s*/i),
      action: valueOf(fields, /^Última Ação\s*:\s*/i),
    });
  }
  return decisionFromEntries(entries, entries.some(entry => entry.stage || entry.action));
}

export async function fetchDecision(id, getHtml) {
  if (typeof id !== 'string' || !/^\d{1,8}$/.test(id)) throw new Error('Código inválido');
  const url = new URL(detailPath, origin);
  url.searchParams.set('cod_materia', id);
  return parseDecisionHistory(await getHtml(url.href));
}

export async function fetchYear(code, year, getHtml, authorName, { signal } = {}) {
  if (!authorName) return fetchRange(code, year, getHtml, signal);
  const periods = [['01/01', '31/03'], ['01/04', '30/06'], ['01/07', '30/09'], ['01/10', '31/12']];
  const rows = new Map();
  for (const [start, end] of periods) {
    const quarter = await fetchRange('', year, getHtml, signal, start + '/' + year, end + '/' + year);
    for (const row of quarter) {
      if (row.officialAuthor.toLocaleLowerCase('pt-BR').includes(authorName.toLocaleLowerCase('pt-BR'))) {
        rows.set(row.id, row);
      }
    }
  }
  return [...rows.values()];
}

function formatDate(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10).split('-').reverse().join('/');
}

function timestamp(date) {
  const [d, m, y] = date.split('/').map(Number);
  return Date.UTC(y, m - 1, d);
}

async function loadPage(url, year, getHtml, signal, expectedTotal, collected) {
  async function read() {
    signal?.throwIfAborted();
    const { total, rows } = parsePage(await getHtml(url.href), year);
    if (expectedTotal === undefined && total >= resultLimit) return { total, rows: [] };
    if (expectedTotal !== undefined && total !== expectedTotal) {
      throw new Error('Resultado alterado durante a coleta');
    }
    const offset = (Number(url.searchParams.get('page')) - 1) * step;
    const ids = new Set(rows.map(row => row.id));
    if (rows.length !== Math.min(step, total - offset) || ids.size !== rows.length
        || rows.some(row => collected.has(row.id))) {
      throw new Error('Página incompleta ou repetida do SAPL');
    }
    return { total, rows };
  }
  try {
    return await read();
  } catch (error) {
    if (isPermanentFailure(error)) throw error;
    await wait(200, undefined, { signal });
    return read();
  }
}

async function fetchRange(code, year, getHtml, signal, start = '', end = '') {
  const url = new URL(searchPath, origin);
  url.search = new URLSearchParams({
    incluir: '0', existe_ocorrencia: '0', lst_tip_materia: '', txt_numero: '', txt_prot_pref: '',
    txt_ano: String(year), txt_npc: '', dt_apres: start, dt_apres2: end, dt_public: '', dt_public2: '',
    hdn_txt_autor: '', hdn_cod_autor: code, lst_tip_autor: code ? 'Parlamentar' : '', lst_cod_partido: '',
    txt_relator: '', txt_assunto: '', rad_tramitando: '', lst_localizacao: '', lst_status: '',
    btn_materia_pesquisar: 'Pesquisar', step: String(step), page: '1',
  }).toString();
  const rows = new Map();
  const first = await loadPage(url, year, getHtml, signal, undefined, rows);
  if (first.total >= resultLimit) {
    const from = timestamp(start || '01/01/' + year);
    const to = timestamp(end || '31/12/' + year);
    if (from >= to) throw new Error('O SAPL atingiu o limite de resultados em um único dia');
    const middle = from + Math.floor((to - from) / day / 2) * day;
    const before = await fetchRange(code, year, getHtml, signal, formatDate(from), formatDate(middle));
    const after = await fetchRange(code, year, getHtml, signal, formatDate(middle + day), formatDate(to));
    for (const row of [...before, ...after]) {
      if (rows.has(row.id)) throw new Error('Matéria repetida em períodos distintos do SAPL');
      rows.set(row.id, row);
    }
    if (rows.size < first.total) throw new Error('Os períodos não cobrem todos os resultados informados pelo SAPL');
    return [...rows.values()];
  }
  for (const row of first.rows) rows.set(row.id, row);
  const pages = Math.ceil(first.total / step);
  for (let page = 2; page <= pages; page++) {
    url.searchParams.set('page', String(page));
    const result = await loadPage(url, year, getHtml, signal, first.total, rows);
    for (const row of result.rows) rows.set(row.id, row);
  }
  return [...rows.values()];
}
