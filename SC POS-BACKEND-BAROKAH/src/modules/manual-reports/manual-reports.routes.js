const express = require("express");
const asyncHandler = require("../../utils/async-handler");
const { requireAuth } = require("../../middlewares/auth");
const dataService = require("../../services/data-service");

const router = express.Router();

// GET /api/admin/manual-reports/daily
router.get(
  "/daily",
  requireAuth,
  asyncHandler(async (req, res) => {
    const filters = {
      outletId: req.query.outletId,
      from: req.query.from,
      to: req.query.to
    };
    const reports = await dataService.getManualDailyReports(filters);
    res.json({ success: true, data: reports });
  })
);

// POST /api/admin/manual-reports/daily
router.post(
  "/daily",
  requireAuth,
  asyncHandler(async (req, res) => {
    const createdBy = req.auth.id;
    const report = await dataService.createManualDailyReport(req.body, createdBy);
    res.json({ success: true, data: report });
  })
);

// GET /api/admin/manual-reports/logistic
router.get(
  "/logistic",
  requireAuth,
  asyncHandler(async (req, res) => {
    const filters = {
      outletId: req.query.outletId,
      from: req.query.from,
      to: req.query.to
    };
    const reports = await dataService.getManualLogisticReports(filters);
    res.json({ success: true, data: reports });
  })
);

// POST /api/admin/manual-reports/logistic
router.post(
  "/logistic",
  requireAuth,
  asyncHandler(async (req, res) => {
    const createdBy = req.auth.id;
    const report = await dataService.createManualLogisticReport(req.body, createdBy);
    res.json({ success: true, data: report });
  })
);

module.exports = router;
