import React, { useState, useMemo } from "react";
import {
  useBootstrap,
  useMasterData,
  useManualDailyReports,
  useCreateManualDailyReport,
  useManualLogisticReports,
  useCreateManualLogisticReport,
} from "@/hooks/useAdminQueries";
import { useAppStore } from "@/store/appStore";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  FileText, 
  Package, 
  Calendar, 
  Store, 
  Plus, 
  Trash2, 
  Save, 
  History, 
  TrendingUp, 
  TrendingDown,
  DollarSign
} from "lucide-react";

export default function ManualReportsPage() {
  const selectedGlobalOutletId = useAppStore((s) => s.selectedOutletId);
  const bootstrap = useBootstrap();
  const masterDataQuery = useMasterData({ outletId: selectedGlobalOutletId });
  
  // Tab state
  const [activeTab, setActiveTab] = useState("daily"); // "daily" or "logistic"
  
  // Filters state
  const [outletFilter, setOutletFilter] = useState("all");
  const [dateFromFilter, setDateFromFilter] = useState("");
  const [dateToFilter, setDateToFilter] = useState("");

  const activeOutletId = outletFilter === "all" ? selectedGlobalOutletId : outletFilter;

  // Fetch histories
  const dailyQuery = useManualDailyReports({
    outletId: activeOutletId,
    from: dateFromFilter || undefined,
    to: dateToFilter || undefined,
  });

  const logisticQuery = useManualLogisticReports({
    outletId: activeOutletId,
    from: dateFromFilter || undefined,
    to: dateToFilter || undefined,
  });

  const createDailyMutation = useCreateManualDailyReport();
  const createLogisticMutation = useCreateManualLogisticReport();

  const outlets = bootstrap.data?.outlets || [];
  const users = bootstrap.data?.users || [];
  const materials = masterDataQuery.data?.materials || [];

  const getOutletName = (id) => outlets.find((o) => o.id === id)?.name || id || "-";
  const getUserName = (id) => users.find((u) => u.id === id)?.name || id || "-";

  // Form states for Daily Report
  const [dailyForm, setDailyForm] = useState({
    outletId: selectedGlobalOutletId || "",
    reportDate: new Date().toISOString().split("T")[0],
    totalSales: "",
    totalExpense: "",
    notes: "",
  });

  // Form states for Logistic Report
  const [logisticForm, setLogisticForm] = useState({
    outletId: selectedGlobalOutletId || "",
    reportDate: new Date().toISOString().split("T")[0],
    notes: "",
    items: [{ materialId: "", quantity: "", unit: "" }],
  });

  // Sync outletId if global outlet changes and form is not touched
  React.useEffect(() => {
    if (selectedGlobalOutletId) {
      setDailyForm((prev) => ({ ...prev, outletId: selectedGlobalOutletId }));
      setLogisticForm((prev) => ({ ...prev, outletId: selectedGlobalOutletId }));
    }
  }, [selectedGlobalOutletId]);

  const handleDailySubmit = async (e) => {
    e.preventDefault();
    if (!dailyForm.outletId) return;
    try {
      await createDailyMutation.mutateAsync({
        outletId: dailyForm.outletId,
        reportDate: dailyForm.reportDate,
        totalSales: Number(dailyForm.totalSales) || 0,
        totalExpense: Number(dailyForm.totalExpense) || 0,
        notes: dailyForm.notes,
      });
      setDailyForm((prev) => ({
        ...prev,
        totalSales: "",
        totalExpense: "",
        notes: "",
      }));
      dailyQuery.refetch();
    } catch (err) {
      // Toast handled by mutation hook
    }
  };

  const handleLogisticSubmit = async (e) => {
    e.preventDefault();
    if (!logisticForm.outletId) return;
    
    // Filter out invalid empty items
    const validItems = logisticForm.items.filter(it => it.materialId && Number(it.quantity) > 0);
    if (validItems.length === 0) {
      alert("Harap masukkan minimal satu item bahan baku dengan jumlah valid.");
      return;
    }

    try {
      await createLogisticMutation.mutateAsync({
        outletId: logisticForm.outletId,
        reportDate: logisticForm.reportDate,
        notes: logisticForm.notes,
        details: validItems.map(it => ({
          material_id: it.materialId,
          quantity: Number(it.quantity),
          unit: it.unit
        })),
      });
      setLogisticForm((prev) => ({
        ...prev,
        notes: "",
        items: [{ materialId: "", quantity: "", unit: "" }],
      }));
      logisticQuery.refetch();
    } catch (err) {
      // Toast handled by mutation hook
    }
  };

  const addLogisticRow = () => {
    setLogisticForm((prev) => ({
      ...prev,
      items: [...prev.items, { materialId: "", quantity: "", unit: "" }],
    }));
  };

  const removeLogisticRow = (index) => {
    if (logisticForm.items.length <= 1) return;
    setLogisticForm((prev) => {
      const copy = [...prev.items];
      copy.splice(index, 1);
      return { ...prev, items: copy };
    });
  };

  const handleLogisticRowChange = (index, field, value) => {
    setLogisticForm((prev) => {
      const copy = [...prev.items];
      if (field === "materialId") {
        const material = materials.find(m => m.id === value);
        copy[index] = {
          ...copy[index],
          materialId: value,
          unit: material?.unit || "",
        };
      } else {
        copy[index] = {
          ...copy[index],
          [field]: value,
        };
      }
      return { ...prev, items: copy };
    });
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-500 to-emerald-500 bg-clip-text text-transparent">
            Laporan Manual
          </h1>
          <p className="text-slate-500 dark:text-slate-400">
            Kelola penginputan laporan harian dan logistik manual outlet secara terintegrasi.
          </p>
        </div>
      </div>

      {/* Tab Selectors */}
      <div className="flex border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setActiveTab("daily")}
          className={`flex items-center gap-2 py-3 px-6 font-semibold border-b-2 transition-all ${
            activeTab === "daily"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <FileText className="w-5 h-5" />
          Laporan Harian
        </button>
        <button
          onClick={() => setActiveTab("logistic")}
          className={`flex items-center gap-2 py-3 px-6 font-semibold border-b-2 transition-all ${
            activeTab === "logistic"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Package className="w-5 h-5" />
          Laporan Logistik
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form Column */}
        <div className="lg:col-span-1">
          {activeTab === "daily" ? (
            <Card className="backdrop-blur-md bg-white/70 dark:bg-slate-900/70 border border-slate-200/50 shadow-lg">
              <CardHeader>
                <CardTitle className="text-xl font-bold flex items-center gap-2">
                  <Plus className="text-indigo-500" />
                  Isi Laporan Harian
                </CardTitle>
                <CardDescription>Catat penjualan dan pengeluaran manual outlet</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleDailySubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="daily-outlet">Outlet</Label>
                    <Select
                      value={dailyForm.outletId}
                      onValueChange={(val) => setDailyForm(p => ({ ...p, outletId: val }))}
                    >
                      <SelectTrigger id="daily-outlet">
                        <SelectValue placeholder="Pilih Outlet" />
                      </SelectTrigger>
                      <SelectContent>
                        {outlets.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="daily-date">Tanggal</Label>
                    <Input
                      type="date"
                      id="daily-date"
                      value={dailyForm.reportDate}
                      onChange={(e) => setDailyForm(p => ({ ...p, reportDate: e.target.value }))}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="daily-sales">Total Penjualan (Rp)</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-3 h-4 h-4 text-slate-400" />
                      <Input
                        type="number"
                        id="daily-sales"
                        placeholder="0"
                        className="pl-9"
                        value={dailyForm.totalSales}
                        onChange={(e) => setDailyForm(p => ({ ...p, totalSales: e.target.value }))}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="daily-expense">Total Pengeluaran (Rp)</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-3 h-4 h-4 text-slate-400" />
                      <Input
                        type="number"
                        id="daily-expense"
                        placeholder="0"
                        className="pl-9"
                        value={dailyForm.totalExpense}
                        onChange={(e) => setDailyForm(p => ({ ...p, totalExpense: e.target.value }))}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="daily-notes">Catatan</Label>
                    <textarea
                      id="daily-notes"
                      placeholder="Catatan tambahan (opsional)..."
                      value={dailyForm.notes}
                      onChange={(e) => setDailyForm(p => ({ ...p, notes: e.target.value }))}
                      className="flex min-h-[80px] w-full rounded-md border border-slate-200 dark:border-slate-800 bg-transparent px-3 py-2 text-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>

                  <Button
                    type="submit"
                    className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 rounded-lg"
                    disabled={createDailyMutation.isPending}
                  >
                    <Save className="w-4 h-4" />
                    {createDailyMutation.isPending ? "Menyimpan..." : "Simpan Laporan"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : (
            <Card className="backdrop-blur-md bg-white/70 dark:bg-slate-900/70 border border-slate-200/50 shadow-lg">
              <CardHeader>
                <CardTitle className="text-xl font-bold flex items-center gap-2">
                  <Plus className="text-emerald-500" />
                  Isi Laporan Logistik
                </CardTitle>
                <CardDescription>Catat bahan baku masuk outlet secara manual</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleLogisticSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="log-outlet">Outlet</Label>
                    <Select
                      value={logisticForm.outletId}
                      onValueChange={(val) => setLogisticForm(p => ({ ...p, outletId: val }))}
                    >
                      <SelectTrigger id="log-outlet">
                        <SelectValue placeholder="Pilih Outlet" />
                      </SelectTrigger>
                      <SelectContent>
                        {outlets.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="log-date">Tanggal</Label>
                    <Input
                      type="date"
                      id="log-date"
                      value={logisticForm.reportDate}
                      onChange={(e) => setLogisticForm(p => ({ ...p, reportDate: e.target.value }))}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center mb-2">
                      <Label>Daftar Bahan Baku Masuk</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addLogisticRow}
                        className="flex items-center gap-1 text-xs"
                      >
                        <Plus className="w-3.5 h-3.5" /> Tambah Baris
                      </Button>
                    </div>
                    
                    <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                      {logisticForm.items.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2 border border-slate-100 dark:border-slate-800 p-2 rounded-lg relative bg-white/50 dark:bg-slate-900/50">
                          <div className="flex-1 space-y-1">
                            <Select
                              value={item.materialId}
                              onValueChange={(val) => handleLogisticRowChange(idx, "materialId", val)}
                            >
                              <SelectTrigger className="text-xs h-8">
                                <SelectValue placeholder="Pilih Bahan Baku" />
                              </SelectTrigger>
                              <SelectContent>
                                {materials.map((m) => (
                                  <SelectItem key={m.id} value={m.id}>
                                    {m.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                placeholder="Jumlah"
                                value={item.quantity}
                                onChange={(e) => handleLogisticRowChange(idx, "quantity", e.target.value)}
                                className="text-xs h-8 w-24"
                                required
                              />
                              <span className="text-xs text-slate-500 font-medium">
                                {item.unit || "satuan"}
                              </span>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeLogisticRow(idx)}
                            className="text-red-500 hover:text-red-700 h-8 w-8"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="log-notes">Catatan Umum</Label>
                    <textarea
                      id="log-notes"
                      placeholder="Catatan pengiriman/logistik..."
                      value={logisticForm.notes}
                      onChange={(e) => setLogisticForm(p => ({ ...p, notes: e.target.value }))}
                      className="flex min-h-[80px] w-full rounded-md border border-slate-200 dark:border-slate-800 bg-transparent px-3 py-2 text-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>

                  <Button
                    type="submit"
                    className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2 rounded-lg"
                    disabled={createLogisticMutation.isPending}
                  >
                    <Save className="w-4 h-4" />
                    {createLogisticMutation.isPending ? "Menyimpan..." : "Simpan Laporan"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </div>

        {/* History List Column */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="backdrop-blur-md bg-white/70 dark:bg-slate-900/70 border border-slate-200/50 shadow-md">
            <CardHeader className="pb-3">
              <CardTitle className="text-xl font-bold flex items-center gap-2">
                <History className="text-slate-500" />
                Riwayat Laporan Manual
              </CardTitle>
              <CardDescription>Filter dan pantau pengisian data manual</CardDescription>
            </CardHeader>
            <CardContent>
              {/* Filters Panel */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500">Filter Outlet</label>
                  <Select value={outletFilter} onValueChange={setOutletFilter}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Pilih Outlet" />
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
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500">Dari Tanggal</label>
                  <Input
                    type="date"
                    value={dateFromFilter}
                    onChange={(e) => setDateFromFilter(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500">Sampai Tanggal</label>
                  <Input
                    type="date"
                    value={dateToFilter}
                    onChange={(e) => setDateToFilter(e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>

              {activeTab === "daily" ? (
                /* Daily Reports Table */
                dailyQuery.isLoading ? (
                  <div className="text-center py-8 text-slate-500">Memuat riwayat harian...</div>
                ) : dailyQuery.data?.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">Belum ada laporan harian manual yang diisi.</div>
                ) : (
                  <div className="overflow-x-auto border border-slate-100 dark:border-slate-800 rounded-lg">
                    <Table>
                      <TableHeader className="bg-slate-50/50 dark:bg-slate-900/50">
                        <TableRow>
                          <TableHead>Tanggal</TableHead>
                          <TableHead>Outlet</TableHead>
                          <TableHead className="text-right">Penjualan</TableHead>
                          <TableHead className="text-right">Pengeluaran</TableHead>
                          <TableHead className="text-right">Profit/Selisih</TableHead>
                          <TableHead>Penginput</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dailyQuery.data?.map((row) => {
                          const profit = row.total_sales - row.total_expense;
                          return (
                            <TableRow key={row.id}>
                              <TableCell className="font-medium flex items-center gap-1.5">
                                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                {row.report_date}
                              </TableCell>
                              <TableCell className="font-semibold">{getOutletName(row.outlet_id)}</TableCell>
                              <TableCell className="text-right font-medium text-emerald-600">{formatCurrency(row.total_sales)}</TableCell>
                              <TableCell className="text-right font-medium text-red-500">{formatCurrency(row.total_expense)}</TableCell>
                              <TableCell className={`text-right font-bold ${profit >= 0 ? "text-indigo-600 dark:text-indigo-400" : "text-amber-600"}`}>
                                {formatCurrency(profit)}
                              </TableCell>
                              <TableCell className="text-xs text-slate-500">{getUserName(row.created_by)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )
              ) : (
                /* Logistic Reports Table */
                logisticQuery.isLoading ? (
                  <div className="text-center py-8 text-slate-500">Memuat riwayat logistik...</div>
                ) : logisticQuery.data?.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">Belum ada laporan logistik manual yang diisi.</div>
                ) : (
                  <div className="overflow-x-auto border border-slate-100 dark:border-slate-800 rounded-lg">
                    <Table>
                      <TableHeader className="bg-slate-50/50 dark:bg-slate-900/50">
                        <TableRow>
                          <TableHead>Tanggal</TableHead>
                          <TableHead>Outlet</TableHead>
                          <TableHead>Bahan Baku Masuk</TableHead>
                          <TableHead>Catatan</TableHead>
                          <TableHead>Penginput</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {logisticQuery.data?.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell className="font-medium flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5 text-slate-400" />
                              {row.report_date}
                            </TableCell>
                            <TableCell className="font-semibold">{getOutletName(row.outlet_id)}</TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                {row.details_json?.map((item, idx) => {
                                  const materialName = materials.find(m => m.id === item.material_id)?.name || item.material_id;
                                  return (
                                    <div key={idx} className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                      📦 {materialName} ({item.quantity} {item.unit})
                                    </div>
                                  );
                                })}
                              </div>
                            </TableCell>
                            <TableCell className="max-w-[150px] truncate text-xs text-slate-500" title={row.notes}>
                              {row.notes || "-"}
                            </TableCell>
                            <TableCell className="text-xs text-slate-500">{getUserName(row.created_by)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
