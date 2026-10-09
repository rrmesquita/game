import { OBSTACLES, WORLD_SIZE, clamp } from '../shared/world.js';
export function createCar(id, name, color, skin, index) {
  return { id, name, color, skin, x: (index % 3 - 1) * 5, z: 5 + Math.floor(index / 3) * 6,
    angle: 0, vx: 0, vz: 0, speed: 0, nitro: 1, boost: false, auto: false,
    input: { throttle: 0, steer: 0, boost: false }, inputAt: 0 };
}
export function collideWorld(car, radius = 1.75) {
  car.x = clamp(car.x, -WORLD_SIZE + radius, WORLD_SIZE - radius);
  car.z = clamp(car.z, -WORLD_SIZE + radius, WORLD_SIZE - radius);
  for (const b of OBSTACLES) {
    const left = b.x - b.w / 2, right = b.x + b.w / 2;
    const top = b.z - b.d / 2, bottom = b.z + b.d / 2;
    const px = clamp(car.x, left, right), pz = clamp(car.z, top, bottom);
    let dx = car.x - px, dz = car.z - pz, d = Math.hypot(dx, dz);
    if (d >= radius) continue;
    if (d < 0.0001) {
      const sides = [[car.x - left, -1, 0], [right - car.x, 1, 0], [car.z - top, 0, -1], [bottom - car.z, 0, 1]];
      sides.sort((a, b) => a[0] - b[0]);
      const [depth, nx, nz] = sides[0];
      car.x += nx * (depth + radius); car.z += nz * (depth + radius); dx = nx; dz = nz; d = 1;
    } else { car.x += dx / d * (radius - d); car.z += dz / d * (radius - d); }
    const nx = dx / d, nz = dz / d, dot = car.vx * nx + car.vz * nz;
    if (dot < 0) { car.vx -= dot * nx * 1.15; car.vz -= dot * nz * 1.15; }
  }
}
export function stepCars(players, hostId, dt, now) {
  const list = [...players.values()], host = players.get(hostId);
  for (let i = 0; i < list.length; i++) {
    const car = list[i]; let { throttle, steer, boost } = car.input;
    if (now - car.inputAt > 600) { throttle = 0; steer = 0; boost = false; }
    if (car.auto && car !== host && host) {
      const rank = list.filter(p => p !== host).indexOf(car) + 1;
      const tx = host.x - Math.sin(host.angle) * (7 + rank * 5);
      const tz = host.z + Math.cos(host.angle) * (7 + rank * 5);
      const diff = Math.atan2(Math.sin(Math.atan2(tx - car.x, -(tz - car.z)) - car.angle),
        Math.cos(Math.atan2(tx - car.x, -(tz - car.z)) - car.angle));
      steer = clamp(diff * 1.9, -1, 1); throttle = Math.hypot(tx - car.x, tz - car.z) > 4 ? 0.75 : 0; boost = false;
    }
    car.boost = Boolean(boost && car.nitro > 0.06 && throttle > 0);
    car.nitro = clamp(car.nitro + (car.boost ? -0.5 : 0.18) * dt, 0, 1);
    const forwardX = Math.sin(car.angle), forwardZ = -Math.cos(car.angle);
    const longitudinal = car.vx * forwardX + car.vz * forwardZ;
    // Direção depende da velocidade; marcha a ré inverte a curva. Atrito lateral baixo dá drift.
    car.angle += steer * clamp(Math.abs(longitudinal) / 5, 0, 1) * 1.75 * dt * (longitudinal < -0.3 ? -1 : 1);
    const accel = throttle * (car.boost ? 30 : 18);
    car.vx += forwardX * accel * dt; car.vz += forwardZ * accel * dt;
    const sideX = Math.cos(car.angle), sideZ = Math.sin(car.angle);
    const lateral = car.vx * sideX + car.vz * sideZ;
    car.vx -= sideX * lateral * Math.min(1, dt * 5); car.vz -= sideZ * lateral * Math.min(1, dt * 5);
    const drag = Math.exp(-dt * (throttle ? 0.65 : 2.1)); car.vx *= drag; car.vz *= drag;
    const speed = Math.hypot(car.vx, car.vz), max = car.boost ? 30 : 21;
    if (speed > max) { car.vx *= max / speed; car.vz *= max / speed; }
    car.x += car.vx * dt; car.z += car.vz * dt;
    collideWorld(car, car.id === hostId ? 2 : 1.75);
  }
  // Impulsos simétricos: jogadores se empurram, sem tomar autoridade de posição do servidor.
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j], dx = b.x - a.x, dz = b.z - a.z;
    const d = Math.hypot(dx, dz), min = (a.id === hostId || b.id === hostId) ? 3.75 : 3.5;
    if (d >= min) continue;
    const nx = d > 0.001 ? dx / d : 1, nz = d > 0.001 ? dz / d : 0;
    const push = (min - d) / 2; a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
    const closing = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
    if (closing < 0) { const impulse = -closing * 0.55;
      a.vx -= nx * impulse; a.vz -= nz * impulse; b.vx += nx * impulse; b.vz += nz * impulse; }
  }
  for (const car of list) { collideWorld(car, car.id === hostId ? 2 : 1.75); car.speed = Math.hypot(car.vx, car.vz); }
}
