// Runs the API (with auto-restart) and the Vite dev server together.
import { spawn } from 'node:child_process';

const procs = [
  ['api', process.execPath, ['--watch', 'src/index.js'], 'server'],
  ['web', process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--port', '5173'], 'web'],
];
const children = procs.map(([name, cmd, args, cwd]) => {
  const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const tag = name === 'api' ? '\x1b[35m[api]\x1b[0m' : '\x1b[36m[web]\x1b[0m';
  for (const s of [p.stdout, p.stderr]) s.on('data', (d) => process.stdout.write(d.toString().split('\n').filter(Boolean).map((l) => `${tag} ${l}`).join('\n') + '\n'));
  p.on('exit', (code) => { console.log(`${tag} exited (${code})`); shutdown(); });
  return p;
});
function shutdown() { for (const c of children) c.kill(); process.exit(); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
console.log('\n  OneTier dev → open http://localhost:5173  (API on :3000)\n');
