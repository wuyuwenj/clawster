import { spawn } from 'node:child_process';

const commands = [
  { name: 'web', cmd: 'npm', args: ['run', 'dev:web'] },
  { name: 'api', cmd: 'npm', args: ['run', 'dev:api'] },
];

const children = [];
let shuttingDown = false;

const prefixOutput = (name, stream, output) => {
  let buffer = '';

  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      output.write(`[${name}] ${line}\n`);
    }
  });

  stream.on('end', () => {
    if (buffer) {
      output.write(`[${name}] ${buffer}\n`);
    }
  });
};

const shutdown = (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }
    process.exit(code);
  }, 500).unref();
};

for (const { name, cmd, args } of commands) {
  const child = spawn(cmd, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    env: process.env,
  });

  children.push(child);
  prefixOutput(name, child.stdout, process.stdout);
  prefixOutput(name, child.stderr, process.stderr);

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;

    if (signal) {
      process.stderr.write(`[${name}] exited via ${signal}\n`);
      shutdown(1);
      return;
    }

    if ((code ?? 0) !== 0) {
      process.stderr.write(`[${name}] exited with code ${code}\n`);
      shutdown(code ?? 1);
    }
  });

  child.on('error', (error) => {
    if (shuttingDown) return;
    process.stderr.write(`[${name}] failed to start: ${error.message}\n`);
    shutdown(1);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
