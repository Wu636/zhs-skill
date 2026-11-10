(async () => {
  // Explicit one-shot selection, independent of __ctRunId/__ctConfig aliases:
  // window.__ctCleanup = { runId: "exact-run-id", resultsPersisted: true }
  // Use runId: "" only for a legacy run. Does not cancel server tasks.
  const request = window.__ctCleanup;
  if (!request || typeof request.runId !== "string" || request.resultsPersisted !== true) {
    return { ok: false, error: "需明确 runId 并确认 resultsPersisted=true 后清理" };
  }
  const runId = request.runId;
  const state = runId
    ? Object.getOwnPropertyDescriptor(window.__ctRuns || {}, runId)?.value
    : window.__ctState;
  if (!state) return { ok: false, runId, error: "未找到所选运行" };
  if ((state.runId || "") !== runId) return { ok: false, runId, error: "legacy alias 指向命名运行，拒绝清理" };
  // setup has not submitted anything; done must contain only terminal samples.
  if (!["setup", "done"].includes(state.phase) || state.pollInFlight ||
      (state.phase === "done" && state.samples.some((s) => !["SUCCESS", "FAILED"].includes(s.status)))) {
    return { ok: false, runId, error: "运行仍在进行或结果待定，拒绝清理" };
  }
  const inputId = state.inputId || (runId ? "" : "__ct_file_input");
  if (inputId) document.getElementById(inputId)?.remove();
  if (runId) delete window.__ctRuns[runId];
  if (window.__ctState === state) delete window.__ctState;
  if (window.__ctRunId === runId) delete window.__ctRunId;
  delete window.__ctCleanup; // prevent a stale confirmation being reused
  return { ok: true, runId, removedInputId: inputId };
})()
