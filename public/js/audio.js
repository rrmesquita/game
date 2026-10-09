import { proximityVolume, AUDIO_RADIUS, TRACKS, clamp } from '/shared/world.js';
/** Um único emissor musical por sala. O servidor transmite só a identidade da faixa,
 * estado e instante inicial; cada cliente agenda o mesmo loop no relógio sincronizado.
 * Ganho e filtro são locais: mutar não interfere nos demais participantes. */
export class SpatialAudio {
  constructor(onError) { this.onError = onError; this.buffers = new Map(); this.muted = false; this.volume = 0; this.sequence = 0; }
  async unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.filter = this.ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 18000;
      this.panner = this.ctx.createStereoPanner();
      this.gain = this.ctx.createGain(); this.gain.gain.value = 0;
      this.limiter = this.ctx.createDynamicsCompressor(); this.limiter.threshold.value = -14; this.limiter.ratio.value = 8;
      this.master = this.ctx.createGain(); this.master.gain.value = 0.65;
      this.filter.connect(this.panner); this.panner.connect(this.gain); this.gain.connect(this.limiter); this.limiter.connect(this.master); this.master.connect(this.ctx.destination);
    }
    await this.ctx.resume(); return this.ctx.state === 'running';
  }
  // Placeholders originais, gerados localmente: 4 compassos, kick, caixa, chimbal e baixo.
  // Nenhuma gravação comercial, licença externa, CDN ou download de MP3 necessário.
  synth(track) {
    const key = track.id;
    if (this.buffers.has(key)) return this.buffers.get(key);
    const rate = this.ctx.sampleRate, beat = 60 / track.bpm, duration = beat * 16;
    const buffer = this.ctx.createBuffer(1, Math.round(duration * rate), rate), out = buffer.getChannelData(0);
    const variant = Math.max(0, TRACKS.findIndex(t => t.id === track.id));
    let seed = 1297 + variant; const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 1073741823.5 - 1; };
    function add(start, len, fn) {
      const offset = Math.round(start * rate), n = Math.round(len * rate);
      for (let j = 0; j < n; j++) { const idx = (offset + j) % out.length; out[idx] += fn(j / rate); }
    }
    for (let b = 0; b < 16; b++) {
      add(b * beat, 0.28, t => Math.sin(2 * Math.PI * (48 * t + 15 * (1 - Math.exp(-t * 35)))) * Math.exp(-t * 18) * 0.72);
      if (b % 2 === 1) add(b * beat, 0.16, t => (noise() * 0.65 + Math.sin(t * 1180) * 0.15) * Math.exp(-t * 26) * 0.45);
      for (let h = 0; h < 2; h++) add((b + h / 2) * beat, 0.055, t => noise() * Math.exp(-t * 85) * (h ? 0.085 : 0.12));
      const notes = [55, 55, 65.406, 49][Math.floor(b / 4)];
      for (const off of [0, 0.75]) add((b + off) * beat, beat * 0.22, t => {
        const f = notes * (variant === 2 ? 1.5 : 1); const envelope = Math.min(1, t * 250) * Math.exp(-t * 10);
        return (Math.sin(t * f * 2 * Math.PI) + Math.sin(t * f * 4 * Math.PI) * 0.18) * envelope * 0.24;
      });
      if (b % 4 === 2) add((b + 0.5) * beat, 0.15, t => Math.sin(2 * Math.PI * (320 * t - 170 * t * t)) * Math.exp(-t * 20) * 0.18);
    }
    for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * 1.05) * 0.8;
    this.buffers.set(key, buffer); return buffer;
  }
  async setMusic(music, serverNow, token) {
    this.music = music; const sequence = ++this.sequence;
    this.stopSource();
    if (!this.ctx || !music?.playing) return;
    try {
      let buffer;
      if (music.id === 'upload') {
        if (this.buffers.has(music.url)) buffer = this.buffers.get(music.url);
        else {
          const response = await fetch(music.url, { headers: { 'x-player-token': token } });
          if (!response.ok) throw new Error('O servidor não entregou a faixa.');
          buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
          if (buffer.duration > 600) throw new Error('A faixa precisa ter até 10 minutos.');
          // Limite de cache: quatro synths + uma faixa enviada, sem acumular uploads antigos.
          for (const key of this.buffers.keys()) if (key.startsWith('/api/')) this.buffers.delete(key);
          this.buffers.set(music.url, buffer);
        }
      } else buffer = this.synth(music);
      if (sequence !== this.sequence) return;
      this.source = this.ctx.createBufferSource(); this.source.buffer = buffer; this.source.loop = true;
      this.source.connect(this.filter);
      // serverNow() é função: o download pode levar segundos, sem atrasar a posição da música.
      const untilStart = (music.startedAt - serverNow()) / 1000;
      const offset = ((music.offset + Math.max(0, -untilStart)) % buffer.duration + buffer.duration) % buffer.duration;
      this.source.start(this.ctx.currentTime + Math.max(0, untilStart), offset);
      this.anchor = { contextTime: this.ctx.currentTime + Math.max(0, untilStart), offset, buffer };
    } catch (error) { if (sequence === this.sequence) this.onError(`Áudio: ${error.message}`); }
  }
  stopSource() { if (this.source) { try { this.source.stop(); } catch {} this.source.disconnect(); this.source = null; } }
  update(listener, host, serverNow) {
    const distance = listener && host ? Math.hypot(listener.x - host.x, listener.z - host.z) : AUDIO_RADIUS;
    const target = proximityVolume(distance);
    this.volume = this.muted || !this.music?.playing || !this.source || serverNow < this.music.startedAt ? 0 : target;
    if (this.ctx) {
      const dx = (host?.x || 0) - (listener?.x || 0), dz = (host?.z || 0) - (listener?.z || 0);
      const side = dx * Math.cos(listener?.angle || 0) + dz * Math.sin(listener?.angle || 0);
      this.panner.pan.setTargetAtTime(clamp(side / Math.max(1, distance), -1, 1) * 0.7, this.ctx.currentTime, 0.12);
      // setTargetAtTime suaviza mudanças e evita cliques ao atravessar o raio ou mutar.
      this.gain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.085);
      this.filter.frequency.setTargetAtTime(700 + 17300 * target ** 1.3, this.ctx.currentTime, 0.15);
    }
    return { distance, volume: this.volume };
  }
  horn(distance = 0) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const g = this.ctx.createGain(), t = this.ctx.currentTime, loudness = proximityVolume(distance, 65) * 0.17;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(loudness, t + 0.015); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35); g.connect(this.master);
    for (const f of [370, 466]) { const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.setValueAtTime(f * 0.8, t + 0.16); o.connect(g); o.start(t); o.stop(t + 0.36); o.onended = () => o.disconnect(); }
    setTimeout(() => g.disconnect(), 500);
  }
  stop() { this.sequence++; this.music = null; this.stopSource(); if (this.ctx) this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03); }
}
