async () => {
  const keys = [
    '__apiCtx', '__skillMap', '__agentItems', '__publishList',
    '__agentQuery', '__agentName', '__agentDesc', '__agentRequirement',
    '__agentSkillName', '__agentBatch', '__agentDryRun', '__agentState', '__reqlog'
  ];
  const cleared = [];
  keys.forEach(k => {
    if (k in window) {
      try { delete window[k]; } catch (e) { window[k] = undefined; }
      cleared.push(k);
    }
  });
  try { sessionStorage.removeItem('__agent'); cleared.push('sessionStorage.__agent'); } catch (e) {}
  return { ok: true, cleared };
}
