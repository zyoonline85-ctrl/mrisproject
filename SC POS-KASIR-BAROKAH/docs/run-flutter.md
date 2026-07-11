# Run Flutter POS Kasir Barokah

Panduan command untuk menjalankan APK kasir dari repo `POS-KASIR-BAROKAH`.

## 1. Masuk ke folder kasir

```bash
cd /Users/muharis/Desktop/PRIVATE/POS-KASIR-BAROKAH
```

## 2. Install dependency

```bash
flutter pub get
```

## 3. Cek device yang tersedia

```bash
flutter devices
```

## 4. Jalankan backend dulu

Di terminal lain, jalankan backend POS:

```bash
cd /Users/muharis/Desktop/PRIVATE/POS-BACKEND-BAROKAH
npm run dev
```

Pastikan backend hidup di:

```text
http://localhost:4000/api
```

## 5. Run Flutter

> Simulasi penjualan sekarang **online wajib**. Saat tombol bayar ditekan,
> transaksi baru dianggap sukses hanya kalau APK berhasil mengirim data ke
> backend dan backend menyimpan ke JSON. Kalau URL/IP salah atau backend mati,
> checkout akan gagal dengan pesan error dan tidak membuat transaksi pending baru.

### Android Emulator

Pakai `10.0.2.2` karena dari emulator Android, `localhost` berarti emulator itu sendiri.

```bash
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000/api
```

### Device Android fisik

Ganti IP dengan IP laptop di jaringan WiFi yang sama.

```bash
flutter run --dart-define=API_BASE_URL=http://192.168.1.10:4000/api
```

Cara cek IP Mac:

```bash
ipconfig getifaddr en0
```

Contoh jika IP Mac `192.168.1.25`:

```bash
flutter run --dart-define=API_BASE_URL=http://192.168.18.40:4000/api
ipconfig getifaddr en0
```

Setelah APK terbuka, tekan tombol **Backend** di top bar untuk melihat
`API_BASE_URL`, cek koneksi `/api/health`, dan membersihkan pending transaksi
penjualan lama jika ada.

### Pilih device tertentu

Kalau `flutter devices` menampilkan banyak device:

```bash
flutter run -d DEVICE_ID --dart-define=API_BASE_URL=http://10.0.2.2:4000/api
```

## 6. Command cek kualitas

```bash
flutter analyze
```

```bash
flutter test
```

## 7. Build APK

Debug APK:

```bash
flutter build apk --debug --dart-define=API_BASE_URL=http://10.0.2.2:4000/api
```

Release APK:

```bash
flutter build apk --release --dart-define=API_BASE_URL=http://192.168.1.25:4000/api
```

Release APK untuk remote backend production:

```bash
flutter build apk --release \
  --dart-define=API_BASE_URL=https://pos-api.barokahgroupindonesia.com/api \
  --dart-define=SHOW_DEMO_HINTS=false
```

Build per ABI agar file APK lebih kecil:

```bash
flutter build apk --release --split-per-abi \
  --dart-define=API_BASE_URL=https://pos-api.barokahgroupindonesia.com/api \
  --dart-define=SHOW_DEMO_HINTS=false
```

Catatan signing: konfigurasi Android saat ini masih memakai debug signing untuk
release build. APK ini cukup untuk install/test production internal. Untuk rilis
Play Store atau distribusi resmi, siapkan keystore release dulu di
`android/app/build.gradle`.

Output APK biasanya ada di:

```text
build/app/outputs/flutter-apk/
```

Upload APK production ke repo F-Droid server:

```bash
scp -P 22022 /Users/muharis/Desktop/PRIVATE/POS-KASIR-BAROKAH/build/app/outputs/flutter-apk/pos-kasir-prod-v1.8.0.apk root@104.207.76.159:~/fdroid/repo/
```

## Quick Script

Android emulator:

```bash
cd /Users/muharis/Desktop/PRIVATE/POS-KASIR-BAROKAH
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000/api
```

Android fisik:

```bash
cd /Users/muharis/Desktop/PRIVATE/POS-KASIR-BAROKAH
MAC_IP=$(ipconfig getifaddr en0)
flutter pub get
flutter run --dart-define=API_BASE_URL=http://$MAC_IP:4000/api
```

## Troubleshooting Simulasi Penjualan

- Jika checkout gagal `Tidak bisa terhubung ke backend`, pastikan backend jalan
  dengan `npm run dev` dan `API_BASE_URL` memakai IP yang bisa dijangkau device.
- Untuk Android emulator gunakan `http://10.0.2.2:4000/api`.
- Untuk HP fisik gunakan IP Mac dari `ipconfig getifaddr en0`, bukan `localhost`.
- Di APK buka tombol **Backend** lalu klik **Cek Backend**. Status harus
  menampilkan `Backend OK` sebelum melakukan simulasi penjualan.
- Laporan penjualan memakai `Total belanja`, bukan uang yang dibayar. Contoh:
  belanja Rp 25.000 dibayar Rp 50.000 tetap masuk omzet Rp 25.000, kembalian
  Rp 25.000.
