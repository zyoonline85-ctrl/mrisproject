# PRD Mobile POS Kasir Barokah Group

## 1. Ringkasan
Aplikasi Mobile POS Kasir Barokah adalah aplikasi kasir berbasis Flutter untuk operasional outlet. Target utama adalah tablet horizontal agar proses transaksi cepat: katalog produk berada di kiri dan cart/payment berada di kanan.

Aplikasi ini adalah MVP demo dengan backend POS Barokah `DATA_MODE=mock`. Data produk, user, outlet, meja, customer, template print, transaksi, open bill, dan pengeluaran melewati API backend dulu; data lokal dipakai sebagai cache/queue saat koneksi gagal.

Target akhir v1 dikunci sebagai **Demo Client MVP**. Setelah flow demo kasir berjalan stabil, pekerjaan tidak dilanjutkan dengan penambahan fitur APK baru sampai client menyetujui fase backend/API production.

## 2. Tujuan Produk
- Kasir bisa login dan hanya melihat outlet yang diberikan.
- Kasir bisa membuat transaksi penjualan dengan cepat.
- Kasir bisa memilih meja atau takeaway.
- Kasir bisa menyimpan open bill mock untuk meja dine-in.
- Kasir bisa memilih atau menambahkan customer untuk transaksi.
- Point customer otomatis bertambah dari nominal transaksi.
- Kasir bisa menerima pembayaran cash, transfer manual, dan QRIS.
- Kasir bisa melihat preview print customer, kitchen, dan bill, lalu mencetak ke printer thermal Bluetooth.
- Kasir bisa melihat riwayat transaksi dan laporan POS harian/rentang tanggal.
- Kasir bisa input pengeluaran POS.
- Kasir memilih nama pengeluaran operasional dari master Admin, bukan input bebas.
- Aplikasi menampilkan status pending/sync untuk simulasi online + queue.

## 3. Target User
- Kasir outlet Barokah Pusat.
- Kasir outlet Barokah Cabang 2.
- Owner/Admin sebagai reviewer flow POS.

## 4. Platform dan Orientasi
- Framework: Flutter.
- Target output: Android APK.
- Design utama: tablet landscape first.
- Orientasi APK dikunci landscape; portrait tidak dipakai untuk MVP kasir tablet.

## 5. Design System
Mengikuti Admin POS Barokah agar pengalaman visual konsisten.

| Token | Warna | Penggunaan |
| --- | --- | --- |
| Primary teal | #35858E | Primary action, active nav, tombol bayar |
| Secondary green | #7DA78C | Success, synced, status paid |
| Soft lime | #C2D099 | Highlight ringan |
| Pale background | #E6EEC9 | Selected row, aksen ringan |
| App background | #E8EDF2 | Background utama |
| Dark text/sidebar | #2C3947 | Text utama, app bar/sidebar |
| Muted blue | #547A95 | Info, secondary navigation |
| Accent gold | #C2A56D | Warning, cash/accent revenue |

Typography:
- Font utama mengikuti konsep Inter/admin, fallback system font.
- Default body: 12-14px.
- Section title: 15-16px.
- Page title: 18-22px.

Komponen:
- Radius card/button maksimal 8px.
- UI operasional, bukan landing page.
- Product grid dense dan mudah discan.
- Cart panel selalu terlihat di tablet landscape.

## 6. Fitur MVP

### 6.1 Login Kasir
- Input username dan password demo.
- User inactive ditolak.
- Role kasir diarahkan ke outlet assignment.
- Akun demo: kasir.pusat/demo123 untuk multi-outlet dan kasir.cabang/demo123 untuk single-outlet.

### 6.2 Pilih Outlet
- Outlet difilter berdasarkan outletIds user.
- Produk dan harga mengikuti outlet terpilih.
- Order number memakai kode outlet.

### 6.3 POS / Kasir
- Katalog produk per kategori.
- Search produk.
- Product card menampilkan nama, SKU, kategori, harga outlet.
- Add to cart, tambah/kurang qty, hapus item, clear cart.
- Pilih customer existing atau tambah customer baru dari nama dan nomor HP.
- Customer bersifat opsional; transaksi tanpa customer tetap bisa diproses.
- Pilih service type: Dine In atau Takeaway.
- Jika Dine In, meja wajib dipilih.
- Nomor order auto generate: KODEOUTLET-YYYYMMDD-001.
- Open bill mock: Simpan Order membuat meja `Terpakai`, Lanjutkan Order memuat cart lama, Bayar/Batal Order membuat meja aktif lagi.
- Open bill menyimpan customer yang dipilih supaya order gantung tetap membawa data customer saat dilanjutkan.

