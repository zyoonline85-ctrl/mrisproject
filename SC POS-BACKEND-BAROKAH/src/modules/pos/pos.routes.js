const express = require("express");
const { z } = require("zod");
const { requireAuth } = require("../../middlewares/auth");
const { can, requireAnyPermission, requireApkAccess, requirePermission } = require("../../middlewares/permission");
const asyncHandler = require("../../utils/async-handler");
const validate = require("../../utils/validate");
const { forbidden, HttpError, validationError } = require("../../utils/http-error");
const dataService = require("../../services/data-service");

const router = express.Router();

const flexibleObjectSchema = z.object({}).passthrough();
const openBillQuerySchema = z.object({
  outletId: z.string().min(1)
});
const historyQuerySchema = z.object({
  outletId: z.string().min(1),
  from: z.string().optional(),
  to: z.string().optional(),
  paymentMethod: z.string().optional()
});
const reportQuerySchema = z.object({
  outletId: z.string().min(1),
  from: z.string().optional(),
  to: z.string().optional()
});
const discountQuerySchema = z.object({
  outletId: z.string().min(1)
});
const purchaseQuerySchema = z.object({
  outletId: z.string().min(1),
  from: z.string().optional(),
  to: z.string().optional(),
  status: z.string().optional()
});
const transferQuerySchema = z.object({
  outletId: z.string().min(1),
  from: z.string().optional(),
  to: z.string().optional(),
  status: z.string().optional()
});
const opnameQuerySchema = z.object({
  outletId: z.string().min(1),
  from: z.string().optional(),
  to: z.string().optional(),
  status: z.string().optional()
});
const opnameWorksheetQuerySchema = z.object({
  outletId: z.string().min(1),
  date: z.string().min(1)
});
const materialStockQuerySchema = z.object({
  outletIds: z.string().min(1),
  materialIds: z.string().optional()
});
const productFavoriteQuerySchema = z.object({
  outletId: z.string().min(1)
});
const productFavoritePayloadSchema = z.object({
  outlet_id: z.string().min(1),
  product_ids: z.array(z.string().min(1)).default([])
});
const reportPinSchema = z.object({
  pin: z.string().regex(/^\d{6}$/, "PIN wajib 6 digit angka.")
});
const customerQuerySchema = z.object({
  outletId: z.string().min(1),
  keyword: z.string().optional()
});
const customerPayloadSchema = z
  .object({
    outletId: z.string().optional(),
    outlet_id: z.string().optional(),
    name: z.string().min(1),
    phone: z.string().nullable().optional()
  })
  .passthrough();

function field(payload, camelKey, snakeKey) {
  return payload?.[camelKey] ?? payload?.[snakeKey];
}

function splitQueryList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function requireOutletAccess(req, outletId) {
  const outletIds = req.auth?.outlet_ids || [];
  if (!outletIds.includes(outletId)) {
    throw forbidden("Outlet tidak tersedia untuk user ini.");
  }
}

function normalizeServiceError(error) {
  if (Number.isInteger(error?.status)) return new HttpError(error.status, error.message, error.details);
  return validationError({ formErrors: [error.message], fieldErrors: {} });
}

/**
 * @swagger
 * /api/pos/history:
 *   get:
 *     summary: Ambil riwayat transaksi POS per outlet untuk APK
 *     tags: [POS Sync]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: outletId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *       - in: query
 *         name: paymentMethod
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Daftar transaksi POS mobile
 *       401:
 *         description: Token tidak valid
 *       403:
 *         description: Outlet tidak tersedia untuk user
 */
router.get(
  "/history",
  requireAuth,
  requirePermission("apk.history", "view"),
  validate(historyQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    requireOutletAccess(req, req.query.outletId);
    const history = await dataService.getPosHistory(req.query);
    res.json({ success: true, data: history });
  })
);

router.post(
  "/report-pin/verify",
  requireAuth,
  requirePermission("apk.reports", "view"),
  validate(reportPinSchema),
  asyncHandler(async (req, res) => {
    const result = await dataService.verifyReportPin(req.body.pin, req.auth.id);
    if (!result.valid) {
      throw validationError({ pin: ["PIN laporan tidak valid."] });
    }
    res.json({ success: true, data: { valid: true } });
  })
);

router.get(
  "/discounts",
  requireAuth,
  requirePermission("apk.sales", "view"),
  validate(discountQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    requireOutletAccess(req, req.query.outletId);
    const discounts = await dataService.getPosDiscounts(req.query);
    res.json({ success: true, data: discounts });
  })
);

