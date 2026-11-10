async () => {
  // 登录/页面闸门：判断当前是否已登录、是否停在课程资源库，并给出下一步
  // 不读取 Cookie / localStorage / Authorization，只看页面已加载的 polyUserInfo 和 URL
  const href = location.href;
  const host = location.hostname;
  const segs = location.pathname.split('/').filter(Boolean);
  const q = new URLSearchParams(location.search);
  const inCenter = /(^|\.)hike-teaching-center\.polymas\.com$/.test(host);

  const u = (window.__MAIN_APP_USER_DATA__ || {}).polyUserInfo || {};
  const loggedIn = !!u.userNid;
  const onLoginPage = /(^|\.)(passport|login|sso|auth)[^.]*\.polymas\.com$/.test(host) || /\/login\b/i.test(location.pathname);

  let courseId = null, folderId = null;
  const hub = segs.indexOf('resource-hub');
  if (hub >= 0) courseId = segs[hub + 1];
  if (!courseId) {
    const full = segs.indexOf('agent-course-full');
    if (full >= 0) courseId = segs[full + 1];
  }
  const lib = segs.indexOf('agent-course-library');
  if (lib >= 0) folderId = segs[lib + 1];
  if (!folderId) folderId = q.get('libraryId');

  const agentId = q.get('agentId');
  const term = Number(q.get('term')) || null;
  const inCourse = !!(inCenter && courseId && folderId);

  let next = 'run_api_ctx';
  let hint = '';
  if (!loggedIn) {
    next = 'wait_login';
    hint = onLoginPage
      ? '停在登录页：请教师输入账号密码完成登录，登录后进入目标课程的资源库→智能体页面。'
      : '未检测到登录态：请教师在该页面登录，并进入目标课程的资源库→智能体页面。';
  } else if (!inCourse) {
    next = 'enter_course';
    hint = '已登录但不在课程资源库：请教师进入目标课程的「资源库 → 智能体」列表页，或给出课程链接。';
  }

  return {
    ok: next === 'run_api_ctx',
    loggedIn,
    inCenter,
    inCourse,
    onLoginPage,
    next,
    hint,
    href,
    courseId,
    folderId,
    agentId,
    term,
    user: loggedIn ? { realName: u.realName, userNid: u.userNid, schoolName: (u.schoolInfo || {}).schoolName, schoolId: (u.schoolInfo || {}).schoolId } : null
  };
}
