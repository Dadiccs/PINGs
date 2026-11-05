import processing.serial.*;
import websockets.*;
import processing.sound.*;

final int TOTAL_WIDTH   = 32;
final int TOTAL_HEIGHT  = 32;
final int BAUD_RATE     = 921600;
final float BALL_RADIUS = 1;
final float PADDLE_MARGIN = 0.5f;    // tolleranza (pixel matrice) sopra e sotto il paddle
final int CALIBRATION_LEVEL = 150;   // intensità (R e B) della cornice magenta usata per rilevare la matrice

// --- Velocità pallina (pixel/frame) ---
final float[] SPEED_STEPS = {0.8f, 1.2f, 1.7f};
final int BOUNCES_PER_STEP = 10;           // ogni quanti rimbalzi si passa allo step successivo
final boolean COUNT_WALL_BOUNCES = false;  // true = contano anche i muri, false = solo i paddle
final float SPEED_NOISE = 0.06f;           // variazione casuale a ogni rimbalzo (0.06 = ±6%)

final float BOUNCE_NOISE_DEG = 8;   // variazione casuale dell'angolo a ogni rimbalzo sul player (±gradi)
final float BOUNCE_MIN_DEG = 10;     // angolo minimo rispetto all'orizzontale (più basso = più piatto)
final float BOUNCE_MAX_DEG = 55;     // angolo massimo rispetto all'orizzontale (più alto = più verticale)

// --- Partita ---
final int GOALS_PER_ROUND = 3;      // goal per vincere un round (= i 3 pallini)
final int ROUNDS_TO_WIN = 3;        // round per vincere la partita (3 x 3 = 9 goal)
final float CENTER_ZONE = 0.2f;     // "zona centrale": ±20% della larghezza attorno al centro
final int START_HOLD_MS = 1000;     // i due colori devono restare al centro per tanto tempo
final int SETUP_MS = 5000;         // tempo per sistemarsi ai bordi prima del primo lancio
final int GOAL_ANIM_MS = 2000;      // durata del lampeggio dopo un goal
final int GOAL_FLASHES = 2;         // numero di lampeggi dopo un goal
final int SERVE_MS = 3000;          // tempo di chi ha subito goal per scegliere da dove partire
final int WIN_MS = 9500;           // durata della schermata vittoria
final int WIN_FLASHES = 5;       // numero di lampeggi della schermata vittoria
final int PLAYER_GRACE_MS = 300;    // se la camera perde il player per meno di così, il paddle resta dov'era
final float LAUNCH_MIN_DEG = 5;    // angolo di lancio rispetto all'orizzontale: mai verticale
final float LAUNCH_MAX_DEG = 60;
final int EXCHANGES_PER_SCREEN = 5;   // ogni quanti scambi (colpi sui paddle) la schermata cambia

// Colori dei player (come il sito)
final int COLOR_P1 = 0xFFFF1618;
final int COLOR_P2 = 0xFF2317FF;

// Stati della partita
final int ST_WAIT = 0, ST_SETUP = 1, ST_PLAY = 2, ST_GOAL = 3, ST_SERVE = 4, ST_WIN = 5;
final String[] ST_NAMES = {"WAIT", "SETUP", "PLAY", "GOAL", "SERVE", "WIN"};

Serial serial;
byte[] buffer;
PGraphics led;
WebsocketServer ws;

SoundFile bounceSound, whistleSound, goalSound, winSound;

float ballX, ballY;
float spd = SPEED_STEPS[0];
int bounceCount = 0;
float speedX, speedY;

int state = ST_WAIT;
int stateStart = 0;
int stateActor = 0;        // GOAL: chi ha segnato (1/2) | SERVE: chi batte (1/2) | WIN: vincitore (1/2)
int centeredSince = -1;
int[] goals = {0, 0};      // goal totali di [Player 1, Player 2]
int exchanges = 0;         // colpi sui paddle dall'inizio della partita

