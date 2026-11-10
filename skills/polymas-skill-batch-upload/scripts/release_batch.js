async () => {
  // Browser function expression; execute (<file>)(). No credential extraction.
  const API = 'https://cloudapi.polymas.com';
  const copy = x => JSON.parse(JSON.stringify(x));
  const cfg = copy(window.__skillReleaseConfig || {});
  const registry = window.__skillReleaseRuns ||= { runs: Object.create(null), locks: Object.create(null) };
  const fail = error => ({ ok: false, error });
  const action = cfg.action || 'start';
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(cfg.runId || '')) return fail('Valid runId required');
  const view = state => copy({ runId: state.runId, phase: state.phase, stopped: state.stopped, startedAt: state.startedAt, finishedAt: state.finishedAt, items: state.items });
  let state = registry.runs[cfg.runId];
  if (action === 'poll') return state ? view(state) : fail('Unknown runId');
  const gate = item => item.uploadApproved === true && item.test && item.test.skillVersionId === item.skillVersionId && (item.test.status === 'passed' || (item.testApproved === true && typeof item.testApprovalReason === 'string' && item.testApprovalReason.trim()));
  if (action === 'start') {
    if (state) return { ...view(state), duplicate: true };
    const concurrency = cfg.concurrency ?? 3;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) return fail('concurrency must be 1..8');
    if (!Array.isArray(cfg.items) || !cfg.items.length) return fail('items required');
    const ids = new Set(), skills = new Set();
    for (const item of cfg.items) {
      if (!['id','skillNid','skillVersionId','courseId','folderId','term'].every(k => typeof item[k] === 'string' && item[k].trim())) return fail('Explicit item identity/course/folder/term required');
      if (!gate(item)) return fail('Current uploadApproved and candidate test passed or explicit testApproved exception required');
      if (ids.has(item.id) || skills.has(item.skillNid) || registry.locks[item.skillNid]) return fail('Duplicate skill/item; reconcile existing run, never refinalize');
      ids.add(item.id); skills.add(item.skillNid);
    }
    if (cfg.dryRun === true) return { ok: true, dryRun: true, runId: cfg.runId, count: cfg.items.length, concurrency };
    state = { runId: cfg.runId, concurrency, phase: 'running', stopped: false, startedAt: Date.now(), items: cfg.items.map(input => ({ input, id: input.id, skillNid: input.skillNid, skillVersionId: input.skillVersionId, status: 'queued', steps: {}, attempts: 0 })) };
    registry.runs[cfg.runId] = state;
    for (const item of state.items) registry.locks[item.skillNid] = cfg.runId;
  } else {
    if (!['reconcile','resume'].includes(action) || !state) return fail('Unknown action/run');
    if (state.phase === 'running') return { ...view(state), duplicate: true };
    if (action === 'resume' && cfg.resumeApproved !== true) return fail('resume requires current explicit resumeApproved');
    // Never accept replacement input or restored arbitrary step statuses.
    if (cfg.items) return fail('Existing run inputs are immutable');
    state.phase = 'running'; state.stopped = false;
  }
  const error = (message, props = {}) => Object.assign(new Error(message), props);
  const request = async (endpoint, body) => {
    if (state.stopped) throw error('Authentication failed; no new requests', { auth: true });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const r = await fetch(API + endpoint, { credentials: 'include', signal: controller.signal, ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
      if ([401,403].includes(r.status)) { state.stopped = true; throw error('Authentication required', { auth: true }); }
      let j; try { j = await r.json(); } catch { throw error('Non-JSON response', { unknown: true }); }
      if ([401,403].includes(Number(j.code))) { state.stopped = true; throw error('Authentication required', { auth: true }); }
      if (r.status >= 500 || !j || j.code === undefined) throw error('Ambiguous server response', { unknown: true });
      if (!r.ok || j.code !== 200) throw error(j.msg || j.message || 'Request rejected', { code: j.code, rejected: true });
      return j.data;
    } catch (e) {
      if (e.auth || e.rejected || e.unknown) throw e;
      throw error(String(e.message || e), { unknown: true });
    } finally { clearTimeout(timer); }
  };
  const detail = async item => {
    const data = await request('/ai-biz/v1/skill/' + encodeURIComponent(item.skillNid));
    const rows = Array.isArray(data) ? data : [data].filter(Boolean);
    const found = rows.filter(x => String(x.skillVersionId) === item.skillVersionId);
    if (found.length !== 1 || (found[0].skillNid && String(found[0].skillNid) !== item.skillNid)) throw error('Original candidate version identity not provable; no ID substitution', { blocked: true });
    return found[0];
  };
  const formal = row => Number(row.versionStatus) === 1 && row.version && row.version !== '草稿';
  const saved = row => !!row.fileId && !!row.filePath && !String(row.filePath).startsWith('draft/');
  const course = async item => {
    const rows = []; let page = 1;
    while (page <= 100) {
      const d = await request('/agents/v1/custom/grading/skill/pageList?courseId=' + encodeURIComponent(item.input.courseId) + '&term=' + encodeURIComponent(item.input.term) + '&pageNum=' + page + '&pageSize=100');
      const list = d?.records || d?.list;
      if (!Array.isArray(list)) throw error('Course verification response unsupported', { blocked: true });
      rows.push(...list);
      if (Number.isFinite(Number(d.total)) ? rows.length >= Number(d.total) : list.length < 100) break;
      if (!list.length) throw error('Incomplete pagination', { blocked: true });
      page++;
    }
    if (page > 100) throw error('Course verification pagination limit', { blocked: true });
    const matches = rows.filter(x => String(x.skillNid) === item.skillNid && (x.inCourse === true || x.inCourse === 1));
    if (matches.some(x => String(x.skillVersionId) !== item.skillVersionId)) throw error('Course already references a different version; do not switch', { blocked: true });
    return matches.some(x => String(x.skillVersionId) === item.skillVersionId);
  };
  const checkUnknown = async item => {
    const step = item.unknownStep;
    if (!step) return true;
    let proved = false;
    if (step === 'bind') proved = await course(item);
    else {
      const row = await detail(item);
      proved = step === 'save' ? saved(row) || formal(row) : formal(row) && (!item.publishVersion || String(row.version).replace(/^V/i,'') === item.publishVersion);
    }
    if (!proved) { item.status = 'unknown'; return false; }
    item.steps[step] = 'verified'; delete item.unknownStep;
    item.status = 'ready_resume'; return true;
  };
  const write = async (item, step, endpoint, payload) => {
    item.step = step; item.steps[step] = 'submitted'; item.updatedAt = Date.now();
    try {
      const data = await request(endpoint, payload); item.steps[step] = 'acknowledged';
      // An acknowledgement is not version/binding verification. A later read failure
      // must not allow resume to resend this irreversible write.
      if (step === 'finalize' || step === 'bind') item.unknownStep = step;
      return data;
    }
    catch(e) {
      if (e.unknown || e.auth) { item.unknownStep = step; item.status = 'unknown'; }
      else item.steps[step] = 'rejected';
      throw e;
    }
  };
  const workItem = async item => {
    if (item.status === 'done') return;
    try {
      if (action !== 'reconcile' && ['failed','blocked'].includes(item.status)) return;
      if (!await checkUnknown(item)) return;
      if (action === 'reconcile') { if (!item.unknownStep) item.status = 'ready_resume'; return; }
      if (item.status === 'failed' || item.status === 'blocked') return;
      if (!gate(item.input)) throw error('Candidate authorization invalid', { blocked: true });
      item.status = 'running'; item.step = 'draft';
      let row = await detail(item); item.steps.draft = 'verified';
      if (!formal(row)) {
        if (Number(row.versionStatus) !== 0 && row.version !== '草稿') throw error('Not an identifiable draft', { blocked: true });
        item.step = 'currentUser';
        const user = await request('/console/v1/get-current-user-detail', {});
        if (!user?.userNid) throw error('Current user identity unavailable', { blocked: true });
        const userName = user.nickName || user.userName || user.realName || '';
        if (!['acknowledged','verified'].includes(item.steps.save)) {
          await write(item, 'save', '/ai-biz/v1/skill/draft/save', { skillNid: item.skillNid, skillVersionId: item.skillVersionId, userName, fileTree: '' });
        }
        row = await detail(item); // Never infer an ID mapping after save.
        if (!formal(row)) {
          if (!item.publishVersion) {
            item.step = 'versionNumber';
            const v = await request('/ai-biz/v1/skill/publishVersionNo/' + encodeURIComponent(item.skillNid));
            if (typeof v !== 'string' || !v.trim()) throw error('Invalid publish version', { blocked: true });
            item.publishVersion = v.replace(/^V/i,'');
          }
          const payload = { userId: user.userNid, userName, skillVersionId: item.skillVersionId, skillNid: item.skillNid, publishVersion: item.publishVersion, versionDesc: item.input.versionDesc || ('首次定稿：生成 ' + item.publishVersion + ' 版本') };
          while (item.attempts < 6) {
            row = await detail(item);
            if (formal(row)) break;
            item.attempts++;
            try { await write(item, 'finalize', '/ai-biz/v1/skill/publish', payload); break; }
            catch(e) {
              if (e.code !== 10006 || item.attempts >= 6 || state.stopped) throw e;
              await new Promise(resolve => setTimeout(resolve, 3000));
            }
          }
        }
      }
      item.step = 'verifyVersion'; row = await detail(item);
      if (!formal(row) || (item.publishVersion && String(row.version).replace(/^V/i,'') !== item.publishVersion)) {
        item.unknownStep = 'finalize'; throw error('Finalization identity/status not yet verified', { unknown: true });
      }
      item.publishVersion = String(row.version).replace(/^V/i,''); item.steps.finalize = 'verified';
      if (item.unknownStep === 'finalize') delete item.unknownStep;
      item.step = 'verifyCourse';
      if (!await course(item)) {
        if (item.steps.bind === 'acknowledged') { item.unknownStep = 'bind'; throw error('Binding not yet visible', { unknown: true }); }
        await write(item, 'bind', '/course-deliver/course-skill/batchBindSkill', { resourceItems: [{ folderId: item.input.folderId, courseId: item.input.courseId }], skillVersions: [{ skillNid: item.skillNid, fileId: item.skillVersionId }] });
        if (!await course(item)) { item.unknownStep = 'bind'; throw error('Exact course/version binding not yet visible', { unknown: true }); }
      }
      item.steps.bind = 'verified'; item.steps.verify = 'verified'; item.status = 'done'; delete item.error; delete item.unknownStep;
    } catch(e) {
      item.error = String(e.message || e); if (e.code !== undefined) item.code = e.code;
      item.status = e.blocked ? 'blocked' : item.unknownStep ? 'unknown' : e.auth ? 'blocked_auth' : e.unknown ? 'read_pending' : 'failed';
      // One read-only reconciliation attempt; never repeat an uncertain write.
      if (item.unknownStep && !state.stopped) { try { await checkUnknown(item); } catch (_) {} }
    } finally { item.updatedAt = Date.now(); }
  };
  let cursor = 0;
  state.promise = Promise.all(Array.from({length: Math.min(state.concurrency, state.items.length)}, async () => {
    while (!state.stopped && cursor < state.items.length) await workItem(state.items[cursor++]);
  })).then(() => {
    for (const item of state.items) if (item.status === 'queued') item.status = 'blocked_auth';
    state.phase = 'done'; state.finishedAt = Date.now();
  });
  return { accepted: true, ...view(state) };
}
