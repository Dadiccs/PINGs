// Seleziona gli elementi HTML (con controllo: la pagina puo' non avere gli slider)
const testo = document.getElementById('text-alfabeto');
const sliderWght = document.getElementById('slider-wght');
const sliderRota = document.getElementById('slider-rota');
const sliderSize = document.getElementById('slider-size');

function aggiornaFont() {
  if (!testo) return;
  testo.style.fontVariationSettings =
    `'wght' ${sliderWght.value}, 'ROTA' ${sliderRota.value}, 'SIZE' ${sliderSize.value}`;
}

// Collega gli slider solo se esistono (evita errori in console)
if (sliderWght && sliderRota && sliderSize) {
  sliderWght.addEventListener('input', aggiornaFont);
  sliderRota.addEventListener('input', aggiornaFont);
  sliderSize.addEventListener('input', aggiornaFont);
}
