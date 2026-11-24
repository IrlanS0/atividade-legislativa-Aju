import { setTimeout as delay } from 'node:timers/promises';
import { fetchDecision } from '../lib/sapl.js';
import { saplClient } from '../lib/sapl-http.js';

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
  const deadline = AbortSignal.timeout(18_000);
  const getHtml = saplClient(deadline);
  try {
    const decision = await fetchDecision(materia, async url => {
      try {
        return await getHtml(url);
      } catch (error) {
        if (error.status && error.status < 500) throw error;
        await delay(350, undefined, { signal: deadline });
        return getHtml(url);
      }
    });
    if (decision.decision !== 'unverified') {
      response.setHeader('Cache-Control', 'public, max-age=60, s-maxage=600');
    }
    return response.status(200).json(decision);
  } catch (error) {
    return response.status(error.status === 429 ? 429 : 502).json({ decision: 'unverified' });
  }
}
