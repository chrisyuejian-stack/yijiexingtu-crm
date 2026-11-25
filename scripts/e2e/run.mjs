import { openSync, readFileSync, writeFileSync, closeSync, mkdirSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Check before Playwright clears outputDir: two runs must not erase each other's evidence.
mkdirSync('work', { recursive: true });
const lock = `work/e2e-port-${Number(process.env.E2E_PORT || 4380)}.lock`;
let fd;
try { fd = openSync(lock, 'wx'); }
catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const pid = Number(readFileSync(lock, 'utf8'));
  let alive = true;
  if (Number.isSafeInteger(pid) && pid > 0) {
    try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
  }
  if (alive) { console.error('已有浏览器验收正在运行；请等它结束，或使用不同的 E2E_PORT 和 E2E_REPORT_DIR。'); process.exit(1); }
  unlinkSync(lock); fd = openSync(lock, 'wx');
}
writeFileSync(fd, String(process.pid)); closeSync(fd);
const child = spawn(process.execPath, [fileURLToPath(import.meta.resolve('@playwright/test/cli')), 'test', ...process.argv.slice(2)], { stdio: 'inherit' });
const clean = () => { try { unlinkSync(lock); } catch (e) { if (e.code !== 'ENOENT') throw e; } };
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); clean(); process.exitCode = 1; });
child.on('exit', (code, signal) => { clean(); process.exitCode = code ?? (signal ? 1 : 0); });
