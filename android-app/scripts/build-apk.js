// Membuat APK debug lewat Gradle (butuh Android SDK + JDK; paling mudah: pasang Android Studio sekali).
const { spawnSync } = require('child_process'); const path = require('path'), fs = require('fs');
const dir = path.join(__dirname, '..', 'android');
if (!fs.existsSync(dir)) { console.error('Jalankan "npm run add" dulu.'); process.exit(1); }
const win = process.platform === 'win32';
const r = spawnSync(win ? 'gradlew.bat' : './gradlew', ['assembleDebug'], { cwd: dir, stdio: 'inherit', shell: win });
if (r.status !== 0) { console.error('\nBuild gagal. Jika pesan error menyebut SDK/JDK, buka proyek dengan "npm run open" (Android Studio akan menyiapkannya) lalu Build > Build APK(s).'); process.exit(r.status || 1); }
console.log('\nAPK siap: android/app/build/outputs/apk/debug/app-debug.apk');
