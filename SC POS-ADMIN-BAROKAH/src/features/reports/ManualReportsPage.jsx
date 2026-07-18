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
  
  // Master data dari useMasterData
  const materials = masterDataQuery.data?.materials || [];
  const suppliers = masterDataQuery.data?.suppliers || [];
  const expenseCategories = masterDataQuery.data?.expenseCategories || masterDataQuery.data?.expense_categories || [];

  const getOutletName = (id) => outlets.find((o) => o.id === id)?.name || id || "-";
  const getUserName = (id) => users.find((u) => u.id === id)?.name || id || "-";

  // 1. Form States for Daily Report (Sama seperti Mobile APK)
  const [dailyForm, setDailyForm] = useState({
    outletId: selectedGlobalOutletId || "",
    reportDate: new Date().toISOString().split("T")[0],
    cashIncome: 0,
    transferIncome: 0,
    qrisIncome: 0,
    returnCashAmount: 0,
    returnCashDate: new Date().toISOString().split("T")[0],
    notes: "",
    expenseLines: [{ type: "hpp", materialId: "", expenseCategoryId: "", quantity: "", price: "", note: "" }]
  });

  // Calculate Daily Totals (Live)
  const totalIncome = Number(dailyForm.cashIncome) + Number(dailyForm.transferIncome) + Number(dailyForm.qrisIncome);
  const totalExpense = dailyForm.expenseLines.reduce((acc, row) => {
    const qty = Number(row.quantity) || 0;
    const price = Number(row.price) || 0;
    return acc + (qty * price);
  }, 0);
  const grossProfit = totalIncome - totalExpense;
  const drawerMoney = Number(dailyForm.cashIncome) - Number(dailyForm.returnCashAmount) - totalExpense;

  // 2. Form States for Logistic Report (Sama seperti Mobile APK)
  const [logisticForm, setLogisticForm] = useState({
    outletId: selectedGlobalOutletId || "",
    reportDate: new Date().toISOString().split("T")[0],
    supplierId: "",
    paymentType: "lunas", // lunas / tempo
    notes: "",
    items: [{ materialId: "", quantity: "", price: "", unit: "" }]
  });

  // Calculate Logistic Total (Live)
  const logisticTotal = logisticForm.items.reduce((acc, row) => {
    const qty = Number(row.quantity) || 0;
    const price = Number(row.price) || 0;
    return acc + (qty * price);
  }, 0);

  // Sync outletId if global outlet changes
  React.useEffect(() => {
    if (selectedGlobalOutletId) {
      setDailyForm((prev) => ({ ...prev, outletId: selectedGlobalOutletId }));
      setLogisticForm((prev) => ({ ...prev, outletId: selectedGlobalOutletId }));
    }
  }, [selectedGlobalOutletId]);

  const handleDailySubmit = async (e) => {
    e.preventDefault();
    if (!dailyForm.outletId) return;

    // Filter dynamic expense rows
    const validExpenses = dailyForm.expenseLines.filter(row => {
      const isHppValid = row.type === "hpp" && row.materialId;
      const isBiayaValid = row.type === "biaya" && row.expenseCategoryId;
      return (isHppValid || isBiayaValid) && Number(row.quantity) > 0 && Number(row.price) > 0;
    });

    try {
      await createDailyMutation.mutateAsync({
        outletId: dailyForm.outletId,
        reportDate: dailyForm.reportDate,
        cashIncome: Number(dailyForm.cashIncome) || 0,
        transferIncome: Number(dailyForm.transferIncome) || 0,
        qrisIncome: Number(dailyForm.qrisIncome) || 0,
        totalIncome: totalIncome,
        totalExpense: totalExpense,
        returnCashAmount: Number(dailyForm.returnCashAmount) || 0,
        returnCashDate: dailyForm.returnCashDate,
        notes: dailyForm.notes,
        details: validExpenses.map(row => ({
          isHpp: row.type === "hpp",
          quantity: Number(row.quantity),
          price: Number(row.price),
          amount: Number(row.quantity) * Number(row.price),
          note: row.note || "",
          material_id: row.type === "hpp" ? row.materialId : null,
          expense_category_id: row.type === "biaya" ? row.expenseCategoryId : null
        }))
      });

      setDailyForm((prev) => ({
        ...prev,
        cashIncome: 0,
        transferIncome: 0,
        qrisIncome: 0,
        returnCashAmount: 0,
        notes: "",
        expenseLines: [{ type: "hpp", materialId: "", expenseCategoryId: "", quantity: "", price: "", note: "" }]
      }));
      dailyQuery.refetch();
    } catch (err) {
      // Toast handled by mutation hook
    }
  };

  const handleLogisticSubmit = async (e) => {
    e.preventDefault();
    if (!logisticForm.outletId) return;

    const validItems = logisticForm.items.filter(it => it.materialId && Number(it.quantity) > 0 && Number(it.price) > 0);
    if (validItems.length === 0) {
      alert("Harap masukkan minimal satu item bahan baku dengan jumlah & harga valid.");
      return;
    }

    try {
      await createLogisticMutation.mutateAsync({
        outletId: logisticForm.outletId,
        reportDate: logisticForm.reportDate,
        supplierId: logisticForm.supplierId || null,
        paymentType: logisticForm.paymentType,
        totalAmount: logisticTotal,
        notes: logisticForm.notes,
        details: validItems.map(it => ({
          material_id: it.materialId,
          quantity: Number(it.quantity),
          price: Number(it.price),
          subtotal: Number(it.quantity) * Number(it.price)
        }))
      });

      setLogisticForm((prev) => ({
        ...prev,
        supplierId: "",
        notes: "",
        items: [{ materialId: "", quantity: "", price: "", unit: "" }]
      }));
      logisticQuery.refetch();
    } catch (err) {
      // Toast handled by mutation hook
    }
  };

  // ─── HELPER HARIAN ────────────────────────────────────────────────────────
  const addExpenseRow = () => {
    setDailyForm(prev => ({
      ...prev,
      expenseLines: [...prev.expenseLines, { type: "hpp", materialId: "", expenseCategoryId: "", quantity: "", price: "", note: "" }]
    }));
  };

  const removeExpenseRow = (index) => {
    if (dailyForm.expenseLines.length <= 1) return;
    setDailyForm(prev => {
      const copy = [...prev.expenseLines];
      copy.splice(index, 1);
      return { ...prev, expenseLines: copy };
    });
  };

  const handleExpenseRowChange = (index, field, value) => {
    setDailyForm(prev => {
      const copy = [...prev.expenseLines];
      copy[index] = { ...copy[index], [field]: value };
      if (field === "type") {
        copy[index].materialId = "";
        copy[index].expenseCategoryId = "";
      }
      return { ...prev, expenseLines: copy };
    });
  };

  // ─── HELPER LOGISTIK ──────────────────────────────────────────────────────
  const addLogisticRow = () => {
    setLogisticForm(prev => ({
      ...prev,
      items: [...prev.items, { materialId: "", quantity: "", price: "", unit: "" }]
    }));
  };

  const removeLogisticRow = (index) => {
    if (logisticForm.items.length <= 1) return;
    setLogisticForm(prev => {
      const copy = [...prev.items];
      copy.splice(index, 1);
      return { ...prev, items: copy };
    });
  };

  const handleLogisticRowChange = (index, field, value) => {
    setLogisticForm(prev => {
      const copy = [...prev.items];
      if (field === "materialId") {
        const mat = materials.find(m => m.id === value);
        copy[index] = {
          ...copy[index],
          materialId: value,
          unit: mat?.unit || "",
          price: mat?.price || ""
        };
      } else {
        copy[index] = { ...copy[index], [field]: value };
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
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Standar penginputan data harian dan logistik manual disamakan dengan Mobile APK Kasir.
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Form Column */}
        <div className="lg:col-span-5">
          {activeTab === "daily" ? (
            <Card className="backdrop-blur-md bg-white/70 dark:bg-slate-900/70 border border-slate-200/50 shadow-lg">
              <CardHeader>
                <CardTitle className="text-xl font-bold flex items-center gap-2">
                  <Plus className="text-indigo-500" />
                  Isi Laporan Harian
                </CardTitle>
                <CardDescription>Format input harian sesuai Mobile APK</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleDailySubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Outlet</Label>
                      <Select
                        value={dailyForm.outletId}
                        onValueChange={(val) => setDailyForm(p => ({ ...p, outletId: val }))}
                      >
                        <SelectTrigger className="h-9">
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

                    <div className="space-y-1">
                      <Label className="text-xs">Tanggal Laporan</Label>
                      <Input
                        type="date"
                        value={dailyForm.reportDate}
                        onChange={(e) => setDailyForm(p => ({ ...p, reportDate: e.target.value }))}
                        className="h-9 text-xs"
                        required
                      />
                    </div>
                  </div>

                  {/* PENDAPATAN SALES */}
                  <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-100 dark:border-slate-800 space-y-3">
                    <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                      💰 PENDAPATAN SALES
                    </h3>
                    
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[10px]">Tunai / Cash</Label>
                        <Input
                          type="number"
                          placeholder="0"
                          value={dailyForm.cashIncome || ""}
                          onChange={(e) => setDailyForm(p => ({ ...p, cashIncome: Number(e.target.value) || 0 }))}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px]">Transfer Bank</Label>
                        <Input
                          type="number"
                          placeholder="0"
                          value={dailyForm.transferIncome || ""}
                          onChange={(e) => setDailyForm(p => ({ ...p, transferIncome: Number(e.target.value) || 0 }))}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px]">QRIS</Label>
                        <Input
                          type="number"
                          placeholder="0"
                          value={dailyForm.qrisIncome || ""}
                          onChange={(e) => setDailyForm(p => ({ ...p, qrisIncome: Number(e.target.value) || 0 }))}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  {/* SETORAN KAS */}
                  <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-100 dark:border-slate-800 space-y-3">
                    <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                      🏦 SETORAN KAS
                    </h3>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-[10px]">Jumlah Setoran</Label>
                        <Input
                          type="number"
                          placeholder="0"
                          value={dailyForm.returnCashAmount || ""}
                          onChange={(e) => setDailyForm(p => ({ ...p, returnCashAmount: Number(e.target.value) || 0 }))}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px]">Tanggal Setoran</Label>
                        <Input
                          type="date"
                          value={dailyForm.returnCashDate}
                          onChange={(e) => setDailyForm(p => ({ ...p, returnCashDate: e.target.value }))}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  {/* DAFTAR PENGELUARAN */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label className="text-xs font-bold">Rincian Pengeluaran</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addExpenseRow}
                        className="h-7 text-[10px] flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" /> Tambah Biaya
                      </Button>
                    </div>

                    <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                      {dailyForm.expenseLines.map((row, idx) => (
                        <div key={idx} className="border border-slate-100 dark:border-slate-850 p-2.5 rounded-lg relative bg-white/50 dark:bg-slate-900/50 space-y-2 shadow-sm">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] font-bold text-indigo-500">Baris #{idx + 1}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeExpenseRow(idx)}
                              className="text-red-500 hover:text-red-700 h-6 w-6"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label className="text-[9px]">Tipe Pengeluaran</Label>
                              <Select
                                value={row.type}
                                onValueChange={(val) => handleExpenseRowChange(idx, "type", val)}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="hpp">HPP (Bahan Baku)</SelectItem>
                                  <SelectItem value="biaya">Biaya Lain-lain</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="space-y-1">
                              {row.type === "hpp" ? (
                                <>
                                  <Label className="text-[9px]">Pilih Bahan Baku</Label>
                                  <Select
                                    value={row.materialId}
                                    onValueChange={(val) => handleExpenseRowChange(idx, "materialId", val)}
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue placeholder="Bahan Baku" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {materials.map((m) => (
                                        <SelectItem key={m.id} value={m.id}>
                                          {m.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </>
                              ) : (
                                <>
                                  <Label className="text-[9px]">Kategori Biaya</Label>
                                  <Select
                                    value={row.expenseCategoryId}
                                    onValueChange={(val) => handleExpenseRowChange(idx, "expenseCategoryId", val)}
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue placeholder="Pilih Kategori" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {expenseCategories.map((c) => (
                                        <SelectItem key={c.id} value={c.id}>
                                          {c.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                            <div className="space-y-1">
                              <Label className="text-[9px]">Jumlah (Qty)</Label>
                              <Input
                                type="number"
                                placeholder="0"
                                value={row.quantity}
                                onChange={(e) => handleExpenseRowChange(idx, "quantity", e.target.value)}
                                className="h-8 text-xs"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[9px]">Harga Satuan (Rp)</Label>
                              <Input
                                type="number"
                                placeholder="0"
                                value={row.price}
                                onChange={(e) => handleExpenseRowChange(idx, "price", e.target.value)}
                                className="h-8 text-xs"
                              />
                            </div>
                            <div className="space-y-1 col-span-1">
                              <Label className="text-[9px]">Keterangan</Label>
                              <Input
                                type="text"
                                placeholder="Ket..."
                                value={row.note}
                                onChange={(e) => handleExpenseRowChange(idx, "note", e.target.value)}
                                className="h-8 text-xs"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* SUMMARY INFO */}
                  <div className="p-3 bg-indigo-50/50 dark:bg-slate-900/80 rounded-lg border border-indigo-100/50 dark:border-slate-800 space-y-2 text-xs">
                    <div className="flex justify-between font-medium">
                      <span>Total Pendapatan:</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold">{formatCurrency(totalIncome)}</span>
                    </div>
                    <div className="flex justify-between font-medium">
                      <span>Total Pengeluaran:</span>
                      <span className="text-red-500 font-bold">{formatCurrency(totalExpense)}</span>
                    </div>
                    <div className="flex justify-between font-bold border-t pt-1 border-slate-200 dark:border-slate-700">
                      <span>Estimasi Laba Kotor:</span>
                      <span className={grossProfit >= 0 ? "text-indigo-600 dark:text-indigo-400" : "text-amber-500"}>
                        {formatCurrency(grossProfit)}
                      </span>
                    </div>
                    <div className="flex justify-between font-bold">
                      <span>Uang di Laci:</span>
                      <span className="text-slate-700 dark:text-slate-300">{formatCurrency(drawerMoney)}</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Catatan Tambahan</Label>
                    <textarea
                      placeholder="Catatan tambahan..."
                      value={dailyForm.notes}
                      onChange={(e) => setDailyForm(p => ({ ...p, notes: e.target.value }))}
                      className="flex min-h-[60px] w-full rounded-md border border-slate-200 dark:border-slate-800 bg-transparent px-3 py-2 text-xs placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
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
                <CardDescription>Format input logistik sesuai Mobile APK</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleLogisticSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Outlet</Label>
                      <Select
                        value={logisticForm.outletId}
                        onValueChange={(val) => setLogisticForm(p => ({ ...p, outletId: val }))}
                      >
                        <SelectTrigger className="h-9">
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

                    <div className="space-y-1">
                      <Label className="text-xs">Tanggal Logistik</Label>
                      <Input
                        type="date"
                        value={logisticForm.reportDate}
                        onChange={(e) => setLogisticForm(p => ({ ...p, reportDate: e.target.value }))}
                        className="h-9 text-xs"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Pilih Supplier</Label>
                      <Select
                        value={logisticForm.supplierId}
                        onValueChange={(val) => setLogisticForm(p => ({ ...p, supplierId: val }))}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Pilih Supplier" />
                        </SelectTrigger>
                        <SelectContent>
                          {suppliers.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Tipe Pembayaran</Label>
                      <Select
                        value={logisticForm.paymentType}
                        onValueChange={(val) => setLogisticForm(p => ({ ...p, paymentType: val }))}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="lunas">Lunas</SelectItem>
                          <SelectItem value="tempo">Tempo / Utang</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* DAFTAR BAHAN BAKU MASUK */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label className="text-xs font-bold">Daftar Bahan Baku Masuk</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addLogisticRow}
                        className="h-7 text-[10px] flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" /> Tambah Baris
                      </Button>
                    </div>
                    
                    <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                      {logisticForm.items.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2 border border-slate-100 dark:border-slate-800 p-2.5 rounded-lg relative bg-white/50 dark:bg-slate-900/50">
                          <div className="flex-1 space-y-2">
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
                            
                            <div className="grid grid-cols-2 gap-2">
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  placeholder="Qty"
                                  value={item.quantity}
                                  onChange={(e) => handleLogisticRowChange(idx, "quantity", e.target.value)}
                                  className="text-xs h-8"
                                  required
                                />
                                <span className="text-[10px] text-slate-500 font-semibold truncate max-w-[40px]" title={item.unit}>
                                  {item.unit || "satuan"}
                                </span>
                              </div>
                              <Input
                                type="number"
                                placeholder="Harga Satuan (Rp)"
                                value={item.price}
                                onChange={(e) => handleLogisticRowChange(idx, "price", e.target.value)}
                                className="text-xs h-8"
                                required
                              />
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

                  <div className="p-3 bg-emerald-50/50 dark:bg-slate-900/80 rounded-lg border border-emerald-100/50 dark:border-slate-800 space-y-2 text-xs">
                    <div className="flex justify-between font-bold">
                      <span>Total Pembelian Logistik:</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-extrabold">{formatCurrency(logisticTotal)}</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Catatan Umum</Label>
                    <textarea
                      placeholder="Catatan pengiriman/logistik..."
                      value={logisticForm.notes}
                      onChange={(e) => setLogisticForm(p => ({ ...p, notes: e.target.value }))}
                      className="flex min-h-[60px] w-full rounded-md border border-slate-200 dark:border-slate-800 bg-transparent px-3 py-2 text-xs placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
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
        <div className="lg:col-span-7 space-y-4">
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
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500">Sampai Tanggal</label>
                  <Input
                    type="date"
                    value={dateToFilter}
                    onChange={(e) => setDateToFilter(e.target.value)}
                    className="h-9 text-xs"
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
                      <TableHeader className="bg-slate-50/50 dark:bg-slate-900/50 text-xs">
                        <TableRow>
                          <TableHead>Tanggal</TableHead>
                          <TableHead>Outlet</TableHead>
                          <TableHead className="text-right">Pendapatan</TableHead>
                          <TableHead className="text-right">Pengeluaran</TableHead>
                          <TableHead className="text-right">Setoran Kas</TableHead>
                          <TableHead>Penginput</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody className="text-xs">
                        {dailyQuery.data?.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell className="font-medium flex items-center gap-1.5 whitespace-nowrap">
                              <Calendar className="w-3.5 h-3.5 text-slate-400" />
                              {row.report_date}
                            </TableCell>
                            <TableCell className="font-semibold">{getOutletName(row.outlet_id)}</TableCell>
                            <TableCell className="text-right font-medium text-emerald-600">{formatCurrency(row.total_income)}</TableCell>
                            <TableCell className="text-right font-medium text-red-500">{formatCurrency(row.total_expense)}</TableCell>
                            <TableCell className="text-right font-semibold text-indigo-600">{formatCurrency(row.return_cash_amount)}</TableCell>
                            <TableCell className="text-[10px] text-slate-500 whitespace-nowrap">{getUserName(row.created_by)}</TableCell>
                          </TableRow>
                        ))}
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
                      <TableHeader className="bg-slate-50/50 dark:bg-slate-900/50 text-xs">
                        <TableRow>
                          <TableHead>Tanggal</TableHead>
                          <TableHead>Outlet</TableHead>
                          <TableHead>Supplier</TableHead>
                          <TableHead>Tipe</TableHead>
                          <TableHead className="text-right">Total Belanja</TableHead>
                          <TableHead>Bahan Baku Masuk</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody className="text-xs">
                        {logisticQuery.data?.map((row) => {
                          const suppName = suppliers.find(s => s.id === row.supplier_id)?.name || row.supplier_id || "-";
                          return (
                            <TableRow key={row.id}>
                              <TableCell className="font-medium flex items-center gap-1.5 whitespace-nowrap">
                                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                {row.report_date}
                              </TableCell>
                              <TableCell className="font-semibold">{getOutletName(row.outlet_id)}</TableCell>
                              <TableCell className="font-medium">{suppName}</TableCell>
                              <TableCell className="capitalize font-semibold text-slate-650">{row.payment_type}</TableCell>
                              <TableCell className="text-right font-bold text-emerald-600">{formatCurrency(row.total_amount)}</TableCell>
                              <TableCell>
                                <div className="space-y-1">
                                  {row.details_json?.map((item, idx) => {
                                    const materialName = materials.find(m => m.id === item.material_id)?.name || item.material_id;
                                    return (
                                      <div key={idx} className="text-[10px] font-semibold text-slate-700 dark:text-slate-300">
                                        📦 {materialName} ({item.quantity} {materials.find(m => m.id === item.material_id)?.unit || "unit"}) @{formatCurrency(item.price)}
                                      </div>
                                    );
                                  })}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
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
