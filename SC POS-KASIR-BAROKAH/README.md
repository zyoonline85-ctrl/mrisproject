# POS Kasir Barokah Flutter

Aplikasi kasir Barokah Group berbasis Flutter, tablet landscape first, memakai backend POS Barokah `DATA_MODE=mock` dan Provider.
APK dikunci ke orientasi landscape agar flow kasir selalu horizontal.

## Run dan Build
Flutter dan Java 21 sudah bisa dipakai untuk build debug APK.

```bash
cd /Users/muharis/Desktop/PRIVATE/POS-KASIR-BAROKAH
flutter create --project-name pos_kasir_barokah .
flutter pub get
flutter analyze
flutter test
flutter build apk --debug
```

Run dengan backend mock:

```bash
# Emulator Android
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000/api

# Device fisik, ganti IP dengan IP laptop yang menjalankan backend
flutter run --dart-define=API_BASE_URL=http://192.168.1.10:4000/api
```

Output APK debug ada di:

```text
build/app/outputs/flutter-apk/app-debug.apk
```

## Akun Demo
- kasir.pusat / demo123: multi-outlet, menampilkan halaman Pilih Outlet.
- kasir.cabang / demo123: single-outlet, langsung masuk Barokah Cabang 2.

## Flow Simulasi
1. Login sebagai kasir.
2. Pilih outlet jika tersedia.
3. Pilih produk dari katalog.
4. Pilih atau tambah customer jika ingin point loyalty bertambah.
5. Atur qty di cart.
6. Pilih Dine In + meja atau Takeaway.
7. Bayar memakai Cash, Transfer, atau QRIS.
8. Lihat preview struk.
9. Cek Riwayat, Pengeluaran, Laporan, dan Sync.

## Expense POS
Expense memakai nama pengeluaran operasional dari snapshot Admin. Kasir tidak membuat nama pengeluaran dari APK; nama dibuat/diaktifkan dari Admin lalu masuk APK lewat export catalog.

Input nominal Expense memakai format ribuan Indonesia. Contoh user mengetik `10000`, field tampil `10.000`, tetapi data tersimpan sebagai angka `10000`.

## Customer dan Point
Kasir bisa memilih customer existing atau menambahkan customer baru dari nama dan nomor HP. Customer bersifat per outlet.

Aturan point MVP:
- Setiap transaksi dengan customer mendapat `1 point per Rp 10.000`.
- Point dibulatkan ke bawah, contoh Rp25.000 menjadi 2 point.
- Point baru tampil di struk dan riwayat transaksi.
- Point belum bisa dipakai untuk redeem/potong pembayaran di MVP.

Customer dan point tetap dicatat lokal untuk respons cepat, lalu transaksi dikirim ke backend saat online/sync.

## Open Bill / Meja Terpakai
Flow dine-in mendukung order gantung mock:

1. Pilih `Dine In`, pilih meja, tambah item.
2. Tekan `Simpan Order`; cart kosong dan meja berubah `Terpakai`.
3. Ketuk meja `Terpakai`, lalu pilih `Lanjutkan Order`.
4. Tambah item lain, tekan `Update Order` untuk menyimpan perubahan.
5. Tekan `Bayar` untuk membuat transaksi dan meja kembali aktif.
6. Tekan `Batal Order` untuk membebaskan meja tanpa membuat transaksi.

Open bill tersimpan lokal di device dan ikut status pending sync. Saat backend online, open bill dikirim ke `/api/pos/open-bills` dan meja terpakai ikut terbaca lagi dari backend.

## End Game MVP Demo
APK ini dikunci sebagai **MVP Demo Client**. Tujuannya adalah menunjukkan flow kasir dari awal sampai akhir dengan backend mock sebelum backend production/MySQL diaktifkan.

Yang sudah masuk MVP:
- Login kasir dan outlet assignment.
- Login dan katalog produk dari backend mock.
- Cart, qty, meja Dine In, Takeaway, dan nomor order otomatis.
- Pilih/tambah customer dan loyalty point otomatis.
- Open bill mock: meja terpakai, lanjutkan order, update order, dan batal order.
- Pembayaran Cash, Transfer mock, dan QRIS mock.
- Preview struk dan print thermal Bluetooth.
- Tiga preview print satu printer: Customer Order Copy, Kitchen Order, dan Bill/Receipt.
- Menu Print di APK untuk setup printer Bluetooth, melihat status template dari Admin, dan test print thermal.
- Riwayat transaksi, pengeluaran POS, laporan POS, dan sync online + queue.
- Kategori pengeluaran dari Admin dan input nominal Expense format ribuan.
- Data demo awal untuk laporan/riwayat pada fresh install.

