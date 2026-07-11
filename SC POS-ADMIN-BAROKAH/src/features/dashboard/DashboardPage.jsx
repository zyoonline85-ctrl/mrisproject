import { Fragment, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, ClipboardList, Coins, Download, PackageOpen, ReceiptText, Search, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SimpleBarChart } from "@/components/charts/SimpleBarChart";
import { MetricCard } from "@/components/shared/MetricCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useDashboard, useDashboardMaterialPurchaseComparisons } from "@/hooks/useAdminQueries";
import { cn, formatCurrency, formatDate, toDateString } from "@/lib/utils";
import { exportRowsToXlsx } from "@/lib/xlsxExport";
import { recordActivity } from "@/lib/activityAudit";
import { useAppStore } from "@/store/appStore";

const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember"
];

function getMonthRange(year, month) {
  return {
    from: toDateString(new Date(year, month, 1)),
    to: toDateString(new Date(year, month + 1, 0))
  };
}

const comparisonStatusOptions = [
  { value: "all", label: "Semua" },
  { value: "lebih_mahal", label: "Lebih Mahal" },
  { value: "termurah", label: "Termurah" },
  { value: "sama", label: "Sama" }
];

const comparisonStatusMeta = {
  lebih_mahal: { label: "Lebih Mahal", variant: "danger" },
  termurah: { label: "Termurah", variant: "success" },
  sama: { label: "Sama", variant: "info" },
  belum_ada_data: { label: "Belum Ada Data", variant: "outline" }
};

const purchaseMetricOptions = [
  { key: "price", label: "Harga" },
  { key: "qty", label: "Qty" },
  { key: "total", label: "Total" }
];

function materialTypeLabel(type) {
  return type === "biaya" ? "Biaya Produksi" : "HPP";
}

function formatQuantity(value) {
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 3
  }).format(Number(value || 0));
}

function formatExportTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("") + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function exportColumnName(index) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function formatSignedCurrency(value) {
  const amount = Number(value || 0);
  if (!amount) return formatCurrency(0);
  return `${amount > 0 ? "+" : "-"}${formatCurrency(Math.abs(amount))}`;
}

function formatSignedPercent(value) {
  const amount = Number(value || 0);
  if (!amount) return "0%";
  const formatted = new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 1
  }).format(Math.abs(amount));
  return `${amount > 0 ? "+" : "-"}${formatted}%`;
}

