// Asking for the phone's motion sensors (used by POV look-around). Kept apart from look.js so the planner can ask
// at the moment POV is tapped: iPhones only show the permission prompt when asked directly from a tap.

// A phone or tablet: the only devices where turning the device to look around makes sense
export const isTouch = () => navigator.maxTouchPoints > 0;

// Resolves to 'granted', 'denied', 'insecure' (the page is not on https or localhost, where browsers hide the sensors)
// or 'none' (this browser has no motion sensors). Call it straight from a tap or click handler, before any await.
export function motionPermission() {
  if (!window.isSecureContext) return Promise.resolve('insecure');
  if (!window.DeviceOrientationEvent) return Promise.resolve('none');
  if (typeof DeviceOrientationEvent.requestPermission !== 'function') return Promise.resolve('granted'); // Android: no prompt
  return DeviceOrientationEvent.requestPermission().then(r => (r === 'granted' ? 'granted' : 'denied'), () => 'denied');
}

// What to tell the viewer when motion look-around cannot start
export const MOTION_HELP = {
  insecure: 'Motion look needs a secure address (https). This page was opened over http, so the phone hides its motion sensors. Drag to look around instead.',
  denied: 'Motion access was refused. To be asked again, close this page, reopen it, then tap Use motion. Drag to look around meanwhile.',
  none: 'This device did not report any motion. Drag to look around instead.',
};
