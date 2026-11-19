// Rumus total penjualan kasir: diskon (Rp + %) dan PPN.
// Satu sumber kebenaran: dipakai server (require) DAN browser (<script>), sehingga angka di layar kasir
// selalu sama dengan yang dihitung & disimpan server.
(function (root) {
  const toInt = (x) => { const n = Math.floor(Number(x)); return Number.isFinite(n) && n > 0 ? n : 0; };

  // Pengaturan pajak dari tabel settings (nilai teks) -> objek rapi.
  function taxConfig(st = {}) {
    const enabled = String(st.tax_enabled) === '1';
    let rate = Number(String(st.tax_rate == null ? '11' : st.tax_rate).replace(',', '.'));
    if (!Number.isFinite(rate) || rate < 0) rate = 0;
    if (rate > 100) rate = 100;
    const mode = st.tax_mode === 'inclusive' ? 'inclusive' : 'exclusive';
    return { enabled: enabled && rate > 0, rate, mode, name: String(st.tax_name || 'PPN').trim() || 'PPN' };
  }

  // subtotal  : jumlah harga x qty (Rp, bilangan bulat)
  // discountRp: diskon rupiah    discountPct: diskon persen (0-100, boleh desimal)
  // Urutan: diskon persen dihitung dari subtotal, ditambah diskon rupiah (maks. sebesar subtotal),
  // lalu PPN dihitung dari nilai SETELAH diskon.
  //   exclusive : harga belum termasuk PPN -> total = setelah diskon + PPN
  //   inclusive : harga sudah termasuk PPN -> total = setelah diskon; PPN hanya dipisahkan untuk laporan
  function calcSale(subtotal, discountRp, discountPct, tax) {
    const sub = toInt(subtotal);
    let pct = Number(discountPct); if (!Number.isFinite(pct) || pct < 0) pct = 0; if (pct > 100) pct = 100;
    pct = Math.round(pct * 100) / 100;
    const rp = toInt(discountRp);
    const pctAmount = Math.round(sub * pct / 100);
    const discount = Math.min(sub, pctAmount + rp);
    const pctPart = Math.min(pctAmount, discount);   // bagian diskon yang berasal dari persen (setelah dibatasi)
    const base = sub - discount;                      // nilai setelah diskon
    const t = tax && tax.enabled ? tax : { enabled: false, rate: 0, mode: 'none' };
    let taxAmount = 0, total = base;
    if (t.enabled) {
      if (t.mode === 'inclusive') taxAmount = Math.round(base * t.rate / (100 + t.rate));
      else { taxAmount = Math.round(base * t.rate / 100); total = base + taxAmount; }
    }
    return {
      subtotal: sub, discount_rp: rp, discount_pct: pct, discount, discount_pct_amount: pctPart, discount_rp_amount: discount - pctPart,
      base, tax_rate: t.enabled ? t.rate : 0, tax_mode: t.enabled ? t.mode : 'none', tax_amount: taxAmount, total,
    };
  }

  const api = { taxConfig, calcSale };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HosanaCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
