async () => {
  // Independent items use a bounded pool; each item's four writes remain ordered.
  // Legacy: await this function => {ok, results}. Optional __agentCreateOptions.fireAndPoll.
  const clone = x => JSON.parse(JSON.stringify(x));
  if (!window.__apiCtx) return { ok: false, error: '先跑 api_ctx.js' };
  const C = clone(window.__apiCtx);
  const source = window.__agentItems || [];
  const items = clone(source);
  const skills = clone(window.__skillMap || {});
  const options = clone(window.__agentCreateOptions || {});
  if (!items.length) return { ok: false, error: 'window.__agentItems 为空' };
  const concurrency = Number(options.concurrency ?? 3);
  const timeoutMs = Number(options.timeoutMs ?? 60000);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16 || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
    return { ok: false, error: 'concurrency 必须为 1–16 整数，timeoutMs 必须为正数' };
  const R = window.__agentCreateRegistry ||= {
    batches: Object.create(null), signatures: Object.create(null), names: Object.create(null),
    instances: Object.create(null), refs: Object.create(null), sequence: 0
  };
  const scope = JSON.stringify([C.api, C.courseId]);
  const nameKey = it => JSON.stringify([scope, it.name.trim()]);
  const nidKey = nid => JSON.stringify([C.api, String(nid)]);
  for (const it of items) {
    if (typeof it.name !== 'string' || !it.name.trim() || typeof it.desc !== 'string' || typeof it.requirement !== 'string')
      return { ok: false, error: '每项需要非空 name 及字符串 desc / requirement' };
    it.skillVersionId ||= skills[it.skillName]?.skillVersionId;
    if (!it.skillVersionId) return { ok: false, error: `缺少技能版本: ${it.name}` };
  }
  const signature = JSON.stringify([C, items]);
  const snapshot = job => clone({
    ok: job.phase === 'done' && job.results.every(x => x.ok), accepted: true,
    batchId: job.batchId, phase: job.phase, concurrency: job.concurrency,
    startedAt: job.startedAt, finishedAt: job.finishedAt, results: job.results
  });
  const priorId = options.batchId || R.signatures[signature];
  if (priorId && R.batches[priorId]) {
    const prior = R.batches[priorId];
    if (prior.signature !== signature) return { ok: false, error: 'batchId 已用于不同输入，禁止覆盖', batchId: priorId };
    if (!(options.resume && !options.batchId && prior.phase === 'done' && items.every(it => it.instanceNid)))
      return { ...snapshot(prior), duplicate: true };
  }
  const names = new Set(), nids = new Set();
  for (const it of items) {
    const nk = nameKey(it), old = R.names[nk];
    if (names.has(nk)) return { ok: false, error: `同批名称重复: ${it.name}` };
    names.add(nk);
    if (old && (old.active || (old.result.ok && !options.resume) || !it.instanceNid || (old.result.instanceNid && String(it.instanceNid) !== String(old.result.instanceNid))))
      return { ok: false, error: `同名任务已登记；先轮询/回查，禁止自动重建: ${it.name}`, existing: clone(old.result), batchId: old.batchId };
    if (it.instanceNid) {
      const ik = nidKey(it.instanceNid);
      if (nids.has(ik) || R.instances[ik]) return { ok: false, error: `实例正在处理或同批重复: ${it.instanceNid}` };
      nids.add(ik);
    }
  }
  const batchId = String(options.batchId || `agents-${Date.now()}-${++R.sequence}`);
  const job = { batchId, signature, phase: 'running', concurrency, startedAt: Date.now(), results: items.map(it => ({ name: it.name, instanceNid: it.instanceNid || null, created: false, ok: false, status: 'queued' })) };
  R.batches[batchId] = job;
  R.signatures[signature] = batchId;
  window.__agentCreateLastBatchId = batchId;
  // Reserve all names/known instances before the first await (including queued items).
  items.forEach((it, i) => {
    R.names[nameKey(it)] = { batchId, active: true, result: job.results[i] };
    if (it.instanceNid) R.instances[nidKey(it.instanceNid)] = batchId;
  });
  const post = async (endpoint, body) => {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const r = await fetch(C.api + endpoint, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
          const j = await r.json();
          if (r.status < 200 || r.status >= 300 || j.code !== 200) {
            const e = new Error(j.msg || `HTTP ${r.status}, code=${j.code}`);
            e.code = j.code;
            throw e;
          }
          return j.data;
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('请求超时，先回查服务端，不自动重试')); }, timeoutMs); })
      ]);
    } finally { clearTimeout(timer); }
  };
  const run = async (it, i) => {
    const result = job.results[i];
    let lockedNid = it.instanceNid ? nidKey(it.instanceNid) : null;
    const bcStr = JSON.stringify({
      compositionRequirement: { writingRequirementType: 'FIXED', writingRequirement: it.requirement },
      globalConfiguration: { selectedModel: C.model, globalInstruction: C.globalInstruction },
      gradingConfiguration: { skills: [it.skillVersionId], fullMark: [100] }
    });
    try {
      result.status = 'running';
      if (!result.instanceNid) {
        result.step = 'create';
        const nid = await post('/agents/v1/create/agent', {
          businessType: 'SMART_AGENT_COURSE', agentRefNid: C.agentId, userId: C.userId, schoolId: C.schoolId,
          businessConfig: bcStr, avatar: C.avatar, instanceName: it.name, desc: it.desc
        });
        if (!nid || !['string', 'number'].includes(typeof nid)) throw new Error('create 未返回有效 instanceNid，必须回查');
        result.instanceNid = nid;
        result.created = true;
        const ik = nidKey(nid);
        if (R.instances[ik]) throw new Error('create 返回已锁定实例，停止写入并回查');
        R.instances[ik] = batchId;
        lockedNid = ik;
        // Keep legacy write-back, but never write into a replaced or edited input item.
        if (window.__agentItems === source && source[i]?.name === it.name) source[i].instanceNid = nid;
      }
      const nid = result.instanceNid;
      const refKey = JSON.stringify([scope, C.agentId, nid]);
      result.step = 'createRef';
      if (!R.refs[refKey]) {
        await post('/basic-course/courseAgent/createRef', { courseId: C.courseId, agentId: C.agentId, agentInstanceId: nid, businessType: 'course', businessId: C.courseId, agentType: 'agent_mark' });
        R.refs[refKey] = true;
      }
      result.step = 'update';
      result.version = await post('/agents/v1/update/agent', { agentInstanceNid: nid, ignoreNull: false, avatar: C.avatar, instanceName: it.name, desc: it.desc, businessConfig: bcStr, courseId: C.courseId, term: C.term });
      if (result.version === undefined || result.version === null) throw new Error('update 未返回 version，停止落库并回查');
      result.step = 'updateRef';
      await post('/basic-course/courseAgent/updateRef', { courseId: C.courseId, agentId: C.agentId, agentInstanceId: nid, version: result.version, createUser: C.userId, libraryFolderId: C.folderId, isPublish: 0, businessType: 'course', businessId: C.courseId, agentType: 'agent_mark', term: C.term });
      Object.assign(result, { ok: true, status: 'done', skillVersionId: it.skillVersionId, descChars: it.desc.length, reqChars: it.requirement.length });
    } catch (e) {
      // Conservatively treat ANY unsuccessful create without an ID as unknown: never auto-create again.
      result.status = result.step === 'create' && !result.instanceNid ? 'unknown' : 'failed';
      result.error = String(e?.message || e);
      if (e.code !== undefined) result.code = e.code;
    } finally {
      result.finishedAt = Date.now();
      R.names[nameKey(it)].active = false;
      if (lockedNid && R.instances[lockedNid] === batchId) delete R.instances[lockedNid];
    }
  };
  let cursor = 0;
  const work = async () => {
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) { const i = cursor++; await run(items[i], i); }
    }));
    job.phase = 'done';
    job.finishedAt = Date.now();
    return snapshot(job);
  };
  if (options.fireAndPoll) {
    setTimeout(() => { job.promise = work(); }, 0);
    return snapshot(job);
  }
  job.promise = work();
  return await job.promise;
}
