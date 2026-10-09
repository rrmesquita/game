// Mantém um buffer de snapshots: desenhar 100 ms no passado absorve jitter de rede.
// Se faltarem pacotes, extrapola no máximo 120 ms e depois congela, evitando teleporte.
export function sampleSnapshots(frames, time) {
  if (!frames.length) return [];
  let a = frames[0], b = frames[0];
  for (let i = 1; i < frames.length; i++) { b = frames[i]; if (b.time >= time) break; a = b; }
  const fraction = a === b ? 1 : Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time)));
  const old = new Map(a.players.map(p => [p.id, p]));
  const extrapolate = Math.max(0, Math.min(0.12, (time - b.time) / 1000));
  return b.players.map(p => {
    const prev = old.get(p.id) || p;
    const angleDiff = Math.atan2(Math.sin(p.angle - prev.angle), Math.cos(p.angle - prev.angle));
    return { ...p, x: prev.x + (p.x - prev.x) * fraction + p.vx * extrapolate,
      z: prev.z + (p.z - prev.z) * fraction + p.vz * extrapolate,
      angle: prev.angle + angleDiff * fraction };
  });
}
