// Seleziona gli elementi HTML
const testo = document.getElementById('text-alfabeto'); // O #text-grande / #text-piccolo
const sliderWght = document.getElementById('slider-wght');
const sliderRota = document.getElementById('slider-rota');
const sliderSize = document.getElementById('slider-size');

// Funzione che aggiorna la font variabile
function aggiornaFont() {
  const wght = sliderWght.value;
  const rota = sliderRota.value;
  const size = sliderSize.value;

  // Applica le nuove impostazioni CSS al testo
  testo.style.fontVariationSettings = `'wght' ${wght}, 'ROTA' ${rota}, 'SIZE' ${size}`;
}

// Ascolta gli eventi di scorrimento degli slider
sliderWght.addEventListener('input', aggiornaFont);
sliderRota.addEventListener('input', aggiornaFont);
sliderSize.addEventListener('input', aggiornaFont);

// Esempio: Sposta la bacchetta rossa all'80% d'altezza
//document.querySelector('.rosso').style.setProperty('--pos-y', '80%');
