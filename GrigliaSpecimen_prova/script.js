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
  },
  {
    targets: document.querySelectorAll('.pl2 p'),
    wght: document.getElementById('slider-wght-2'),
    rota: document.getElementById('slider-rota-2'),
    size: document.getElementById('slider-size-2'),
  },
];

function aggiornaFont(g) {
  const v = `'wght' ${g.wght.value}, 'ROTA' ${g.rota.value}, 'SIZE' ${g.size.value}`;
  g.targets.forEach(el => { el.style.fontVariationSettings = v; });

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

// --- FUNZIONE PER AGGIORNARE I FILETTI TECNICI E LA BOUNDING BOX ---
function aggiornaFilettiTecnici() {
    const itemsGrandi = document.querySelectorAll('.item-grande');

    itemsGrandi.forEach(item => {
        const wrapper = item.querySelector('.technical-wrapper');
        const textEl = item.querySelector('.text-grande');
        const widthValEl = item.querySelector('.bbox-width-val');
        if (!wrapper || !textEl) return;

        // Calcola le coordinate reali del testo rispetto al riquadro
        const wrapperRect = wrapper.getBoundingClientRect();
        const textRect = textEl.getBoundingClientRect();

        const relLeft = textRect.left - wrapperRect.left;
        const relRight = textRect.right - wrapperRect.left;

        // Aggiorna le variabili CSS dei filetti verticali
        wrapper.style.setProperty('--box-left', `${relLeft}px`);
        wrapper.style.setProperty('--box-right', `${relRight}px`);

        // Aggiorna dinamicamente il valore numerico della larghezza della bounding box
        if (widthValEl) {
            widthValEl.textContent = Math.round(textRect.width);
        }
    });
}

// Chiamate automatiche nei momenti chiave
window.addEventListener('DOMContentLoaded', aggiornaFilettiTecnici);
window.addEventListener('resize', aggiornaFilettiTecnici);

const vecchiaFunzioneAggiornaFont = window.aggiornaFont || aggiornaFont;
window.aggiornaFont = function(g) {
    vecchiaFunzioneAggiornaFont(g); 
    requestAnimationFrame(aggiornaFilettiTecnici); 
};

// Aspetta che il font personalizzato sia caricato al 100% prima di calcolare i filetti
if (document.fonts) {
    document.fonts.ready.then(() => {
        setTimeout(aggiornaFilettiTecnici, 50);
    });
}