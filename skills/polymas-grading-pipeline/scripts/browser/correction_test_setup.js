(async () => {
  // Only reuse the logged-in page session. This script does not grant teacher approval.
  // Named runs: cfg.runId at setup; window.__ctRunId selects subsequent operations.
  // Without either selector, the original __ctState / __ct_file_input API is retained.
  const cfg = window.__ctConfig || {};
  if (!cfg.skillVersionId) return { ok: false, error: "window.__ctConfig.skillVersionId 未设置" };
  const runId = String(cfg.runId || window.__ctRunId || "");
  const runs = window.__ctRuns || (window.__ctRuns = Object.create(null));
  const existing = runId ? Object.getOwnPropertyDescriptor(runs, runId)?.value : window.__ctState;
  if (existing && (runId || existing.phase !== "done")) {
    return { ok: false, runId, error: "运行已存在；继续查询原任务，或为新候选指定新的 runId" };
  }
  if (!Array.isArray(cfg.samples)) return { ok: false, error: "samples 必须是数组" };
  const ids = new Set(), fileNames = new Set();
  for (const [index, sample] of cfg.samples.entries()) {
    if (!sample || typeof sample !== "object") return { ok: false, error: "样本必须为对象" };
    const id = String(sample.id || sample.file || `sample-${index + 1}`);
    if (ids.has(id)) return { ok: false, error: `重复样本 id: ${id}` };
    ids.add(id);
    if (!sample.text) {
      const name = String(sample.file || "").toLowerCase();
      if (!name || fileNames.has(name)) return { ok: false, error: `文件映射为空或存在歧义: ${name}` };
      fileNames.add(name);
    }
  }
  const bounded = (value, fallback, max) => Number.isFinite(Number(value)) && Number(value) > 0
    ? Math.min(max, Math.max(1, Math.floor(Number(value)))) : fallback;
  const inputId = runId ? `__ct_file_input_${encodeURIComponent(runId)}` : "__ct_file_input";
  let input = document.getElementById(inputId);
  if (!input) {
    input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.id = inputId;
    input.setAttribute("aria-label", inputId);
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
  } else {
    input.value = "";
  }
  const samples = (cfg.samples || []).map((sample, index) => ({
    id: sample.id || sample.file || `sample-${index + 1}`,
    file: sample.file || "", text: sample.text || "",
    kind: sample.kind || "teacher", level: sample.level || "",
    teacherScore: sample.teacherScore ?? null, teacherFull: sample.teacherFull ?? null,
    teacherItems: JSON.parse(JSON.stringify(sample.teacherItems || [])),
    taskId: "", status: "READY", score: null, full: null, items: [], error: "",
    attempts: 0, startedAt: 0, finishedAt: 0,
  }));
  const state = {
    runId, inputId, phase: "setup", skillNid: cfg.skillNid || "",
    skillVersionId: cfg.skillVersionId, modelName: cfg.modelName || "deepseek-v4.1-flash",
    // Snapshot per-run payload: later changes to __ctConfig must not affect this run.
    submissionRequirement: cfg.submissionRequirement || "",
    requirementAttachments: JSON.parse(JSON.stringify(cfg.requirementAttachments || [])),
    submitConcurrency: bounded(cfg.submitConcurrency, 3, 8),
    pollConcurrency: bounded(cfg.pollConcurrency, 3, 8),
    queryTimeoutMs: bounded(cfg.queryTimeoutMs, 15000, 120000),
    startedAt: 0, samples, error: "",
  };
  if (runId) {
    Object.defineProperty(runs, runId, { value: state, configurable: true, writable: true, enumerable: true });
    window.__ctRunId = runId;
  }
  window.__ctState = state; // legacy inspection alias; named operations never fall back to it
  return { ok: true, runId, inputId, sampleCount: samples.length,
    needsFiles: samples.filter((s) => !s.text && s.file).map((s) => s.file) };
})()
