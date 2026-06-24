export function toast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (container) {
    const topOffset = window.innerWidth < 1024 ? 56 : 62;
    container.style.top = `${topOffset}px`;
    container.style.left = '16px';
    container.style.right = '16px';
    container.style.bottom = '16px';
    container.style.zIndex = '9999';
    container.style.pointerEvents = 'none';
  }
  if (typeof window.showToast === 'function') {
    window.showToast(message, type);
    return;
  }
  if (typeof window.showBackendToast === 'function') {
    window.showBackendToast(message, type);
    return;
  }

  let fallbackContainer = document.getElementById('react-toast-fallback');
  if (!fallbackContainer) {
    fallbackContainer = document.createElement('div');
    fallbackContainer.id = 'react-toast-fallback';
    fallbackContainer.style.cssText =
      `position:fixed;top:${window.innerWidth < 1024 ? 56 : 62}px;left:16px;right:16px;z-index:9999;pointer-events:none;display:flex;flex-direction:column;align-items:flex-end;gap:10px;`;
    document.body.appendChild(fallbackContainer);
  } else {
    fallbackContainer.style.top = `${window.innerWidth < 1024 ? 56 : 62}px`;
  }

  const toastNode = document.createElement('div');
  const accent = type === 'error' ? '#EF4444' : type === 'info' ? '#3B82F6' : '#10B981';
  toastNode.style.cssText =
    `pointer-events:auto;max-width:min(500px,100%);background:#1F1F1F;color:#E2E2E2;border:1px solid #252833;border-radius:12px;padding:17px 20px;box-shadow:0 16px 40px rgba(0,0,0,0.35);font-size:17px;line-height:1.55;display:flex;align-items:center;gap:14px;`;

  const iconWrap = document.createElement('span');
  iconWrap.style.cssText =
    `flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:999px;background:${accent};color:#ffffff;font-size:13px;font-weight:700;`;
  if (type === 'error') {
    iconWrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  } else if (type === 'info') {
    iconWrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 8v4"></path><path d="M12 16h.01"></path></svg>';
  } else {
    iconWrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  }

  const messageNode = document.createElement('span');
  messageNode.style.cssText = 'display:block;min-width:0;font-size:17px;line-height:1.55;font-weight:500;';
  messageNode.textContent = String(message || '');

  toastNode.appendChild(iconWrap);
  toastNode.appendChild(messageNode);
  fallbackContainer.appendChild(toastNode);
  window.setTimeout(() => {
    toastNode.remove();
    if (fallbackContainer && !fallbackContainer.childElementCount) {
      fallbackContainer.remove();
    }
  }, 3200);
}
