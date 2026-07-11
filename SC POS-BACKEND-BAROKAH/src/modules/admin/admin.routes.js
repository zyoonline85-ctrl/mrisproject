const express = require("express");
const fs = require("fs");
const nodePath = require("path");
const multer = require("multer");
const asyncHandler = require("../../utils/async-handler");
const { requireAuth } = require("../../middlewares/auth");
const { can, requirePermission } = require("../../middlewares/permission");
const dataService = require("../../services/data-service");
const masterImportService = require("../../services/master-import-service");
const { forbidden, HttpError, validationError } = require("../../utils/http-error");

const router = express.Router();
const productUploadDir = nodePath.resolve(process.cwd(), "uploads/products");
const allowedProductImageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedProductImageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

fs.mkdirSync(productUploadDir, { recursive: true });

const productImageUpload = multer({
  storage: multer.diskStorage({
    destination: productUploadDir,
    filename(req, file, callback) {
      const extension = nodePath.extname(file.originalname || "").toLowerCase();
      callback(null, `${req.params.id}-${Date.now()}${extension}`);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    const extension = nodePath.extname(file.originalname || "").toLowerCase();
    if (allowedProductImageMimeTypes.has(file.mimetype) && allowedProductImageExtensions.has(extension)) {
      callback(null, true);
      return;
    }
    callback(new HttpError(422, "Format gambar produk harus JPG, PNG, atau WEBP."));
  }
});

const masterImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    const extension = nodePath.extname(file.originalname || "").toLowerCase();
    const allowedMimeTypes = new Set([
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/octet-stream",
      "application/zip"
    ]);
    if (extension === ".xlsx" && allowedMimeTypes.has(file.mimetype)) {
      callback(null, true);
      return;
    }
    callback(new HttpError(422, "File import wajib format XLSX."));
  }
});

