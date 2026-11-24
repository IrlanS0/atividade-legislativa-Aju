const simplify = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

function explicitDecision(value) {
  const text = simplify(value);
  const decision = text.match(/^(?:(?:[ao] )?(?:proposicao|propositura|materia|indicacao|mocao|requerimento|projeto(?: de lei)?)\s+(?:(?:foi|restou)\s+)?)?(indeferid[oa]|deferid[oa])(?=$|[.,;:]|\s+(?:e encaminhad[oa]|por|em razao|nos termos|parcialmente|com ressalvas?)\b)/);
  if (!decision) return null;
  if (/\b(?:parcial(?:mente)?|condicionad[oa]|ressalva[s]?)\b/.test(text)) return 'ambiguous';
  return decision[1].startsWith('in') ? 'indeferida' : 'deferida';
}

function dateISO(value = '') {
  const parts = value.match(/^\s*(\d{2})\/(\d{2})\/(\d{4})\s*$/);
  if (!parts) return null;
  const [, day, month, year] = parts;
  const iso = year + '-' + month + '-' + day;
  const date = new Date(iso);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

export function decisionFromEntries(entries, verified = false) {
  const decisions = [];
  for (const { stage = '', action = '', date } of entries) {
    const fromStage = explicitDecision(stage);
    const fromAction = explicitDecision(action);
    const currentStage = simplify(stage);
    const inconsistent = (fromStage && fromAction && fromStage !== fromAction)
      || (fromAction === 'indeferida' && /^proposicao aprovada$/.test(currentStage))
      || (fromAction === 'deferida' && /^proposicao rejeitada pelo plenario$/.test(currentStage));
    const decision = inconsistent ? 'ambiguous' : fromStage || fromAction;
    if (decision) decisions.push({ decision, decisionDate: dateISO(date) });
  }
  if (!decisions.length) return { decision: verified ? 'unrecorded' : 'unverified' };
  const latestDate = decisions.map(entry => entry.decisionDate).filter(Boolean).sort().at(-1);
  const latest = decisions.filter(entry => !entry.decisionDate || entry.decisionDate === latestDate);
  if (latest.some(entry => entry.decision === 'ambiguous') || new Set(latest.map(entry => entry.decision)).size !== 1) {
    return { decision: 'unverified' };
  }
  return { decision: latest[0].decision, ...(latestDate && { decisionDate: latestDate }) };
}
