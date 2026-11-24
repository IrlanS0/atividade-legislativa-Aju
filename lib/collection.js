const sliceKey = ({ id, year }) => id + '/' + year;

export function mergeSnapshot(catalog, freshRecords, completed, failed, updated, reportRows = []) {
  const completeKeys = new Set(completed.map(sliceKey));
  const unresolvedKeys = new Set((catalog.missing ?? []).map(sliceKey));
  const reportKeys = new Set(reportRows.flatMap(row => row.authors.map(id => sliceKey({ id, year: row.year }))));
  const fresh = [...freshRecords];
  const foundAuthors = new Map();
  for (const record of [...fresh, ...reportRows]) {
    const authors = foundAuthors.get(record.id) ?? new Set();
    for (const id of record.authors) authors.add(id);
    foundAuthors.set(record.id, authors);
  }
  const previousRecords = new Map(catalog.records.map(record => [record.id, record]));
  const records = new Map();
  const omitted = new Map();
  for (const record of catalog.records) {
    const authors = record.authors.filter(id => {
      const slice = { id, year: record.year };
      const key = sliceKey(slice);
      if (!completeKeys.has(key)) return true;
      if (foundAuthors.get(record.id)?.has(id)) return false;
      omitted.set(key, slice);
      return true;
    });
    const retainedReportAuthors = (record.reportAuthors ?? []).filter(id => authors.includes(id));
    if (authors.length) records.set(record.id, { ...record, authors, reportAuthors: retainedReportAuthors });
  }
  for (const record of fresh) {
    const previous = records.get(record.id);
    const authors = [...new Set([...(previous?.authors ?? []), ...record.authors])];
    const reportAuthors = (previous?.reportAuthors ?? []).filter(id => !record.authors.includes(id));
    records.set(record.id, { ...record, authors, reportAuthors });
  }
  for (const row of reportRows) {
    const previous = records.get(row.id) ?? { ...(previousRecords.get(row.id) ?? row), authors: [], reportAuthors: [] };
    const extraAuthors = row.authors.filter(id => !previous.authors.includes(id));
    if (extraAuthors.length) records.set(row.id, {
      ...previous,
      authors: [...previous.authors, ...extraAuthors],
      reportAuthors: [...(previous.reportAuthors ?? []), ...extraAuthors],
    });
  }
  const missing = failed.filter(slice => unresolvedKeys.has(sliceKey(slice)));
  const stale = new Map([
    ...failed.filter(slice => !unresolvedKeys.has(sliceKey(slice))),
    ...completed.filter(slice => !slice.fresh).map(({ id, year }) => ({ id, year })),
  ].map(slice => [sliceKey(slice), slice]));
  for (const [key, slice] of omitted) stale.set(key, slice);
  for (const { year, reportAuthors } of records.values()) {
    for (const id of reportAuthors ?? []) {
      const slice = { id, year };
      if (!reportKeys.has(sliceKey(slice))) stale.set(sliceKey(slice), slice);
    }
  }
  return {
    ...catalog,
    updated,
    records: [...records.values()].map(({ reportAuthors, ...record }) =>
      reportAuthors?.length ? { ...record, reportAuthors } : record)
      .sort((a, b) => b.year - a.year || a.type.localeCompare(b.type, 'pt-BR') || b.number - a.number),
    missing,
    stale: [...stale.values()],
  };
}
