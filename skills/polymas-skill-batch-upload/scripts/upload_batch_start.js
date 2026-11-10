() => {
  const registry = window.__skillUploadBatches;
  const state = registry?.runs.get(window.__skillUploadBatchRunId);
  const fail = error => ({ ok: false, error });
  if (!state) return fail('Unknown runId; setup first');
  if (state.phase !== 'setup') return fail('Already started; poll existing run, never resubmit');
  if (state.authorized !== true || state.dedupeConfirmed !== true) return fail('Missing authorization/deduplication record');
  const files = Array.from(document.getElementById(state.inputId)?.files || []);
  if (files.length !== state.items.length || new Set(files.map(f => f.name)).size !== files.length) return fail('Attach all ZIPs once; filenames must match exactly and be unique');
  const snapshots = new Map();
  for (const item of state.items) {
    const file = files.find(f => f.name === item.fileName);
    if (!file) return fail('Missing staged file: ' + item.fileName);
    snapshots.set(item.id, file); // immutable File references, not the live input
  }
  const keys = item => ['name:' + item.lockName, 'sha256:' + item.sha256];
  if (!state.dryRun) {
    for (const item of state.items) for (const key of keys(item)) {
      if (registry.locks.has(key)) return fail('Duplicate submission blocked by ' + registry.locks.get(key).runId + ': ' + key);
    }
    // Synchronous reservation and phase transition prevent double-start races.
    for (const item of state.items) for (const key of keys(item)) registry.locks.set(key, { runId: state.runId, id: item.id });
  }
  state.phase = 'running'; state.startedAt = Date.now();
  const record = (item, status, data = {}) => {
    item.status = status;
    state.results[item.id] = { id: item.id, name: item.name, fileName: item.fileName, sha256: item.sha256, type: item.type, status, ...data, updatedAt: Date.now() };
  };
  const stopAuth = () => {
    state.stopped = true; state.stopReason = 'AUTH_REQUIRED';
    for (const item of state.items) if (item.status === 'staged') record(item, 'blocked_auth', { retryAllowed: false, msg: 'Not submitted: authentication failure in batch' });
  };
  const upload = async item => {
    const file = snapshots.get(item.id);
    record(item, 'uploading', { size: file.size, retryAllowed: false });
    let timer;
    try {
      // Verify the manifest against the actual snapshotted bytes before POST.
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const actual = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      if (actual !== item.sha256) { record(item, 'invalid_file', { msg: 'SHA-256 mismatch; not submitted', retryAllowed: false }); return; }
      if (state.dryRun) { record(item, 'dry_run', { size: file.size, fields: { type: String(item.type), source: 'BUILTIN' }, retryAllowed: false }); return; }
      if (state.stopped) { record(item, 'blocked_auth', { msg: 'Not submitted: authentication failure', retryAllowed: false }); return; }
      const form = new FormData();
      form.append('zipFile', file, file.name); form.append('type', String(item.type)); form.append('source', 'BUILTIN');
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), 120000);
      item.submittedAt = Date.now();
      const response = await fetch('https://cloudapi.polymas.com/ai-biz/v1/skill/create/unify/agentSkill', { method: 'POST', credentials: 'include', body: form, signal: controller.signal });
      // Stop queued work as soon as the HTTP status is available.
      if ([401, 403].includes(response.status)) stopAuth();
      const text = await response.text();
      let body; try { body = JSON.parse(text); } catch (_) { body = null; }
      const code = body?.code ?? null;
      if ([401, 403].includes(Number(code))) stopAuth();
      const detail = { httpStatus: response.status, code, msg: body ? String(body.msg || body.message || '') : text.slice(0, 300), retryAllowed: false };
      if ([401, 403].includes(response.status) || [401, 403].includes(Number(code))) record(item, 'auth_failed', detail);
      else if (response.ok && code === 200 && body?.data?.skillNid) record(item, 'uploaded', { ...detail, skillNid: body.data.skillNid, skillVersionId: body.data.skillVersionId || null });
      else if (response.status < 500 && body && code !== null && code !== 200) record(item, 'rejected', detail);
      else record(item, 'unknown', { ...detail, msg: detail.msg || 'Ambiguous response: reconcile server state; DO NOT RESUBMIT' });
    } catch (error) {
      record(item, item.submittedAt ? 'unknown' : 'invalid_file', { retryAllowed: false, msg: String(error), reconciliationRequired: !!item.submittedAt });
    } finally { clearTimeout(timer); }
  };
  let cursor = 0;
  const worker = async () => {
    while (!state.stopped && cursor < state.items.length) {
      const item = state.items[cursor++];
      await upload(item);
    }
  };
  state.promise = Promise.all(Array.from({ length: Math.min(state.concurrency, state.items.length) }, worker))
    .then(() => { state.phase = 'done'; state.finishedAt = Date.now(); });
  return { ok: true, accepted: true, runId: state.runId, phase: state.phase, concurrency: state.concurrency, dryRun: state.dryRun };
}
