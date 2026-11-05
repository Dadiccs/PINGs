const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const coordsEl = document.getElementById("coords");
const pickHintEl = document.getElementById("pick-hint");
const wsStatusEl = document.getElementById("wsStatus");
// Camera sempre visibile nella pagina (copia quadrata del canvas del pannello S)
const liveCanvas = document.getElementById("canvas-live");
const liveCtx = liveCanvas ? liveCanvas.getContext("2d") : null;

const MIN_BLOB_AREA = 500;
const MATRIX_LIGHT_DELAY_MS = 1000;
const MATRIX_MASK_BLUR_SIZE = 15;

// Magenta: deve coincidere con il colore della cornice in PINGs.pde
const matrixFrameColor = { hue: 150, hueTol: 15, satMin: 60, valMin: 60 };

let processingSocket = null;
function connectSocket() {
    processingSocket = new WebSocket("ws://localhost:8080/pong");
    processingSocket.onopen = () => {
        wsStatusEl.textContent = "Connesso";
        wsStatusEl.style.color = "#00ff00";
    };
    processingSocket.onclose = () => {
        wsStatusEl.textContent = "Disconnesso (riprovo...)";
        wsStatusEl.style.color = "orange";
        setTimeout(connectSocket, 3000);
    };
    // Messaggi da Processing: "B:x,y,vx,vy" (pallina) e "S:p1,p2" (punteggio)
    processingSocket.onmessage = (e) => {
        if (typeof e.data !== "string") return;

        if (e.data.startsWith("B:")) {
            const [x, y, vx, vy] = e.data.substring(2).split(",").map(Number);
            if ([x, y, vx, vy].every(Number.isFinite) && window.aggiornaPallina) {
                window.aggiornaPallina({ x, y, vx, vy });
            }
        } else if (e.data.startsWith("S:")) {
            // round vinti (numero grande) e goal del round in corso (pallini)
            const [r1, r2, d1, d2] = e.data.substring(2).split(",").map(Number);
            if ([r1, r2, d1, d2].every(Number.isFinite) && window.aggiornaPunteggio) {
                window.aggiornaPunteggio(r1, r2, d1, d2);
            }
        } else if (e.data.startsWith("ST:")) {
            // stato della partita: STATO,giocatore,secondi
            const [stato, giocatore, secondi] = e.data.substring(3).split(",");
            if (window.aggiornaStato) window.aggiornaStato(stato, Number(giocatore), Number(secondi));
        } else if (e.data.startsWith("SC:")) {
            // schermata da mostrare: 1 (principale) o 2 (punteggio in grande)
            const n = Number(e.data.substring(3));
            if (Number.isFinite(n) && window.aggiornaSchermata) window.aggiornaSchermata(n);
        }
    };
    processingSocket.onerror = () => {
        wsStatusEl.textContent = "Errore di connessione";
        wsStatusEl.style.color = "red";
    };
}
connectSocket();

const calibration = {
    hueTol: 10,
    satMin: 80,
    valMin: 80,
};

const colorDetectors = [
    {
        name: "Player 1",
        stroke: "#FFD700",
        enabled: true,
        ranges: [[[20, 80, 80], [40, 255, 255]]],
    },
    {
        name: "Player 2",
        stroke: "#00FFFF",
        enabled: true,
        ranges: [[[100, 80, 80], [120, 255, 255]]],
    }
];

let activePickingIndex = null;

let isPicking = false;
let isMatrixDetectionPending = false;

// Area della camera in cui cade la matrice LED (all'inizio: tutto il frame)
let matrixArea = { x: 0, y: 0, width: canvas.width, height: canvas.height };
// Rettangolo REALE della matrice (senza il margine del 5%): i player vanno misurati su questo
let matrixRect = { x: 0, y: 0, width: canvas.width, height: canvas.height };

function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function rgbToOpenCvHsv(r, g, b) {
    let src = cv.matFromArray(1, 1, cv.CV_8UC3, [r, g, b]);
    let hsv = new cv.Mat();
    cv.cvtColor(src, hsv, cv.COLOR_RGB2HSV);
    const h = hsv.data[0];
    src.delete();
    hsv.delete();
    return { h };
}

function hsvRangesFromHue(h, satMin, valMin, hueTol) {
    const sm = satMin;
    const vm = valMin;
    if (h <= hueTol) {
        return [[[0, sm, vm], [h + hueTol, 255, 255]], [[180 - (hueTol - h), sm, vm], [180, 255, 255]]];
    }
    if (h >= 180 - hueTol) {
        return [[[h - hueTol, sm, vm], [180, 255, 255]], [[0, sm, vm], [hueTol - (180 - h), 255, 255]]];
    }
    return [[[h - hueTol, sm, vm], [h + hueTol, 255, 255]]];
}

function applyColorToDetector(detector, hex) {
    const [r, g, b] = hexToRgb(hex);
    const { h } = rgbToOpenCvHsv(r, g, b);
    detector.stroke = hex;
    detector.ranges = hsvRangesFromHue(h, calibration.satMin, calibration.valMin, calibration.hueTol);
}