function runProductImageUpload(req, res) {
  return new Promise((resolve, reject) => {
    productImageUpload.single("image")(req, res, (error) => {
      if (error) {
        if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
          reject(new HttpError(422, "Ukuran gambar produk maksimal 2MB."));
          return;
        }
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function runMasterImportUpload(req, res) {
  return new Promise((resolve, reject) => {
    masterImportUpload.single("file")(req, res, (error) => {
      if (error) {
        if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
          reject(new HttpError(422, "Ukuran file import maksimal 6MB."));
          return;
        }
        reject(error);
        return;
      }
      resolve();
    });
  });
}

/**
 * @swagger
 * tags:
 *   - name: Admin Mutation
 *     description: Mutation Admin untuk DATA_MODE=mock dan nantinya DATA_MODE=mysql
 *
 * /api/admin/tables:
 *   post:
 *     summary: Tambah meja outlet
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [outlet_id, number, status]
 *     responses:
 *       200:
 *         description: Meja berhasil dibuat
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Validasi mock gagal
 *
 * /api/admin/tables/generate:
 *   post:
 *     summary: Generate beberapa meja outlet berdasarkan jumlah
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [outlet_id, quantity, status]
 *             properties:
 *               outlet_id:
 *                 type: string
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 100
 *               status:
 *                 type: string
 *                 enum: [active, inactive]
 *     responses:
 *       200:
 *         description: Meja berhasil digenerate
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Validasi generate meja gagal
 *
 * /api/admin/tables/{id}:
 *   get:
 *     summary: Detail meja outlet
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Detail meja berhasil dimuat
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Meja tidak ditemukan
 *       500:
 *         description: Terjadi kesalahan server
 *   put:
 *     summary: Edit meja outlet
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Meja berhasil diperbarui
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Validasi meja gagal
 *       500:
 *         description: Terjadi kesalahan server
 *
 * /api/admin/tables/{id}/toggle-status:
 *   patch:
 *     summary: Aktifkan atau nonaktifkan meja
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Status meja berhasil diperbarui
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Meja tidak ditemukan
 *       500:
 *         description: Terjadi kesalahan server
 *
 * /api/admin/outlets:
 *   post:
 *     summary: Tambah outlet
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, code, address, phone, opened_at, status]
 *     responses:
 *       200:
 *         description: Outlet berhasil dibuat
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Validasi outlet gagal
 *       500:
 *         description: Terjadi kesalahan server
 *
 * /api/admin/outlets/{id}:
 *   get:
 *     summary: Detail outlet
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Detail outlet berhasil dimuat
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Outlet tidak ditemukan
 *       500:
 *         description: Terjadi kesalahan server
 *   put:
 *     summary: Edit outlet
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Outlet berhasil diperbarui
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Validasi outlet gagal
 *       500:
 *         description: Terjadi kesalahan server
 *
 * /api/admin/outlets/{id}/toggle-status:
 *   patch:
 *     summary: Aktifkan atau nonaktifkan outlet
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Status outlet berhasil diperbarui
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Outlet tidak ditemukan
 *       500:
 *         description: Terjadi kesalahan server
 *
 * /api/admin/categories:
 *   post:
 *     summary: Tambah kategori produk
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, status]
 *     responses:
 *       200:
 *         description: Kategori berhasil dibuat
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Validasi kategori gagal
 *       500:
 *         description: Terjadi kesalahan server
 *
 * /api/admin/categories/{id}:
 *   get:
 *     summary: Detail kategori produk
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Detail kategori berhasil dimuat
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Kategori tidak ditemukan
 *       500:
 *         description: Terjadi kesalahan server
 *   put:
 *     summary: Edit kategori produk
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Kategori berhasil diperbarui
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Validasi kategori gagal
 *       500:
 *         description: Terjadi kesalahan server
 *
 * /api/admin/categories/{id}/toggle-status:
 *   patch:
 *     summary: Aktifkan atau nonaktifkan kategori produk
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Status kategori berhasil diperbarui
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Kategori tidak ditemukan
 *       500:
 *         description: Terjadi kesalahan server
 *
 * /api/admin/expense-categories:
 *   post:
 *     summary: Tambah nama pengeluaran operasional
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, status]
 *     responses:
 *       200:
 *         description: Kategori pengeluaran berhasil dibuat
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Validasi nama pengeluaran operasional gagal
 *       500:
 *         description: Terjadi kesalahan server
 *
 * /api/admin/expense-categories/{id}:
 *   get:
 *     summary: Detail nama pengeluaran operasional
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Detail nama pengeluaran operasional berhasil dimuat
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Kategori pengeluaran tidak ditemukan
 *       500:
 *         description: Terjadi kesalahan server
 *   put:
 *     summary: Edit nama pengeluaran operasional
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Kategori pengeluaran berhasil diperbarui
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Validasi nama pengeluaran operasional gagal
 *       500:
 *         description: Terjadi kesalahan server
 *
 * /api/admin/expense-categories/{id}/toggle-status:
 *   patch:
 *     summary: Aktifkan atau nonaktifkan nama pengeluaran operasional
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Status nama pengeluaran operasional berhasil diperbarui
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Kategori pengeluaran tidak ditemukan
 *       500:
 *         description: Terjadi kesalahan server
 *
 * /api/admin/suppliers:
 *   post:
 *     summary: Tambah supplier
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, phone, status]
 *     responses:
 *       200:
 *         description: Supplier berhasil dibuat
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Validasi supplier gagal
 *       500:
 *         description: Terjadi kesalahan server
 *
 * /api/admin/suppliers/{id}:
 *   get:
 *     summary: Detail supplier
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Detail supplier berhasil dimuat
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Supplier tidak ditemukan
 *       500:
 *         description: Terjadi kesalahan server
 *   put:
 *     summary: Edit supplier
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Supplier berhasil diperbarui
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Validasi supplier gagal
 *       500:
 *         description: Terjadi kesalahan server
 *
 * /api/admin/suppliers/{id}/toggle-status:
 *   patch:
 *     summary: Aktifkan atau nonaktifkan supplier
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Status supplier berhasil diperbarui
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Supplier tidak ditemukan
 *       500:
 *         description: Terjadi kesalahan server
 *
 * /api/admin/users:
 *   post:
 *     summary: Tambah user admin/kasir
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, username, email, role_id, outlet_ids, status]
 *     responses:
 *       200:
 *         description: User berhasil dibuat
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Validasi user gagal
 *       500:
 *         description: Terjadi kesalahan server
 *
 * /api/admin/users/{id}:
 *   put:
 *     summary: Edit user, role, outlet, dan status
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User berhasil diperbarui
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Validasi user gagal
 *       500:
 *         description: Terjadi kesalahan server
 *
 * /api/admin/users/{id}/toggle-status:
 *   patch:
 *     summary: Aktifkan atau nonaktifkan user
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Status user berhasil diperbarui
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: User tidak ditemukan
 *       500:
 *         description: Terjadi kesalahan server
 *
 * /api/admin/users/{id}/reset-password:
 *   post:
 *     summary: Reset password user dan kembalikan password sementara
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Password sementara berhasil dibuat
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: User tidak ditemukan
 *       500:
 *         description: Terjadi kesalahan server
 *
 * /api/admin/inventory/purchases:
 *   post:
 *     summary: Tambah pembelian harga pokok produksi dan update stok mock
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pembelian berhasil dibuat
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *
 * /api/admin/settings/print:
 *   put:
 *     summary: Update pengaturan print untuk catalog APK
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pengaturan print berhasil diperbarui
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *
 * /api/admin/products/{id}:
 *   get:
 *     summary: Detail produk lengkap
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Detail produk dengan harga outlet dan komposisi
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Produk tidak ditemukan
 *       500:
 *         description: Terjadi kesalahan server
 *   put:
 *     summary: Edit produk, harga outlet, dan komposisi
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, category_id, status]
 *     responses:
 *       200:
 *         description: Produk berhasil diperbarui
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Validasi produk gagal
 *       500:
 *         description: Terjadi kesalahan server
 *
 * /api/admin/products:
 *   post:
 *     summary: Tambah produk, harga outlet, dan komposisi
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, category_id, status]
 *             properties:
 *               name:
 *                 type: string
 *               category_id:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [active, inactive]
 *               prices:
 *                 type: array
 *                 items:
 *                   type: object
 *               composition:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: Produk berhasil dibuat
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Validasi produk gagal
 *       500:
 *         description: Terjadi kesalahan server
 *
 * /api/admin/products/{id}/toggle-status:
 *   patch:
 *     summary: Aktifkan atau nonaktifkan produk
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Status produk berhasil diperbarui
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission tidak cukup
 *       422:
 *         description: Produk tidak ditemukan
 *       500:
 *         description: Terjadi kesalahan server
 *
 * /api/admin/customers/{id}:
 *   get:
 *     summary: Detail customer terbaru
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Detail customer berhasil diambil
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission atau outlet tidak cukup
 *       422:
 *         description: Customer tidak ditemukan
 *       500:
 *         description: Terjadi kesalahan server
 *   put:
 *     summary: Edit customer
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Customer berhasil diperbarui
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission atau outlet tidak cukup
 *       422:
 *         description: Validasi customer gagal
 *       500:
 *         description: Terjadi kesalahan server
 *
 * /api/admin/customers/barcode:
 *   post:
 *     summary: Generate barcode customer berdasarkan outlet
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [outlet_id]
 *             properties:
 *               outlet_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Barcode berhasil dibuat
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission atau outlet tidak cukup
 *       422:
 *         description: Outlet tidak valid
 *       500:
 *         description: Terjadi kesalahan server
 *
 * /api/admin/customers:
 *   post:
 *     summary: Tambah customer
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Customer berhasil dibuat
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission atau outlet tidak cukup
 *       422:
 *         description: Validasi customer gagal
 *       500:
 *         description: Terjadi kesalahan server
 *
 * /api/admin/customers/{id}/toggle-status:
 *   patch:
 *     summary: Aktifkan atau nonaktifkan customer
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Status customer berhasil diperbarui
 *       401:
 *         description: Token wajib dikirim
 *       403:
 *         description: Permission atau outlet tidak cukup
 *       422:
 *         description: Customer tidak ditemukan
 *       500:
 *         description: Terjadi kesalahan server
 */

async function sendMock(res, action, req = null) {
  try {
    const data = req?.auth?.id
      ? await dataService.withActivityActor(req.auth.id, action)
      : await action();
    res.json({ success: true, data });
  } catch (error) {
    error.status = error.status || 422;
    throw error;
  }
}

function post(path, permissionKey, action, handler) {
  router.post(path, requireAuth, requirePermission(permissionKey, action), asyncHandler((req, res, next) => dataService.withActivityActor(req.auth.id, () => handler(req, res, next))));
}

function get(path, permissionKey, action, handler) {
  router.get(path, requireAuth, requirePermission(permissionKey, action), asyncHandler((req, res, next) => dataService.withActivityActor(req.auth.id, () => handler(req, res, next))));
}

function put(path, permissionKey, action, handler) {
  router.put(path, requireAuth, requirePermission(permissionKey, action), asyncHandler((req, res, next) => dataService.withActivityActor(req.auth.id, () => handler(req, res, next))));
}

function patch(path, permissionKey, action, handler) {
  router.patch(path, requireAuth, requirePermission(permissionKey, action), asyncHandler((req, res, next) => dataService.withActivityActor(req.auth.id, () => handler(req, res, next))));
}

function del(path, permissionKey, action, handler) {
  router.delete(path, requireAuth, requirePermission(permissionKey, action), asyncHandler((req, res, next) => dataService.withActivityActor(req.auth.id, () => handler(req, res, next))));
}

function validateProductPayload(payload, req) {
  const errors = {};
  const name = String(payload.name || "").trim();

  if (!name) errors.name = "Nama produk wajib diisi.";
  if (!payload.category_id) errors.category_id = "Kategori produk wajib dipilih.";
  if (payload.status && !["active", "inactive"].includes(payload.status)) {
    errors.status = "Status produk tidak valid.";
  }

  if (can(req.auth, "master.products", "manage_price")) {
    const prices = Array.isArray(payload.prices) ? payload.prices : [];
    const priceErrors = [];
    const seenOutletIds = new Set();

    prices.forEach((price, index) => {
      const label = `baris ${index + 1}`;

      if (!price.outlet_id) {
        priceErrors.push(`Outlet harga ${label} tidak valid.`);
      }
      if (seenOutletIds.has(price.outlet_id)) {
        priceErrors.push(`Harga ${label} tidak boleh duplikat.`);
      }
      seenOutletIds.add(price.outlet_id);

      if (Number(price.price || 0) < 1) {
        priceErrors.push(`Harga ${label} minimal 1.`);
      }
      if (price.status && !["active", "inactive"].includes(price.status)) {
        priceErrors.push(`Status harga ${label} tidak valid.`);
      }
    });

    if (priceErrors.length) errors.prices = priceErrors;
  }

  if (can(req.auth, "master.products", "manage_composition")) {
    const composition = Array.isArray(payload.composition) ? payload.composition : [];
    const compositionErrors = composition
      .map((item, index) => {
        if (!item.material_id) {
          return `Harga Pokok Produksi baris ${index + 1} tidak valid.`;
        }
        if (Number(item.quantity || 0) <= 0) {
          return `Qty komposisi baris ${index + 1} wajib lebih dari 0.`;
        }
        return null;
      })
      .filter(Boolean);

    if (compositionErrors.length) errors.composition = compositionErrors;
  }

  const variants = Array.isArray(payload.variants) ? payload.variants : [];
  const variantErrors = [];
  const seenVariantNames = new Set();
  if (variants.length > 20) {
    variantErrors.push("Catatan variant maksimal 20 per produk.");
  }
  variants.forEach((variant, index) => {
    const name = String(variant.name || "").trim();
    const key = name.toLowerCase();
    if (!name) {
      variantErrors.push(`Catatan variant baris ${index + 1} wajib diisi.`);
    }
    if (name.length > 120) {
      variantErrors.push(`Catatan variant baris ${index + 1} maksimal 120 karakter.`);
    }
    if (key && seenVariantNames.has(key)) {
      variantErrors.push(`Catatan variant ${name} tidak boleh duplikat.`);
    }
    seenVariantNames.add(key);
    if (variant.status && !["active", "inactive"].includes(variant.status)) {
      variantErrors.push(`Status catatan variant ${name || `baris ${index + 1}`} tidak valid.`);
    }
  });
  if (variantErrors.length) errors.variants = variantErrors;

  if (Object.keys(errors).length) {
    throw validationError(errors);
  }
}

async function getProductDetailForPayload(productId) {
  try {
    return await dataService.getProductDetail(productId);
  } catch (error) {
    error.status = error.status || 422;
    throw error;
  }
}

async function productPayloadForPermissions(req, productId) {
  const payload = { ...req.body };

  if (!can(req.auth, "master.products", "manage_price")) {
    if (productId) {
      const product = await getProductDetailForPayload(productId);
      payload.prices = (product.all_prices || product.prices || []).map((price) => ({
        outlet_id: price.outlet_id,
        price: price.price,
        status: price.status
      }));
    } else {
      payload.prices = [];
    }
  }

  if (!can(req.auth, "master.products", "manage_composition")) {
    if (productId) {
      const product = await getProductDetailForPayload(productId);
      payload.composition = (product.composition || []).map((item) => ({
        material_id: item.material_id,
        quantity: item.quantity,
        unit: item.unit
      }));
    } else {
      payload.composition = [];
    }
  }

  validateProductPayload(payload, req);
  return payload;
}

function canUseOutlet(req, outletId) {
  return req.auth?.role_id === "role_owner" || (req.auth?.outlet_ids || []).includes(outletId);
}

function assertCustomerOutletAccess(req, outletId) {
  if (!canUseOutlet(req, outletId)) {
    throw forbidden("User tidak punya akses ke outlet customer ini.");
  }
}

function validateCustomerPayload(payload, req) {
  const errors = {};
  const name = String(payload.name || "").trim();
  const phone = String(payload.phone || "").trim();
  const outletId = payload.outlet_id;
  const status = payload.status || "active";

  if (!name) errors.name = "Nama customer wajib diisi.";
  if (!phone || phone.length < 8) errors.phone = "Nomor HP minimal 8 karakter.";
  if (!outletId) errors.outlet_id = "Outlet customer wajib dipilih.";
  if (!["active", "inactive"].includes(status)) errors.status = "Status customer tidak valid.";

  if (Object.keys(errors).length) {
    throw validationError(errors);
  }

  assertCustomerOutletAccess(req, outletId);
}

async function getCustomerDetailForRequest(req, customerId) {
  try {
    const customer = await dataService.getCustomerDetail(customerId);
    assertCustomerOutletAccess(req, customer.outlet_id);
    return customer;
  } catch (error) {
    error.status = error.status || 422;
    throw error;
  }
}

async function customerPayloadForPermissions(req, customerId) {
  const payload = { ...req.body };

  if (customerId) {
    await getCustomerDetailForRequest(req, customerId);
  }

  validateCustomerPayload(payload, req);
  return payload;
}

post("/records/:entity", "master.products", "create", (req, res) =>
  sendMock(res, () => dataService.createRecord(req.params.entity, req.body))
);

put("/profile/:id", "settings.profile", "view", (req, res) =>
  sendMock(res, () => dataService.updateProfile(req.params.id, req.body, req.auth.id))
);
put("/profile/:id/password", "settings.profile", "view", (req, res) =>
  sendMock(res, () => dataService.changeProfilePassword(req.params.id, req.body, req.auth.id))
);

post("/users", "master.users", "create", (req, res) => sendMock(res, () => dataService.createUser(req.body, req.auth.id)));
put("/users/:id", "master.users", "update", (req, res) => sendMock(res, () => dataService.updateUser(req.params.id, req.body, req.auth.id)));
patch("/users/:id/toggle-status", "master.users", "toggle_status", (req, res) =>
  sendMock(res, () => dataService.toggleUserStatus(req.params.id, req.auth.id))
);
post("/users/:id/reset-password", "master.users", "reset_password", (req, res) =>
  sendMock(res, () => dataService.resetUserPassword(req.params.id, req.auth.id))
);
post("/roles", "settings.permissions", "create", (req, res) =>
  sendMock(res, () => dataService.createRole(req.body, req.auth.id), req)
);
put("/roles/:roleId", "settings.permissions", "update", (req, res) =>
  sendMock(res, () => dataService.updateRole(req.params.roleId, req.body, req.auth.id), req)
);
del("/roles/:roleId", "settings.permissions", "delete", (req, res) =>
  sendMock(res, () => dataService.deleteRole(req.params.roleId, req.auth.id), req)
);
put("/roles/:roleId/permissions", "settings.permissions", "update", (req, res) =>
  sendMock(res, () => dataService.updateRolePermissions(req.params.roleId, req.body.permissions || req.body, req.auth.id))
);

put("/settings/print", "settings.printing", "update", (req, res) =>
  sendMock(res, () => dataService.updatePrintSettings(req.body, req.auth.id))
);
put("/settings/app-security", "settings.app_security", "update", (req, res) =>
  sendMock(res, () => dataService.updateAppSecuritySettings({ ...req.body, updated_by: req.auth.id }))
);

router.get(
  "/imports/master-data/template",
  requireAuth,
  requirePermission("master.imports", "view"),
  asyncHandler(async (req, res) => {
    const buffer = masterImportService.createTemplateBuffer(dataService.adminImportApi.getImportData());
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=template-import-master-data-barokah.xlsx");
    res.send(buffer);
  })
);

router.post(
  "/imports/master-data/preview",
  requireAuth,
  requirePermission("master.imports", "create"),
  asyncHandler(async (req, res) => {
    await runMasterImportUpload(req, res);
    if (!req.file) throw validationError({ file: "File import wajib dipilih." });
    const result = masterImportService.previewMasterDataImport(dataService.adminImportApi, req.file.buffer, req.file.originalname);
    await dataService.createActivityLog({
      actor_user_id: req.auth.id,
      source: "admin_web",
      module: "master_import",
      action: "preview",
      entity_type: "master_import",
      entity_id: req.file.originalname,
      description: `Preview import master data ${req.file.originalname}.`,
      metadata_json: { summary: result.summary, sheets: result.sheets.map((sheet) => ({ key: sheet.key, row_count: sheet.row_count })) }
    });
    res.json({ success: true, data: result });
  })
);

router.post(
  "/imports/master-data/commit",
  requireAuth,
  requirePermission("master.imports", "create"),
  asyncHandler(async (req, res) => {
    await runMasterImportUpload(req, res);
    if (!req.file) throw validationError({ file: "File import wajib dipilih." });
    const result = await masterImportService.commitMasterDataImport(dataService.adminImportApi, req.file.buffer, {
      filename: req.file.originalname,
      actorUserId: req.auth.id
    });
    res.json({ success: true, data: result });
  })
);

get("/customers/:id", "master.customers", "view", (req, res) =>
  sendMock(res, () => getCustomerDetailForRequest(req, req.params.id))
);
post("/customers/barcode", "master.customers", "generate_barcode", (req, res) => {
  const outletId = req.body.outlet_id;
  if (!outletId) throw validationError({ outlet_id: "Outlet wajib dipilih." });
  assertCustomerOutletAccess(req, outletId);
  return sendMock(res, () => dataService.generateCustomerBarcode(outletId, req.auth.id));
});
post("/customers", "master.customers", "create", async (req, res) => {
  const payload = await customerPayloadForPermissions(req);
  return sendMock(res, () => dataService.createCustomer({ ...payload, created_by: req.auth.id }));
});
put("/customers/:id", "master.customers", "update", async (req, res) => {
  const payload = await customerPayloadForPermissions(req, req.params.id);
  return sendMock(res, () => dataService.updateCustomer(req.params.id, { ...payload, updated_by: req.auth.id }));
});
patch("/customers/:id/toggle-status", "master.customers", "toggle_status", async (req, res) => {
  await getCustomerDetailForRequest(req, req.params.id);
  return sendMock(res, () => dataService.toggleCustomerStatus(req.params.id, req.auth.id));
});

post("/outlets", "master.outlets", "create", (req, res) => sendMock(res, () => dataService.createOutlet({ ...req.body, created_by: req.auth.id })));
get("/outlets/:id", "master.outlets", "view", (req, res) =>
  sendMock(res, () => dataService.getOutletDetail(req.params.id))
);
put("/outlets/:id", "master.outlets", "update", (req, res) =>
  sendMock(res, () => dataService.updateOutlet(req.params.id, { ...req.body, updated_by: req.auth.id }))
);
patch("/outlets/:id/toggle-status", "master.outlets", "toggle_status", (req, res) =>
  sendMock(res, () => dataService.toggleOutletStatus(req.params.id, req.auth.id))
);

post("/tables", "master.tables", "create", (req, res) => sendMock(res, () => dataService.createTable({ ...req.body, created_by: req.auth.id })));
post("/tables/generate", "master.tables", "create", (req, res) =>
  sendMock(res, () => dataService.generateTables({ ...req.body, created_by: req.auth.id }))
);
get("/tables/:id", "master.tables", "view", (req, res) =>
  sendMock(res, () => dataService.getTableDetail(req.params.id))
);
put("/tables/:id", "master.tables", "update", (req, res) =>
  sendMock(res, () => dataService.updateTable(req.params.id, { ...req.body, updated_by: req.auth.id }))
);
patch("/tables/:id/toggle-status", "master.tables", "toggle_status", (req, res) =>
  sendMock(res, () => dataService.toggleTableStatus(req.params.id, req.auth.id))
);

post("/categories", "master.categories", "create", (req, res) => sendMock(res, () => dataService.createCategory({ ...req.body, created_by: req.auth.id })));
get("/categories/:id", "master.categories", "view", (req, res) =>
  sendMock(res, () => dataService.getCategoryDetail(req.params.id))
);
put("/categories/:id", "master.categories", "update", (req, res) =>
  sendMock(res, () => dataService.updateCategory(req.params.id, { ...req.body, updated_by: req.auth.id }))
);
patch("/categories/:id/toggle-status", "master.categories", "toggle_status", (req, res) =>
  sendMock(res, () => dataService.toggleCategoryStatus(req.params.id, req.auth.id))
);

post("/expense-categories", "master.expense_categories", "create", (req, res) =>
  sendMock(res, () => dataService.createExpenseCategory({ ...req.body, created_by: req.auth.id }))
);
get("/expense-categories/:id", "master.expense_categories", "view", (req, res) =>
  sendMock(res, () => dataService.getExpenseCategoryDetail(req.params.id))
);
put("/expense-categories/:id", "master.expense_categories", "update", (req, res) =>
  sendMock(res, () => dataService.updateExpenseCategory(req.params.id, { ...req.body, updated_by: req.auth.id }))
);
patch("/expense-categories/:id/toggle-status", "master.expense_categories", "toggle_status", (req, res) =>
  sendMock(res, () => dataService.toggleExpenseCategoryStatus(req.params.id, req.auth.id))
);
patch("/expenses/:id/correction", "reports.expenses", "update", (req, res) =>
  sendMock(res, () => dataService.correctExpenseAmount(req.params.id, { ...req.body, corrected_by: req.auth.id }))
);
patch("/expenses/:id/approve", "reports.expenses", "approve", (req, res) =>
  sendMock(res, () => dataService.approveExpense(req.params.id, { ...req.body, approved_by: req.auth.id }))
);
patch("/expenses/:id/reject", "reports.expenses", "reject", (req, res) =>
  sendMock(res, () => dataService.rejectExpense(req.params.id, { ...req.body, rejected_by: req.auth.id }))
);
patch("/transactions/:id/items", "reports.transactions", "update", (req, res) =>
  sendMock(res, () => dataService.correctTransactionItems(req.params.id, req.body, req.auth.id))
);
post("/transactions/:id/refund", "reports.transactions", "refund", (req, res) =>
  sendMock(res, () => dataService.refundTransaction(req.params.id, req.body, req.auth.id))
);
post("/transactions/:id/cancel", "reports.transactions", "cancel", (req, res) =>
  sendMock(res, () => dataService.cancelTransaction(req.params.id, req.body, req.auth.id))
);

post("/payment-methods", "master.payment_methods", "create", (req, res) =>
  sendMock(res, () => dataService.createPaymentMethod({ ...req.body, created_by: req.auth.id }))
);
put("/payment-methods/:id", "master.payment_methods", "update", (req, res) =>
  sendMock(res, () => dataService.updatePaymentMethod(req.params.id, { ...req.body, updated_by: req.auth.id }))
);
patch("/payment-methods/:id/toggle-status", "master.payment_methods", "toggle_status", (req, res) =>
  sendMock(res, () => dataService.togglePaymentMethodStatus(req.params.id, req.auth.id))
);

post("/financial-accounts", "finance.accounts", "create", (req, res) =>
  sendMock(res, () => dataService.createFinancialAccount({ ...req.body, created_by: req.auth.id }))
);
put("/financial-accounts/:id", "finance.accounts", "update", (req, res) =>
  sendMock(res, () => dataService.updateFinancialAccount(req.params.id, { ...req.body, updated_by: req.auth.id }))
);
patch("/financial-accounts/:id/toggle-status", "finance.accounts", "toggle_status", (req, res) =>
  sendMock(res, () => dataService.toggleFinancialAccountStatus(req.params.id, req.auth.id))
);

post("/finance-entry-groups", "finance.entries", "create", (req, res) =>
  sendMock(res, () => dataService.createFinanceEntryGroup({ ...req.body, created_by: req.auth.id }))
);
put("/finance-entry-groups/:id", "finance.entries", "update", (req, res) =>
  sendMock(res, () => dataService.updateFinanceEntryGroup(req.params.id, { ...req.body, updated_by: req.auth.id }))
);
patch("/finance-entry-groups/:id/toggle-status", "finance.entries", "toggle_status", (req, res) =>
  sendMock(res, () => dataService.toggleFinanceEntryGroupStatus(req.params.id, req.auth.id))
);

post("/finance-entries", "finance.entries", "create", (req, res) =>
  sendMock(res, () => dataService.createFinanceEntry({ ...req.body, created_by: req.auth.id }))
);
put("/finance-entries/:id", "finance.entries", "update", (req, res) =>
  sendMock(res, () => dataService.updateFinanceEntry(req.params.id, { ...req.body, updated_by: req.auth.id }))
);
patch("/finance-entries/:id/toggle-status", "finance.entries", "toggle_status", (req, res) =>
  sendMock(res, () => dataService.toggleFinanceEntryStatus(req.params.id, req.auth.id))
);

post("/reserve-funds", "finance.reserve_funds", "create", (req, res) =>
  sendMock(res, () => dataService.createReserveFund({ ...req.body, created_by: req.auth.id }))
);
put("/reserve-funds/:id", "finance.reserve_funds", "update", (req, res) =>
  sendMock(res, () => dataService.updateReserveFund(req.params.id, { ...req.body, updated_by: req.auth.id }))
);
patch("/reserve-funds/:id/toggle-status", "finance.reserve_funds", "toggle_status", (req, res) =>
  sendMock(res, () => dataService.toggleReserveFundStatus(req.params.id, req.auth.id))
);

post("/discounts", "master.discounts", "create", (req, res) =>
  sendMock(res, () => dataService.createDiscount({ ...req.body, created_by: req.auth.id }))
);
put("/discounts/:id", "master.discounts", "update", (req, res) =>
  sendMock(res, () => dataService.updateDiscount(req.params.id, { ...req.body, updated_by: req.auth.id }))
);
patch("/discounts/:id/toggle-status", "master.discounts", "toggle_status", (req, res) =>
  sendMock(res, () => dataService.toggleDiscountStatus(req.params.id, req.auth.id))
);

post("/material-categories", "master.material_categories", "create", (req, res) =>
  sendMock(res, () => dataService.createMaterialCategory({ ...req.body, created_by: req.auth.id }))
);
get("/material-categories/:id", "master.material_categories", "view", (req, res) =>
  sendMock(res, () => dataService.getMaterialCategoryDetail(req.params.id))
);
put("/material-categories/:id", "master.material_categories", "update", (req, res) =>
  sendMock(res, () => dataService.updateMaterialCategory(req.params.id, { ...req.body, updated_by: req.auth.id }))
);
patch("/material-categories/:id/toggle-status", "master.material_categories", "toggle_status", (req, res) =>
  sendMock(res, () => dataService.toggleMaterialCategoryStatus(req.params.id, req.auth.id))
);

get("/products/:id", "master.products", "view", (req, res) =>
  sendMock(res, () => dataService.getProductDetail(req.params.id))
);
post("/products", "master.products", "create", async (req, res) => {
  const payload = await productPayloadForPermissions(req);
  return sendMock(res, () => dataService.createProduct(payload));
});
put("/products/:id", "master.products", "update", async (req, res) => {
  const payload = await productPayloadForPermissions(req, req.params.id);
  return sendMock(res, () => dataService.updateProduct(req.params.id, payload));
}
);
patch("/products/:id/toggle-status", "master.products", "toggle_status", (req, res) =>
  sendMock(res, () => dataService.toggleProductStatus(req.params.id, req.auth.id))
);
post("/products/:id/image", "master.products", "update", async (req, res) => {
  await runProductImageUpload(req, res);
  if (!req.file) {
    throw validationError({ image: "Gambar produk wajib dipilih." });
  }
  return sendMock(res, () => dataService.uploadProductImage(req.params.id, req.file));
});
del("/products/:id/image", "master.products", "update", (req, res) =>
  sendMock(res, () => dataService.deleteProductImage(req.params.id))
);

post("/product-compositions", "master.products", "manage_composition", (req, res) =>
  sendMock(res, () => dataService.createProductComposition({ ...req.body, created_by: req.auth.id }))
);
put("/product-compositions/:id", "master.products", "manage_composition", (req, res) =>
  sendMock(res, () => dataService.updateProductComposition(req.params.id, { ...req.body, updated_by: req.auth.id }))
);
del("/product-compositions/:id", "master.products", "manage_composition", (req, res) =>
  sendMock(res, () => dataService.deleteProductComposition(req.params.id))
);

post("/materials", "master.materials", "create", (req, res) => sendMock(res, () => dataService.createMaterial({ ...req.body, created_by: req.auth.id })));
put("/materials/:id", "master.materials", "update", (req, res) =>
  sendMock(res, () => dataService.updateMaterial(req.params.id, { ...req.body, updated_by: req.auth.id }))
);
patch("/materials/:id/toggle-status", "master.materials", "toggle_status", (req, res) =>
  sendMock(res, () => dataService.toggleMaterialStatus(req.params.id, req.auth.id))
);

post("/units", "master.units", "create", (req, res) => sendMock(res, () => dataService.createUnit({ ...req.body, created_by: req.auth.id })));
put("/units/:id", "master.units", "update", (req, res) => sendMock(res, () => dataService.updateUnit(req.params.id, { ...req.body, updated_by: req.auth.id })));
patch("/units/:id/toggle-status", "master.units", "toggle_status", (req, res) =>
  sendMock(res, () => dataService.toggleUnitStatus(req.params.id, req.auth.id))
);

post("/suppliers", "master.suppliers", "create", (req, res) => sendMock(res, () => dataService.createSupplier({ ...req.body, created_by: req.auth.id })));
get("/suppliers/:id", "master.suppliers", "view", (req, res) =>
  sendMock(res, () => dataService.getSupplierDetail(req.params.id))
);
put("/suppliers/:id", "master.suppliers", "update", (req, res) =>
  sendMock(res, () => dataService.updateSupplier(req.params.id, { ...req.body, updated_by: req.auth.id }))
);
patch("/suppliers/:id/toggle-status", "master.suppliers", "toggle_status", (req, res) =>
  sendMock(res, () => dataService.toggleSupplierStatus(req.params.id, req.auth.id))
);

post("/inventory/purchases", "inventory.purchases", "create", (req, res) =>
  sendMock(res, () => dataService.createPurchase({ ...req.body, created_by: req.auth.id }))
);
put("/inventory/purchases/:id", "inventory.purchases", "update", (req, res) =>
  sendMock(res, () => dataService.updatePurchase(req.params.id, { ...req.body, updated_by: req.auth.id }))
);
patch("/inventory/purchases/:id/approve", "inventory.purchases", "approve", (req, res) =>
  sendMock(res, () => dataService.approvePurchase(req.params.id, { ...req.body, approved_by: req.auth.id }))
);
patch("/inventory/purchases/:id/reject", "inventory.purchases", "reject", (req, res) =>
  sendMock(res, () => dataService.rejectPurchase(req.params.id, { ...req.body, rejected_by: req.auth.id }))
);
post("/inventory/transfers", "inventory.transfers", "create", (req, res) =>
  sendMock(res, () => dataService.createStockTransfer({ ...req.body, requested_by: req.auth.id }))
);
put("/inventory/transfers/:id", "inventory.transfers", "update", (req, res) =>
  sendMock(res, () => dataService.updateStockTransfer(req.params.id, { ...req.body, updated_by: req.auth.id }))
);
patch("/inventory/transfers/:id/approve", "inventory.transfers", "approve", (req, res) =>
  sendMock(res, () => dataService.approveStockTransfer(req.params.id, { ...req.body, approved_by: req.auth.id }))
);
patch("/inventory/transfers/:id/reject", "inventory.transfers", "reject", (req, res) =>
  sendMock(res, () => dataService.rejectStockTransfer(req.params.id, { ...req.body, rejected_by: req.auth.id }))
);
post("/inventory/opnames", "inventory.opnames", "create", (req, res) =>
  sendMock(res, () => dataService.createStockOpname({ ...req.body, created_by: req.auth.id }))
);
post("/inventory/opname-batches", "inventory.opnames", "create", (req, res) =>
  sendMock(res, () => dataService.createStockOpnameBatch({ ...req.body, created_by: req.auth.id }))
);
get("/inventory/opname-requests", "inventory.opnames", "view", (req, res) =>
  sendMock(res, () => dataService.getStockOpnameRequests(req.query))
);
/**
 * @swagger
 * /api/admin/inventory/opname-material-selection:
 *   get:
 *     summary: Ambil pilihan item Stock Opname APK per outlet
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: outletId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Daftar item dan status pilihannya
 *   put:
 *     summary: Ganti seluruh pilihan item Stock Opname APK satu outlet
 *     tags: [Admin Mutation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [outlet_id, material_ids]
 *     responses:
 *       200:
 *         description: Pilihan outlet berhasil disimpan
 *       403:
 *         description: Permission inventory.opnames:create tidak tersedia
 */
get("/inventory/opname-material-selection", "inventory.opnames", "view", (req, res) =>
  sendMock(res, () => dataService.getStockOpnameMaterialSelection(req.query))
);
put("/inventory/opname-material-selection", "inventory.opnames", "create", (req, res) =>
  sendMock(res, () => dataService.updateStockOpnameMaterialSelection(req.body, req.auth.id))
);
patch("/inventory/opname-requests/:id/approve", "inventory.opnames", "approve", (req, res) =>
  sendMock(res, () => dataService.approveStockOpnameRequest(req.params.id, { ...req.body, approved_by: req.auth.id }))
);
patch("/inventory/opname-requests/:id/reject", "inventory.opnames", "reject", (req, res) =>
  sendMock(res, () => dataService.rejectStockOpnameRequest(req.params.id, { ...req.body, rejected_by: req.auth.id }))
);

get("/activity-logs", "reports.activity_logs", "view", (req, res) =>
  sendMock(res, () => dataService.getActivityLogs(req.query))
);
router.post(
  "/activity-logs",
  requireAuth,
  asyncHandler(async (req, res) => {
    const logs = Array.isArray(req.body.logs) ? req.body.logs : [req.body];
    if (logs.length > 100) throw validationError({ logs: "Maksimal 100 event per batch." });
    const secureLog = (log) => {
      const outletId = log.outlet_id || log.outletId || null;
      if (outletId && !(req.auth.outlet_ids || []).includes(outletId)) {
        throw forbidden("Outlet event tidak tersedia untuk user ini.");
      }
      return {
        ...log,
        actor_user_id: req.auth.id,
        actor_role: req.auth.role_id,
        source: "admin_web",
        event_type: log.event_type || log.eventType || "interaction",
        ip_address: req.ip
      };
    };
    const payloads = logs.map(secureLog);
    const data = await dataService.withActivityActor(req.auth.id, () =>
      payloads.length === 1 ? dataService.createActivityLog(payloads[0]) : dataService.createActivityLogs(payloads)
    );
    res.json({ success: true, data });
  })
);

module.exports = router;
