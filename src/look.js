import * as THREE from 'three';
import { motionPermission } from './motion.js';

// Look-around for POV mode: keyboard, drag, and the phone's motion sensors.
// Headings are radians clockwise from north; the camera looks north (-z) when its rotation is zero.
const rad = THREE.MathUtils.degToRad;
const Q1 = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2); // screen faces the viewer, not the sky
const ZEE = new THREE.Vector3(0, 0, 1), UP = new THREE.Vector3(0, 1, 0);

// Camera orientation for a phone's deviceorientation angles (degrees) and screen rotation (degrees).
// The same conversion three.js's former DeviceOrientationControls used.
export function deviceQuat(alpha, beta, gamma, orient = 0, out = new THREE.Quaternion()) {
  out.setFromEuler(new THREE.Euler(rad(beta), rad(alpha), -rad(gamma), 'YXZ'));
  return out.multiply(Q1).multiply(new THREE.Quaternion().setFromAxisAngle(ZEE, -rad(orient)));
}
// Compass heading (radians, clockwise from north) that an orientation looks toward
export function headingOf(q) {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  return Math.atan2(f.x, -f.z);
}
export const wrap = a => Math.atan2(Math.sin(a), Math.cos(a)); // angle into -PI..PI

const KEYS = { arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0], arrowup: [0, 1], w: [0, 1], arrowdown: [0, -1], s: [0, -1] };
const MAX_PITCH = rad(80);

export function createLook(el) {
  let yaw = 0, pitch = 0, drag = null, gyro = null; // gyro = { q, h0 } once the first sensor reading arrives
  const held = new Set();
  const down = e => { const k = e.key.toLowerCase(); if (KEYS[k]) { held.add(k); e.preventDefault(); } };
  const up = e => held.delete(e.key.toLowerCase());
  const clamp = () => (pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, pitch)));
  const pDown = e => { drag = [e.clientX, e.clientY]; el.setPointerCapture(e.pointerId); };
  const pMove = e => {
    if (!drag) return;
    yaw -= (e.clientX - drag[0]) * 0.004; pitch += (e.clientY - drag[1]) * 0.004; clamp(); // drag the scene, like a street-level viewer
    drag = [e.clientX, e.clientY];
  };
  const pUp = () => (drag = null);
  const onTilt = e => {
    if (e.alpha == null) return;
    const q = deviceQuat(e.alpha, e.beta, e.gamma, screen.orientation?.angle ?? window.orientation ?? 0, gyro?.q);
    gyro = gyro ? gyro : { q, h0: headingOf(q) }; // first reading: wherever the phone points becomes "straight ahead"
  };
  addEventListener('keydown', down); addEventListener('keyup', up);
  el.addEventListener('pointerdown', pDown); el.addEventListener('pointermove', pMove);
  el.addEventListener('pointerup', pUp); el.addEventListener('pointercancel', pUp);
  let listening = false;

  return {
    get gyroOn() { return listening; },
    // Turn the motion sensors on. Resolves to 'on', 'denied', 'insecure' or 'none'.
    // asked = a motionPermission() already started from a tap; without it this must itself be called from a tap.
    async enableGyro(asked = motionPermission()) {
      const ok = await asked;
      if (ok !== 'granted') return ok;
      gyro = null; yaw = pitch = 0;
      addEventListener('deviceorientation', onTilt); listening = true;
      await new Promise(done => setTimeout(done, 1200));
      if (gyro) return 'on';
      removeEventListener('deviceorientation', onTilt); listening = false; // no sensor answered (a desktop, or an insecure page)
      return 'none';
    },
    disableGyro() { removeEventListener('deviceorientation', onTilt); listening = false; gyro = null; yaw = pitch = 0; },
    recenter() { yaw = pitch = 0; if (gyro) gyro.h0 = headingOf(gyro.q); },
    // Point the camera: the direction of travel, turned by the viewer's own look
    apply(camera, travel, dt) {
      for (const k of held) { yaw += KEYS[k][0] * 1.6 * dt; pitch += KEYS[k][1] * 1.1 * dt; }
      clamp();
      if (gyro) camera.quaternion.setFromAxisAngle(UP, gyro.h0 - travel - yaw).multiply(gyro.q);
      else camera.rotation.set(pitch, -(travel + yaw), 0, 'YXZ');
    },
    dispose() {
      removeEventListener('keydown', down); removeEventListener('keyup', up); removeEventListener('deviceorientation', onTilt);
    },
  };
}