Yang sengaja ditunda setelah demo:
- Backend MySQL production.
- Printer LAN/USB dan multi-printer.
- QRIS dynamic/payment gateway real.
- Sync offline production yang lebih lengkap.
- Permission kasir granular production.
- Stock deduction real ke backend.

Checklist demo cepat:
1. Login `kasir.pusat / demo123`.
2. Pastikan halaman `Pilih Outlet` muncul, lalu pilih Barokah Pusat atau Barokah Cabang 2.
3. Tambah 2-3 produk ke cart.
4. Pilih customer existing atau tambah customer baru.
5. Pilih `Dine In` dan meja.
6. Tekan `Simpan Order`, pastikan meja jadi `Terpakai`.
7. Ketuk meja terpakai, tekan `Lanjutkan Order`, lalu bayar Cash dengan nominal lebih besar.
8. Pastikan struk menampilkan customer dan point.
9. Buat transaksi kedua pakai Transfer atau QRIS dan tekan `Tandai Lunas`.
10. Buka Admin `Pengaturan > Print`, matikan/aktifkan `Kitchen Order`, lalu sync APK setelah backend/mock catalog ikut berubah.
11. Buka struk, tekan `Print Thermal`.
12. Cek `Riwayat`, `Expense`, `Laporan`, lalu tekan `Sync`.

Untuk cek flow single-outlet, login `kasir.cabang / demo123`; app akan langsung masuk outlet cabang tanpa halaman pilih outlet.

## Backend Mock dan Sync
APK runtime membaca data dari backend:

```text
POST /api/auth/login
GET  /api/mobile/catalog
GET  /api/pos/history?outletId=...&from=...&to=...
GET  /api/pos/reports?outletId=...&from=...&to=...
GET  /api/pos/expenses?outletId=...&from=...&to=...
GET  /api/pos/customers?outletId=...&keyword=...
POST /api/pos/customers
GET  /api/pos/open-bills?outletId=...
POST /api/pos/transactions
POST /api/pos/open-bills
PUT  /api/pos/open-bills/:id
DELETE /api/pos/open-bills/:id
POST /api/pos/expenses
```

Backend mock berada di:

```text
/Users/muharis/Desktop/PRIVATE/POS-BACKEND-BAROKAH
```

Mode sync sekarang adalah **Online + Queue**:
- Login dan catalog wajib lewat backend saat online.
- Catalog terakhir disimpan sebagai cache agar layar tidak kosong jika backend sementara mati.
- History, laporan, list expense, customer, catalog, dan open bill dibaca dari backend.
- Transaksi, open bill, dan expense dicoba kirim ke backend.
- Jika koneksi gagal, data tetap tersimpan lokal dengan status pending.
- Tombol `Sync` mengirim pending data, refresh catalog, open bill, history, expense, dan laporan dari backend.

Asset `assets/mock/admin_catalog_snapshot.json` masih ada untuk referensi development, tetapi runtime utama tidak lagi membacanya sebagai fallback. First install butuh koneksi backend minimal sekali untuk login dan mengambil catalog/cache awal.

## Struktur Folder
```text
lib/
  data/          mock data dan repository sederhana
  models/        model data mudah dibaca
  providers/     state management Provider, termasuk open bill mock
  repositories/  pembaca catalog backend/cache
  screens/       halaman aplikasi
  theme/         warna dan theme
  utils/         formatter
  widgets/       widget reusable kecil
```

## Catatan Printer
V1 mendukung satu printer thermal Bluetooth ESC/POS, misalnya WOYA WP58D. Kertas tetap 58mm, tetapi layout dikunci ke area cetak efektif 48mm dengan lebar aman 30 karakter per baris:
- Pair printer dari Bluetooth Android terlebih dahulu.
- Buka menu `Print`, tekan `Refresh`, pilih printer, lalu tekan `Connect`.
- Gunakan `Test Customer`, `Test Kitchen`, atau `Test Bill` untuk cek kertas keluar.
- Preview di APK memakai layout monospaced yang sama dengan hasil thermal print, supaya yang terlihat di layar tidak berbeda dari kertas.

Jenis print yang tersedia:
- `Print Customer`: list menu tanpa harga untuk customer/order berjalan.
- `Print Kitchen`: satu list semua item order untuk dapur, tanpa station/routing.
- `Print Bill`: struk tagihan/pembayaran lengkap setelah transaksi lunas.

Menu `Print` di APK dipakai untuk memilih printer Bluetooth, aktif/nonaktif printer lokal, connect/disconnect, test print, dan melihat status template dari Admin.
Multi-printer, auto-print, routing kitchen/bar, printer LAN, dan printer USB masuk fase lanjut.