boolean isCalibrating = false;

// Oggetti fisici rilevati dalla camera
boolean isPlayer1Detected = false;
float p1Left, p1Top, p1Right, p1Bottom;
int p1LastSeen = -100000;

boolean isPlayer2Detected = false;
float p2Left, p2Top, p2Right, p2Bottom;
int p2LastSeen = -100000;

void setup() {
  size(400, 300);
  noSmooth();
  pixelDensity(1);

  led = createGraphics(TOTAL_WIDTH, TOTAL_HEIGHT);
  buffer = new byte[TOTAL_WIDTH * TOTAL_HEIGHT * 3];

  bounceSound  = loadSound("rimbalzo.mp3");
  whistleSound = loadSound("fischio.mp3");
  goalSound    = loadSound("goal.mp3");
  winSound     = loadSound("vittoria.mp3");

  try {
    serial = new Serial(this, "/dev/tty.usbserial-02D5B3FF", BAUD_RATE);
  } catch (Exception e) {}

  ws = new WebsocketServer(this, 8080, "/pong");

  resetGame();
}

SoundFile loadSound(String file) {
  try {
    return new SoundFile(this, file);
  } catch (Exception e) {
    println("Suono mancante: " + file);
    return null;
  }
}

void playSound(SoundFile s) {
  try { if (s != null) s.play(); } catch (Exception e) {}
}

// "C:1" / "C:0" = inizia / finisce la calibrazione (cornice magenta sul bordo della matrice)
// "P1:left,top,right,bottom" = rettangolo del player normalizzato sulla matrice, "P1:" = nessun player
void webSocketServerEvent(String msg) {
  if (msg.startsWith("C:")) {
    isCalibrating = msg.equals("C:1");
    return;
  }

  if (msg.startsWith("P1:")) {
    String[] box = split(msg.substring(3), ',');
    isPlayer1Detected = box.length == 4;
    if (isPlayer1Detected) {
      try {
        p1Left   = Float.parseFloat(box[0]) * TOTAL_WIDTH;
        p1Top    = Float.parseFloat(box[1]) * TOTAL_HEIGHT;
        p1Right  = Float.parseFloat(box[2]) * TOTAL_WIDTH;
        p1Bottom = Float.parseFloat(box[3]) * TOTAL_HEIGHT;
        p1LastSeen = millis();
      } catch (Exception e) { isPlayer1Detected = false; }
    }
    return;
  }

  if (msg.startsWith("P2:")) {
    String[] box = split(msg.substring(3), ',');
    isPlayer2Detected = box.length == 4;
    if (isPlayer2Detected) {
      try {
        p2Left   = Float.parseFloat(box[0]) * TOTAL_WIDTH;
        p2Top    = Float.parseFloat(box[1]) * TOTAL_HEIGHT;
        p2Right  = Float.parseFloat(box[2]) * TOTAL_WIDTH;
        p2Bottom = Float.parseFloat(box[3]) * TOTAL_HEIGHT;
        p2LastSeen = millis();
      } catch (Exception e) { isPlayer2Detected = false; }
    }
    return;
  }
}

void draw() {
  if (!isCalibrating) updateGame();
  sendToSite();

  // --- DISEGNO MATRICE ---
  led.beginDraw();
  if (isCalibrating) {
    drawCalibrationFrame();
  } else {
    drawMatrix();
  }
  led.endDraw();

  // Anteprima a schermo
  background(30);
  image(led, 10, 10, TOTAL_WIDTH * 8, TOTAL_HEIGHT * 8);
  image(led, TOTAL_WIDTH * 8 + 20, 10);

  // Seriale
  if (serial != null) {
    led.loadPixels();
    int idx = 0;
    for (int i = 0; i < led.pixels.length; i++) {
      color c = led.pixels[i];
      buffer[idx++] = (byte)(c >> 16 & 0xFF);
      buffer[idx++] = (byte)(c >> 8  & 0xFF);
      buffer[idx++] = (byte)(c       & 0xFF);
    }
    serial.write('*');
    serial.write(buffer);
  }
}

