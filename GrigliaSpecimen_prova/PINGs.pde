import processing.serial.*;
import websockets.*; 
import processing.sound.*;

final int TOTAL_WIDTH   = 32;
final int TOTAL_HEIGHT  = 32;
final int BAUD_RATE     = 921600;
final float BALL_RADIUS = 1;
// Step di velocità della pallina (pixel/frame): parte lenta, poi accelera
final float[] SPEED_STEPS = {0.8f, 1.2f, 1.7f};
final int BOUNCES_PER_STEP = 10;     // ogni quanti rimbalzi si passa allo step successivo
final boolean COUNT_WALL_BOUNCES = false; // true = contano anche i muri, false = solo i rimbalzi sui player
final int MIDLINE_LEVEL = 60;       // luminosità (grigio) della linea di metà campo
final int CALIBRATION_LEVEL = 150; // intensità (R e B) della cornice magenta usata per rilevare la matrice


Serial serial;
byte[] buffer;
PGraphics led;
WebsocketServer ws; 

SoundFile bounceSound;

float ballX, ballY;
float spd = SPEED_STEPS[0];
int bounceCount = 0;
float speedX, speedY;
int score1 = 0, score2 = 0;

boolean isCalibrating = false;

// Oggetti fisici rilevati dalla camera
boolean isPlayer1Detected = false;
float p1Left, p1Top, p1Right, p1Bottom;

boolean isPlayer2Detected = false;
float p2Left, p2Top, p2Right, p2Bottom;

void setup() {
  size(400, 300);
  noSmooth();
  pixelDensity(1);

  led = createGraphics(TOTAL_WIDTH, TOTAL_HEIGHT);
  buffer = new byte[TOTAL_WIDTH * TOTAL_HEIGHT * 3];

  bounceSound = new SoundFile(this, "rimbalzo.mp3");

  try {
    serial = new Serial(this, "/dev/tty.usbserial-02D5B3FF", BAUD_RATE);
  } catch (Exception e) {}

  ws = new WebsocketServer(this, 8080, "/pong");
  
  ballX = TOTAL_WIDTH / 2.0;
  ballY = TOTAL_HEIGHT / 2.0;
  float angle = random(-PI, PI);
  speedX = cos(angle) * spd;
  speedY = sin(angle) * spd;
}

// "C:1" / "C:0" = inizia / finisce la calibrazione (cornice magenta sul bordo della matrice)
// "P:left,top,right,bottom" = rettangolo del player normalizzato (0-1) sulla matrice, "P:" = nessun player
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
      } catch (Exception e) { isPlayer2Detected = false; }
    }
    return;
  }
}

