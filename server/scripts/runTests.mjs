import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const serverRoot = path.resolve(path.dirname(__filename), '..');
const srcDir = path.join(serverRoot, 'src');

const FILE_TIMEOUT_MS =
  Number.parseInt(process.env.SERVER_TEST_FILE_TIMEOUT_MS || '', 10) || 120_000;

function collectTestFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      results.push(path.relative(serverRoot, fullPath).split(path.sep).join('/'));
    }
  }
  return results.sort((a, b) => a.localeCompare(b));
}

function runSingleTestFile(relPath, index, total) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    console.log(`\n[${index}/${total}] RUN ${relPath}`);

    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--test', relPath],
      {
        cwd: serverRoot,
        env: process.env,
        stdio: 'inherit',
      }
    );

    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      console.error(
        `[${index}/${total}] TIMEOUT ${relPath} exceeded ${FILE_TIMEOUT_MS}ms; terminating process.`
      );
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore kill error if process already exited
      }
    }, FILE_TIMEOUT_MS);

    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      console.error(`[${index}/${total}] ERROR ${relPath} (${durationMs}ms): ${err.message}`);
      resolve({ relPath, ok: false, timedOut: false, code: 1, durationMs });
    });

    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      if (timedOut) {
        resolve({ relPath, ok: false, timedOut: true, code: 1, durationMs });
        return;
      }
      if (code === 0) {
        console.log(`[${index}/${total}] PASS ${relPath} (${durationMs}ms)`);
        resolve({ relPath, ok: true, timedOut: false, code: 0, durationMs });
      } else {
        console.error(
          `[${index}/${total}] FAIL ${relPath} (exit=${code ?? 'null'}, signal=${signal ?? 'none'}, ${durationMs}ms)`
        );
        resolve({ relPath, ok: false, timedOut: false, code: code ?? 1, durationMs });
      }
    });
  });
}

async function main() {
  const cliTargets = process.argv.slice(2).filter((arg) => arg.trim().length > 0);
  const testFiles =
    cliTargets.length > 0
      ? cliTargets.map((t) => t.split(path.sep).join('/'))
      : collectTestFiles(srcDir);

  if (testFiles.length === 0) {
    console.error('No server test files found.');
    process.exit(1);
  }

  const results = [];
  for (let i = 0; i < testFiles.length; i += 1) {
    const res = await runSingleTestFile(testFiles[i], i + 1, testFiles.length);
    results.push(res);
  }

  const failed = results.filter((r) => !r.ok);
  const passed = results.length - failed.length;
  console.log(`\n=== Server Test Runner Summary: ${passed}/${results.length} files passed ===`);
  if (failed.length > 0) {
    for (const f of failed) {
      console.error(
        `  - ${f.relPath}: ${f.timedOut ? `TIMEOUT (>${FILE_TIMEOUT_MS}ms)` : `EXIT ${f.code}`} (${f.durationMs}ms)`
      );
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
