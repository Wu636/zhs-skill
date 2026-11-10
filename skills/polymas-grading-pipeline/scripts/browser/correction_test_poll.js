(async () => {
  // 每调用一次拉一轮报告；全部结束（SUCCESS/FAILED）后 phase 变 done。
  const API = "https://cloudapi.polymas.com";
  const REPORT = `${API}/ai-biz/v1/correction-skill/report-detail`;
  const TIMEOUT_MS = 15 * 60 * 1000;
  const runId = String(window.__ctRunId || window.__ctConfig?.runId || "");
  const state = runId ? Object.getOwnPropertyDescriptor(window.__ctRuns || {}, runId)?.value : window.__ctState;
  if (!state) return { ok: false, error: "先执行 correction_test_setup.js" };

  const summarize = () =>
    state.samples.map((s) => ({
      id: s.id,
      status: s.status,
      score: s.score,
      full: s.full,
      taskId: s.taskId,
      error: s.error,
      checkpointExceeded: Boolean(s.checkpointExceeded),
    }));

  if (state.phase === "done" || state.phase === "setup") {
    return { ok: true, phase: state.phase, samples: summarize() };
  }
  if (state.phase === "running") {
    return { ok: true, phase: "running", samples: summarize() };
  }

  const parseReport = (payload) => {
    const data = payload.data || {};
    const skill = data.skill || {};
    const scoring = data.scoring || {};
    const scoreData = scoring.scoreData || {};
    const rawItems = scoreData.items || [];
    const items = rawItems
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        name: item.itemName || "未命名评分项",
        score: item.itemScore,
        full: item.itemFullMark,
        comment: item.comment || "",
      }));
    let full = scoreData.fullMark;
    if (full === null || full === undefined) {
      full = items.reduce((sum, item) => sum + (Number(item.full) || 0), 0) || 100;
    }
    return {
      reportStatus: String(skill.reportStatus || "").toUpperCase(),
      score: scoreData.totalScore ?? scoring.totalScore ?? null,
      full,
      items,
      message: data.message || skill.message || "",
    };
  };

  if (state.pollInFlight) return { ok: true, runId, phase: state.phase, inFlight: true, samples: summarize() };
  state.phase = "polling";
  const terminal = (s) => s.status === "SUCCESS" || s.status === "FAILED";
  const tasks = state.samples.filter((s) => ["PENDING", "UNKNOWN"].includes(s.status) && s.taskId);
  if (!tasks.length) {
    state.phase = state.samples.every(terminal)
      ? "done"
      : "polling";
    return { ok: true, phase: state.phase, samples: summarize() };
  }

  state.pollInFlight = true;
  return (async () => {
    let cursor = 0;
    const worker = async () => {
    while (cursor < tasks.length) {
      const sample = tasks[cursor++];
      // Fifteen minutes is a checkpoint, not evidence of server failure.
      sample.checkpointExceeded = Date.now() - sample.startedAt > TIMEOUT_MS;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), state.queryTimeoutMs || 15000);
      try {
        const response = await fetch(`${REPORT}?taskId=${encodeURIComponent(sample.taskId)}`, {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok || (payload.code !== undefined && payload.code !== 200)) {
          throw new Error(payload.msg || payload.message || `HTTP ${response.status}`);
        }
        const report = parseReport(payload);
        sample.attempts += 1;
        if (report.reportStatus === "SUCCESS") {
          sample.error = "";
          sample.status = "SUCCESS";
          sample.score = report.score;
          sample.full = report.full;
          sample.items = report.items;
          sample.finishedAt = Date.now();
        } else if (report.reportStatus === "FAILED" || report.reportStatus === "ERROR") {
          sample.status = "FAILED";
          sample.error = report.message || report.reportStatus;
          sample.finishedAt = Date.now();
        } else {
          sample.status = "PENDING";
        }
      } catch (error) {
        sample.error = String(error && error.message ? error.message : error);
      } finally {
        clearTimeout(timer);
      }
    }
    };
    try {
      const concurrency = Math.min(8, Math.max(1, Number(state.pollConcurrency) || 3));
      await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
      if (state.samples.every(terminal)) state.phase = "done";
      return { ok: true, runId, phase: state.phase, samples: summarize() };
    } finally {
      state.pollInFlight = false;
    }
  })();
})()