router.post(
  "/discounts",
  requireAuth,
  requirePermission("apk.sales", "update"),
  validate(flexibleObjectSchema),
  asyncHandler(async (req, res) => {
    const outletId = field(req.body, "outletId", "outlet_id");
    requireOutletAccess(req, outletId);

    try {
      const discount = await dataService.createPosDiscount(req.body, req.auth.id);
      res.json({ success: true, data: discount });
    } catch (error) {
      throw normalizeServiceError(error);
    }
  })
);

router.put(
  "/discounts/:id",
  requireAuth,
  requirePermission("apk.sales", "update"),
  validate(flexibleObjectSchema),
  asyncHandler(async (req, res) => {
    const outletId = field(req.body, "outletId", "outlet_id");
    requireOutletAccess(req, outletId);

    try {
      const discount = await dataService.updatePosDiscount(req.params.id, req.body, req.auth.id);
      res.json({ success: true, data: discount });
    } catch (error) {
      throw normalizeServiceError(error);
    }
  })
);

/**
 * @swagger
 * /api/pos/reports:
 *   get:
 *     summary: Ambil ringkasan laporan POS untuk APK
 *     tags: [POS Sync]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: outletId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Ringkasan omzet, payment, transaksi, dan expense
 *       401:
 *         description: Token tidak valid
 *       403:
 *         description: Outlet tidak tersedia untuk user
 */
router.get(
  "/reports",
  requireAuth,
  requirePermission("apk.reports", "view"),
  validate(reportQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    requireOutletAccess(req, req.query.outletId);
    const report = await dataService.getPosReports(req.query);
    res.json({ success: true, data: report });
  })
);

/**
 * @swagger
 * /api/pos/expenses:
 *   get:
 *     summary: Ambil riwayat pengeluaran POS per outlet untuk APK
 *     tags: [POS Sync]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: outletId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Daftar pengeluaran POS mobile
 *       401:
 *         description: Token tidak valid
 *       403:
 *         description: Outlet tidak tersedia untuk user
 */
router.get(
  "/expenses",
  requireAuth,
  requirePermission("apk.expenses", "view"),
  validate(reportQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    requireOutletAccess(req, req.query.outletId);
    const expenses = await dataService.getPosExpenses(req.query);
    res.json({ success: true, data: expenses });
  })
);

router.get(
  "/material-stocks",
  requireAuth,
  requireAnyPermission([
    { permissionKey: "apk.purchases", action: "view" },
    { permissionKey: "apk.transfers", action: "view" },
    { permissionKey: "apk.opnames", action: "view" }
  ]),
  validate(materialStockQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const outletIds = splitQueryList(req.query.outletIds);
    const accessibleOutletIds = req.auth?.outlet_ids || [];
    const hasAccessibleOutlet = outletIds.some((outletId) => accessibleOutletIds.includes(outletId));
    if (!hasAccessibleOutlet) {
      throw forbidden("Outlet tidak tersedia untuk user ini.");
    }
    const stocks = await dataService.getPosMaterialStocks(req.query);
    res.json({ success: true, data: stocks });
  })
);

router.get(
  "/product-favorites",
  requireAuth,
  requirePermission("apk.sales", "view"),
  validate(productFavoriteQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    requireOutletAccess(req, req.query.outletId);
    const favorites = await dataService.getPosProductFavorites(req.query, req.auth.id);
    res.json({ success: true, data: favorites });
  })
);

router.put(
  "/product-favorites",
  requireAuth,
  requirePermission("apk.sales", "update"),
  validate(productFavoritePayloadSchema),
  asyncHandler(async (req, res) => {
    requireOutletAccess(req, req.body.outlet_id);

    try {
      const favorites = await dataService.updatePosProductFavorites(req.body, req.auth.id);
      res.json({ success: true, data: favorites });
    } catch (error) {
      throw normalizeServiceError(error);
    }
  })
);

router.get(
  "/purchases",
  requireAuth,
  requirePermission("apk.purchases", "view"),
  validate(purchaseQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    requireOutletAccess(req, req.query.outletId);
    const purchases = await dataService.getPosPurchases(req.query);
    res.json({ success: true, data: purchases });
  })
);

router.get(
  "/transfers",
  requireAuth,
  requirePermission("apk.transfers", "view"),
  validate(transferQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    requireOutletAccess(req, req.query.outletId);
    const transfers = await dataService.getPosTransfers(req.query);
    res.json({ success: true, data: transfers });
  })
);

