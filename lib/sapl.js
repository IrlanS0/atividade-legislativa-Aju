import { decodeHTML } from 'entities';

const origin = 'http://190.15.122.10:8080';
const searchPath = '/sapl/generico/materia_pesquisar_proc';
const detailPath = '/sapl/consultas/materia/materia_mostrar_proc';
const step = 500;
export const years = [2025, 2026];

export function authorCode(person) {
  return new URL(person.saplUrl).searchParams.get('cod_parlamentar');
}

const clean = value => decodeHTML(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
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
    const stage = fields.find(field => /^Situação\s*:/i.test(field))?.replace(/^Situação\s*:\s*/i, '');
    const author = fields.find(field => /^Autor(?:es)?\s*:/i.test(field))?.replace(/^Autor(?:es)?\s*:\s*/i, '');
    rows.push({
      id,
      type: abbreviation === 'PLO' ? 'Projeto de Lei' : officialType,
      number: Number(number),
      year,
      subject: fields[0] || 'Ementa não informada no SAPL',
      stage: stage || 'Situação não informada no SAPL',
      officialAuthor: author || '',
      source: origin + detailPath + '?cod_materia=' + id,
      sourceLabel: 'SAPL',
    });
  }
  return { total: Number(count[1]), rows };
}

export async function fetchYear(code, year, getHtml, authorName) {
  if (!authorName) return fetchRange(code, year, getHtml);
  const periods = [['01/01', '31/03'], ['01/04', '30/06'], ['01/07', '30/09'], ['01/10', '31/12']];
  const rows = new Map();
  for (const [start, end] of periods) {
    const quarter = await fetchRange('', year, getHtml, start + '/' + year, end + '/' + year);
    for (const row of quarter) {
      if (row.officialAuthor.toLocaleLowerCase('pt-BR').includes(authorName.toLocaleLowerCase('pt-BR'))) {
        rows.set(row.id, row);
      }
    }
  }
  return [...rows.values()];
}

async function fetchRange(code, year, getHtml, start = '', end = '') {
  const url = new URL(searchPath, origin);
  url.search = new URLSearchParams({
    incluir: '0', existe_ocorrencia: '0', lst_tip_materia: '', txt_numero: '', txt_prot_pref: '',
    txt_ano: String(year), txt_npc: '', dt_apres: start, dt_apres2: end, dt_public: '', dt_public2: '',
    hdn_txt_autor: '', hdn_cod_autor: code, lst_tip_autor: code ? 'Parlamentar' : '', lst_cod_partido: '',
    txt_relator: '', txt_assunto: '', rad_tramitando: '', lst_localizacao: '', lst_status: '',
    btn_materia_pesquisar: 'Pesquisar', step: String(step), page: '1',
  }).toString();
  const first = parsePage(await getHtml(url.href), year);
  if (first.total >= 2000) throw new Error('A consulta atingiu o limite de resultados do SAPL');
  const rows = new Map(first.rows.map(row => [row.id, row]));
  if (first.rows.length !== Math.min(step, first.total)) throw new Error('Primeira página incompleta');
  const pages = Math.ceil(first.total / step);
  if (pages > 30) throw new Error('Quantidade de páginas acima do limite de consulta');
  for (let page = 2; page <= pages; page++) {
    url.searchParams.set('page', String(page));
    const result = parsePage(await getHtml(url.href), year);
    if (result.total !== first.total) throw new Error('Resultado alterado durante a coleta');
    for (const row of result.rows) rows.set(row.id, row);
  }
  if (rows.size !== first.total) throw new Error('Quantidade de matérias diferente do total do SAPL');
  return [...rows.values()];
}
