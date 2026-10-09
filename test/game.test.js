import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createGameServer } from '../server/index.js';
import { createCar, collideWorld, stepCars } from '../server/physics.js';
import { proximityVolume, OBSTACLES } from '../shared/world.js';
import { sampleSnapshots } from '../public/js/net.js';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const event = (socket, name, timeout = 3000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.off(name, done); reject(new Error(`Timeout: ${name}`)); }, timeout);
  function done(data) { clearTimeout(timer); resolve(data); } socket.once(name, done);
});
const request = (socket, name, data) => new Promise((resolve, reject) => socket.timeout(3000).emit(name, data, (error, response) => error ? reject(error) : resolve(response)));
async function fixture(t) {
  const game = createGameServer(); await new Promise(resolve => game.http.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${game.http.address().port}`, clients = [];
  t.after(async () => { clients.forEach(c => c.disconnect()); await game.close(); });
  async function client() { const s = connect(url, { transports: ['websocket'], reconnection: false }); clients.push(s); const welcome = await event(s, 'welcome'); return { s, welcome }; }
  return { game, url, client };
}
test('curva espacial é contínua, monotônica e limitada ao raio', () => {
  assert.equal(proximityVolume(0), 1); assert.equal(proximityVolume(95), 0); assert.equal(proximityVolume(200), 0);
  assert.equal(proximityVolume(47.5), 0.5); let last = 1;
  for (let d = 0; d <= 95; d++) { const v = proximityVolume(d); assert.ok(v <= last && v >= 0); last = v; }
});
test('interpolação usa menor arco, extrapola por no máximo 120ms', () => {
  const a = { id: 'a', x: 0, z: 0, angle: Math.PI - 0.1, vx: 10, vz: 0 };
  const frames = [{ time: 1000, players: [a] }, { time: 1100, players: [{ ...a, x: 1, angle: -Math.PI + 0.1 }] }];
  const mid = sampleSnapshots(frames, 1050)[0]; assert.equal(mid.x, 0.5); assert.ok(Math.abs(mid.angle - Math.PI) < 0.001);
  assert.equal(sampleSnapshots(frames, 2000)[0].x, 2.2); assert.deepEqual(sampleSnapshots([], 1), []);
});
test('física limita velocidade, nitro consome, colisões separam e prédios bloqueiam', () => {
  const car = createCar('a', 'A', '#ffda35', '22', 0); car.x = 0; car.z = 0;
  car.input = { throttle: 1, steer: 0, boost: true }; car.inputAt = 10000;
  const players = new Map([['a', car]]);
  for (let i = 0; i < 25; i++) stepCars(players, 'a', 0.04, 10000);
  assert.ok(car.z < -5); assert.ok(car.speed <= 30.001); assert.ok(car.nitro < 0.6);
  const b = OBSTACLES[0]; car.x = b.x; car.z = b.z; collideWorld(car);
  assert.ok(Math.abs(car.x - b.x) >= b.w / 2 || Math.abs(car.z - b.z) >= b.d / 2);
  const second = createCar('b', 'B', '#36a7ff', '22', 1); car.x = second.x = 0; car.z = second.z = 0;
  car.vx = car.vz = 0; players.set('b', second); stepCars(players, 'a', 0.04, 20000);
  assert.ok(Math.hypot(car.x - second.x, car.z - second.z) >= 3.74);
});
test('sala privada: início pelo Host, snapshots, chat seguro, migração e limpeza', async t => {
  const { game, url, client } = await fixture(t), a = await client(), b = await client();
  const created = await request(a.s, 'create', { name: 'Host', public: false }); assert.ok(created.ok); assert.equal(created.room.music.id, 'tropa'); assert.equal(created.room.music.url, '/assets/audio/tropa-do-capitao.mp3'); const code = created.room.code;
  assert.equal(code.length, 6); assert.deepEqual(await (await fetch(`${url}/api/rooms`)).json(), []);
  assert.equal((await request(b.s, 'join', { code: 'XXXXXX' })).error, 'Sala não encontrada.');
  await wait(510); assert.ok((await request(b.s, 'join', { code, name: '<Visitante>' })).ok);
  b.s.emit('start'); await wait(80); assert.equal(game.rooms.get(code).started, false);
  const first = event(b.s, 'snapshot'); a.s.emit('start'); const snapshot = await first;
  assert.equal(snapshot.players.length, 2); assert.equal(snapshot.hostId, a.s.id);
  const message = event(a.s, 'chat'); b.s.emit('chat', '<script>alert(1)</script>'); assert.equal((await message).text, 'scriptalert(1)/script');
  const migrated = event(b.s, 'room'); a.s.disconnect(); assert.equal((await migrated).hostId, b.s.id);
  b.s.disconnect(); await wait(80); assert.equal(game.rooms.size, 0);
});
test('50 jogadores, autoridade musical, pausa e retomada, entradas inválidas', async t => {
  const { game, client } = await fixture(t), host = await client();
  const { room } = await request(host.s, 'create', { name: 'Host' }), code = room.code;
  const guests = [];
  for (let i = 0; i < 49; i++) { const guest = await client(); assert.ok((await request(guest.s, 'join', { code, name: `P${i}` })).ok); guests.push(guest); }
  const extra = await client(); assert.match((await request(extra.s, 'join', { code })).error, /cheia/);
  const snap = event(host.s, 'snapshot'); host.s.emit('start'); assert.equal((await snap).players.length, 50);
  guests[0].s.emit('musicControl', { id: 'turbo' }); await wait(80); assert.equal(game.rooms.get(code).music.id, 'tropa');
  const changed = event(guests[0].s, 'music'); host.s.emit('musicControl', { id: 'segundo-turno' }); const selected = await changed; assert.equal(selected.id, 'segundo-turno'); assert.equal(selected.url, '/assets/audio/mega-funk-segundo-turno.mp3');
  await wait(350); const paused = event(host.s, 'music'); host.s.emit('musicControl', { playing: false }); assert.equal((await paused).playing, false);
  await wait(350); const resumed = event(host.s, 'music'); host.s.emit('musicControl', { playing: true }); assert.equal((await resumed).playing, true);
  guests[0].s.emit('input', null); host.s.emit('musicControl', null); await wait(80); assert.equal(game.rooms.size, 1);
});
test('upload é exclusivo do Host, limitado e protegido por participante', async t => {
  const { url, client } = await fixture(t), a = await client(), b = await client();
  const { room } = await request(a.s, 'create', {}); await request(b.s, 'join', { code: room.code });
  const snap = event(a.s, 'snapshot'); a.s.emit('start'); await snap;
  const endpoint = `${url}/api/rooms/${room.code}/music`, body = new Uint8Array(128);
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'audio/wav', 'x-host-token': b.welcome.token }, body })).status, 403);
  const music = event(b.s, 'music');
  const sent = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'audio/wav', 'x-host-token': a.welcome.token, 'x-track-name': encodeURIComponent('Minha música') }, body });
  assert.equal(sent.status, 200); assert.equal((await music).name, 'Minha música');
  assert.equal((await fetch(endpoint)).status, 404);
  assert.equal((await fetch(endpoint, { headers: { 'x-player-token': b.welcome.token } })).status, 200);
  assert.equal((await fetch(`${url}/health`)).status, 200);
});
