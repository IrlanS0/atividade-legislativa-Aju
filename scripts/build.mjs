import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const directory = new URL('../dist/', import.meta.url);
const snapshot = await readFile(new URL('../data/sapl-data.js.gz', import.meta.url));
await mkdir(directory, { recursive: true });
await writeFile(new URL('data.js', directory), gunzipSync(snapshot));
