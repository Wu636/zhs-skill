() => {
  const state = window.__skillUploadBatches?.runs.get(window.__skillUploadBatchRunId);
  if (!state) return { ok: false, error: 'Unknown runId; after navigation/reload reconcile persisted results with server before any submission' };
  const items = state.items.map(item => ({ id: item.id, name: item.name, fileName: item.fileName, sha256: item.sha256, type: item.type, status: item.status, ...(state.results[item.id] || {}) }));
  return { ok: true, runId: state.runId, phase: state.phase, dryRun: state.dryRun, concurrency: state.concurrency, stopped: state.stopped, stopReason: state.stopReason || null, startedAt: state.startedAt || null, finishedAt: state.finishedAt || null, counts: items.reduce((a, i) => { a[i.status] = (a[i.status] || 0) + 1; return a; }, {}), items, reconciliationRequired: items.some(i => i.status === 'unknown'), resubmitAllowed: false };
}
