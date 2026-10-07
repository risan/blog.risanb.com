// The Bernina Express: its vehicles, where each one stands on the line, and the timetable that
// sends it down the loop and back. Pure: no DOM, no GL.
//
// A trip is driven by the position of the head of the train. The locomotives are always at the
// head, so on the way back the whole train simply faces the other way.

import { track } from './track.ts';

export type VehicleKind = 'locomotive' | 'panorama';

export interface VehicleSpec {
  kind: VehicleKind;
  // Over the couplers (and the gangway bellows of a coach), as published.
  length: number;
  // Distance between the two bogie pivots.
  bogieSpacing: number;
  // The running number on the cab fronts of a locomotive.
  number?: number;
}

// How far the coupler (or the bellows of a coach) reaches beyond the body at each end.
export const END_OVERHANG = 0.35;

// RhB ABe 4/4 III: 16.886 m over the couplers.
const LOCOMOTIVE_A: VehicleSpec = { kind: 'locomotive', length: 16.886, bogieSpacing: 10.2, number: 51 };
const LOCOMOTIVE_B: VehicleSpec = { kind: 'locomotive', length: 16.886, bogieSpacing: 10.2, number: 52 };
// RhB Bp panorama coach, rebuilt by Stadler in 2006/07: 16.45 m over the couplers.
const PANORAMA: VehicleSpec = { kind: 'panorama', length: 16.45, bogieSpacing: 10.7 };

// Two locomotives at the head, then six panorama coaches. The vehicles meet at the couplers.
export const CONSIST: VehicleSpec[] = [LOCOMOTIVE_A, LOCOMOTIVE_B, PANORAMA, PANORAMA, PANORAMA, PANORAMA, PANORAMA, PANORAMA];
export const TRAIN_LENGTH = CONSIST.reduce((total, vehicle) => total + vehicle.length, 0);

export const SPEED = 13;
const PAUSE_SECONDS = 4;
// The head enters the world at the far end of the line (the edge of the ground) and the whole
// train has left the picture by EXIT_S, past the exit track's last curve.
const ENTRY_S = 0;
const EXIT_S = track.approachS + 865;
// Where the head stands in the photograph: on the first arches at the south end of the viaduct.
const PHOTO_HEAD_S = track.viaduct.startS + 100;

export interface VehiclePose {
  x: number;
  y: number;
  z: number;
  // Unit vector from the rear bogie to the front bogie.
  forwardX: number;
  forwardY: number;
  forwardZ: number;
}

export function createPoses(): VehiclePose[] {
  return CONSIST.map(() => ({ x: 0, y: 0, z: 0, forwardX: 1, forwardY: 0, forwardZ: 0 }));
}

// `direction` is +1 when the train runs towards higher distances (down the loop) and -1 back up.
export function placeConsist(headS: number, direction: 1 | -1, poses: VehiclePose[]): void {
  const front = track.sample(0);
  const rear = track.sample(0);
  let offset = 0;

  CONSIST.forEach((vehicle, index) => {
    const centreS = headS - direction * (offset + vehicle.length / 2);
    track.sample(centreS + (direction * vehicle.bogieSpacing) / 2, front);
    track.sample(centreS - (direction * vehicle.bogieSpacing) / 2, rear);
    const dx = front.x - rear.x;
    const dy = front.y - rear.y;
    const dz = front.z - rear.z;
    const length = Math.hypot(dx, dy, dz);
    const pose = poses[index];
    pose.x = (front.x + rear.x) / 2;
    pose.y = (front.y + rear.y) / 2;
    pose.z = (front.z + rear.z) / 2;
    pose.forwardX = dx / length;
    pose.forwardY = dy / length;
    pose.forwardZ = dz / length;
    offset += vehicle.length;
  });
}

export interface TrainState {
  headS: number;
  direction: 1 | -1;
  moving: boolean;
}

// Both trips cover the stretch between the entry and exit points plus one train length, so that
// the whole train clears the picture.
const TRIP_SECONDS = (EXIT_S + TRAIN_LENGTH - ENTRY_S) / SPEED;
const DOWN_SECONDS = TRIP_SECONDS;
const UP_SECONDS = TRIP_SECONDS;
export const CYCLE_SECONDS = DOWN_SECONDS + UP_SECONDS + 2 * PAUSE_SECONDS;
// The clock value at which the train stands as in the photograph.
export const PHOTO_TIME = (PHOTO_HEAD_S - ENTRY_S) / SPEED;

export function trainStateAt(time: number): TrainState {
  const local = ((time % CYCLE_SECONDS) + CYCLE_SECONDS) % CYCLE_SECONDS;
  if (local < DOWN_SECONDS) {
    return { headS: ENTRY_S + local * SPEED, direction: 1, moving: true };
  }

  const afterDown = local - DOWN_SECONDS;
  if (afterDown < PAUSE_SECONDS) {
    return { headS: EXIT_S + TRAIN_LENGTH, direction: 1, moving: false };
  }

  const upLocal = afterDown - PAUSE_SECONDS;
  if (upLocal < UP_SECONDS) {
    return { headS: EXIT_S - upLocal * SPEED, direction: -1, moving: true };
  }

  return { headS: ENTRY_S - TRAIN_LENGTH, direction: -1, moving: false };
}