function refreshDetectorRanges() {
    colorDetectors.forEach(det => applyColorToDetector(det, det.stroke));
    renderColorSlots();
}

function bindCalibrationSlider(inputId, key) {
    const input = document.getElementById(inputId);
    const output = document.getElementById(`${inputId}-val`);
    input.addEventListener("input", () => {
        calibration[key] = Number(input.value);
        output.textContent = input.value;
        refreshDetectorRanges();
    });
}

function setPickMode(detectorIndex, picking) {
    isPicking = picking;
    activePickingIndex = picking ? detectorIndex : null;
    canvas.classList.toggle("is-picking", picking);
    pickHintEl.hidden = !picking;
    renderColorSlots();
}

function renderColorSlots() {
    colorDetectors.forEach((det, index) => {
        const slotEl = document.getElementById(`color-slot-${index + 1}`);
        slotEl.innerHTML = "";
        const slot = document.createElement("div");
        slot.className = "color-slot";

        const picker = document.createElement("input");
        picker.type = "color";
        picker.value = det.stroke;
        picker.title = `${det.name} colore`;
        picker.addEventListener("input", () => applyColorToDetector(det, picker.value));

        const enableLabel = document.createElement("label");
        const enableCheck = document.createElement("input");
        enableCheck.type = "checkbox";
        enableCheck.checked = det.enabled;
        enableCheck.addEventListener("change", () => {
            det.enabled = enableCheck.checked;
        });
        enableLabel.append(enableCheck, document.createTextNode(` ${det.name}`));

        const actions = document.createElement("div");
        actions.className = "color-slot__actions";
        const sampleBtn = document.createElement("button");
        sampleBtn.type = "button";
        sampleBtn.textContent = (isPicking && activePickingIndex === index) ? "Annulla" : "Campiona";
        sampleBtn.addEventListener("click", () => setPickMode(index, !(isPicking && activePickingIndex === index)));

        actions.append(sampleBtn);
        slot.append(picker, enableLabel, actions);
        slotEl.append(slot);
    });
}

function initColorTool() {
    document.getElementById("detect-matrix").addEventListener("click", startMatrixDetection);
    bindCalibrationSlider("hue-tol", "hueTol");
    bindCalibrationSlider("sat-min", "satMin");
    bindCalibrationSlider("val-min", "valMin");
    renderColorSlots();

    canvas.addEventListener("click", (e) => {
        if (!isPicking || activePickingIndex === null) return;
        const rect = canvas.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
        const y = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));

        const pixel = ctx.getImageData(x, y, 1, 1).data;
        const hex = rgbToHex(pixel[0], pixel[1], pixel[2]);
        applyColorToDetector(colorDetectors[activePickingIndex], hex);
        setPickMode(activePickingIndex, false);
    });
}

function onOpenCvReady() {
    statusEl.textContent = "Pronto";
    statusEl.style.color = "#50ff50";
    initColorTool();

    navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
        .then(stream => {
            video.srcObject = stream;
            video.play();
            video.onloadeddata = () => processFrame();
        })
        .catch(err => console.error("Errore webcam:", err));
}

function buildMask(hsv, rangePairs) {
    let mask = null;
    for (const [lowArr, highArr] of rangePairs) {
        let low = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [...lowArr, 0]);
        let high = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [...highArr, 255]);
        let part = new cv.Mat();
        cv.inRange(hsv, low, high, part);
        low.delete(); high.delete();
        if (!mask) {
            mask = part;
        } else {
            let merged = new cv.Mat();
            cv.bitwise_or(mask, part, merged);
            mask.delete(); part.delete();
            mask = merged;
        }
    }
    return mask;
}

function sendToProcessing(message) {
    if (processingSocket && processingSocket.readyState === WebSocket.OPEN) {
        processingSocket.send(message);
    }
}

// Rettangolo del player normalizzato (0 = bordo della matrice, 1 = bordo opposto).
// Il margine extra della ROI non conta: un player fuori dalla matrice ha valori < 0 o > 1 in x.
function normalizzaSuMatrice(b) {
    const x = matrixArea.x + b.x;
    const y = matrixArea.y + b.y;
    return {
        left: (x - matrixRect.x) / matrixRect.width,
        top: (y - matrixRect.y) / matrixRect.height,
        right: (x + b.width - matrixRect.x) / matrixRect.width,
        bottom: (y + b.height - matrixRect.y) / matrixRect.height
    };
}

function sendPlayerToProcessing(playerBoxes) {
    playerBoxes.forEach((b, i) => {
        if (!b) { sendToProcessing(`P${i + 1}:`); return; }
        const n = normalizzaSuMatrice(b);
        sendToProcessing(`P${i + 1}:${n.left},${n.top},${n.right},${n.bottom}`);
    });
}

