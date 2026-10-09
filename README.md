# Comboio 22

Mini-jogo 3D multiplayer de navegador: pickups low-poly, cenário brasileiro e um único carro de som comandado pelo Host. Até **12 jogadores por sala**, com servidor autoritativo a **25 Hz**. Three.js + Web Audio + Node.js + Socket.io, sem banco de dados, contas ou serviços pagos.

A referência visual foi interpretada a partir da descrição do pedido. Nenhum vídeo ou áudio comercial acompanha o projeto. As quatro faixas de demonstração são loops originais de batida sintetizada; não são gravações de “Mega Funk segundo turno”. O Host pode enviar áudio próprio.

## Rodar localmente

Requer Node.js **20 ou superior** (validado com Node 24) e npm.

```bash
cd game # ou a pasta em que você colocou o projeto
npm ci
npm start
```

Abra `http://localhost:3000` no navegador. Para desenvolver com reinício automático do servidor: `npm run dev`. Alterações do cliente aparecem ao atualizar a página; não há bundler ou etapa de build.

1. Escolha apelido, cor e pintura; crie uma sala pública ou privada.
2. Copie o código de seis caracteres e compartilhe com os amigos.
3. O Host clica em **Ligar o som e partir**. Pode começar sozinho, e outros jogadores podem entrar depois.
4. Abra outra aba ou navegador e entre com o código para experimentar o áudio por distância.
5. Para jogar no celular pela rede local, use o IP do computador e a porta 3000. Autorize essa porta no firewall. Em deploy, use HTTPS.

O áudio é liberado por interação com a página. Se o navegador bloquear a reprodução, toque em **ativar o áudio** no HUD. Não há links públicos de preview criados por este projeto.

## Controles

| Ação | Desktop | Celular |
| --- | --- | --- |
| Acelerar / ré / frear | W/S ou ↑/↓; solte para desacelerar | Joystick vertical |
| Virar | A/D ou ←/→ | Joystick horizontal |
| Buzina | Espaço | Botão de buzina |
| Nitro | Segurar Shift | Segurar NITRO |
| Alternar câmera | C ou botão Câmera | Botão Câmera |
| Chat | Enter | Campo de mensagem |

Nitro gasta a reserva e recarrega ao soltar. A câmera normal acompanha com atraso suave. **Comboio** enquadra os carros num raio de 75 m do motorista. O Host também pode usar câmera **orbital**: arraste o cenário e use a roda do mouse para ajustar a altura. No touch, arraste para girar.

O botão **Auto**, disponível aos convidados, tenta alinhar cada carro atrás do Host. É assistência simples de direção, sem planejamento de rota: siga ruas abertas e não espere que desvie sozinho de um quarteirão. O volante volta ao manual ao desligá-lo.

**Replay 10s** mostra os snapshots recebidos nos últimos dez segundos; não altera o estado do servidor. Seu carro desacelera e o piloto automático é desligado. A música continua ao vivo, calculada pela posição real do seu carro, não pela posição do replay. Reações desaparecem em dois segundos; chat tem limite de 160 caracteres.

## Arquitetura e pastas

```text
 game/
 ├── package.json / package-lock.json  dependências e comandos
 ├── Dockerfile                       deploy em um processo Node
 ├── playwright.config.js             configuração dos testes de navegador
 ├── server/
 │   ├── index.js                     HTTP, salas, Socket.io, músicas e ticks
 │   └── physics.js                   movimento, drift, nitro e colisões
 ├── shared/
 │   └── world.js                     mapa, obstáculos, tracks, limites e ganho
 ├── public/
 │   ├── index.html                   lobby, garagem, HUD e controles
 │   ├── style.css                    interface responsiva
 │   └── js/
 │       ├── main.js                  eventos, controles, chat e loop de jogo
 │       ├── scene.js                 Three.js, modelos, câmeras e partículas
 │       ├── audio.js                 faixas, relógio, volume, filtro e stereo
 │       └── net.js                   interpolação e extrapolação
 └── test/
     ├── game.test.js                 testes unitários e integração real Socket.io
     └── browser/game.spec.js         dois navegadores, touch e grafo de áudio
```

