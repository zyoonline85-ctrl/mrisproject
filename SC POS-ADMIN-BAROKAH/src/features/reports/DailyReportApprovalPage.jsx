import React, { useState, useMemo } from "react";
import {
  useDailyReports,
  useApproveDailyReport,
  useRejectDailyReport,
  useBootstrap,
} from "@/hooks/useAdminQueries";
import { useAppStore } from "@/store/appStore";
import { formatCurrency, formatDateTime } from "@/lib/utils";
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
import { 
  ClipboardList, 
  CheckCircle2, 
  XCircle, 
  Eye, 
  Printer,
  Calendar,
  Store,
  User,
  Loader2,
  TrendingUp,
  TrendingDown,
  DollarSign
} from "lucide-react";

export default function DailyReportApprovalPage() {
  const selectedGlobalOutletId = useAppStore((s) => s.selectedOutletId);
  const bootstrap = useBootstrap();
  
  // Filters state
  const [outletFilter, setOutletFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [detailReport, setDetailReport] = useState(null);

  const activeOutletId = outletFilter === "all" ? selectedGlobalOutletId : outletFilter;

  // Fetch online reports
  const { data: reports = [], isLoading, refetch } = useDailyReports({
    outletId: activeOutletId,
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  const approveMutation = useApproveDailyReport();
  const rejectMutation = useRejectDailyReport();

  const outlets = bootstrap.data?.outlets || [];
  const users = bootstrap.data?.users || [];

  const getOutletName = (id) => outlets.find((o) => o.id === id)?.name || id || "-";
  const getCashierName = (id) => users.find((u) => u.id === id)?.name || id || "-";

  const handleApprove = async (id) => {
    try {
      await approveMutation.mutateAsync(id);
      refetch();
    } catch (e) {
      // error handled by hook toast
    }
  };

  const handleReject = async (id) => {
    try {
      await rejectMutation.mutateAsync(id);
      refetch();
    } catch (e) {
      // error handled by hook toast
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Persetujuan Laporan Harian</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Verifikasi dan setujui laporan harian (Pendapatan & Pengeluaran/HPP) yang dikirim oleh Kasir dari Mobile APK.
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
        </CardContent>
      </Card>

      {/* ─── Table ──────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : reports.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2">
              <ClipboardList className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-medium text-muted-foreground">Tidak ada antrean laporan harian.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tanggal Laporan</TableHead>
                  <TableHead>Outlet</TableHead>
                  <TableHead>Kasir</TableHead>
                  <TableHead className="text-right">Total Pendapatan</TableHead>
                  <TableHead className="text-right">Total Pengeluaran</TableHead>
                  <TableHead className="text-right">Setoran Kas</TableHead>
                  <TableHead className="text-right">Laba Kotor</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="w-[180px] text-center">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((report) => {
                  let badgeVariant = "secondary";
                  if (report.status === "approved") badgeVariant = "success";
                  if (report.status === "pending") badgeVariant = "warning";
                  if (report.status === "rejected") badgeVariant = "destructive";

                  return (
                    <TableRow key={report.id}>
                      <TableCell className="font-semibold">{report.report_date}</TableCell>
                      <TableCell>{getOutletName(report.outlet_id)}</TableCell>
                      <TableCell>{getCashierName(report.cashier_id)}</TableCell>
                      <TableCell className="text-right font-medium text-green-600">
                        {formatCurrency(report.total_income)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-amber-600">
                        {formatCurrency(report.total_expense)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-blue-600">
                        {formatCurrency(report.return_cash_amount)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatCurrency(report.gross_profit)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={badgeVariant} className="uppercase">
                          {report.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center flex justify-center gap-1.5 pt-3">
                        <Button
                          variant="outline"
                          size="sm"
                          title="Detail / Breakdown"
                          onClick={() => setDetailReport(report)}
                          className="h-8 px-2"
                        >
                          <Eye className="h-4 w-4 mr-1" /> Detail
                        </Button>

                        {report.status === "pending" && (
                          <>
                            <Button
                              variant="success"
                              size="sm"
                              title="Setujui Laporan"
                              onClick={() => handleApprove(report.id)}
                              disabled={approveMutation.isPending || rejectMutation.isPending}
                              className="h-8 px-2"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              title="Tolak Laporan"
                              onClick={() => handleReject(report.id)}
                              disabled={approveMutation.isPending || rejectMutation.isPending}
                              className="h-8 px-2"
                            >
                              <XCircle className="h-4 w-4" />
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

      {/* ─── Detail Modal / Struk Preview ─────────────────────────────── */}
      {detailReport && (
        <Dialog open={!!detailReport} onOpenChange={() => setDetailReport(null)}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-primary" />
                Detail Laporan Harian #{detailReport.id.split("_")[1] || detailReport.id}
              </DialogTitle>
              <DialogDescription>
                Breakdown detail data penjualan & pengeluaran kasir tanggal {detailReport.report_date}.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 my-2 max-h-[60vh] overflow-y-auto pr-1">
              {/* Header Info */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-lg text-sm">
                <div className="space-y-1">
                  <div className="text-muted-foreground flex items-center gap-1 text-xs">
                    <Store className="h-3 w-3" /> Outlet
                  </div>
                  <div className="font-semibold">{getOutletName(detailReport.outlet_id)}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-muted-foreground flex items-center gap-1 text-xs">
                    <User className="h-3 w-3" /> Kasir Input
                  </div>
                  <div className="font-semibold">{getCashierName(detailReport.cashier_id)}</div>
                </div>
              </div>

              {/* Pendapatan Sales Card */}
              <Card className="border shadow-none">
                <CardHeader className="py-2.5 px-3 bg-slate-50/50">
                  <CardTitle className="text-xs font-bold uppercase flex items-center gap-1">
                    <TrendingUp className="h-3.5 w-3.5 text-green-500" /> Pendapatan Jual
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 text-sm space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tunai / Cash</span>
                    <span className="font-medium">{formatCurrency(detailReport.cash_income)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Transfer Bank</span>
                    <span className="font-medium">{formatCurrency(detailReport.transfer_income)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">QRIS</span>
                    <span className="font-medium">{formatCurrency(detailReport.qris_income)}</span>
                  </div>
                  <div className="border-t pt-1.5 flex justify-between font-bold text-green-600">
                    <span>Total Pendapatan</span>
                    <span>{formatCurrency(detailReport.total_income)}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Pengeluaran Items List */}
              <Card className="border shadow-none">
                <CardHeader className="py-2.5 px-3 bg-slate-50/50">
                  <CardTitle className="text-xs font-bold uppercase flex items-center gap-1">
                    <TrendingDown className="h-3.5 w-3.5 text-amber-500" /> Breakdown Pengeluaran Kasir
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 text-sm">
                  {(!detailReport.details_json || detailReport.details_json.length === 0) ? (
                    <div className="text-center text-xs text-muted-foreground py-2">
                      Tidak ada detail pengeluaran/pembelian HPP yang dimasukkan.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {detailReport.details_json.map((item, idx) => (
                        <div key={idx} className="border-b last:border-0 pb-2 last:pb-0 flex flex-col gap-1">
                          <div className="flex justify-between items-start font-semibold text-xs text-slate-800">
                            <span>
                              {item.isHpp 
                                ? item.rawMaterial?.name || "Bahan Baku" 
                                : item.expenseCategory?.name || "Operasional"}
                            </span>
                            <span className="text-amber-600">{formatCurrency(item.amount)}</span>
                          </div>
                          <div className="flex justify-between text-xxs text-muted-foreground">
                            <span>
                              Kategori: {item.isHpp ? `HPP (Bahan Baku)` : `Biaya Lain`}
                            </span>
                            {item.isHpp && (
                              <span>
                                Qty: {item.quantity} {item.rawMaterial?.unit} @ {formatCurrency(item.price)}
                              </span>
                            )}
                          </div>
                          {item.note && (
                            <div className="text-xxs text-slate-500 italic mt-0.5 bg-slate-50 px-1.5 py-0.5 rounded">
                              Ket: {item.note}
                            </div>
                          )}
                        </div>
                      ))}
                      <div className="border-t pt-1.5 flex justify-between font-bold text-amber-600">
                        <span>Total Pengeluaran</span>
                        <span>{formatCurrency(detailReport.total_expense)}</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Setoran Cash & Summary */}
              <Card className="border shadow-none">
                <CardContent className="p-3 text-sm space-y-2 bg-blue-50/20">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground font-semibold flex items-center gap-1">
                      <DollarSign className="h-3.5 w-3.5 text-blue-500" /> Setoran Uang Kas
                    </span>
                    <span className="font-bold text-blue-600">{formatCurrency(detailReport.return_cash_amount)}</span>
                  </div>
                  {detailReport.return_cash_date && (
                    <div className="text-xxs text-muted-foreground text-right">
                      Tgl Setor: {detailReport.return_cash_date}
                    </div>
                  )}
                  <div className="border-t pt-1.5 flex justify-between font-semibold">
                    <span>Laba Kotor (Pendapatan - Pengeluaran)</span>
                    <span>{formatCurrency(detailReport.gross_profit)}</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span>Selisih Uang Laci</span>
                    <span className={detailReport.drawer_money < 0 ? "text-red-500 font-bold" : "font-bold"}>
                      {formatCurrency(detailReport.drawer_money)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex justify-between items-center sm:justify-between border-t pt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const printContents = document.getElementById("printable-daily-report").innerHTML;
                  const style = `<style>
                    @media print {
                      body { font-family: sans-serif; padding: 25px; color: #000; }
                      .no-print { display: none; }
                      table { width: 100%; border-collapse: collapse; margin-top: 15px; }
                      th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                      th { background-color: #f5f5f5; }
                      .text-right { text-align: right; }
                      .font-bold { font-weight: bold; }
                      .header { text-align: center; margin-bottom: 25px; }
                      .section-title { font-weight: bold; background-color: #fafafa; padding: 6px; margin-top: 20px; font-size: 14px; border-bottom: 2px solid #ccc; }
                    }
                  </style>`;
                  const printWindow = window.open("", "_blank");
                  printWindow.document.write("<html><head><title>Laporan Harian " + detailReport.report_date + "</title>" + style + "</head><body>");
                  printWindow.document.write(printContents);
                  printWindow.document.write("</body></html>");
                  printWindow.document.close();
                  printWindow.print();
                }}
                className="gap-1.5"
              >
                <Printer className="h-4 w-4" /> Print Struk
              </Button>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setDetailReport(null)}>
                  Tutup
                </Button>
                {detailReport.status === "pending" && (
                  <>
                    <Button
                      variant="success"
                      size="sm"
                      onClick={async () => {
                        await handleApprove(detailReport.id);
                        setDetailReport(null);
                      }}
                      disabled={approveMutation.isPending}
                    >
                      Setujui
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={async () => {
                        await handleReject(detailReport.id);
                        setDetailReport(null);
                      }}
                      disabled={rejectMutation.isPending}
                    >
                      Tolak
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Printable Area */}
            <div id="printable-daily-report" className="hidden">
              <div className="header">
                <h2>MRIS Integration System</h2>
                <h3>Laporan Harian Kasir (Kas & Pengeluaran)</h3>
                <p>Status: {detailReport.status.toUpperCase()}</p>
              </div>

              <table>
                <tbody>
                  <tr>
                    <td style={{ width: "35%", fontWeight: "bold" }}>Tanggal Laporan</td>
                    <td>{detailReport.report_date}</td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: "bold" }}>Outlet</td>
                    <td>{getOutletName(detailReport.outlet_id)}</td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: "bold" }}>Kasir / Pembuat</td>
                    <td>{getCashierName(detailReport.cashier_id)}</td>
                  </tr>
                </tbody>
              </table>

              <div className="section-title">📊 Rincian Pendapatan</div>
              <table>
                <tbody>
                  <tr>
                    <td>Tunai / Cash</td>
                    <td className="text-right">{formatCurrency(detailReport.cash_income)}</td>
                  </tr>
                  <tr>
                    <td>Transfer Bank</td>
                    <td className="text-right">{formatCurrency(detailReport.transfer_income)}</td>
                  </tr>
                  <tr>
                    <td>QRIS</td>
                    <td className="text-right">{formatCurrency(detailReport.qris_income)}</td>
                  </tr>
                  <tr className="font-bold">
                    <td>Total Pendapatan</td>
                    <td className="text-right">{formatCurrency(detailReport.total_income)}</td>
                  </tr>
                </tbody>
              </table>

              <div className="section-title">🛒 Rincian Pengeluaran Kasir</div>
              {(!detailReport.details_json || detailReport.details_json.length === 0) ? (
                <p>Tidak ada detail pengeluaran/pembelian HPP.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Nama Item / Biaya</th>
                      <th>Kategori</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Harga</th>
                      <th className="text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailReport.details_json.map((item, idx) => (
                      <tr key={idx}>
                        <td>
                          <div>{item.isHpp ? item.rawMaterial?.name : item.expenseCategory?.name}</div>
                          {item.note && <div style={{ fontSize: "10px", color: "#666" }}>Catatan: {item.note}</div>}
                        </td>
                        <td>{item.isHpp ? "HPP (Bahan Baku)" : "Biaya Operasional"}</td>
                        <td className="text-right">{item.isHpp ? item.quantity : "-"} {item.isHpp ? item.rawMaterial?.unit : ""}</td>
                        <td className="text-right">{item.isHpp ? formatCurrency(item.price) : "-"}</td>
                        <td className="text-right font-bold">{formatCurrency(item.amount)}</td>
                      </tr>
                    ))}
                    <tr className="font-bold">
                      <td colSpan="4">Total Pengeluaran</td>
                      <td className="text-right">{formatCurrency(detailReport.total_expense)}</td>
                    </tr>
                  </tbody>
                </table>
              )}

              <div className="section-title">🏦 Setoran Kas & Rekapitulasi</div>
              <table>
                <tbody>
                  <tr>
                    <td>Setoran Uang Kas (Setoran Bank/Laci)</td>
                    <td className="text-right font-bold" style={{ color: "blue" }}>{formatCurrency(detailReport.return_cash_amount)}</td>
                  </tr>
                  {detailReport.return_cash_date && (
                    <tr>
                      <td>Tanggal Setor Kas</td>
                      <td className="text-right">{detailReport.return_cash_date}</td>
                    </tr>
                  )}
                  <tr>
                    <td>Laba Kotor (Pendapatan - Pengeluaran)</td>
                    <td className="text-right">{formatCurrency(detailReport.gross_profit)}</td>
                  </tr>
                  <tr className="font-bold">
                    <td>Selisih Uang Laci</td>
                    <td className="text-right">{formatCurrency(detailReport.drawer_money)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