router.get(
  "/stock-opname-worksheet",
  requireAuth,
  requirePermission("apk.opnames", "view"),
  validate(opnameWorksheetQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    requireOutletAccess(req, req.query.outletId);
    const worksheet = await dataService.getPosStockOpnameWorksheet(req.query);
    res.json({ success: true, data: worksheet });
  })
);

router.get(
  "/stock-opname-requests",
  requireAuth,
  requirePermission("apk.opnames", "view"),
  validate(opnameQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    requireOutletAccess(req, req.query.outletId);
    const requests = await dataService.getPosStockOpnameRequests(req.query);
    res.json({ success: true, data: requests });
  })
);

/**
 * @swagger
 * /api/pos/customers:
 *   get:
 *     summary: Cari customer POS per outlet untuk APK
 *     tags: [POS Sync]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: outletId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: keyword
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Daftar customer aktif
 *       401:
 *         description: Token tidak valid
 *       403:
 *         description: Outlet tidak tersedia untuk user
 *   post:
 *     summary: Tambah customer POS dari APK
 *     tags: [POS Sync]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Customer baru atau existing berdasarkan nomor HP
 *       401:
 *         description: Token tidak valid
 *       403:
 *         description: Outlet tidak tersedia untuk user
 *       422:
 *         description: Payload customer tidak valid
 */
router.get(
  "/customers",
  requireAuth,
  requirePermission("apk.sales", "view"),
  validate(customerQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    requireOutletAccess(req, req.query.outletId);
    const customers = await dataService.getPosCustomers(req.query);
    res.json({ success: true, data: customers });
  })
);

router.post(
  "/customers",
  requireAuth,
  requirePermission("apk.sales", "create"),
  validate(customerPayloadSchema),
  asyncHandler(async (req, res) => {
    const outletId = field(req.body, "outletId", "outlet_id");
    requireOutletAccess(req, outletId);

    try {
      const customer = await dataService.createPosCustomer(req.body, req.auth.id);
      res.json({ success: true, data: customer });
    } catch (error) {
      throw normalizeServiceError(error);
    }
  })
);

/**
 * @swagger
 * /api/pos/transactions:
 *   post:
 *     summary: Sync transaksi paid dari APK Kasir
 *     tags: [POS Sync]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Transaksi berhasil disimpan atau sudah pernah tersimpan
 *       401:
 *         description: Token tidak valid
 *       403:
 *         description: Outlet tidak tersedia untuk user
 *       422:
 *         description: Payload transaksi tidak valid
 */
router.post(
  "/transactions",
  requireAuth,
  requirePermission("apk.sales", "create"),
  validate(flexibleObjectSchema),
  asyncHandler(async (req, res) => {
    const outletId = field(req.body, "outletId", "outlet_id");
    requireOutletAccess(req, outletId);

    try {
      const transaction = await dataService.createPosTransaction(req.body, req.auth.id);
      res.json({ success: true, data: transaction });
    } catch (error) {
      throw normalizeServiceError(error);
    }
  })
);

/**
 * @swagger
 * /api/pos/open-bills:
 *   get:
 *     summary: Ambil open bill aktif per outlet
 *     tags: [POS Sync]
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
 *         description: Daftar open bill aktif
 *       401:
 *         description: Token tidak valid
 *       403:
 *         description: Outlet tidak tersedia untuk user
 *   post:
 *     summary: Buat open bill dari APK Kasir
 *     tags: [POS Sync]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Open bill berhasil dibuat atau sudah pernah tersimpan
 *       422:
 *         description: Payload open bill tidak valid
 */
router.get(
  "/open-bills",
  requireAuth,
  requirePermission("apk.sales", "view"),
  validate(openBillQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    requireOutletAccess(req, req.query.outletId);
    const bills = await dataService.getOpenBills({ outletId: req.query.outletId });
    res.json({ success: true, data: bills });
  })
);

