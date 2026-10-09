import { GameScene } from './scene.js';
import { SpatialAudio } from './audio.js';
import { sampleSnapshots } from './net.js';
import { COLORS, TRACKS, OBSTACLES, WORLD_SIZE, AUDIO_RADIUS, clamp } from '/shared/world.js';
const $ = id => document.getElementById(id), show = (id, visible) => $(id).classList.toggle('hidden', !visible);
let toastTimer;
function toast(message) { $('toast').textContent = message; show('toast', true); clearTimeout(toastTimer); toastTimer = setTimeout(() => show('toast', false), 4500); }
let scene;
try { scene = new GameScene($('world')); show('loading', false); } catch (error) { show('loading', false); show('webgl-error', true); console.error(error); }
const socket = window.io({ reconnection: true }), audio = new SpatialAudio(toast);
let myId = '', token = '', room = null, color = COLORS[0], snapshots = [], history = [], replay = null;
let clockOffset = 0, bestRtt = Infinity, mode = 'chase', displayed = [], livePlayers = [], lastInput = 0, lastHud = 0;
const keys = new Set(), touch = { throttle: 0, steer: 0, boost: false };
const serverNow = () => Date.now() + clockOffset;
function clockSync() {
  const sent = Date.now(); socket.timeout(3000).emit('clock', (error, time) => {
    if (error) return; const received = Date.now(), rtt = received - sent;
    if (rtt <= bestRtt + 25) { clockOffset = time - (sent + received) / 2; bestRtt = Math.min(bestRtt, rtt); }
  });
}
setInterval(() => { if (socket.connected) clockSync(); }, 5000);
socket.on('welcome', data => { myId = data.id; token = data.token; clockOffset = data.serverTime - Date.now(); bestRtt = Infinity; clockSync(); });
socket.on('connect', () => { show('connection', false); refreshRooms(); });
socket.on('disconnect', () => {
  show('connection', true); keys.clear(); touch.throttle = touch.steer = 0; touch.boost = false;
  if (room) { resetRoom(); toast('A conexão caiu. Entre novamente na sala; seu carro foi removido.'); }
});
socket.on('connect_error', () => show('connection', true));
async function unlock() {
  try { const ready = await audio.unlock(); show('unlock-audio', !ready); if (ready && room?.started) await audio.setMusic(room.music, serverNow, token); }
  catch { show('unlock-audio', true); toast('Toque em “ativar o áudio” para liberar o som.'); }
}
$('unlock-audio').onclick = unlock;
for (const c of COLORS) {
  const b = document.createElement('button'); b.style.backgroundColor = c; b.setAttribute('aria-label', `Cor ${c}`); b.setAttribute('aria-pressed', String(c === color)); b.classList.toggle('active', c === color);
  b.onclick = () => { color = c; for (const child of $('colors').children) { child.classList.toggle('active', child === b); child.setAttribute('aria-pressed', String(child === b)); } }; $('colors').append(b);
}
for (const track of TRACKS) { const option = document.createElement('option'); option.value = track.id; option.textContent = track.name; $('tracks').append(option); }
function tab(create) { show('create-form', create); show('join-form', !create); $('tab-create').classList.toggle('selected', create); $('tab-join').classList.toggle('selected', !create); $('form-error').textContent = ''; }
$('tab-create').onclick = () => tab(true); $('tab-join').onclick = () => tab(false);
const playerData = () => ({ name: $('name').value, color, skin: $('skin').value });
async function requestRoom(event, data) {
  if (!socket.connected) { $('form-error').textContent = 'Sem conexão com o servidor.'; return; }
  $('form-error').textContent = ''; void unlock();
  $('create-form').querySelector('button[type=submit]').disabled = true; $('join-form').querySelector('button[type=submit]').disabled = true;
  socket.timeout(5000).emit(event, data, (error, result) => {
    $('create-form').querySelector('button[type=submit]').disabled = false; $('join-form').querySelector('button[type=submit]').disabled = false;
    if (error || result?.error) { $('form-error').textContent = result?.error || 'Servidor não respondeu. Tente novamente.'; return; }
    applyRoom(result.room);
  });
}
$('create-form').onsubmit = event => { event.preventDefault(); requestRoom('create', { ...playerData(), roomName: $('room-name').value, public: $('public').checked }); };
$('join-form').onsubmit = event => { event.preventDefault(); requestRoom('join', { ...playerData(), code: $('code').value }); };
async function refreshRooms() {
  if (room) return;
  try {
    const response = await fetch('/api/rooms'); if (!response.ok) throw new Error(); const list = await response.json(); $('public-rooms').replaceChildren();
    if (!list.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'A avenida está livre. Seja o primeiro a ligar o som.'; $('public-rooms').append(p); }
    for (const r of list.slice(0, 10)) {
      const button = document.createElement('button'); button.className = 'public-room'; const name = document.createElement('span'); name.textContent = r.name;
      const info = document.createElement('small'); info.textContent = `${r.players}/12 ${r.started ? '• na rua' : '• lobby'} →`; button.append(name, info);
      button.onclick = () => requestRoom('join', { ...playerData(), code: r.code }); $('public-rooms').append(button);
    }
  } catch { $('public-rooms').textContent = 'Não foi possível carregar as salas.'; }
}
$('refresh').onclick = refreshRooms; setInterval(refreshRooms, 10000);
function playerList(container, players, hostId) {
  container.replaceChildren(); for (const p of players) {
    const row = document.createElement('div'); row.className = 'player-row'; const dot = document.createElement('i'); dot.style.backgroundColor = p.color;
    const name = document.createElement('span'); name.textContent = `${p.name}${p.id === myId ? ' (você)' : ''}`; row.append(dot, name);
    if (p.id === hostId) { const label = document.createElement('b'); label.textContent = 'HOST ♫'; row.append(label); } container.append(row);
  }
}
function applyRoom(next) {
  const previous = room, oldMusic = room?.music; room = next; const host = room.hostId === myId;
  if (previous && previous.hostId !== next.hostId && mode === 'orbit' && !host) mode = 'chase';
  show('home', false); show('lobby', !room.started); show('hud', room.started); document.body.classList.toggle('playing', room.started);
  $('lobby-title').textContent = room.name; $('room-code').textContent = room.code; $('hud-room').textContent = `${room.name} · ${room.code}`;
  $('lobby-status').textContent = room.public ? 'Sala pública • compartilhe o código e chame a galera.' : 'Sala privada • compartilhe o código com seus amigos.';
  playerList($('lobby-players'), room.players, room.hostId); playerList($('hud-players'), room.players, room.hostId);
  $('online').textContent = `${room.players.length}/12`; $('player-count').textContent = room.players.length;
  show('start', host); show('host-wait', !host); show('dj', host && room.started); show('auto', !host);
  if (room.started && (!previous?.started || JSON.stringify(oldMusic) !== JSON.stringify(room.music))) applyMusic(room.music);
  if (room.started && audio.ctx?.state !== 'running') show('unlock-audio', true);
}
socket.on('room', applyRoom);
$('start').onclick = () => { void unlock(); socket.emit('start'); };
$('copy-code').onclick = async () => { try { await navigator.clipboard.writeText(room.code); toast('Código copiado!'); } catch { toast(`Código: ${room.code}`); } };
function resetRoom() {
  room = null; snapshots = []; history = []; replay = null; displayed = []; livePlayers = []; keys.clear(); touch.throttle = touch.steer = 0; touch.boost = false; mode = 'chase';
  audio.stop(); scene?.reset(); document.body.classList.remove('playing'); show('home', true); show('lobby', false); show('hud', false); show('replay-banner', false);
  $('auto').classList.remove('active'); $('messages').replaceChildren(); $('upload-status').textContent = ''; $('camera').textContent = '◉ Câmera';
}
function leave() { socket.emit('leave'); resetRoom(); refreshRooms(); }
$('leave-lobby').onclick = leave; $('leave-game').onclick = leave;
function applyMusic(music) {
  if (!room) return; room.music = music; $('track-name').textContent = music.name;
  $('play-pause').textContent = music.playing ? 'Pausar música' : 'Tocar música';
  $('tracks').value = TRACKS.some(t => t.id === music.id) ? music.id : '';
  void audio.setMusic(music, serverNow, token);
}
socket.on('music', applyMusic);
$('tracks').onchange = () => socket.emit('musicControl', { id: $('tracks').value });
$('play-pause').onclick = () => socket.emit('musicControl', { playing: !room.music.playing });
$('mute').onclick = () => { audio.muted = !audio.muted; $('mute').textContent = audio.muted ? '×' : '♪'; $('mute').setAttribute('aria-pressed', String(audio.muted)); $('mute').setAttribute('aria-label', audio.muted ? 'Ativar música' : 'Silenciar música'); };
$('upload').onchange = async () => {
  const file = $('upload').files[0]; if (!file || !room || room.hostId !== myId) return;
  if (file.size > 12 * 1024 * 1024) { toast('Limite de 12 MB por faixa.'); return; }
  $('upload-status').textContent = 'Validando e enviando…';
  try {
    await audio.unlock();
    // Valida o arquivo no Host antes de transmiti-lo: formato real, duração e decodificação.
    const buffer = await audio.ctx.decodeAudioData(await file.arrayBuffer()); if (buffer.duration > 600) throw new Error('Use uma faixa com até 10 minutos.');
    const response = await fetch(`/api/rooms/${room.code}/music`, { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream', 'x-host-token': token, 'x-track-name': encodeURIComponent(file.name.replace(/\.[^.]+$/, '')) }, body: file });
    const result = await response.json(); if (!response.ok) throw new Error(result.error);
    $('upload-status').textContent = 'Faixa enviada para todos os motoristas.';
  } catch (error) { $('upload-status').textContent = `Não foi possível enviar: ${error.message}`; }
  $('upload').value = '';
};
socket.on('snapshot', frame => {
  if (!room?.started) return;
  snapshots.push(frame); while (snapshots.length > 40) snapshots.shift(); history.push(frame);
  while (history.length && frame.time - history[0].time > 10000) history.shift();
});
socket.on('notice', toast);
function addMessage(name, text) {
  const line = document.createElement('div'), author = document.createElement('b'); author.textContent = `${name}: `; line.append(author, document.createTextNode(text));
  $('messages').append(line); while ($('messages').children.length > 30) $('messages').firstChild.remove(); $('messages').scrollTop = $('messages').scrollHeight;
}
socket.on('chat', data => addMessage(data.name, data.text));
$('chat-form').onsubmit = event => { event.preventDefault(); const text = $('chat-input').value.trim(); if (text) socket.emit('chat', text); $('chat-input').value = ''; $('chat-input').blur(); };
socket.on('horn', ({ id }) => { const me = livePlayers.find(p => p.id === myId), other = livePlayers.find(p => p.id === id); if (me && other) audio.horn(Math.hypot(me.x - other.x, me.z - other.z)); });
socket.on('reaction', ({ id, emoji }) => scene?.reaction(id, emoji));
for (const button of document.querySelectorAll('[data-emoji]')) button.onclick = () => socket.emit('reaction', button.dataset.emoji);
function cameraMode() {
  if (!room?.started) return;
  const choices = room.hostId === myId ? ['chase', 'convoy', 'orbit'] : ['chase', 'convoy'];
  mode = choices[(choices.indexOf(mode) + 1) % choices.length]; $('camera').textContent = { chase: '◉ Câmera', convoy: '≋ Comboio', orbit: '◎ Orbital' }[mode];
  if (mode === 'orbit') toast('Arraste o cenário para girar; use a roda do mouse para ajustar a altura.');
}
$('camera').onclick = cameraMode;
$('auto').onclick = () => { const enabled = !$('auto').classList.contains('active'); $('auto').classList.toggle('active', enabled); socket.emit('auto', enabled); toast(enabled ? 'Piloto de comboio ligado. Ele segue o Host; evite rotas bloqueadas.' : 'Você retomou o volante.'); };
$('replay').onclick = () => {
  if (history.length < 25) { toast('Espere o comboio rodar um pouco antes de ver o replay.'); return; }
  replay = { frames: history.slice(), start: performance.now(), first: history[0].time, duration: history.at(-1).time - history[0].time };
  show('replay-banner', true); socket.emit('auto', false); $('auto').classList.remove('active'); keys.clear(); touch.throttle = touch.steer = 0; touch.boost = false; toast('Replay visual: seu carro para; o áudio continua ao vivo.');
};
$('stop-replay').onclick = () => { replay = null; show('replay-banner', false); };
function editing() { return ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName); }
addEventListener('keydown', event => {
  if (!room?.started || editing()) return;
  if (event.code === 'Enter') { event.preventDefault(); $('chat-input').focus(); return; }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  keys.add(event.code); if (event.repeat) return;
  if (event.code === 'Space') socket.emit('horn'); if (event.code === 'KeyC') cameraMode();
});
addEventListener('keyup', event => keys.delete(event.code));
addEventListener('blur', () => { keys.clear(); touch.throttle = touch.steer = 0; touch.boost = false; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { keys.clear(); touch.throttle = touch.steer = 0; touch.boost = false; socket.emit('input', { throttle: 0, steer: 0, boost: false }); }
  else { clockSync(); if (room?.started) { if (audio.ctx?.state === 'running') void audio.setMusic(room.music, serverNow, token); else show('unlock-audio', true); } }
});
let stickPointer = null;
function joystick(event) {
  const r = $('joystick').getBoundingClientRect(), dx = event.clientX - r.left - r.width / 2, dy = event.clientY - r.top - r.height / 2;
  const radius = r.width * 0.35, distance = Math.hypot(dx, dy), scale = distance > radius ? radius / distance : 1;
  touch.steer = clamp(dx / radius, -1, 1); touch.throttle = clamp(-dy / radius, -1, 1);
  $('stick').style.transform = `translate(${dx * scale}px,${dy * scale}px)`;
}
$('joystick').onpointerdown = event => { stickPointer = event.pointerId; $('joystick').setPointerCapture(stickPointer); joystick(event); };
$('joystick').onpointermove = event => { if (event.pointerId === stickPointer) joystick(event); };
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) $('joystick').addEventListener(type, () => { stickPointer = null; touch.throttle = touch.steer = 0; $('stick').style.transform = ''; });
$('touch-horn').onpointerdown = event => { event.preventDefault(); void unlock(); socket.emit('horn'); };
$('touch-boost').onpointerdown = event => { event.preventDefault(); $('touch-boost').setPointerCapture(event.pointerId); touch.boost = true; };
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) $('touch-boost').addEventListener(type, () => { touch.boost = false; });
let orbitPointer = null, lastX = 0;
$('world').onpointerdown = event => { if (mode !== 'orbit') return; orbitPointer = event.pointerId; lastX = event.clientX; $('world').setPointerCapture(event.pointerId); };
$('world').onpointermove = event => { if (scene && orbitPointer === event.pointerId) { scene.orbitAngle -= (event.clientX - lastX) * 0.008; lastX = event.clientX; } };
for (const type of ['pointerup', 'pointercancel']) $('world').addEventListener(type, () => { orbitPointer = null; });
$('world').addEventListener('wheel', event => { if (mode === 'orbit' && scene) { event.preventDefault(); scene.orbitHeight = clamp(scene.orbitHeight + event.deltaY * 0.025, 5, 50); } }, { passive: false });
const map = $('minimap').getContext('2d');
function drawMap(players) {
  const s = 180 / (WORLD_SIZE * 2), to = n => n * s + 90; map.fillStyle = '#a6bd8a'; map.fillRect(0, 0, 180, 180);
  map.fillStyle = '#788780'; for (let i = -3; i <= 3; i++) { map.fillRect(to(i * 40 - 6.5), 0, 13 * s, 180); map.fillRect(0, to(i * 40 - 6.5), 180, 13 * s); }
  map.fillStyle = '#d6cfb7'; for (const b of OBSTACLES) map.fillRect(to(b.x - b.w / 2), to(b.z - b.d / 2), b.w * s, b.d * s);
  const host = players.find(p => p.id === room?.hostId);
  if (host) { map.strokeStyle = '#ffdf4088'; map.lineWidth = 1; map.beginPath(); map.arc(to(host.x), to(host.z), AUDIO_RADIUS * s, 0, Math.PI * 2); map.stroke(); }
  for (const p of players) { map.fillStyle = p.color; map.strokeStyle = p.id === myId ? '#fff' : '#153732'; map.lineWidth = 1.5; map.beginPath(); map.arc(to(p.x), to(p.z), p.id === room?.hostId ? 4 : 2.8, 0, Math.PI * 2); map.fill(); map.stroke(); }
}
let previousTime = performance.now();
function frame(now) {
  const dt = clamp((now - previousTime) / 1000, 0.001, 0.05); previousTime = now;
  if (room?.started) {
    livePlayers = sampleSnapshots(snapshots, serverNow() - 100);
    if (replay && now - replay.start > replay.duration) { replay = null; show('replay-banner', false); }
    displayed = replay ? sampleSnapshots(replay.frames, replay.first + now - replay.start) : livePlayers;
    if (now - lastInput > 40) {
      const throttle = editing() || replay ? 0 : clamp((keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + touch.throttle, -1, 1);
      const steer = editing() || replay ? 0 : clamp((keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + touch.steer, -1, 1);
      socket.volatile.emit('input', { throttle, steer, boost: !editing() && !replay && (touch.boost || keys.has('ShiftLeft') || keys.has('ShiftRight')) }); lastInput = now;
    }
    const me = livePlayers.find(p => p.id === myId), host = livePlayers.find(p => p.id === room.hostId);
    const status = audio.update(me, host, serverNow());
    if (now - lastHud > 80) {
      $('distance').textContent = !me ? 'Sincronizando…' : me.id === room.hostId ? 'Você é o paredão • volume local' : `${Math.round(status.distance)} m até o carro de som`;
      $('volume-bar').style.width = `${Math.round(status.volume * 100)}%`; $('volume-value').textContent = `${Math.round(status.volume * 100)}%`;
      $('speed').textContent = Math.round((me?.speed || 0) * 3.6); $('nitro-bar').style.width = `${(me?.nitro ?? 1) * 100}%`; drawMap(displayed);
      if (me) $('auto').classList.toggle('active', me.auto); lastHud = now;
    }
    const music = room.music, active = music.playing && serverNow() >= music.startedAt;
    const phase = ((serverNow() - music.startedAt) / 1000 + music.offset) * music.bpm / 60;
    const power = active ? 0.45 + Math.max(0, Math.cos(phase * Math.PI * 2)) * 0.55 : 0;
    scene?.render(displayed, myId, room.hostId, mode, dt, now / 1000, power, true);
  } else scene?.render([], '', '', mode, dt, now / 1000, 0, false);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