function formatPercentage(value) {
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(Number(value || 0))}%`;
}

function RevenueComparisonMetricCard({ periodLabel, rows = [], selectedOutletId, total }) {
  const maxRevenue = Math.max(...rows.map((row) => Number(row.total || 0)), 1);

  return (
    <Card>
      <CardContent className="grid gap-4 p-4 xl:grid-cols-[240px_minmax(0,1fr)] xl:items-start">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase text-muted-foreground">Omzet</p>
            <p className="mt-2 truncate text-[24px] font-semibold">{formatCurrency(total || 0)}</p>
            <p className="mt-1 truncate text-[11px] text-muted-foreground">{periodLabel}</p>
          </div>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <TrendingUp className="h-4 w-4" />
          </div>
        </div>

        <div className="border-t pt-3 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Perbandingan semua resto</p>
          {rows.length ? (
            <div className="grid max-h-40 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 2xl:grid-cols-3">
              {rows.map((row) => {
                const revenue = Number(row.total || 0);
                const barWidth = revenue > 0 ? Math.max((revenue / maxRevenue) * 100, 4) : 0;
                const isSelected = selectedOutletId !== "all" && row.outlet_id === selectedOutletId;

                return (
                  <div key={row.outlet_id} className={cn("rounded-md border bg-muted/15 px-2.5 py-2", isSelected && "border-primary/30 bg-primary/5 ring-1 ring-primary/15")}>
                    <div className="flex items-start justify-between gap-2 text-[11px]">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold">{row.rank}</span>
                        <span className="truncate font-medium">{row.outlet_name || row.outlet?.name || "Outlet"}</span>
                        {isSelected ? <Badge variant="outline" className="h-4 px-1 text-[8px]">Dipilih</Badge> : null}
                      </div>
                      <span className="shrink-0 font-semibold tabular-nums">{formatCurrency(revenue)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${barWidth}%` }} />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[9px] text-muted-foreground">
                      <span>{row.transaction_count || 0} transaksi</span>
                      <span>{formatPercentage(row.percentage)} kontribusi</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="py-3 text-center text-[11px] text-muted-foreground">Belum ada data omzet resto.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SalesByCategoryCard({ rows = [] }) {
  const visibleRows = rows.slice(0, 6);
  const maxTotal = Math.max(...visibleRows.map((row) => Number(row.total || 0)), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Penjualan per Kategori Produk</CardTitle>
        <p className="mt-1 text-[12px] text-muted-foreground">Kontribusi omzet berdasarkan kategori produk dalam periode dashboard.</p>
      </CardHeader>
      <CardContent>
        {!rows.length ? (
          <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed text-center text-[13px] text-muted-foreground">
            Belum ada penjualan kategori pada periode ini.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              {visibleRows.map((row) => {
                const total = Number(row.total || 0);
                const width = Math.max((total / maxTotal) * 100, total > 0 ? 7 : 0);

                return (
                  <div key={row.category_id || row.category_name} className="space-y-1">
                    <div className="flex items-center justify-between gap-3 text-[12px]">
                      <span className="min-w-0 truncate font-medium">{row.category_name || "Tanpa Kategori"}</span>
                      <span className="shrink-0 font-semibold">{formatCurrency(total)}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${width}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[520px] text-left text-[12px]">
                <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Kategori</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium">Transaksi</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                    <th className="px-3 py-2 text-right font-medium">%</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr key={`table-${row.category_id || row.category_name}`} className="border-t">
                      <td className="px-3 py-2 font-medium">{row.category_name || "Tanpa Kategori"}</td>
                      <td className="px-3 py-2 text-right">{formatQuantity(row.quantity)}</td>
                      <td className="px-3 py-2 text-right">{formatQuantity(row.transaction_count)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{formatCurrency(row.total)}</td>
                      <td className="px-3 py-2 text-right">{formatQuantity(row.percentage)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MaterialPriceComparisonCard({ rows = [] }) {
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("all");
  const [showAll, setShowAll] = useState(false);

  const filteredRows = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();

    return rows.filter((row) => {
      const rowStatus = row.status || row.trend || "belum_ada_data";
      const matchesStatus = status === "all" || rowStatus === status;
      const haystack = [
        row.material?.name,
        row.material_name,
        row.outlet?.name,
        row.outlet_name,
        row.benchmark_outlet?.name,
        row.benchmark_outlet_name,
        row.supplier?.name,
        row.supplier_name
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesKeyword = !normalizedKeyword || haystack.includes(normalizedKeyword);
      return matchesStatus && matchesKeyword;
    });
  }, [keyword, rows, status]);

  const visibleRows = showAll ? filteredRows : filteredRows.slice(0, 8);

  return (
    <Card>
      <CardHeader className="gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <CardTitle>Perbandingan Harga HPP per Outlet</CardTitle>
          <p className="mt-1 text-[12px] text-muted-foreground">Harga beli terakhir setiap outlet dibanding outlet termurah untuk produk yang sama.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_150px] lg:w-[430px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="Cari HPP, outlet, supplier" className="pl-8" />
          </div>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setShowAll(false);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {comparisonStatusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {filteredRows.length === 0 ? (
          <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed text-center text-[13px] text-muted-foreground">
            Belum ada data pembelian approved untuk dibandingkan.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-[980px] w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b text-[11px] uppercase text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Produk HPP</th>
                    <th className="px-3 py-2 font-medium">Outlet</th>
                    <th className="px-3 py-2 text-right font-medium">Harga Outlet</th>
                    <th className="px-3 py-2 font-medium">Outlet Termurah</th>
                    <th className="px-3 py-2 text-right font-medium">Harga Termurah</th>
                    <th className="px-3 py-2 text-right font-medium">Selisih</th>
                    <th className="px-3 py-2 text-right font-medium">%</th>
                    <th className="px-3 py-2 font-medium">Supplier</th>
                    <th className="px-3 py-2 font-medium">Tanggal</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const rowStatus = row.status || row.trend || "belum_ada_data";
                    const meta = comparisonStatusMeta[rowStatus] || comparisonStatusMeta.belum_ada_data;
                    const difference = Number(row.difference || 0);
                    const diffClassName = difference > 0 ? "text-[#B94949]" : "text-muted-foreground";

                    return (
                      <tr key={row.id || `${row.material_id}-${row.outlet_id}`} className="border-b last:border-0">
                        <td className="px-3 py-2 font-medium">{row.material?.name || row.material_name || "-"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{row.outlet?.name || row.outlet_name || "-"}</td>
                        <td className="px-3 py-2 text-right font-semibold">{formatCurrency(row.latest_price)}</td>
                        <td className="px-3 py-2 text-muted-foreground">{row.benchmark_outlet?.name || row.benchmark_outlet_name || "-"}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{formatCurrency(row.benchmark_price ?? row.previous_price ?? 0)}</td>
                        <td className={cn("px-3 py-2 text-right font-medium", diffClassName)}>{formatSignedCurrency(difference)}</td>
                        <td className={cn("px-3 py-2 text-right font-medium", diffClassName)}>{formatSignedPercent(row.change_percent)}</td>
                        <td className="px-3 py-2 text-muted-foreground">{row.supplier?.name || row.supplier_name || "-"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{formatDate(row.latest_purchase_date)}</td>
                        <td className="px-3 py-2">
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredRows.length > 8 ? (
              <div className="mt-3 flex items-center justify-between gap-3 text-[12px] text-muted-foreground">
                <span>
                  Menampilkan {visibleRows.length} dari {filteredRows.length} data
                </span>
                <button className="font-medium text-primary" type="button" onClick={() => setShowAll((current) => !current)}>
                  {showAll ? "Tampilkan ringkas" : "Lihat semua"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MultiSelectFilter({ label, placeholder, options = [], selectedIds = [], onChange, getLabel, getMeta }) {
  const [keyword, setKeyword] = useState("");
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const normalizedKeyword = keyword.trim().toLowerCase();
  const filteredOptions = useMemo(
    () =>
      options.filter((option) => {
        const haystack = [getLabel(option), getMeta?.(option)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return !normalizedKeyword || haystack.includes(normalizedKeyword);
      }),
    [getLabel, getMeta, normalizedKeyword, options]
  );
  const filteredIds = filteredOptions.map((option) => option.id);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedSet.has(id));

  function toggle(id) {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  }

  function toggleFiltered() {
    const next = new Set(selectedSet);
    if (allFilteredSelected) filteredIds.forEach((id) => next.delete(id));
    else filteredIds.forEach((id) => next.add(id));
    onChange(Array.from(next));
  }

  const buttonLabel = selectedIds.length ? `${selectedIds.length} dipilih` : placeholder;

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
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={toggleFiltered} disabled={!filteredIds.length}>
              {allFilteredSelected ? "Lepas hasil cari" : "Pilih hasil cari"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])} disabled={!selectedIds.length}>
              Semua
            </Button>
          </div>
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
                  {getMeta ? <span className="shrink-0 text-[11px] text-muted-foreground">{getMeta(option)}</span> : null}
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

function MetricColumnFilter({ selectedMetrics, onChange }) {
  const selectedSet = useMemo(() => new Set(selectedMetrics), [selectedMetrics]);
  const selectedLabels = purchaseMetricOptions.filter((option) => selectedSet.has(option.key)).map((option) => option.label);

  function toggleMetric(metricKey) {
    const next = new Set(selectedSet);
    if (next.has(metricKey)) {
      if (next.size === 1) return;
      next.delete(metricKey);
    } else {
      next.add(metricKey);
    }
    onChange(purchaseMetricOptions.filter((option) => next.has(option.key)).map((option) => option.key));
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-9 w-full justify-start gap-2 px-3 text-left">
          <ClipboardList className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{selectedLabels.join(", ")}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-3" align="end">
        <div className="space-y-3">
          <div>
            <p className="text-[12px] font-semibold">Kolom Outlet</p>
            <p className="text-[11px] text-muted-foreground">Pilih data yang ditampilkan per outlet.</p>
          </div>
          <div className="rounded-md border">
            {purchaseMetricOptions.map((option) => (
              <label key={option.key} className="flex cursor-pointer items-center gap-2 border-b px-3 py-2 text-[12px] last:border-b-0 hover:bg-muted/45">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={selectedSet.has(option.key)}
                  onChange={() => toggleMetric(option.key)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MaterialPurchaseComparisonCard({ data, filters, onFiltersChange, isLoading, isFetching }) {
  const [showAll, setShowAll] = useState(false);
  const [detailTarget, setDetailTarget] = useState(null);
  const [visibleMetrics, setVisibleMetrics] = useState(["price", "qty", "total"]);
  const outlets = data?.outlets || [];
  const matrixOutlets = data?.matrix_outlets || outlets;
  const purchaseRows = useMemo(() => data?.rows || [], [data?.rows]);
  const materials = data?.materials || [];
  const byOutlet = data?.summary?.by_outlet || [];
  const byMaterial = data?.summary?.by_material || [];
  const selectedSingleMaterial = filters.materialIds.length === 1 ? byMaterial.find((item) => item.material_id === filters.materialIds[0]) : null;
  const visibleMetricOptions = useMemo(
    () => purchaseMetricOptions.filter((option) => visibleMetrics.includes(option.key)),
    [visibleMetrics]
  );
  const dateProductRows = useMemo(() => {
    const outletOrder = new Map(matrixOutlets.map((outlet, index) => [outlet.id, index]));
    const grouped = new Map();

    purchaseRows.forEach((row) => {
      const key = `${row.purchase_date || "-"}__${row.material_id}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          id: key,
          purchase_date: row.purchase_date,
          material_id: row.material_id,
          material_name: row.material_name || row.material?.name || "-",
          material_type: row.material_type || row.material?.type || "hpp",
          category_name: row.category_name || "-",
          unit: row.unit || row.material?.unit || "",
          outlet_cells: matrixOutlets.map((outlet) => ({
            outlet_id: outlet.id,
            outlet_name: outlet.name,
            quantity_total: 0,
            total: 0,
            average_unit_price: 0,
            item_count: 0,
            supplier_name: "-",
            details: []
          }))
        });
      }

      const groupedRow = grouped.get(key);
      const outletIndex = outletOrder.get(row.outlet_id);
      if (outletIndex === undefined) return;
      const cell = groupedRow.outlet_cells[outletIndex];
      const quantity = Number(row.quantity || 0);
      const subtotal = Number(row.subtotal || quantity * Number(row.unit_price || 0));
      cell.quantity_total += quantity;
      cell.total += subtotal;
      cell.item_count += 1;
      cell.supplier_name = row.supplier_name || cell.supplier_name || "-";
      cell.details.push(row);
      cell.average_unit_price = cell.quantity_total ? cell.total / cell.quantity_total : Number(row.unit_price || 0);
    });

    return Array.from(grouped.values()).sort((a, b) => {
      const dateCompare = String(a.purchase_date || "").localeCompare(String(b.purchase_date || ""));
      if (dateCompare !== 0) return dateCompare;
      return String(a.material_name || "").localeCompare(String(b.material_name || ""), "id-ID");
    });
  }, [matrixOutlets, purchaseRows]);
  const visibleRows = showAll ? dateProductRows : dateProductRows.slice(0, 10);
  const detailRows = detailTarget?.details || [];
  const exportDisabled = isLoading || !dateProductRows.length || !visibleMetricOptions.length;

  function updateFilter(patch) {
    onFiltersChange((current) => ({ ...current, ...patch }));
    setShowAll(false);
    recordActivity({ module: "dashboard", action: "filter_apply", description: "Menerapkan filter dashboard pembelian.", metadata: patch });
  }

  function getExportCellValue(row, outletId, metricKey) {
    const cell = (row.outlet_cells || []).find((item) => item.outlet_id === outletId);
    if (!cell?.item_count) return "-";
    if (metricKey === "price") return formatCurrency(cell.average_unit_price);
    if (metricKey === "qty") return `${formatQuantity(cell.quantity_total)} ${row.unit || ""}`.trim();
    if (metricKey === "total") return formatCurrency(cell.total);
    return "-";
  }

  function handleExportXlsx() {
    const fixedHeaders = ["Tanggal", "Nama Produk", "Type", "Kategori", "Satuan"];
    const columns = [
      { header: "Tanggal", width: 16, value: (row) => formatDate(row.purchase_date) },
      { header: "Nama Produk", width: 30, value: (row) => row.material_name || "-" },
      { header: "Type", width: 18, value: (row) => materialTypeLabel(row.material_type) },
      { header: "Kategori", width: 24, value: (row) => row.category_name || "-" },
      { header: "Satuan", width: 12, value: (row) => row.unit || "-" },
      ...matrixOutlets.flatMap((outlet) =>
        visibleMetricOptions.map((metric) => ({
          header: `${outlet.name} - ${metric.label}`,
          width: metric.key === "qty" ? 18 : 22,
          value: (row) => getExportCellValue(row, outlet.id, metric.key)
        }))
      )
    ];
    const headerRows = [
      [
        ...fixedHeaders,
        ...matrixOutlets.flatMap((outlet) => [outlet.name, ...Array(Math.max(0, visibleMetricOptions.length - 1)).fill("")])
      ],
      [
        ...Array(fixedHeaders.length).fill(""),
        ...matrixOutlets.flatMap(() => visibleMetricOptions.map((metric) => metric.label))
      ]
    ];
    const fixedMerges = fixedHeaders.map((_, index) => `${exportColumnName(index)}1:${exportColumnName(index)}2`);
    const outletMerges = matrixOutlets
      .map((_, outletIndex) => {
        const startIndex = fixedHeaders.length + outletIndex * visibleMetricOptions.length;
        const endIndex = startIndex + visibleMetricOptions.length - 1;
        return endIndex > startIndex ? `${exportColumnName(startIndex)}1:${exportColumnName(endIndex)}1` : null;
      })
      .filter(Boolean);

    exportRowsToXlsx({
      autoFilter: false,
      bordered: true,
      columns,
      filename: `perbandingan-pembelian-hpp-${filters.from}-${filters.to}-${formatExportTimestamp()}`,
      headerRows,
      merges: [...fixedMerges, ...outletMerges],
      rows: dateProductRows,
      sheetName: "Pembelian HPP"
    });
    recordActivity({
      module: "dashboard",
      action: "dashboard/export_xlsx",
      entityType: "report",
      entityId: "purchase_comparison",
      description: "Export perbandingan pembelian HPP.",
      metadata: { row_count: dateProductRows.length, from: filters.from, to: filters.to }
    });
  }

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <CardTitle>Perbandingan Pembelian HPP/Biaya Produksi per Outlet</CardTitle>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Histori pembelian approved per tanggal, produk, dan outlet yang sudah masuk database.
            </p>
          </div>
          {isFetching ? <Badge variant="outline">Memuat</Badge> : null}
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[1fr_1fr_170px_170px_170px_150px]">
          <MultiSelectFilter
            label="Outlet"
            placeholder="Semua outlet"
            options={outlets}
            selectedIds={filters.outletIds}
            onChange={(outletIds) => updateFilter({ outletIds })}
            getLabel={(outlet) => outlet.name || "-"}
          />
          <MultiSelectFilter
            label="Produk"
            placeholder="Semua produk"
            options={materials}
            selectedIds={filters.materialIds}
            onChange={(materialIds) => updateFilter({ materialIds })}
            getLabel={(material) => material.name || "-"}
            getMeta={(material) => materialTypeLabel(material.type)}
          />
          <DatePicker value={filters.from} onChange={(from) => updateFilter({ from })} className="h-9" />
          <DatePicker value={filters.to} onChange={(to) => updateFilter({ to })} className="h-9" />
          <MetricColumnFilter selectedMetrics={visibleMetrics} onChange={setVisibleMetrics} />
          <Button type="button" variant="outline" className="h-9 justify-center" onClick={handleExportXlsx} disabled={exportDisabled}>
            <Download />
            Export XLSX
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-56" />
        ) : (
          <div className="space-y-3">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {byOutlet.slice(0, 4).map((item) => (
                <div key={item.outlet_id} className="rounded-md border bg-muted/20 px-3 py-2">
                  <p className="truncate text-[11px] font-semibold uppercase text-muted-foreground">{item.outlet_name}</p>
                  <p className="mt-1 text-[17px] font-semibold">{formatCurrency(item.total)}</p>
                  <p className="text-[11px] text-muted-foreground">{item.item_count} item pembelian</p>
                </div>
              ))}
              {!byOutlet.length ? (
                <div className="rounded-md border border-dashed px-3 py-4 text-[12px] text-muted-foreground md:col-span-2 xl:col-span-4">
                  Belum ada pembelian approved pada filter ini.
                </div>
              ) : null}
            </div>

            {selectedSingleMaterial ? (
              <div className="rounded-md border bg-primary/5 px-3 py-2 text-[12px]">
                <span className="font-semibold">{selectedSingleMaterial.material_name}</span>
                <span className="text-muted-foreground"> rata-rata harga: </span>
                <span className="font-semibold">{formatCurrency(selectedSingleMaterial.average_unit_price)}</span>
                <span className="text-muted-foreground"> dari {selectedSingleMaterial.item_count} item pembelian.</span>
              </div>
            ) : null}

            <div className="overflow-x-auto rounded-md border">
              <table
                className="w-full text-left text-[13px]"
                style={{ minWidth: `${Math.max(760, 360 + matrixOutlets.length * visibleMetricOptions.length * 120)}px` }}
              >
                <thead>
                  <tr className="border-b bg-muted/30 text-[11px] uppercase text-muted-foreground">
                    <th rowSpan={2} className="w-[130px] border-r px-3 py-2 font-medium">
                      Tanggal
                    </th>
                    <th rowSpan={2} className="w-[230px] border-r px-3 py-2 font-medium">
                      Nama Produk
                    </th>
                    {matrixOutlets.map((outlet) => (
                      <th key={outlet.id} colSpan={visibleMetricOptions.length} className="border-r px-3 py-2 text-center font-medium last:border-r-0">
                        {outlet.name}
                      </th>
                    ))}
                  </tr>
                  <tr className="border-b bg-muted/30 text-[11px] uppercase text-muted-foreground">
                    {matrixOutlets.map((outlet) => (
                      <Fragment key={`${outlet.id}_columns`}>
                        {visibleMetricOptions.map((metric, metricIndex) => (
                          <th
                            key={`${outlet.id}_${metric.key}`}
                            className={cn(
                              "w-[120px] px-3 py-2 text-right font-medium",
                              metricIndex === visibleMetricOptions.length - 1 && "border-r last:border-r-0"
                            )}
                          >
                            {metric.label}
                          </th>
                        ))}
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length ? (
                    visibleRows.map((row) => (
                      <tr key={row.id} className="border-b last:border-b-0">
                        <td className="border-r px-3 py-3 align-top font-medium text-muted-foreground">{formatDate(row.purchase_date)}</td>
                        <td className="border-r px-3 py-3 align-top">
                          <p className="font-semibold">{row.material_name}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge variant={row.material_type === "biaya" ? "gold" : "info"}>{materialTypeLabel(row.material_type)}</Badge>
                            <span className="text-[11px] text-muted-foreground">{row.unit || "-"}</span>
                          </div>
                          <p className="mt-1 text-[11px] text-muted-foreground">{row.category_name || "-"}</p>
                        </td>
                        {matrixOutlets.map((outlet) => {
                          const cell = (row.outlet_cells || []).find((item) => item.outlet_id === outlet.id) || {
                            outlet_id: outlet.id,
                            outlet_name: outlet.name,
                            item_count: 0
                          };
                          return (
                            <Fragment key={`${row.id}_${outlet.id}`}>
                              {visibleMetricOptions.map((metric, metricIndex) => {
                                const isLastMetric = metricIndex === visibleMetricOptions.length - 1;
                                let value = "-";
                                if (cell.item_count && metric.key === "price") value = formatCurrency(cell.average_unit_price);
                                if (cell.item_count && metric.key === "qty") value = `${formatQuantity(cell.quantity_total)} ${row.unit}`;
                                if (cell.item_count && metric.key === "total") value = formatCurrency(cell.total);

                                return (
                                  <td
                                    key={`${row.id}_${outlet.id}_${metric.key}`}
                                    className={cn(
                                      "px-3 py-3 text-right align-top",
                                      isLastMetric && "border-r last:border-r-0",
                                      !cell.item_count && "text-muted-foreground",
                                      cell.item_count && metric.key === "total" && "font-semibold",
                                      cell.item_count && metric.key === "price" && "font-semibold"
                                    )}
                                  >
                                    <p>{value}</p>
                                    {cell.item_count && metricIndex === 0 ? (
                                      <button
                                        type="button"
                                        className="mt-1 text-[11px] font-medium text-primary"
                                        onClick={() => setDetailTarget({ row, cell, details: cell.details || [] })}
                                      >
                                        Detail
                                      </button>
                                    ) : null}
                                  </td>
                                );
                              })}
                            </Fragment>
                          );
                        })}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={2 + matrixOutlets.length * visibleMetricOptions.length} className="px-3 py-10 text-center text-[13px] text-muted-foreground">
                        Belum ada histori pembelian approved yang cocok dengan filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {dateProductRows.length > 10 ? (
              <div className="flex items-center justify-between gap-3 text-[12px] text-muted-foreground">
                <span>
                  Menampilkan {visibleRows.length} dari {dateProductRows.length} baris tanggal-produk
                </span>
                <button className="font-medium text-primary" type="button" onClick={() => setShowAll((current) => !current)}>
                  {showAll ? "Tampilkan ringkas" : "Lihat semua"}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
      <Dialog open={Boolean(detailTarget)} onOpenChange={(open) => !open && setDetailTarget(null)}>
        <DialogContent className="max-h-[calc(100vh-5rem)] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detail Pembelian {detailTarget?.row?.material_name || ""}</DialogTitle>
            <DialogDescription>
              {detailTarget?.cell?.outlet_name || "-"} dalam rentang {formatDate(filters.from)} sampai {formatDate(filters.to)}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-x-auto rounded-md border">
            <table className="min-w-[720px] w-full text-left text-[13px]">
              <thead>
                <tr className="border-b bg-muted/30 text-[11px] uppercase text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Tanggal</th>
                  <th className="px-3 py-2 font-medium">Purchase ID</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 font-medium">Satuan</th>
                  <th className="px-3 py-2 text-right font-medium">Harga Satuan</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 font-medium">Supplier</th>
                </tr>
              </thead>
              <tbody>
                {detailRows.length ? (
                  detailRows.map((row) => (
                    <tr key={row.id} className="border-b last:border-b-0">
                      <td className="px-3 py-2 text-muted-foreground">{formatDate(row.purchase_date)}</td>
                      <td className="px-3 py-2 font-medium">{row.purchase_id}</td>
                      <td className="px-3 py-2 text-right">{formatQuantity(row.quantity)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.unit}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(row.unit_price)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{formatCurrency(row.subtotal)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.supplier_name || "-"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-[13px] text-muted-foreground">
                      Tidak ada detail pembelian.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function DashboardPage() {
  const selectedOutletId = useAppStore((state) => state.selectedOutletId);
  const today = useMemo(() => new Date(), []);
  const initialRange = useMemo(() => getMonthRange(today.getFullYear(), today.getMonth()), [today]);
  const [period, setPeriod] = useState({
    month: today.getMonth(),
    year: today.getFullYear()
  });
  const [purchaseComparisonFilters, setPurchaseComparisonFilters] = useState({
    from: initialRange.from,
    to: initialRange.to,
    outletIds: [],
    materialIds: []
  });
  const periodRange = getMonthRange(period.year, period.month);
  const periodLabel = `${MONTHS[period.month]} ${period.year}`;
  const yearOptions = Array.from({ length: 6 }, (_, index) => today.getFullYear() - index);
  const { data, isLoading, isFetching, isError, refetch } = useDashboard({
    outletId: selectedOutletId,
    from: periodRange.from,
    to: periodRange.to
  });
  const purchaseComparisonQuery = useDashboardMaterialPurchaseComparisons({
    from: purchaseComparisonFilters.from,
    to: purchaseComparisonFilters.to,
    outletIds: purchaseComparisonFilters.outletIds.join(","),
    materialIds: purchaseComparisonFilters.materialIds.join(",")
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-28" />)}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="flex min-h-64 items-center justify-center text-center">
          <div>
            <p className="font-semibold">Dashboard gagal dimuat.</p>
            <button className="mt-2 text-primary" type="button" onClick={() => refetch()}>
              Coba lagi
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const dashboardData = data || {};
  const metrics = dashboardData.metrics || {};
  const materialPriceComparisons = Array.isArray(dashboardData.material_price_comparisons) ? dashboardData.material_price_comparisons : [];
  const dailySales = Array.isArray(dashboardData.daily_sales) ? dashboardData.daily_sales : [];
  const topProducts = Array.isArray(dashboardData.top_products) ? dashboardData.top_products : [];
  const salesByCategory = Array.isArray(dashboardData.sales_by_category) ? dashboardData.sales_by_category : [];
  const salesByOutlet = Array.isArray(dashboardData.sales_by_outlet) ? dashboardData.sales_by_outlet : [];
  const lowStocks = Array.isArray(dashboardData.low_stocks) ? dashboardData.low_stocks : [];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase text-muted-foreground">Periode Dashboard</p>
            <p className="mt-1 flex items-center gap-2 text-[16px] font-semibold">
              <CalendarDays className="h-4 w-4 text-primary" />
              {periodLabel}
              {isFetching ? <Badge variant="outline">Memuat</Badge> : null}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:w-[320px]">
            <Select value={String(period.month)} onValueChange={(value) => setPeriod((current) => ({ ...current, month: Number(value) }))}>
              <SelectTrigger>
                <SelectValue placeholder="Bulan" />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((month, index) => (
                  <SelectItem key={month} value={String(index)}>
                    {month}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(period.year)} onValueChange={(value) => setPeriod((current) => ({ ...current, year: Number(value) }))}>
              <SelectTrigger>
                <SelectValue placeholder="Tahun" />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((year) => (
                  <SelectItem key={year} value={String(year)}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className={isFetching ? "space-y-3 opacity-70 transition-opacity" : "space-y-3 transition-opacity"}>
        <RevenueComparisonMetricCard
          periodLabel={periodLabel}
          rows={salesByOutlet}
          selectedOutletId={selectedOutletId}
          total={metrics.revenue}
        />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard title="Transaksi" value={metrics.transactions || 0} description="Order paid" icon={ReceiptText} tone="blue" />
          <MetricCard title="Pembelian" value={formatCurrency(metrics.purchases || 0)} description="Harga Pokok Produksi" icon={ClipboardList} tone="gold" />
          <MetricCard title="Pengeluaran" value={formatCurrency(metrics.expenses || 0)} description="POS expense" icon={Coins} tone="danger" />
          <MetricCard title="Estimasi Laba" value={formatCurrency(metrics.gross_profit_estimate || 0)} description="Gross profit" icon={TrendingUp} tone="green" />
          <MetricCard title="Stok Menipis" value={metrics.low_stock_count || lowStocks.length} description="Perlu dicek" icon={AlertTriangle} tone="gold" />
        </div>
      </div>

      <div className={isFetching ? "opacity-70 transition-opacity" : "transition-opacity"}>
        <MaterialPriceComparisonCard rows={materialPriceComparisons} />
      </div>

      <MaterialPurchaseComparisonCard
        data={purchaseComparisonQuery.data}
        filters={purchaseComparisonFilters}
        onFiltersChange={setPurchaseComparisonFilters}
        isLoading={purchaseComparisonQuery.isLoading}
        isFetching={purchaseComparisonQuery.isFetching}
      />

      <div className={isFetching ? "grid gap-4 opacity-70 transition-opacity xl:grid-cols-[1.45fr_0.9fr]" : "grid gap-4 transition-opacity xl:grid-cols-[1.45fr_0.9fr]"}>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Penjualan Harian</CardTitle>
              <p className="mt-1 text-[12px] text-muted-foreground">Grafik omzet dari transaksi paid.</p>
            </div>
            <Badge variant="info">{periodLabel}</Badge>
          </CardHeader>
          <CardContent>
            <SimpleBarChart data={dailySales} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Produk Terlaris</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topProducts.length ? (
              topProducts.map((item, index) => (
                <div key={item.product?.id || item.product_id || item.name || index} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{item.product?.name || item.product_name || item.name || "Tanpa nama"}</p>
                    <p className="text-[11px] text-muted-foreground">{item.quantity} item terjual</p>
                  </div>
                  <Badge variant={index < 2 ? "default" : "outline"}>{formatCurrency(item.total)}</Badge>
                </div>
              ))
            ) : (
              <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed text-center text-[13px] text-muted-foreground">
                Belum ada produk terjual pada periode ini.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className={isFetching ? "opacity-70 transition-opacity" : "transition-opacity"}>
        <SalesByCategoryCard rows={salesByCategory} />
      </div>

      <div className={isFetching ? "opacity-70 transition-opacity" : "transition-opacity"}>
        <Card>
          <CardHeader>
            <CardTitle>Stok Perlu Dicek</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {lowStocks.length === 0 ? (
              <div className="flex min-h-32 items-center justify-center text-muted-foreground">
                <PackageOpen className="mr-2 h-4 w-4" />
                Semua stok aman.
              </div>
            ) : (
              lowStocks.map((stock, index) => (
                <div key={stock.id || `${stock.material_id || "material"}-${stock.outlet_id || "outlet"}-${index}`} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{stock.material?.name || stock.material_name || "Tanpa nama"}</p>
                    <p className="text-[11px] text-muted-foreground">{stock.outlet?.name || stock.outlet_name || "-"}</p>
                  </div>
                  <div className="text-right">
                    <StatusBadge status={stock.status} />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {stock.quantity} {stock.unit}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export { DashboardPage };
