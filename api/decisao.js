import { fetchDecision, readHtml } from '../lib/sapl.js';

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Método inválido.' });
  }
  const { materia } = request.query;
  if (typeof materia !== 'string' || !/^\d{1,8}$/.test(materia)) {
    return response.status(400).json({ error: 'Matéria inválida.' });
  }
  try {
    const decision = await fetchDecision(materia, async url => {
      const result = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(9000),
        headers: { Accept: 'text/html' },
      });
      if (!result.ok) throw new Error('Não foi possível acessar a matéria.');
      return readHtml(await result.arrayBuffer());
    });
    if (decision.decision !== 'unverified') {
      response.setHeader('Cache-Control', 'public, max-age=60, s-maxage=600');
    }
    return response.status(200).json(decision);
  } catch {
    return response.status(502).json({ decision: 'unverified' });
  }
}
