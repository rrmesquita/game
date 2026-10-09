import * as THREE from '/vendor/three.module.js';
import { BUILDINGS, proximityVolume } from '/shared/world.js';
const materialCache = new Map();
function mat(color, extra = {}) { const key = color + JSON.stringify(extra); if (!materialCache.has(key)) materialCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.82, ...extra })); return materialCache.get(key); }
function box(parent, w, h, d, x, y, z, color, extra = {}) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, extra)); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }
function textTexture(text, bg, color = '#fff', sub = '', gradient = false) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 192;
  const c = canvas.getContext('2d'); const fill = c.createLinearGradient(0, 0, 0, 192); fill.addColorStop(0, bg); fill.addColorStop(0.6, bg); fill.addColorStop(1, '#168ad0'); c.fillStyle = gradient ? fill : bg; c.fillRect(0, 0, 512, 192);
  c.fillStyle = color; c.textAlign = 'center'; c.font = '900 62px Arial'; c.fillText(text, 256, sub ? 80 : 119, 480);
  if (sub) { c.font = 'bold 42px Arial'; c.fillText(sub, 256, 145); }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}
function sign(parent, text, sub, x, y, z, w, h, color = '#078b4f') {
  const texture = textTexture(text, color, '#fff', sub);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
}
function speaker(parent, x, y, z, size = 0.8) {
  const group = new THREE.Group(); group.position.set(x, y, z); parent.add(group);
  box(group, size, size * 1.2, size * 0.55, 0, 0, 0, '#17292d');
  for (const cy of [-size * 0.25, size * 0.27]) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.27, size * 0.27, 0.07, 12), mat('#44585c'));
    mesh.rotation.x = Math.PI / 2; mesh.position.set(0, cy, size * 0.3); group.add(mesh);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.11, size * 0.11, 0.09, 12), mat('#0c171e')); cone.rotation.x = Math.PI / 2; cone.position.set(0, cy, size * 0.35); group.add(cone);
  }
  return group;
}
function flag(parent) {
  const pole = box(parent, 0.045, 2.7, 0.045, 0.85, 3.2, 1.1, '#e2e6dd');
  const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 140;
  const c = canvas.getContext('2d'); c.fillStyle = '#039347'; c.fillRect(0, 0, 200, 140);
  c.fillStyle = '#ffde31'; c.beginPath(); c.moveTo(100, 15); c.lineTo(182, 70); c.lineTo(100, 125); c.lineTo(18, 70); c.fill();
  c.fillStyle = '#1263aa'; c.beginPath(); c.arc(100, 70, 30, 0, 7); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 5; c.beginPath(); c.moveTo(74, 57); c.quadraticCurveTo(100, 59, 126, 79); c.stroke();
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 1, 8, 3), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
  mesh.position.set(1.58, 4.05, 1.1); parent.add(mesh); return mesh;
}
export class GameScene {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, matchMedia('(pointer:coarse)').matches ? 1.25 : 1.75));
    const gl = this.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
    this.software = debug ? /SwiftShader|llvmpipe|Software/i.test(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : false;
    if (this.software) this.renderer.setPixelRatio(1);
    // Renderização por software mantém o jogo utilizável sem o custo de shadow maps.
    this.renderer.shadowMap.enabled = !this.software; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#9edcf4'); this.scene.fog = new THREE.Fog('#9edcf4', 120, 320);
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 450); this.camera.position.set(20, 20, 28);
    this.scene.add(new THREE.HemisphereLight('#dff6ff', '#7c8f54', 2.8));
    const sun = new THREE.DirectionalLight('#fff4d8', 2.4); sun.position.set(50, 80, 30); sun.castShadow = !this.software;
    sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -85, right: 85, top: 85, bottom: -85, near: 1, far: 200 }); sun.shadow.bias = -0.001; sun.shadow.normalBias = 0.035; this.scene.add(sun); this.sun = sun;
    this.vehicles = new Map(); this.particles = []; this.reactions = []; this.orbitAngle = 0.5; this.orbitHeight = 20;
    this.buildWorld(); this.batchWorld(); this.demo = this.makeCar({ name: 'CARRO DE SOM', color: '#ffda35', skin: '22' }, true); this.demo.position.set(0, 0, 3); this.demo.rotation.y = -0.45; this.scene.add(this.demo);
    this.resize(); addEventListener('resize', () => this.resize());
  }
  resize() { this.renderer.setSize(innerWidth, innerHeight); this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }
  buildWorld() {
    box(this.scene, 310, 0.2, 310, 0, -0.2, 0, '#a4bf79');
    for (let i = -3; i <= 3; i++) {
      box(this.scene, 13, 0.12, 298, i * 40, -0.06, 0, '#65777b'); box(this.scene, 298, 0.13, 13, 0, -0.05, i * 40, '#65777b');
      for (let p = -140; p <= 140; p += 12) if (Math.abs(p % 40) > 8) {
        box(this.scene, 0.12, 0.025, 3, i * 40, 0.03, p, '#faf0bc'); box(this.scene, 3, 0.025, 0.12, p, 0.03, i * 40, '#faf0bc');
      }
    }
    for (const b of BUILDINGS) {
      box(this.scene, b.w + 4, 0.24, b.d + 4, b.x, 0, b.z, '#d8d4c2');
      box(this.scene, b.w, b.h, b.d, b.x, b.h / 2, b.z, b.color);
      box(this.scene, b.w + 0.8, 0.4, b.d + 0.8, b.x, b.h + 0.2, b.z, '#b77756');
      for (let k = -1; k <= 1; k++) {
        box(this.scene, 2.4, 2, 0.06, b.x + k * 6, 2.6, b.z + b.d / 2 + 0.05, '#45717d');
        box(this.scene, 0.06, 2, 2.4, b.x + b.w / 2 + 0.05, 2.6, b.z + k * 6, '#45717d');
      }
      box(this.scene, 2, 3, 0.08, b.x - 3, 1.5, b.z + b.d / 2 + 0.1, '#665f51');
      // Muro baixo de pedra, contido no volume de colisão do quarteirão.
      for (let k = 0; k < 8; k++) box(this.scene, 2.8, 0.7 + (k % 2) * 0.12, 0.55, b.x - 10 + k * 2.85, 0.4, b.z - b.d / 2, '#a6a695');
    }
    // Posto de gasolina com cobertura aberta: trânsito sob a cobertura é permitido.
    box(this.scene, 27, 0.14, 26, 20, 0, 20, '#e5dfca');
    for (const x of [10, 20]) { box(this.scene, 0.3, 4.6, 0.3, x, 2.3, 15, '#e6e4d6'); box(this.scene, 0.3, 4.6, 0.3, x, 2.3, 25, '#e6e4d6'); }
    box(this.scene, 18, 0.5, 16, 15, 4.8, 20, '#f5dc3f');
    box(this.scene, 10, 4, 9, 28, 2, 20, '#f6eee2'); sign(this.scene, 'POSTO', 'BRASIL', 28, 3, 24.6, 7, 2, '#0a9c59');
    // Bombas são decoração de baixo perfil, sem criar obstáculo invisível no servidor.
    for (const x of [12, 18]) { box(this.scene, 0.7, 1.4, 0.6, x, 0.7, 20, '#159754'); box(this.scene, 0.5, 0.4, 0.08, x, 1.05, 20.32, '#183a3b'); }
    for (let i = -2; i <= 2; i++) for (const j of [-2, 0, 2]) {
      const x = i * 40 + 8, z = j * 40 - 9;
      box(this.scene, 0.18, 7, 0.18, x, 3.5, z, '#758580'); box(this.scene, 2, 0.12, 0.14, x - 0.7, 7, z, '#758580'); box(this.scene, 0.7, 0.13, 0.35, x - 1.35, 6.9, z, '#fff4bc');
      if (j === 0) sign(this.scene, 'AV. COMBOIO', '', x, 4, z, 4, 0.8, '#176c80');
    }
    const truck = new THREE.Group(); truck.position.set(-10, 0, 25); this.scene.add(truck);
    box(truck, 4.5, 2.6, 11, 0, 1.9, 0, '#16924c'); box(truck, 4.2, 2.3, 2.7, 0, 3.7, -4, '#36af50'); box(truck, 3.7, 1.15, 0.07, 0, 4, -5.38, '#225d71');
    for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) speaker(truck, -1.65 + col * 1.1, 2.2 + row, 5.55, 1);
    sign(truck, 'PAREDÃO', 'DO BAIRRO', 0, 5.2, 5.6, 4.5, 1.2, '#0d6839');
    for (const x of [-2.1, 2.1]) for (const z of [-3.5, 3.5]) { const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.4, 12), mat('#162e30')); wheel.rotation.z = Math.PI / 2; wheel.position.set(x, 0.8, z); truck.add(wheel); }
    // Árvores e nuvens low-poly, sem downloads ou texturas pesadas.
    const geo = new THREE.IcosahedronGeometry(1, 0);
    for (let i = 0; i < 35; i++) {
      const angle = i * 2.399, radius = 136 + (i % 4) * 2, x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
      box(this.scene, 0.45, 2.5, 0.45, x, 1.25, z, '#896946'); const crown = new THREE.Mesh(geo, mat('#5caa65', { flatShading: true })); crown.position.set(x, 3.3, z); crown.scale.set(2.3, 2.7, 2.3); this.scene.add(crown);
    }
    for (let i = 0; i < 14; i++) {
      const cloud = new THREE.Group(); cloud.position.set(Math.sin(i * 6.7) * 140, 55 + i % 3 * 8, Math.cos(i * 3.1) * 140);
      for (let k = 0; k < 3; k++) { const part = new THREE.Mesh(new THREE.IcosahedronGeometry(5, 1), mat('#fff9ef')); part.position.x = k * 5; part.scale.set(1.5, 0.6, 1); cloud.add(part); } this.scene.add(cloud);
    }
  }
  batchWorld() {
    // Centenas de caixas estáticas viram poucas chamadas de desenho por material.
    // Mantém textura e geometria dos carros separadas para animação e descarte seguro.
    this.scene.updateMatrixWorld(true);
    const batches = new Map();
    this.scene.traverse(o => { if (o.isMesh && o.geometry.type === 'BoxGeometry') {
      if (!batches.has(o.material)) batches.set(o.material, []); batches.get(o.material).push(o);
    } });
    for (const [material, objects] of batches) {
      const geometry = new THREE.BoxGeometry(1, 1, 1), mesh = new THREE.InstancedMesh(geometry, material, objects.length);
      const matrix = new THREE.Matrix4(), scale = new THREE.Matrix4();
      objects.forEach((o, i) => { const p = o.geometry.parameters; scale.makeScale(p.width, p.height, p.depth);
        matrix.copy(o.matrixWorld).multiply(scale); mesh.setMatrixAt(i, matrix); o.parent.remove(o); o.geometry.dispose(); });
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingSphere(); this.scene.add(mesh);
    }
  }
  makeCar(player, host) {
    const g = new THREE.Group(), s = host ? 1.15 : 1; g.scale.setScalar(s);
    const body = box(g, 2.25, 0.65, 4.6, 0, 1.03, 0, player.color);
    body.material = new THREE.MeshStandardMaterial({ map: textTexture('', player.color, '#fff', '', true), roughness: 0.75 });
    box(g, 2.2, 0.28, 4.45, 0, 0.64, 0, '#1877af');
    box(g, 2.2, 0.34, 1.35, 0, 1.48, -1.47, player.color);
    box(g, 1.95, 1.2, 1.55, 0, 1.82, -0.35, player.color);
    box(g, 1.82, 0.72, 0.06, 0, 1.97, -1.14, '#246179', { metalness: 0.15, roughness: 0.3 });
    for (const x of [-1, 1]) { box(g, 0.05, 0.68, 1.2, x, 1.99, -0.36, '#246179'); box(g, 0.12, 0.52, 1.85, x, 1.41, 1.26, player.color); }
    box(g, 2.15, 0.55, 0.12, 0, 1.38, 2.18, player.color); box(g, 2.35, 0.18, 0.16, 0, 0.76, -2.3, '#cbd6d6');
    for (const x of [-0.8, 0.8]) { box(g, 0.42, 0.25, 0.07, x, 1.15, -2.34, '#fffbd0', { emissive: '#ffed9e', emissiveIntensity: 0.3 }); box(g, 0.25, 0.28, 0.08, x, 1.3, 2.3, '#ff5555'); }
    const wheels = [];
    for (const x of [-1.15, 1.15]) for (const z of [-1.42, 1.48]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.53, 0.53, 0.36, 12), mat('#163038')); wheel.rotation.z = Math.PI / 2; wheel.position.set(x, 0.53, z); wheel.castShadow = true; g.add(wheel); wheels.push(wheel);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.38, 8), mat('#299cd8', { emissive: '#116389', emissiveIntensity: 0.22 })); rim.rotation.z = Math.PI / 2; rim.position.copy(wheel.position); g.add(rim);
    }
    const title = player.skin === '13' ? 'PETISTA' : player.skin === 'livre' ? 'SÓ PELO GRAVE' : 'BOLSONARO'; const number = player.skin === '13' ? '13' : player.skin === 'livre' ? '♪' : '22';
    const texture = textTexture(title, player.color, '#0b4f65', number, true);
    for (const x of [-1.135, 1.135]) { const decal = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 0.67), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })); decal.rotation.y = Math.PI / 2; decal.position.set(x, 1.09, 0); g.add(decal); }
    const speakers = [];
    for (const x of [-0.54, 0.54]) for (let y = 0; y < (host ? 3 : 1); y++) speakers.push(speaker(g, x, 1.85 + y * 0.8, 1.36, 0.85));
    const flagMesh = flag(g);
    const lightMaterial = new THREE.MeshBasicMaterial({ color: '#63ffdd' }); const light = new THREE.Mesh(new THREE.BoxGeometry(2.28, 0.05, 4.6), lightMaterial); light.position.y = 0.48; light.visible = host; g.add(light);
    const rings = [];
    if (host) for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 64), new THREE.MeshBasicMaterial({ color: '#ffe747', transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false })); r.rotation.x = -Math.PI / 2; r.position.y = 0.045 + i * 0.005; g.add(r); rings.push(r); }
    const labelTexture = textTexture(player.name, host ? '#0f614b' : '#102c35', '#fff', host ? 'HOST • CARRO DE SOM' : '');
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, depthTest: false, transparent: true })); label.position.y = host ? 5.9 : 5.4; label.scale.set(3.2, 1.2, 1); g.add(label);
    g.userData = { host, flag: flagMesh, speakers, rings, lightMaterial, wheels, player, label }; return g;
  }
  disposeCar(g) {
    g.traverse(o => { o.geometry?.dispose(); const m = o.material; if (m?.map) { m.map.dispose(); m.dispose(); } });
    for (const ring of g.userData.rings) ring.material.dispose(); g.userData.lightMaterial.dispose(); this.scene.remove(g);
  }
  reset() { for (const g of this.vehicles.values()) this.disposeCar(g); this.vehicles.clear(); this.demo.visible = true; }
  reaction(id, emoji) {
    const g = this.vehicles.get(id); if (!g) return;
    const texture = textTexture(emoji, '#ffffff00', '#fff'); // canvas alpha é ajustada abaixo.
    const c = texture.image.getContext('2d'); c.clearRect(0, 0, 512, 192); c.font = '110px Arial'; c.textAlign = 'center'; c.fillText(emoji, 256, 135); texture.needsUpdate = true;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })); sprite.scale.set(3, 1.3, 1); sprite.position.copy(g.position); sprite.position.y = 6; this.scene.add(sprite); this.reactions.push({ sprite, life: 2 });
  }
  animateCar(g, time, power, speed = 0) {
    const data = g.userData, position = data.flag.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) { const x = position.getX(i); position.setZ(i, Math.sin(time * 7 - x * 4) * 0.13 * (x + 0.725) / 1.45); } position.needsUpdate = true;
    data.speakers.forEach((speaker, i) => speaker.scale.setScalar(1 + Math.sin(time * 35 + i) * 0.026 * power));
    data.lightMaterial.color.setHSL((time * 0.15) % 1, 0.9, 0.45 + power * 0.25);
    data.rings.forEach((r, i) => { const phase = (time * 0.5 + i / 3) % 1; r.scale.setScalar(3 + phase * 12); r.material.opacity = power * (1 - phase) * 0.28; });
    for (const wheel of data.wheels) wheel.rotation.x = time * speed / 0.53;
  }
  render(players, myId, hostId, mode, dt, time, power, inGame) {
    this.demo.visible = !inGame; const present = new Set(players.map(p => p.id));
    for (const [id, g] of this.vehicles) if (!present.has(id)) { this.disposeCar(g); this.vehicles.delete(id); }
    for (const p of players) {
      let g = this.vehicles.get(p.id), host = p.id === hostId;
      if (g && g.userData.host !== host) { this.disposeCar(g); this.vehicles.delete(p.id); g = null; }
      if (!g) { g = this.makeCar(p, host); this.vehicles.set(p.id, g); this.scene.add(g); }
      g.position.set(p.x, 0, p.z); g.rotation.y = -p.angle; this.animateCar(g, time, host ? power : power * proximityVolume(Math.hypot(p.x - (players.find(v => v.id === hostId)?.x ?? p.x), p.z - (players.find(v => v.id === hostId)?.z ?? p.z))), p.speed);
      if (p.boost && this.particles.length < 120 && Math.random() < dt * 30) {
        const smoke = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 0), new THREE.MeshBasicMaterial({ color: '#ffe5a1', transparent: true, opacity: 0.6, depthWrite: false }));
        smoke.position.set(p.x - Math.sin(p.angle) * 2, 0.6, p.z + Math.cos(p.angle) * 2); this.scene.add(smoke); this.particles.push({ mesh: smoke, life: 0.7 });
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) { const p = this.particles[i]; p.life -= dt; p.mesh.position.y += dt; p.mesh.scale.multiplyScalar(1 + dt * 1.5); p.mesh.material.opacity = Math.max(0, p.life * 0.7); if (p.life <= 0) { this.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); this.particles.splice(i, 1); } }
    for (let i = this.reactions.length - 1; i >= 0; i--) { const p = this.reactions[i]; p.life -= dt; p.sprite.position.y += dt * 1.8; p.sprite.material.opacity = Math.min(1, p.life); if (p.life <= 0) { this.scene.remove(p.sprite); p.sprite.material.map.dispose(); p.sprite.material.dispose(); this.reactions.splice(i, 1); } }
    const me = players.find(p => p.id === myId) || players[0];
    const target = new THREE.Vector3(), desired = new THREE.Vector3();
    if (!inGame || !me) {
      this.animateCar(this.demo, time, 0.2); target.set(0, 1.5, 3); desired.set(14 + Math.sin(time * 0.08) * 2, 10, -17);
    } else {
      target.set(me.x, 1.6, me.z);
      if (mode === 'convoy') {
        const nearby = players.filter(p => Math.hypot(p.x - me.x, p.z - me.z) < 75);
        let x = 0, z = 0; nearby.forEach(p => { x += p.x; z += p.z; }); x /= nearby.length; z /= nearby.length;
        const extent = Math.max(15, ...nearby.map(p => Math.hypot(p.x - x, p.z - z)));
        target.set(x, 0, z); desired.set(x + extent * 0.6, extent * 1.6 + 14, z + extent * 1.3 + 14);
      } else if (mode === 'orbit') {
        desired.set(me.x + Math.sin(this.orbitAngle) * 22, this.orbitHeight, me.z + Math.cos(this.orbitAngle) * 22);
      } else desired.set(me.x - Math.sin(me.angle) * 12, 8.5, me.z + Math.cos(me.angle) * 12);
      // Sombras acompanham a região do próprio motorista.
      this.sun.position.set(me.x + 50, 80, me.z + 30); this.sun.target.position.set(me.x, 0, me.z); this.sun.target.updateMatrixWorld();
    }
    this.camera.position.lerp(desired, 1 - Math.exp(-dt * 5)); this.lookTarget ||= target.clone(); this.lookTarget.lerp(target, 1 - Math.exp(-dt * 7)); this.camera.lookAt(this.lookTarget); this.renderer.render(this.scene, this.camera);
  }
}