### 6.4 Customer dan Loyalty Point
- Customer difilter berdasarkan outlet aktif.
- Kasir bisa search customer berdasarkan nama atau nomor HP.
- Kasir bisa tambah customer baru dengan nama dan nomor HP.
- Nomor HP wajib unik per outlet; bila nomor sudah ada, customer existing dipakai.
- Point otomatis bertambah setelah pembayaran sukses.
- Rumus MVP: `1 point per Rp 10.000`, dibulatkan ke bawah.
- Point tampil di cart customer, receipt preview, dan riwayat transaksi.
- Redeem point belum masuk MVP.

### 6.5 Payment
- Metode: Cash, Transfer/manual payment, QRIS.
- Transaksi penjualan takeaway dan dine-in selalu memakai tanggal serta waktu checkout saat ini; kasir tidak dapat memilih tanggal transaksi secara manual.
- Cash punya input amount paid dan menghitung kembalian.
- Pembayaran cash menyediakan shortcut `Uang Pas`, `+Rp10rb`, `+Rp20rb`, `+Rp50rb`, `+Rp100rb`, dan `Reset` pada flow takeaway maupun dine-in.
- Transfer dan QRIS dianggap paid di mock setelah konfirmasi.
- Setelah bayar, transaksi masuk riwayat dan cart kosong.
- Bill/Receipt preview muncul setelah transaksi sukses.
- Jika pembayaran berasal dari open bill, nomor order open bill dipakai sebagai nomor transaksi.

### 6.6 Print Preview / Printer Thermal
- Customer Order Copy menampilkan outlet, nomor order, meja/service, dan list menu tanpa harga.
- Kitchen Order menampilkan satu list semua item order untuk dapur, tanpa station/routing.
- Bill/Receipt menampilkan outlet, nomor order, kasir, meja/service, customer, point earned, item, total, payment, kembalian.
- Menu Print di APK mengatur printer thermal Bluetooth 58mm, status aktif/nonaktif lokal, connect/disconnect, test print, dan menampilkan status template dari Admin.
- Layout print memakai area cetak efektif 48mm dengan lebar aman 30 karakter per baris.
- Preview struk memakai layout monospaced yang sama dengan hasil thermal print.
- Setup printer fisik lokal tersimpan di device dan tidak hilang saat sync catalog.
- Template Customer/Kitchen/Bill dikontrol dari Admin dan tidak bisa diubah dari APK.
- Tombol print mengirim ESC/POS bytes ke printer Bluetooth yang dipilih.
- Untuk dine-in/open bill, Customer dan Kitchen memiliki checkpoint terpisah. Cetakan berikutnya hanya berisi `TAMBAHAN ORDER` atau tiket `KOREKSI / BATAL`; order tanpa perubahan menawarkan `REPRINT` penuh tanpa menggeser checkpoint.
- Checkpoint baru disimpan setelah printer sukses. Menutup preview atau kegagalan printer tidak menandai item sebagai tercetak. Takeaway tetap mencetak seluruh cart.

### 6.7 Riwayat Transaksi
- List transaksi berdasarkan outlet aktif.
- Filter metode pembayaran.
- Customer transaksi ditampilkan bila ada.
- Detail transaksi bisa dibuka dengan receipt preview.

### 6.8 Pengeluaran POS
- Pilih nama pengeluaran operasional dari catalog backend.
- Input nominal memakai format ribuan Indonesia saat mengetik.
- Tanggal memakai waktu input saat ini di MVP.
- Input catatan.
- Data dicoba sync ke backend; jika gagal tetap antre lokal sebagai pending.
- List pengeluaran per outlet.

### 6.9 Laporan Penjualan POS
- Ringkasan omzet, jumlah transaksi, cash/transfer/QRIS, pengeluaran, dan net sederhana.

### 6.10 Online + Queue Backend Mock
- Login memakai `POST /api/auth/login`.
- Catalog memakai `GET /api/mobile/catalog`.
- Transaksi baru dikirim ke `POST /api/pos/transactions`; bila gagal diberi status pendingSync.
- Expense baru dikirim ke `POST /api/pos/expenses`; bila gagal diberi status pendingSync.
- Open bill memakai `GET/POST/PUT/DELETE /api/pos/open-bills`; bila gagal perubahan tetap antre lokal.
- Tombol Sync mengirim pending transaksi/expense/open bill, refresh catalog, dan refresh open bill outlet aktif.
- Sync tidak menghapus open bill; open bill hilang hanya setelah bayar atau batal order.
- Setup printer Bluetooth tetap lokal di device.