void draw() {
  ballX += speedX;
  ballY += speedY;

  // Rimbalzo sui 4 muri esterni
  if (ballX <= BALL_RADIUS) { ballX = BALL_RADIUS; speedX *= -1; registerBounce(true); }
  if (ballX >= TOTAL_WIDTH - BALL_RADIUS) { ballX = TOTAL_WIDTH - BALL_RADIUS; speedX *= -1; registerBounce(true); }
  if (ballY <= BALL_RADIUS) { ballY = BALL_RADIUS; speedY *= -1; registerBounce(true); }
  if (ballY >= TOTAL_HEIGHT - BALL_RADIUS) { ballY = TOTAL_HEIGHT - BALL_RADIUS; speedY *= -1; registerBounce(true); }

  // Collisione con l'oggetto fisico: punto del rettangolo più vicino alla pallina
// Collisione con Player 1
  if (isPlayer1Detected) {
    float nearestX = constrain(ballX, p1Left, p1Right);
    float nearestY = constrain(ballY, p1Top, p1Bottom);

    if (dist(ballX, ballY, nearestX, nearestY) < BALL_RADIUS) {
      // Inverte la componente corretta in base a dove è avvenuto il contatto
      if (abs(ballX - nearestX) > abs(ballY - nearestY)) {
        speedX *= -1;
      } else {
        speedY *= -1;
      }
      
      registerBounce(false); // aggiorna lo step di velocità prima di ricalcolare la direzione
      // Aggiunge una leggera variazione casuale di pochi gradi (es. tra -5 e +5 gradi)
      float jitter = radians(random(-3, 3));
      float currentAngle = atan2(speedY, speedX) + jitter;
      speedX = cos(currentAngle) * spd;
      speedY = sin(currentAngle) * spd;
      fixSpeed();
      // Corregge la posizione per evitare compenetrazioni
      ballX = nearestX + (ballX > nearestX ? 1 : -1) * (BALL_RADIUS + 0.5);
      ballY = nearestY + (ballY > nearestY ? 1 : -1) * (BALL_RADIUS + 0.5);
      
      bounceSound.play();
    }
  }

  // Collisione con Player 2
  if (isPlayer2Detected) {
    float nearestX = constrain(ballX, p2Left, p2Right);
    float nearestY = constrain(ballY, p2Top, p2Bottom);

   if (dist(ballX, ballY, nearestX, nearestY) < BALL_RADIUS) {
      // Inverte la componente corretta in base a dove è avvenuto il contatto
      if (abs(ballX - nearestX) > abs(ballY - nearestY)) {
        speedX *= -1;
      } else {
        speedY *= -1;
      }
      
      registerBounce(false); // aggiorna lo step di velocità prima di ricalcolare la direzione
      // Aggiunge una leggera variazione casuale di pochi gradi (es. tra -5 e +5 gradi)
      float jitter = radians(random(-3, 3));
      float currentAngle = atan2(speedY, speedX) + jitter;
      speedX = cos(currentAngle) * spd;
      speedY = sin(currentAngle) * spd;
      fixSpeed();
      // Corregge la posizione per evitare compenetrazioni
      ballX = nearestX + (ballX > nearestX ? 1 : -1) * (BALL_RADIUS + 0.5);
      ballY = nearestY + (ballY > nearestY ? 1 : -1) * (BALL_RADIUS + 0.5);
      
      bounceSound.play();
    }
  }

  // Manda lo stato della pallina al sito: posizione normalizzata (0-1) e velocità in pixel/frame
  // Locale.US per avere sempre il punto decimale
  ws.sendMessage(String.format(java.util.Locale.US, "B:%.4f,%.4f,%.4f,%.4f",
    ballX / TOTAL_WIDTH, ballY / TOTAL_HEIGHT, speedX, speedY));

  ws.sendMessage("S:" + score1 + "," + score2);  

  // --- DISEGNO MATRICE ---
  led.beginDraw();
  if (isCalibrating) {
    drawCalibrationFrame();
  } else {
    drawBall();
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

// Cornice magenta sul bordo della matrice: la camera la usa per trovare l'area della matrice
void drawCalibrationFrame() {
  led.background(CALIBRATION_LEVEL, 0, CALIBRATION_LEVEL);
  led.noStroke();
  led.fill(0);
  led.rect(1, 1, TOTAL_WIDTH - 2, TOTAL_HEIGHT - 2);
}


void drawBall() {
  led.background(0);
  led.rectMode(CENTER);
  led.noStroke();
  led.fill(255, 250, 217);
  led.rect(ballX, ballY, 2, 2);
  led.rectMode(CORNER);
}

// Conta i rimbalzi e passa allo step di velocità successivo ogni BOUNCES_PER_STEP rimbalzi
void registerBounce(boolean isWall) {
  if (isWall && !COUNT_WALL_BOUNCES) return;
  bounceCount++;
  int step = min(bounceCount / BOUNCES_PER_STEP, SPEED_STEPS.length - 1);
  float newSpd = SPEED_STEPS[step];
  if (newSpd != spd) {
    spd = newSpd;
    float m = mag(speedX, speedY);
    if (m > 0) {
      speedX = speedX / m * spd;
      speedY = speedY / m * spd;
    }
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
