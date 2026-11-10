(async () => {
  // fire-and-poll：立即返回，进度看 window.__ctState。单次 evaluate_script 约 15 秒上限。
  const API = "https://cloudapi.polymas.com";
  const UPLOAD = `${API}/basic-resource/file/upload?hidden=false`;
  const EXECUTE = `${API}/ai-biz/v1/correction-skill/execute`;
  const cfg = window.__ctConfig || {};
  const runId = String(window.__ctRunId || cfg.runId || "");
  const state = runId ? Object.getOwnPropertyDescriptor(window.__ctRuns || {}, runId)?.value : window.__ctState;
  if (!state) return { ok: false, error: "先执行 correction_test_setup.js" };
  if (state.phase !== "setup") return { ok: false, error: `当前阶段 ${state.phase}，不能重复启动` };
  const requirement = state.submissionRequirement ?? cfg.submissionRequirement;
  const requirementAttachments = state.requirementAttachments ?? cfg.requirementAttachments ?? [];
  if (!requirement) return { ok: false, error: "submissionRequirement 未设置" };
  const fileInput = document.getElementById(state.inputId || "__ct_file_input");
  const files = fileInput ? Array.from(fileInput.files || []) : [];
  // FileList may contain same basenames from different directories; never pick the first.
  for (const sample of state.samples.filter((s) => !s.text)) {
    const matches = files.filter((file) => file.name.toLowerCase() === String(sample.file || "").toLowerCase());
    if (matches.length !== 1) return { ok: false, runId, error: `文件映射缺失或存在歧义: ${sample.file}` };
  }
  // Claim synchronously, before scheduling: a second start cannot race the timer.
  state.phase = "running";
  state.startedAt = Date.now();

  const uid = () => {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };

  const fetchJson = async (url, options, timeoutMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { credentials: "include", ...options, signal: controller.signal });
      const text = await response.text();
      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch (error) {
        throw new Error(`非 JSON 响应（HTTP ${response.status}）：${text.slice(0, 200)}`);
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}：${payload.msg || payload.message || text.slice(0, 200)}`);
      }
      if (payload.code !== undefined && payload.code !== 200) {
        throw new Error(payload.msg || payload.message || `code=${payload.code}`);
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  };

  const uploadFile = async (sample, file) => {
    const data = new FormData();
    data.append("identifyCode", uid());
    data.append("name", file.name);
    data.append("chunk", "0");
    data.append("chunks", "1");
    data.append("size", String(file.size));
    data.append("file", file, file.name);
    const payload = await fetchJson(UPLOAD, { method: "POST", body: data }, 120000);
    const uploaded = payload.data || {};
    if (!uploaded.ossUrl) throw new Error("上传成功但缺少 ossUrl");
    const suffix = String(uploaded.suffix || file.name.split(".").pop() || "file").toLowerCase();
    return {
      attachment: { type: suffix, url: String(uploaded.ossUrl) },
      meta: { fileId: String(uploaded.fileId || ""), fileName: String(uploaded.originFileName || file.name) },
    };
  };

  const run = async () => {
    let cursor = 0;
    const worker = async () => {
    while (cursor < state.samples.length) {
      const sample = state.samples[cursor++];
      if (sample.status !== "READY") continue;
      try {
        const attachments = [];
        if (!sample.text) {
          const target = files.find(
            (file) => file.name.toLowerCase() === String(sample.file || "").toLowerCase(),
          );
          if (!target) throw new Error(`页面文件输入里没有 ${sample.file}，先 upload_file 再启动`);
          const uploaded = await uploadFile(sample, target);
          attachments.push(uploaded.attachment);
          sample.upload = uploaded.meta;
        }
        sample.status = "SUBMITTING";
        sample.taskId = `test-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
        sample.startedAt = Date.now();
        await fetchJson(
          EXECUTE,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              skillVersionId: state.skillVersionId,
              taskId: sample.taskId,
              isTestRun: true,
              modelName: state.modelName,
              requirementAttachments,
              studentAttachments: attachments,
              studentSubmission: sample.text || "",
              submissionRequirement: requirement,
            }),
          },
          60000,
        );
        sample.status = "PENDING";
      } catch (error) {
        // Once execute was attempted, even a lost/rejected response is reconciled by
        // taskId. Never automatically resubmit a possibly accepted grading task.
        sample.status = sample.taskId ? "UNKNOWN" : "FAILED";
        sample.error = String(error && error.message ? error.message : error);
        if (!sample.taskId) sample.finishedAt = Date.now();
      }
    }
    };
    const concurrency = Math.min(8, Math.max(1, Number(state.submitConcurrency) || 3));
    await Promise.all(Array.from({ length: Math.min(concurrency, state.samples.length) }, worker));
    state.phase = "submitted";
  };

  // 延迟到 evaluate 返回后再执行；部分宿主会拒绝在调试求值里直接发起带副作用的调用。
  setTimeout(run, 0);
  return { ok: true, runId, accepted: true, samples: state.samples.map((s) => ({ id: s.id, status: s.status })) };
})()
