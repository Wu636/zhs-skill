import fs from 'node:fs';
import path from 'node:path';
import { consumeSSE } from './sse.mjs';
import { sanitizeCookie } from './platform.mjs';

function authorization(cookie, explicit) {
  const raw = String(explicit || '').trim();
  if (raw) return raw.replace(/^authorization\s*:\s*/i, '').replace(/^Bearer\s+/i, '').trim();
  const match = cookie.match(/(?:^|;\s*)(zhs-jt-cas|ai-poly)=([^;]+)/i);
  return match ? decodeURIComponent(match[2]) : '';
}
/** Explicitly authorized image generation/upload only. Never calls injection preflight,
 * boundary initialization, task edits, publication, or changes inject/run evidence.
 */
export async function prepareTrainingImages(config, { runDir, target, type, concurrency = 3, cacheMode = 'reuse', strategy = 'regenerate', ids, timeoutSeconds = 1200 }) {
  if (!['ability', 'oral'].includes(type)) throw new Error('prepare-images currently supports ability/oral only');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('Image concurrency must be 1..8');
  if (!['reuse','refresh','off'].includes(cacheMode)) throw new Error('Invalid image cache mode');
  if (!['regenerate','preserve','missing'].includes(strategy)) throw new Error('Invalid image strategy');
  if (ids !== undefined && (!Array.isArray(ids) || ids.some(id => !/^(cover|background:[1-9]\d*)$/.test(id)))) throw new Error('Invalid image IDs');
  if (!path.isAbsolute(runDir) || !target?.trainTaskId || !target?.targetUrl) throw new Error('Explicit run directory and target URL required');
  const url = new URL(target.targetUrl);
  const courseId = target.courseId || url.searchParams.get('courseId') || url.searchParams.get('businessId') || url.pathname.match(/\/agent-course-full\/([^/]+)\//)?.[1];
  const libraryId = url.searchParams.get('libraryId');
  if (!courseId || !libraryId) throw new Error('Target URL must identify course and library');
  const scriptMarkdown = fs.readFileSync(path.join(runDir, 'script.md'), 'utf8');
  const rubricPath = path.join(runDir, 'rubric.md');
  const rubricMarkdown = fs.existsSync(rubricPath) ? fs.readFileSync(rubricPath, 'utf8') : '';
  const cookie = sanitizeCookie(config.polymas.cookie);
  const token = authorization(cookie, config.polymas.authorization);
  if (!cookie || !token) throw new Error('Platform credentials missing');
  const started = Date.now();
  const outputPath = path.join(runDir, 'images.prepare.json');
  const result = { success: false, type, ids: ids || null, concurrency, cacheMode, startedAt: new Date().toISOString(), durationMs: 0, diagnostics: [], failedIds: [], strategy, interrupted: false };
  try {
    const response = await fetch(`${config.appBaseUrl.replace(/\/+$/, '')}/api/training-inject`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeoutSeconds * 1000),
      body: JSON.stringify({ trainTaskId: target.trainTaskId, courseId, libraryFolderId: libraryId,
        credentials: { cookie, authorization: token, userNid: config.polymas.userNid, apiOrigin: config.polymas.apiBaseUrl || undefined, trainSubType: type },
        llmSettings: config.llm, scriptMarkdown, rubricMarkdown, extractionMode: 'regex',
        injectMode: 'replace', injectDigitalHuman: false, injectKeyVocabularies: type === 'oral',
        imagePrepareOnly: true, imagePrepareIds: ids, imageConcurrency: concurrency, imageCacheMode: cacheMode, imageStrategy: strategy,
        injectCoverImage: true, injectBackgroundImage: true,
        imageModel: config.inject?.imageModel, imageProviderPriority: config.inject?.imageProviderPriority,
        coverStylePrompt: config.inject?.coverStylePrompt, backgroundStylePrompt: config.inject?.backgroundStylePrompt,
      }),
    });
    if (!response.ok) throw new Error(`Image preparation endpoint HTTP ${response.status}`);
    let failed = false;
    await consumeSSE(response, event => {
      if (event.type === 'complete') result.success = true;
      if (event.type === 'error') failed = true;
      const diagnostic = String(event.message || '').match(/^\[image\] (cover|background:\d+) .*cache=(hit|miss|shared|disabled); durationMs=(\d+); queueMs=(\d+)$/);
      if (diagnostic) {
        const imageFailed = String(event.message).includes('失败/待补图');
        result.diagnostics.push({ id: diagnostic[1], cache: diagnostic[2], durationMs: Number(diagnostic[3]), queueMs: Number(diagnostic[4]), failed: imageFailed });
        if (imageFailed) result.failedIds.push(diagnostic[1]);
      }
    });
    result.success = result.success && !failed;
    if (!result.success) throw new Error('Image preparation incomplete; inspect diagnostics and retry only failed IDs');
    result.durationMs = Date.now() - started;
    return { ...result, outputPath };
  } catch (error) {
    result.interrupted = true;
    // Do not persist provider errors or response bodies that could contain credentials.
    throw new Error(error?.name === 'TimeoutError' ? 'Image preparation timed out; no automatic retry' : 'Image preparation failed; no task/node writes requested; inspect images.prepare.json');
  } finally {
    result.durationMs = Date.now() - started;
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  }
}
