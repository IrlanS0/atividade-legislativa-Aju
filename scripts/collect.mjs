import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { catalog } from '../dist/data.js';
import { mergeSnapshot } from '../lib/collection.js';
import { fetchAuthorReport, indexAuthorReport } from '../lib/sapl-report.js';
import { authorCode, displayStage, fetchYear, isPermanentFailure, readHtml, years } from '../lib/sapl.js';

const exec = promisify(execFile);
const statusMarker = '\n--sapl-http:';
let sessionReady, cookieJar, rateLimitError;

async function requestHtml(url, cookieOption) {
  if (rateLimitError) throw rateLimitError;
  const { stdout } = await exec('curl', ['--silent', '--show-error',
    '--max-time', '12', cookieOption, cookieJar, '--write-out', statusMarker + '%{http_code}', '--', url],
  { encoding: 'buffer', maxBuffer: 8_000_000 });
  const marker = stdout.lastIndexOf(statusMarker);
  const status = marker < 0 ? 0 : Number(stdout.subarray(marker + statusMarker.length));
  if (status < 200 || status >= 300) {
    const error = Object.assign(new Error('SAPL respondeu com HTTP ' + status), { status });
    if (status === 429) rateLimitError = error;
    throw error;
  }
  return readHtml(stdout.subarray(0, marker));
}

async function getHtml(url) {
  if (!sessionReady) {
    const directory = mkdtempSync(join(tmpdir(), 'sapl-session-'));
    cookieJar = join(directory, 'cookies');
    process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
    const first = requestHtml(url, '--cookie-jar');
    sessionReady = first.then(() => {}, () => {});
    return first;
  }
  await sessionReady;
  return requestHtml(url, '--cookie');
}

const cache = process.argv.slice(2).find(arg => !arg.startsWith('--'));
const cachedOnly = process.argv.includes('--cached-only');
const decisionsOnly = process.argv.includes('--enrich-decisions');
if (cache) await mkdir(cache, { recursive: true });
const reportRows = [];
if (!cachedOnly && !decisionsOnly) {
  for (const year of years) {
    if (rateLimitError) break;
    try {
      const rows = indexAuthorReport(await fetchAuthorReport(year, getHtml), catalog.people);
      reportRows.push(...rows);
      console.log(year, rows.length, 'matérias atribuídas pelo relatório oficial por autor');
    } catch (error) {
      console.warn(year, 'relatório por autor indisponível:', error.status ?? error.code ?? error.message);
    }
  }
}
const jobs = catalog.people.flatMap(person => years.map(year => ({ person, year })));
async function collect({ person, year }) {
  const code = authorCode(person);
  const path = cache && join(cache, code + '-' + year + '.json');
  const cached = path && await readFile(path, 'utf8').then(JSON.parse).catch(error => {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  });
  const fromCache = Array.isArray(cached) && cached.every(row => row?.year === year && typeof row.id === 'string');
  if (!fromCache && cachedOnly) throw new Error('Consulta ausente ou inválida no cache');
  const rows = fromCache ? cached : await fetchYear(code, year, getHtml, person.saplAuthorName);
  if (path && !fromCache) await writeFile(path, JSON.stringify(rows));
  console.log(person.name, year, rows.length);
  return { person, year, rows, fresh: !fromCache };
}
const results = [];
let pending = jobs;
const terminalFailures = [];
for (let attempt = 0; attempt < (cachedOnly ? 1 : 2) && pending.length && !rateLimitError; attempt++) {
  const failures = [];
  for (let start = 0; start < pending.length; start += 5) {
    if (rateLimitError) {
      failures.push(...pending.slice(start));
      break;
    }
    const batch = pending.slice(start, start + 5);
    const settled = await Promise.allSettled(batch.map(collect));
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') results.push(result.value);
      else {
        const job = batch[index];
        (isPermanentFailure(result.reason) ? terminalFailures : failures).push(job);
        if (!cachedOnly) console.warn(job.person.name, job.year, result.reason.code ?? result.reason.message);
      }
    });
  }
  pending = failures;
}
const records = new Map();
for (const { person, rows } of results) {
  for (const row of rows) {
    const { officialAuthor, ...matter } = row;
    if (!records.has(matter.id)) records.set(matter.id, { ...matter, authors: [] });
    records.get(row.id).authors.push(person.id);
  }
}
if ((!results.length && !reportRows.length)
    || (results.length === jobs.length && !records.size && catalog.records.length)) {
  throw new Error('Nenhuma matéria verificável retornada. A base anterior foi preservada');
}
for (const matter of records.values()) matter.authors = [...new Set(matter.authors)];
const updated = results.some(({ fresh }) => fresh)
  ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Maceio' }).format()
  : catalog.updated;
const completed = results.map(({ person, year, fresh }) => ({ id: person.id, year, fresh }));
const failed = [...terminalFailures, ...pending].map(({ person, year }) => ({ id: person.id, year }));
const snapshot = decisionsOnly ? {
  ...catalog,
  records: catalog.records.map(record => {
    const { decisionDate: oldDate, decision: oldDecision, ...previous } = record;
    const latest = records.get(record.id);
    const decision = latest ? latest.decision : oldDecision;
    const decisionDate = latest ? latest.decisionDate : oldDate;
    const stage = displayStage(latest?.stage ?? previous.stage);
    return { ...previous, stage, decision: decision ?? 'unverified', ...(decisionDate && { decisionDate }) };
  }),
} : mergeSnapshot(catalog, records.values(), completed, failed, updated, reportRows);
const output = new URL('../dist/data.js', import.meta.url);
const temporary = new URL('../dist/data.js.tmp', import.meta.url);
const source = 'export const catalog = ' + JSON.stringify(snapshot) + ';\n';
const archiveOutput = new URL('../data/sapl-data.js.gz', import.meta.url);
const archiveTemporary = new URL('../data/sapl-data.js.gz.tmp', import.meta.url);
await writeFile(archiveTemporary, gzipSync(source));
await rename(archiveTemporary, archiveOutput);
await writeFile(temporary, source);
await rename(temporary, output);
console.log(records.size, 'matérias distintas consultadas em', results.length, 'consultas vereador/ano');
if (!decisionsOnly) console.log(snapshot.records.length, 'matérias publicáveis,', snapshot.stale.length,
  'recortes de coleta anterior e', snapshot.missing.length, 'recortes sem coleta validada');
