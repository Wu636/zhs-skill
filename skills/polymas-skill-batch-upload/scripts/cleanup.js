() => {
  const el = document.getElementById('__skill_upload');
  if (el && el.parentNode) el.parentNode.removeChild(el);
  [
    '__skillName', '__skillType', '__skillDryRun', '__skillNid', '__skillVersionId',
    '__versionDesc', '__courseQuery', '__courseId', '__courseFolderId', '__courseName'
  ].forEach(k => { delete window[k]; });
  return { cleaned: true };
}
