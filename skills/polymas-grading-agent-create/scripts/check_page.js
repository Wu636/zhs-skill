async () => {
  const q = new URLSearchParams(location.search);
  const lib = location.pathname.match(/resource-hub\/([^/]+)\/agent-course-library\/([^/]+)\/agent/);
  const create = location.pathname.match(/agent-course-full\/([^/]+)\/resource\/skill-grading\/create/);
  return {
    ok: !!(lib || create),
    url: location.href,
    mode: lib ? 'library' : (create ? 'create' : 'other'),
    courseId: (lib && lib[1]) || (create && create[1]) || null,
    folderId: lib ? lib[2] : q.get('libraryId'),
    term: q.get('term'),
    instanceNid: q.get('instanceNid'),
    isCreate: q.get('isCreate')
  };
}
