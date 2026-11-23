export const hasGeolocation = () => 'geolocation' in navigator;
export const hasNotifications = () => 'Notification' in window;
export const canShare = () => typeof navigator.share === 'function';

export function getPosition({ timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!hasGeolocation()) {
      reject(new Error('Tu dispositivo no permite usar la ubicación.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude: Number(pos.coords.latitude.toFixed(7)),
        longitude: Number(pos.coords.longitude.toFixed(7)),
      }),
      (error) => reject(new Error(
        error.code === error.PERMISSION_DENIED
          ? 'Permiso de ubicación denegado.'
          : 'No se pudo obtener tu ubicación.'
      )),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 }
    );
  });
}

export async function requestNotificationPermission() {
  if (!hasNotifications()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

export async function notify(title, body, { tag = 'ahorrix', url = './#/presupuestos' } = {}) {
  if (!hasNotifications() || Notification.permission !== 'granted') return false;

  const registration = await navigator.serviceWorker?.getRegistration();
  if (registration) {
    await registration.showNotification(title, {
      body,
      tag,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      data: { url },
    });
    return true;
  }

  new Notification(title, { body, tag, icon: 'icons/icon-192.png' });
  return true;
}

export async function shareSummary(payload) {
  if (!canShare()) return false;
  await navigator.share(payload);
  return true;
}

/**
 * Captura el evento beforeinstallprompt para mostrar un botón propio de instalación.
 */
export function listenInstallPrompt(onAvailable, onInstalled) {
  let deferred = null;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event;
    onAvailable(async () => {
      if (!deferred) return 'unavailable';
      deferred.prompt();
      const choice = await deferred.userChoice;
      deferred = null;
      return choice.outcome;
    });
  });

  window.addEventListener('appinstalled', () => onInstalled?.());
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
