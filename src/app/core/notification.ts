export type NotificationType = 'info' | 'success' | 'error';

export function showAppNotification(message: string, type: NotificationType = 'info'): void {
  const containerId = 'app-notification-container';
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    container.className = 'app-notification-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `app-notification-toast app-notification-${type}`;
  toast.textContent = message;

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));

  window.setTimeout(() => {
    toast.classList.remove('visible');
    window.setTimeout(() => {
      if (toast.parentElement) {
        toast.parentElement.removeChild(toast);
      }
    }, 250);
  }, 4200);
}