O mesmo servidor entrega HTML/JS, Three.js do `node_modules`, cliente Socket.io e conexões multiplayer. Não precisa de CDN. O mapa e os volumes de prédios são compartilhados para que a geometria renderizada corresponda à colisão. A cobertura aberta do posto e os postes são elementos decorativos; os prédios e caminhão estacionado bloqueiam os carros. Caixas estáticas são agrupadas em `InstancedMesh` para reduzir chamadas de desenho. DPR e resolução de sombras são limitados para reduzir o custo em mobile. Ao detectar renderização por software (SwiftShader/llvmpipe), o cliente desativa shadow maps para manter a interface utilizável; GPUs normais usam sombras suaves.

### Protocolo multiplayer

- `create` / `join` → confirmação com sala, participantes, Host e estado musical.
- `room` → alterações de participantes e transferência do Host.
- `start` → aceito apenas do Host; inicia física e música.
- `input` → apenas aceleração, direção e nitro. Posições enviadas pelo cliente não são usadas.
- `snapshot` → servidor publica posição, rotação, velocidade, nitro e auto a cada 40 ms.
- `clock` → ida e volta para estimar offset entre relógios, priorizando RTT baixo; atualizado a cada 5 s.
- `musicControl` / `music` → faixa, reprodução, offset acumulado e horário inicial compartilhado.
- `chat`, `horn`, `reaction`, `auto`, `leave` → mensagens e ações com limites de frequência.

O cliente desenha **100 ms atrás do relógio do servidor**, interpolando posições e o menor arco de rotação. Na ausência de snapshots, extrapola por no máximo **120 ms**; depois congela. Não há rollback nem previsão local: esse buffer evita oscilações, mas adiciona latência de direção. Input antigo expira após 600 ms. O servidor limita velocidade, separa carros com impulsos simétricos e resolve colisões circulares contra caixas dos prédios. Velocidade máxima: 21 m/s; nitro: 30 m/s.

Se o Host sai, o primeiro participante remanescente recebe o controle do carro de som. A faixa e o instante de reprodução permanecem os mesmos; o emissor visual e a origem do volume mudam para o novo Host. Ao perder conexão, seu carro é removido: a reconexão do socket funciona, mas é necessário entrar novamente na sala. A última pessoa sair remove a sala e o upload da memória.

### Áudio espacial: o destaque

Cada navegador reproduz **uma única fonte musical**, representando exclusivamente o carro do Host. Não há uma música diferente por pickup. Os clientes usam a identidade da faixa, `startedAt` e `offset` do servidor para começar no mesmo ponto do loop. Entradas tardias, downloads de upload e retorno de uma aba em segundo plano recalculam a posição atual. Isso fornece sincronização aproximada de comboio, não alinhamento de amostras entre dispositivos: latência de hardware e de rede pode produzir diferença audível se duas caixas físicas estiverem lado a lado.

Em `shared/world.js` e `public/js/audio.js`:

```js
const distancia = Math.hypot(jogador.x - host.x, jogador.z - host.z);
const u = clamp(1 - distancia / 95, 0, 1);
const volume = u * u * (3 - 2 * u); // smoothstep
const cutoff = 700 + 17300 * volume ** 1.3;
```

O mapa é plano: x/z representam a distância física no chão. A 0 m, ganho 1; a 47,5 m, ganho 0,5; a partir de 95 m, ganho 0. O Host tem distância zero de si mesmo. **Mute** afeta só o cliente atual. O HUD mostra o ganho de proximidade, antes da redução fixa do volume master e do compressor.

```text
BufferSource (loop sincronizado)
 → BiquadFilter (low-pass: 700–18000 Hz)
 → StereoPanner (posição relativa ao lado direito do carro)
 → GainNode (distância + mute)
 → DynamicsCompressor (limita picos)
 → Master Gain (0,65)
 → alto-falantes do dispositivo
```

Ganhos e parâmetros usam `setTargetAtTime` com 85–150 ms de suavização, evitando cliques quando a distância muda. A panorâmica é leve, até ±0,7. Buzinas são fontes curtas separadas com atenuação por distância. Caixas vibram de acordo com a batida, RGB pulsa no Host e anéis se expandem no chão. O filtro não simula oclusão por prédios, e a panorâmica não é áudio HRTF binaural.

### Tracks e upload

Avenida (128 BPM), Paredão (140), Domingo (120) e Turbo (150) são geradas no Web Audio: bumbo, caixa, chimbal e baixo. Têm quatro compassos e não dependem de assets de som.

