# Workspace Rules — POS Barokah Group

## Isolation Constraint
* **CRITICAL**: Semua pengerjaan, modifikasi kode, interaksi database, dan konfigurasi server hanya boleh ditargetkan pada domain baru: **`barokahgroupindonesia.tech`** dan database baru: **`pos_barokah_prod`**.
* **ISOLASI MUTLAK**: Jangan pernah menyentuh, mengubah, atau menghubungkan sistem baru ke domain lama (**`barokahgroupindonesia.com`**) maupun database lamanya (**`pos_barokah`**). Domain lama dan database lamanya harus tetap berjalan secara mandiri dan tidak boleh terganggu oleh pembaruan apa pun di sistem baru.
