// =====================================================
//  GRIGLIA: font variabile, pannello impostazioni (S),
//  e collegamento con i dati di tracking e pallina
// =====================================================

// --- FONT VARIABILE ---
// Gruppo 0 = Player 1 (rosso):  testi "1" e "D" nei riquadri rossi, slider rossi
// Gruppo 1 = Player 2 (blu):    testi "2" e "P" nei riquadri blu,   slider blu
const gruppiFont = [
  {
    targets: document.querySelectorAll('.pl1 p'),
    wght: document.getElementById('slider-wght'),
    rota: document.getElementById('slider-rota'),
    size: document.getElementById('slider-size'),
    wghtOut: document.querySelectorAll('.pl1 .wght-num'),
  },
  {
    targets: document.querySelectorAll('.pl2 p'),
    wght: document.getElementById('slider-wght-2'),
    rota: document.getElementById('slider-rota-2'),
    size: document.getElementById('slider-size-2'),
    wghtOut: document.querySelectorAll('.pl2 .wght-num'),
  },
];

// --- DOPPIO SLIDER VERTICALE (solo visivo): S = size, R = rotation del Player 1 ---
const vsSize = document.getElementById('vs-size');
const vsRota = document.getElementById('vs-rota');

function aggiornaSliderVerticali() {
  const g = gruppiFont[0];
  [[vsSize, g.size], [vsRota, g.rota]].forEach(([col, s]) => {
    const t = (s.value - s.min) / (s.max - s.min);
    col.querySelector('.slider-pomello').style.setProperty('--t', t);
    col.querySelector('.slider-valore').textContent = Math.round(s.value);
  });
}

function aggiornaFont(g) {
  const v = `'wght' ${g.wght.value}, 'ROTA' ${g.rota.value}, 'SIZE' ${g.size.value}`;
  g.targets.forEach(el => { el.style.fontVariationSettings = v; });
  g.wghtOut.forEach(el => { el.textContent = Math.round(g.wght.value); });
  if (g === gruppiFont[0]) aggiornaSliderVerticali();
}

gruppiFont.forEach(g => {
  [g.wght, g.rota, g.size].forEach(s => s.addEventListener('input', () => aggiornaFont(g)));
});

// Imposta uno slider da codice con un valore normalizzato t (0-1) sul suo range, e aggiorna il font
function setSliderNorm(gruppo, asse, t) {
  const g = gruppiFont[gruppo];
  const s = g[asse];
  const min = Number(s.min), max = Number(s.max);
  t = Math.min(1, Math.max(0, t));
  s.value = min + t * (max - min);
  aggiornaFont(g);
}

// --- PANNELLO IMPOSTAZIONI: tasto "S" ---
const modal = document.getElementById('settingsModal');

window.addEventListener('keydown', (e) => {
  if ((e.key === 's' || e.key === 'S') && document.activeElement.tagName !== 'INPUT') {
    modal.classList.toggle('active');
  }
});

// =====================================================
//  COLLEGAMENTO DATI -> GRIGLIA
// =====================================================

const paddleRosso = document.querySelector('.paddle.rosso');
const paddleBlu = document.querySelector('.paddle.blu');
const lancetta = document.querySelector('.lancetta');
const velocitaEl = document.querySelector('.testo-velocita strong');

// --- Parametri da regolare ---
const KMH_PER_PX_FRAME = 56;  // pixel/frame -> km/h (1.2 px/frame = ~67 km/h)
const KMH_MAX = 100;          // fondo scala: lancetta a +135° e SIZE al massimo
const TRAIL_LEN = 300;        // punti della scia (~5 s a 60 fps). Più alto = scia più lunga
const SMOOTH = 0.2;           // 0-1: più basso = più morbido

// 1) TRACKING (webcam): la posizione verticale di ogni player
//    -> bacchetta + WEIGHT dei testi del suo colore
window.aggiornaGriglia = function (players) {
  players.forEach((p, i) => {
    if (!p) return;
    const cy = (p.top + p.bottom) / 2;
    (i === 0 ? paddleRosso : paddleBlu).style.setProperty('--pos-y', (cy * 100) + '%');
    setSliderNorm(i, 'wght', cy);
  });
};

// 2) PALLINA (Processing, messaggio "B:x,y,vx,vy")
//    -> km/h + lancetta, ROTA (direzione), SIZE (velocità), scia nel campo
let kmhSmooth = 0;
let angoloSmooth = 0;

const pallinaXEl = document.getElementById('pallina-x');
const pallinaYEl = document.getElementById('pallina-y');

