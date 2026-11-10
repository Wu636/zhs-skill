(async () => {
  // 输出 evaluate_test_scores.py 可直接读取的 JSON。
  const runId = String(window.__ctRunId || window.__ctConfig?.runId || "");
  const state = runId ? Object.getOwnPropertyDescriptor(window.__ctRuns || {}, runId)?.value : window.__ctState;
  if (!state) return JSON.stringify({ error: "先执行 correction_test_setup.js" });
  const samples = state.samples.map((sample) => ({
    id: sample.id,
    file: sample.file,
    kind: sample.kind,
    level: sample.level,
    status: sample.status,
    taskId: sample.taskId,
    teacherScore: sample.teacherScore,
    teacherFull: sample.teacherFull,
    teacherItems: sample.teacherItems,
    score: sample.score,
    full: sample.full,
    note: sample.error || "",
    checkpointExceeded: Boolean(sample.checkpointExceeded),
    items: sample.items,
  }));
  return JSON.stringify({
    runId: state.runId || "",
    phase: state.phase,
    skillNid: state.skillNid,
    skillVersionId: state.skillVersionId,
    modelName: state.modelName,
    exportedAt: new Date().toISOString(),
    samples,
  });
})()
