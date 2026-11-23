import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { catalog } from '../dist/data.js';
import { authorCode, fetchYear, readHtml, years } from '../lib/sapl.js';

const exec = promisify(execFile);
async function getHtml(url) {
  const { stdout } = await exec('curl', ['--fail', '--silent', '--show-error',
    '--max-time', '12', '--', url],
  { encoding: 'buffer', maxBuffer: 8_000_000 });
  return readHtml(stdout);
}

const cache = process.argv[2];
const cachedOnly = process.argv.includes('--cached-only');
if (cache) await mkdir(cache, { recursive: true });
const jobs = catalog.people.flatMap(person => years.map(year => ({ person, year })));
async function collect({ person, year }) {
  const code = authorCode(person);
  const path = cache && join(cache, code + '-' + year + '.json');
  const cached = path && await readFile(path, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!cached && cachedOnly) throw new Error('Consulta ausente no cache');
  const rows = cached ? JSON.parse(cached) : await fetchYear(code, year, getHtml, person.saplAuthorName);
  if (path && !cached) await writeFile(path, JSON.stringify(rows));
  console.log(person.name, year, rows.length);
  return { person, year, rows };
}
const results = [];
let pending = jobs;
for (let attempt = 0; attempt < (cachedOnly ? 1 : 2) && pending.length; attempt++) {
  const failures = [];
  for (let start = 0; start < pending.length; start += 5) {
    const batch = pending.slice(start, start + 5);
    const settled = await Promise.allSettled(batch.map(collect));
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') results.push(result.value);
      else {
        const job = batch[index];
        failures.push(job);
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
if (!records.size) throw new Error('Nenhuma matéria retornada nas consultas');
const updated = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format();
const sorted = [...records.values()].sort((a, b) => b.year - a.year || a.type.localeCompare(b.type, 'pt-BR') || b.number - a.number);
const missing = pending.map(({ person, year }) => ({ id: person.id, year }));
const archive = catalog.archive ?? catalog.records;
const snapshot = { updated, people: catalog.people, records: sorted, missing, archive };
const output = new URL('../dist/data.js', import.meta.url);
const temporary = new URL('../dist/data.js.tmp', import.meta.url);
const source = 'export const catalog = ' + JSON.stringify(snapshot) + ';\n';
const archiveOutput = new URL('../data/sapl-data.js.gz', import.meta.url);
const archiveTemporary = new URL('../data/sapl-data.js.gz.tmp', import.meta.url);
await writeFile(archiveTemporary, gzipSync(source));
await rename(archiveTemporary, archiveOutput);
await writeFile(temporary, source);
await rename(temporary, output);
console.log(sorted.length, 'matérias distintas em', results.length, 'consultas vereador/ano');