window.aggiornaPallina = function ({ x, y, vx, vy }) {
  // Velocità
  const kmh = Math.hypot(vx, vy) * KMH_PER_PX_FRAME;
  kmhSmooth += (kmh - kmhSmooth) * SMOOTH;
  const kmhC = Math.min(KMH_MAX, kmhSmooth);

  velocitaEl.textContent = Math.round(kmhC);
  lancetta.style.transform = `rotate(${-135 + (kmhC / KMH_MAX) * 270}deg)`;

  // Direzione (interpolazione circolare per non "girare al contrario" tra 359° e 0°)
  const target = (Math.atan2(vy, vx) * 180 / Math.PI + 360) % 360;
  const diff = ((target - angoloSmooth + 540) % 360) - 180;
  angoloSmooth = (angoloSmooth + diff * SMOOTH + 360) % 360;

  const tRosso = angoloSmooth / 360;            // Player 1: stessa direzione della pallina
  const tBlu = ((360 - angoloSmooth) % 360) / 360; // Player 2: direzione opposta

  setSliderNorm(0, 'rota', tRosso);
  setSliderNorm(1, 'rota', tBlu);

  // SIZE da velocità (stesso valore per entrambi)
  setSliderNorm(0, 'size', kmhC / KMH_MAX);
  setSliderNorm(1, 'size', kmhC / KMH_MAX);

  // Coordinate sulla matrice 32x32 (0-31)
  pallinaXEl.textContent = Math.min(31, Math.max(0, Math.floor(x * 32)));
  pallinaYEl.textContent = Math.min(31, Math.max(0, Math.floor(y * 32)));

  // Scia
  trail.push({ x, y });
  if (trail.length > TRAIL_LEN) trail.shift();
  disegnaCampo();
};

// 3) CAMPO IN BASSO A SINISTRA: pallino + scia
const campo = document.querySelector('.campo');
const canvasCampo = document.getElementById('traccia-pallina');
const ctxCampo = canvasCampo.getContext('2d');
const trail = [];

function ridimensionaCampo() {
  const dpr = window.devicePixelRatio || 1;
  canvasCampo.width = Math.round(campo.clientWidth * dpr);
  canvasCampo.height = Math.round(campo.clientHeight * dpr);
  disegnaCampo();
}
new ResizeObserver(ridimensionaCampo).observe(campo);

function disegnaCampo() {
  const w = canvasCampo.width, h = canvasCampo.height;
  ctxCampo.clearRect(0, 0, w, h);
  if (trail.length === 0) return;

  // Scia: segmenti sempre più opachi verso la pallina
  ctxCampo.lineCap = 'round';
  ctxCampo.lineJoin = 'round';
  ctxCampo.lineWidth = Math.max(1, w * 0.012);
  for (let i = 1; i < trail.length; i++) {
    const a = Math.pow(i / trail.length, 1.5) * 0.55;
    ctxCampo.strokeStyle = `rgba(0, 0, 0, ${a})`;
    ctxCampo.beginPath();
    ctxCampo.moveTo(trail[i - 1].x * w, trail[i - 1].y * h);
    ctxCampo.lineTo(trail[i].x * w, trail[i].y * h);
    ctxCampo.stroke();
  }

  // Pallina (pallino)
  const p = trail[trail.length - 1];
  ctxCampo.fillStyle = '#000';
  ctxCampo.beginPath();
  ctxCampo.arc(p.x * w, p.y * h, w * 0.0375, 0, Math.PI * 2);
  ctxCampo.fill();
}

// =====================================================
//  GLIFO GRANDE: appoggiato SEMPRE sulla baseline e con
//  la cima alla linea Cap Height, a qualsiasi dimensione
// =====================================================

// Se conosci le metriche esatte puoi forzarle, es. 1420 / 2000 (capHeight / unitsPerEm).
// Con null il rapporto viene misurato dal font caricato.
const CAP_RATIO_MANUALE = null;
let capRatio = CAP_RATIO_MANUALE || 0.71;   // 0.71 = valore di riserva

function calibraCapHeight() {
  if (CAP_RATIO_MANUALE) return;
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = '1000px DMT';
    const m = ctx.measureText('H');
    if (m.actualBoundingBoxAscent > 0) capRatio = m.actualBoundingBoxAscent / 1000;
  } catch (e) { /* si usa il valore di riserva */ }
}

