const express = require("express");
const asyncHandler = require("../../utils/async-handler");
const { requireAuth } = require("../../middlewares/auth");
const dataService = require("../../services/data-service");

const router = express.Router();

// GET /api/admin/daily-reports
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const filters = {
      outletId: req.query.outletId,
      status: req.query.status,
      from: req.query.from,
      to: req.query.to
    };
    const reports = await dataService.getDailyReports(filters);
    res.json({ success: true, data: reports });
  })
);

// POST /api/admin/daily-reports
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const createdBy = req.user.id;
    const report = await dataService.createDailyReport(req.body, createdBy);
    res.json({ success: true, data: report });
  })
);

// POST /api/admin/daily-reports/:id/approve
router.post(
  "/:id/approve",
  requireAuth,
  asyncHandler(async (req, res) => {
    const approvedBy = req.user.id;
    const report = await dataService.approveDailyReport(req.params.id, approvedBy);
    res.json({ success: true, data: report });
  })
);

// POST /api/admin/daily-reports/:id/reject
router.post(
  "/:id/reject",
  requireAuth,
  asyncHandler(async (req, res) => {
    const rejectedBy = req.user.id;
    const report = await dataService.rejectDailyReport(req.params.id, rejectedBy);
    res.json({ success: true, data: report });
  })
);

module.exports = router;
