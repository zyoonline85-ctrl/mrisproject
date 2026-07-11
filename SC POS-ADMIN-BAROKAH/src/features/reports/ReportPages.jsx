import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { CalendarDays, CheckCircle2, Download, Edit, Eye, Minus, Plus, RefreshCw, RotateCcw, Search, Trash2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormattedNumberInput } from "@/components/ui/formatted-number-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SimpleBarChart } from "@/components/charts/SimpleBarChart";
import { DataTable } from "@/components/shared/DataTable";
import { MetricCard } from "@/components/shared/MetricCard";
import { InlineRowActions, RowActionButton } from "@/components/shared/RowActions";
import { StatusBadge } from "@/components/shared/StatusBadge";
import {
  useActivityLogs,
  useBootstrap,
  useApproveExpense,
  useCancelTransaction,
  useCorrectTransactionItems,
  useCorrectExpense,
  useRefundTransaction,
  useRejectExpense,
  useReportAccountDetail,
  useReports,
  useSalesOutletComparison
} from "@/hooks/useAdminQueries";
import { adminApi } from "@/lib/adminApi";
import { recordActivity } from "@/lib/activityAudit";
import { can } from "@/lib/permissions";
import { getTransactionCashierLabel, getTransactionItemProductLabel, getTransactionTableLabel } from "@/lib/transactionNormalization";
import { formatCurrency, formatDate, formatDateTime, getLocalDateKey, getLocalHour, toDateString } from "@/lib/utils";
import { useAppStore } from "@/store/appStore";

