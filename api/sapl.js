import { catalog } from '../dist/data.js';
import { authorCode, fetchYear, readHtml, years } from '../lib/sapl.js';

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
    const rows = await fetchYear(authorCode(person), year, async url => {
      const result = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.any([deadline, AbortSignal.timeout(9_000)]),
        headers: { Accept: 'text/html' },
      });
      if (!result.ok) throw new Error('SAPL HTTP ' + result.status);
      return readHtml(await result.arrayBuffer());
    }, person.saplAuthorName);
    return response.status(200).json({ rows, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Falha na consulta ao SAPL', error.message);
    return response.status(502).json({ error: 'O painel não conseguiu concluir a consulta ao SAPL.' });
  }
}
