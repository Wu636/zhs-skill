() => {
  // Configuration is snapshotted; this script does not fetch or read credentials.
  const cfg = window.__skillUploadBatchConfig || {};
  const fail = error => ({ ok: false, error });
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(cfg.runId || '')) return fail('runId must be 1-80 ASCII letters/digits/_/-');
  if (cfg.authorized !== true || cfg.dedupeConfirmed !== true) return fail('Current authorization and completed deduplication must be explicitly recorded');
  const concurrency = cfg.concurrency === undefined ? 3 : cfg.concurrency;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) return fail('concurrency must be 1..8');
  if (!Array.isArray(cfg.items) || !cfg.items.length) return fail('items required');
  const ids = new Set(), files = new Set(), names = new Set(), hashes = new Set();
  const items = [];
  for (const item of cfg.items) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || typeof item.name !== 'string' || !item.name.trim() || typeof item.fileName !== 'string' || !/\.zip$/i.test(item.fileName) || /[/\\]/.test(item.fileName) || !/^[a-f0-9]{64}$/i.test(item.sha256 || '') || ![1, 2].includes(item.type)) return fail('Each item requires unique id/fileName/name/sha256 and type 1 or 2');
    const name = item.name.normalize('NFKC').trim();
    const hash = item.sha256.toLowerCase();
    if (ids.has(item.id) || files.has(item.fileName) || names.has(name) || hashes.has(hash)) return fail('Duplicate id, fileName, normalized name or sha256 within batch');
    ids.add(item.id); files.add(item.fileName); names.add(name); hashes.add(hash);
    items.push({ id: item.id, fileName: item.fileName, name: item.name, sha256: hash, type: item.type, status: 'staged', lockName: name });
  }
  const registry = window.__skillUploadBatches ||= { runs: new Map(), locks: new Map() };
  if (registry.runs.has(cfg.runId)) return fail('runId already exists; poll it, never overwrite/restart');
  const inputId = '__skill_upload_batch_' + cfg.runId;
  if (document.getElementById(inputId)) return fail('input already exists');
  const input = document.createElement('input');
  input.type = 'file'; input.multiple = true; input.accept = '.zip'; input.id = inputId;
  input.setAttribute('aria-label', inputId);
  document.body.appendChild(input);
  registry.runs.set(cfg.runId, { runId: cfg.runId, inputId, concurrency, authorized: true, dedupeConfirmed: true, dryRun: cfg.dryRun === true, phase: 'setup', items, results: Object.create(null), stopped: false, createdAt: Date.now() });
  return { ok: true, runId: cfg.runId, inputId, selector: '#' + inputId, multiple: true, concurrency, dryRun: cfg.dryRun === true, fileNames: items.map(i => i.fileName) };
}
