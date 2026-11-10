() => {
  // Read-only; never submits, resumes, or retries a write.
  const batchId = window.__agentCreatePollBatchId || window.__agentCreateLastBatchId;
  const job = window.__agentCreateRegistry?.batches[batchId];
  if (!job) return { ok: false, batchId, error: '没有本页批次记录；请使用已落盘结果回查平台，禁止直接重建' };
  return JSON.parse(JSON.stringify({ ok: job.phase === 'done' && job.results.every(x => x.ok), accepted: true,
    batchId, phase: job.phase, concurrency: job.concurrency, startedAt: job.startedAt,
    finishedAt: job.finishedAt, results: job.results }));
}