// Tasti di prova: N = salta il riconoscimento e parte subito, R = azzera la partita
void keyPressed() {
  if (key == 'n' || key == 'N') startSetup();
  if (key == 'r' || key == 'R') resetGame();
}

// =====================================================
//  LOGICA DELLA PARTITA
// =====================================================

void setState(int s, int actor) {
  state = s;
  stateActor = actor;
  stateStart = millis();
}

void updateGame() {
  int t = millis() - stateStart;

  switch (state) {
    case ST_WAIT:
      // La partita inizia quando i due colori restano nella zona centrale
      if (bothCentered()) {
        if (centeredSince < 0) centeredSince = millis();
        if (millis() - centeredSince >= START_HOLD_MS) startSetup();
      } else {
        centeredSince = -1;
      }
      break;

    case ST_SETUP:
      if (t >= SETUP_MS) {
        launch(random(1) < 0.5 ? 1 : -1);   // dal centro, verso sinistra o destra a caso
        playSound(whistleSound);
        setState(ST_PLAY, 0);
      }
      break;

    case ST_PLAY:
      movePlay();
      break;

    case ST_GOAL:
      if (t >= GOAL_ANIM_MS) {
        if (goals[stateActor - 1] >= GOALS_PER_ROUND * ROUNDS_TO_WIN) {
          playSound(winSound);
          setState(ST_WIN, stateActor);
        } else {
          startServe(stateActor == 1 ? 2 : 1);   // batte chi ha subito il goal
        }
      }
      break;

    case ST_SERVE:
      followServer();
      if (t >= SERVE_MS) {
        launch(stateActor == 1 ? 1 : -1);        // verso l'altro giocatore
        playSound(whistleSound);
        setState(ST_PLAY, 0);
      }
      break;

    case ST_WIN:
      if (t >= WIN_MS) resetGame();
      break;
  }
}

boolean player1Present() { return isPlayer1Detected || millis() - p1LastSeen < PLAYER_GRACE_MS; }
boolean player2Present() { return isPlayer2Detected || millis() - p2LastSeen < PLAYER_GRACE_MS; }

// Entrambi i colori riconosciuti nella zona centrale della matrice
boolean bothCentered() {
  if (!isPlayer1Detected || !isPlayer2Detected) return false;
  float lo = TOTAL_WIDTH * (0.5 - CENTER_ZONE);
  float hi = TOTAL_WIDTH * (0.5 + CENTER_ZONE);
  float c1 = (p1Left + p1Right) / 2;
  float c2 = (p2Left + p2Right) / 2;
  return c1 >= lo && c1 <= hi && c2 >= lo && c2 <= hi;
}

void resetGame() {
  goals[0] = 0;
  goals[1] = 0;
  exchanges = 0;
  resetSpeed();
  ballX = TOTAL_WIDTH / 2.0;
  ballY = TOTAL_HEIGHT / 2.0;
  speedX = 0;
  speedY = 0;
  centeredSince = -1;
  setState(ST_WAIT, 0);
}

void startSetup() {
  goals[0] = 0;
  goals[1] = 0;
  exchanges = 0;
  resetSpeed();
  ballX = TOTAL_WIDTH / 2.0;
  ballY = TOTAL_HEIGHT / 2.0;
  speedX = 0;
  speedY = 0;
  setState(ST_SETUP, 0);
}

void startServe(int server) {
  resetSpeed();                // la velocità riparte da capo a ogni goal
  setState(ST_SERVE, server);
  followServer();
}