### 6.11 End Game MVP
- APK harus bisa didemokan dari login sampai laporan tanpa crash.
- Fresh install memiliki data demo awal untuk riwayat, pengeluaran, dan laporan.
- Transfer dan QRIS bersifat mock dengan konfirmasi "Tandai Lunas".
- Print thermal Bluetooth 58mm dengan area cetak efektif 48mm berjalan untuk Customer, Kitchen, dan Bill.
- Meja terpakai/open bill mock bisa disimpan, dilanjutkan, dibayar, atau dibatalkan.
- Customer bisa ditambah/dipilih dan point otomatis bertambah setelah bayar.
- Setelah checklist demo lolos, APK dinyatakan MVP done.

## 7. Data Backend Mock
Sumber data utama runtime adalah backend `/Users/muharis/Desktop/PRIVATE/POS-BACKEND-BAROKAH` dengan `DATA_MODE=mock`: 2 outlet, kasir, kategori, produk, harga per outlet, meja, customer, nama pengeluaran operasional, template print, transaksi, open bill, history, laporan, dan expense.
Catalog/history/expense/report terakhir disimpan sebagai cache lokal agar layar tetap bisa dibuka saat backend sementara mati.
Asset snapshot lokal hanya referensi development, bukan fallback runtime. First install butuh koneksi backend minimal sekali untuk login dan mengambil catalog/cache awal.

## 8. State Management
Menggunakan Provider: AuthProvider, OutletProvider, CatalogProvider, CartProvider, TransactionProvider, ExpenseProvider, OpenBillProvider, PosReportProvider, dan SyncProvider. AuthProvider menyimpan JWT lokal, CatalogProvider mengambil catalog/customer backend/cache, Transaction/Expense/Report membaca backend/cache, sedangkan Transaction/OpenBill/Expense provider mengelola queue pending.

## 9. Non-Scope V1
- Backend MySQL production.
- Printer LAN/USB real.
- Auto-print production ke perangkat printer fisik.
- Multi-printer dan routing kitchen/bar production.
- QRIS dynamic real.
- Redeem point / potong pembayaran dari point.
- Membuat nama pengeluaran operasional dari APK; nama ini hanya dikelola dari Admin.
- Sinkronisasi offline production yang lebih lengkap.
- Stock deduction final berbasis backend production.
- Penambahan modul besar baru di APK sebelum demo client.

## 10. Test Plan
- flutter pub get.
- flutter analyze.
- flutter test.
- flutter build apk --debug.
- Manual flow: login, pilih outlet, pilih/tambah customer, transaksi, payment, receipt, history, expense, report, sync.
- Demo acceptance: transaksi cash menghitung kembalian, transfer/QRIS butuh konfirmasi mock, receipt bisa preview + print thermal, riwayat/laporan berubah, sync tidak menghapus data lokal.
- Open bill acceptance: Simpan Order membuat meja terpakai, Lanjutkan Order memuat item lama, Bayar/Batal Order membuat meja aktif lagi.
- Customer acceptance: tambah customer nama + nomor HP, pilih customer, bayar Rp25.000 menghasilkan 2 point, point tampil di struk, dan Sync tidak menghapus point.
- Expense acceptance: dropdown kategori berasal dari snapshot Admin, input nominal `10000` tampil `10.000`, dan riwayat menyimpan nominal sebagai angka.
- Print acceptance: preview Customer, Kitchen, dan Bill sama urutan/isi dengan hasil thermal print 48mm efektif, tanpa teks kepotong atau turun aneh.
- Delta print acceptance: tambahan, pengurangan, varian, checkpoint Customer/Kitchen, printer gagal, dan reprint tanpa delta berjalan independen sesuai open bill.
- Cash shortcut acceptance: pecahan menambah nominal aktif, `Uang Pas` mengikuti total transaksi, dan `Reset` kembali ke nol untuk takeaway maupun dine-in.

## 11. Catatan Environment
Saat PRD dibuat, Flutter CLI belum tersedia di PATH lokal. Setelah Flutter SDK tersedia, jalankan flutter create --project-name pos_kasir_barokah . di root project bila folder Android/iOS belum ada, lalu lanjut flutter pub get dan build APK.
# Permission Role APK

- Menu APK mengikuti permission `apk.*` dari role user, bukan nama atau ID role tertentu.
- Role dapat dipakai bersama Admin Web jika role yang sama juga memiliki permission Admin.
- `view` mengatur kemunculan menu, sedangkan action seperti `create`, `update`, `cancel`, `print`, dan `export` mengatur tombol di dalam menu.
- Permission diperbarui saat login, restore session, aplikasi kembali aktif, dan Sync. Backend tetap memvalidasi setiap endpoint.
