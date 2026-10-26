/* Pembuat barcode (EAN-13 & Code128) -> SVG. Tanpa dependensi. */
(function (root) {
  // ---------- EAN-13 ----------
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
  const R = L.map((s) => s.replace(/./g, (c) => (c === '1' ? '0' : '1')));
  const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

  function ean13Check(d12) { let s = 0; for (let i = 0; i < 12; i++) s += +d12[i] * (i % 2 ? 3 : 1); return (10 - (s % 10)) % 10; }
  function isEan13(code) { return /^\d{13}$/.test(code) && ean13Check(code.slice(0, 12)) === +code[12]; }

  function ean13Modules(code) {
    const d = code.split('').map(Number);
    const par = PARITY[d[0]];
    let bits = '101';
    for (let i = 0; i < 6; i++) bits += (par[i] === 'L' ? L : G)[d[i + 1]];
    bits += '01010';
    for (let i = 0; i < 6; i++) bits += R[d[i + 7]];
    bits += '101';
    return bits;
  }

  // ---------- Code128 (set B) ----------
  const P = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];

  function code128Symbols(text) {
    const vals = [104]; // Start B
    for (const ch of text) {
      const c = ch.charCodeAt(0);
      if (c < 32 || c > 126) throw new Error('Karakter tidak didukung Code128: ' + ch);
      vals.push(c - 32);
    }
    let sum = vals[0];
    for (let i = 1; i < vals.length; i++) sum += vals[i] * i;
    vals.push(sum % 103, 106); // checksum + stop
    return vals;
  }
  function code128Modules(text) {
    let bits = '', bar = true;
    for (const v of code128Symbols(text)) {
      for (const w of P[v]) { bits += (bar ? '1' : '0').repeat(+w); bar = !bar; }
      bar = true;
    }
    return bits;
  }

  // ---------- SVG ----------
  function modulesFor(code) {
    code = String(code);
    if (isEan13(code)) return { bits: ean13Modules(code), kind: 'ean13' };
    return { bits: code128Modules(code), kind: 'code128' };
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // svg(code, {height: tinggi batang (px), mw: lebar modul (px), text: tampilkan angka})
  function svg(code, opt = {}) {
    const { height = 46, mw = 2, text = true } = opt;
    const { bits, kind } = modulesFor(code);
    const quiet = 10;
    const W = (bits.length + quiet * 2) * mw;
    const fs = 11;
    const H = height + (text ? fs + 6 : 0);
    let rects = '';
    for (let i = 0; i < bits.length;) {
      if (bits[i] === '1') { let j = i; while (j < bits.length && bits[j] === '1') j++; rects += `<rect x="${(quiet + i) * mw}" y="0" width="${(j - i) * mw}" height="${height}"/>`; i = j; } else i++;
    }
    const t = text ? `<text x="${W / 2}" y="${height + fs + 2}" font-size="${fs}" text-anchor="middle" font-family="monospace" fill="#000">${esc(code)}</text>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges"><rect width="${W}" height="${H}" fill="#fff"/><g fill="#000">${rects}</g>${t}</svg>`;
  }

  const api = { svg, modulesFor, ean13Check, isEan13, P, code128Symbols, code128Modules, ean13Modules };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Barcode = api;
})(typeof window !== 'undefined' ? window : globalThis);
