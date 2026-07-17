import React, { useState, useMemo } from "react";
import {
  useDailyReports,
  useApproveDailyReport,
  useRejectDailyReport,
  useUpdateDailyReport,
  useDeleteDailyReport,
  useStockOpnameRequests,
  useApproveStockOpnameRequest,
  useRejectStockOpnameRequest,
  useUpdateStockOpnameRequest,
  useDeleteStockOpnameRequest,
  useBootstrap,
} from "@/hooks/useAdminQueries";
import { useAppStore } from "@/store/appStore";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  ClipboardList, 
  CheckCircle2, 
  XCircle, 
  Eye, 
  Printer,
  Store,
  User,
  Loader2,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Boxes,
  FileEdit,
  Trash2,
  Calendar
} from "lucide-react";

export default function ReportApprovalPage() {
  const selectedGlobalOutletId = useAppStore((s) => s.selectedOutletId);
  const bootstrap = useBootstrap();
  
  // Filters state
  const [outletFilter, setOutletFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [activeTab, setActiveTab] = useState("daily");

  const activeOutletId = outletFilter === "all" ? selectedGlobalOutletId : outletFilter;

  const outlets = bootstrap.data?.outlets || [];
  const users = bootstrap.data?.users || [];

  const getOutletName = (id) => outlets.find((o) => o.id === id)?.name || id || "-";
  const getCashierName = (id) => users.find((u) => u.id === id)?.name || id || "-";

  // Helpers
  const isEditAllowed = (reportDateStr) => {
    if (!reportDateStr) return false;
    const now = new Date();
    const cleanDateStr = reportDateStr.includes(" ") ? reportDateStr.split(" ")[0] : reportDateStr;
    const parts = cleanDateStr.split("-");
    if (parts.length < 3) return false;
    
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    
    // Batas edit keesokan hari jam 12.00 WIB
    const limitDate = new Date(year, month, day + 1, 12, 0, 0, 0);
    return now.getTime() <= limitDate.getTime();
  };

  const setDatePreset = (preset) => {
    const today = new Date();
    const todayStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, '0') + "-" + String(today.getDate()).padStart(2, '0');
    
    if (preset === "today") {
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (preset === "7days") {
      const past = new Date();
      past.setDate(today.getDate() - 7);
      const pastStr = past.getFullYear() + "-" + String(past.getMonth() + 1).padStart(2, '0') + "-" + String(past.getDate()).padStart(2, '0');
      setStartDate(pastStr);
      setEndDate(todayStr);
    } else if (preset === "month") {
      const firstDayStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, '0') + "-01";
      setStartDate(firstDayStr);
      setEndDate(todayStr);
    }
  };

  const generateDailyReportNo = (report) => {
    if (!report.report_date) return `DREP-${report.id}`;
    const cleanDate = report.report_date.replace(/-/g, "");
    return `DREP-${cleanDate}-${String(report.id).slice(-4).toUpperCase()}`;
  };

  const generateLogisticReportNo = (req) => {
    const opnameDate = req.opname_date || req.date || "";
    if (!opnameDate) return `LOG-${req.id}`;
    const cleanDate = opnameDate.split(" ")[0].replace(/-/g, "");
    return `LOG-${cleanDate}-${String(req.id).slice(-4).toUpperCase()}`;
  };

  // ─── 1. LAPORAN HARIAN STATE & LOGIC ──────────────────────────────────────
  const { data: dailyReports = [], isLoading: isLoadingDaily, refetch: refetchDaily } = useDailyReports({
    outletId: activeOutletId,
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  const approveDailyMutation = useApproveDailyReport();
  const rejectDailyMutation = useRejectDailyReport();
  const updateDailyMutation = useUpdateDailyReport();
  const deleteDailyMutation = useDeleteDailyReport();

  const [detailDaily, setDetailDaily] = useState(null);
  const [editDaily, setEditDaily] = useState(null);

  const filteredDailyReports = useMemo(() => {
    return dailyReports.filter((report) => {
      if (startDate && report.report_date < startDate) return false;
      if (endDate && report.report_date > endDate) return false;
      return true;
    });
  }, [dailyReports, startDate, endDate]);

  const handleDeleteDaily = async (id) => {
    if (window.confirm("Apakah Anda yakin ingin menghapus laporan harian ini?")) {
      try {
        await deleteDailyMutation.mutateAsync(id);
        refetchDaily();
      } catch (e) {}
    }
  };

  // Edit Daily Form Fields State
  const [editCashIncome, setEditCashIncome] = useState(0);
  const [editTransferIncome, setEditTransferIncome] = useState(0);
  const [editQrisIncome, setEditQrisIncome] = useState(0);
  const [editReturnCashAmount, setEditReturnCashAmount] = useState(0);
  const [editDailyDetails, setEditDailyDetails] = useState([]);

  const openEditDaily = (report) => {
    setEditDaily(report);
    setEditCashIncome(report.cash_income);
    setEditTransferIncome(report.transfer_income);
    setEditQrisIncome(report.qris_income);
    setEditReturnCashAmount(report.return_cash_amount);
    setEditDailyDetails(report.details_json || []);
  };

  const handleEditDailyDetailChange = (index, field, value) => {
    const updated = [...editDailyDetails];
    updated[index] = {
      ...updated[index],
      [field]: value,
      amount: field === "quantity" || field === "price" 
          ? Number(value) * Number(field === "quantity" ? updated[index].price : updated[index].quantity)
          : (field === "amount" ? Number(value) : updated[index].amount)
    };
    setEditDailyDetails(updated);
  };

  const handleSaveDaily = async () => {
    try {
      const detailsExpenseTotal = editDailyDetails.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const totalIncome = Number(editCashIncome) + Number(editTransferIncome) + Number(editQrisIncome);
      const grossProfit = totalIncome - detailsExpenseTotal;
      const drawerMoney = Number(editCashIncome) - detailsExpenseTotal - Number(editReturnCashAmount);

      const payload = {
        cashIncome: Number(editCashIncome),
        transferIncome: Number(editTransferIncome),
        qrisIncome: Number(editQrisIncome),
        totalIncome,
        totalExpense: detailsExpenseTotal,
        returnCashAmount: Number(editReturnCashAmount),
        grossProfit,
        drawerMoney,
        details: editDailyDetails
      };

      await updateDailyMutation.mutateAsync({ id: editDaily.id, payload });
      refetchDaily();
      setEditDaily(null);
    } catch (e) {
      // handled by toast
    }
  };

  const handleSaveAndApproveDaily = async () => {
    try {
      const detailsExpenseTotal = editDailyDetails.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const totalIncome = Number(editCashIncome) + Number(editTransferIncome) + Number(editQrisIncome);
      const grossProfit = totalIncome - detailsExpenseTotal;
      const drawerMoney = Number(editCashIncome) - detailsExpenseTotal - Number(editReturnCashAmount);

      const payload = {
        cashIncome: Number(editCashIncome),
        transferIncome: Number(editTransferIncome),
        qrisIncome: Number(editQrisIncome),
        totalIncome,
        totalExpense: detailsExpenseTotal,
        returnCashAmount: Number(editReturnCashAmount),
        grossProfit,
        drawerMoney,
        details: editDailyDetails
      };

      // Simpan perubahan dulu
      await updateDailyMutation.mutateAsync({ id: editDaily.id, payload });
      // Baru approve
      await approveDailyMutation.mutateAsync(editDaily.id);
      
      refetchDaily();
      setEditDaily(null);
    } catch (e) {
      // handled by toast
    }
  };

  // ─── 2. LAPORAN LOGISTIK STATE & LOGIC ────────────────────────────────────
  const { data: logisticRequests = [], isLoading: isLoadingLogistic, refetch: refetchLogistic } = useStockOpnameRequests({
    outletId: activeOutletId,
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  const approveLogisticMutation = useApproveStockOpnameRequest();
  const rejectLogisticMutation = useRejectStockOpnameRequest();
  const updateLogisticMutation = useUpdateStockOpnameRequest();
  const deleteLogisticMutation = useDeleteStockOpnameRequest();

  const [detailLogistic, setDetailLogistic] = useState(null);
  const [editLogistic, setEditLogistic] = useState(null);

  const filteredLogisticRequests = useMemo(() => {
    return logisticRequests.filter((req) => {
      const opnameDate = req.opname_date || req.date;
      if (!opnameDate) return true;
      const cleanDate = opnameDate.split(" ")[0];
      if (startDate && cleanDate < startDate) return false;
      if (endDate && cleanDate > endDate) return false;
      return true;
    });
  }, [logisticRequests, startDate, endDate]);

  const combinedReportsSummary = useMemo(() => {
    const list = [];
    
    filteredDailyReports.forEach((report) => {
      list.push({
        type: "Laporan Harian",
        date: report.report_date,
        outletId: report.outlet_id,
        reportNo: generateDailyReportNo(report),
        status: report.status === "approved" || report.status === "rejected" ? "Done" : "Not Done",
        rawStatus: report.status,
        original: report
      });
    });

    filteredLogisticRequests.forEach((req) => {
      list.push({
        type: "Laporan Logistik",
        date: (req.opname_date || req.date || "").split(" ")[0],
        outletId: req.outlet_id,
        reportNo: generateLogisticReportNo(req),
        status: req.status === "approved" || req.status === "rejected" ? "Done" : "Not Done",
        rawStatus: req.status,
        original: req
      });
    });

    // Sort by date (terbaru ke terlama)
    return list.sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [filteredDailyReports, filteredLogisticRequests]);

  const handleDeleteLogistic = async (id) => {
    if (window.confirm("Apakah Anda yakin ingin menghapus request opname ini?")) {
      try {
        await deleteLogisticMutation.mutateAsync(id);
        refetchLogistic();
      } catch (e) {}
    }
  };

  // Edit Logistic Form State
  const [editLogisticItems, setEditLogisticItems] = useState([]);
  const [editLogisticNote, setEditLogisticNote] = useState("");

  const openEditLogistic = (req) => {
    setEditLogistic(req);
    setEditLogisticNote(req.note || "");
    setEditLogisticItems(req.items || []);
  };

  const handleEditLogisticQtyChange = (index, field, value) => {
    const updated = [...editLogisticItems];
    const qty = Number(value);
    const opening = updated[index].openingQuantity;
    const damage = field === "damageQuantity" ? qty : (updated[index].damageQuantity || 0);
    const actual = field === "actualQuantity" ? qty : (updated[index].actualQuantity || 0);

    updated[index] = {
      ...updated[index],
      [field]: qty,
      difference: actual - opening
    };
    setEditLogisticItems(updated);
  };

  const handleSaveLogistic = async () => {
    try {
      const payload = {
        ...editLogistic,
        note: editLogisticNote,
        items: editLogisticItems
      };
      await updateLogisticMutation.mutateAsync({ id: editLogistic.id, payload });
      refetchLogistic();
      setEditLogistic(null);
    } catch (e) {
      // handled by toast
    }
  };

  const handleSaveAndApproveLogistic = async () => {
    try {
      const payload = {
        ...editLogistic,
        note: editLogisticNote,
        items: editLogisticItems
      };
      // Simpan perubahan dulu
      await updateLogisticMutation.mutateAsync({ id: editLogistic.id, payload });
      // Baru approve
      await approveLogisticMutation.mutateAsync({ id: editLogistic.id, payload: {} });
      
      refetchLogistic();
      setEditLogistic(null);
    } catch (e) {
      // handled by toast
    }
  };

  const formatQty = (val) => {
    if (val === undefined || val === null) return "-";
    const num = Number(val);
    return num % 1 === 0 ? num.toString() : num.toFixed(2);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Persetujuan Laporan</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Verifikasi, edit, dan setujui Laporan Harian Keuangan Kasir serta Laporan Opname Logistik Bahan Baku.
          </p>
        </div>
      </div>

      {/* ─── Filters ────────────────────────────────────────────────────── */}
      <Card className="bg-slate-50/50">
        <CardContent className="pt-4 flex flex-wrap gap-4 items-end">
          <div className="space-y-1.5 w-60">
            <Label className="text-xs font-semibold">Filter Outlet</Label>
            <Select value={outletFilter} onValueChange={setOutletFilter}>
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="Pilih Outlet..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Outlet</SelectItem>
                {outlets.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 w-48">
            <Label className="text-xs font-semibold">Status Persetujuan</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="Status..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="pending">Menunggu (Pending)</SelectItem>
                <SelectItem value="approved">Disetujui (Approved)</SelectItem>
                <SelectItem value="rejected">Ditolak (Rejected)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 w-40">
            <Label className="text-xs font-semibold">Dari Tanggal</Label>
            <div className="relative">
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                max={endDate || undefined}
                className="bg-white pl-8"
              />
              <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            </div>
          </div>

          <div className="space-y-1.5 w-40">
            <Label className="text-xs font-semibold">Sampai Tanggal</Label>
            <div className="relative">
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate || undefined}
                className="bg-white pl-8"
              />
              <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            </div>
          </div>

          <div className="space-y-1.5 flex flex-col justify-end">
            <span className="text-[10px] font-semibold text-muted-foreground mb-0.5">Preset Cepat:</span>
            <div className="flex gap-1">
              <Button variant="outline" size="xs" onClick={() => setDatePreset("today")} className="h-8 text-[10px] px-2.5 bg-white hover:bg-slate-50">Hari Ini</Button>
              <Button variant="outline" size="xs" onClick={() => setDatePreset("7days")} className="h-8 text-[10px] px-2.5 bg-white hover:bg-slate-50">7 Hari</Button>
              <Button variant="outline" size="xs" onClick={() => setDatePreset("month")} className="h-8 text-[10px] px-2.5 bg-white hover:bg-slate-50">Bulan Ini</Button>
            </div>
          </div>

          {(startDate || endDate || outletFilter !== "all" || statusFilter !== "pending") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStartDate("");
                setEndDate("");
                setOutletFilter("all");
                setStatusFilter("pending");
              }}
              className="text-xs text-muted-foreground hover:text-foreground h-9 px-3"
            >
              Reset Filter
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ─── Tabs Content ────────────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-[480px] grid-cols-3">
          <TabsTrigger value="daily">Laporan Harian</TabsTrigger>
          <TabsTrigger value="logistic">Laporan Logistik</TabsTrigger>
          <TabsTrigger value="summary">Semua Status Laporan</TabsTrigger>
        </TabsList>

        {/* ─── TAB 1: LAPORAN HARIAN ──────────────────────────────────────── */}
        <TabsContent value="daily" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {isLoadingDaily ? (
                <div className="flex h-64 items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : dailyReports.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center gap-2">
                  <ClipboardList className="h-10 w-10 text-muted-foreground" />
                  <p className="text-sm font-medium text-muted-foreground">Tidak ada antrean laporan harian.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No Laporan</TableHead>
                      <TableHead>Tanggal Laporan</TableHead>
                      <TableHead>Outlet</TableHead>
                      <TableHead>Kasir</TableHead>
                      <TableHead className="text-right">Total Pendapatan</TableHead>
                      <TableHead className="text-right">Total Pengeluaran</TableHead>
                      <TableHead className="text-right">Setoran Kas</TableHead>
                      <TableHead className="text-right">Laba Kotor</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                      <TableHead className="w-[260px] text-center">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDailyReports.map((report) => {
                      let badgeVariant = "secondary";
                      if (report.status === "approved") badgeVariant = "success";
                      if (report.status === "pending") badgeVariant = "warning";
                      if (report.status === "rejected") badgeVariant = "destructive";

                      const editAllowed = isEditAllowed(report.report_date);

                      return (
                        <TableRow key={report.id}>
                          <TableCell className="font-mono font-bold text-[10px] text-slate-700">
                            {generateDailyReportNo(report)}
                          </TableCell>
                          <TableCell className="font-semibold text-xs">{report.report_date}</TableCell>
                          <TableCell className="text-xs">{getOutletName(report.outlet_id)}</TableCell>
                          <TableCell className="text-xs">{getCashierName(report.cashier_id)}</TableCell>
                          <TableCell className="text-right text-xs font-medium text-green-600">
                            {formatCurrency(report.total_income)}
                          </TableCell>
                          <TableCell className="text-right text-xs font-medium text-amber-600">
                            {formatCurrency(report.total_expense)}
                          </TableCell>
                          <TableCell className="text-right text-xs font-medium text-blue-600">
                            {formatCurrency(report.return_cash_amount)}
                          </TableCell>
                          <TableCell className="text-right text-xs font-semibold">
                            {formatCurrency(report.gross_profit)}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant={badgeVariant} className="uppercase text-[9px]">
                              {report.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center flex justify-center items-center gap-1.5 pt-3">
                            <Button
                              variant="outline"
                              size="sm"
                              title="Detail"
                              onClick={() => setDetailDaily(report)}
                              className="h-8 px-2 text-xs"
                            >
                              <Eye className="h-4 w-4 mr-0.5" /> Preview
                            </Button>

                            {report.status === "pending" && (
                              <>
                                {editAllowed ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    title="Edit"
                                    onClick={() => openEditDaily(report)}
                                    className="h-8 px-2 text-xs text-blue-600 hover:text-blue-700"
                                  >
                                    <FileEdit className="h-4 w-4 mr-0.5" /> Edit
                                  </Button>
                                ) : (
                                  <span className="text-[9px] text-red-500 font-semibold italic border border-red-200 bg-red-50 px-1 rounded" title="Batas waktu edit (12:00 WIB keesokan harinya) sudah terlewati">
                                    Locked
                                  </span>
                                )}
                                <Button
                                  variant="success"
                                  size="sm"
                                  title="Setujui"
                                  onClick={async () => {
                                    if (editAllowed) {
                                      openEditDaily(report);
                                    } else {
                                      await approveDailyMutation.mutateAsync(report.id);
                                      refetchDaily();
                                    }
                                  }}
                                  disabled={approveDailyMutation.isPending || rejectDailyMutation.isPending}
                                  className="h-8 px-2"
                                >
                                  <CheckCircle2 className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  title="Tolak"
                                  onClick={async () => {
                                    await rejectDailyMutation.mutateAsync(report.id);
                                    refetchDaily();
                                  }}
                                  disabled={approveDailyMutation.isPending || rejectDailyMutation.isPending}
                                  className="h-8 px-2"
                                >
                                  <XCircle className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  title="Hapus"
                                  onClick={() => handleDeleteDaily(report.id)}
                                  disabled={deleteDailyMutation.isPending}
                                  className="h-8 px-2 bg-red-600 hover:bg-red-700"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── TAB 2: LAPORAN LOGISTIK (STOCK OPNAME) ───────────────────────── */}
        <TabsContent value="logistic" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {isLoadingLogistic ? (
                <div className="flex h-64 items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : logisticRequests.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center gap-2">
                  <ClipboardList className="h-10 w-10 text-muted-foreground" />
                  <p className="text-sm font-medium text-muted-foreground">Tidak ada antrean request opname logistik.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No Laporan</TableHead>
                      <TableHead>Tanggal Opname</TableHead>
                      <TableHead>Outlet</TableHead>
                      <TableHead>Pembuat</TableHead>
                      <TableHead>Catatan</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                      <TableHead className="w-[260px] text-center">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLogisticRequests.map((req) => {
                      let badgeVariant = "secondary";
                      if (req.status === "approved") badgeVariant = "success";
                      if (req.status === "pending") badgeVariant = "warning";
                      if (req.status === "rejected") badgeVariant = "destructive";

                      const editAllowed = isEditAllowed(req.opname_date || req.date);

                      return (
                        <TableRow key={req.id}>
                          <TableCell className="font-mono font-bold text-[10px] text-slate-700">
                            {generateLogisticReportNo(req)}
                          </TableCell>
                          <TableCell className="text-xs">{req.opname_date || req.date}</TableCell>
                          <TableCell className="text-xs">{getOutletName(req.outlet_id)}</TableCell>
                          <TableCell className="text-xs">{getCashierName(req.created_by)}</TableCell>
                          <TableCell className="text-xs max-w-xs truncate">{req.note || "-"}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant={badgeVariant} className="uppercase text-[9px]">
                              {req.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center flex justify-center items-center gap-1.5 pt-3">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setDetailLogistic(req)}
                              className="h-8 px-2 text-xs"
                            >
                              <Eye className="h-4 w-4 mr-0.5" /> Preview
                            </Button>

                            {req.status === "pending" && (
                              <>
                                {editAllowed ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    title="Edit"
                                    onClick={() => openEditLogistic(req)}
                                    className="h-8 px-2 text-xs text-blue-600 hover:text-blue-700"
                                  >
                                    <FileEdit className="h-4 w-4 mr-0.5" /> Edit
                                  </Button>
                                ) : (
                                  <span className="text-[9px] text-red-500 font-semibold italic border border-red-200 bg-red-50 px-1 rounded" title="Batas waktu edit (12:00 WIB keesokan harinya) sudah terlewati">
                                    Locked
                                  </span>
                                )}
                                <Button
                                  variant="success"
                                  size="sm"
                                  title="Setujui"
                                  onClick={async () => {
                                    if (editAllowed) {
                                      openEditLogistic(req);
                                    } else {
                                      await approveLogisticMutation.mutateAsync({ id: req.id, payload: {} });
                                      refetchLogistic();
                                    }
                                  }}
                                  disabled={approveLogisticMutation.isPending || rejectLogisticMutation.isPending}
                                  className="h-8 px-2"
                                >
                                  <CheckCircle2 className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  title="Tolak"
                                  onClick={async () => {
                                    await rejectLogisticMutation.mutateAsync({ id: req.id, payload: {} });
                                    refetchLogistic();
                                  }}
                                  disabled={approveLogisticMutation.isPending || rejectLogisticMutation.isPending}
                                  className="h-8 px-2"
                                >
                                  <XCircle className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  title="Hapus"
                                  onClick={() => handleDeleteLogistic(req.id)}
                                  disabled={deleteLogisticMutation.isPending}
                                  className="h-8 px-2 bg-red-600 hover:bg-red-700"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── TAB 3: SEMUA STATUS LAPORAN (DONE / NOT DONE) ──────────────── */}
        <TabsContent value="summary" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {combinedReportsSummary.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center gap-2">
                  <ClipboardList className="h-10 w-10 text-muted-foreground" />
                  <p className="text-sm font-medium text-muted-foreground">Tidak ada laporan dengan filter yang dipilih.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16 text-center">No</TableHead>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Tipe Laporan</TableHead>
                      <TableHead>Nama Outlet</TableHead>
                      <TableHead>Nomor Laporan</TableHead>
                      <TableHead className="text-center w-48">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {combinedReportsSummary.map((item, index) => {
                      const isDone = item.status === "Done";
                      let badgeColor = "bg-red-100 text-red-700 hover:bg-red-200 border-red-200"; // Not Done
                      if (isDone) {
                        badgeColor = item.rawStatus === "approved" 
                          ? "bg-green-100 text-green-700 hover:bg-green-200 border-green-200" 
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200 border-slate-200"; // Rejected
                      }
                      
                      return (
                        <TableRow key={`${item.type}-${item.reportNo}-${index}`}>
                          <TableCell className="text-center font-medium">{index + 1}</TableCell>
                          <TableCell>{item.date}</TableCell>
                          <TableCell className="font-semibold text-slate-600">{item.type}</TableCell>
                          <TableCell>{getOutletName(item.outletId)}</TableCell>
                          <TableCell className="font-mono text-xs">{item.reportNo}</TableCell>
                          <TableCell className="text-center">
                            <Badge className={`uppercase text-[9px] font-bold border ${badgeColor}`}>
                              {item.status === "Done" ? `DONE (${item.rawStatus})` : "NOT DONE"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ─── DETAILED DIALOG: LAPORAN HARIAN ────────────────────────────────── */}
      {detailDaily && (
        <Dialog open={!!detailDaily} onOpenChange={() => setDetailDaily(null)}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-primary" />
                Detail Laporan Harian #{detailDaily.id.split("_")[1] || detailDaily.id}
              </DialogTitle>
              <DialogDescription>
                Breakdown detail data penjualan & pengeluaran kasir tanggal {detailDaily.report_date}.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 my-2 max-h-[60vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-lg text-xs">
                <div>
                  <div className="text-muted-foreground">Outlet</div>
                  <div className="font-semibold">{getOutletName(detailDaily.outlet_id)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Kasir Input</div>
                  <div className="font-semibold">{getCashierName(detailDaily.cashier_id)}</div>
                </div>
              </div>

              {/* Pendapatan */}
              <Card className="border shadow-none">
                <CardHeader className="py-2 px-3 bg-slate-50/50">
                  <CardTitle className="text-xs font-bold uppercase flex items-center gap-1">
                    <TrendingUp className="h-3.5 w-3.5 text-green-500" /> Pendapatan Penjualan
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 text-xs space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tunai / Cash</span>
                    <span className="font-medium">{formatCurrency(detailDaily.cash_income)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Transfer Bank</span>
                    <span className="font-medium">{formatCurrency(detailDaily.transfer_income)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">QRIS</span>
                    <span className="font-medium">{formatCurrency(detailDaily.qris_income)}</span>
                  </div>
                  <div className="border-t pt-1.5 flex justify-between font-bold text-green-600">
                    <span>Total Pendapatan</span>
                    <span>{formatCurrency(detailDaily.total_income)}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Pengeluaran */}
              <Card className="border shadow-none">
                <CardHeader className="py-2 px-3 bg-slate-50/50">
                  <CardTitle className="text-xs font-bold uppercase flex items-center gap-1">
                    <TrendingDown className="h-3.5 w-3.5 text-amber-500" /> Breakdown Pengeluaran Kasir
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 text-xs">
                  {(!detailDaily.details_json || detailDaily.details_json.length === 0) ? (
                    <div className="text-center text-muted-foreground py-2">Tidak ada detail pengeluaran.</div>
                  ) : (
                    <div className="space-y-3">
                      {detailDaily.details_json.map((item, idx) => (
                        <div key={idx} className="border-b last:border-0 pb-2 last:pb-0 flex flex-col gap-0.5">
                          <div className="flex justify-between items-start font-semibold text-xs text-slate-800">
                            <span>
                              {item.isHpp 
                                ? item.rawMaterial?.name || "Bahan Baku" 
                                : item.expenseCategory?.name || "Operasional"}
                            </span>
                            <span className="text-amber-600">{formatCurrency(item.amount)}</span>
                          </div>
                          <div className="flex justify-between text-[10px] text-muted-foreground">
                            <span>Kategori: {item.isHpp ? `HPP` : `Operasional`}</span>
                            {item.isHpp && <span>Qty: {item.quantity} {item.rawMaterial?.unit} @ {formatCurrency(item.price)}</span>}
                          </div>
                          {item.note && <div className="text-[10px] text-slate-500 italic mt-0.5 bg-slate-50 px-1 rounded">Ket: {item.note}</div>}
                        </div>
                      ))}
                      <div className="border-t pt-1.5 flex justify-between font-bold text-amber-600">
                        <span>Total Pengeluaran</span>
                        <span>{formatCurrency(detailDaily.total_expense)}</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Setoran */}
              <Card className="border shadow-none">
                <CardContent className="p-3 text-xs space-y-2 bg-blue-50/20">
                  <div className="flex justify-between font-semibold">
                    <span className="flex items-center gap-1">
                      <DollarSign className="h-3.5 w-3.5 text-blue-500" /> Setoran Uang Kas
                    </span>
                    <span className="font-bold text-blue-600">{formatCurrency(detailDaily.return_cash_amount)}</span>
                  </div>
                  {detailDaily.return_cash_date && (
                    <div className="text-[10px] text-muted-foreground text-right">Tgl Setor: {detailDaily.return_cash_date}</div>
                  )}
                  <div className="border-t pt-1.5 flex justify-between">
                    <span>Laba Kotor (Pendapatan - Pengeluaran)</span>
                    <span className="font-semibold">{formatCurrency(detailDaily.gross_profit)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Selisih Uang Laci</span>
                    <span className={`font-bold ${detailDaily.drawer_money < 0 ? "text-red-500" : ""}`}>
                      {formatCurrency(detailDaily.drawer_money)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex justify-end gap-2 border-t pt-3">
              <Button variant="outline" size="sm" onClick={() => setDetailDaily(null)}>Tutup</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ─── EDIT DIALOG: LAPORAN HARIAN ────────────────────────────────────── */}
      {editDaily && (
        <Dialog open={!!editDaily} onOpenChange={() => setEditDaily(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileEdit className="h-5 w-5 text-blue-600" />
                Edit Laporan Harian #{editDaily.id.split("_")[1] || editDaily.id}
              </DialogTitle>
              <DialogDescription>
                Sesuaikan nominal pendapatan dan pengeluaran sebelum menyetujui laporan harian.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 my-2 max-h-[60vh] overflow-y-auto pr-1 text-xs">
              {/* Pendapatan Inputs */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-lg">
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold">Tunai / Cash</Label>
                  <Input 
                    type="number" 
                    value={editCashIncome} 
                    onChange={(e) => setEditCashIncome(e.target.value)} 
                    className="h-8 text-xs bg-white"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold">Transfer Bank</Label>
                  <Input 
                    type="number" 
                    value={editTransferIncome} 
                    onChange={(e) => setEditTransferIncome(e.target.value)} 
                    className="h-8 text-xs bg-white"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold">QRIS</Label>
                  <Input 
                    type="number" 
                    value={editQrisIncome} 
                    onChange={(e) => setEditQrisIncome(e.target.value)} 
                    className="h-8 text-xs bg-white"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold">Setoran Uang Kas</Label>
                  <Input 
                    type="number" 
                    value={editReturnCashAmount} 
                    onChange={(e) => setEditReturnCashAmount(e.target.value)} 
                    className="h-8 text-xs bg-white"
                  />
                </div>
              </div>

              {/* Pengeluaran Items List */}
              <Card className="border shadow-none">
                <CardHeader className="py-2 px-3 bg-slate-50/50">
                  <CardTitle className="text-xs font-bold uppercase">Breakdown Pengeluaran Kasir (Editable)</CardTitle>
                </CardHeader>
                <CardContent className="p-3 text-xs space-y-3">
                  {editDailyDetails.length === 0 ? (
                    <div className="text-center text-muted-foreground py-2">Tidak ada detail pengeluaran.</div>
                  ) : (
                    editDailyDetails.map((item, idx) => (
                      <div key={idx} className="border-b last:border-0 pb-3 last:pb-0 flex flex-col gap-2">
                        <div className="flex justify-between items-center">
                          <span className="font-semibold text-slate-800">
                            {item.isHpp ? item.rawMaterial?.name : item.expenseCategory?.name} (Kategori: {item.isHpp ? 'HPP' : 'Biaya'})
                          </span>
                          <span className="font-bold text-amber-600">{formatCurrency(item.amount)}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {item.isHpp ? (
                            <>
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">Qty ({item.rawMaterial?.unit})</Label>
                                <Input 
                                  type="number" 
                                  value={item.quantity} 
                                  onChange={(e) => handleEditDailyDetailChange(idx, "quantity", e.target.value)}
                                  className="h-7 text-xs bg-white"
                                />
                              </div>
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">Harga Satuan</Label>
                                <Input 
                                  type="number" 
                                  value={item.price} 
                                  onChange={(e) => handleEditDailyDetailChange(idx, "price", e.target.value)}
                                  className="h-7 text-xs bg-white"
                                />
                              </div>
                            </>
                          ) : (
                            <div className="space-y-0.5 col-span-2">
                              <Label className="text-[10px]">Nominal Pengeluaran</Label>
                              <Input 
                                type="number" 
                                value={item.amount} 
                                onChange={(e) => handleEditDailyDetailChange(idx, "amount", e.target.value)}
                                className="h-7 text-xs bg-white"
                              />
                            </div>
                          )}
                          <div className="space-y-0.5">
                            <Label className="text-[10px]">Keterangan/Note</Label>
                            <Input 
                              type="text" 
                              value={item.note || ""} 
                              onChange={(e) => handleEditDailyDetailChange(idx, "note", e.target.value)}
                              className="h-7 text-xs bg-white"
                            />
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="flex justify-end gap-2 border-t pt-3">
              <Button variant="outline" size="sm" onClick={() => setEditDaily(null)}>Batal</Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleSaveDaily}
                disabled={updateDailyMutation.isPending || approveDailyMutation.isPending}
                className="text-blue-600 border-blue-200 hover:bg-blue-50"
              >
                Simpan Perubahan
              </Button>
              <Button 
                variant="success" 
                size="sm" 
                onClick={handleSaveAndApproveDaily}
                disabled={updateDailyMutation.isPending || approveDailyMutation.isPending}
              >
                Simpan & Setujui
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ─── DETAILED DIALOG: LAPORAN LOGISTIK ──────────────────────────────── */}
      {detailLogistic && (
        <Dialog open={!!detailLogistic} onOpenChange={() => setDetailLogistic(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Boxes className="h-5 w-5 text-primary" />
                Detail Request Opname Logistik #{detailLogistic.id.split("_")[2] || detailLogistic.id}
              </DialogTitle>
              <DialogDescription>
                Breakdown selisih stok fisik vs stok sistem tanggal {detailLogistic.opname_date || detailLogistic.date}.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 my-2 max-h-[60vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-lg text-xs">
                <div>
                  <div className="text-muted-foreground">Outlet</div>
                  <div className="font-semibold">{getOutletName(detailLogistic.outlet_id)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Pembuat / Input</div>
                  <div className="font-semibold">{getCashierName(detailLogistic.created_by)}</div>
                </div>
              </div>

              {detailLogistic.note && (
                <div className="p-3 bg-slate-50 rounded-lg text-xs italic text-slate-600 border-l-4 border-amber-400">
                  Catatan: {detailLogistic.note}
                </div>
              )}

              <Card className="border shadow-none">
                <CardContent className="p-0">
                  <Table>
                    <TableHeader className="bg-slate-50/50">
                      <TableRow>
                        <TableHead>Nama Bahan Baku</TableHead>
                        <TableHead className="text-right">Stok Sistem</TableHead>
                        <TableHead className="text-right">Stok Fisik</TableHead>
                        <TableHead className="text-right">Selisih</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(detailLogistic.items || []).map((item, idx) => {
                        const diff = item.difference !== undefined 
                            ? item.difference 
                            : (item.actualQuantity - item.openingQuantity);
                        
                        let badgeColor = "secondary";
                        let statusText = "Normal";
                        if (diff > 0) {
                          badgeColor = "success";
                          statusText = "Selisih Lebih";
                        } else if (diff < 0) {
                          badgeColor = "destructive";
                          statusText = "Selisih Kurang";
                        }

                        return (
                          <TableRow key={idx}>
                            <TableCell className="font-medium text-xs">{item.materialName || item.material_id}</TableCell>
                            <TableCell className="text-right text-xs">{formatQty(item.openingQuantity)} {item.unit}</TableCell>
                            <TableCell className="text-right text-xs font-semibold">{formatQty(item.actualQuantity)} {item.unit}</TableCell>
                            <TableCell className={`text-right text-xs font-bold ${diff > 0 ? "text-green-600" : diff < 0 ? "text-red-500" : ""}`}>
                              {diff > 0 ? "+" : ""}{formatQty(diff)} {item.unit}
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant={badgeColor} className="text-[9px] py-0 px-1.5 uppercase">
                                {statusText}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            <div className="flex justify-end gap-2 border-t pt-3">
              <Button variant="outline" size="sm" onClick={() => setDetailLogistic(null)}>Tutup</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ─── EDIT DIALOG: LAPORAN LOGISTIK ─────────────────────────────────── */}
      {editLogistic && (
        <Dialog open={!!editLogistic} onOpenChange={() => setEditLogistic(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileEdit className="h-5 w-5 text-blue-600" />
                Edit Laporan Opname Logistik #{editLogistic.id.split("_")[2] || editLogistic.id}
              </DialogTitle>
              <DialogDescription>
                Sesuaikan jumlah stok fisik aktual hasil stock opname sebelum disetujui.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 my-2 max-h-[60vh] overflow-y-auto pr-1 text-xs">
              <div className="space-y-1">
                <Label className="text-[11px] font-semibold">Catatan Opname</Label>
                <Input 
                  type="text" 
                  value={editLogisticNote} 
                  onChange={(e) => setEditLogisticNote(e.target.value)} 
                  className="h-8 text-xs"
                />
              </div>

              {/* Editable Opname Items Table */}
              <Card className="border shadow-none">
                <CardContent className="p-0">
                  <Table>
                    <TableHeader className="bg-slate-50/50">
                      <TableRow>
                        <TableHead>Nama Bahan Baku</TableHead>
                        <TableHead className="text-right">Stok Sistem</TableHead>
                        <TableHead className="w-32 text-center">Stok Fisik</TableHead>
                        <TableHead className="w-32 text-center">Damage/Rusak</TableHead>
                        <TableHead className="text-right">Selisih</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {editLogisticItems.map((item, idx) => {
                        const diff = item.difference !== undefined 
                            ? item.difference 
                            : (item.actualQuantity - item.openingQuantity);

                        return (
                          <TableRow key={idx}>
                            <TableCell className="font-semibold text-xs">{item.materialName || item.material_id}</TableCell>
                            <TableCell className="text-right text-xs">{formatQty(item.openingQuantity)} {item.unit}</TableCell>
                            <TableCell className="text-center">
                              <Input
                                type="number"
                                value={item.actualQuantity}
                                onChange={(e) => handleEditLogisticQtyChange(idx, "actualQuantity", e.target.value)}
                                className="h-7 text-xs bg-white text-center w-24 mx-auto"
                              />
                            </TableCell>
                            <TableCell className="text-center">
                              <Input
                                type="number"
                                value={item.damageQuantity || 0}
                                onChange={(e) => handleEditLogisticQtyChange(idx, "damageQuantity", e.target.value)}
                                className="h-7 text-xs bg-white text-center w-24 mx-auto"
                              />
                            </TableCell>
                            <TableCell className={`text-right text-xs font-bold ${diff > 0 ? "text-green-600" : diff < 0 ? "text-red-500" : ""}`}>
                              {diff > 0 ? "+" : ""}{formatQty(diff)} {item.unit}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            <div className="flex justify-end gap-2 border-t pt-3">
              <Button variant="outline" size="sm" onClick={() => setEditLogistic(null)}>Batal</Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleSaveLogistic}
                disabled={updateLogisticMutation.isPending || approveLogisticMutation.isPending}
                className="text-blue-600 border-blue-200 hover:bg-blue-50"
              >
                Simpan Perubahan
              </Button>
              <Button 
                variant="success" 
                size="sm" 
                onClick={handleSaveAndApproveLogistic}
                disabled={updateLogisticMutation.isPending || approveLogisticMutation.isPending}
              >
                Simpan & Setujui
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ─── PANDUAN STATUS LAPORAN ────────────────────────────────────────── */}
      <Card className="mt-8 bg-slate-50/30 border border-slate-100 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-blue-600" />
            Panduan & Penjelasan Status Laporan
          </CardTitle>
          <CardDescription className="text-xs">
            Penjelasan pengaruh status laporan harian dan logistik terhadap sistem utama (keuangan & stok).
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/50">
                  <TableHead className="w-48 text-xs font-semibold text-slate-800">Tipe Laporan</TableHead>
                  <TableHead className="w-32 text-xs font-semibold text-center text-slate-800">Status</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-800">Arti & Penjelasan Operasional</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-800">Dampak terhadap Keuangan & Stok</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="text-xs">
                {/* Laporan Harian */}
                <TableRow className="hover:bg-slate-50/20">
                  <TableCell className="font-semibold align-top border-r text-slate-700" rowSpan={3}>
                    Laporan Harian (Keuangan)
                  </TableCell>
                  <TableCell className="text-center align-top border-r">
                    <Badge variant="secondary" className="uppercase text-[9px] font-bold bg-slate-100 text-slate-600">Pending</Badge>
                  </TableCell>
                  <TableCell className="align-top text-muted-foreground border-r">
                    Laporan baru dikirim oleh kasir melalui mobile APK. Sedang menunggu verifikasi audit oleh admin.
                  </TableCell>
                  <TableCell className="align-top text-muted-foreground">
                    Belum ada dana masuk atau pengeluaran yang diakui di pembukuan keuangan utama (laba rugi/neraca).
                  </TableCell>
                </TableRow>
                <TableRow className="hover:bg-slate-50/20">
                  <TableCell className="text-center align-top border-r">
                    <Badge variant="success" className="uppercase text-[9px] font-bold bg-green-100 text-green-700">Approved</Badge>
                  </TableCell>
                  <TableCell className="align-top border-r text-slate-700">
                    Laporan disetujui (dan diperbarui jika ada koreksi nominal oleh admin).
                  </TableCell>
                  <TableCell className="align-top text-emerald-800 font-medium bg-emerald-50/30">
                    Dana penjualan masuk ke saldo kas outlet. Pengeluaran kasir diakui, dan stok bahan baku berkurang otomatis sesuai HPP penjualan produk.
                  </TableCell>
                </TableRow>
                <TableRow className="hover:bg-slate-50/20">
                  <TableCell className="text-center align-top border-r">
                    <Badge variant="destructive" className="uppercase text-[9px] font-bold bg-red-100 text-red-700">Rejected</Badge>
                  </TableCell>
                  <TableCell className="align-top text-muted-foreground border-r">
                    Laporan ditolak oleh admin karena perbedaan angka tidak logis atau kesalahan input data kasir.
                  </TableCell>
                  <TableCell className="align-top text-muted-foreground">
                    Stok/kas tidak berubah. Kasir di aplikasi mobile wajib mengedit data pengeluaran/pendapatan lalu mengirim ulang laporan.
                  </TableCell>
                </TableRow>

                {/* Laporan Logistik */}
                <TableRow className="border-t-2 border-slate-100 hover:bg-slate-50/20">
                  <TableCell className="font-semibold align-top border-r text-slate-700" rowSpan={3}>
                    Laporan Logistik (Stock Opname)
                  </TableCell>
                  <TableCell className="text-center align-top border-r">
                    <Badge variant="secondary" className="uppercase text-[9px] font-bold bg-slate-100 text-slate-600">Pending</Badge>
                  </TableCell>
                  <TableCell className="align-top text-muted-foreground border-r">
                    Kasir mengirimkan hasil perhitungan fisik bahan baku aktual untuk meminta penyesuaian stok sistem.
                  </TableCell>
                  <TableCell className="align-top text-muted-foreground">
                    Stok bahan baku di server VPS belum diperbarui dengan stok fisik yang baru.
                  </TableCell>
                </TableRow>
                <TableRow className="hover:bg-slate-50/20">
                  <TableCell className="text-center align-top border-r">
                    <Badge variant="success" className="uppercase text-[9px] font-bold bg-green-100 text-green-700">Approved</Badge>
                  </TableCell>
                  <TableCell className="align-top border-r text-slate-700">
                    Admin menyetujui kuantitas stok aktual baru (dapat disesuaikan nominalnya jika ada koreksi).
                  </TableCell>
                  <TableCell className="align-top text-emerald-800 font-medium bg-emerald-50/30">
                    Stok sistem langsung disesuaikan dengan stok fisik baru. Jika ada selisih kurang, denda penalti logistik dihitung dan dibebankan ke outlet.
                  </TableCell>
                </TableRow>
                <TableRow className="hover:bg-slate-50/20">
                  <TableCell className="text-center align-top border-r">
                    <Badge variant="destructive" className="uppercase text-[9px] font-bold bg-red-100 text-red-700">Rejected</Badge>
                  </TableCell>
                  <TableCell className="align-top text-muted-foreground border-r">
                    Pengajuan opname ditolak karena hasil opname dinilai tidak logis atau memerlukan audit fisik ulang.
                  </TableCell>
                  <TableCell className="align-top text-muted-foreground">
                    Stok sistem tidak berubah. Kasir diizinkan melakukan stock opname ulang dan mengirim data baru dari mobile APK.
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