// Durante l'attesa la pallina segue il centro del paddle di chi batte
void followServer() {
  boolean first = stateActor == 1;
  boolean present = first ? player1Present() : player2Present();
  float y = TOTAL_HEIGHT / 2.0;
  if (present) y = first ? (p1Top + p1Bottom) / 2 : (p2Top + p2Bottom) / 2;
  ballY = constrain(y, BALL_RADIUS, TOTAL_HEIGHT - BALL_RADIUS);
  ballX = first ? BALL_RADIUS + 1 : TOTAL_WIDTH - BALL_RADIUS - 1;
  speedX = 0;
  speedY = 0;
}

// dir = +1 verso destra, -1 verso sinistra. Angolo sempre lontano dalla verticale
void launch(int dir) {
  float a = radians(random(LAUNCH_MIN_DEG, LAUNCH_MAX_DEG)) * (random(1) < 0.5 ? 1 : -1);
  speedX = dir * cos(a) * spd;
  speedY = sin(a) * spd;
}

void resetSpeed() {
  bounceCount = 0;
  spd = SPEED_STEPS[0];
}

void movePlay() {
  ballX += speedX;
  ballY += speedY;

  // Muri alto e basso
  if (ballY <= BALL_RADIUS) { ballY = BALL_RADIUS; speedY = abs(speedY); registerBounce(true); }
  if (ballY >= TOTAL_HEIGHT - BALL_RADIUS) { ballY = TOTAL_HEIGHT - BALL_RADIUS; speedY = -abs(speedY); registerBounce(true); }

  // Lato sinistro = Player 1, lato destro = Player 2. Conta solo la Y del player.
  if (ballX <= BALL_RADIUS) {
    ballX = BALL_RADIUS;
    if (hitsPaddle(player1Present(), p1Top, p1Bottom)) bounceOnPaddle(true);
    else scoreGoal(2);                       // Player 1 ha mancato: segna il Player 2
  } else if (ballX >= TOTAL_WIDTH - BALL_RADIUS) {
    ballX = TOTAL_WIDTH - BALL_RADIUS;
    if (hitsPaddle(player2Present(), p2Top, p2Bottom)) bounceOnPaddle(false);
    else scoreGoal(1);
  }
}

void scoreGoal(int scorer) {
  goals[scorer - 1]++;
  speedX = 0;
  speedY = 0;
  playSound(goalSound);
  setState(ST_GOAL, scorer);
}

boolean hitsPaddle(boolean present, float top, float bottom) {
  return present
      && ballY >= top - BALL_RADIUS - PADDLE_MARGIN
      && ballY <= bottom + BALL_RADIUS + PADDLE_MARGIN;
}

// leftSide = true per il Player 1 (la pallina riparte verso destra)
void bounceOnPaddle(boolean leftSide) {
  registerBounce(false);                       // step di velocità + variazione casuale
  exchanges++;

  float dirX = leftSide ? 1 : -1;              // sempre verso l'avversario
  float dirY = speedY >= 0 ? 1 : -1;           // il verso su/giù resta quello della pallina

  // angolo rispetto all'orizzontale, con un po' di rumore; il verso non cambia mai
  float ang = abs(atan2(speedY, abs(speedX))) + radians(random(-BOUNCE_NOISE_DEG, BOUNCE_NOISE_DEG));
  ang = constrain(ang, radians(BOUNCE_MIN_DEG), radians(BOUNCE_MAX_DEG));   // mai troppo piatta o verticale

  speedX = dirX * cos(ang) * spd;
  speedY = dirY * sin(ang) * spd;
  playSound(bounceSound);
}

// Conta i rimbalzi, sceglie lo step di velocità e aggiunge un po' di variazione casuale
// (anche sui muri: il numero dei km/h sulla griglia cambia a ogni rimbalzo)
void registerBounce(boolean isWall) {
  if (!isWall || COUNT_WALL_BOUNCES) bounceCount++;
  int step = min(bounceCount / BOUNCES_PER_STEP, SPEED_STEPS.length - 1);
  spd = SPEED_STEPS[step] * (1 + random(-SPEED_NOISE, SPEED_NOISE));
  float m = mag(speedX, speedY);
  if (m > 0) {
    speedX = speedX / m * spd;
    speedY = speedY / m * spd;
  }
}