Na **Mesa do Host**, escolha uma faixa, pause/retome ou envie MP3, WAV ou outro formato que o navegador consiga decodificar. Limites: **12 MB**, até **10 minutos** no validador do cliente, uma faixa por sala e 128 MB somados de uploads no servidor. A duração de dez minutos é validada no cliente; o servidor limita tamanho, autorização e armazenamento, mas não decodifica áudio. O BPM de upload é assumido como 128 apenas para os efeitos visuais. A faixa enviada substitui a anterior e não persiste depois que a sala termina ou o processo reinicia. Cada participante baixa o mesmo arquivo, e navegadores com codecs incompatíveis exibem erro de áudio.

O upload requer um token aleatório da conexão do Host; o download exige token de participante. Tokens vivem apenas na memória e não são expostos em URLs. O nome de track usa cabeçalho codificado para suportar português. Mensagens são renderizadas com `textContent`, há limites de payload/frequência e uma CSP de mesma origem. Para exposição pública em larga escala, acrescente controle de abuso, métricas e limites de conexões no proxy.

## Assets prontos

| Asset | Origem / licença |
| --- | --- |
| Pickups, rodas, caçambas, caixas e caminhão verde | Geometria procedural em `scene.js` |
| Pinturas 22, 13 e “Só pelo grave” | Texturas Canvas geradas no navegador |
| Bandeira do Brasil | Canvas + malha animada |
| Casas, muros, posto, placas, árvores e nuvens | Geometria procedural |
| Luzes RGB, ondas, poeira e nitro | Geometria/partículas leves |
| Quatro loops musicais e buzina | Síntese original em `audio.js` |
| Tipografia | Fonte do sistema; sem download |
| Música pessoal | Enviada pelo Host; use uma faixa que possa compartilhar |

Nenhum asset externo é obrigatório. Para adicionar uma faixa sintetizada, inclua metadados em `TRACKS` e seu padrão no sintetizador. Para músicas gravadas permanentes, coloque arquivos que você possa distribuir em `public/assets/`, adapte o carregamento em `setMusic` e mantenha os mesmos timestamps do servidor.

## Testes

```bash
npm test                 # 6 testes: áudio, interpolação, física e multiplayer real
npm run check           # sintaxe dos módulos principais
npx playwright install chromium
npm run test:browser    # 3 testes reais de navegador
```

Se houver Chromium instalado, você pode evitar download:

```bash
TEST_BROWSER_PATH=/usr/bin/chromium npm run test:browser
```

No ambiente cloud atual, o cache npm pode ser colocado em `/tmp/npm-cache` com `npm_config_cache=/tmp/npm-cache`. O download do Chromium pelo Playwright foi bloqueado pela política de rede; os testes usam `/usr/bin/chromium` já instalado. Os testes de navegador verificam lobby com duas pessoas, volume perto/longe, chat, troca de faixa, upload WAV, replay, migração do Host, joystick, nitro, ausência de overflow mobile e valores reais de GainNode/low-pass. O teste com 12 participantes valida capacidade funcional da sala; não substitui um benchmark de carga de várias salas.

## Deploy

Use **um único processo Node** em um serviço com WebSockets (Render, Railway, Fly.io, VPS ou Docker). Frontend estático isolado em GitHub Pages/Vercel não executa este backend persistente.

**Render / Railway:** conecte o repositório, selecione serviço Node, build `npm ci --omit=dev`, start `npm start`, health check `/health`. A aplicação respeita a variável `PORT` fornecida pela plataforma e escuta em `0.0.0.0`. Ative HTTPS e suporte a WebSockets. Se o serviço tiver suspensão por inatividade, a primeira conexão pode demorar e salas abertas serão perdidas ao reiniciar.

**Docker:**

```bash
docker build -t comboio-22 .
docker run --rm -p 3000:3000 -e PORT=3000 comboio-22
```

O Dockerfile usa Node 24 Alpine, lockfile e usuário não-root. Não depende de disco gravável para uploads. Para expor na internet, use domínio + proxy HTTPS. Exemplo de Nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 120s;
    client_max_body_size 13m;
}
```

Salas e arquivos ficam na memória: reiniciar o servidor encerra as sessões. **Não use várias réplicas** deste servidor sem um projeto adicional de autoridade de salas e coordenação distribuída; sticky sessions e Redis adapter sozinhos não compartilham a simulação. Nenhuma implantação, push ou publicação foi feita automaticamente.
