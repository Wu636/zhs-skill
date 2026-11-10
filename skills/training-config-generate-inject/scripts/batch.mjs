#!/usr/bin/env node
/** Bounded, conflict-aware wrapper. Never imports run.mjs or loads credentials. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const RUNNER = fileURLToPath(new URL('./run.mjs', import.meta.url));
const CLIENTS = new Set(['dsh', 'qoder', 'qoder-cn', 'hermes']);
const COMMON = ['type', 'timeout'];
const FLAGS = {
  generate: [...COMMON, 'out', 'doc', 'name', 'advice', 'model', 'flow'],
  plan: [...COMMON, 'out', 'doc', 'name', 'advice', 'model', 'flow'],
  pull: [...COMMON, 'out', 'target-url'],
  normalize: [...COMMON, 'run', 'dry-run'],
  validate: [...COMMON, 'run'],
  inject: [...COMMON, 'run', 'target-url', 'mode', 'confirm-fresh', 'no-cover', 'no-background', 'image-concurrency', 'image-cache', 'image-strategy'],
  verify: [...COMMON, 'run', 'target-url'],
  incremental: [...COMMON, 'run', 'target-url', 'action', 'yes'],
  'prepare-images': [...COMMON, 'run', 'target-url', 'yes', 'image-concurrency', 'image-cache', 'image-ids', 'image-strategy'],
  test: [...COMMON, 'run', 'target-url', 'doc', 'student', 'max-rounds', 'no-reference', 'no-doc-export', 'model'],
  review: [...COMMON, 'run', 'student', 'doc'],
  optimize: [...COMMON, 'run', 'feedback', 'feedback-file', 'max-actions', 'model', 'dry-run'],
};
const BOOLEAN = new Set(['dry-run', 'confirm-fresh', 'no-cover', 'no-background', 'no-reference', 'no-doc-export', 'yes']);
const NETWORK = new Set(['generate', 'plan', 'pull', 'inject', 'verify', 'test', 'optimize', 'prepare-images']);
const TARGET = new Set(['pull', 'inject', 'verify', 'test', 'incremental', 'prepare-images']);
const GRANTS = new Set(['network', 'images', 'inject', 'fresh', 'test', 'student:guided', 'student:offtopic', 'student:all']);
const fail = (message) => { throw new Error(message); };
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function keys(value, allowed, label) {
  if (!record(value) || Object.keys(value).some((key) => !allowed.includes(key))) fail(`Invalid ${label} fields`);
}
function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) fail(`Invalid ${label}`);
  return value;
}

// Resolve symlinked ancestors even for output directories that do not yet exist.
export function canonical(candidate) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || candidate.includes('\0')) fail('Paths must be absolute');
  let current = path.resolve(candidate);
  const tail = [];
  while (!fs.existsSync(current)) {
    tail.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) fail('Cannot resolve path');
    current = parent;
  }
  return path.join(fs.realpathSync(current), ...tail);
}
const contains = (a, b) => b === a || b.startsWith(a + path.sep);
const overlap = (a, b) => contains(a, b) || contains(b, a);
function dataPath(candidate) {
  const resolved = canonical(candidate);
  const roots = ['.agents/skills', '.dsh/skills', '.qoder/skills', '.qoder-cn/skills', '.hermes/skills'].map((p) => canonical(path.join(os.homedir(), p)));
  // Also exclude a relocated installation, not only the conventional shared tree.
  roots.push(canonical(path.resolve(path.dirname(RUNNER), '../..')));
  if (roots.some((root) => overlap(root, resolved))) fail('Data paths must be outside skill installation trees');
  return resolved;
}
function parseJobArgs(args) {
  if (!Array.isArray(args) || !args.length || args.some((v) => typeof v !== 'string' || v.includes('\0'))) fail('args must be a string array');
  const command = args[0];
  if (!Object.hasOwn(FLAGS, command)) fail('Unsupported command');
  const flags = Object.create(null);
  for (let i = 1; i < args.length; i++) {
    const token = args[i];
    if (!/^--[a-z][a-z-]*$/.test(token)) fail('Only separate --flag value arguments are supported');
    const key = token.slice(2);
    if (!FLAGS[command].includes(key) || Object.hasOwn(flags, key)) fail('Unsupported or duplicate flag');
    if (BOOLEAN.has(key)) flags[key] = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) fail('Missing flag value');
      flags[key] = value;
    }
  }
  return { command, flags };
}
function targetId(raw) {
  let url;
  try { url = new URL(raw); } catch { fail('A valid explicit target URL is required'); }
  const allowed = new Set(['trainTaskId', 'courseId', 'libraryId', 'businessType', 'businessId']);
  if (url.protocol !== 'https:' || url.hostname !== 'hike-teaching-center.polymas.com' || url.port || url.username || url.password || url.hash || [...url.searchParams.keys()].some((key) => !allowed.has(key))) fail('Unsupported target URL');
  if (!/\/(ability-training|ability-training-pro|language-training)\//.test(url.pathname)) fail('Unsupported target URL path');
  const ids = url.searchParams.getAll('trainTaskId');
  if (ids.length !== 1 || !/^[A-Za-z0-9_-]+$/.test(ids[0])) fail('Exactly one trainTaskId is required');
  return ids[0];
}
export function conflicts(a, b) {
  return Boolean(a.targetId && a.targetId === b.targetId) || a.paths.some((p) => b.paths.some((q) => overlap(p, q)));
}

export function validateManifest(manifest, { concurrency } = {}) {
  keys(manifest, ['version', 'client', 'concurrency', 'jobs'], 'manifest');
  if (manifest.version !== 1 || !CLIENTS.has(manifest.client)) fail('version=1 and explicit client are required');
  const limit = integer(concurrency ?? manifest.concurrency ?? 2, 1, 32, 'concurrency (1..32)');
  if (!Array.isArray(manifest.jobs) || !manifest.jobs.length) fail('jobs must be a nonempty array');
  const jobs = [];
  const ids = new Set();
  for (const item of manifest.jobs) {
    keys(item, ['id', 'args', 'grants', 'dependsOn'], 'job');
    if (typeof item.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(item.id) || ids.has(item.id)) fail('Invalid or duplicate job id');
    ids.add(item.id);
    const { command, flags } = parseJobArgs(item.args);
    if (!['pro', 'ability', 'oral'].includes(flags.type)) fail('Each job requires explicit --type');
    if (flags.type === 'pro' && ['plan', 'pull', 'test', 'optimize', 'incremental', 'prepare-images'].includes(command)) fail('Command does not support Pro');
    const grants = item.grants ?? [];
    if (!Array.isArray(grants) || grants.some((g) => !GRANTS.has(g))) fail('Invalid grants');
    const requireGrant = (g) => { if (!grants.includes(g)) fail(`Missing grant: ${g}`); };
    if (NETWORK.has(command)) requireGrant('network');
    if (command === 'prepare-images') {
      requireGrant('images');
      if (!flags.yes) fail('prepare-images requires --yes');
      if (flags['image-ids'] !== undefined) {
        const imageIds = flags['image-ids'].split(',');
        if (imageIds.some((id) => !/^(cover|background:[1-9][0-9]*)$/.test(id)) || new Set(imageIds).size !== imageIds.length) fail('Invalid or duplicate image-ids');
      }
    }
    if (command === 'incremental') {
      flags.action ??= 'plan';
      if (!['snapshot', 'plan', 'preflight', 'apply'].includes(flags.action)) fail('Invalid incremental action');
      if (flags.action !== 'plan') requireGrant('network');
      if (flags.action === 'apply') {
        requireGrant('inject');
        if (!flags.yes) fail('incremental apply requires --yes');
      } else if (flags.yes) fail('--yes is only allowed for incremental apply');
    }
    if (command === 'inject') {
      requireGrant('inject');
      // Never inherit fresh defaults or silently change replacement into append.
      if (!['fresh', 'append'].includes(flags.mode)) fail('inject requires explicit --mode fresh|append');
      if (flags.mode === 'fresh') {
        requireGrant('fresh');
        if (!flags['confirm-fresh']) fail('fresh requires --confirm-fresh');
      } else if (flags['confirm-fresh']) fail('--confirm-fresh requires fresh mode');
    }
    if (command === 'test') {
      requireGrant('test');
      flags.student ??= 'good';
      if (!['good', 'guided', 'offtopic', 'all'].includes(flags.student)) fail('Invalid student profile');
      if (flags.student !== 'good') requireGrant(`student:${flags.student}`);
    }
    for (const key of ['timeout', 'max-rounds', 'max-actions']) {
      if (flags[key] !== undefined) integer(Number(flags[key]), 1, key === 'timeout' ? 86400 : 1000, key);
    }
    if (flags['image-concurrency'] !== undefined) integer(Number(flags['image-concurrency']), 1, 8, 'image-concurrency (1..8)');
    if (flags['image-cache'] !== undefined && !['reuse', 'refresh', 'off'].includes(flags['image-cache'])) fail('Invalid image-cache');
    if (flags['image-strategy'] !== undefined && !['preserve', 'missing', 'regenerate'].includes(flags['image-strategy'])) fail('Invalid image-strategy');
    if (flags.flow && !['auto', 'linear', 'graph'].includes(flags.flow)) fail('Invalid flow');
    const outputFlag = ['generate', 'plan', 'pull'].includes(command) ? 'out' : 'run';
    const runDir = dataPath(flags[outputFlag]);
    flags[outputFlag] = runDir;
    const paths = [runDir];
    for (const key of ['doc', 'feedback-file']) if (flags[key]) flags[key] = dataPath(flags[key]);
    if (['generate', 'plan', 'test'].includes(command) && !flags.doc) fail('Explicit --doc required');
    // test exports beside the teacher document. Lock the directory conservatively,
    // since task names are server-controlled and could map to the same filename.
    if (command === 'test' && !flags['no-doc-export']) paths.push(path.dirname(flags.doc));
    const target = TARGET.has(command) ? targetId(flags['target-url']) : null;
    if (target) {
      const targetType = flags['target-url'].includes('/ability-training-pro/') ? 'pro' : flags['target-url'].includes('/language-training/') ? 'oral' : 'ability';
      if (targetType !== flags.type) fail('Target URL and explicit type must agree');
    }
    const dependsOn = item.dependsOn ?? [];
    if (!Array.isArray(dependsOn) || dependsOn.some((id) => typeof id !== 'string' || !jobs.some((j) => j.id === id))) fail('dependsOn must name earlier jobs');
    const dependencies = [...new Set([...dependsOn, ...jobs.filter((j) => conflicts({ targetId: target, paths }, j)).map((j) => j.id)])];
    const args = [command, '--client', manifest.client];
    for (const [key, value] of Object.entries(flags)) args.push(`--${key}`, ...(value === true ? [] : [value]));
    jobs.push({ id: item.id, command, args, runDir, paths, targetId: target, dependencies });
  }
  return { client: manifest.client, concurrency: limit, jobs };
}

// Logs do not contain argv/config dumps. Obvious credential-bearing child output
// is suppressed as defense in depth; arbitrary secrets in source text are not detectable.
export function redactLine(line) {
  return /cookie|authorization|api[-_ ]?key|bearer\s|zhs-jt-cas|ai-poly|[?&](token|secret)=/i.test(line)
    ? '[redacted sensitive output]' : line;
}
export function spawnRunner({ args, stdoutPath, stderrPath, signal }) {
  return new Promise((resolve) => {
    const stdout = fs.openSync(stdoutPath, 'wx', 0o600);
    let stderr;
    try { stderr = fs.openSync(stderrPath, 'wx', 0o600); } catch (error) { fs.closeSync(stdout); throw error; }
    const env = { ...process.env };
    // Explicit client must not silently use an unrelated custom configuration.
    delete env.TRAINING_CONFIG;
    delete env.NODE_OPTIONS;
    let child;
    try {
      child = spawn(process.execPath, [RUNNER, ...args], { shell: false, env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      fs.closeSync(stdout); fs.closeSync(stderr);
      resolve({ code: null, signal: null, spawnError: true });
      return;
    }
    const readers = [[child.stdout, stdout], [child.stderr, stderr]].map(([stream, fd]) => {
      const reader = createInterface({ input: stream, crlfDelay: Infinity });
      reader.on('line', (line) => fs.writeSync(fd, `${redactLine(line)}\n`));
      return reader;
    });
    let killTimer;
    const cancel = () => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
      killTimer.unref();
    };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    let spawnError = false;
    child.on('error', () => { spawnError = true; });
    child.once('close', (code, childSignal) => {
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', cancel);
      readers.forEach((reader) => reader.close());
      fs.closeSync(stdout); fs.closeSync(stderr);
      resolve({ code, signal: childSignal, spawnError });
    });
  });
}

export async function executeBatch(manifest, {
  outputDir, dryRun = false, concurrency, runner = spawnRunner, signal,
  jobTimeoutSeconds = 3600,
} = {}) {
  const plan = validateManifest(manifest, { concurrency });
  const output = dataPath(outputDir);
  integer(jobTimeoutSeconds, 1, 86400, 'job timeout');
  if (plan.jobs.some((job) => job.paths.some((p) => overlap(p, output)))) fail('Batch output must not overlap job directories');
  // Never overwrite a prior summary or repeat an existing batch implicitly.
  if (fs.existsSync(output)) fail('Batch output directory must be new');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(output, { mode: 0o700 });
  const summaryPath = path.join(output, 'summary.json');
  const summary = {
    version: 1, client: plan.client, concurrency: plan.concurrency, dryRun,
    startedAt: new Date().toISOString(), status: dryRun ? 'planned' : 'running',
    jobs: plan.jobs.map((job) => ({
      id: job.id, command: job.command, dependencies: job.dependencies,
      status: dryRun ? 'planned' : 'pending',
      stdout: path.join(output, `${job.id}.stdout.log`), stderr: path.join(output, `${job.id}.stderr.log`),
    })),
  };
  const persist = () => {
    const temporary = path.join(output, 'summary.json.tmp');
    fs.writeFileSync(temporary, JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 });
    // Both paths are fixed children of the validated, newly-created output directory.
    fs.renameSync(temporary, summaryPath);
  };
  persist();
  if (dryRun) return summary; // No runner, config read, credential read, or network.
  const active = new Map();
  const byId = new Map(summary.jobs.map((job) => [job.id, job]));
  const launch = (job, state) => {
    state.status = 'running'; state.startedAt = new Date().toISOString(); persist();
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, jobTimeoutSeconds * 1000);
    const promise = (async () => {
      try {
        const result = await runner({ args: job.args, stdoutPath: state.stdout, stderrPath: state.stderr, signal: controller.signal });
        state.exitCode = Number.isInteger(result?.code) ? result.code : null;
        state.status = timedOut ? 'timed_out' : signal?.aborted ? 'cancelled' : result?.code === 0 && !result?.spawnError ? 'succeeded' : 'failed';
        state.signal = result?.signal ?? null;
      } catch {
        // Do not persist exception messages that might contain arguments/secrets.
        state.status = timedOut ? 'timed_out' : signal?.aborted ? 'cancelled' : 'failed';
        state.exitCode = null;
      } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        state.finishedAt = new Date().toISOString();
        state.durationMs = Date.parse(state.finishedAt) - Date.parse(state.startedAt);
        persist();
      }
    })();
    active.set(job.id, promise);
    promise.finally(() => active.delete(job.id));
  };
  while (summary.jobs.some((job) => ['pending', 'running'].includes(job.status))) {
    for (const job of plan.jobs) {
      const state = byId.get(job.id);
      if (state.status !== 'pending') continue;
      const dependencies = job.dependencies.map((id) => byId.get(id));
      if (signal?.aborted || dependencies.some((dep) => ['failed', 'blocked', 'cancelled', 'timed_out'].includes(dep.status))) {
        state.status = signal?.aborted ? 'cancelled' : 'blocked'; persist(); continue;
      }
      if (active.size < plan.concurrency && dependencies.every((dep) => dep.status === 'succeeded')) launch(job, state);
    }
    if (active.size) await Promise.race(active.values());
  }
  summary.status = summary.jobs.every((job) => job.status === 'succeeded') ? 'succeeded' : 'failed';
  summary.finishedAt = new Date().toISOString(); persist();
  return summary;
}

async function main() {
  const tokens = process.argv.slice(2);
  if (tokens.length === 1 && tokens[0] === '--help') {
    console.log('batch.mjs --manifest <absolute JSON> --output <new absolute directory> [--concurrency 1..32] [--job-timeout 3600] [--dry-run]\nSee batch.README.md. No run/loop/publish/create-task; grants record, but do not replace, current human authorization.');
    return;
  }
  const options = {};
  for (let i = 0; i < tokens.length; i++) {
    const key = tokens[i];
    if (!['--manifest', '--output', '--concurrency', '--job-timeout', '--dry-run'].includes(key) || Object.hasOwn(options, key)) fail('Invalid batch option');
    options[key] = key === '--dry-run' ? true : tokens[++i];
    if (!options[key]) fail('Missing batch option value');
  }
  if (!path.isAbsolute(options['--manifest'] ?? '')) fail('Absolute manifest path required');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(options['--manifest'], 'utf8')); } catch { fail('Cannot read valid JSON manifest'); }
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try {
    const result = await executeBatch(manifest, {
      outputDir: options['--output'], dryRun: options['--dry-run'] === true,
      concurrency: options['--concurrency'] === undefined ? undefined : Number(options['--concurrency']),
      jobTimeoutSeconds: options['--job-timeout'] === undefined ? 3600 : Number(options['--job-timeout']),
      signal: controller.signal,
    });
    console.log(`Batch ${result.status}; ${result.jobs.length} jobs. Summary saved.`);
    if (result.status === 'failed') process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Batch rejected or failed; check manifest schema, grants and paths (values omitted for privacy).'); process.exitCode = 1; });
}
