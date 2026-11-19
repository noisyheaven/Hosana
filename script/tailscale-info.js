// Membaca status Tailscale di komputer server dan mencetak pengaturan yang perlu disalin ke config.env.
// Jalankan: npm run tailscale   (butuh Tailscale terpasang & sudah login di komputer ini)
const { execFile } = require('child_process'); const fs = require('fs');

function parse(json) {
  const st = typeof json === 'string' ? JSON.parse(json) : json;
  const self = st.Self || {};
  const dns = String(self.DNSName || '').replace(/\.$/, '');
  const ips = (self.TailscaleIPs || []).filter((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x));
  const certOk = Array.isArray(st.CertDomains) && st.CertDomains.includes(dns);
  return { state: st.BackendState || '', dns, ips, certOk, tailnet: (st.CurrentTailnet && st.CurrentTailnet.Name) || '' };
}

function advice(r, port = 3000) {
  const L = [];
  if (r.state && r.state !== 'Running') L.push(`! Status Tailscale: ${r.state}. Buka aplikasi Tailscale dan login dulu.`);
  if (r.ips[0]) L.push(`Alamat Tailscale (tanpa HTTPS, kamera HP TIDAK aktif):\n  http://${r.ips[0]}:${port}/admin/`);
  if (r.dns && r.certOk) {
    L.push(`Alamat nama dengan HTTPS (kamera HP aktif), setelah langkah di bawah:\n  https://${r.dns}/admin/`);
    L.push(`1) Di komputer server jalankan (PowerShell/Terminal sebagai administrator):\n  tailscale serve --bg ${port}\n   (cek "tailscale serve --help" bila perintahnya ditolak: sintaksnya berbeda antar versi)`);
    L.push(`2) Tambahkan baris ini ke config.env, lalu jalankan ulang server:\n  TRUST_PROXY=1\n  PUBLIC_HOST=${r.dns}`);
  } else if (r.dns) {
    L.push('HTTPS belum aktif di akun Tailscale Anda. Di https://login.tailscale.com/admin/dns aktifkan MagicDNS, lalu "Enable HTTPS" di bagian HTTPS Certificates, kemudian jalankan perintah ini lagi.');
    L.push(`Nama komputer ini di Tailscale: ${r.dns}`);
  }
  return L.join('\n\n');
}
module.exports = { parse, advice };

if (require.main === module) {
  const win = 'C:\\Program Files\\Tailscale\\tailscale.exe';
  const bin = process.platform === 'win32' && fs.existsSync(win) ? win : 'tailscale';
  execFile(bin, ['status', '--json'], { timeout: 15000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
    if (err) { console.error('Tidak bisa menjalankan "tailscale". Pastikan Tailscale terpasang di komputer ini dan sudah login.\n' + (err.code === 'ENOENT' ? '' : err.message)); process.exit(1); }
    try { console.log('\n' + advice(parse(out), parseInt(process.env.PORT || '3000', 10)) + '\n'); } catch (e) { console.error('Keluaran Tailscale tidak dikenali: ' + e.message); process.exit(1); }
  });
}
