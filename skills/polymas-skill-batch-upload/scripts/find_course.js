async () => {
  const query = window.__courseQuery;
  if (!query) return { ok: false, error: 'window.__courseQuery 未设置' };
  const r = await fetch('https://cloudapi.polymas.com/course-deliver/course-skill/pageList', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pageNum: 1, pageSize: 50, searchKey: query })
  });
  const body = await r.json().catch(() => null);
  if (r.status !== 200 || !body || body.code !== 200) {
    return { ok: false, status: r.status, error: (body && body.msg) || '课程查询失败' };
  }
  const records = ((body.data || {}).records) || [];
  const courses = records.map(x => ({
    courseId: x.courseId,
    courseName: x.courseName,
    folderId: x.folderId,
    owner: x.courseRealName || '',
    school: x.courseSchoolName || '',
    skillCount: x.skillCount
  }));
  const exact = courses.filter(x => x.courseName === query);
  return { ok: true, total: (body.data || {}).total || courses.length, exact, courses };
}
