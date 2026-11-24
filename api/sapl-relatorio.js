import { catalog } from '../dist/data.js';
import { saplClient } from '../lib/sapl-http.js';
import { fetchAuthorReport, indexAuthorReport } from '../lib/sapl-report.js';
import { years } from '../lib/sapl.js';

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Método inválido.' });
  }
  const { ano } = request.query;
  const year = typeof ano === 'string' ? Number(ano) : NaN;
  if (!years.includes(year)) return response.status(400).json({ error: 'Ano inválido.' });
  try {
    const report = await fetchAuthorReport(year, saplClient(AbortSignal.timeout(10_000)));
    const rows = indexAuthorReport(report, catalog.people);
    if (!rows.length) throw new Error('Relatório sem correspondências com os vereadores');
    response.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=900');
    return response.status(200).json({ rows, total: rows.length });
  } catch (error) {
    console.error('Falha no relatório oficial do SAPL', error.message);
    return response.status(error.status === 429 ? 429 : 502)
      .json({ error: 'O painel não conseguiu consultar o relatório anual do SAPL.' });
  }
}