function getDefaultReportRange() {
  const today = new Date();
  return {
    from: toDateString(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: toDateString(today)
  };
}

function getMonthStartDate(value) {
  const date = value ? new Date(`${value}T00:00:00`) : new Date();
  return toDateString(new Date(date.getFullYear(), date.getMonth(), 1));
}

function getSourceFallback(source) {
  if (source === "admin_web") return "Admin Web";
  if (source === "kasir_app") return "APK Kasir";
  if (source === "backend") return "Backend";
  return "-";
}

function getInputUserName(row) {
  return row?.created_by_user?.name || row?.requested_user?.name || row?.user?.name || getSourceFallback(row?.source);
}

function ReportFilters({ canExport, exportDisabled = false, exportLabel = "Export", filterMode = "range", filters, onApply, onExport, isFetching }) {
  const { control, handleSubmit } = useForm({
    defaultValues: filters
  });
  const isAsOf = filterMode === "asOf";
  function applyFilters(values) {
    recordActivity({ module: "report", action: "filter_apply", description: "Menerapkan filter laporan.", metadata: { from: values.from || null, to: values.to || null, filter_mode: filterMode } });
    return onApply(values);
  }

  return (
    <form className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-soft lg:flex-row lg:items-end lg:justify-between" onSubmit={handleSubmit(applyFilters)}>
      <div>
        <h2 className="text-[15px] font-semibold">Filter Laporan</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {isAsOf ? "Neraca menampilkan posisi aset, kewajiban, dan equity per tanggal laporan." : "Rentang tanggal memakai React Hook Form dan query akan refetch via React Query."}
        </p>
      </div>
      <div className={isAsOf ? "grid gap-3 sm:grid-cols-[180px_auto_auto]" : "grid gap-3 sm:grid-cols-[160px_160px_auto_auto]"}>
        {isAsOf ? null : (
          <div className="space-y-1.5">
            <Label htmlFor="from">Dari</Label>
            <Controller
              name="from"
              control={control}
              render={({ field }) => (
                <DatePicker
                  id="from"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  placeholder="Pilih tanggal awal"
                />
              )}
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="to">{isAsOf ? "Tanggal Laporan" : "Sampai"}</Label>
          <Controller
            name="to"
            control={control}
            render={({ field }) => (
              <DatePicker
                id="to"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                placeholder={isAsOf ? "Pilih tanggal laporan" : "Pilih tanggal akhir"}
              />
            )}
          />
        </div>
        <Button type="submit" className="self-end">
          <RefreshCw className={isFetching ? "animate-spin" : ""} />
          Terapkan
        </Button>
        {canExport ? (
          <Button type="button" variant="outline" className="self-end" onClick={onExport} disabled={exportDisabled || !onExport}>
            <Download />
            {exportLabel}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

const activityLogSourceOptions = [
  { label: "Semua sumber", value: "all" },
  { label: "APK Kasir", value: "kasir_app" },
  { label: "Admin Web", value: "admin_web" }
];

const activityLogTypeOptions = [
  { label: "Semua tipe", value: "all" },
  { label: "Audit Bisnis", value: "business" },
  { label: "Interaksi UI", value: "interaction" },
  { label: "Sistem", value: "system" }
];

const activityLogOutcomeOptions = [
  { label: "Semua hasil", value: "all" },
  { label: "Berhasil", value: "succeeded" },
  { label: "Gagal", value: "failed" },
  { label: "Dibatalkan", value: "cancelled" }
];

function ActivityLogFilters({ filters, isFetching, onApply, users = [] }) {
  const { control, handleSubmit } = useForm({
    defaultValues: { source: "all", eventType: "all", outcome: "all", actorId: "all", module: "", action: "", keyword: "", ...filters }
  });

  function applyFilters(values) {
    recordActivity({ module: "activity_log", action: "filter_apply", description: "Menerapkan filter Log Aktivitas.", metadata: values });
    onApply(values);
  }

  return (
    <form className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-soft lg:flex-row lg:items-end lg:justify-between" onSubmit={handleSubmit(applyFilters)}>
      <div>
        <h2 className="text-[15px] font-semibold">Filter Log Aktivitas</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">Filter tanggal dan sumber data aktivitas yang tercatat ke backend.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        <div className="space-y-1.5">
          <Label htmlFor="activity-from">Dari</Label>
          <Controller
            name="from"
            control={control}
            render={({ field }) => (
              <DatePicker
                id="activity-from"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                placeholder="Pilih tanggal awal"
              />
            )}
          />
        </div>
        <div className="space-y-1.5">
          <Label>User</Label>
          <Controller name="actorId" control={control} render={({ field }) => (
            <Select value={field.value || "all"} onValueChange={field.onChange}>
              <SelectTrigger><SelectValue placeholder="Semua user" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua user</SelectItem>
                {users.map((user) => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="activity-module">Modul</Label>
          <Controller name="module" control={control} render={({ field }) => <Input id="activity-module" placeholder="Semua modul" {...field} />} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="activity-action">Aksi</Label>
          <Controller name="action" control={control} render={({ field }) => <Input id="activity-action" placeholder="Semua aksi" {...field} />} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="activity-keyword">Pencarian</Label>
          <Controller name="keyword" control={control} render={({ field }) => <Input id="activity-keyword" placeholder="Keterangan atau ID" {...field} />} />
        </div>
        <div className="space-y-1.5">
          <Label>Tipe</Label>
          <Controller name="eventType" control={control} render={({ field }) => (
            <Select value={field.value || "all"} onValueChange={field.onChange}>
              <SelectTrigger><SelectValue placeholder="Semua tipe" /></SelectTrigger>
              <SelectContent>{activityLogTypeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
          )} />
        </div>
        <div className="space-y-1.5">
          <Label>Hasil</Label>
          <Controller name="outcome" control={control} render={({ field }) => (
            <Select value={field.value || "all"} onValueChange={field.onChange}>
              <SelectTrigger><SelectValue placeholder="Semua hasil" /></SelectTrigger>
              <SelectContent>{activityLogOutcomeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
          )} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="activity-to">Sampai</Label>
          <Controller
            name="to"
            control={control}
            render={({ field }) => (
              <DatePicker
                id="activity-to"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                placeholder="Pilih tanggal akhir"
              />
            )}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Sumber Data</Label>
          <Controller
            name="source"
            control={control}
            render={({ field }) => (
              <Select value={field.value || "all"} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Semua sumber" />
                </SelectTrigger>
                <SelectContent>
                  {activityLogSourceOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <Button type="submit" className="self-end">
          <RefreshCw className={isFetching ? "animate-spin" : ""} />
          Terapkan
        </Button>
      </div>
    </form>
  );
}

function ReportMultiSelectFilter({ getLabel, label, onChange, options = [], placeholder, selectedIds = [] }) {
  const [keyword, setKeyword] = useState("");
  const selectedSet = new Set(selectedIds);
  const filteredOptions = options.filter((option) => getLabel(option).toLowerCase().includes(keyword.trim().toLowerCase()));
  const buttonLabel = selectedIds.length ? `${selectedIds.length} dipilih` : placeholder;

  function toggle(id) {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-9 w-full justify-start gap-2 px-3 text-left">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{buttonLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-3" align="end">
        <div className="space-y-3">
          <div>
            <p className="text-[12px] font-semibold">{label}</p>
            <p className="text-[11px] text-muted-foreground">Kosong berarti semua data aktif ikut dibaca.</p>
          </div>
          <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={`Cari ${label.toLowerCase()}`} />
          <Button type="button" variant="ghost" size="sm" className="px-0" onClick={() => onChange([])} disabled={!selectedIds.length}>
            Reset ke semua
          </Button>
          <div className="max-h-72 overflow-y-auto rounded-md border">
            {filteredOptions.length ? (
              filteredOptions.map((option) => (
                <label key={option.id} className="flex cursor-pointer items-center gap-2 border-b px-3 py-2 text-[12px] last:border-b-0 hover:bg-muted/45">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={selectedSet.has(option.id)}
                    onChange={() => toggle(option.id)}
                  />
                  <span className="min-w-0 flex-1 truncate">{getLabel(option)}</span>
                </label>
              ))
            ) : (
              <div className="px-3 py-4 text-[12px] text-muted-foreground">Data tidak ditemukan.</div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function getPaymentLabel(paymentMethods = [], code) {
  const method = paymentMethods.find((item) => item.code === code);
  return method?.name || String(code || "-").toUpperCase();
}

function normalizeTransactionPayment(payment, transaction) {
  const method = String(payment?.method || payment?.payment_method || payment?.paymentMethod || "").trim();
  if (!method) return null;

  return {
    ...payment,
    method,
    amount: Number(payment?.amount ?? payment?.paid_amount ?? payment?.paidAmount ?? transaction?.total ?? 0),
    change_amount: Number(payment?.change_amount ?? payment?.changeAmount ?? 0)
  };
}

function paymentRowsFromBreakdown(breakdown) {
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) return [];
  return Object.entries(breakdown).map(([method, amount]) => ({ method, amount }));
}

function getTransactionPayments(transaction) {
  const rows = Array.isArray(transaction?.payments)
    ? transaction.payments
    : Array.isArray(transaction?.payment_details)
      ? transaction.payment_details
      : Array.isArray(transaction?.paymentDetails)
        ? transaction.paymentDetails
        : Array.isArray(transaction?.transaction_payments)
          ? transaction.transaction_payments
          : Array.isArray(transaction?.transactionPayments)
            ? transaction.transactionPayments
            : paymentRowsFromBreakdown(transaction?.payment_breakdown || transaction?.paymentBreakdown);
  const payments = rows.map((payment) => normalizeTransactionPayment(payment, transaction)).filter(Boolean);

  if (payments.length) return payments;

  const fallback = normalizeTransactionPayment(transaction?.payment || transaction, transaction);
  return fallback ? [fallback] : [];
}

function getTransactionPaymentLabel(paymentMethods = [], transaction) {
  const payments = getTransactionPayments(transaction);
  if (!payments.length) return getPaymentLabel(paymentMethods, transaction?.payment?.method || transaction?.payment_method);
  return payments.map((payment) => getPaymentLabel(paymentMethods, payment.method)).join(" + ");
}

function getTransactionPaidAmount(transaction) {
  const payments = getTransactionPayments(transaction);
  if (payments.length) {
    return payments.reduce((total, payment) => total + Number(payment.amount || 0), 0);
  }
  return Number(transaction?.payment?.amount ?? transaction?.paid_amount ?? transaction?.paidAmount ?? transaction?.total ?? 0);
}

function getTransactionChangeAmount(transaction) {
  const explicitChange = Number(transaction?.change_amount ?? transaction?.changeAmount ?? 0);
  const paymentChange = getTransactionPayments(transaction).reduce((total, payment) => total + Number(payment.change_amount || 0), 0);
  if (paymentChange) return paymentChange;
  if (explicitChange) return explicitChange;
  return Math.max(getTransactionPaidAmount(transaction) - Number(transaction?.total || 0), 0);
}

function getServiceTypeLabel(serviceType) {
  if (serviceType === "dine_in") return "Dine In";
  if (serviceType === "takeaway") return "Takeaway";
  return serviceType || "-";
}

function getTransactionNotePreview(note) {
  const value = String(note || "").trim();
  if (!value) return "-";
  return value.length > 42 ? `${value.slice(0, 42)}...` : value;
}

function getTransactionItemVariants(item) {
  let metadata = item.metadata_json || {};
  if (typeof metadata === "string") {
    try {
      metadata = JSON.parse(metadata || "{}");
    } catch {
      metadata = {};
    }
  }
  return item.selectedVariants || item.selected_variants || metadata.selected_variants || [];
}

function TransactionDetailDialog({ onOpenChange, open, paymentMethods, transaction }) {
  if (!transaction) return null;

  const items = transaction.items || [];
  const payments = getTransactionPayments(transaction);
  const note = String(transaction.note || "").trim();
  const correctionReason = String(transaction.correction_reason || "").trim();
  const refund = transaction.refund || null;
  const isCancelled = transaction.status === "cancelled";
  const detailRows = [
    ["Order", transaction.order_number],
    ["Waktu", formatDateTime(transaction.transaction_date)],
    ["Outlet", transaction.outlet?.name || "-"],
    ["Kasir", getTransactionCashierLabel(transaction)],
    ["Customer", transaction.customer?.name || transaction.customer_name || "Umum"],
    ["Service", getServiceTypeLabel(transaction.service_type)],
    ["Meja", getTransactionTableLabel(transaction)],
    ["Payment", getTransactionPaymentLabel(paymentMethods, transaction)],
    ["Dibayar", formatCurrency(getTransactionPaidAmount(transaction))],
    ["Kembalian", formatCurrency(getTransactionChangeAmount(transaction))],
    ["Status", transaction.status || "-"]
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-5rem)] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detail Transaksi</DialogTitle>
          <DialogDescription>Catatan dari APK kasir tampil di sini sebagai metadata transaksi.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-3">
          {detailRows.map(([label, value]) => (
            <div key={label} className="rounded-md border bg-muted/20 p-3">
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</p>
              <p className="mt-1 text-[13px] font-medium">{value}</p>
            </div>
          ))}
        </div>

        <div className="rounded-md border bg-muted/20 p-3">
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">Catatan</p>
          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed">{note || "-"}</p>
        </div>

        {payments.length ? (
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Breakdown Pembayaran</p>
              <Badge variant={payments.length > 1 ? "info" : "outline"}>{payments.length} metode</Badge>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {payments.map((payment, index) => (
                <div key={payment.id || `${payment.method}-${index}`} className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-[13px]">
                  <span className="font-medium">{getPaymentLabel(paymentMethods, payment.method)}</span>
                  <span className="font-semibold tabular-nums">{formatCurrency(payment.amount || 0)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {correctionReason ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
            <p className="text-[11px] font-semibold uppercase text-amber-800">Koreksi Terakhir</p>
            <div className="mt-2 grid gap-2 text-[13px] md:grid-cols-2">
              <div>
                <span className="text-amber-800/80">Waktu</span>
                <p className="font-semibold">{transaction.updated_at ? formatDateTime(transaction.updated_at) : "-"}</p>
              </div>
              <div>
                <span className="text-amber-800/80">Oleh</span>
                <p className="font-semibold">{transaction.updated_by_user?.name || transaction.updated_by || "-"}</p>
              </div>
            </div>
            <div className="mt-2">
              <span className="text-[12px] text-amber-800/80">Alasan perubahan</span>
              <p className="mt-1 whitespace-pre-wrap text-[13px] font-medium leading-relaxed">{correctionReason}</p>
            </div>
          </div>
        ) : null}

        {refund ? (
          <div className="rounded-md border border-destructive/25 bg-destructive/5 p-3">
            <p className="text-[11px] font-semibold uppercase text-destructive">Refund</p>
            <div className="mt-2 grid gap-2 text-[13px] md:grid-cols-2">
              <div>
                <span className="text-muted-foreground">Nominal</span>
                <p className="font-semibold tabular-nums">{formatCurrency(refund.refund_amount || transaction.total || 0)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Waktu</span>
                <p className="font-semibold">{formatDateTime(refund.refunded_at)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Oleh</span>
                <p className="font-semibold">{refund.refunded_by_user?.name || refund.refunded_by || "-"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Payment Awal</span>
                <p className="font-semibold">{getPaymentLabel(paymentMethods, refund.payment_method)}</p>
              </div>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed">{refund.reason || "-"}</p>
          </div>
        ) : null}

        {isCancelled ? (
          <div className="rounded-md border border-destructive/25 bg-destructive/5 p-3">
            <p className="text-[11px] font-semibold uppercase text-destructive">Cancel</p>
            <div className="mt-2 grid gap-2 text-[13px] md:grid-cols-2">
              <div>
                <span className="text-muted-foreground">Waktu</span>
                <p className="font-semibold">{transaction.cancelled_at ? formatDateTime(transaction.cancelled_at) : "-"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Oleh</span>
                <p className="font-semibold">{transaction.cancelled_by_user?.name || transaction.cancelled_by || "-"}</p>
              </div>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed">{transaction.cancel_reason || "-"}</p>
          </div>
        ) : null}

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produk</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Harga</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length ? (
                items.map((item) => {
                  const subtotal = Number(item.subtotal || Number(item.quantity || 0) * Number(item.unit_price || 0));
                  return (
                    <TableRow key={item.id || item.product_id}>
                      <TableCell className="font-medium">
                        <div>{getTransactionItemProductLabel(item)}</div>
                        {getTransactionItemVariants(item).length ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {getTransactionItemVariants(item).map((variant) => (
                              <Badge key={variant.id || variant.name} variant="info">
                                {variant.name}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(item.unit_price || 0)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(subtotal)}</TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-[12px] text-muted-foreground">
                    Item transaksi tidak tersedia.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="grid gap-2 rounded-md border bg-muted/20 p-3 text-[13px] md:ml-auto md:w-80">
          <div className="flex items-center justify-between gap-3">
            <span>Subtotal</span>
            <span className="font-semibold tabular-nums">{formatCurrency(transaction.subtotal || transaction.total || 0)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>Discount</span>
            <span className="font-semibold text-destructive tabular-nums">
              {transaction.discount ? `-${formatCurrency(transaction.discount)}` : "-"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 border-t pt-2 text-[15px] font-bold">
            <span>Total Belanja</span>
            <span className="tabular-nums">{formatCurrency(transaction.total || 0)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>Dibayar</span>
            <span className="font-semibold tabular-nums">{formatCurrency(getTransactionPaidAmount(transaction))}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>Kembalian</span>
            <span className="font-semibold tabular-nums">{formatCurrency(getTransactionChangeAmount(transaction))}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function transactionProductPrice(product, outletId) {
  const prices = product?.all_prices || product?.prices || [];
  const row = prices.find(
    (price) => price.outlet_id === outletId && price.status !== "inactive" && Number(price.price || 0) > 0
  );
  return Number(row?.price || 0);
}

function initialTransactionDiscountEdit(transaction) {
  const rawType = String(transaction?.discount_type || "").toLowerCase();
  const discountAmount = Math.max(0, Number(transaction?.discount || 0));
  if (rawType === "percent" || rawType === "nominal") {
    return {
      type: rawType,
      value: Math.max(0, Number(transaction?.discount_value || 0))
    };
  }
  if (discountAmount > 0) {
    return {
      type: "nominal",
      value: discountAmount
    };
  }
  return { type: "none", value: 0 };
}

function normalizeDiscountEdit(type, value, subtotal) {
  const normalizedType = type === "percent" || type === "nominal" ? type : "none";
  if (normalizedType === "none" || subtotal <= 0) return { type: "none", value: 0, amount: 0 };
  const safeValue = Math.max(0, Number(value || 0));
  if (normalizedType === "percent") {
    const percent = Math.min(100, Math.round(safeValue));
    return {
      type: "percent",
      value: percent,
      amount: Math.min(subtotal, Math.round((subtotal * percent) / 100))
    };
  }
  const nominal = Math.round(safeValue);
  return {
    type: "nominal",
    value: nominal,
    amount: Math.min(subtotal, nominal)
  };
}

function calculateEditedTransactionTotals(transaction, items, discountEdit = initialTransactionDiscountEdit(transaction)) {
  const subtotal = items.reduce((total, item) => total + Number(item.unit_price || 0) * Number(item.quantity || 0), 0);
  const discount = normalizeDiscountEdit(discountEdit.type, discountEdit.value, subtotal).amount;
  const tax = Math.max(0, Number(transaction?.tax || 0));
  return { subtotal, discount, tax, total: Math.max(0, subtotal - discount + tax) };
}

function getManualDiscountLabel(row = {}) {
  const type = String(row.discount_type || row.discountType || "").toLowerCase();
  const value = Number(row.discount_value ?? row.discountValue ?? 0);
  if (type === "percent" && value > 0) return `Discount ${Math.min(100, Math.round(value))}%`;
  if (type === "nominal" && value > 0) return `Discount ${formatCurrency(value)}`;
  const discount = Number(row.discount || 0);
  return discount > 0 ? `Discount ${formatCurrency(discount)}` : "Discount";
}

function getStoredDiscountName(row = {}) {
  const name = String(row.discount_master?.name || row.discount_name || row.discountName || "").trim();
  return name.toLowerCase() === "diskon manual" ? "" : name;
}

function editableTransactionItem(item) {
  const variants = getTransactionItemVariants(item);
  return {
    key: item.id,
    id: item.id,
    product_id: item.product_id,
    product_name: getTransactionItemProductLabel(item),
    quantity: Number(item.quantity || 0),
    unit_price: Number(item.unit_price || 0),
    variant_ids: variants.map((variant) => variant.id).filter(Boolean),
    variants,
    is_new: false
  };
}

function EditTransactionItemsDialog(props) {
  if (!props.transaction) return null;
  const version = props.transaction.updated_at || props.transaction.transaction_date || "initial";
  return <EditTransactionItemsDialogContent key={`${props.transaction.id}:${version}`} {...props} />;
}

function EditTransactionItemsDialogContent({ onOpenChange, open, products, transaction }) {
  const mutation = useCorrectTransactionItems();
  const [items, setItems] = useState(() => (transaction.items || []).map(editableTransactionItem));
  const [discountEdit, setDiscountEdit] = useState(() => initialTransactionDiscountEdit(transaction));
  const [reason, setReason] = useState("");
  const [paidAmount, setPaidAmount] = useState(() => getTransactionPaidAmount(transaction));
  const [search, setSearch] = useState("");
  const [pendingProduct, setPendingProduct] = useState(null);
  const [selectedVariantIds, setSelectedVariantIds] = useState([]);
  const [showReasonError, setShowReasonError] = useState(false);

  const outletId = transaction.outlet_id || transaction.outlet?.id;
  const activeProducts = (products || [])
    .filter((product) => product.status === "active" && transactionProductPrice(product, outletId) > 0)
    .filter((product) => `${product.name || ""} ${product.sku || ""}`.toLowerCase().includes(search.trim().toLowerCase()))
    .slice(0, 8);
  const totals = calculateEditedTransactionTotals(transaction, items, discountEdit);
  const normalizedDiscount = normalizeDiscountEdit(discountEdit.type, discountEdit.value, totals.subtotal);
  const payments = getTransactionPayments(transaction);
  const isPaid = transaction.status === "paid";
  const hasCashPayment = payments.some((payment) => String(payment.method || "").toLowerCase() === "cash");
  const paymentMethodLabel = payments.length ? payments.map((payment) => payment.method).join(" + ") : transaction.payment?.method || "-";
  const effectivePaidAmount = isPaid && !hasCashPayment ? totals.total : paidAmount;
  const paymentDifference = effectivePaidAmount - totals.total;
  const originalSignature = JSON.stringify((transaction.items || []).map((item) => [item.id, Number(item.quantity || 0)]).sort());
  const nextSignature = JSON.stringify(items.filter((item) => item.id).map((item) => [item.id, Number(item.quantity || 0)]).sort());
  const hasNewItems = items.some((item) => item.is_new);
  const originalDiscount = normalizeDiscountEdit(initialTransactionDiscountEdit(transaction).type, initialTransactionDiscountEdit(transaction).value, totals.subtotal);
  const hasDiscountChanges = originalDiscount.type !== normalizedDiscount.type || Number(originalDiscount.value || 0) !== Number(normalizedDiscount.value || 0);
  const hasChanges = originalSignature !== nextSignature || hasNewItems || hasDiscountChanges;
  const canSubmit = items.length > 0 && reason.trim() && hasChanges && (!isPaid || !hasCashPayment || paymentDifference >= 0);

  function updateQuantity(key, delta) {
    setItems((rows) => rows.map((item) => (item.key === key ? { ...item, quantity: Math.max(1, item.quantity + delta) } : item)));
  }

  function removeItem(key) {
    setItems((rows) => rows.filter((item) => item.key !== key));
  }

  function addProduct(product, variantIds = []) {
    const variants = (product.variants || []).filter((variant) => variantIds.includes(variant.id));
    const identity = `${product.id}:${[...variantIds].sort().join(",")}`;
    setItems((rows) => {
      const existing = rows.find((item) => `${item.product_id}:${[...(item.variant_ids || [])].sort().join(",")}` === identity);
      if (existing) return rows.map((item) => (item.key === existing.key ? { ...item, quantity: item.quantity + 1 } : item));
      return [
        ...rows,
        {
          key: `new_${Date.now()}_${rows.length}`,
          product_id: product.id,
          product_name: product.name,
          quantity: 1,
          unit_price: transactionProductPrice(product, outletId),
          variant_ids: variantIds,
          variants,
          is_new: true
        }
      ];
    });
    setPendingProduct(null);
    setSelectedVariantIds([]);
    setSearch("");
  }

  function chooseProduct(product) {
    const activeVariants = (product.variants || []).filter((variant) => variant.status !== "inactive");
    if (!activeVariants.length) {
      addProduct(product, []);
      return;
    }
    setPendingProduct(product);
    setSelectedVariantIds([]);
  }

  async function submit() {
    if (!reason.trim()) {
      setShowReasonError(true);
      return;
    }
    if (!canSubmit) return;
    try {
      await mutation.mutateAsync({
        id: transaction.id,
        payload: {
          reason: reason.trim(),
          expected_status: transaction.status,
          expected_updated_at: transaction.updated_at || transaction.transaction_date,
          items: items.map((item) =>
            item.id
              ? { id: item.id, quantity: item.quantity }
              : { product_id: item.product_id, variant_ids: item.variant_ids || [], quantity: item.quantity }
          ),
          discount_type: normalizedDiscount.type === "none" ? null : normalizedDiscount.type,
          discount_value: normalizedDiscount.type === "none" ? 0 : normalizedDiscount.value,
          ...(isPaid && hasCashPayment ? { paid_amount: paidAmount } : {})
        }
      });
      onOpenChange(false);
    } catch (_error) {
      // Error toast is handled by the mutation hook.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Item Transaksi</DialogTitle>
          <DialogDescription>
            {transaction.order_number} · {transaction.outlet?.name || transaction.outlet_name || outletId} · {transaction.status}
          </DialogDescription>
        </DialogHeader>

        {isPaid ? null : (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-900">
            Transaksi sudah {transaction.status}. Koreksi hanya mengubah data item dan total historis; stok, pembayaran, refund, dan poin tidak berubah.
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.8fr)]">
          <div className="space-y-3">
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produk</TableHead>
                    <TableHead className="w-32 text-center">Qty</TableHead>
                    <TableHead className="text-right">Harga</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length ? (
                    items.map((item) => (
                      <TableRow key={item.key}>
                        <TableCell>
                          <div className="font-medium">{item.product_name}</div>
                          {item.variants?.length ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {item.variants.map((variant) => <Badge key={variant.id || variant.name} variant="info">{variant.name}</Badge>)}
                            </div>
                          ) : null}
                          <div className="mt-1 text-[10px] text-muted-foreground">{item.is_new ? "Harga aktif outlet" : "Harga transaksi"}</div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            <Button type="button" variant="outline" size="icon" onClick={() => updateQuantity(item.key, -1)}><Minus /></Button>
                            <span className="w-8 text-center font-semibold tabular-nums">{item.quantity}</span>
                            <Button type="button" variant="outline" size="icon" onClick={() => updateQuantity(item.key, 1)}><Plus /></Button>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(item.unit_price)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{formatCurrency(item.unit_price * item.quantity)}</TableCell>
                        <TableCell>
                          <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => removeItem(item.key)}><Trash2 /></Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow><TableCell colSpan={5} className="py-8 text-center text-destructive">Minimal satu item wajib dipertahankan. Gunakan Cancel untuk membatalkan transaksi.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="rounded-md border bg-muted/10 p-3">
              <Label htmlFor="transaction-product-search">Tambah produk</Label>
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input id="transaction-product-search" value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Cari nama produk atau SKU" />
              </div>
              {search.trim() ? (
                <div className="mt-2 max-h-52 divide-y overflow-y-auto rounded-md border bg-background">
                  {activeProducts.length ? activeProducts.map((product) => (
                    <button key={product.id} type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/50" onClick={() => chooseProduct(product)}>
                      <span><span className="block text-[13px] font-medium">{product.name}</span><span className="text-[11px] text-muted-foreground">{product.sku || product.id}</span></span>
                      <span className="text-[12px] font-semibold tabular-nums">{formatCurrency(transactionProductPrice(product, outletId))}</span>
                    </button>
                  )) : <div className="px-3 py-4 text-center text-[12px] text-muted-foreground">Produk aktif dengan harga outlet tidak ditemukan.</div>}
                </div>
              ) : null}
              {pendingProduct ? (
                <div className="mt-3 rounded-md border bg-background p-3">
                  <div className="text-[12px] font-semibold">Catatan varian {pendingProduct.name}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(pendingProduct.variants || []).filter((variant) => variant.status !== "inactive").map((variant) => (
                      <label key={variant.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-[12px]">
                        <input type="checkbox" checked={selectedVariantIds.includes(variant.id)} onChange={(event) => setSelectedVariantIds((ids) => event.target.checked ? [...ids, variant.id] : ids.filter((id) => id !== variant.id))} />
                        {variant.name}
                      </label>
                    ))}
                  </div>
                  <div className="mt-3 flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setPendingProduct(null)}>Batal</Button>
                    <Button type="button" onClick={() => addProduct(pendingProduct, selectedVariantIds)}>Tambah Produk</Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-[13px]">
              <div className="flex justify-between"><span>Subtotal</span><span className="font-semibold tabular-nums">{formatCurrency(totals.subtotal)}</span></div>
              <div className="space-y-2 rounded-md border bg-background p-2">
                <Label htmlFor="transaction-correction-discount-type">Discount</Label>
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                  <Select
                    value={discountEdit.type}
                    onValueChange={(value) =>
                      setDiscountEdit((current) => ({
                        type: value,
                        value: value === "none" ? 0 : current.value
                      }))
                    }
                  >
                    <SelectTrigger id="transaction-correction-discount-type">
                      <SelectValue placeholder="Tanpa Diskon" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Tanpa Diskon</SelectItem>
                      <SelectItem value="percent">Persen</SelectItem>
                      <SelectItem value="nominal">Nominal/Rp</SelectItem>
                    </SelectContent>
                  </Select>
                  {discountEdit.type === "none" ? (
                    <div className="flex h-10 items-center rounded-md border px-3 text-[12px] text-muted-foreground">Tidak ada diskon</div>
                  ) : (
                    <FormattedNumberInput
                      id="transaction-correction-discount-value"
                      value={discountEdit.value}
                      onChange={(value) => setDiscountEdit((current) => ({ ...current, value }))}
                      placeholder={discountEdit.type === "percent" ? "Nilai %" : "Nominal"}
                    />
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {normalizedDiscount.amount > 0
                    ? `Potongan ${formatCurrency(normalizedDiscount.amount)}`
                    : discountEdit.type === "none"
                      ? "Opsional, sama seperti diskon manual di APK POS."
                      : discountEdit.type === "percent"
                        ? "Masukkan persen 1-100."
                        : "Masukkan nominal rupiah."}
                </p>
              </div>
              <div className="flex justify-between"><span>Diskon</span><span className="font-semibold text-destructive tabular-nums">-{formatCurrency(totals.discount)}</span></div>
              <div className="flex justify-between"><span>Pajak</span><span className="font-semibold tabular-nums">{formatCurrency(totals.tax)}</span></div>
              <div className="flex justify-between border-t pt-2 text-[15px] font-bold"><span>Total Baru</span><span className="tabular-nums">{formatCurrency(totals.total)}</span></div>
              <div className="flex justify-between"><span>Total Lama</span><span className="tabular-nums">{formatCurrency(transaction.total)}</span></div>
              <div className="flex justify-between"><span>Perubahan</span><span className={`font-semibold tabular-nums ${totals.total - Number(transaction.total || 0) >= 0 ? "text-emerald-700" : "text-destructive"}`}>{totals.total - Number(transaction.total || 0) >= 0 ? "+" : ""}{formatCurrency(totals.total - Number(transaction.total || 0))}</span></div>
            </div>

            <div className="rounded-md border p-3 text-[13px]">
              <div className="flex justify-between"><span>Metode</span><span className="font-semibold uppercase">{paymentMethodLabel}</span></div>
              <div className="mt-2 flex justify-between"><span>Dibayar</span><span className="font-semibold tabular-nums">{formatCurrency(effectivePaidAmount)}</span></div>
              {isPaid && hasCashPayment && paymentDifference < 0 ? (
                <div className="mt-3 space-y-1.5">
                  <Label htmlFor="transaction-correction-paid">Nominal diterima setelah koreksi</Label>
                  <FormattedNumberInput id="transaction-correction-paid" value={paidAmount} onChange={setPaidAmount} placeholder="0" />
                  <p className="text-[11px] text-destructive">Kurang {formatCurrency(Math.abs(paymentDifference))}. Nominal wajib minimal sebesar total baru.</p>
                </div>
              ) : (
                <div className="mt-2 flex justify-between"><span>{paymentDifference >= 0 ? "Kembalian" : "Kurang"}</span><span className={`font-semibold tabular-nums ${paymentDifference < 0 ? "text-destructive" : "text-emerald-700"}`}>{formatCurrency(Math.abs(paymentDifference))}</span></div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="transaction-correction-reason">Alasan koreksi</Label>
              <textarea id="transaction-correction-reason" value={reason} onChange={(event) => { setReason(event.target.value); setShowReasonError(false); }} className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" placeholder="Contoh: Qty item salah input oleh kasir." />
              {showReasonError && !reason.trim() ? <p className="text-[11px] text-destructive">Alasan koreksi wajib diisi.</p> : null}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>Batal</Button>
          <Button type="button" disabled={!canSubmit || mutation.isPending} onClick={submit}><Edit />{mutation.isPending ? "Menyimpan..." : "Simpan Koreksi"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RefundTransactionDialog({ onOpenChange, onSuccess, open, paymentMethods, transaction }) {
  const refundMutation = useRefundTransaction();
  const {
    formState: { errors },
    handleSubmit,
    register,
    reset
  } = useForm({
    defaultValues: { reason: "" }
  });

  useEffect(() => {
    if (open) reset({ reason: "" });
  }, [open, reset, transaction?.id]);

  if (!transaction) return null;

  const isPending = refundMutation.isPending;
  const onSubmit = (values) => {
    refundMutation.mutate(
      {
        id: transaction.id,
        payload: { reason: String(values.reason || "").trim() }
      },
      {
        onSuccess: () => {
          reset({ reason: "" });
          onSuccess?.();
          onOpenChange(false);
        }
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Refund Transaksi</DialogTitle>
          <DialogDescription>Refund penuh hanya bisa dilakukan satu kali dan akan mengubah transaksi menjadi refunded.</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="grid gap-3 rounded-md border bg-muted/20 p-3 text-[13px] md:grid-cols-2">
            <div>
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Order</p>
              <p className="mt-1 font-semibold">{transaction.order_number}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Waktu</p>
              <p className="mt-1 font-semibold">{formatDateTime(transaction.transaction_date)}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Outlet</p>
              <p className="mt-1 font-semibold">{transaction.outlet?.name || "-"}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Customer</p>
              <p className="mt-1 font-semibold">{transaction.customer?.name || transaction.customer_name || "Umum"}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Payment</p>
              <p className="mt-1 font-semibold">{getTransactionPaymentLabel(paymentMethods, transaction)}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Total Belanja</p>
              <p className="mt-1 font-semibold tabular-nums">{formatCurrency(transaction.total || 0)}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="refund-reason">Alasan refund</Label>
            <textarea
              id="refund-reason"
              className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
              placeholder="Contoh: Pesanan dibatalkan pelanggan / salah input transaksi."
              {...register("reason", {
                validate: (value) => String(value || "").trim().length > 0 || "Alasan refund wajib diisi."
              })}
            />
            {errors.reason ? <p className="text-[11px] text-destructive">{errors.reason.message}</p> : null}
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" variant="destructive" disabled={isPending}>
              <RotateCcw className={isPending ? "animate-spin" : ""} />
              Refund Transaksi
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CancelTransactionDialog({ onOpenChange, onSuccess, open, paymentMethods, transaction }) {
  const cancelMutation = useCancelTransaction();
  const {
    formState: { errors },
    handleSubmit,
    register,
    reset
  } = useForm({
    defaultValues: { reason: "" }
  });

  useEffect(() => {
    if (open) reset({ reason: "" });
  }, [open, reset, transaction?.id]);

  if (!transaction) return null;

  const isPending = cancelMutation.isPending;
  const onSubmit = (values) => {
    cancelMutation.mutate(
      {
        id: transaction.id,
        payload: { reason: String(values.reason || "").trim() }
      },
      {
        onSuccess: () => {
          reset({ reason: "" });
          onSuccess?.();
          onOpenChange(false);
        }
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cancel Transaksi</DialogTitle>
          <DialogDescription>
            Cancel dipakai untuk salah input atau order tidak jadi. Stok HPP dikembalikan dan transaksi tidak dihitung laporan.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="grid gap-3 rounded-md border bg-muted/20 p-3 text-[13px] md:grid-cols-2">
            <div>
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Order</p>
              <p className="mt-1 font-semibold">{transaction.order_number}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Waktu</p>
              <p className="mt-1 font-semibold">{formatDateTime(transaction.transaction_date)}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Outlet</p>
              <p className="mt-1 font-semibold">{transaction.outlet?.name || "-"}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Payment</p>
              <p className="mt-1 font-semibold">{getTransactionPaymentLabel(paymentMethods, transaction)}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Customer</p>
              <p className="mt-1 font-semibold">{transaction.customer?.name || transaction.customer_name || "Umum"}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Total Belanja</p>
              <p className="mt-1 font-semibold tabular-nums">{formatCurrency(transaction.total || 0)}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">Alasan cancel</Label>
            <textarea
              id="cancel-reason"
              className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
              placeholder="Contoh: Salah input item / produk tidak jadi dipesan."
              {...register("reason", {
                validate: (value) => String(value || "").trim().length > 0 || "Alasan cancel wajib diisi."
              })}
            />
            {errors.reason ? <p className="text-[11px] text-destructive">{errors.reason.message}</p> : null}
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" variant="destructive" disabled={isPending}>
              <XCircle className={isPending ? "animate-spin" : ""} />
              Cancel Transaksi
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function getTransactionHour(transaction) {
  const hour = getLocalHour(transaction.transaction_date);
  return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

function isPaidTransaction(transaction) {
  return !transaction?.status || transaction.status === "paid";
}

function buildSalesByHour(transactions = [], date) {
  const rows = Array.from({ length: 24 }, (_, hour) => ({
    id: `${String(hour).padStart(2, "0")}:00`,
    hour: `${String(hour).padStart(2, "0")}:00`,
    total: 0,
    transactions: 0,
    average_transaction: 0
  }));

  transactions
    .filter(isPaidTransaction)
    .filter((transaction) => !date || getLocalDateKey(transaction.transaction_date) === date)
    .forEach((transaction) => {
      const hour = getTransactionHour(transaction);
      if (hour === null) return;
      rows[hour].total += Number(transaction.total || 0);
      rows[hour].transactions += 1;
      rows[hour].average_transaction = Math.round(rows[hour].total / rows[hour].transactions);
    });

  return rows;
}

function buildSalesByDay(transactions = [], from, to) {
  const totals = new Map();
  transactions.filter(isPaidTransaction).forEach((transaction) => {
    const date = getLocalDateKey(transaction.transaction_date);
    if (!date) return;
    totals.set(date, (totals.get(date) || 0) + Number(transaction.total || 0));
  });

  if (!from || !to) {
    return [...totals.entries()]
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  const result = [];
  const cursor = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cursor <= end) {
    const date = toDateString(cursor);
    result.push({ date, total: totals.get(date) || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function isApprovedExpense(expense) {
  return !expense?.status || expense.status === "approved";
}

function getExpenseDateKey(expense) {
  return getLocalDateKey(expense?.expense_date || expense?.operational_at || expense?.operationalAt || expense?.date || expense?.created_at);
}

function buildExpensesByDay(expenses = [], from, to) {
  const totals = new Map();
  expenses.filter(isApprovedExpense).forEach((expense) => {
    const date = getExpenseDateKey(expense);
    if (!date) return;
    totals.set(date, (totals.get(date) || 0) + Number(expense.amount || 0));
  });

  if (!from || !to) {
    return [...totals.entries()]
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  const result = [];
  const cursor = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cursor <= end) {
    const date = toDateString(cursor);
    result.push({ date, total: totals.get(date) || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function buildSalesByProduct(transactions = []) {
  const totals = new Map();
  transactions.filter(isPaidTransaction).forEach((transaction) => {
    (transaction.items || []).forEach((item) => {
      const product = item.product || { id: item.product_id, name: "Produk" };
      const current = totals.get(item.product_id) || { product, quantity: 0, total: 0 };
      current.quantity += Number(item.quantity || 0);
      current.total += Number(item.subtotal || 0);
      totals.set(item.product_id, current);
    });
  });
  return [...totals.values()].sort((a, b) => b.quantity - a.quantity);
}

function buildSalesByCustomer(transactions = []) {
  const totals = new Map();
  transactions.filter(isPaidTransaction).forEach((transaction) => {
    const id = transaction.customer?.id || transaction.customer_id || "umum";
    const current = totals.get(id) || {
      id,
      customer: transaction.customer || null,
      customer_name: transaction.customer?.name || transaction.customer_name || "Umum",
      total: 0,
      transactions: 0,
      average_transaction: 0
    };
    current.total += Number(transaction.total || 0);
    current.transactions += 1;
    current.average_transaction = Math.round(current.total / current.transactions);
    totals.set(id, current);
  });
  return [...totals.values()].sort((a, b) => b.total - a.total);
}

function buildSalesByServiceType(transactions = []) {
  const totals = new Map([
    ["dine_in", { id: "dine_in", service_type: "dine_in", label: "Dine In", total: 0, transactions: 0, average_transaction: 0 }],
    ["takeaway", { id: "takeaway", service_type: "takeaway", label: "Takeaway", total: 0, transactions: 0, average_transaction: 0 }]
  ]);

  transactions.filter(isPaidTransaction).forEach((transaction) => {
    const serviceType = transaction.service_type === "dine_in" ? "dine_in" : "takeaway";
    const current = totals.get(serviceType);
    current.total += Number(transaction.total || 0);
    current.transactions += 1;
    current.average_transaction = Math.round(current.total / current.transactions);
  });

  return [...totals.values()];
}

function SalesSummaryCards({ data, selectedOutletId }) {
  const transactions = (data?.transactions || []).filter(isPaidTransaction);
  const outlets = data?.outlets || [];
  const totalSales = transactions.reduce((total, transaction) => total + Number(transaction.total || 0), 0);
  const transactionCount = transactions.length;
  const selectedOutlet = outlets.find((outlet) => outlet.id === selectedOutletId);
  const transactionOutlet = transactions.find((transaction) => transaction.outlet_id === selectedOutletId)?.outlet;
  const title = selectedOutletId === "all" ? "Semua Outlet" : selectedOutlet?.name || transactionOutlet?.name || "Outlet";

  return (
    <div className="px-1 py-1">
      <h2 className="text-[18px] font-semibold">{title}</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {transactionCount} transaksi · {formatCurrency(totalSales)}
      </p>
    </div>
  );
}

function ServiceTypePie({ rows = [] }) {
  const dineIn = rows.find((item) => item.service_type === "dine_in") || { total: 0, transactions: 0 };
  const takeaway = rows.find((item) => item.service_type === "takeaway") || { total: 0, transactions: 0 };
  const total = Number(dineIn.total || 0) + Number(takeaway.total || 0);
  const dineInPct = total ? Math.round((Number(dineIn.total || 0) / total) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dine In vs Takeaway</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-5 md:flex-row md:items-center">
          <div
            className="h-36 w-36 shrink-0 rounded-full border"
            style={{
              background: total
                ? `conic-gradient(hsl(var(--primary)) 0 ${dineInPct}%, hsl(var(--secondary)) ${dineInPct}% 100%)`
                : "hsl(var(--muted))"
            }}
            aria-label={`Dine In ${dineInPct}%`}
          />
          <div className="grid flex-1 gap-3 sm:grid-cols-2">
            {[
              { label: "Dine In", row: dineIn, dot: "bg-primary" },
              { label: "Takeaway", row: takeaway, dot: "bg-secondary" }
            ].map((item) => (
              <div key={item.label} className="rounded-md border bg-muted/20 p-3">
                <div className="flex items-center gap-2 text-[12px] font-semibold">
                  <span className={`h-2.5 w-2.5 rounded-full ${item.dot}`} />
                  {item.label}
                </div>
                <p className="mt-2 text-[18px] font-semibold">{formatCurrency(item.row.total || 0)}</p>
                <p className="mt-1 text-[12px] text-muted-foreground">{item.row.transactions || 0} transaksi</p>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SalesOutletComparisonCard({ initialFilters }) {
  const [filters, setFilters] = useState(() => ({
    from: initialFilters.from,
    to: initialFilters.to,
    outletIds: []
  }));
  const [detailCell, setDetailCell] = useState(null);
  const query = useSalesOutletComparison({
    from: filters.from,
    to: filters.to,
    outletIds: filters.outletIds.join(",")
  });
  const data = query.data || {};
  const outletOptions = data.outlet_options || data.outlets || [];
  const dates = data.dates || [];
  const matrixRows = data.matrix_rows || [];
  const totalsByDate = data.totals_by_date || [];
  const grandTotal = matrixRows.reduce((total, row) => total + Number(row.period_total || 0), 0);
  const grandTransactions = matrixRows.reduce((total, row) => total + Number(row.transaction_count || 0), 0);

  function updateFilters(partial) {
    setFilters((current) => ({ ...current, ...partial }));
  }

  return (
    <Card>
      <CardHeader className="gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <CardTitle>Perbandingan Penjualan Outlet per Tanggal</CardTitle>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Satu baris per outlet. Tiap tanggal menampilkan nominal penjualan dan transaksi paid yang masuk database.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-[220px_160px_160px]">
          <div className="space-y-1.5">
            <Label>Outlet</Label>
            <ReportMultiSelectFilter
              label="Outlet"
              placeholder="Semua outlet"
              options={outletOptions}
              selectedIds={filters.outletIds}
              onChange={(outletIds) => updateFilters({ outletIds })}
              getLabel={(outlet) => outlet.name || "-"}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sales-comparison-from">Dari</Label>
            <DatePicker
              id="sales-comparison-from"
              value={filters.from}
              onChange={(from) => updateFilters({ from })}
              placeholder="Tanggal awal"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sales-comparison-to">Sampai</Label>
            <DatePicker
              id="sales-comparison-to"
              value={filters.to}
              onChange={(to) => updateFilters({ to })}
              placeholder="Tanggal akhir"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 text-[12px] sm:grid-cols-3">
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-muted-foreground">Total Penjualan</p>
            <p className="mt-1 text-[18px] font-semibold">{formatCurrency(data.summary?.total || 0)}</p>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-muted-foreground">Transaksi</p>
            <p className="mt-1 text-[18px] font-semibold">{data.summary?.transaction_count || 0}</p>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-muted-foreground">Total Diskon</p>
            <p className="mt-1 text-[18px] font-semibold">{formatCurrency(data.summary?.discount_total || 0)}</p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <Table className="min-w-max">
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-20 min-w-[220px] bg-muted">Outlet</TableHead>
                {dates.map((date) => (
                  <TableHead key={date} className="min-w-[170px] text-right">
                    {formatDate(date)}
                  </TableHead>
                ))}
                <TableHead className="min-w-[180px] text-right">Total Periode</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading ? (
                <TableRow>
                  <TableCell colSpan={dates.length + 2} className="py-8 text-center text-muted-foreground">
                    Memuat perbandingan penjualan...
                  </TableCell>
                </TableRow>
              ) : matrixRows.length ? (
                matrixRows.map((row) => (
                  <TableRow key={row.outlet_id}>
                    <TableCell className="sticky left-0 z-10 bg-card font-semibold">
                      <div>{row.outlet_name}</div>
                      <div className="mt-1 text-[11px] font-normal text-muted-foreground">{row.transaction_count || 0} transaksi</div>
                    </TableCell>
                    {row.date_cells.map((cell) => {
                      const hasData = Number(cell.transaction_count || 0) > 0;
                      return (
                        <TableCell key={cell.id} className="p-2 text-right align-top">
                          {hasData ? (
                            <button
                              type="button"
                              className="w-full rounded-md border bg-primary/5 p-2 text-right transition hover:border-primary/50 hover:bg-primary/10"
                              onClick={() => setDetailCell(cell)}
                            >
                              <span className="block font-semibold">{formatCurrency(cell.total || 0)}</span>
                              <span className="mt-1 block text-[11px] text-muted-foreground">{cell.transaction_count} transaksi</span>
                              {Number(cell.discount_total || 0) > 0 ? (
                                <span className="mt-1 block text-[11px] text-danger">Diskon {formatCurrency(cell.discount_total)}</span>
                              ) : null}
                            </button>
                          ) : (
                            <div className="rounded-md border border-dashed bg-muted/20 p-2 text-muted-foreground">
                              <span className="block font-medium">{formatCurrency(0)}</span>
                              <span className="mt-1 block text-[11px]">0 transaksi</span>
                            </div>
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right font-semibold">
                      <div>{formatCurrency(row.period_total || 0)}</div>
                      <div className="mt-1 text-[11px] font-normal text-muted-foreground">{row.transaction_count || 0} transaksi</div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={dates.length + 2} className="py-8 text-center text-muted-foreground">
                    Belum ada transaksi paid pada filter ini.
                  </TableCell>
                </TableRow>
              )}
              {matrixRows.length ? (
                <TableRow>
                  <TableCell className="sticky left-0 z-10 bg-muted font-semibold">Total Tanggal</TableCell>
                  {totalsByDate.map((cell) => (
                    <TableCell key={cell.date} className="text-right font-semibold">
                      <div>{formatCurrency(cell.total || 0)}</div>
                      <div className="mt-1 text-[11px] font-normal text-muted-foreground">{cell.transaction_count || 0} transaksi</div>
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-semibold">
                    <div>{formatCurrency(grandTotal)}</div>
                    <div className="mt-1 text-[11px] font-normal text-muted-foreground">{grandTransactions} transaksi</div>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
        {query.isFetching && !query.isLoading ? <p className="text-[11px] text-muted-foreground">Memperbarui data perbandingan...</p> : null}
      </CardContent>

      <Dialog open={Boolean(detailCell)} onOpenChange={(open) => !open && setDetailCell(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Detail Penjualan {detailCell?.outlet_name}</DialogTitle>
            <DialogDescription>
              {detailCell?.date ? formatDate(detailCell.date) : "-"} · {detailCell?.transaction_count || 0} transaksi · {formatCurrency(detailCell?.total || 0)}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead className="text-right">Total Belanja</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                  <TableHead className="text-right">Dibayar</TableHead>
                  <TableHead className="text-right">Kembalian</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(detailCell?.rows || []).map((transaction) => (
                  <TableRow key={transaction.id}>
                    <TableCell className="font-medium">{transaction.order_number}</TableCell>
                    <TableCell>{formatDateTime(transaction.transaction_date)}</TableCell>
                    <TableCell>{transaction.customer?.name || transaction.customer_name || "Umum"}</TableCell>
                    <TableCell>{transaction.payment_label || getTransactionPaymentLabel(data.payment_methods || [], transaction)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(transaction.total || 0)}</TableCell>
                    <TableCell className="text-right">{Number(transaction.discount || 0) ? formatCurrency(transaction.discount) : "-"}</TableCell>
                    <TableCell className="text-right">{formatCurrency(getTransactionPaidAmount(transaction))}</TableCell>
                    <TableCell className="text-right">{formatCurrency(getTransactionChangeAmount(transaction))}</TableCell>
                    <TableCell><StatusBadge status={transaction.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function SalesReportGrid({ data, filters, hourDate, hourDateId = "sales-hour-date", isLoading, onHourDateChange }) {
  const transactions = data?.transactions || [];
  const salesByProduct = data?.sales_by_product || buildSalesByProduct(transactions);
  const salesByCustomer = data?.sales_by_customer || buildSalesByCustomer(transactions);
  const hourRows = hourDate ? buildSalesByHour(transactions, hourDate) : data?.sales_by_hour || buildSalesByHour(transactions);
  const serviceTypeRows = data?.sales_by_service_type || buildSalesByServiceType(transactions);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Penjualan Harian</CardTitle>
        </CardHeader>
        <CardContent>
          <SimpleBarChart data={data?.sales_by_day || buildSalesByDay(transactions, filters.from, filters.to)} />
        </CardContent>
      </Card>
      <ServiceTypePie rows={serviceTypeRows} />
      <DataTable
        title="Penjualan per Produk"
        data={salesByProduct.map((item) => ({ id: item.product?.id || item.product_id || item.product?.name, ...item }))}
        isLoading={isLoading}
        searchKeys={["product.name"]}
        columns={[
          { key: "product", label: "Produk", render: (row) => row.product?.name || "Produk", className: "font-medium" },
          { key: "quantity", label: "Qty", sortValue: (row) => row.quantity },
          { key: "total", label: "Total", render: (row) => formatCurrency(row.total), sortValue: (row) => row.total }
        ]}
      />
      <DataTable
        title="Penjualan per Customer"
        description="Transaksi tanpa customer masuk ke grup Umum."
        data={salesByCustomer.map((item) => ({ id: item.id || item.customer?.id || item.customer_name, ...item }))}
        isLoading={isLoading}
        searchKeys={["customer_name", "customer.name"]}
        columns={[
          { key: "customer", label: "Customer", render: (row) => row.customer?.name || row.customer_name || "Umum", className: "font-medium" },
          { key: "transactions", label: "Transaksi", sortValue: (row) => row.transactions },
          { key: "average", label: "Rata-rata", render: (row) => formatCurrency(row.average_transaction || 0), sortValue: (row) => row.average_transaction || 0 },
          { key: "total", label: "Total", render: (row) => formatCurrency(row.total), sortValue: (row) => row.total }
        ]}
      />
      <div className="xl:col-span-2">
        <DataTable
          title="Penjualan per Jam"
          description={`Default memakai semua transaksi dari ${formatDate(filters.from)} sampai ${formatDate(filters.to)}.`}
          data={hourRows}
          isLoading={isLoading}
          pageSize={24}
          searchKeys={["hour"]}
          actions={
            <div className="flex flex-col gap-1.5 sm:w-[220px]">
              <Label htmlFor={hourDateId}>Filter tanggal</Label>
              <DatePicker
                id={hourDateId}
                value={hourDate}
                onChange={(value) => onHourDateChange(value || "")}
                placeholder="Semua tanggal"
              />
              {hourDate ? (
                <Button type="button" variant="ghost" size="sm" className="justify-start px-0" onClick={() => onHourDateChange("")}>
                  Reset tanggal
                </Button>
              ) : null}
            </div>
          }
          columns={[
            { key: "hour", label: "Jam", className: "font-medium" },
            { key: "transactions", label: "Transaksi", sortValue: (row) => row.transactions },
            { key: "average", label: "Rata-rata", render: (row) => formatCurrency(row.average_transaction || 0), sortValue: (row) => row.average_transaction || 0 },
            { key: "total", label: "Total", render: (row) => formatCurrency(row.total), sortValue: (row) => row.total }
          ]}
        />
      </div>
    </div>
  );
}

function OutletSalesSections({ data, filters, hourDate, isLoading, onHourDateChange }) {
  const transactions = data?.transactions || [];
  const outlets = data?.outlets?.length
    ? data.outlets
    : [...new Map(transactions.map((transaction) => [transaction.outlet?.id || transaction.outlet_id, transaction.outlet])).values()].filter(Boolean);

  return (
    <div className="space-y-8">
      {outlets.map((outlet) => {
        const outletTransactions = transactions.filter((transaction) => transaction.outlet_id === outlet.id);
        const outletData = {
          transactions: outletTransactions,
          sales_by_day: buildSalesByDay(outletTransactions, filters.from, filters.to),
          sales_by_product: buildSalesByProduct(outletTransactions),
          sales_by_customer: buildSalesByCustomer(outletTransactions),
          sales_by_hour: buildSalesByHour(outletTransactions),
          sales_by_service_type: buildSalesByServiceType(outletTransactions)
        };
        const total = outletTransactions.reduce((sum, transaction) => sum + Number(transaction.total || 0), 0);

        return (
          <section key={outlet.id} className="space-y-4 border-t pt-5 first:border-t-0 first:pt-0">
            <div className="flex flex-col gap-1">
              <h2 className="text-[18px] font-semibold">{outlet.name}</h2>
              <p className="text-[12px] text-muted-foreground">
                {outletTransactions.length} transaksi · {formatCurrency(total)}
              </p>
            </div>
            <SalesReportGrid
              data={outletData}
              filters={filters}
              hourDate={hourDate}
              hourDateId={`sales-hour-date-${outlet.id}`}
              isLoading={isLoading}
              onHourDateChange={onHourDateChange}
            />
          </section>
        );
      })}
    </div>
  );
}

function ReportLayout({ children, exportLabel = "Export", filterMode = "range", getExportReport, permissionKey, renderSummary }) {
  const selectedOutletId = useAppStore((state) => state.selectedOutletId);
  const session = useAppStore((state) => state.session);
  const [filters, setFilters] = useState(() => getDefaultReportRange());
  const query = useReports({ outletId: selectedOutletId, ...filters });
  const profitLoss = query.data?.profit_loss || {};
  const canExport = can(session, permissionKey, "export");
  const exportReport = getExportReport ? getExportReport(query.data, filters) : null;
  const exportDisabled = Boolean(getExportReport && (!exportReport?.rows?.length || query.isLoading));
  const summary = renderSummary ? (
    renderSummary({ data: query.data, filters, isLoading: query.isLoading, selectedOutletId })
  ) : (
    <div className="grid gap-3 md:grid-cols-4">
      <MetricCard title="Revenue" value={formatCurrency(profitLoss.revenue)} description="Transaksi paid" icon={CalendarDays} />
      <MetricCard title="HPP Estimasi" value={formatCurrency(profitLoss.cogs_estimate)} description="Dari komposisi produk" icon={CalendarDays} tone="gold" />
      <MetricCard title="Expense + Pembelian" value={formatCurrency(profitLoss.expenses)} description="Biaya periode" icon={CalendarDays} tone="danger" />
      <MetricCard title="Net Profit" value={formatCurrency(profitLoss.net_profit)} description="Simulasi sederhana" icon={CalendarDays} tone={profitLoss.net_profit >= 0 ? "green" : "danger"} />
    </div>
  );

  function applyFilters(values) {
    const reportDate = values.to || filters.to || toDateString(new Date());
    const nextFilters = {
      from: filterMode === "asOf" ? getMonthStartDate(reportDate) : values.from,
      to: reportDate
    };
    const isSameRange = nextFilters.from === filters.from && nextFilters.to === filters.to;

    setFilters(nextFilters);
    if (isSameRange) {
      query.refetch();
    }
  }

  function handleExport() {
    if (!exportReport?.rows?.length) return;
    printAccountingReport(exportReport);
    adminApi
      .createActivityLog({
        module: "report",
        action: "report/export_pdf",
        entity_type: "report",
        entity_id: exportReport.title,
        outlet_id: selectedOutletId === "all" ? null : selectedOutletId,
        description: `Export PDF ${exportReport.title}.`,
        metadata_json: {
          report_title: exportReport.title,
          from: exportReport.from || filters.from,
          to: exportReport.to || exportReport.date || filters.to,
          row_count: exportReport.rows.length
        }
      })
      .catch(() => {});
  }

  return (
    <div className="space-y-4">
      <ReportFilters
        canExport={canExport}
        exportDisabled={exportDisabled}
        exportLabel={exportLabel}
        filterMode={filterMode}
        filters={filters}
        onApply={applyFilters}
        onExport={getExportReport ? handleExport : undefined}
        isFetching={query.isFetching}
      />
      {summary}
      {children({ ...query, filters, selectedOutletId })}
    </div>
  );
}

function formatAccountingCurrency(value) {
  return `Rp. ${new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value || 0))}`;
}

function escapePrintHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getReportDateLabel({ date, from }) {
  return from && date ? `${formatDate(from)} - ${formatDate(date)}` : formatDate(date);
}

function getAccountingReportFilename({ date, from, title }) {
  const titlePart = String(title || "laporan")
    .toLowerCase()
    .replace(/&/g, "dan")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const datePart = [from, date].filter(Boolean).join("-");
  return [titlePart || "laporan", datePart].filter(Boolean).join("-");
}

function printAccountingReport({ columns = ["Description", "Total"], date, from, rows = [], title }) {
  const printWindow = window.open("", "_blank", "width=960,height=720");
  if (!printWindow) return;

  const hasPercent = columns.includes("% of Income");
  const columnCount = hasPercent ? 3 : 2;
  const filename = getAccountingReportFilename({ date, from, title });
  const headerHtml = `
    <tr>
      <th>Description</th>
      <th class="number">Total</th>
      ${hasPercent ? '<th class="number percent">% of Income</th>' : ""}
    </tr>
  `;
  const rowsHtml = rows
    .map((row) => {
      const isSection = row.kind === "section";
      const isTotal = row.kind === "total" || row.kind === "grand_total";
      const classes = [isSection ? "section" : "", isTotal ? "total" : "", row.kind === "grand_total" ? "grand-total" : "", row.kind === "warning" ? "warning" : ""]
        .filter(Boolean)
        .join(" ");
      const indent = Number(row.level || 0) * 18;
      return `
        <tr class="${classes}">
          <td style="padding-left:${indent}px">${escapePrintHtml(row.description)}</td>
          <td class="number">${isSection ? "" : escapePrintHtml(formatAccountingCurrency(row.total))}</td>
          ${hasPercent ? `<td class="number percent">${isSection ? "" : escapePrintHtml(row.percent_of_income || "")}</td>` : ""}
        </tr>
      `;
    })
    .join("");

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${escapePrintHtml(filename)}</title>
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: #ffffff;
            color: #0f172a;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 13px;
          }
          .page {
            width: 100%;
            padding: 28px 34px;
          }
          .report-title {
            margin: 0;
            text-align: center;
            font-size: 28px;
            font-weight: 500;
          }
          .report-date {
            margin: 6px 0 26px;
            text-align: center;
            font-size: 16px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }
          thead tr {
            border-bottom: 2px solid #0f172a;
            border-top: 2px solid #0f172a;
          }
          th {
            padding: 12px 8px;
            text-align: left;
            font-size: 15px;
            font-weight: 700;
          }
          td {
            padding: 7px 8px;
            vertical-align: top;
          }
          th.number,
          td.number {
            text-align: right;
            white-space: nowrap;
          }
          .percent {
            width: 120px;
          }
          ${hasPercent ? "th:nth-child(2), td:nth-child(2) { width: 180px; }" : "th:nth-child(2), td:nth-child(2) { width: 220px; }"}
          tr.section td {
            padding-top: 16px;
            font-size: 15px;
          }
          tr.total td {
            border-top: 1px solid #cbd5e1;
            font-weight: 700;
          }
          tr.grand-total td {
            font-size: 16px;
            font-weight: 800;
          }
          tr.warning td {
            background: #fffbeb;
            color: #b45309;
          }
          @page {
            margin: 14mm;
          }
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .page { padding: 0; }
          }
        </style>
      </head>
      <body>
        <main class="page">
          <h1 class="report-title">${escapePrintHtml(title)}</h1>
          <p class="report-date">${escapePrintHtml(getReportDateLabel({ date, from }))}</p>
          <table>
            <colgroup>
              <col />
              <col />
              ${hasPercent ? "<col />" : ""}
            </colgroup>
            <thead>${headerHtml}</thead>
            <tbody>
              ${rowsHtml || `<tr><td colspan="${columnCount}">Belum ada data laporan.</td></tr>`}
            </tbody>
          </table>
        </main>
        <script>
          window.addEventListener("load", () => {
            window.focus();
            window.print();
          });
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

function AccountingReport({ columns = ["Description", "Total"], date, from, onAccountClick, rows = [], title, transactionTree }) {
  const hasPercent = columns.includes("% of Income");
  const transactionAccountCodes = new Set(transactionTree?.accountCodes || []);

  return (
    <div className="rounded-md border bg-white p-6 text-[13px] shadow-soft print:border-0 print:shadow-none">
      <div className="mb-6 text-center">
        <h2 className="text-[28px] font-medium text-slate-950">{title}</h2>
        <p className="mt-1 text-[16px] text-slate-950">{from && date ? `${formatDate(from)} - ${formatDate(date)}` : formatDate(date)}</p>
      </div>
      <div className="border-y-2 border-slate-950">
        <div className={`grid ${hasPercent ? "grid-cols-[minmax(0,1fr)_180px_120px]" : "grid-cols-[minmax(0,1fr)_220px]"} gap-4 py-4 text-[15px] font-semibold`}>
          <span>Description</span>
          <span className="text-right">Total</span>
          {hasPercent ? <span className="text-right">% of Income</span> : null}
        </div>
      </div>
      <div>
        {rows.map((row, index) => {
          const isTotal = row.kind === "total" || row.kind === "grand_total";
          const isSection = row.kind === "section";
          const isWarning = row.kind === "warning";
          const isClickableAccount = !isTotal && !isSection && !isWarning && row.account_code && typeof onAccountClick === "function";
          const showTransactionTree = transactionAccountCodes.has(String(row.account_code || ""));
          return (
            <div key={`${row.description}-${index}`}>
              <div
                className={`grid ${hasPercent ? "grid-cols-[minmax(0,1fr)_180px_120px]" : "grid-cols-[minmax(0,1fr)_220px]"} gap-4 py-2 ${isTotal ? "border-t border-slate-300 font-semibold" : ""} ${row.kind === "grand_total" ? "text-[16px]" : ""} ${isWarning ? "rounded bg-amber-50 text-amber-700" : ""}`}
              >
                <span className={isSection ? "pt-3 text-[15px]" : ""} style={{ paddingLeft: `${Number(row.level || 0) * 18}px` }}>
                  {isClickableAccount ? (
                    <button
                      type="button"
                      className="text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => onAccountClick(row)}
                    >
                      {row.description}
                    </button>
                  ) : (
                    row.description
                  )}
                </span>
                <span className={`text-right ${row.bold ? "font-semibold" : ""}`}>{isSection ? "" : formatAccountingCurrency(row.total)}</span>
                {hasPercent ? <span className={`text-right ${row.bold ? "font-semibold" : ""}`}>{isSection ? "" : row.percent_of_income}</span> : null}
              </div>
              {showTransactionTree ? (
                <ProfitLossTransactionTreeRows
                  account={row}
                  hasPercent={hasPercent}
                  request={{
                    report: "profit_loss",
                    accountCode: row.account_code,
                    from: transactionTree.from,
                    to: transactionTree.to,
                    outletId: transactionTree.outletId
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getProfitLossGroupKey(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s/-]+/g, "_");

  if (["cost_of_goods_sold", "cogs", "hpp"].includes(normalized)) return "cogs";
  if (["expense", "operating_expense", "biaya", "biaya_operasional"].includes(normalized)) return "expense";
  return null;
}

function getProfitLossTransactionAccountCodes(rows = []) {
  const accountCodes = new Set();
  let activeGroup = null;

  rows.forEach((row) => {
    const descriptionGroup = getProfitLossGroupKey(row.description);
    const metadataGroup = getProfitLossGroupKey(
      row.report_group || row.account_group || row.group || row.account?.report_group
    );

    if (row.kind === "section") {
      activeGroup = descriptionGroup;
      return;
    }

    const groupKey = metadataGroup || activeGroup;
    if (!groupKey) return;

    const accountCode = String(row.account_code || row.account?.code || "").trim();
    if (!accountCode || ["total", "grand_total", "warning"].includes(row.kind)) return;
    accountCodes.add(accountCode);
  });

  return [...accountCodes];
}

function getProfitLossItemLabel(row) {
  const description = String(row?.description || row?.source_label || "Transaksi").trim();
  if (row?.source_type === "purchase_hpp") return description.replace(/^Pembelian HPP\s*-\s*/i, "").trim();
  if (row?.source_type === "purchase_biaya") return description.replace(/^Pembelian Biaya Produksi\s*-\s*/i, "").trim();
  return description;
}

function buildProfitLossItemGroups(rows = []) {
  const groups = new Map();

  rows.forEach((row) => {
    const label = getProfitLossItemLabel(row);
    const normalizedLabel = label.toLowerCase().replace(/\s+/g, " ").trim();
    const key = `${row.source_type || "other"}:${normalizedLabel}`;
    const current = groups.get(key) || {
      id: key,
      description: label,
      source_type: row.source_type,
      source_label: row.source_label || row.source_type || "Transaksi",
      signed_amount: 0,
      transaction_count: 0,
      dates: new Set(),
      outlets: new Map()
    };

    current.signed_amount += Number(row.signed_amount ?? row.amount ?? 0);
    current.transaction_count += 1;
    if (row.date) current.dates.add(row.date);
    const outletId = row.outlet?.id || row.outlet_id || row.outlet?.name || row.outlet_name;
    const outletName = row.outlet?.name || row.outlet_name;
    if (outletId && outletName) current.outlets.set(outletId, outletName);
    groups.set(key, current);
  });

  return [...groups.values()]
    .map((group) => {
      const dates = [...group.dates].sort();
      return {
        ...group,
        dates,
        date_from: dates[0] || null,
        date_to: dates[dates.length - 1] || null,
        outlet_names: [...group.outlets.values()].sort((left, right) => left.localeCompare(right, "id-ID"))
      };
    })
    .sort(
      (left, right) =>
        Math.abs(right.signed_amount) - Math.abs(left.signed_amount) || left.description.localeCompare(right.description, "id-ID")
    );
}

function getProfitLossItemDateLabel(row) {
  if (!row.date_from) return null;
  if (!row.date_to || row.date_from === row.date_to) return formatDate(row.date_from);
  return `${formatDate(row.date_from)}–${formatDate(row.date_to)}`;
}

function ProfitLossTransactionTreeRows({ account, hasPercent, request }) {
  const query = useReportAccountDetail(request);
  const detailRows = buildProfitLossItemGroups(query.data?.rows || []);
  const gridClassName = hasPercent
    ? "grid-cols-[minmax(0,1fr)_180px_120px]"
    : "grid-cols-[minmax(0,1fr)_220px]";
  const indent = (Number(account.level || 0) + 1) * 18;

  if (query.isLoading || query.isFetching) {
    return (
      <div className={`grid ${gridClassName} gap-4 py-1.5 text-[12px] text-muted-foreground`}>
        <span className="flex items-center gap-2" style={{ paddingLeft: `${indent}px` }}>
          <span className="text-slate-400">└</span>
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          Memuat transaksi...
        </span>
        <span />
        {hasPercent ? <span /> : null}
      </div>
    );
  }

  if (query.isError || !detailRows.length) {
    return (
      <div className={`grid ${gridClassName} gap-4 py-1.5 text-[12px] ${query.isError ? "text-destructive" : "text-muted-foreground"}`}>
        <span style={{ paddingLeft: `${indent}px` }}>
          <span className="mr-2 text-slate-400">└</span>
          {query.isError ? query.error?.message || "Rincian transaksi gagal dimuat." : "Belum ada transaksi pada periode ini."}
        </span>
        <span />
        {hasPercent ? <span /> : null}
      </div>
    );
  }

  return detailRows.map((row, index) => {
    const metadata = [
      row.source_label,
      `${row.transaction_count} transaksi`,
      getProfitLossItemDateLabel(row),
      row.outlet_names.join(", ")
    ].filter(Boolean).join(" · ");
    return (
      <div
        key={row.id || `${row.date}-${row.reference}-${row.source_type}-${index}`}
        className={`grid ${gridClassName} gap-4 py-1.5 text-[12px] text-slate-600`}
      >
        <span className="flex items-start gap-2" style={{ paddingLeft: `${indent}px` }}>
          <span className="shrink-0 text-slate-400">{index === detailRows.length - 1 ? "└" : "├"}</span>
          <span className="min-w-0">
            <span className="block font-medium text-slate-700">{row.description || "Transaksi"}</span>
            {metadata ? <span className="block truncate text-[11px] text-muted-foreground">{metadata}</span> : null}
          </span>
        </span>
        <span className="text-right tabular-nums">{formatAccountingCurrency(row.signed_amount ?? row.amount)}</span>
        {hasPercent ? <span /> : null}
      </div>
    );
  });
}

function getAccountDetailReportLabel(report) {
  return report === "balance_sheet" ? "Neraca" : "Laba Rugi";
}

function getAccountDetailPeriodLabel(request) {
  if (!request) return "-";
  if (request.report === "balance_sheet") {
    return `Sampai ${formatDate(request.to)}`;
  }
  return request.from && request.to ? `${formatDate(request.from)} - ${formatDate(request.to)}` : formatDate(request.to);
}

function AccountDetailDialog({ onOpenChange, open, request }) {
  const query = useReportAccountDetail(
    {
      report: request?.report,
      accountCode: request?.accountCode,
      from: request?.from,
      to: request?.to,
      outletId: request?.outletId
    },
    { enabled: open && Boolean(request?.accountCode) }
  );
  const detail = query.data;
  const rows = detail?.rows || [];
  const account = detail?.account || request?.row?.account || {};
  const reportLabel = getAccountDetailReportLabel(request?.report);
  const displayTotal = Number(detail?.total ?? request?.row?.total ?? 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[calc(100vw-2rem)] max-w-[1180px] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Detail Aktivitas Akun</DialogTitle>
          <DialogDescription>
            {reportLabel} · {request?.accountCode ? `[${request.accountCode}] ${account?.name || request?.row?.description || "Akun"}` : "Akun"} ·{" "}
            {getAccountDetailPeriodLabel(request)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[calc(88vh-108px)] flex-col gap-4 overflow-hidden">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Total Row Laporan</p>
              <p className="mt-1 text-lg font-semibold">{formatAccountingCurrency(request?.row?.total)}</p>
            </div>
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Total Detail</p>
              <p className="mt-1 text-lg font-semibold">{formatAccountingCurrency(displayTotal)}</p>
            </div>
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Jumlah Aktivitas</p>
              <p className="mt-1 text-lg font-semibold">{rows.length} data</p>
            </div>
          </div>

          {detail?.summary?.length ? (
            <div className="grid gap-2 md:grid-cols-3">
              {detail.summary.map((item) => (
                <div key={item.source_type} className="rounded-md border px-3 py-2">
                  <p className="text-[12px] font-semibold">{item.source_label}</p>
                  <p className="text-[12px] text-muted-foreground">
                    {item.count} data · {formatAccountingCurrency(item.total)}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          <div className="min-h-0 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Sumber</TableHead>
                  <TableHead>Referensi</TableHead>
                  <TableHead>Outlet</TableHead>
                  <TableHead>Keterangan</TableHead>
                  <TableHead className="text-right">Nominal</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.isLoading || query.isFetching ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Memuat detail aktivitas akun...
                      </div>
                    </TableCell>
                  </TableRow>
                ) : rows.length ? (
                  rows.map((row) => (
                    <TableRow key={row.id || `${row.date}-${row.reference}-${row.source_type}`}>
                      <TableCell className="whitespace-nowrap">{formatDate(row.date)}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{row.source_label || row.source_type}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-medium">{row.reference || "-"}</TableCell>
                      <TableCell>{row.outlet?.name || "-"}</TableCell>
                      <TableCell>{row.description || "-"}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold">{formatAccountingCurrency(row.signed_amount ?? row.amount)}</TableCell>
                      <TableCell>
                        <StatusBadge status={row.status || "active"} />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      Belum ada aktivitas detail untuk akun ini pada filter laporan.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PenjualanPage() {
  const [hourDate, setHourDate] = useState("");

  return (
    <ReportLayout permissionKey="reports.sales" renderSummary={(props) => <SalesSummaryCards {...props} />}>
      {({ data, filters, isLoading }) => (
        <SalesReportGrid
          data={data}
          filters={filters}
          hourDate={hourDate}
          isLoading={isLoading}
          onHourDateChange={setHourDate}
        />
      )}
    </ReportLayout>
  );
}

function RiwayatTransaksiPage() {
  const [detailTransaction, setDetailTransaction] = useState(null);
  const [editTransaction, setEditTransaction] = useState(null);
  const [refundTransaction, setRefundTransaction] = useState(null);
  const [cancelTransaction, setCancelTransaction] = useState(null);
  const session = useAppStore((state) => state.session);
  const canRefundTransaction = can(session, "reports.transactions", "refund");
  const canCancelTransaction = can(session, "reports.transactions", "cancel") || canRefundTransaction;
  const canUpdateTransaction = can(session, "reports.transactions", "update");

  return (
    <ReportLayout permissionKey="reports.transactions">
      {({ data, isLoading }) => {
        const paymentMethods = data?.payment_methods || [];
        const editProducts = data?.transaction_edit_products || [];

        return (
          <>
            <DataTable
              title="Riwayat Transaksi"
              description="Transaksi dari POS kasir dengan payment dari master metode pembayaran."
              data={data?.transactions || []}
              isLoading={isLoading}
              searchKeys={["order_number", "customer.name", "customer_name", "outlet.name", "payment.method", "payments.method", "note", "refund.reason"]}
              pageSize={10}
              columns={[
                { key: "order_number", label: "Order", className: "font-medium" },
                { key: "transaction_date", label: "Waktu", render: (row) => formatDateTime(row.transaction_date) },
                { key: "outlet", label: "Outlet", render: (row) => row.outlet?.name || row.outlet_name || row.outlet_id || "-" },
                { key: "customer", label: "Customer", render: (row) => row.customer?.name || row.customer_name || "Umum" },
                { key: "payment", label: "Payment", render: (row) => getTransactionPaymentLabel(paymentMethods, row) },
                {
                  key: "discount",
                  label: "Discount",
                  render: (row) => {
                    if (!row.discount) return "-";
                    const label = getStoredDiscountName(row) || (row.discount_id ? row.discount_id : getManualDiscountLabel(row));
                    return `${label} · ${formatCurrency(row.discount)}`;
                  },
                  sortValue: (row) => Number(row.discount || 0)
                },
                {
                  key: "note",
                  label: "Catatan",
                  render: (row) => <span className="block max-w-48 truncate">{getTransactionNotePreview(row.note)}</span>,
                  sortValue: (row) => row.note || ""
                },
                { key: "total", label: "Total Belanja", render: (row) => formatCurrency(row.total), sortValue: (row) => row.total },
                {
                  key: "paid",
                  label: "Dibayar",
                  render: (row) => formatCurrency(getTransactionPaidAmount(row)),
                  sortValue: (row) => getTransactionPaidAmount(row)
                },
                {
                  key: "change",
                  label: "Kembalian",
                  render: (row) => formatCurrency(getTransactionChangeAmount(row)),
                  sortValue: (row) => getTransactionChangeAmount(row)
                },
                { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
                {
                  key: "actions",
                  label: "Aksi",
                  render: (row) => (
                    <InlineRowActions>
                      <RowActionButton label={`Detail ${row.order_number}`} onClick={() => setDetailTransaction(row)}>
                        <Eye />
                      </RowActionButton>
                      {canUpdateTransaction ? (
                        <RowActionButton label={`Edit item ${row.order_number}`} onClick={() => setEditTransaction(row)}>
                          <Edit />
                        </RowActionButton>
                      ) : null}
                      {canRefundTransaction && row.status === "paid" ? (
                        <RowActionButton
                          className="text-destructive hover:bg-destructive/10"
                          label={`Refund ${row.order_number}`}
                          onClick={() => setRefundTransaction(row)}
                        >
                          <RotateCcw />
                        </RowActionButton>
                      ) : null}
                      {canCancelTransaction && row.status === "paid" ? (
                        <RowActionButton
                          className="text-destructive hover:bg-destructive/10"
                          label={`Cancel ${row.order_number}`}
                          onClick={() => setCancelTransaction(row)}
                        >
                          <XCircle />
                        </RowActionButton>
                      ) : null}
                    </InlineRowActions>
                  ),
                  className: "text-right whitespace-nowrap",
                  headerClassName: "text-right"
                }
              ]}
            />
            <TransactionDetailDialog
              open={Boolean(detailTransaction)}
              onOpenChange={(open) => !open && setDetailTransaction(null)}
              paymentMethods={paymentMethods}
              transaction={detailTransaction}
            />
            <EditTransactionItemsDialog
              open={Boolean(editTransaction)}
              onOpenChange={(open) => !open && setEditTransaction(null)}
              products={editProducts}
              transaction={editTransaction}
            />
            <RefundTransactionDialog
              open={Boolean(refundTransaction)}
              onOpenChange={(open) => !open && setRefundTransaction(null)}
              onSuccess={() => {
                setRefundTransaction(null);
                setDetailTransaction(null);
              }}
              paymentMethods={paymentMethods}
              transaction={refundTransaction}
            />
            <CancelTransactionDialog
              open={Boolean(cancelTransaction)}
              onOpenChange={(open) => !open && setCancelTransaction(null)}
              onSuccess={() => {
                setCancelTransaction(null);
                setDetailTransaction(null);
              }}
              paymentMethods={paymentMethods}
              transaction={cancelTransaction}
            />
          </>
        );
      }}
    </ReportLayout>
  );
}

function LabaRugiPage() {
  const [accountDetailRequest, setAccountDetailRequest] = useState(null);

  return (
    <ReportLayout
      permissionKey="reports.profit_loss"
      exportLabel="Export PDF"
      getExportReport={(data) => {
        const report = data?.accounting_profit_loss;
        if (!report?.rows?.length) return null;
        return {
          title: report.title || "Laba & Rugi",
          from: report.from,
          date: report.to,
          columns: report.columns,
          rows: report.rows
        };
      }}
      renderSummary={() => null}
    >
      {({ data, filters, selectedOutletId }) => {
        const accountingReport = data?.accounting_profit_loss;
        const profitLoss = data?.profit_loss || {};
        if (accountingReport?.rows?.length) {
          return (
            <>
              <div className="space-y-4">
                <ProfitLossLegend />
                <AccountingReport
                  title={accountingReport.title || "Laba & Rugi"}
                  from={accountingReport.from}
                  date={accountingReport.to}
                  columns={accountingReport.columns}
                  rows={accountingReport.rows}
                  transactionTree={{
                    accountCodes: getProfitLossTransactionAccountCodes(accountingReport.rows),
                    from: accountingReport.from || filters.from,
                    to: accountingReport.to || filters.to,
                    outletId: selectedOutletId
                  }}
                  onAccountClick={(row) =>
                    setAccountDetailRequest({
                      report: "profit_loss",
                      accountCode: row.account_code,
                      from: accountingReport.from || filters.from,
                      to: accountingReport.to || filters.to,
                      outletId: selectedOutletId,
                      row
                    })
                  }
                />
              </div>
              <AccountDetailDialog
                open={Boolean(accountDetailRequest)}
                onOpenChange={(open) => !open && setAccountDetailRequest(null)}
                request={accountDetailRequest}
              />
            </>
          );
        }
        return (
          <div className="space-y-4">
            <ProfitLossLegend />
            <Card>
              <CardHeader>
                <CardTitle>Laba Rugi Sederhana</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-2">
                  {[
                    ["Revenue", profitLoss.revenue],
                    ["COGS/HPP Estimasi", profitLoss.cogs_estimate],
                    ["Gross Profit", profitLoss.gross_profit],
                    ["Expense + Pembelian", profitLoss.expenses],
                    ["Net Profit", profitLoss.net_profit]
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between rounded-md border p-3">
                      <span className="font-medium">{label}</span>
                      <span className="font-semibold">{formatCurrency(value)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        );
      }}
    </ReportLayout>
  );
}

function ProfitLossLegend() {
  const legends = [
    ["Income", "Pendapatan penjualan sebelum dan setelah diskon."],
    ["Cost of Goods Sold", "Harga pokok penjualan dari pembelian Harga Pokok Produksi yang sudah approved."],
    ["GROSS PROFIT", "Selisih Income dikurangi Cost of Goods Sold."],
    ["Expense", "Biaya operasional dari pengeluaran dan pembelian type Biaya yang sudah approved."],
    ["NET OPERATING INCOME", "Laba operasional setelah Gross Profit dikurangi Expense."],
    ["Other Income / Expense", "Pendapatan atau biaya lain dari menu Finance > Entry Keuangan."],
    ["NET INCOME", "Laba bersih akhir periode yang dipakai sebagai acuan ke Neraca."]
  ];

  return (
    <section className="rounded-md border bg-card px-4 py-3 shadow-soft">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold">Legend Laba Rugi</h2>
        <span className="text-[11px] text-muted-foreground">Acuan baca section laporan</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {legends.map(([label, description]) => (
          <div key={label} className="rounded-md border bg-muted/25 px-3 py-2 text-[12px]">
            <div className="flex items-center gap-2 font-semibold">
              <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
              <span>{label}</span>
            </div>
            <p className="mt-1 pl-4 leading-relaxed text-muted-foreground">{description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function BalanceSheetLegend() {
  const legends = [
    ["ASSET", "Total aset usaha: kas/bank, persediaan, dan aset lancar lain."],
    ["Cash and Bank", "Kas/bank dipecah dari master metode pembayaran dan account code masing-masing."],
    ["Inventory", "Nilai persediaan dari stok Harga Pokok Produksi berdasarkan harga terakhir."],
    ["Other Current Asset", "Aset lancar tambahan dari Entry Keuangan, termasuk dana cadangan."],
    ["Fixed / Moving Asset", "Aset tetap dan aset bergerak dari menu Finance > Entry Keuangan."],
    ["LIABILITY", "Kewajiban dari entry hutang dan pembelian bon yang sudah approved."],
    ["EQUITY", "Modal/ekuitas dari Entry Keuangan ditambah Net Income. Prive Owner tampil sebagai pengurang equity."],
    ["Net Income", "Laba berjalan dari laporan laba rugi pada periode yang sama."],
    ["Selisih belum seimbang", "Muncul bila mapping akun belum lengkap; bukan saldo penyeimbang otomatis."]
  ];

  return (
    <section className="rounded-md border bg-card px-4 py-3 shadow-soft">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold">Legend Neraca</h2>
        <span className="text-[11px] text-muted-foreground">Acuan baca section laporan</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {legends.map(([label, description]) => (
          <div key={label} className="rounded-md border bg-muted/25 px-3 py-2 text-[12px]">
            <div className="flex items-center gap-2 font-semibold">
              <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
              <span>{label}</span>
            </div>
            <p className="mt-1 pl-4 leading-relaxed text-muted-foreground">{description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function NeracaPage() {
  const [accountDetailRequest, setAccountDetailRequest] = useState(null);

  return (
    <ReportLayout
      permissionKey="reports.balance_sheet"
      exportLabel="Export PDF"
      getExportReport={(data, filters) => {
        const report = data?.accounting_balance_sheet;
        if (!report?.rows?.length) return null;
        return {
          title: report.title || "Neraca",
          from: report.from || filters.from,
          date: report.to || report.date || filters.to,
          columns: report.columns,
          rows: report.rows
        };
      }}
      renderSummary={() => null}
    >
      {({ data, filters, selectedOutletId }) => {
        const accountingReport = data?.accounting_balance_sheet;
        if (accountingReport?.rows?.length) {
          return (
            <>
              <div className="space-y-4">
                <BalanceSheetLegend />
                <AccountingReport
                  title={accountingReport.title || "Neraca"}
                  from={accountingReport.from || filters.from}
                  date={accountingReport.to || accountingReport.date || filters.to}
                  columns={accountingReport.columns}
                  rows={accountingReport.rows}
                  onAccountClick={(row) =>
                    setAccountDetailRequest({
                      report: "balance_sheet",
                      accountCode: row.account_code,
                      from: accountingReport.from || filters.from,
                      to: accountingReport.to || accountingReport.date || filters.to,
                      outletId: selectedOutletId,
                      row
                    })
                  }
                />
              </div>
              <AccountDetailDialog
                open={Boolean(accountDetailRequest)}
                onOpenChange={(open) => !open && setAccountDetailRequest(null)}
                request={accountDetailRequest}
              />
            </>
          );
        }
        const balanceSheet = data?.balance_sheet || {};
        return (
          <div className="space-y-4">
            <BalanceSheetLegend />
            <Card>
              <CardHeader>
                <CardTitle>Neraca Sederhana</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-3">
                <MetricCard title="Assets" value={formatCurrency(balanceSheet.assets)} description="Kas + estimasi stok" />
                <MetricCard title="Liabilities" value={formatCurrency(balanceSheet.liabilities)} description="Estimasi kewajiban" tone="gold" />
                <MetricCard title="Equity" value={formatCurrency(balanceSheet.equity)} description="Simulasi modal/laba" tone={balanceSheet.equity >= 0 ? "green" : "danger"} />
              </CardContent>
            </Card>
          </div>
        );
      }}
    </ReportLayout>
  );
}

function getPurchaseOutletId(purchase) {
  return purchase.outlet?.id || purchase.outlet_id || "unknown";
}

function getPurchaseOutletName(purchase) {
  return purchase.outlet?.name || purchase.outlet_name || "Outlet tidak diketahui";
}

function buildPurchasesByDay(purchases = [], from, to) {
  const totals = new Map();
  purchases.forEach((purchase) => {
    const date = String(purchase.purchase_date || "").slice(0, 10);
    if (!date) return;
    totals.set(date, (totals.get(date) || 0) + Number(purchase.total || 0));
  });

  if (!from || !to) {
    return [...totals.entries()]
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  const result = [];
  const cursor = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cursor <= end) {
    const date = toDateString(cursor);
    result.push({ date, total: totals.get(date) || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function buildPurchaseReportSection(purchases = [], outlets = [], selectedOutletId = "all") {
  const selectedOutlet = outlets.find((outlet) => outlet.id === selectedOutletId);
  const isAllOutlets = selectedOutletId === "all";
  const filteredPurchases = isAllOutlets
    ? purchases
    : purchases.filter((purchase) => getPurchaseOutletId(purchase) === selectedOutletId);
  const total = filteredPurchases.reduce((sum, purchase) => sum + Number(purchase.total || 0), 0);
  const approvedTotal = filteredPurchases
    .filter((purchase) => purchase.status === "approved")
    .reduce((sum, purchase) => sum + Number(purchase.total || 0), 0);
  const pendingCount = filteredPurchases.filter((purchase) => purchase.status === "pending").length;
  const rejectedCount = filteredPurchases.filter((purchase) => purchase.status === "rejected").length;
  const itemCount = filteredPurchases.reduce((sum, purchase) => sum + Number(purchase.item_count || purchase.items?.length || 0), 0);

  return {
    approvedTotal,
    emptyText: isAllOutlets ? "Belum ada pembelian pada periode ini." : "Belum ada pembelian di outlet ini.",
    id: selectedOutletId,
    isAllOutlets,
    itemCount,
    name: isAllOutlets ? "Semua Outlet" : selectedOutlet?.name || filteredPurchases[0]?.outlet?.name || "Outlet",
    pendingCount,
    purchases: filteredPurchases,
    rejectedCount,
    total
  };
}

function PurchaseSummaryCards({ data, selectedOutletId }) {
  const section = buildPurchaseReportSection(data?.purchases || [], data?.outlets || [], selectedOutletId);
  return (
    <div className="grid gap-3 md:grid-cols-4">
      <MetricCard title="Total Pembelian" value={formatCurrency(section.total)} description={section.name} icon={CalendarDays} tone="gold" />
      <MetricCard title="Approved" value={formatCurrency(section.approvedTotal)} description="Masuk stok/laporan" icon={CalendarDays} tone="green" />
      <MetricCard title="Pending" value={section.pendingCount} description="Menunggu approval" icon={CalendarDays} tone="blue" />
      <MetricCard title="Rejected" value={section.rejectedCount} description={`${section.itemCount} item tercatat`} icon={CalendarDays} tone="danger" />
    </div>
  );
}

function PurchaseOutletSection({ filters, isLoading, section }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-[18px] font-semibold">{section.name}</h2>
        <p className="text-[12px] text-muted-foreground">
          {section.purchases.length} transaksi · {section.itemCount} item · total {formatCurrency(section.total)}
        </p>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Pembelian Harian</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <div className="min-w-[760px]">
              <SimpleBarChart data={buildPurchasesByDay(section.purchases, filters.from, filters.to)} height={260} />
            </div>
          </CardContent>
        </Card>

        <DataTable
          title={`Detail Pembelian ${section.name}`}
          description="Supplier boleh kosong karena pembelian dari kasir bisa tanpa supplier."
          data={section.purchases}
          isLoading={isLoading}
          searchKeys={["supplier.name", "supplier_name", "outlet.name", "outlet_name", "source", "created_by_user.name", "status"]}
          emptyText={section.emptyText}
          pageSize={8}
          columns={[
            { key: "purchase_date", label: "Tanggal", render: (row) => formatDate(row.purchase_date) },
            { key: "supplier", label: "Supplier", render: (row) => row.supplier?.name || row.supplier_name || "-", className: "font-medium" },
            { key: "outlet", label: "Outlet", render: (row) => row.outlet?.name || row.outlet_name || getPurchaseOutletName(row) },
            { key: "source", label: "Source", render: (row) => <StatusBadge status={row.source || "admin_web"} /> },
            { key: "created_by_user", label: "User", render: (row) => getInputUserName(row) },
            { key: "item_count", label: "Item", render: (row) => row.item_count || row.items?.length || 0, sortValue: (row) => row.item_count || row.items?.length || 0 },
            { key: "total", label: "Total", render: (row) => formatCurrency(row.total || 0), sortValue: (row) => row.total || 0 },
            { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> }
          ]}
        />
      </div>
    </section>
  );
}

function LaporanPembelianPage() {
  return (
    <ReportLayout
      permissionKey="reports.purchases"
      renderSummary={({ data, selectedOutletId }) => <PurchaseSummaryCards data={data} selectedOutletId={selectedOutletId} />}
    >
      {({ data, filters, isLoading, selectedOutletId }) => {
        const section = buildPurchaseReportSection(data?.purchases || [], data?.outlets || [], selectedOutletId);
        return (
          <div className="space-y-6">
            <PurchaseOutletSection filters={filters} isLoading={isLoading} section={section} />
          </div>
        );
      }}
    </ReportLayout>
  );
}

function ExpenseCorrectionDialog({ expense, isPending, onOpenChange, onSubmit, open }) {
  const {
    control,
    formState: { errors },
    handleSubmit,
    register,
    reset
  } = useForm({
    defaultValues: {
      amount: 0,
      correction_note: ""
    }
  });

  useEffect(() => {
    if (!expense) return;
    reset({
      amount: Number(expense.amount || 0),
      correction_note: ""
    });
  }, [expense, reset]);

  if (!expense) return null;

  async function submit(values) {
    const correctionNote = String(values.correction_note || "").trim();
    await onSubmit({
      amount: Number(values.amount || 0),
      correction_note: correctionNote
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-5rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Koreksi Pengeluaran</DialogTitle>
          <DialogDescription>Ubah nominal yang salah input. Koreksi ini akan tercatat di Log Aktivitas.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit(submit)}>
          <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 text-[12px] md:grid-cols-2">
            <div>
              <p className="text-muted-foreground">Tanggal</p>
              <p className="font-medium">{formatDate(expense.expense_date)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Outlet</p>
              <p className="font-medium">{expense.outlet?.name || "-"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Nama Pengeluaran</p>
              <p className="font-medium">{expense.category || "-"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Nominal Saat Ini</p>
              <p className="font-medium">{formatCurrency(expense.amount)}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="expense-correction-amount">Nominal Benar</Label>
            <Controller
              name="amount"
              control={control}
              rules={{ validate: (value) => Number(value || 0) > 0 || "Nominal koreksi wajib lebih dari 0." }}
              render={({ field }) => <FormattedNumberInput id="expense-correction-amount" placeholder="0" {...field} />}
            />
            {errors.amount ? <p className="text-[11px] text-destructive">{errors.amount.message}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="expense-correction-note">Catatan Koreksi</Label>
            <textarea
              id="expense-correction-note"
              className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
              placeholder="Contoh: Salah input, seharusnya Rp 75.000."
              {...register("correction_note", {
                validate: (value) => String(value || "").trim().length > 0 || "Catatan koreksi wajib diisi."
              })}
            />
            {errors.correction_note ? <p className="text-[11px] text-destructive">{errors.correction_note.message}</p> : null}
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Menyimpan..." : "Simpan Koreksi"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ExpenseRejectDialog({ expense, isPending, onOpenChange, onSubmit, open }) {
  const {
    formState: { errors },
    handleSubmit,
    register,
    reset
  } = useForm({ defaultValues: { reason: "" } });

  useEffect(() => {
    if (open) reset({ reason: "" });
  }, [open, reset]);

  if (!expense) return null;

  async function submit(values) {
    await onSubmit({ reason: String(values.reason || "").trim() });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Reject Pengeluaran</DialogTitle>
          <DialogDescription>Pengeluaran yang ditolak tetap tersimpan sebagai histori, tapi tidak masuk laporan nominal.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit(submit)}>
          <div className="rounded-lg border bg-muted/30 p-3 text-[12px]">
            <p className="font-semibold">{expense.category}</p>
            <p className="text-muted-foreground">
              {formatDate(expense.expense_date)} · {expense.outlet?.name || "-"} · {formatCurrency(expense.amount)}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="expense-reject-reason">Alasan Reject</Label>
            <textarea
              id="expense-reject-reason"
              className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
              placeholder="Contoh: Bukti tidak sesuai atau nominal salah."
              {...register("reason", {
                validate: (value) => String(value || "").trim().length > 0 || "Alasan reject wajib diisi."
              })}
            />
            {errors.reason ? <p className="text-[11px] text-destructive">{errors.reason.message}</p> : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" variant="destructive" disabled={isPending}>
              {isPending ? "Menyimpan..." : "Reject"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ExpenseDetailDialog({ expense, onOpenChange, open }) {
  if (!expense) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-5rem)] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detail Pengeluaran</DialogTitle>
          <DialogDescription>Detail status approval dan koreksi pengeluaran.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 text-[12px] md:grid-cols-2">
          <div>
            <p className="text-muted-foreground">Tanggal</p>
            <p className="font-medium">{formatDate(expense.expense_date)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Outlet</p>
            <p className="font-medium">{expense.outlet?.name || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Nama Pengeluaran</p>
            <p className="font-medium">{expense.category || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Nominal</p>
            <p className="font-medium">{formatCurrency(expense.amount)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Status</p>
            <StatusBadge status={expense.status || "approved"} />
          </div>
          <div>
            <p className="text-muted-foreground">User</p>
            <p className="font-medium">{getInputUserName(expense)}</p>
          </div>
          <div className="md:col-span-2">
            <p className="text-muted-foreground">Keterangan</p>
            <p className="font-medium">{expense.description || "-"}</p>
          </div>
          {expense.rejection_note ? (
            <div className="md:col-span-2">
              <p className="text-muted-foreground">Alasan Reject</p>
              <p className="font-medium text-destructive">{expense.rejection_note}</p>
            </div>
          ) : null}
          {expense.corrected_at ? (
            <div className="md:col-span-2">
              <p className="text-muted-foreground">Koreksi</p>
              <p className="font-medium">
                Dari {formatCurrency(expense.previous_amount || 0)} menjadi {formatCurrency(expense.amount || 0)} oleh{" "}
                {expense.corrected_by_user?.name || "-"}
              </p>
              <p className="text-muted-foreground">{expense.correction_note || "-"}</p>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LaporanPengeluaranPage() {
  const session = useAppStore((state) => state.session);
  const [correctingExpense, setCorrectingExpense] = useState(null);
  const [detailExpense, setDetailExpense] = useState(null);
  const [rejectingExpense, setRejectingExpense] = useState(null);
  const approveExpense = useApproveExpense();
  const correctExpense = useCorrectExpense();
  const rejectExpense = useRejectExpense();
  const canApproveExpense = can(session, "reports.expenses", "approve");
  const canCorrectExpense = can(session, "reports.expenses", "update");
  const canRejectExpense = can(session, "reports.expenses", "reject");
  const expenseColumns = [
    { key: "expense_date", label: "Tanggal", render: (row) => formatDate(row.expense_date) },
    { key: "category", label: "Kategori", className: "font-medium" },
    { key: "description", label: "Keterangan" },
    { key: "outlet", label: "Outlet", render: (row) => row.outlet?.name || "-" },
    { key: "created_by_user", label: "User", render: (row) => getInputUserName(row) },
    { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status || "approved"} /> },
    {
      key: "amount",
      label: "Nominal",
      render: (row) => (
        <div className="flex flex-col gap-1">
          <span>{formatCurrency(row.amount)}</span>
          {row.corrected_at ? <span className="w-fit rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">Dikoreksi</span> : null}
        </div>
      ),
      sortValue: (row) => row.amount
    },
    {
      key: "actions",
      label: "Aksi",
      className: "text-right whitespace-nowrap",
      headerClassName: "text-right",
      render: (row) => {
        const isPending = row.status === "pending";
        const hasActions = canCorrectExpense || (isPending && (canApproveExpense || canRejectExpense));
        if (!hasActions) {
          return (
            <InlineRowActions>
              <RowActionButton label="Detail pengeluaran" onClick={() => setDetailExpense(row)}>
                <Eye />
              </RowActionButton>
            </InlineRowActions>
          );
        }
        return (
          <InlineRowActions>
            <RowActionButton label="Detail pengeluaran" onClick={() => setDetailExpense(row)}>
              <Eye />
            </RowActionButton>
            {canCorrectExpense ? (
              <RowActionButton label="Koreksi pengeluaran" onClick={() => setCorrectingExpense(row)}>
                <Edit />
              </RowActionButton>
            ) : null}
            {isPending && canApproveExpense ? (
              <RowActionButton
                label="Approve pengeluaran"
                disabled={approveExpense.isPending}
                onClick={() => approveExpense.mutate(row.id)}
              >
                <CheckCircle2 />
              </RowActionButton>
            ) : null}
            {isPending && canRejectExpense ? (
              <RowActionButton
                label="Reject pengeluaran"
                disabled={rejectExpense.isPending}
                onClick={() => setRejectingExpense(row)}
                variant="destructive"
              >
                <XCircle />
              </RowActionButton>
            ) : null}
          </InlineRowActions>
        );
      }
    }
  ].filter(Boolean);

  async function handleCorrectExpense(payload) {
    if (!correctingExpense) return;
    await correctExpense.mutateAsync({ id: correctingExpense.id, payload });
    setCorrectingExpense(null);
  }

  async function handleRejectExpense(payload) {
    if (!rejectingExpense) return;
    await rejectExpense.mutateAsync({ id: rejectingExpense.id, payload });
    setRejectingExpense(null);
  }

  return (
    <>
      <ReportLayout permissionKey="reports.expenses">
        {({ data, filters, isLoading }) => {
          const apiExpensesByDay = Array.isArray(data?.expenses_by_day) ? data.expenses_by_day : [];
          const expensesByDay = apiExpensesByDay.length ? apiExpensesByDay : buildExpensesByDay(data?.expenses || [], filters.from, filters.to);

          return (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Pengeluaran Harian</CardTitle>
                </CardHeader>
                <CardContent>
                  <SimpleBarChart data={expensesByDay} />
                </CardContent>
              </Card>
              <DataTable
                title="Laporan Pengeluaran"
                description="Histori biaya operasional POS dan outlet. Pending/rejected tetap tampil, tetapi hanya approved yang masuk total laporan."
                data={data?.expenses || []}
                isLoading={isLoading}
                searchKeys={["category", "description", "outlet.name", "created_by_user.name", "correction_note", "status", "rejection_note"]}
                columns={expenseColumns}
              />
            </div>
          );
        }}
      </ReportLayout>
      <ExpenseCorrectionDialog
        expense={correctingExpense}
        isPending={correctExpense.isPending}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setCorrectingExpense(null);
        }}
        onSubmit={handleCorrectExpense}
        open={Boolean(correctingExpense)}
      />
      <ExpenseRejectDialog
        expense={rejectingExpense}
        isPending={rejectExpense.isPending}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setRejectingExpense(null);
        }}
        onSubmit={handleRejectExpense}
        open={Boolean(rejectingExpense)}
      />
      <ExpenseDetailDialog
        expense={detailExpense}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDetailExpense(null);
        }}
        open={Boolean(detailExpense)}
      />
    </>
  );
}

function LogAktivitasPage() {
  const selectedOutletId = useAppStore((state) => state.selectedOutletId);
  const bootstrap = useBootstrap();
  const [filters, setFilters] = useState(() => ({ ...getDefaultReportRange(), source: "all", eventType: "all", outcome: "all", actorId: "all", module: "", action: "", keyword: "" }));
  const [page, setPage] = useState(1);
  const [detailLog, setDetailLog] = useState(null);
  const query = useActivityLogs({ outletId: selectedOutletId, ...filters, paginated: true, page, pageSize: 50 });
  const rows = query.data?.rows || [];
  const pagination = query.data?.pagination || { page: 1, total_pages: 1, total: rows.length };

  function applyFilters(nextFilters) {
    setPage(1);
    setFilters(nextFilters);
  }

  return (
    <div className="space-y-4">
      <ActivityLogFilters filters={filters} onApply={applyFilters} isFetching={query.isFetching} users={bootstrap.data?.users || []} />
      <DataTable
        title="Log Aktivitas"
        description={`${pagination.total || 0} aktivitas kasir dan admin tercatat permanen di backend.`}
        data={rows}
        isLoading={query.isLoading}
        searchKeys={["description", "actor.name", "outlet.name", "source", "module", "action", "entity_type", "entity_id"]}
        pageSize={50}
        columns={[
          { key: "occurred_at", label: "Waktu", render: (row) => formatDateTime(row.occurred_at || row.created_at) },
          { key: "actor", label: "User", render: (row) => row.actor?.name || "-" },
          { key: "outlet", label: "Outlet", render: (row) => row.outlet?.name || "-" },
          { key: "source", label: "Source", render: (row) => <StatusBadge status={row.source} /> },
          { key: "event_type", label: "Tipe", render: (row) => <StatusBadge status={row.event_type || "business"} /> },
          { key: "outcome", label: "Hasil", render: (row) => <StatusBadge status={row.outcome || "succeeded"} /> },
          { key: "module", label: "Module" },
          { key: "action", label: "Action" },
          { key: "description", label: "Keterangan", className: "min-w-[240px]" },
          { key: "detail", label: "Detail", render: (row) => (
            <RowActionButton label={`Detail log ${row.id}`} onClick={() => setDetailLog(row)}><Eye /></RowActionButton>
          ) }
        ]}
      />
      <div className="flex items-center justify-end gap-3">
        <span className="text-[12px] text-muted-foreground">Halaman {pagination.page || 1} dari {Math.max(1, pagination.total_pages || 1)}</span>
        <Button type="button" variant="outline" disabled={page <= 1 || query.isFetching} onClick={() => setPage((value) => Math.max(1, value - 1))}>Sebelumnya</Button>
        <Button type="button" variant="outline" disabled={page >= (pagination.total_pages || 1) || query.isFetching} onClick={() => setPage((value) => value + 1)}>Berikutnya</Button>
      </div>
      <Dialog open={Boolean(detailLog)} onOpenChange={(open) => !open && setDetailLog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detail Log Aktivitas</DialogTitle>
            <DialogDescription>ID event, correlation ID, dan metadata aman yang diterima backend.</DialogDescription>
          </DialogHeader>
          {detailLog ? (
            <div className="space-y-3 text-[12px]">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-md border p-3"><p className="text-muted-foreground">Event ID</p><p className="break-all font-medium">{detailLog.id}</p></div>
                <div className="rounded-md border p-3"><p className="text-muted-foreground">Correlation ID</p><p className="break-all font-medium">{detailLog.correlation_id || "-"}</p></div>
              </div>
              <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3">{JSON.stringify(detailLog.metadata_json || {}, null, 2)}</pre>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { LabaRugiPage, LogAktivitasPage, LaporanPembelianPage, LaporanPengeluaranPage, NeracaPage, PenjualanPage, RiwayatTransaksiPage };
