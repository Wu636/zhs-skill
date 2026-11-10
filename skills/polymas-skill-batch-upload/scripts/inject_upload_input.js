() => {
  let el = document.getElementById('__skill_upload');
  if (!el) {
    el = document.createElement('input');
    el.type = 'file';
    el.id = '__skill_upload';
    el.accept = '.zip,application/zip';
    document.body.appendChild(el);
  }
  el.value = '';
  el.style.cssText = [
    'position:fixed', 'right:24px', 'bottom:24px', 'z-index:2147483647',
    'width:240px', 'height:36px', 'opacity:1', 'display:block',
    'background:#fff', 'border:1px dashed #1546F2'
  ].join(';');
  return { ready: true, id: el.id };
}
