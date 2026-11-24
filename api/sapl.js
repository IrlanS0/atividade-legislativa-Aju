import { catalog } from '../dist/data.js';
import { authorCode, fetchYear, years } from '../lib/sapl.js';
import { saplClient } from '../lib/sapl-http.js';

const people = new Map(catalog.people.map(person => [person.id, person]));

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Método inválido.' });
  }

  const { vereador, ano } = request.query;
  const person = people.get(vereador);
  const year = typeof ano === 'string' ? Number(ano) : NaN;
  if (!person || !years.includes(year)) {
    return response.status(400).json({ error: 'Consulta inválida.' });
  }

  const deadline = AbortSignal.timeout(43_000);
  try {
    const rows = await fetchYear(authorCode(person), year, saplClient(deadline), person.saplAuthorName, { signal: deadline });
    response.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=120');
    return response.status(200).json({ rows, total: rows.length, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Falha na consulta ao SAPL', error.message);
    return response.status(error.status === 429 ? 429 : 502)
      .json({ error: 'O painel não conseguiu concluir a consulta ao SAPL.' });
  }
}