// Aggiorna i filetti verticali e la larghezza della bounding box
function aggiornaFilettiTecnici() {
  document.querySelectorAll('.item-grande').forEach(item => {
    const wrapper = item.querySelector('.technical-wrapper');
    const textEl = item.querySelector('.text-grande');
    const widthValEl = item.querySelector('.bbox-width-val');
    if (!wrapper || !textEl) return;

    const wr = wrapper.getBoundingClientRect();
    const tr = textEl.getBoundingClientRect();

    wrapper.style.setProperty('--box-left', `${tr.left - wr.left}px`);
    wrapper.style.setProperty('--box-right', `${tr.right - wr.left}px`);
    
    // Moltiplica la larghezza per il rapporto esatto e arrotonda per eccesso verso l'alto
    if (widthValEl) {
      const trWidth = tr.width * 6.501; //* 5.86 Sul 27''
      widthValEl.textContent = Math.floor(trWidth);
    }
  });
}

// Dimensiona e posiziona il glifo in base alle linee reali
function adattaGlifi() {
  document.querySelectorAll('.item-grande').forEach(item => {
    const wrapper = item.querySelector('.technical-wrapper');
    const p = item.querySelector('.text-grande');
    if (!wrapper || !p) return;

    const linee = wrapper.querySelectorAll('.filetto-orizzontale');
    const lineaCap = linee[1];    // Cap Height
    const lineaBase = linee[3];   // Baseline
    if (!lineaCap || !lineaBase) return;

    const wr = wrapper.getBoundingClientRect();
    const capY = lineaCap.getBoundingClientRect().top - wr.top;
    const baseY = lineaBase.getBoundingClientRect().top - wr.top;

    // 1) font-size: l'altezza delle maiuscole deve riempire lo spazio Cap -> Baseline
    p.style.fontSize = ((baseY - capY) / capRatio) + 'px';

    // 1b) azzera qualsiasi translateY residuo del CSS: il posizionamento verticale lo fa solo `top`
    p.style.transform = 'translateX(-50%)';

    // 2) marcatore invisibile che si siede sulla baseline reale del testo
    let marker = p.querySelector('.baseline-marker');
    if (!marker) {
      marker = document.createElement('span');
      marker.className = 'baseline-marker';
      marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;';
      p.appendChild(marker);
    }

    // 3) sposta il <p> in modo che la baseline coincida con la linea
    p.style.top = '0px';
    const offset = marker.getBoundingClientRect().top - p.getBoundingClientRect().top;
    p.style.top = (baseY - offset) + 'px';
  });

  aggiornaFilettiTecnici();
}

// Ricalcolo quando cambia la dimensione dei riquadri (resize, rotazione, zoom...)
const roGlifi = new ResizeObserver(adattaGlifi);
document.querySelectorAll('.item-grande .technical-wrapper').forEach(w => roGlifi.observe(w));
window.addEventListener('resize', adattaGlifi);
window.addEventListener('DOMContentLoaded', adattaGlifi);

// Quando gli slider cambiano il font, aggiorna solo larghezza e filetti verticali
const vecchiaFunzioneAggiornaFont = window.aggiornaFont || aggiornaFont;
window.aggiornaFont = function (g) {
  vecchiaFunzioneAggiornaFont(g);
  requestAnimationFrame(aggiornaFilettiTecnici);
};

// Appena il font DMT è caricato: misura il cap-height e ricalcola
if (document.fonts) {
  document.fonts.load('1000px DMT', 'H').catch(() => { }).then(() => {
    calibraCapHeight();
    adattaGlifi();
  });
}

// --- CONTACHILOMETRI: pallini e numeri sull'arco (0 in basso a sinistra) ---
(function costruisciQuadrante() {
  const cont = document.querySelector('.cerchio-tratteggiato-container');
  const R_DOT = 44, R_NUM = 35;           // raggi in % del contenitore
  const pos = (v, r) => {
    const a = (-135 + (v / KMH_MAX) * 230) * Math.PI / 180;
    return [50 + r * Math.sin(a), 50 - r * Math.cos(a)];
  };
  for (let v = 0; v <= KMH_MAX; v += 5) {
    const [x, y] = pos(v, R_DOT);
    const d = document.createElement('div');
    d.className = 'q-dot';
    d.style.left = x + '%'; d.style.top = y + '%';
    cont.appendChild(d);
  }
  for (let v = 0; v <= KMH_MAX; v += 10) {   // il 100 resta sotto al numero grande
    const [x, y] = pos(v, R_NUM);
    const n = document.createElement('div');
    n.className = 'q-num';
    n.textContent = v;
    n.style.left = x + '%'; n.style.top = y + '%';
    cont.appendChild(n);
  }
})();

aggiornaSliderVerticali();