// Processing accende una cornice magenta sul bordo della matrice, poi la cerchiamo nel frame
function startMatrixDetection() {
    statusEl.textContent = "Rilevamento matrice...";
    sendToProcessing("C:1");
    setTimeout(() => { isMatrixDetectionPending = true; }, MATRIX_LIGHT_DELAY_MS);
}

// Tasto M: rileva la matrice anche a pannello chiuso (come il pulsante "Rileva matrice")
window.addEventListener("keydown", (e) => {
    if (e.key !== "m" && e.key !== "M") return;
    if (e.repeat || document.activeElement.tagName === "INPUT") return;
    if (isMatrixDetectionPending) return;                      // già in corso
    if (typeof cv === "undefined" || video.readyState < 2) return;   // OpenCV o webcam non pronti: niente cornice bloccata
    startMatrixDetection();
});

function detectMatrixArea(hsv) {
    const { hue, hueTol, satMin, valMin } = matrixFrameColor;
    let mask = buildMask(hsv, hsvRangesFromHue(hue, satMin, valMin, hueTol));
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();

    cv.GaussianBlur(mask, mask, new cv.Size(3, 3), 0);
    cv.threshold(mask, mask, 10, 255, cv.THRESH_BINARY);
    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let maxArea = 0;
    for (let i = 0; i < contours.size(); i++) {
        let contour = contours.get(i);
        let area = cv.contourArea(contour);
        if (area > 500 && area > maxArea) {
            maxArea = area;
            let rect = cv.boundingRect(contour);
            matrixRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };

            // Espande l'area del 5% su ogni lato
            let padX = rect.width * 0.05;
            let padY = rect.height * 0.05;
            matrixArea = {
                x: Math.max(0, rect.x - padX),
                y: Math.max(0, rect.y - padY),
                width: Math.min(canvas.width - Math.max(0, rect.x - padX), rect.width + (padX * 2)),
                height: Math.min(canvas.height - Math.max(0, rect.y - padY), rect.height + (padY * 2))
            };
        }
        contour.delete();
    }

    statusEl.textContent = maxArea > 0 ? "Matrice rilevata" : "Matrice non trovata";

    mask.delete(); contours.delete(); hierarchy.delete();
}

function processFrame() {
    if (video.paused || video.ended) return;

    try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        let src = cv.imread(canvas);
        let hsv = new cv.Mat();
        cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
        cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);

        if (isMatrixDetectionPending) {
            detectMatrixArea(hsv);
            isMatrixDetectionPending = false;
            sendToProcessing("C:0");
        }

        let playerBoxes = [null, null];
        let coordsTextArr = [];

        // Esegue il tracking solo se la matrice ha dimensioni valide
        if (matrixArea.width > 0 && matrixArea.height > 0) {
            colorDetectors.forEach((det, index) => {
                if (!det.enabled) return;

                let matrixHsv = hsv.roi(matrixArea);
                let mask = buildMask(matrixHsv, det.ranges);
                let contours = new cv.MatVector();
                let hierarchy = new cv.Mat();
                cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

                let maxArea = 0;
                let pBox = null;
                for (let i = 0; i < contours.size(); i++) {
                    let contour = contours.get(i);
                    let area = cv.contourArea(contour);
                    if (area > MIN_BLOB_AREA && area > maxArea) {
                        maxArea = area;
                        pBox = cv.boundingRect(contour);
                    }
                    contour.delete();
                }

                if (pBox) {
                    playerBoxes[index] = pBox;
                    coordsTextArr.push(`${det.name}: X:${pBox.x}, Y:${pBox.y}`);
                    ctx.strokeStyle = det.stroke;
                    ctx.lineWidth = 3;
                    ctx.strokeRect(matrixArea.x + pBox.x, matrixArea.y + pBox.y, pBox.width, pBox.height);
                }

                matrixHsv.delete();
                mask.delete();
                contours.delete();
                hierarchy.delete();
            });
        }

        coordsEl.textContent = coordsTextArr.length > 0 ? coordsTextArr.join(" | ") : "Nessun colore trovato";

        ctx.strokeStyle = "#50ff50";
        ctx.lineWidth = 2;
        ctx.strokeRect(matrixArea.x, matrixArea.y, matrixArea.width, matrixArea.height);

        sendPlayerToProcessing(playerBoxes);

        // Aggiorna la griglia con gli stessi valori normalizzati (0-1) mandati a Processing
        if (window.aggiornaGriglia) {
            window.aggiornaGriglia(playerBoxes.map(b => b && normalizzaSuMatrice(b)));
        }
        if (liveCtx) {
            const lato = Math.min(canvas.width, canvas.height);
            liveCtx.drawImage(canvas, (canvas.width - lato) / 2, (canvas.height - lato) / 2, lato, lato,
                0, 0, liveCanvas.width, liveCanvas.height);
        }
        src.delete();
        hsv.delete();
    } catch (err) {
        console.error("Errore nel processing frame:", err);
    }

    requestAnimationFrame(processFrame);
}