router.post(
  "/open-bills",
  requireAuth,
  validate(flexibleObjectSchema),
  asyncHandler(async (req, res) => {
    const outletId = field(req.body, "outletId", "outlet_id");
    requireOutletAccess(req, outletId);

    const billId = field(req.body, "id", "id");
    const orderNumber = field(req.body, "orderNumber", "order_number");
    const existingBills = await dataService.getOpenBills({ outletId });
    const existing = existingBills.find((item) => item.id === billId || item.orderNumber === orderNumber);
    const requiredAction = existing ? "update" : "create";
    if (!can(req.auth, "apk.sales", requiredAction)) {
      throw forbidden(`Butuh permission apk.sales:${requiredAction}.`);
    }

    try {
      const bill = await dataService.upsertOpenBill(req.body);
      res.json({ success: true, data: bill });
    } catch (error) {
      throw normalizeServiceError(error);
    }
  })
);

router.put(
  "/open-bills/:id/print-checkpoint",
  requireAuth,
  requirePermission("apk.sales", "print"),
  validate(flexibleObjectSchema),
  asyncHandler(async (req, res) => {
    const outletId = field(req.body, "outletId", "outlet_id");
    requireOutletAccess(req, outletId);
    try {
      const accessibleBill = (await dataService.getOpenBills({ outletId }))
        .find((item) => item.id === req.params.id);
      if (!accessibleBill) throw forbidden("Open bill tidak tersedia untuk outlet ini.");
      const bill = await dataService.updateOpenBillPrintCheckpoint(
        req.params.id,
        req.body,
        req.auth.id
      );
      res.json({ success: true, data: bill });
    } catch (error) {
      throw normalizeServiceError(error);
    }
  })
);

/**
 * @swagger
 * /api/pos/open-bills/{id}:
 *   put:
 *     summary: Update open bill dari APK Kasir
 *     tags: [POS Sync]
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
 *         description: Open bill berhasil diupdate
 *       422:
 *         description: Payload open bill tidak valid
 *   delete:
 *     summary: Batalkan open bill dari APK Kasir
 *     tags: [POS Sync]
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
 *         description: Open bill berhasil dibatalkan atau sudah tidak ada
 */
router.put(
  "/open-bills/:id",
  requireAuth,
  requirePermission("apk.sales", "update"),
  validate(flexibleObjectSchema),
  asyncHandler(async (req, res) => {
    const outletId = field(req.body, "outletId", "outlet_id");
    requireOutletAccess(req, outletId);

    try {
      const bill = await dataService.upsertOpenBill({ ...req.body, id: req.params.id });
      res.json({ success: true, data: bill });
    } catch (error) {
      throw normalizeServiceError(error);
    }
  })
);

router.delete(
  "/open-bills/:id",
  requireAuth,
  requirePermission("apk.sales", "cancel"),
  asyncHandler(async (req, res) => {
    const bills = await dataService.getOpenBills({ outletId: "all" });
    const bill = bills.find((item) => item.id === req.params.id || item.orderNumber === req.params.id);
    if (bill) requireOutletAccess(req, bill.outletId);
    const result = await dataService.deleteOpenBill(req.params.id);
    res.json({ success: true, data: result });
  })
);

/**
 * @swagger
 * /api/pos/expenses:
 *   post:
 *     summary: Sync pengeluaran dari APK Kasir
 *     tags: [POS Sync]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pengeluaran berhasil disimpan atau sudah pernah tersimpan
 *       401:
 *         description: Token tidak valid
 *       403:
 *         description: Outlet tidak tersedia untuk user
 *       422:
 *         description: Payload pengeluaran tidak valid
 */
router.post(
  "/expenses",
  requireAuth,
  requirePermission("apk.expenses", "create"),
  validate(flexibleObjectSchema),
  asyncHandler(async (req, res) => {
    const outletId = field(req.body, "outletId", "outlet_id");
    requireOutletAccess(req, outletId);

    try {
      const expense = await dataService.createPosExpense(req.body, req.auth.id);
      res.json({ success: true, data: expense });
    } catch (error) {
      throw normalizeServiceError(error);
    }
  })
);

router.put(
  "/expenses/:id",
  requireAuth,
  requirePermission("apk.expenses", "update"),
  validate(flexibleObjectSchema),
  asyncHandler(async (req, res) => {
    const outletId = field(req.body, "outletId", "outlet_id");
    requireOutletAccess(req, outletId);

    try {
      const expense = await dataService.updatePosExpense(req.params.id, req.body, req.auth.id);
      res.json({ success: true, data: expense });
    } catch (error) {
      throw normalizeServiceError(error);
    }
  })
);

