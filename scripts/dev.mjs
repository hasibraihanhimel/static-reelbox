import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const viteEntry = resolve(projectRoot, 'node_modules/vite/bin/vite.js');
const children = [];
let shuttingDown = false;

function start(label, command, args) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  children.push(child);
  child.on('error', (error) => {
    console.error(`${label} could not start: ${error.message}`);
    if (label === 'Resolver API') {
      console.error('Install its dependencies with: python -m pip install -r resolver-api/requirements.txt');
    }
    stop();
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`${label} stopped${signal ? ` (${signal})` : ` with exit code ${code}`}.`);
    stop();
    process.exitCode = code ?? 1;
  });
}

function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

console.log('Starting Reelbox site and stream resolver. Press Ctrl+C to stop both.');
start('Resolver API', python, ['-m', 'uvicorn', 'main:app', '--app-dir', 'resolver-api', '--host', '0.0.0.0', '--port', '8000']);
start('Vite', process.execPath, [viteEntry]);