void fixSpeed() {
  float currentAngle = atan2(speedY, speedX);
  float remainder = abs(currentAngle % (HALF_PI));
  float threshold = radians(15);

  if (remainder < threshold || remainder > (HALF_PI - threshold)) {
    float offset = random(radians(15), radians(30)) * (random(1) < 0.5 ? 1 : -1);
    float newAngle = currentAngle + offset;
    speedX = cos(newAngle) * spd;
    speedY = sin(newAngle) * spd;
  }
}

// =====================================================
//  MESSAGGI AL SITO
//  B:x,y,vx,vy            pallina
//  S:r1,r2,d1,d2          round vinti e goal del round in corso (pallini) di P1 e P2
//  ST:STATO,giocatore,sec stato della partita, giocatore coinvolto (0 = nessuno), secondi rimasti
// =====================================================

int rounds(int i) { return goals[i] / GOALS_PER_ROUND; }
int dots(int i)   { return goals[i] % GOALS_PER_ROUND; }

int secondsLeft() {
  int dur = 0;
  if (state == ST_SETUP) dur = SETUP_MS;
  if (state == ST_GOAL)  dur = GOAL_ANIM_MS;
  if (state == ST_SERVE) dur = SERVE_MS;
  if (state == ST_WIN)   dur = WIN_MS;
  if (dur == 0) return 0;
  return max(0, ceil((dur - (millis() - stateStart)) / 1000.0));
}

// 1 = schermata principale, 2 = schermata con il punteggio in grande. Si alternano ogni EXCHANGES_PER_SCREEN scambi
int currentScreen() {
  return 1 + (exchanges / EXCHANGES_PER_SCREEN) % 2;
}

void sendToSite() {
  // Locale.US per avere sempre il punto decimale
  ws.sendMessage(String.format(java.util.Locale.US, "B:%.4f,%.4f,%.4f,%.4f",
    ballX / TOTAL_WIDTH, ballY / TOTAL_HEIGHT, speedX, speedY));
  ws.sendMessage("S:" + goals[0] + "," + goals[1] + "," + rounds(0) + "," + rounds(1));
  ws.sendMessage("ST:" + ST_NAMES[state] + "," + stateActor + "," + secondsLeft());
  ws.sendMessage("SC:" + currentScreen());
}

// =====================================================
//  DISEGNO SULLA MATRICE
// =====================================================

// Cornice magenta sul bordo della matrice: la camera la usa per trovare l'area della matrice
void drawCalibrationFrame() {
  led.background(CALIBRATION_LEVEL, 0, CALIBRATION_LEVEL);
  led.noStroke();
  led.fill(0);
  led.rect(1, 1, TOTAL_WIDTH - 2, TOTAL_HEIGHT - 2);
}

void drawMatrix() {
  led.background(0);

  if (state == ST_GOAL) {
    drawFlash(stateActor == 1 ? COLOR_P1 : COLOR_P2, GOAL_ANIM_MS, GOAL_FLASHES);
    return;
  }
  if (state == ST_WIN) {
    drawFlash(stateActor == 1 ? COLOR_P1 : COLOR_P2, WIN_MS, WIN_FLASHES);
    return;
  }
  // Nell'attesa del primo lancio la pallina lampeggia al centro
  if (state == ST_SETUP && (millis() / 250) % 2 == 1) return;

  drawBall();
}

// Tutta la matrice lampeggia nel colore del giocatore
void drawFlash(int c, int duration, int flashes) {
  int phase = (millis() - stateStart) / max(1, duration / (flashes * 2));
  if (phase % 2 == 0) led.background(c);
}

void drawBall() {
  led.rectMode(CENTER);
  led.noStroke();
  led.fill(255, 250, 217);
  led.rect(ballX, ballY, 2, 2);
  led.rectMode(CORNER);
}