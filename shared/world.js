// A mesma geometria é usada pelo servidor para colisões e pelo cliente para desenhar.
export const WORLD_SIZE = 148;
export const AUDIO_RADIUS = 95;
export const MAX_PLAYERS = 30;
export const TICK_RATE = 25;
export const COLORS = ['#ffda35', '#36a7ff', '#15c987', '#ff755c', '#b78aff', '#eef3ff'];
export const TRACKS = [
  // MP3 enviado pelo usuário; BPM estimado apenas para os efeitos visuais.
  { id: 'tropa', name: 'Minha mãe é Bolsonaro, meu pai é Bolsonaro', bpm: 128, url: '/assets/audio/tropa-do-capitao.mp3' },
  { id: 'segundo-turno', name: 'Mega Funk Fora PT • Segundo turno é 22', bpm: 128, url: '/assets/audio/mega-funk-segundo-turno.mp3' },
  { id: 'avenida', name: 'Avenida • grave de rua', bpm: 128 },
  { id: 'paredao', name: 'Paredão • noite de neon', bpm: 140 },
  { id: 'domingo', name: 'Domingo • comboio solar', bpm: 120 },
  { id: 'turbo', name: 'Turbo • batida acelerada', bpm: 150 },
];
export const BUILDINGS = [];
for (let ix = -3; ix <= 2; ix++) for (let iz = -3; iz <= 2; iz++) {
  // Quarteirões ficam entre ruas em múltiplos de 40; a avenida central fica livre.
  const x = ix * 40 + 20, z = iz * 40 + 20;
  if (ix === 0 && iz === 0) continue; // praça / posto
  BUILDINGS.push({ x, z, w: 23, d: 23, h: 5 + ((ix + iz + 9) % 4) * 2,
    color: ['#f6bc93', '#f4e2b0', '#90c8bc', '#acc9e1'][(ix - iz + 8) % 4] });
}
export const OBSTACLES = [...BUILDINGS, { x: 28, z: 20, w: 10, d: 9, h: 4, color: '#f6eee2' },
  { x: -10, z: 25, w: 4.8, d: 12, h: 5, color: '#24994d', truck: true }];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function proximityVolume(distance, radius = AUDIO_RADIUS) {
  const u = clamp(1 - distance / radius, 0, 1);
  return u * u * (3 - 2 * u); // smoothstep: sem degraus nas extremidades.
}
export function spawnPoint(index) { return { x: (index % 3 - 1) * 5, z: 5 + Math.floor(index / 3) * 6 }; }
