// Bekannte Schulfächer mit typischen Kürzeln aus Stundenplänen (WebUntis, Papier, Excel …)
window.SUBJECTS = [
  { name: "Mathematik", short: "M", aliases: ["mathe", "mathematik", "ma", "mat", "math"] },
  { name: "Deutsch", short: "D", aliases: ["deutsch", "de", "deu"] },
  { name: "Englisch", short: "E", aliases: ["englisch", "en", "eng", "e5", "e6"] },
  { name: "Französisch", short: "F", aliases: ["französisch", "franzosisch", "franz", "fr", "frz", "f6"] },
  { name: "Spanisch", short: "S", aliases: ["spanisch", "spa", "spn"] },
  { name: "Latein", short: "L", aliases: ["latein", "la", "lat", "l6"] },
  { name: "Italienisch", short: "It", aliases: ["italienisch", "it", "ita"] },
  { name: "Russisch", short: "Ru", aliases: ["russisch", "ru"] },
  { name: "Türkisch", short: "Tü", aliases: ["türkisch", "tü", "tue"] },
  { name: "Griechisch", short: "Gr", aliases: ["griechisch", "grie"] },
  { name: "Biologie", short: "Bio", aliases: ["biologie", "bio", "bi"] },
  { name: "Chemie", short: "Ch", aliases: ["chemie", "ch", "che"] },
  { name: "Physik", short: "Ph", aliases: ["physik", "ph", "phy"] },
  { name: "Informatik", short: "If", aliases: ["informatik", "inf", "info", "if"] },
  { name: "Naturwissenschaften", short: "NW", aliases: ["naturwissenschaften", "nw", "nawi", "nwt"] },
  { name: "Technik", short: "Te", aliases: ["technik", "tec", "te"] },
  { name: "Geschichte", short: "Ge", aliases: ["geschichte", "ge", "gesch"] },
  { name: "Erdkunde", short: "Ek", aliases: ["erdkunde", "geographie", "geografie", "ek", "geo", "erd"] },
  { name: "Politik", short: "Po", aliases: ["politik", "po", "pol", "powi", "pw", "sowi", "sw", "sozialwissenschaften", "sozialkunde", "sk", "gemeinschaftskunde", "wp"] },
  { name: "Wirtschaft", short: "Wi", aliases: ["wirtschaft", "wi", "wirt", "wr", "wbs", "wl"] },
  { name: "Philosophie", short: "Pl", aliases: ["philosophie", "pl", "phil", "pp"] },
  { name: "Pädagogik", short: "Pa", aliases: ["pädagogik", "padagogik", "pa", "päd", "pad"] },
  { name: "Psychologie", short: "Psy", aliases: ["psychologie", "psy"] },
  { name: "Religion", short: "Re", aliases: ["religion", "rel", "re", "kr", "er", "ev", "kath", "rk", "ka", "isl"] },
  { name: "Ethik", short: "Eth", aliases: ["ethik", "eth", "et", "lo", "ler", "wun", "werte und normen"] },
  { name: "Kunst", short: "Ku", aliases: ["kunst", "ku", "bk", "bildende kunst"] },
  { name: "Musik", short: "Mu", aliases: ["musik", "mu", "mus"] },
  { name: "Darstellendes Spiel", short: "DS", aliases: ["darstellendes spiel", "ds", "theater"] },
  { name: "Sport", short: "Sp", aliases: ["sport", "sp", "spo", "sm"] },
  { name: "Literatur", short: "Lit", aliases: ["literatur", "lit"] },
];

// Durchsucht Text (OCR, PDF oder eingefügt) nach Fächern.
window.detectSubjects = function (text) {
  const clean = (text || "")
    .toLowerCase()
    .replace(/[|_*#\[\](){}.,;:!?"'„“\/\\+-]/g, " ")
    .replace(/\s+/g, " ");
  const tokens = new Set(clean.split(" ").filter(Boolean));
  // Kurskennungen wie "m-lk1", "d gk2", "ph2" -> Basis-Kürzel ohne Ziffern
  for (const t of [...tokens]) {
    const base = t.replace(/\d+$/, "").replace(/^(lk|gk)/, "");
    if (base && base !== t) tokens.add(base);
  }
  const counts = new Map();
  for (const s of window.SUBJECTS) {
    let hits = 0;
    for (const a of s.aliases) {
      if (a.includes(" ")) {
        if (clean.includes(a)) hits += 2;
      } else if (a.length >= 4) {
        // Lange Namen: auch als Teil eines Wortes (OCR klebt oft Wörter zusammen)
        if (clean.includes(a)) hits += 2;
      } else if (tokens.has(a)) {
        hits += 1;
      }
    }
    // Ein-Buchstaben-Kürzel (M, D, E …) nur als ganzes Wort
    if (s.short.length === 1 && tokens.has(s.short.toLowerCase())) hits += 1;
    if (hits) counts.set(s.name, hits);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, hits]) => ({ name, hits }));
};
