import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Use the same contract as the server, never maintain a second DTO/parser. */
export async function loadStructuredRubricHelpers(appRoot) {
  return import(pathToFileURL(path.join(appRoot, 'lib/training-injector/rubric-structured.mjs')).href);
}
export async function savePulledRubricSidecar(appRoot, runDir, markdown, rawScoreItems, sourceTaskId) {
  const { createRubricSidecar } = await loadStructuredRubricHelpers(appRoot);
  const sidecar = createRubricSidecar(markdown, rawScoreItems, sourceTaskId);
  const filename = path.join(runDir, 'rubric.source.json');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(sidecar, null, 2) + '\n', { mode: 0o600 });
  return filename;
}
export async function selectStructuredRubric(appRoot, runDir, markdown) {
  const helpers = await loadStructuredRubricHelpers(appRoot);
  const filename = path.join(runDir, 'rubric.source.json');
  let sidecar;
  if (fs.existsSync(filename)) {
    try { sidecar = JSON.parse(fs.readFileSync(filename, 'utf8')); }
    catch { return { ok: false, blocked: true, reason: 'unreadable-sidecar' }; }
  }
  const result = helpers.resolveRubricFastPath(markdown, sidecar);
  if (!result.ok) return result;
  // Deterministic Markdown needs no client-side DTO payload: server runs the same parser.
  return { ...result, ...(result.source === 'platform-sidecar' ? { payload: sidecar } : {}) };
}
