/**
 * The app doesn't zoom; only photos do (PhotoViewer). The viewport meta tag and
 * `touch-action: pan-x pan-y` (global.css) stop pinch and double-tap zoom in Chrome and Firefox.
 * iPhone Safari ignores `user-scalable=no`, so on iOS we also cancel its pinch gestures here,
 * except inside an element marked `data-zoomable`.
 *
 * Members who need bigger text still get it: the app follows the phone's text-size setting.
 */
const insideZoomable = (target: EventTarget | null) =>
  target instanceof Element && target.closest('[data-zoomable]') !== null;

export function startNoZoom(): void {
  // Safari's own pinch events (iOS and macOS trackpads).
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => { if (!insideZoomable(e.target)) e.preventDefault(); }, { passive: false });
  }
  // Two-finger moves outside a photo: belt and braces for older iPhones.
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1 && !insideZoomable(e.target)) e.preventDefault();
  }, { passive: false });
  // Ctrl + mouse wheel / trackpad pinch on desktop browsers.
  document.addEventListener('wheel', (e) => { if (e.ctrlKey && !insideZoomable(e.target)) e.preventDefault(); }, { passive: false });
}
