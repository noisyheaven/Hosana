// Dijalankan SETELAH "npx cap add android". Aman dijalankan berulang (idempoten).
// Menambahkan: izin kamera (scan barcode), izin HTTP ke server lokal, dan plugin cetak native.
const fs = require('fs'), path = require('path');
const root = process.env.ANDROID_DIR || path.join(__dirname, '..', 'android');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'capacitor.config.json'), 'utf8'));
const pkg = cfg.appId;
const main = path.join(root, 'app', 'src', 'main');
const log = (m) => console.log('[patch] ' + m);
if (!fs.existsSync(main)) { console.error('Folder android/ belum ada. Jalankan "npm run add" dulu.'); process.exit(1); }

// 1) AndroidManifest.xml
const mf = path.join(main, 'AndroidManifest.xml');
let x = fs.readFileSync(mf, 'utf8');
if (!x.includes('android.permission.CAMERA')) {
  const perms = '    <uses-permission android:name="android.permission.CAMERA" />\n    <uses-feature android:name="android.hardware.camera" android:required="false" />\n';
  x = /<uses-permission[^>]*INTERNET[^>]*\/>/.test(x) ? x.replace(/(<uses-permission[^>]*INTERNET[^>]*\/>\s*\n)/, '$1' + perms) : x.replace('</manifest>', perms + '</manifest>');
  log('izin kamera ditambahkan');
}
if (!x.includes('usesCleartextTraffic')) { x = x.replace(/<application\b/, '<application\n        android:usesCleartextTraffic="true"'); log('HTTP ke server lokal diizinkan'); }
fs.writeFileSync(mf, x);

// 2) Plugin cetak
const jdir = path.join(main, 'java', ...pkg.split('.'));
fs.mkdirSync(jdir, { recursive: true });
fs.writeFileSync(path.join(jdir, 'NativePrintPlugin.java'), fs.readFileSync(path.join(__dirname, '..', 'native', 'NativePrintPlugin.java'), 'utf8').replace('__APP_PACKAGE__', pkg));
log('plugin cetak ditulis: ' + path.relative(root, path.join(jdir, 'NativePrintPlugin.java')));

// 3) Daftarkan plugin di MainActivity
const ma = path.join(jdir, 'MainActivity.java');
if (!fs.existsSync(ma)) { console.error('MainActivity.java tidak ditemukan di ' + jdir); process.exit(1); }
let j = fs.readFileSync(ma, 'utf8');
if (!j.includes('NativePrintPlugin')) {
  j = `package ${pkg};\n\nimport android.os.Bundle;\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        registerPlugin(NativePrintPlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n}\n`;
  fs.writeFileSync(ma, j); log('MainActivity mendaftarkan plugin cetak');
}
log('selesai');
