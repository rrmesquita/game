import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCar, stepCars } from './physics.js';
import { COLORS, TRACKS, MAX_PLAYERS, TICK_RATE, clamp } from '../shared/world.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clean = (s, max = 24) => typeof s === 'string' ? s.replace(/[\x00-\x1f<>]/g, '').trim().slice(0, max) : '';
function decodeTrackName(value) { try { return decodeURIComponent(value || ''); } catch { return ''; } }
const codeOf = () => randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
export function createGameServer() {
  const app = express(), http = createServer(app), io = new Server(http, { maxHttpBufferSize: 16_384 });
  const rooms = new Map(), tokens = new Map();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"); next(); });
  app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size, tickRate: TICK_RATE }));
  app.get('/api/rooms', (_req, res) => res.json([...rooms.values()].filter(r => r.public && r.players.size < MAX_PLAYERS)
    .map(r => ({ code: r.code, name: r.name, players: r.players.size, started: r.started }))));
  app.post('/api/rooms/:code/music', (req, res, next) => {
    const room = rooms.get(req.params.code);
    if (!room || tokens.get(req.get('x-host-token')) !== room.hostId) return res.status(403).json({ error: 'Só o Host pode enviar música.' });
    if (!room.started) return res.status(409).json({ error: 'Inicie o comboio primeiro.' });
    if (Date.now() - (room.lastUpload || 0) < 2000) return res.status(429).json({ error: 'Aguarde antes de enviar outra faixa.' });
    req.gameRoom = room; next();
  }, express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '12mb' }), (req, res) => {
    const room = req.gameRoom;
    if (!Buffer.isBuffer(req.body) || req.body.length < 32) return res.status(400).json({ error: 'Arquivo de áudio vazio ou inválido.' });
    if (rooms.get(room.code) !== room || tokens.get(req.get('x-host-token')) !== room.hostId) return res.status(403).json({ error: 'O Host mudou.' });
    const used = [...rooms.values()].reduce((total, r) => total + (r === room ? 0 : r.upload?.data.length || 0), 0);
    if (used + req.body.length > 128 * 1024 * 1024) return res.status(503).json({ error: 'Memória de áudio cheia. Tente uma faixa menor.' });
    // Um único buffer por sala, nunca arquivo executável ou caminho fornecido pelo usuário.
    room.upload = { data: req.body, type: req.get('content-type'), version: codeOf() }; room.lastUpload = Date.now();
    room.music = { id: 'upload', name: clean(decodeTrackName(req.get('x-track-name')), 48) || 'Minha faixa', bpm: 128,
      url: `/api/rooms/${room.code}/music?v=${room.upload.version}`, playing: true, startedAt: Date.now() + 1200, offset: 0 };
    io.to(room.code).emit('music', room.music); res.json({ ok: true });
  });
  app.get('/api/rooms/:code/music', (req, res) => {
    const room = rooms.get(req.params.code);
    // Salas privadas também protegem o áudio: só conexões participantes têm autorização.
    const id = tokens.get(req.get('x-player-token'));
    if (!room?.upload || !room.players.has(id)) return res.sendStatus(404);
    res.setHeader('Cache-Control', 'no-store'); res.type(room.upload.type).send(room.upload.data);
  });
  app.use('/vendor', express.static(path.join(root, 'node_modules/three/build')));
  app.use('/shared', express.static(path.join(root, 'shared')));
  app.use(express.static(path.join(root, 'public')));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.type === 'entity.too.large' ? 'Limite: 12 MB por faixa.' : 'Não foi possível processar o pedido.' }));
  function info(room) { return { code: room.code, name: room.name, public: room.public, started: room.started,
    hostId: room.hostId, music: room.music, players: [...room.players.values()].map(({ id, name, color, skin }) => ({ id, name, color, skin })) }; }
  const lobby = room => io.to(room.code).emit('room', info(room));
  function leave(socket) {
    const room = rooms.get(socket.data.code); if (!room) return;
    room.players.delete(socket.id); socket.leave(room.code); socket.data.code = null;
    if (!room.players.size) { rooms.delete(room.code); return; }
    if (room.hostId === socket.id) { room.hostId = room.players.keys().next().value;
      io.to(room.code).emit('notice', 'O Host saiu. O próximo jogador assumiu o carro de som.'); }
    lobby(room);
  }
  io.on('connection', socket => {
    const token = randomBytes(24).toString('hex'); tokens.set(token, socket.id);
    socket.emit('welcome', { id: socket.id, token, serverTime: Date.now() });
    socket.on('clock', callback => { if (typeof callback === 'function') callback(Date.now()); });
    const roomFor = () => rooms.get(socket.data.code);
    function limit(key, ms) { const now = Date.now(); if (now - (socket.data[key] || 0) < ms) return true; socket.data[key] = now; return false; }
    socket.on('create', (data = {}, ack) => {
      data = data && typeof data === 'object' ? data : {};
      if (typeof ack !== 'function') return;
      if (limit('joinAt', 500)) return ack({ error: 'Aguarde um instante.' });
      if (rooms.size >= 100) return ack({ error: 'Servidor cheio.' });
      leave(socket); let code; do { code = codeOf(); } while (rooms.has(code));
      const room = { code, name: clean(data.roomName) || 'Comboio da avenida', public: data.public !== false,
        hostId: socket.id, started: false, players: new Map(), music: { ...TRACKS[0], playing: false, startedAt: 0, offset: 0 } };
      rooms.set(code, room); join(room, data, ack);
    });
    function join(room, data, ack) {
      const color = COLORS.includes(data.color) ? data.color : COLORS[0];
      room.players.set(socket.id, createCar(socket.id, clean(data.name, 18) || 'Motorista', color,
        ['22', '13', 'livre'].includes(data.skin) ? data.skin : '22', room.players.size));
      socket.data.code = room.code; socket.join(room.code); ack({ ok: true, room: info(room) }); lobby(room);
    }
    socket.on('join', (data = {}, ack) => {
      data = data && typeof data === 'object' ? data : {};
      if (typeof ack !== 'function') return;
      if (limit('joinAt', 500)) return ack({ error: 'Aguarde um instante.' });
      const room = rooms.get(clean(data.code, 6).toUpperCase());
      if (!room) return ack({ error: 'Sala não encontrada.' });
      if (room.players.size >= MAX_PLAYERS && !room.players.has(socket.id)) return ack({ error: `Sala cheia (${MAX_PLAYERS} jogadores).` });
      if (socket.data.code === room.code) return ack({ ok: true, room: info(room) });
      leave(socket); join(room, data, ack);
    });
    socket.on('start', () => { const r = roomFor(); if (!r || r.hostId !== socket.id || r.started) return;
      r.started = true; r.music.playing = true; r.music.startedAt = Date.now() + 700; lobby(r); });
    socket.on('input', (data = {}) => { data = data && typeof data === 'object' ? data : {};  const car = roomFor()?.players.get(socket.id); if (!car || limit('inputAt', 20)) return;
      // Cliente envia intenções, nunca posições: velocidade e colisões são autoritativas.
      car.input = { throttle: Number.isFinite(data.throttle) ? clamp(data.throttle, -1, 1) : 0,
        steer: Number.isFinite(data.steer) ? clamp(data.steer, -1, 1) : 0, boost: data.boost === true };
      car.inputAt = Date.now(); });
    socket.on('auto', enabled => { const r = roomFor(), car = r?.players.get(socket.id); if (car && r.hostId !== socket.id) car.auto = enabled === true; });
    socket.on('musicControl', (data = {}) => { data = data && typeof data === 'object' ? data : {};  const r = roomFor(); if (!r?.started || r.hostId !== socket.id || limit('musicAt', 300)) return;
      const track = TRACKS.find(t => t.id === data.id);
      if (track) r.music = { ...track, playing: true, startedAt: Date.now() + 700, offset: 0 };
      else if (typeof data.playing === 'boolean') {
        const elapsed = r.music.offset + Math.max(0, Date.now() - r.music.startedAt) / 1000;
        r.music = { ...r.music, playing: data.playing, offset: r.music.playing ? elapsed : r.music.offset, startedAt: Date.now() + 200 };
      } else return;
      io.to(r.code).emit('music', r.music);
    });
    socket.on('chat', message => { const r = roomFor(); if (!r || limit('chatAt', 800)) return;
      const text = clean(message, 160); if (text) io.to(r.code).emit('chat', { name: r.players.get(socket.id).name, text }); });
    socket.on('horn', () => { const r = roomFor(); if (r?.started && !limit('hornAt', 700)) io.to(r.code).emit('horn', { id: socket.id }); });
    socket.on('reaction', emoji => { const r = roomFor(); if (r && ['🔥', '🇧🇷', '❤️', '😂'].includes(emoji) && !limit('reactionAt', 800)) io.to(r.code).emit('reaction', { id: socket.id, emoji }); });
    socket.on('leave', () => leave(socket));
    socket.on('disconnect', () => { leave(socket); tokens.delete(token); });
  });
  const timer = setInterval(() => {
    const time = Date.now();
    for (const r of rooms.values()) {
      if (!r.started) continue;
      stepCars(r.players, r.hostId, 1 / TICK_RATE, time);
      // 25 snapshots/s. Timestamp + velocidades permitem interpolação e extrapolação limitada.
      io.to(r.code).volatile.emit('snapshot', { time, hostId: r.hostId, players: [...r.players.values()].map(p => ({
        id: p.id, name: p.name, color: p.color, skin: p.skin, x: p.x, z: p.z, angle: p.angle,
        vx: p.vx, vz: p.vz, speed: p.speed, nitro: p.nitro, boost: p.boost, auto: p.auto })) });
    }
  }, 1000 / TICK_RATE);
  return { app, http, io, rooms, close: async () => { clearInterval(timer); await new Promise(resolve => io.close(resolve)); } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const game = createGameServer(), port = Number(process.env.PORT) || 3000;
  game.http.listen(port, '0.0.0.0', () => console.log(`Comboio 22 rodando na porta ${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await game.close(); process.exit(0); });
}
