import { test, expect } from '@playwright/test';
function wav() {
  const samples = 16000, b = Buffer.alloc(44 + samples * 2); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) b.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 220 / 8000) * 2000), 44 + i * 2); return b;
}
test('duas pessoas: WebGL, áudio perto/longe, chat, upload, replay e promoção', async ({ browser }) => {
  const context = await browser.newContext(), host = await context.newPage(), guest = await context.newPage(), errors = [];
  for (const page of [host, guest]) { page.on('pageerror', e => errors.push(e.message)); await page.goto('/'); await expect(page.locator('#loading')).toBeHidden(); }
  await host.locator('#name').fill('DJ Host'); await host.locator('#room-name').fill('Teste do grave');
  await host.getByRole('button', { name: 'Criar meu comboio' }).click(); await expect(host.locator('#lobby')).toBeVisible();
  const code = await host.locator('#room-code').textContent();
  await guest.locator('#name').fill('Convidado'); await guest.locator('#tab-join').click(); await guest.locator('#code').fill(code);
  await guest.getByRole('button', { name: 'Entrar na avenida' }).click(); await expect(guest.locator('#host-wait')).toBeVisible();
  await host.locator('#start').click(); await expect(guest.locator('#hud')).toBeVisible(); await expect(host.locator('#online')).toHaveText('2/50');
  await expect(guest.locator('#volume-value')).toHaveText(/9\d%|100%/, { timeout: 15000 });
  await guest.keyboard.down('KeyW'); await expect(guest.locator('#volume-value')).toHaveText('0%', { timeout: 13000 }); await guest.keyboard.up('KeyW');
  await guest.locator('#mute').click(); await expect(guest.locator('#mute')).toHaveAttribute('aria-pressed', 'true');
  await guest.locator('#chat-input').fill('Bora comboio!'); await guest.locator('#chat-input').press('Enter'); await expect(host.locator('#messages')).toContainText('Bora comboio!');
  await host.locator('#dj summary').click(); await host.locator('#tracks').selectOption('turbo'); await expect(guest.locator('#track-name')).toContainText('Turbo');
  await host.locator('#tracks').selectOption('segundo-turno'); await expect(guest.locator('#track-name')).toContainText('Segundo turno é 22');
  await host.locator('#upload').setInputFiles({ name: 'Faixa teste.wav', mimeType: 'audio/wav', buffer: wav() });
  await expect(host.locator('#upload-status')).toContainText('Faixa enviada', { timeout: 15000 }); await expect(guest.locator('#track-name')).toHaveText('Faixa teste');
  await host.locator('#replay').click(); await expect(host.locator('#replay-banner')).toBeVisible(); await host.locator('#stop-replay').click();
  await host.locator('#leave-game').click(); await expect(guest.locator('#dj')).toBeVisible(); await expect(guest.locator('#online')).toHaveText('1/50');
  expect(errors).toEqual([]); await context.close();
});
test('mobile: lobby responsivo e joystick + nitro', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }), page = await context.newPage();
  await page.goto('/'); await expect(page.locator('#loading')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Criar meu comboio' }).tap(); await page.locator('#start').tap(); await expect(page.locator('#touch-controls')).toBeVisible();
  const stick = await page.locator('#joystick').boundingBox();
  await page.mouse.move(stick.x + stick.width / 2, stick.y + 10); await page.mouse.down();
  await expect(page.locator('#speed')).not.toHaveText('0', { timeout: 5000 });
  await page.mouse.up();
  await page.keyboard.down('KeyW'); const boost = await page.locator('#touch-boost').boundingBox();
  await page.mouse.move(boost.x + boost.width / 2, boost.y + boost.height / 2); await page.mouse.down();
  await expect.poll(() => page.locator('#nitro-bar').evaluate(el => parseFloat(el.style.width))).toBeLessThan(95);
  await page.mouse.up(); await page.keyboard.up('KeyW');
  await page.locator('#mute').tap(); await expect(page.locator('#volume-value')).toHaveText('0%');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.close();
});
test('MP3 padrão: decodificação, low-pass, ganho suave e estéreo', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { SpatialAudio } = await import('/js/audio.js'), { TRACKS } = await import('/shared/world.js');
    const audio = new SpatialAudio(message => { throw new Error(message); }); await audio.unlock();
    const clock = () => Date.now(); await audio.setMusic({ ...TRACKS[0], playing: true, startedAt: Date.now() - 500, offset: 0 }, clock, '');
    const duration = audio.source.buffer.duration;
    await audio.setMusic({ ...TRACKS.find(t => t.id === 'segundo-turno'), playing: true, startedAt: Date.now() - 500, offset: 0 }, clock, '');
    const alternativeDuration = audio.source.buffer.duration;
    audio.update({ x: 0, z: 0 }, { x: 0, z: 0 }, clock()); await new Promise(r => setTimeout(r, 350));
    const near = { volume: audio.volume, gain: audio.gain.gain.value, cutoff: audio.filter.frequency.value, pan: audio.panner.pan.value };
    audio.update({ x: 200, z: 0 }, { x: 0, z: 0 }, clock()); await new Promise(r => setTimeout(r, 750));
    const far = { volume: audio.volume, gain: audio.gain.gain.value, cutoff: audio.filter.frequency.value, pan: audio.panner.pan.value };
    audio.stop(); await audio.ctx.close(); return { near, far, duration, alternativeDuration };
  });
  expect(result.duration).toBeGreaterThan(60); expect(result.alternativeDuration).toBeGreaterThan(60); expect(result.near.volume).toBe(1); expect(result.near.gain).toBeGreaterThan(0.95); expect(result.near.cutoff).toBeGreaterThan(15000);
  expect(result.far.volume).toBe(0); expect(result.far.gain).toBeLessThan(0.01); expect(result.far.cutoff).toBeLessThan(1000); expect(result.near.pan).toBe(0); expect(result.far.pan).toBeLessThan(-0.65);
});
