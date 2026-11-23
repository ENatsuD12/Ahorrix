import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const apiUrl = (process.env.API_URL || 'http://127.0.0.1:8000/api').replace(/\/$/, '');

const assets = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons'];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const asset of assets) {
  await cp(path.join(root, asset), path.join(dist, asset), { recursive: true });
}

await writeFile(
  path.join(dist, 'config.js'),
  `window.AHORRIX_CONFIG = {\n  apiUrl: ${JSON.stringify(apiUrl)},\n};\n`
);

console.log(`PWA generada en dist/ con apiUrl=${apiUrl}`);
