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

export interface NotificationAction {
  label: string;
  /** The first action is drawn as the main button. */
  run: () => void;
}

/**
 * A toast with buttons (e.g. "Link" / "Not now"). It stays a little longer than a plain one, and
 * any button closes it. Returns a function that closes it early.
 */
export function showAppNotificationWithActions(
  message: string,
  actions: NotificationAction[],
  type: NotificationType = 'info',
  durationMs = 12000
): () => void {
  const containerId = 'app-notification-container';
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    container.className = 'app-notification-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `app-notification-toast app-notification-${type} app-notification-with-actions`;
  toast.setAttribute('role', 'status');
  const text = document.createElement('div');
  text.textContent = message;
  toast.appendChild(text);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    window.clearTimeout(timer);
    toast.classList.remove('visible');
    window.setTimeout(() => toast.parentElement?.removeChild(toast), 250);
  };

  const row = document.createElement('div');
  row.className = 'app-notification-actions';
  actions.forEach((action, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = index === 0 ? 'app-notification-action primary' : 'app-notification-action';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      close();
      action.run();
    });
    row.appendChild(button);
  });
  toast.appendChild(row);

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  const timer = window.setTimeout(close, durationMs);
  return close;
}
