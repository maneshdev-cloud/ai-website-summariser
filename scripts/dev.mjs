// `npm run dev` — starts the API server (:8787) and Vite (:5173)
// together as two child processes, no extra deps. Vite proxies /api to
// the API server (see vite.config.ts). Ctrl+C stops both.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js');

const children = [
  spawn(process.execPath, [join(root, 'scripts', 'dev-server.mjs')], {
    stdio: 'inherit',
    env: process.env,
  }),
  spawn(process.execPath, [viteBin], { stdio: 'inherit', env: process.env, cwd: root }),
];

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  process.exit(code);
}

for (const child of children) {
  child.on('exit', (code) => {
    if (!shuttingDown && code !== 0) shutdown(code ?? 1);
  });
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('[dev] API on http://localhost:8787 · Web on http://localhost:5173');