router.post(
  "/purchase-batches",
  requireAuth,
  requirePermission("apk.purchases", "create"),
  validate(flexibleObjectSchema),
  asyncHandler(async (req, res) => {
    const outletId = field(req.body, "outletId", "outlet_id");
    requireOutletAccess(req, outletId);

    try {
      const purchase = await dataService.createPosPurchaseBatch(req.body, req.auth.id);
      res.json({ success: true, data: purchase });
    } catch (error) {
      throw normalizeServiceError(error);
    }
  })
);

router.put(
  "/purchases/:id",
  requireAuth,
  requirePermission("apk.purchases", "update"),
  validate(flexibleObjectSchema),
  asyncHandler(async (req, res) => {
    const outletId = field(req.body, "outletId", "outlet_id");
    requireOutletAccess(req, outletId);

    try {
      const purchase = await dataService.updatePosPurchaseBatch(req.params.id, req.body, req.auth.id);
      res.json({ success: true, data: purchase });
    } catch (error) {
      throw normalizeServiceError(error);
    }
  })
);

router.post(
  "/transfer-requests",
  requireAuth,
  requirePermission("apk.transfers", "create"),
  validate(flexibleObjectSchema),
  asyncHandler(async (req, res) => {
    const fromOutletId = field(req.body, "fromOutletId", "from_outlet_id");
    requireOutletAccess(req, fromOutletId);

    try {
      const transfer = await dataService.createPosTransferRequest(req.body, req.auth.id);
      res.json({ success: true, data: transfer });
    } catch (error) {
      throw normalizeServiceError(error);
    }
  })
);

router.post(
  "/stock-opname-requests",
  requireAuth,
  requirePermission("apk.opnames", "create"),
  validate(flexibleObjectSchema),
  asyncHandler(async (req, res) => {
    const outletId = field(req.body, "outletId", "outlet_id");
    requireOutletAccess(req, outletId);

    try {
      const request = await dataService.createPosStockOpnameRequest(req.body, req.auth.id);
      res.json({ success: true, data: request });
    } catch (error) {
      throw normalizeServiceError(error);
    }
  })
);

/**
 * @swagger
 * /api/pos/stock-opname-requests/{id}:
 *   put:
 *     summary: Edit request stock opname pending milik user APK
 *     tags: [POS Sync]
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
 *             required: [outlet_id, rows]
 *     responses:
 *       200:
 *         description: Request pending berhasil diperbarui
 *       403:
 *         description: Request bukan milik user login
 *       409:
 *         description: Request sudah diproses Admin
 */
router.put(
  "/stock-opname-requests/:id",
  requireAuth,
  requirePermission("apk.opnames", "update"),
  validate(flexibleObjectSchema),
  asyncHandler(async (req, res) => {
    const outletId = field(req.body, "outletId", "outlet_id");
    requireOutletAccess(req, outletId);

    try {
      const request = await dataService.updatePosStockOpnameRequest(req.params.id, req.body, req.auth.id);
      res.json({ success: true, data: request });
    } catch (error) {
      throw normalizeServiceError(error);
    }
  })
);

router.get(
  "/reports/account-detail",
  requireAuth,
  requirePermission("apk.reports", "view"),
  asyncHandler(async (req, res) => {
    const outletId = req.query.outletId || req.query.outlet_id;
    if (outletId) requireOutletAccess(req, outletId);

    const data = await dataService.getReportAccountDetail({
      report: req.query.report || "profit_loss",
      accountCode: req.query.accountCode || req.query.account_code,
      from: req.query.from,
      to: req.query.to,
      outletId
    });
    res.json({ success: true, data });
  })
);

router.post(
  "/activity-logs",
  requireAuth,
  requireApkAccess,
  validate(z.object({ logs: z.array(flexibleObjectSchema).optional() }).passthrough()),
  asyncHandler(async (req, res) => {
    const logs = Array.isArray(req.body.logs) ? req.body.logs : [req.body];
    if (logs.length > 100) throw validationError({ logs: "Maksimal 100 event per batch." });

    logs.forEach((log) => {
      const outletId = field(log, "outletId", "outlet_id");
      if (outletId) requireOutletAccess(req, outletId);
    });

    const secureLog = (log) => ({
      ...log,
      actor_user_id: req.auth.id,
      actor_role: req.auth.role_id,
      source: "kasir_app",
      event_type: log.event_type || log.eventType || "interaction",
      ip_address: req.ip
    });
    const result = logs.length === 1
      ? await dataService.createActivityLog(secureLog(logs[0]))
      : await dataService.createActivityLogs(
          logs.map(secureLog)
        );
    res.json({ success: true, data: result });
  })
);

module.exports = router;
