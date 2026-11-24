import { readHtml } from './sapl.js';

export function saplClient(deadline) {
  let session;
  return async url => {
    const headers = { Accept: 'text/html', ...(session && { Cookie: session }) };
    const result = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.any([deadline, AbortSignal.timeout(8_000)]),
      headers,
    });
    for (const cookie of result.headers.getSetCookie()) {
      const match = cookie.match(/^(_ZopeId=[^;\r\n]+)(?:;|$)/);
      if (match) session = match[1];
    }
    if (!result.ok) throw Object.assign(new Error('SAPL HTTP ' + result.status), { status: result.status });
    return readHtml(await result.arrayBuffer());
  };
}
