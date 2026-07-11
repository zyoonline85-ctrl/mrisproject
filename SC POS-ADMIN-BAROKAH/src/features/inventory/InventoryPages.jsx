import { useEffect, useMemo, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronsUpDown, ClipboardCheck, Download, Eye, PackageOpen, Pencil, Plus, RefreshCw, Save, Scale, Search, Truck, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormattedNumberInput } from "@/components/ui/formatted-number-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTable } from "@/components/shared/DataTable";
import { MetricCard } from "@/components/shared/MetricCard";
import { InlineRowActions, RowActionButton } from "@/components/shared/RowActions";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useApprovePurchase, useApproveStockOpnameRequest, useApproveStockTransfer, useCreatePurchase, useCreateStockOpnameBatch, useCreateStockTransfer, useInventory, useRejectPurchase, useRejectStockOpnameRequest, useRejectStockTransfer, useStockOpnameMaterialSelection, useStockOpnameRequests, useStockOpnameWorksheet, useUpdatePurchase, useUpdateStockOpnameMaterialSelection, useUpdateStockTransfer } from "@/hooks/useAdminQueries";
import { adminApi } from "@/lib/adminApi";
import { can } from "@/lib/permissions";
import { cn, formatCurrency, formatDate, formatNumber, toDateString } from "@/lib/utils";
import { exportRowsToXlsx } from "@/lib/xlsxExport";
import { useAppStore } from "@/store/appStore";

function getDefaultOpnameDate() {
  return toDateString(new Date());
}

function getSourceFallback(source) {
  if (source === "admin_web") return "Admin Web";
  if (source === "kasir_app") return "APK Kasir";
  if (source === "backend") return "Backend";
  return "-";
}

function getInputUserName(row, userKey = "created_by_user") {
  return row?.[userKey]?.name || row?.created_by_user?.name || row?.requested_user?.name || row?.user?.name || row?.created_by_name || row?.requested_by_name || "User tidak tercatat";
}

function getOutletName(row, outlets = []) {
  const outletId = row?.outlet_id || row?.outletId;
  return row?.outlet?.name || outlets.find((outlet) => outlet.id === outletId)?.name || "-";
}

function getTransferItemMaterial(item, materials = []) {
  return item?.material || materials.find((material) => material.id === item?.material_id) || null;
}

function normalizeTransferRows(transfers = [], { materials = [], outlets = [], users = [] } = {}) {
  return transfers.map((transfer) => {
    const items = (transfer.items || []).map((item) => {
      const material = getTransferItemMaterial(item, materials);
      return {
        ...item,
        material,
        material_name: item.material_name || material?.name || item.material_id,
        material_type: item.material_type || material?.type || "hpp",
        unit: item.unit || material?.unit || ""
      };
    });
    const resolveLoanItems = (rows = []) =>
      rows.map((item) => {
        const material = getTransferItemMaterial(item, materials);
        return {
          ...item,
          material,
          material_name: item.material_name || material?.name || item.material_id,
          material_type: item.material_type || material?.type || "hpp",
          unit: item.unit || material?.unit || ""
        };
      });

    return {
      ...transfer,
      from_outlet: transfer.from_outlet || outlets.find((outlet) => outlet.id === transfer.from_outlet_id) || null,
      to_outlet: transfer.to_outlet || outlets.find((outlet) => outlet.id === transfer.to_outlet_id) || null,
      requested_user: transfer.requested_user || users.find((user) => user.id === transfer.requested_by) || null,
      approved_user: transfer.approved_user || users.find((user) => user.id === transfer.approved_by) || null,
      items,
      item_count: Number(transfer.item_count ?? items.length),
      loan_remaining_items: resolveLoanItems(transfer.loan_remaining_items || []),
      loan_returned_items: resolveLoanItems(transfer.loan_returned_items || [])
    };
  });
}

function useInventoryPage(outletIdOverride) {
  const selectedOutletId = useAppStore((state) => state.selectedOutletId);
  const session = useAppStore((state) => state.session);
  const query = useInventory({ outletId: outletIdOverride || selectedOutletId });
  const data = query.data || {};
  const stocks = data.stocks || [];
  const allStocks = data.all_stocks || stocks;
  const purchases = data.purchases || [];
  const opnames = data.opnames || [];
  const stockMovements = data.stock_movements || [];
  const materials = data.materials || [];
  const suppliers = data.suppliers || [];
  const outlets = data.outlets || [];
  const users = data.users || [];
  const transfers = normalizeTransferRows(data.transfers || [], { materials, outlets, users });
  const lowStocks = stocks.filter((item) => item.status === "low_stock").length;
  const outOfStocks = stocks.filter((item) => item.status === "out_of_stock").length;
  const purchaseTotal = purchases.reduce((total, item) => total + item.total, 0);

  return {
    ...query,
    selectedOutletId,
    session,
    stocks,
    allStocks,
    purchases,
    transfers,
    opnames,
    stockMovements,
    materials,
    suppliers,
    outlets,
    users,
    lowStocks,
    outOfStocks,
    purchaseTotal
  };
}

function RejectReasonDialog({ description, isSubmitting, onConfirm, onOpenChange, open, title }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  function handleOpenChange(nextOpen) {
    if (!nextOpen) {
      setReason("");
      setError("");
    }
    onOpenChange(nextOpen);
  }

  async function submit(event) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("Alasan reject wajib diisi.");
      return;
    }
    await onConfirm(trimmed);
    setReason("");
    setError("");
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">Alasan Reject</Label>
            <textarea
              id="reject-reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                if (error) setError("");
              }}
              className="focus-ring min-h-28 w-full resize-none rounded-md border border-input bg-card px-3 py-2 text-[12px] text-foreground shadow-sm placeholder:text-muted-foreground"
              placeholder="Tulis alasan reject untuk catatan kasir/admin"
              autoFocus
            />
            {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
              Batal
            </Button>
            <Button type="submit" variant="destructive" disabled={isSubmitting}>
              {isSubmitting ? "Menyimpan..." : "Reject"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InventorySummary({ purchaseTotal, stocks, lowStocks, outOfStocks = 0 }) {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      <MetricCard title="Total Pembelian" value={formatCurrency(purchaseTotal)} description="Per filter outlet" icon={ClipboardCheck} tone="gold" />
      <MetricCard title="Item Stok" value={stocks.length} description="Produk per outlet" icon={Truck} tone="blue" />
      <MetricCard title="Stok Menipis" value={lowStocks} description="Di bawah threshold" icon={Scale} tone="danger" />
      <MetricCard title="Stok Habis" value={outOfStocks} description="Perlu restock" icon={PackageOpen} tone="danger" />
    </div>
  );
}

function getNestedError(errors, path) {
  return path.split(".").reduce((value, part) => value?.[part], errors);
}

function FieldError({ errors, path }) {
  const error = getNestedError(errors, path);
  return error ? <p className="text-[11px] text-destructive">{error.message}</p> : null;
}

function getDefaultOutletId(outlets, selectedOutletId) {
  return selectedOutletId && selectedOutletId !== "all" ? selectedOutletId : outlets[0]?.id || "";
}

function getStockQuantity(stocks, outletId, materialId) {
  return Number(stocks.find((stock) => stock.outlet_id === outletId && stock.material_id === materialId)?.quantity || 0);
}

function getMaterialUnit(materials, materialId) {
  return materials.find((material) => material.id === materialId)?.unit || "";
}

const NO_SUPPLIER = "__no_supplier__";

function PurchaseDialog({ initialValues, materials, onOpenChange, onSubmit, open: controlledOpen, outlets, selectedOutletId, suppliers, trigger }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => supplier.status === "active"),
    [suppliers]
  );
  const defaults = useMemo(
    () => ({
      outlet_id: initialValues?.outlet_id || getDefaultOutletId(outlets, selectedOutletId),
      supplier_id: initialValues?.supplier_id || activeSuppliers[0]?.id || "",
      material_id: initialValues?.material_id || materials[0]?.id || "",
      purchase_date: initialValues?.purchase_date || toDateString(new Date()),
      quantity: initialValues?.quantity ?? "",
      unit_price: initialValues?.unit_price ?? ""
    }),
    [
      activeSuppliers,
      initialValues?.material_id,
      initialValues?.outlet_id,
      initialValues?.purchase_date,
      initialValues?.quantity,
      initialValues?.supplier_id,
      initialValues?.unit_price,
      materials,
      outlets,
      selectedOutletId
    ]
  );
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isSubmitting }
  } = useForm({ defaultValues: defaults });
  const materialId = useWatch({ control, name: "material_id" });
  const unit = getMaterialUnit(materials, materialId);

  useEffect(() => {
    if (open) reset(defaults);
  }, [defaults, open, reset]);

  async function submit(values) {
    await onSubmit(values);
    reset(defaults);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger !== null ? (
        <DialogTrigger asChild>
          {trigger || (
            <Button>
              <Plus />
              Tambah Pembelian
            </Button>
          )}
        </DialogTrigger>
      ) : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah Pembelian Harga Pokok Produksi</DialogTitle>
          <DialogDescription>Pembelian approved langsung menambah stok outlet yang dipilih.</DialogDescription>
        </DialogHeader>

        <form className="space-y-3" onSubmit={handleSubmit(submit)}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Outlet</Label>
              <Controller
                name="outlet_id"
                control={control}
                rules={{ required: "Outlet wajib dipilih" }}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih outlet" />
                    </SelectTrigger>
                    <SelectContent>
                      {outlets.map((outlet) => (
                        <SelectItem key={outlet.id} value={outlet.id}>
                          {outlet.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError errors={errors} path="outlet_id" />
            </div>

            <div className="space-y-1.5">
              <Label>Tanggal</Label>
              <Controller
                name="purchase_date"
                control={control}
                rules={{ required: "Tanggal wajib diisi" }}
                render={({ field }) => <DatePicker value={field.value} onChange={field.onChange} />}
              />
              <FieldError errors={errors} path="purchase_date" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Supplier</Label>
            <Controller
              name="supplier_id"
              control={control}
              rules={{ required: "Supplier wajib dipilih" }}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={!activeSuppliers.length}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeSuppliers.map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {!activeSuppliers.length ? (
              <p className="text-[11px] text-destructive">Buat atau aktifkan supplier dulu di Master Data &gt; Supplier.</p>
            ) : null}
            <FieldError errors={errors} path="supplier_id" />
          </div>

          <div className="space-y-1.5">
            <Label>Harga Pokok Produksi</Label>
            <Controller
              name="material_id"
              control={control}
              rules={{ required: "Harga Pokok Produksi wajib dipilih" }}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih harga pokok produksi" />
                  </SelectTrigger>
                  <SelectContent>
                    {materials.map((material) => (
                      <SelectItem key={material.id} value={material.id}>
                        {material.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={errors} path="material_id" />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Qty {unit ? `(${unit})` : ""}</Label>
              <Controller
                name="quantity"
                control={control}
                rules={{
                  required: "Qty wajib diisi",
                  min: { value: 0.001, message: "Qty minimal 0,001" }
                }}
                render={({ field }) => <FormattedNumberInput allowDecimal placeholder="10" {...field} />}
              />
              <FieldError errors={errors} path="quantity" />
            </div>

            <div className="space-y-1.5">
              <Label>Harga Satuan</Label>
              <Controller
                name="unit_price"
                control={control}
                rules={{
                  required: "Harga satuan wajib diisi",
                  min: { value: 1, message: "Harga satuan minimal 1" }
                }}
                render={({ field }) => <FormattedNumberInput placeholder="15.000" {...field} />}
              />
              <FieldError errors={errors} path="unit_price" />
            </div>
          </div>

          {isDirty ? <p className="text-[11px] text-muted-foreground">Perubahan belum disimpan.</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting || !activeSuppliers.length}>
              {isSubmitting ? "Menyimpan..." : "Simpan Pembelian"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PurchaseBatchEditDialog({ materials, onOpenChange, onSubmit, open, outlets, purchase, suppliers }) {
  const activeMaterials = useMemo(
    () => materials.filter((material) => material.status !== "inactive"),
    [materials]
  );
  const supplierOptions = useMemo(
    () =>
      suppliers.filter(
        (supplier) => supplier.status === "active" || supplier.id === purchase?.supplier_id
      ),
    [purchase?.supplier_id, suppliers]
  );
  const materialById = useMemo(() => new Map(materials.map((material) => [material.id, material])), [materials]);
  const defaults = useMemo(
    () => ({
      outlet_id: purchase?.outlet_id || outlets[0]?.id || "",
      supplier_id: purchase?.supplier_id || NO_SUPPLIER,
      purchase_date: purchase?.purchase_date || toDateString(new Date()),
      payment_type: purchase?.payment_type || "lunas",
      note: purchase?.note || "",
      items: (purchase?.items?.length ? purchase.items : [{ material_id: activeMaterials[0]?.id || "", quantity: "", unit_price: "" }]).map((item) => ({
        material_id: item.material_id || item.material?.id || "",
        quantity: item.quantity ?? "",
        unit_price: item.unit_price ?? ""
      }))
    }),
    [activeMaterials, outlets, purchase]
  );
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isSubmitting }
  } = useForm({ defaultValues: defaults });
  const { append, fields, remove } = useFieldArray({ control, name: "items" });
  const watchedItems = useWatch({ control, name: "items" }) || [];
  const grandTotal = watchedItems.reduce((total, item) => total + Number(item.quantity || 0) * Number(item.unit_price || 0), 0);

  useEffect(() => {
    if (open) reset(defaults);
  }, [defaults, open, reset]);

  async function submit(values) {
    await onSubmit({
      outlet_id: values.outlet_id,
      supplier_id: values.supplier_id === NO_SUPPLIER ? null : values.supplier_id,
      purchase_date: values.purchase_date,
      payment_type: values.payment_type,
      note: values.note || "",
      items: values.items.map((item) => ({
        material_id: item.material_id,
        quantity: Number(item.quantity || 0),
        unit_price: Number(item.unit_price || 0)
      }))
    });
    reset(defaults);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Edit Pembelian Harga Pokok Produksi</DialogTitle>
          <DialogDescription>
            {purchase?.status === "approved"
              ? "Mengedit pembelian approved akan mengoreksi stok dan laporan."
              : "Ubah data batch pembelian sebelum diproses lebih lanjut."}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit(submit)}>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Outlet</Label>
              <Controller
                name="outlet_id"
                control={control}
                rules={{ required: "Outlet wajib dipilih" }}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih outlet" />
                    </SelectTrigger>
                    <SelectContent>
                      {outlets.map((outlet) => (
                        <SelectItem key={outlet.id} value={outlet.id}>
                          {outlet.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError errors={errors} path="outlet_id" />
            </div>

            <div className="space-y-1.5">
              <Label>Tanggal</Label>
              <Controller
                name="purchase_date"
                control={control}
                rules={{ required: "Tanggal wajib diisi" }}
                render={({ field }) => <DatePicker value={field.value} onChange={field.onChange} />}
              />
              <FieldError errors={errors} path="purchase_date" />
            </div>

            <div className="space-y-1.5">
              <Label>Supplier</Label>
              <Controller
                name="supplier_id"
                control={control}
                render={({ field }) => (
                  <Select value={field.value || NO_SUPPLIER} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_SUPPLIER}>Tanpa supplier</SelectItem>
                      {supplierOptions.map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Tipe Pembayaran</Label>
              <Controller
                name="payment_type"
                control={control}
                rules={{ required: "Tipe pembayaran wajib dipilih" }}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih tipe" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lunas">Lunas</SelectItem>
                      <SelectItem value="bon">Bon</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError errors={errors} path="payment_type" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Catatan</Label>
            <Controller
              name="note"
              control={control}
              render={({ field }) => (
                <textarea
                  {...field}
                  className="focus-ring min-h-20 w-full resize-none rounded-md border border-input bg-card px-3 py-2 text-[12px] text-foreground shadow-sm placeholder:text-muted-foreground"
                  placeholder="Catatan pembelian opsional"
                />
              )}
            />
          </div>

          <div className="rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <div>
                <p className="text-sm font-semibold">Item Pembelian</p>
                <p className="text-[11px] text-muted-foreground">Tambah, hapus, atau koreksi qty dan harga satuan.</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ material_id: activeMaterials[0]?.id || "", quantity: "", unit_price: "" })}
              >
                <Plus />
                Tambah Baris
              </Button>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-56">Produk</TableHead>
                    <TableHead className="w-28">Type</TableHead>
                    <TableHead className="w-24">Satuan</TableHead>
                    <TableHead className="w-36 text-right">Qty</TableHead>
                    <TableHead className="w-40 text-right">Harga Satuan</TableHead>
                    <TableHead className="w-40 text-right">Subtotal</TableHead>
                    <TableHead className="w-14" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fields.map((field, index) => {
                    const material = materialById.get(watchedItems[index]?.material_id);
                    const subtotal = Number(watchedItems[index]?.quantity || 0) * Number(watchedItems[index]?.unit_price || 0);
                    return (
                      <TableRow key={field.id}>
                        <TableCell>
                          <Controller
                            name={`items.${index}.material_id`}
                            control={control}
                            rules={{ required: "Produk wajib dipilih" }}
                            render={({ field: itemField }) => (
                              <Select value={itemField.value} onValueChange={itemField.onChange}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Pilih produk" />
                                </SelectTrigger>
                                <SelectContent>
                                  {activeMaterials.map((materialOption) => (
                                    <SelectItem key={materialOption.id} value={materialOption.id}>
                                      {materialOption.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          />
                          <FieldError errors={errors} path={`items.${index}.material_id`} />
                        </TableCell>
                        <TableCell>
                          <Badge variant={material?.type === "biaya" ? "warning" : "info"}>
                            {material?.type === "biaya" ? "Biaya Produksi" : "HPP"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{material?.unit || "-"}</TableCell>
                        <TableCell>
                          <Controller
                            name={`items.${index}.quantity`}
                            control={control}
                            rules={{
                              required: "Qty wajib diisi",
                              min: { value: 0.001, message: "Qty minimal 0,001" }
                            }}
                            render={({ field: itemField }) => <FormattedNumberInput allowDecimal className="text-right" placeholder="10" {...itemField} />}
                          />
                          <FieldError errors={errors} path={`items.${index}.quantity`} />
                        </TableCell>
                        <TableCell>
                          <Controller
                            name={`items.${index}.unit_price`}
                            control={control}
                            rules={{
                              required: "Harga wajib diisi",
                              min: { value: 1, message: "Harga minimal 1" }
                            }}
                            render={({ field: itemField }) => <FormattedNumberInput className="text-right" placeholder="15.000" {...itemField} />}
                          />
                          <FieldError errors={errors} path={`items.${index}.unit_price`} />
                        </TableCell>
                        <TableCell className="text-right font-semibold">{formatCurrency(subtotal)}</TableCell>
                        <TableCell className="text-right">
                          <Button type="button" size="icon" variant="ghost" onClick={() => remove(index)} disabled={fields.length <= 1}>
                            <X />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {isDirty ? <p className="text-[11px] text-muted-foreground">Perubahan belum disimpan.</p> : <span />}
            <div className="text-sm font-semibold">Total: {formatCurrency(grandTotal)}</div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting || !activeMaterials.length}>
              {isSubmitting ? "Menyimpan..." : "Simpan Perubahan"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({ initialValues, materials, onOpenChange, onSubmit, open: controlledOpen, outlets, selectedOutletId, session, stocks, trigger }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const defaultFromOutlet = initialValues?.from_outlet_id || getDefaultOutletId(outlets, selectedOutletId);
  const defaults = useMemo(
    () => ({
      from_outlet_id: defaultFromOutlet,
      to_outlet_id: initialValues?.to_outlet_id || outlets.find((outlet) => outlet.id !== defaultFromOutlet)?.id || "",
      material_id: initialValues?.material_id || materials[0]?.id || "",
      transfer_date: initialValues?.transfer_date || toDateString(new Date()),
      quantity: initialValues?.quantity ?? ""
    }),
    [defaultFromOutlet, initialValues?.material_id, initialValues?.quantity, initialValues?.to_outlet_id, initialValues?.transfer_date, materials, outlets]
  );
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isSubmitting }
  } = useForm({ defaultValues: defaults });
  const fromOutletId = useWatch({ control, name: "from_outlet_id" });
  const materialId = useWatch({ control, name: "material_id" });
  const availableStock = getStockQuantity(stocks, fromOutletId, materialId);
  const unit = getMaterialUnit(materials, materialId);

  useEffect(() => {
    if (open) reset(defaults);
  }, [defaults, open, reset]);

  async function submit(values) {
    await onSubmit({
      ...values,
      requested_by: session?.id,
      approved_by: session?.id
    });
    reset(defaults);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger !== null ? (
        <DialogTrigger asChild>
          {trigger || (
            <Button>
              <Plus />
              Tambah Transfer
            </Button>
          )}
        </DialogTrigger>
      ) : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah Transfer Stok</DialogTitle>
          <DialogDescription>Transfer approved langsung mengurangi outlet asal dan menambah outlet tujuan.</DialogDescription>
        </DialogHeader>

        <form className="space-y-3" onSubmit={handleSubmit(submit)}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Dari Outlet</Label>
              <Controller
                name="from_outlet_id"
                control={control}
                rules={{ required: "Outlet asal wajib dipilih" }}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih outlet asal" />
                    </SelectTrigger>
                    <SelectContent>
                      {outlets.map((outlet) => (
                        <SelectItem key={outlet.id} value={outlet.id}>
                          {outlet.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError errors={errors} path="from_outlet_id" />
            </div>

            <div className="space-y-1.5">
              <Label>Ke Outlet</Label>
              <Controller
                name="to_outlet_id"
                control={control}
                rules={{
                  required: "Outlet tujuan wajib dipilih",
                  validate: (value, values) => value !== values.from_outlet_id || "Outlet tujuan harus berbeda"
                }}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih outlet tujuan" />
                    </SelectTrigger>
                    <SelectContent>
                      {outlets.map((outlet) => (
                        <SelectItem key={outlet.id} value={outlet.id}>
                          {outlet.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError errors={errors} path="to_outlet_id" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Tanggal</Label>
            <Controller
              name="transfer_date"
              control={control}
              rules={{ required: "Tanggal wajib diisi" }}
              render={({ field }) => <DatePicker value={field.value} onChange={field.onChange} />}
            />
            <FieldError errors={errors} path="transfer_date" />
          </div>

          <div className="space-y-1.5">
            <Label>Harga Pokok Produksi</Label>
            <Controller
              name="material_id"
              control={control}
              rules={{ required: "Harga Pokok Produksi wajib dipilih" }}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih harga pokok produksi" />
                  </SelectTrigger>
                  <SelectContent>
                    {materials.map((material) => (
                      <SelectItem key={material.id} value={material.id}>
                        {material.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={errors} path="material_id" />
          </div>

          <div className="space-y-1.5">
            <Label>Qty {unit ? `(${unit})` : ""}</Label>
            <Controller
              name="quantity"
              control={control}
              rules={{
                required: "Qty wajib diisi",
                min: { value: 0.001, message: "Qty minimal 0,001" },
                validate: (value) => Number(value || 0) <= availableStock || "Qty melebihi stok outlet asal"
              }}
              render={({ field }) => <FormattedNumberInput allowDecimal placeholder="5" {...field} />}
            />
            <p className="text-[11px] text-muted-foreground">
              Stok tersedia: {formatNumber(availableStock)} {unit}
            </p>
            <FieldError errors={errors} path="quantity" />
          </div>

          {isDirty ? <p className="text-[11px] text-muted-foreground">Perubahan belum disimpan.</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Menyimpan..." : "Simpan Transfer"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TransferEditDialog({ materials, onOpenChange, onSubmit, open, outlets, transfer }) {
  const [materialKeyword, setMaterialKeyword] = useState("");
  const isLoanReturn = Boolean(transfer?.loan_return_for_transfer_id);
  const activeMaterials = useMemo(
    () => materials.filter((material) => material.status !== "inactive"),
    [materials]
  );
  const materialById = useMemo(() => new Map(materials.map((material) => [material.id, material])), [materials]);
  const filteredMaterials = useMemo(() => {
    const keyword = materialKeyword.trim().toLowerCase();
    if (!keyword) return activeMaterials;
    return activeMaterials.filter((material) =>
      `${material.name} ${material.unit} ${material.type}`.toLowerCase().includes(keyword)
    );
  }, [activeMaterials, materialKeyword]);
  const defaults = useMemo(
    () => ({
      from_outlet_id: transfer?.from_outlet_id || outlets[0]?.id || "",
      to_outlet_id: transfer?.to_outlet_id || outlets.find((outlet) => outlet.id !== transfer?.from_outlet_id)?.id || "",
      transfer_type: transfer?.transfer_type || "regular",
      loan_return_for_transfer_id: transfer?.loan_return_for_transfer_id || "",
      transfer_date: transfer?.transfer_date || toDateString(new Date()),
      note: transfer?.note || "",
      items: (transfer?.items?.length ? transfer.items : [{ material_id: activeMaterials[0]?.id || "", quantity: "" }]).map((item) => ({
        material_id: item.material_id || item.material?.id || "",
        quantity: item.quantity ?? ""
      }))
    }),
    [activeMaterials, outlets, transfer]
  );
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isSubmitting }
  } = useForm({ defaultValues: defaults });
  const { append, fields, remove } = useFieldArray({ control, name: "items" });
  const watchedItems = useWatch({ control, name: "items" }) || [];

  useEffect(() => {
    if (open) {
      reset(defaults);
    }
  }, [defaults, open, reset]);

  async function submit(values) {
    await onSubmit({
      from_outlet_id: values.from_outlet_id,
      to_outlet_id: values.to_outlet_id,
      transfer_type: isLoanReturn ? "regular" : values.transfer_type,
      loan_return_for_transfer_id: values.loan_return_for_transfer_id || "",
      transfer_date: values.transfer_date,
      note: values.note || "",
      items: values.items.map((item) => ({
        material_id: item.material_id,
        quantity: Number(item.quantity || 0)
      }))
    });
    reset(defaults);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Edit Transfer Stok</DialogTitle>
          <DialogDescription>Hanya transfer pending yang bisa diedit. Stok baru berubah setelah admin approve.</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit(submit)}>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Tipe Transfer</Label>
              <Controller
                name="transfer_type"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={isLoanReturn}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih tipe transfer" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="regular">Transfer Biasa</SelectItem>
                      <SelectItem value="loan">Pinjaman</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
              {isLoanReturn ? (
                <p className="text-[11px] text-muted-foreground">Tipe pengembalian pinjaman dikunci.</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label>Outlet Asal</Label>
              <Controller
                name="from_outlet_id"
                control={control}
                rules={{ required: "Outlet asal wajib dipilih" }}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={isLoanReturn}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih outlet asal" />
                    </SelectTrigger>
                    <SelectContent>
                      {outlets.map((outlet) => (
                        <SelectItem key={outlet.id} value={outlet.id}>
                          {outlet.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError errors={errors} path="from_outlet_id" />
            </div>

            <div className="space-y-1.5">
              <Label>Outlet Tujuan</Label>
              <Controller
                name="to_outlet_id"
                control={control}
                rules={{
                  required: "Outlet tujuan wajib dipilih",
                  validate: (value, values) => value !== values.from_outlet_id || "Outlet tujuan harus berbeda"
                }}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={isLoanReturn}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih outlet tujuan" />
                    </SelectTrigger>
                    <SelectContent>
                      {outlets.map((outlet) => (
                        <SelectItem key={outlet.id} value={outlet.id}>
                          {outlet.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError errors={errors} path="to_outlet_id" />
            </div>

            <div className="space-y-1.5">
              <Label>Tanggal</Label>
              <Controller
                name="transfer_date"
                control={control}
                rules={{ required: "Tanggal wajib diisi" }}
                render={({ field }) => <DatePicker value={field.value} onChange={field.onChange} />}
              />
              <FieldError errors={errors} path="transfer_date" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Catatan</Label>
            <Controller
              name="note"
              control={control}
              render={({ field }) => (
                <textarea
                  {...field}
                  className="focus-ring min-h-20 w-full resize-none rounded-md border border-input bg-card px-3 py-2 text-[12px] text-foreground shadow-sm placeholder:text-muted-foreground"
                  placeholder="Catatan transfer opsional"
                />
              )}
            />
          </div>

          <div className="rounded-md border">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2">
              <div>
                <p className="text-sm font-semibold">Item Transfer</p>
                <p className="text-[11px] text-muted-foreground">Edit produk dan qty request transfer pending.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input className="h-9 w-64" value={materialKeyword} onChange={(event) => setMaterialKeyword(event.target.value)} placeholder="Cari produk HPP" />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => append({ material_id: activeMaterials[0]?.id || "", quantity: "" })}
                >
                  <Plus />
                  Tambah Baris
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-64">Produk</TableHead>
                    <TableHead className="w-32">Type</TableHead>
                    <TableHead className="w-24">Satuan</TableHead>
                    <TableHead className="w-36 text-right">Qty</TableHead>
                    <TableHead className="w-14" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fields.map((field, index) => {
                    const material = materialById.get(watchedItems[index]?.material_id);
                    const materialOptions = material && !filteredMaterials.some((item) => item.id === material.id)
                      ? [material, ...filteredMaterials]
                      : filteredMaterials;
                    return (
                      <TableRow key={field.id}>
                        <TableCell>
                          <Controller
                            name={`items.${index}.material_id`}
                            control={control}
                            rules={{ required: "Produk wajib dipilih" }}
                            render={({ field: itemField }) => (
                              <Select value={itemField.value} onValueChange={itemField.onChange}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Pilih produk" />
                                </SelectTrigger>
                                <SelectContent>
                                  {materialOptions.map((materialOption) => (
                                    <SelectItem key={materialOption.id} value={materialOption.id}>
                                      {materialOption.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          />
                          <FieldError errors={errors} path={`items.${index}.material_id`} />
                        </TableCell>
                        <TableCell>
                          <Badge variant={material?.type === "biaya" ? "warning" : "info"}>
                            {material?.type === "biaya" ? "Biaya Produksi" : "HPP"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{material?.unit || "-"}</TableCell>
                        <TableCell>
                          <Controller
                            name={`items.${index}.quantity`}
                            control={control}
                            rules={{
                              required: "Qty wajib diisi",
                              min: { value: 0.001, message: "Qty minimal 0,001" }
                            }}
                            render={({ field: itemField }) => <FormattedNumberInput allowDecimal className="text-right" placeholder="10" {...itemField} />}
                          />
                          <FieldError errors={errors} path={`items.${index}.quantity`} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button type="button" size="icon" variant="ghost" onClick={() => remove(index)} disabled={fields.length <= 1}>
                            <X />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {isDirty ? <p className="text-[11px] text-muted-foreground">Perubahan belum disimpan.</p> : <span />}
            <p className="text-sm font-semibold">{watchedItems.length} item transfer</p>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting || !activeMaterials.length}>
              {isSubmitting ? "Menyimpan..." : "Simpan Perubahan"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const stockStatusOptions = [
  { value: "all", label: "Semua Status" },
  { value: "normal", label: "Normal" },
  { value: "low_stock", label: "Stok Menipis" },
  { value: "out_of_stock", label: "Stok Habis" }
];

function formatStockQty(quantity, unit) {
  return `${formatNumber(quantity)} ${unit || ""}`.trim();
}

function getStockGap(stock) {
  const threshold = Number(stock?.material?.low_stock_threshold || 0);
  const quantity = Number(stock?.quantity || 0);
  return Number((quantity - threshold).toFixed(3));
}

function getStockMovementTypeLabel(type) {
  if (type === "sales") return "Penjualan Kasir";
  if (type === "refund") return "Refund Penjualan";
  return type || "Mutasi";
}

function getStockHistory(stock, purchases, transfers, opnames, stockMovements) {
  if (!stock) return [];

  const purchaseRows = purchases.flatMap((purchase) =>
    purchase.items
      .filter((item) => item.material_id === stock.material_id && purchase.outlet_id === stock.outlet_id)
      .map((item) => ({
        id: `${purchase.id}-${item.material_id}`,
        date: purchase.purchase_date,
        type: "Pembelian",
        description: purchase.supplier?.name || "Supplier",
        quantity: Number(item.quantity || 0),
        unit: item.unit,
        amount: item.subtotal,
        variant: "success"
      }))
  );

  const transferRows = transfers.flatMap((transfer) =>
    transfer.items
      .filter((item) => item.material_id === stock.material_id && (transfer.from_outlet_id === stock.outlet_id || transfer.to_outlet_id === stock.outlet_id))
      .map((item) => {
        const isIncoming = transfer.to_outlet_id === stock.outlet_id;
        return {
          id: `${transfer.id}-${item.material_id}-${isIncoming ? "in" : "out"}`,
          date: transfer.transfer_date,
          type: isIncoming ? "Transfer Masuk" : "Transfer Keluar",
          description: isIncoming ? `Dari ${transfer.from_outlet?.name || "-"}` : `Ke ${transfer.to_outlet?.name || "-"}`,
          quantity: Number(item.quantity || 0) * (isIncoming ? 1 : -1),
          unit: item.unit,
          amount: null,
          variant: isIncoming ? "success" : "warning"
        };
      })
  );

  const opnameRows = opnames
    .filter((opname) => opname.material_id === stock.material_id && opname.outlet_id === stock.outlet_id)
    .map((opname) => ({
      id: opname.id,
      date: opname.opname_date,
      type: "Stock Opname",
      description: opname.note || "Adjustment stok fisik",
      quantity: Number(opname.difference || 0),
      unit: opname.unit,
      amount: null,
      variant: opname.difference < 0 ? "danger" : "success"
    }));

  const movementRows = stockMovements
    .filter((movement) => movement.material_id === stock.material_id && movement.outlet_id === stock.outlet_id)
    .map((movement) => ({
      id: movement.id,
      date: movement.movement_date,
      type: getStockMovementTypeLabel(movement.type),
      description: movement.description || movement.reference_number || "-",
      quantity: Number(movement.quantity || 0),
      unit: movement.unit,
      amount: null,
      variant: movement.type === "refund" ? "success" : Number(movement.quantity || 0) < 0 ? "danger" : "success"
    }));

  return [...purchaseRows, ...transferRows, ...opnameRows, ...movementRows].sort((a, b) => new Date(b.date) - new Date(a.date));
}

function getTransferTypeLabel(row) {
  if (row?.loan_return_for_transfer_id) return "Pengembalian Pinjaman";
  return row?.transfer_type === "loan" ? "Pinjaman" : "Regular";
}

function getTransferTypeVariant(row) {
  if (row?.loan_return_for_transfer_id) return "info";
  return row?.transfer_type === "loan" ? "warning" : "outline";
}

function getLoanStatusLabel(status) {
  if (status === "pending") return "Menunggu Approval";
  if (status === "open") return "Open";
  if (status === "partial_returned") return "Partial";
  if (status === "returned") return "Selesai";
  if (status === "rejected") return "Ditolak";
  return status || "-";
}

function StockDetailDialog({ onOpenChange, open, opnames, purchases, stock, stockMovements, transfers }) {
  const history = getStockHistory(stock, purchases, transfers, opnames, stockMovements);
  const gap = getStockGap(stock);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-5rem)] max-w-4xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle>Detail Stok Harga Pokok Produksi</DialogTitle>
          <DialogDescription>Ringkasan posisi stok dan histori mutasi untuk outlet ini.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="min-w-0 rounded-md border bg-muted/25 p-4">
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Profil Produk</p>
              <div className="mt-3 space-y-2 text-[12px]">
                <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
                  <span className="text-muted-foreground">Nama</span>
                  <span className="truncate text-right font-medium">{stock?.material?.name || "-"}</span>
                </div>
                <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
                  <span className="text-muted-foreground">Unit</span>
                  <span className="truncate text-right">{stock?.unit || stock?.material?.unit || "-"}</span>
                </div>
                <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
                  <span className="text-muted-foreground">Threshold</span>
                  <span className="truncate text-right">{formatStockQty(stock?.material?.low_stock_threshold, stock?.unit)}</span>
                </div>
                <div className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3">
                  <span className="text-muted-foreground">Status Produk</span>
                  <span className="text-right">
                    <StatusBadge status={stock?.material?.status || "inactive"} />
                  </span>
                </div>
              </div>
            </div>

            <div className="min-w-0 rounded-md border bg-muted/25 p-4">
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Posisi Stok</p>
              <div className="mt-3 space-y-2 text-[12px]">
                <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
                  <span className="text-muted-foreground">Outlet</span>
                  <span className="truncate text-right font-medium">{stock?.outlet?.name || "-"}</span>
                </div>
                <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
                  <span className="text-muted-foreground">Qty Sistem</span>
                  <span className="truncate text-right">{formatStockQty(stock?.quantity, stock?.unit)}</span>
                </div>
                <div className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3">
                  <span className="text-muted-foreground">Gap Threshold</span>
                  <span className="text-right">
                    <Badge variant={gap < 0 ? "danger" : "success"}>{formatStockQty(gap, stock?.unit)}</Badge>
                  </span>
                </div>
                <div className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3">
                  <span className="text-muted-foreground">Status Stok</span>
                  <span className="text-right">
                    <StatusBadge status={stock?.status || "normal"} />
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-md border">
            <div className="flex items-center justify-between gap-3 border-b bg-muted/25 px-4 py-3">
              <p className="text-[13px] font-semibold">Histori Mutasi</p>
              <Badge variant="muted">{history.length} data</Badge>
            </div>
            {history.length ? (
              <div className="max-h-80 overflow-auto scrollbar-thin">
                <div className="min-w-[680px] divide-y">
                  <div className="grid grid-cols-[110px_140px_minmax(0,1fr)_110px_120px] gap-3 bg-muted/15 px-4 py-2 text-[11px] font-semibold uppercase text-muted-foreground">
                    <span>Tanggal</span>
                    <span>Tipe</span>
                    <span>Keterangan</span>
                    <span>Qty</span>
                    <span className="text-right">Nominal</span>
                  </div>
                  {history.map((item) => (
                    <div key={item.id} className="grid grid-cols-[110px_140px_minmax(0,1fr)_110px_120px] items-center gap-3 px-4 py-2 text-[12px]">
                      <span className="text-muted-foreground">{formatDate(item.date)}</span>
                      <span>
                        <Badge variant={item.variant}>{item.type}</Badge>
                      </span>
                      <span className="truncate">{item.description}</span>
                      <span className={item.quantity < 0 ? "font-medium text-destructive" : "font-medium text-emerald-700"}>
                        {item.quantity > 0 ? "+" : ""}
                        {formatStockQty(item.quantity, item.unit)}
                      </span>
                      <span className="text-right text-muted-foreground">{item.amount ? formatCurrency(item.amount) : "-"}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-4 text-[12px] text-muted-foreground">Belum ada histori mutasi untuk produk dan outlet ini.</div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StockRowActions({
  allStocks,
  canCreateInventory,
  canCreateStockOpname,
  canCreateStockPurchase,
  canCreateStockTransfer,
  canViewStockDetail,
  materials,
  onCreatePurchase,
  onCreateTransfer,
  opnames,
  outlets,
  purchases,
  selectedOutletId,
  session,
  stock,
  stockMovements,
  suppliers,
  transfers
}) {
  const navigate = useNavigate();
  const [detailOpen, setDetailOpen] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  function openOpnameWorksheet() {
    const params = new globalThis.URLSearchParams({
      outlet: stock.outlet_id,
      material: stock.material_id,
      date: getDefaultOpnameDate()
    });
    navigate(`/inventory/stock-opname-bahan-baku?${params.toString()}`);
  }

  return (
    <>
      <InlineRowActions>
        {canViewStockDetail ? (
          <RowActionButton label={`Detail stok ${stock.material?.name || ""}`} onClick={() => setDetailOpen(true)}>
            <Eye />
          </RowActionButton>
        ) : null}
        {canCreateInventory && canCreateStockPurchase ? (
          <RowActionButton label={`Buat pembelian ${stock.material?.name || ""}`} onClick={() => setPurchaseOpen(true)}>
            <ClipboardCheck />
          </RowActionButton>
        ) : null}
        {canCreateInventory && canCreateStockTransfer ? (
          <RowActionButton label={`Buat transfer ${stock.material?.name || ""}`} onClick={() => setTransferOpen(true)}>
            <Truck />
          </RowActionButton>
        ) : null}
        {canCreateInventory && canCreateStockOpname ? (
          <RowActionButton label={`Buka opname ${stock.material?.name || ""}`} onClick={openOpnameWorksheet}>
            <RefreshCw />
          </RowActionButton>
        ) : null}
      </InlineRowActions>

      {canViewStockDetail ? (
        <StockDetailDialog
          open={detailOpen}
          onOpenChange={setDetailOpen}
          opnames={opnames}
          purchases={purchases}
          stock={stock}
          stockMovements={stockMovements}
          transfers={transfers}
        />
      ) : null}
      {canCreateInventory ? (
        <>
          {canCreateStockPurchase ? (
            <PurchaseDialog
              initialValues={{ outlet_id: stock.outlet_id, material_id: stock.material_id }}
              materials={materials}
              open={purchaseOpen}
              onOpenChange={setPurchaseOpen}
              outlets={outlets}
              selectedOutletId={selectedOutletId}
              suppliers={suppliers}
              trigger={null}
              onSubmit={onCreatePurchase}
            />
          ) : null}
          {canCreateStockTransfer ? (
            <TransferDialog
              initialValues={{ from_outlet_id: stock.outlet_id, material_id: stock.material_id }}
              materials={materials}
              open={transferOpen}
              onOpenChange={setTransferOpen}
              outlets={outlets}
              selectedOutletId={selectedOutletId}
              session={session}
              stocks={allStocks}
              trigger={null}
              onSubmit={onCreateTransfer}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

function StokBahanBakuPage() {
  const {
    allStocks,
    stocks,
    lowStocks,
    outOfStocks,
    purchaseTotal,
    purchases,
    transfers,
    opnames,
    stockMovements,
    isLoading,
    materials,
    outlets,
    selectedOutletId,
    session,
    suppliers
  } = useInventoryPage();
  const [statusFilter, setStatusFilter] = useState("all");
  const createPurchase = useCreatePurchase();
  const createTransfer = useCreateStockTransfer();
  const canCreateStockPurchase = can(session, "inventory.stocks", "purchase");
  const canCreateStockTransfer = false;
  const canCreateStockOpname = can(session, "inventory.stocks", "opname");
  const canViewStockDetail = can(session, "inventory.stocks", "detail");
  const canCreateInventory = canCreateStockPurchase || canCreateStockTransfer || canCreateStockOpname;
  const hasStockActions = canViewStockDetail || canCreateInventory;
  const filteredStocks = useMemo(
    () => (statusFilter === "all" ? stocks : stocks.filter((stock) => stock.status === statusFilter)),
    [statusFilter, stocks]
  );

  return (
    <div className="space-y-4">
      <InventorySummary purchaseTotal={purchaseTotal} stocks={stocks} lowStocks={lowStocks} outOfStocks={outOfStocks} />
      <DataTable
        title="Stok Harga Pokok Produksi"
        description="Stok per outlet dengan status low stock berdasarkan threshold produk."
        data={filteredStocks}
        isLoading={isLoading}
        searchKeys={["material.name", "outlet.name", "unit"]}
        actions={
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="sm:w-44">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              {stockStatusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        columns={[
          { key: "material", label: "Produk", render: (row) => row.material?.name, className: "font-medium" },
          { key: "outlet", label: "Outlet", render: (row) => getOutletName(row, outlets) },
          { key: "quantity", label: "Qty", render: (row) => formatStockQty(row.quantity, row.unit), sortValue: (row) => row.quantity },
          {
            key: "last_purchase_price",
            label: "Harga Terakhir",
            render: (row) => formatCurrency(row.last_purchase_price || 0),
            sortValue: (row) => row.last_purchase_price || 0
          },
          {
            key: "stock_value",
            label: "Nilai Stok",
            render: (row) => formatCurrency(row.stock_value || 0),
            sortValue: (row) => row.stock_value || 0
          },
          {
            key: "threshold",
            label: "Threshold",
            render: (row) => formatStockQty(row.material?.low_stock_threshold, row.unit),
            sortValue: (row) => row.material?.low_stock_threshold || 0
          },
          { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
          {
            key: "actions",
            label: "Aksi",
            render: (row) => (
              hasStockActions ? (
                <StockRowActions
                  allStocks={allStocks}
                  canCreateInventory={canCreateInventory}
                  canCreateStockOpname={canCreateStockOpname}
                  canCreateStockPurchase={canCreateStockPurchase}
                  canCreateStockTransfer={canCreateStockTransfer}
                  canViewStockDetail={canViewStockDetail}
                  materials={materials}
                  opnames={opnames}
                  outlets={outlets}
                  purchases={purchases}
                  selectedOutletId={selectedOutletId}
                  session={session}
                  stock={row}
                  stockMovements={stockMovements}
                  suppliers={suppliers}
                  transfers={transfers}
                  onCreatePurchase={(values) => createPurchase.mutateAsync(values)}
                  onCreateTransfer={(values) => createTransfer.mutateAsync(values)}
                />
              ) : (
                <span className="text-muted-foreground">-</span>
              )
            ),
            className: "text-right whitespace-nowrap",
            headerClassName: "text-right"
          }
        ]}
      />
    </div>
  );
}

function PembelianBahanBakuPage() {
  const { stocks, lowStocks, outOfStocks, purchaseTotal, purchases, isLoading, session, materials, outlets, suppliers } = useInventoryPage();
  const approvePurchase = useApprovePurchase();
  const rejectPurchase = useRejectPurchase();
  const updatePurchase = useUpdatePurchase();
  const canApprovePurchase = can(session, "inventory.purchases", "approve");
  const canRejectPurchase = can(session, "inventory.purchases", "reject");
  const canUpdatePurchase = can(session, "inventory.purchases", "update");
  const [detailPurchase, setDetailPurchase] = useState(null);
  const [editPurchase, setEditPurchase] = useState(null);
  const [rejectPurchaseTarget, setRejectPurchaseTarget] = useState(null);

  async function handleApprove(row) {
    await approvePurchase.mutateAsync({ id: row.id, payload: {} });
  }

  async function handleReject(reason) {
    if (!rejectPurchaseTarget) return;
    await rejectPurchase.mutateAsync({ id: rejectPurchaseTarget.id, payload: { rejection_note: reason } });
    setRejectPurchaseTarget(null);
    setDetailPurchase(null);
  }

  async function handleUpdatePurchase(payload) {
    if (!editPurchase) return;
    await updatePurchase.mutateAsync({ id: editPurchase.id, payload });
    setEditPurchase(null);
    setDetailPurchase(null);
  }

  return (
    <div className="space-y-4">
      <InventorySummary purchaseTotal={purchaseTotal} stocks={stocks} lowStocks={lowStocks} outOfStocks={outOfStocks} />
      <DataTable
        title="Pembelian Harga Pokok Produksi"
        description="Batch pembelian dari kasir/admin menunggu approval sebelum menambah stok dan laporan."
        data={purchases}
        isLoading={isLoading}
        searchKeys={["supplier.name", "outlet.name", "status", "source", "created_by_user.name", "payment_type"]}
        actions={null}
        columns={[
          { key: "purchase_date", label: "Tanggal", render: (row) => formatDate(row.purchase_date) },
          { key: "supplier", label: "Supplier", render: (row) => row.supplier?.name || "-", className: "font-medium" },
          { key: "outlet", label: "Outlet", render: (row) => getOutletName(row, outlets) },
          { key: "source", label: "Source", render: (row) => <Badge variant="secondary">{row.source || "admin_web"}</Badge> },
          { key: "created_by_user", label: "User", render: (row) => getInputUserName(row) },
          { key: "payment_type", label: "Bayar", render: (row) => <Badge variant="outline">{row.payment_type || "lunas"}</Badge> },
          { key: "item_count", label: "Item", render: (row) => <Badge variant="info">{row.item_count} item</Badge> },
          { key: "hpp_total", label: "HPP", render: (row) => formatCurrency(row.hpp_total || 0), sortValue: (row) => row.hpp_total || 0 },
          { key: "biaya_total", label: "Biaya", render: (row) => formatCurrency(row.biaya_total || 0), sortValue: (row) => row.biaya_total || 0 },
          { key: "total", label: "Total", render: (row) => formatCurrency(row.grand_total || row.total), sortValue: (row) => row.grand_total || row.total },
          { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
          {
            key: "actions",
            label: "Aksi",
            render: (row) => (
                <InlineRowActions>
                  <RowActionButton label="Detail pembelian" onClick={() => setDetailPurchase(row)}>
                    <Eye />
                  </RowActionButton>
                  {canUpdatePurchase ? (
                    <RowActionButton label="Edit pembelian" onClick={() => setEditPurchase(row)} disabled={updatePurchase.isPending}>
                      <Pencil />
                    </RowActionButton>
                  ) : null}
                  {row.status === "pending" && canApprovePurchase ? (
                    <RowActionButton label="Approve pembelian" onClick={() => handleApprove(row)} disabled={approvePurchase.isPending}>
                      {approvePurchase.isPending ? <RefreshCw className="animate-spin" /> : <CheckCircle2 />}
                    </RowActionButton>
                  ) : null}
                  {row.status === "pending" && canRejectPurchase ? (
                    <RowActionButton
                      className="text-destructive hover:bg-destructive/10"
                      label="Reject pembelian"
                      onClick={() => setRejectPurchaseTarget(row)}
                      disabled={rejectPurchase.isPending}
                    >
                      {rejectPurchase.isPending ? <RefreshCw className="animate-spin" /> : <X />}
                    </RowActionButton>
                  ) : null}
                </InlineRowActions>
              ),
            className: "text-right whitespace-nowrap",
            headerClassName: "text-right"
          }
        ]}
      />
      <Dialog open={Boolean(detailPurchase)} onOpenChange={(open) => !open && setDetailPurchase(null)}>
        <DialogContent className="max-h-[86vh] max-w-6xl overflow-hidden p-0">
          <DialogHeader>
            <div className="border-b px-5 py-4">
              <DialogTitle>Detail Pembelian Harga Pokok Produksi</DialogTitle>
              <DialogDescription className="mt-1">
                {detailPurchase
                  ? `${formatDate(detailPurchase.purchase_date)} · ${getOutletName(detailPurchase, outlets)} · ${detailPurchase.supplier?.name || "Tanpa supplier"}`
                  : null}
              </DialogDescription>
            </div>
          </DialogHeader>
          {detailPurchase ? (
            <div className="max-h-[calc(86vh-88px)] space-y-4 overflow-y-auto px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {[
                  ["Status", <StatusBadge key="status" status={detailPurchase.status} />],
                  ["Source", detailPurchase.source || "admin_web"],
                  ["User", getInputUserName(detailPurchase)],
                  ["Pembayaran", detailPurchase.payment_type || "lunas"],
                  ["Total", formatCurrency(detailPurchase.grand_total || detailPurchase.total || 0)]
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border p-3">
                    <p className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</p>
                    <div className="mt-1 text-[13px] font-semibold">{value}</div>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto rounded-md border">
                <Table className="min-w-[920px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">No</TableHead>
                      <TableHead className="min-w-[260px]">Nama</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Kategori</TableHead>
                      <TableHead className="text-right">Jumlah</TableHead>
                      <TableHead>Satuan</TableHead>
                      <TableHead className="text-right">Harga</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(detailPurchase.items || []).map((item, index) => (
                      <TableRow key={`${item.material_id}-${index}`}>
                        <TableCell>{index + 1}</TableCell>
                        <TableCell className="font-medium">
                          <span className="block max-w-[360px] break-words">
                            {item.material_name || item.material?.name || item.material_id}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={item.material_type === "biaya" ? "warning" : "info"}>
                            {item.material_type === "biaya" ? "Biaya Produksi" : "HPP"}
                          </Badge>
                        </TableCell>
                        <TableCell>{item.category?.name || "-"}</TableCell>
                        <TableCell className="text-right">{formatNumber(item.quantity || 0)}</TableCell>
                        <TableCell>{item.unit}</TableCell>
                        <TableCell className="text-right">{formatCurrency(item.unit_price || 0)}</TableCell>
                        <TableCell className="text-right font-semibold">{formatCurrency(item.subtotal || 0)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-wrap justify-end gap-2 text-[13px] font-semibold">
                <span className="rounded-md border bg-muted/30 px-3 py-2">HPP: {formatCurrency(detailPurchase.hpp_total || 0)}</span>
                <span className="rounded-md border bg-muted/30 px-3 py-2">Biaya: {formatCurrency(detailPurchase.biaya_total || 0)}</span>
                <span className="rounded-md border bg-primary/10 px-3 py-2 text-primary">
                  Total: {formatCurrency(detailPurchase.grand_total || detailPurchase.total || 0)}
                </span>
              </div>
              {detailPurchase.rejection_note ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-[13px] text-destructive">
                  Alasan reject: {detailPurchase.rejection_note}
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <PurchaseBatchEditDialog
        open={Boolean(editPurchase)}
        onOpenChange={(open) => !open && setEditPurchase(null)}
        purchase={editPurchase}
        materials={materials}
        outlets={outlets}
        suppliers={suppliers}
        onSubmit={handleUpdatePurchase}
      />
      <RejectReasonDialog
        open={Boolean(rejectPurchaseTarget)}
        onOpenChange={(open) => !open && setRejectPurchaseTarget(null)}
        title="Reject Pembelian"
        description={
          rejectPurchaseTarget
            ? `${formatDate(rejectPurchaseTarget.purchase_date)} · ${rejectPurchaseTarget.outlet?.name || "-"}`
            : "Tulis alasan reject pembelian."
        }
        isSubmitting={rejectPurchase.isPending}
        onConfirm={handleReject}
      />
    </div>
  );
}

function TransferStokPage() {
  const { stocks, lowStocks, outOfStocks, purchaseTotal, transfers, isLoading, session, materials, outlets } = useInventoryPage();
  const updateTransfer = useUpdateStockTransfer();
  const approveTransfer = useApproveStockTransfer();
  const rejectTransfer = useRejectStockTransfer();
  const canUpdateTransfer = can(session, "inventory.transfers", "update");
  const canApproveTransfer = can(session, "inventory.transfers", "approve");
  const canRejectTransfer = can(session, "inventory.transfers", "reject");
  const [detailTransfer, setDetailTransfer] = useState(null);
  const [editTransfer, setEditTransfer] = useState(null);
  const [rejectTransferTarget, setRejectTransferTarget] = useState(null);

  async function handleApprove(row) {
    await approveTransfer.mutateAsync({ id: row.id, payload: {} });
  }

  async function handleReject(reason) {
    if (!rejectTransferTarget) return;
    await rejectTransfer.mutateAsync({ id: rejectTransferTarget.id, payload: { rejection_note: reason } });
    setRejectTransferTarget(null);
    setDetailTransfer(null);
  }

  async function handleEditTransfer(payload) {
    if (!editTransfer) return;
    await updateTransfer.mutateAsync({ id: editTransfer.id, payload });
    setEditTransfer(null);
    setDetailTransfer(null);
  }

  return (
    <div className="space-y-4">
      <InventorySummary purchaseTotal={purchaseTotal} stocks={stocks} lowStocks={lowStocks} outOfStocks={outOfStocks} />
      <DataTable
        title="Transfer Stok"
        description="Request transfer dari kasir, admin hanya approve atau reject."
        data={transfers}
        isLoading={isLoading}
        searchKeys={["from_outlet.name", "to_outlet.name", "status", "source", "requested_user.name"]}
        actions={null}
        columns={[
          { key: "transfer_date", label: "Tanggal", render: (row) => formatDate(row.transfer_date) },
          { key: "from_outlet", label: "Dari", render: (row) => row.from_outlet?.name || "-" },
          { key: "to_outlet", label: "Ke", render: (row) => row.to_outlet?.name || "-" },
          { key: "transfer_type", label: "Tipe", render: (row) => <Badge variant={getTransferTypeVariant(row)}>{getTransferTypeLabel(row)}</Badge> },
          {
            key: "loan_status",
            label: "Status Pinjaman",
            render: (row) => row.transfer_type === "loan" ? <Badge variant="info">{getLoanStatusLabel(row.loan_status)}</Badge> : "-"
          },
          { key: "source", label: "Source", render: (row) => <Badge variant="secondary">{row.source || "admin_web"}</Badge> },
          { key: "requested_user", label: "User", render: (row) => getInputUserName(row, "requested_user") },
          { key: "item_count", label: "Item", render: (row) => <Badge variant="info">{formatNumber(row.item_count || 0)} item</Badge> },
          { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
          {
            key: "actions",
            label: "Aksi",
            render: (row) => (
              <InlineRowActions>
                <RowActionButton label="Detail transfer" onClick={() => setDetailTransfer(row)}>
                  <Eye />
                </RowActionButton>
                {row.status === "pending" && canUpdateTransfer ? (
                  <RowActionButton label="Edit transfer" onClick={() => setEditTransfer(row)} disabled={updateTransfer.isPending}>
                    <Pencil />
                  </RowActionButton>
                ) : null}
                {row.status === "pending" && canApproveTransfer ? (
                  <RowActionButton label="Approve transfer" onClick={() => handleApprove(row)} disabled={approveTransfer.isPending}>
                    {approveTransfer.isPending ? <RefreshCw className="animate-spin" /> : <CheckCircle2 />}
                  </RowActionButton>
                ) : null}
                {row.status === "pending" && canRejectTransfer ? (
                  <RowActionButton
                    className="text-destructive hover:bg-destructive/10"
                    label="Reject transfer"
                    onClick={() => setRejectTransferTarget(row)}
                    disabled={rejectTransfer.isPending}
                  >
                    {rejectTransfer.isPending ? <RefreshCw className="animate-spin" /> : <X />}
                  </RowActionButton>
                ) : null}
              </InlineRowActions>
            ),
            className: "text-right whitespace-nowrap",
            headerClassName: "text-right"
          }
        ]}
      />
      <Dialog open={Boolean(detailTransfer)} onOpenChange={(open) => !open && setDetailTransfer(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Detail Transfer Harga Pokok Produksi</DialogTitle>
            <DialogDescription>
              {detailTransfer
                ? `${formatDate(detailTransfer.transfer_date)} · ${detailTransfer.from_outlet?.name || "-"} ke ${detailTransfer.to_outlet?.name || "-"}`
                : null}
            </DialogDescription>
          </DialogHeader>
          {detailTransfer ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                {[
                  ["Status", <StatusBadge key="status" status={detailTransfer.status} />],
                  ["Tipe", <Badge key="type" variant={getTransferTypeVariant(detailTransfer)}>{getTransferTypeLabel(detailTransfer)}</Badge>],
                  ...(detailTransfer.transfer_type === "loan"
                    ? [["Status Pinjaman", <Badge key="loan-status" variant="info">{getLoanStatusLabel(detailTransfer.loan_status)}</Badge>]]
                    : []),
                  ["Source", detailTransfer.source || "admin_web"],
                  ["User", getInputUserName(detailTransfer, "requested_user")],
                  ["Item", `${detailTransfer.item_count || 0} item`]
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border p-3">
                    <p className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</p>
                    <div className="mt-1 text-[13px] font-semibold">{value}</div>
                  </div>
                ))}
              </div>

              {detailTransfer.note ? (
                <div className="rounded-md border p-3 text-[13px]">Catatan: {detailTransfer.note}</div>
              ) : null}

              {detailTransfer.loan_parent ? (
                <div className="rounded-md border p-3 text-[13px]">
                  Pengembalian untuk pinjaman: <span className="font-semibold">{detailTransfer.loan_parent.id}</span> ·{" "}
                  {detailTransfer.loan_parent.from_outlet?.name || "-"} ke {detailTransfer.loan_parent.to_outlet?.name || "-"}
                </div>
              ) : null}

              {detailTransfer.transfer_type === "loan" ? (
                <div className="rounded-md border">
                  <div className="border-b px-3 py-2 text-sm font-semibold">Sisa Pinjaman</div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Produk</TableHead>
                        <TableHead className="text-right">Dipinjam</TableHead>
                        <TableHead className="text-right">Kembali</TableHead>
                        <TableHead className="text-right">Sisa</TableHead>
                        <TableHead>Satuan</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(detailTransfer.items || []).map((item) => {
                        const returned = (detailTransfer.loan_returned_items || []).find((row) => row.material_id === item.material_id);
                        const remaining = (detailTransfer.loan_remaining_items || []).find((row) => row.material_id === item.material_id);
                        return (
                          <TableRow key={`loan-${item.material_id}`}>
                            <TableCell className="font-medium">{item.material?.name || item.material_name || item.material_id}</TableCell>
                            <TableCell className="text-right">{formatNumber(item.quantity || 0)}</TableCell>
                            <TableCell className="text-right">{formatNumber(returned?.quantity || 0)}</TableCell>
                            <TableCell className="text-right">{formatNumber(remaining?.quantity || 0)}</TableCell>
                            <TableCell>{item.unit}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : null}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>No</TableHead>
                    <TableHead>Nama Produk</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Jumlah</TableHead>
                    <TableHead>Satuan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(detailTransfer.items || []).map((item, index) => (
                    <TableRow key={`${item.material_id}-${index}`}>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell className="font-medium">{item.material?.name || item.material_name || item.material_id}</TableCell>
                      <TableCell>
                        <Badge variant={item.material_type === "biaya" ? "warning" : "info"}>
                          {item.material_type === "biaya" ? "Biaya Produksi" : "HPP"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{formatNumber(item.quantity || 0)}</TableCell>
                      <TableCell>{item.unit}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {detailTransfer.rejection_note ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-[13px] text-destructive">
                  Alasan reject: {detailTransfer.rejection_note}
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <TransferEditDialog
        open={Boolean(editTransfer)}
        onOpenChange={(open) => !open && setEditTransfer(null)}
        materials={materials}
        outlets={outlets}
        transfer={editTransfer}
        onSubmit={handleEditTransfer}
      />
      <RejectReasonDialog
        open={Boolean(rejectTransferTarget)}
        onOpenChange={(open) => !open && setRejectTransferTarget(null)}
        title="Reject Transfer"
        description={
          rejectTransferTarget
            ? `${formatDate(rejectTransferTarget.transfer_date)} · ${rejectTransferTarget.from_outlet?.name || "-"} ke ${rejectTransferTarget.to_outlet?.name || "-"}`
            : "Tulis alasan reject transfer."
        }
        isSubmitting={rejectTransfer.isPending}
        onConfirm={handleReject}
      />
    </div>
  );
}

function getStockOpnameMovements(row) {
  const transferOutQuantity = Number(
    row.transfer_out_quantity ?? (Number(row.transfer_quantity || 0) < 0 ? Math.abs(Number(row.transfer_quantity || 0)) : 0)
  );
  const transferInQuantity = Number(
    row.transfer_in_quantity ?? Math.max(Number(row.transfer_quantity || 0) + transferOutQuantity, 0)
  );
  const purchaseQuantity = Number(
    row.purchase_quantity ?? Math.max(Number(row.incoming_quantity || 0) - transferInQuantity, 0)
  );
  return {
    purchaseQuantity,
    transferInQuantity,
    transferOutQuantity,
    salesQuantity: Number(row.computed_sales_quantity || 0)
  };
}

function calculateRealSystem(row, damageQuantity) {
  const movements = getStockOpnameMovements(row);
  return Number(
    (
      Number(row.opening_quantity || 0) +
      movements.purchaseQuantity +
      movements.transferInQuantity -
      movements.transferOutQuantity -
      movements.salesQuantity -
      Number(damageQuantity || 0)
    ).toFixed(3)
  );
}

const opnameStatusMeta = {
  pas: { label: "Pas", variant: "success" },
  tidak_sesuai_standar: { label: "Tidak Sesuai Standar", variant: "warning" },
  stock_hilang: { label: "Stock Hilang", variant: "danger" }
};

function getWorksheetStatus(difference) {
  if (Math.abs(Number(difference || 0)) < 0.001) return "pas";
  return Number(difference || 0) > 0 ? "stock_hilang" : "tidak_sesuai_standar";
}

function getWorksheetNote(difference) {
  return opnameStatusMeta[getWorksheetStatus(difference)]?.label || opnameStatusMeta.pas.label;
}

function OpnameStatusBadge({ status, difference }) {
  const resolvedStatus = status || getWorksheetStatus(difference);
  const meta = opnameStatusMeta[resolvedStatus] || opnameStatusMeta.pas;
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

function getWorksheetEditKey(outletId, date, materialId) {
  return `${outletId}:${date}:${materialId}`;
}

function getEditedWorksheetRow(row, edit = {}) {
  const damageQuantity = Number(edit.damage_quantity ?? row.damage_quantity ?? 0);
  const actualQuantity = Number(edit.actual_quantity ?? row.actual_quantity ?? 0);
  const realSystemQuantity = calculateRealSystem(row, damageQuantity);
  const difference = Number((realSystemQuantity - actualQuantity).toFixed(3));
  const lossAmount = Math.max(difference, 0) * Number(row.unit_price || 0);
  const status = getWorksheetStatus(difference);

  return {
    ...row,
    damage_quantity: damageQuantity,
    real_system_quantity: realSystemQuantity,
    actual_quantity: actualQuantity,
    difference,
    status,
    loss_amount: lossAmount,
    note: getWorksheetNote(difference)
  };
}

function getExportFilePart(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getOpnameStatusLabel(status, difference) {
  return opnameStatusMeta[status || getWorksheetStatus(difference)]?.label || opnameStatusMeta.pas.label;
}

function getOpnameBatchGroups(opnames) {
  const groups = new Map();

  opnames.forEach((opname) => {
    const key = opname.batch_id || opname.id;
    const group = groups.get(key) || {
      id: key,
      batch_id: opname.batch_id,
      outlet: opname.outlet,
      opname_date: opname.opname_date,
      user: opname.user,
      rows: []
    };

    group.rows.push(opname);
    groups.set(key, group);
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      total_items: group.rows.length,
      missing_items: group.rows.filter((row) => Number(row.difference || 0) > 0).length,
      total_loss_amount: group.rows.reduce((total, row) => total + Number(row.loss_amount || 0), 0)
    }))
    .sort((a, b) => String(b.opname_date).localeCompare(String(a.opname_date)));
}

function StockOpnameHistory({ isLoading, opnames }) {
  const groups = useMemo(() => getOpnameBatchGroups(opnames), [opnames]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [detailSort, setDetailSort] = useState({ key: "material", direction: "asc" });
  const detailColumns = useMemo(
    () => [
      { key: "material", label: "Produk", value: (row) => row.material?.name || "" },
      { key: "unit", label: "Satuan", value: (row) => row.unit || "" },
      { key: "opening_quantity", label: "Stok Awal", value: (row) => Number(row.opening_quantity ?? row.system_quantity ?? 0) },
      { key: "purchase_quantity", label: "Pembelian", value: (row) => getStockOpnameMovements(row).purchaseQuantity },
      { key: "transfer_in_quantity", label: "Transfer Masuk", value: (row) => getStockOpnameMovements(row).transferInQuantity },
      { key: "transfer_out_quantity", label: "Transfer Keluar", value: (row) => getStockOpnameMovements(row).transferOutQuantity },
      { key: "computed_sales_quantity", label: "Penjualan Bersih", value: (row) => getStockOpnameMovements(row).salesQuantity },
      { key: "damage_quantity", label: "Rusak", value: (row) => Number(row.damage_quantity || 0) },
      { key: "system_quantity", label: "Sisa Sistem", value: (row) => Number(row.system_quantity || 0) },
      { key: "actual_quantity", label: "Sisa Stok Gudang", value: (row) => Number(row.actual_quantity || 0) },
      { key: "difference", label: "Selisih", value: (row) => Number(row.difference || 0) },
      { key: "loss_amount", label: "Nilai Hilang", value: (row) => Number(row.loss_amount || 0) },
      { key: "status", label: "Keterangan", value: (row) => opnameStatusMeta[row.status || getWorksheetStatus(row.difference)]?.label || "" }
    ],
    []
  );
  const sortedDetailRows = useMemo(() => {
    if (!selectedGroup) return [];
    const column = detailColumns.find((item) => item.key === detailSort.key) || detailColumns[0];

    return [...selectedGroup.rows].sort((a, b) => {
      const av = column.value(a);
      const bv = column.value(b);
      const result =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av ?? "").localeCompare(String(bv ?? ""), "id-ID", { numeric: true });

      return detailSort.direction === "asc" ? result : -result;
    });
  }, [detailColumns, detailSort, selectedGroup]);

  function closeDetail() {
    setSelectedGroup(null);
  }

  function toggleDetailSort(key) {
    setDetailSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc"
    }));
  }

  function renderSortableHead(column) {
    const active = detailSort.key === column.key;
    return (
      <TableHead key={column.key}>
        <button
          type="button"
          className={cn("inline-flex items-center gap-1", active && "text-foreground")}
          onClick={() => toggleDetailSort(column.key)}
        >
          {column.label}
          <ChevronsUpDown className={cn("h-3 w-3 opacity-50", active && "opacity-100")} />
        </button>
      </TableHead>
    );
  }

  return (
    <>
      <section className="rounded-lg border bg-card shadow-soft">
        <div className="flex flex-col gap-1 border-b p-4">
          <h2 className="text-[15px] font-semibold">Riwayat Stock Opname</h2>
          <p className="text-[12px] text-muted-foreground">Histori tersimpan per batch, outlet, dan tanggal opname.</p>
        </div>

        {isLoading ? (
          <div className="p-4 text-[12px] text-muted-foreground">Memuat riwayat...</div>
        ) : groups.length ? (
          <div className="divide-y">
            {groups.map((group) => (
              <div key={group.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13px] font-semibold">{group.batch_id || "Opname satu produk"}</p>
                    <Badge variant={group.missing_items ? "warning" : "success"}>{group.missing_items ? "Ada selisih" : "Pas"}</Badge>
                  </div>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    {formatDate(group.opname_date)} · {group.outlet?.name || "-"} · User: {getInputUserName(group)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <Badge variant="info">{group.total_items} item</Badge>
                  <Badge variant={group.missing_items ? "warning" : "success"}>{group.missing_items} selisih hilang</Badge>
                  <Badge variant={group.total_loss_amount ? "danger" : "muted"}>{formatCurrency(group.total_loss_amount)}</Badge>
                  <Button variant="outline" size="sm" onClick={() => setSelectedGroup(group)}>
                    <Eye />
                    Detail
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 text-[12px] text-muted-foreground">Belum ada riwayat stock opname.</div>
        )}
      </section>

      <Dialog open={Boolean(selectedGroup)} onOpenChange={(open) => (!open ? closeDetail() : null)}>
        <DialogContent className="max-h-[calc(100vh-5rem)] max-w-6xl gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-5 py-4 pr-12">
            <DialogTitle>Detail Riwayat Stock Opname</DialogTitle>
            <DialogDescription>
              {selectedGroup
                ? `${selectedGroup.batch_id || "Opname satu produk"} · ${formatDate(selectedGroup.opname_date)} · ${selectedGroup.outlet?.name || "-"}`
                : "Detail item stock opname."}
            </DialogDescription>
          </DialogHeader>

          {selectedGroup ? (
            <div className="space-y-4 overflow-y-auto p-5">
              <div className="grid gap-3 rounded-md border bg-muted/20 p-3 text-[12px] md:grid-cols-3">
                <div>
                  <p className="text-muted-foreground">Outlet</p>
                  <p className="font-semibold">{selectedGroup.outlet?.name || "-"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">User</p>
                  <p className="font-semibold">{getInputUserName(selectedGroup)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Tanggal</p>
                  <p className="font-semibold">{formatDate(selectedGroup.opname_date)}</p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-md border bg-muted/25 p-3">
                  <p className="text-[11px] uppercase text-muted-foreground">Total Item</p>
                  <p className="mt-1 text-[18px] font-semibold">{selectedGroup.total_items}</p>
                </div>
                <div className="rounded-md border bg-muted/25 p-3">
                  <p className="text-[11px] uppercase text-muted-foreground">Selisih Hilang</p>
                  <p className="mt-1 text-[18px] font-semibold">{selectedGroup.missing_items}</p>
                </div>
                <div className="rounded-md border bg-muted/25 p-3">
                  <p className="text-[11px] uppercase text-muted-foreground">Nilai Kehilangan</p>
                  <p className="mt-1 text-[18px] font-semibold">{formatCurrency(selectedGroup.total_loss_amount)}</p>
                </div>
              </div>

              <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[12px] font-medium">
                Sisa Sistem = Stok Awal + Pembelian + Transfer Masuk - Transfer Keluar - Penjualan Bersih - Rusak
              </div>

              <div className="overflow-hidden rounded-md border">
                <Table className="min-w-[1550px]">
                  <TableHeader className="bg-muted/30">
                    <TableRow>{detailColumns.map(renderSortableHead)}</TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedDetailRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{row.material?.name || "-"}</TableCell>
                        <TableCell>{row.unit}</TableCell>
                        <TableCell>{formatNumber(row.opening_quantity ?? row.system_quantity)}</TableCell>
                        <TableCell>{formatNumber(getStockOpnameMovements(row).purchaseQuantity)}</TableCell>
                        <TableCell>{formatNumber(getStockOpnameMovements(row).transferInQuantity)}</TableCell>
                        <TableCell className="text-destructive">
                          {formatNumber(getStockOpnameMovements(row).transferOutQuantity)}
                        </TableCell>
                        <TableCell>{formatNumber(getStockOpnameMovements(row).salesQuantity)}</TableCell>
                        <TableCell>{formatStockQty(row.damage_quantity || 0, row.unit)}</TableCell>
                        <TableCell>{formatStockQty(row.system_quantity, row.unit)}</TableCell>
                        <TableCell>{formatStockQty(row.actual_quantity, row.unit)}</TableCell>
                        <TableCell>
                          <Badge variant={row.difference > 0 ? "danger" : row.difference < 0 ? "info" : "success"}>
                            {formatStockQty(row.difference, row.unit)}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatCurrency(row.loss_amount || 0)}</TableCell>
                        <TableCell className="min-w-52">
                          <OpnameStatusBadge status={row.status} difference={row.difference} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function StockOpnameRequestSection({ canApprove, canReject, isApproving, isLoading, isRejecting, onApprove, onReject, requests }) {
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [rejectRequest, setRejectRequest] = useState(null);
  const pendingCount = requests.filter((request) => request.status === "pending").length;

  async function approveSelectedRequest() {
    if (!selectedRequest) return;
    await onApprove(selectedRequest);
    setSelectedRequest(null);
  }

  function rejectSelectedRequest() {
    if (!selectedRequest) return;
    setRejectRequest(selectedRequest);
    setSelectedRequest(null);
  }

  return (
    <section className="rounded-lg border bg-card shadow-soft">
      <div className="flex flex-col gap-1 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold">Request Opname dari APK</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Kasir hanya mengirim request pending. Stok berubah setelah Admin approve.
          </p>
        </div>
        <Badge variant={pendingCount ? "warning" : "info"}>{pendingCount} pending</Badge>
      </div>
      {isLoading ? (
        <div className="p-4 text-[12px] text-muted-foreground">Memuat request opname...</div>
      ) : requests.length ? (
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead>Tanggal</TableHead>
              <TableHead>Request</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Nilai Hilang</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((request) => (
              <TableRow key={request.id}>
                <TableCell>{formatDate(request.opname_date)}</TableCell>
                <TableCell>
                  <div className="font-medium">{request.batch_id || request.id}</div>
                </TableCell>
                <TableCell>{getInputUserName(request, "requested_user")}</TableCell>
                <TableCell>
                  <Badge variant="info">{request.item_count || request.items?.length || 0} item</Badge>
                </TableCell>
                <TableCell>{formatCurrency(request.total_loss_amount || 0)}</TableCell>
                <TableCell>
                  <StatusBadge status={request.status} />
                </TableCell>
                <TableCell className="text-right">
                  <InlineRowActions>
                    <RowActionButton label="Detail request opname" onClick={() => setSelectedRequest(request)}>
                      <Eye />
                    </RowActionButton>
                    {request.status === "pending" && canApprove ? (
                      <RowActionButton label="Approve request opname" onClick={() => onApprove(request)} disabled={isApproving || isRejecting}>
                        <CheckCircle2 />
                      </RowActionButton>
                    ) : null}
                    {request.status === "pending" && canReject ? (
                      <RowActionButton label="Reject request opname" onClick={() => setRejectRequest(request)} disabled={isApproving || isRejecting}>
                        <X />
                      </RowActionButton>
                    ) : null}
                  </InlineRowActions>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <div className="p-4 text-[12px] text-muted-foreground">Belum ada request opname dari APK pada periode ini.</div>
      )}

      <Dialog open={Boolean(selectedRequest)} onOpenChange={(open) => !open && setSelectedRequest(null)}>
        <DialogContent className="max-h-[calc(100vh-5rem)] max-w-6xl gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-5 py-4 pr-12">
            <DialogTitle>Detail Request Opname</DialogTitle>
            <DialogDescription>
              {selectedRequest
                ? `${selectedRequest.batch_id || selectedRequest.id} · ${formatDate(selectedRequest.opname_date)} · ${selectedRequest.outlet?.name || "-"}`
                : "Detail item request opname."}
            </DialogDescription>
          </DialogHeader>
          {selectedRequest ? (
            <div className="space-y-4 overflow-y-auto p-5">
              <div className="grid gap-3 rounded-md border bg-muted/20 p-3 text-[12px] md:grid-cols-3">
                <div>
                  <p className="text-muted-foreground">Source</p>
                  <p className="font-semibold">{selectedRequest.source || "kasir_app"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">User</p>
                  <p className="font-semibold">{getInputUserName(selectedRequest, "requested_user")}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <StatusBadge status={selectedRequest.status} />
                </div>
              </div>
              {selectedRequest.note ? (
                <div className="rounded-md border bg-muted/20 px-3 py-2 text-[12px]">
                  <span className="font-medium">Catatan: </span>
                  {selectedRequest.note}
                </div>
              ) : null}
              {selectedRequest.rejection_note ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                  <span className="font-medium">Alasan reject: </span>
                  {selectedRequest.rejection_note}
                </div>
              ) : null}
              <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[12px] font-medium">
                Sisa Sistem = Stok Awal + Pembelian + Transfer Masuk - Transfer Keluar - Penjualan Bersih - Rusak
              </div>
              <div className="overflow-auto rounded-md border">
                <Table className="min-w-[1750px]">
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead>No</TableHead>
                      <TableHead>Produk</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Stok Awal</TableHead>
                      <TableHead>Pembelian</TableHead>
                      <TableHead>Transfer Masuk</TableHead>
                      <TableHead>Transfer Keluar</TableHead>
                      <TableHead>Penjualan Bersih</TableHead>
                      <TableHead>Rusak</TableHead>
                      <TableHead>Sisa Sistem</TableHead>
                      <TableHead>Sisa Stok Gudang</TableHead>
                      <TableHead>Selisih</TableHead>
                      <TableHead>Keterangan</TableHead>
                      <TableHead>Harga Satuan Terakhir</TableHead>
                      <TableHead>Total Nilai</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(selectedRequest.items || []).map((item, index) => (
                      <TableRow key={`${selectedRequest.id}-${item.material_id}`}>
                        <TableCell>{index + 1}</TableCell>
                        <TableCell className="min-w-44 font-medium">{item.material?.name || item.material_name || "-"}</TableCell>
                        <TableCell>
                          <Badge variant={item.material_type === "biaya" ? "warning" : "info"}>
                            {item.material_type === "biaya" ? "Biaya Produksi" : "HPP"}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatStockQty(item.opening_quantity, item.unit)}</TableCell>
                        <TableCell>{formatStockQty(getStockOpnameMovements(item).purchaseQuantity, item.unit)}</TableCell>
                        <TableCell>{formatStockQty(getStockOpnameMovements(item).transferInQuantity, item.unit)}</TableCell>
                        <TableCell>
                          {formatStockQty(getStockOpnameMovements(item).transferOutQuantity, item.unit)}
                        </TableCell>
                        <TableCell>{formatStockQty(getStockOpnameMovements(item).salesQuantity, item.unit)}</TableCell>
                        <TableCell>{formatStockQty(item.damage_quantity, item.unit)}</TableCell>
                        <TableCell>{formatStockQty(item.real_system_quantity ?? item.system_quantity, item.unit)}</TableCell>
                        <TableCell>{formatStockQty(item.actual_quantity, item.unit)}</TableCell>
                        <TableCell>
                          <Badge variant={opnameStatusMeta[getWorksheetStatus(item.difference)]?.variant || "success"}>
                            {formatStockQty(item.difference, item.unit)}
                          </Badge>
                        </TableCell>
                        <TableCell className="min-w-40">{getOpnameStatusLabel(getWorksheetStatus(item.difference), item.difference)}</TableCell>
                        <TableCell>{formatCurrency(item.unit_price || 0)}</TableCell>
                        <TableCell className={item.loss_amount ? "font-medium text-destructive" : "text-muted-foreground"}>
                          {formatCurrency(item.loss_amount || 0)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {selectedRequest.status === "pending" && (canApprove || canReject) ? (
                <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-end">
                  <p className="text-[11px] text-muted-foreground sm:mr-auto">
                    Request masih pending. Approve akan menyimpan opname dan mengubah stok.
                  </p>
                  {canReject ? (
                    <Button type="button" variant="destructive" onClick={rejectSelectedRequest} disabled={isApproving || isRejecting}>
                      <X />
                      Reject
                    </Button>
                  ) : null}
                  {canApprove ? (
                    <Button type="button" onClick={approveSelectedRequest} disabled={isApproving || isRejecting}>
                      <CheckCircle2 />
                      {isApproving ? "Approve..." : "Approve"}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <RejectReasonDialog
        open={Boolean(rejectRequest)}
        onOpenChange={(open) => !open && setRejectRequest(null)}
        title="Reject request opname"
        description="Isi alasan reject agar kasir tahu kenapa request opname ditolak."
        isSubmitting={isRejecting}
        onConfirm={async (reason) => {
          if (!rejectRequest) return;
          await onReject(rejectRequest, reason);
          setRejectRequest(null);
        }}
      />
    </section>
  );
}

function StockOpnameApkMaterialSelection({ canEdit, outletId, outlets, onOutletChange }) {
  const query = useStockOpnameMaterialSelection(outletId);
  const updateSelection = useUpdateStockOpnameMaterialSelection();
  const [keyword, setKeyword] = useState("");
  const [draftSelections, setDraftSelections] = useState({});
  const items = useMemo(() => query.data?.items || [], [query.data?.items]);
  const savedIds = useMemo(() => query.data?.selected_material_ids || [], [query.data?.selected_material_ids]);
  const selectedIds = draftSelections[outletId] || savedIds;

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const savedSet = useMemo(() => new Set(savedIds), [savedIds]);
  const isDirty = selectedSet.size !== savedSet.size || [...selectedSet].some((id) => !savedSet.has(id));
  const filteredItems = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) => `${item.name} ${item.type} ${item.unit}`.toLowerCase().includes(normalized));
  }, [items, keyword]);
  const filteredIds = filteredItems.map((item) => item.material_id);
  const allFilteredSelected = Boolean(filteredIds.length) && filteredIds.every((id) => selectedSet.has(id));

  function toggleItem(materialId) {
    setDraftSelections((current) => {
      const outletSelection = current[outletId] || savedIds;
      return {
        ...current,
        [outletId]: outletSelection.includes(materialId)
          ? outletSelection.filter((id) => id !== materialId)
          : [...outletSelection, materialId]
      };
    });
  }

  function toggleFilteredItems() {
    setDraftSelections((current) => {
      const outletSelection = current[outletId] || savedIds;
      return {
        ...current,
        [outletId]: allFilteredSelected
          ? outletSelection.filter((id) => !filteredIds.includes(id))
          : Array.from(new Set([...outletSelection, ...filteredIds]))
      };
    });
  }

  async function saveSelection() {
    const response = await updateSelection.mutateAsync({ outlet_id: outletId, material_ids: selectedIds });
    setDraftSelections((current) => ({
      ...current,
      [outletId]: response?.selected_material_ids || selectedIds
    }));
  }

  return (
    <section className="rounded-lg border bg-card shadow-soft">
      <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold">Item Stock Opname APK</h2>
          <p className="mt-1 max-w-3xl text-[12px] text-muted-foreground">
            Pilihan berlaku khusus untuk outlet ini. Item yang tidak dipilih tidak muncul saat APK membuat request baru.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={selectedIds.length ? "info" : "warning"}>{selectedIds.length} item dipilih</Badge>
          {isDirty ? <Badge variant="warning">Belum disimpan</Badge> : null}
          <Button type="button" onClick={saveSelection} disabled={!canEdit || !isDirty || updateSelection.isPending || query.isLoading}>
            <Save />
            {updateSelection.isPending ? "Menyimpan..." : "Simpan ke APK"}
          </Button>
        </div>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={outletId} onValueChange={onOutletChange}>
            <SelectTrigger className="h-9 w-full sm:w-[220px]">
              <SelectValue placeholder="Pilih outlet" />
            </SelectTrigger>
            <SelectContent>
              {outlets.map((outlet) => (
                <SelectItem key={outlet.id} value={outlet.id}>
                  {outlet.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="Cari item, type, atau unit" className="sm:max-w-sm" />
          <Button type="button" variant="outline" onClick={toggleFilteredItems} disabled={!canEdit || !filteredIds.length}>
            {allFilteredSelected
              ? keyword.trim() ? "Lepas hasil pencarian" : "Lepas semua"
              : keyword.trim() ? "Pilih hasil pencarian" : "Pilih semua"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setDraftSelections((current) => ({ ...current, [outletId]: [] }))} disabled={!canEdit || !selectedIds.length}>
            <X />
            Kosongkan
          </Button>
        </div>
        {query.isError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-[12px] text-destructive">{query.error.message}</div>
        ) : query.isLoading ? (
          <div className="rounded-md border border-dashed p-4 text-[12px] text-muted-foreground">Memuat pilihan item APK...</div>
        ) : filteredItems.length ? (
          <div className="grid max-h-72 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2 xl:grid-cols-3">
            {filteredItems.map((item) => (
              <label key={item.material_id} className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 hover:bg-muted/35">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-primary"
                  checked={selectedSet.has(item.material_id)}
                  disabled={!canEdit}
                  onChange={() => toggleItem(item.material_id)}
                />
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium">{item.name}</span>
                  <span className="text-[11px] text-muted-foreground">{item.type === "biaya" ? "Biaya Produksi" : "HPP"} · {item.unit}</span>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed p-4 text-[12px] text-muted-foreground">Item tidak ditemukan.</div>
        )}
        {!canEdit ? <p className="text-[11px] text-muted-foreground">Role kamu hanya dapat melihat pilihan item APK.</p> : null}
      </div>
    </section>
  );
}

function StockOpnameBahanBakuPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlOutletId = searchParams.get("outlet");
  const topbarOutletId = useAppStore((state) => state.selectedOutletId);
  const inventoryOutletFilter = urlOutletId || (topbarOutletId !== "all" ? topbarOutletId : undefined);
  const { opnames, isLoading, outlets, selectedOutletId, session } = useInventoryPage(inventoryOutletFilter);
  const [edits, setEdits] = useState({});
  const [exportMaterialIds, setExportMaterialIds] = useState([]);
  const [exportKeyword, setExportKeyword] = useState("");
  const canCreateInventory = can(session, "inventory.opnames", "create");
  const canExportInventory = can(session, "inventory.opnames", "export");
  const canApproveInventory = can(session, "inventory.opnames", "approve");
  const canRejectInventory = can(session, "inventory.opnames", "reject");
  const createOpnameBatch = useCreateStockOpnameBatch();
  const approveOpnameRequest = useApproveStockOpnameRequest();
  const rejectOpnameRequest = useRejectStockOpnameRequest();
  const allowedOutlets = useMemo(
    () => outlets.filter((outlet) => outlet.status === "active" && session?.outlet_ids?.includes(outlet.id)),
    [outlets, session?.outlet_ids]
  );
  const fallbackOutletId = selectedOutletId && selectedOutletId !== "all" ? selectedOutletId : allowedOutlets[0]?.id || outlets[0]?.id || "";
  const worksheetOutletId = searchParams.get("outlet") || fallbackOutletId;
  const opnameDate = searchParams.get("date") || getDefaultOpnameDate();
  const highlightedMaterialId = searchParams.get("material");
  const worksheetQuery = useStockOpnameWorksheet({ outletId: worksheetOutletId, date: opnameDate });
  const opnameRequestFilters = useMemo(() => {
    const monthStart = opnameDate && /^\d{4}-\d{2}-\d{2}$/.test(opnameDate)
      ? `${opnameDate.slice(0, 8)}01`
      : undefined;
    return { outletId: worksheetOutletId, from: monthStart, to: opnameDate };
  }, [opnameDate, worksheetOutletId]);
  const opnameRequestsQuery = useStockOpnameRequests(opnameRequestFilters);
  const editPrefix = `${worksheetOutletId}:${opnameDate}:`;

  const rows = useMemo(
    () => {
      const worksheetRows = worksheetQuery.data?.rows || [];
      return worksheetRows.map((row) => {
        const key = getWorksheetEditKey(worksheetOutletId, opnameDate, row.material_id);
        return getEditedWorksheetRow(row, edits[key]);
      });
    },
    [edits, opnameDate, worksheetOutletId, worksheetQuery.data?.rows]
  );
  const stockOpnames = useMemo(() => opnames, [opnames]);
  const worksheetSummary = useMemo(
    () => ({
      total_items: rows.length,
      match_items: rows.filter((row) => Math.abs(Number(row.difference || 0)) < 0.001).length,
      missing_items: rows.filter((row) => Number(row.difference || 0) > 0).length,
      total_missing_quantity: rows.reduce((total, row) => total + Math.max(Number(row.difference || 0), 0), 0),
      total_loss_amount: rows.reduce((total, row) => total + Number(row.loss_amount || 0), 0)
    }),
    [rows]
  );
  const visibleMaterialIds = useMemo(() => new Set(rows.map((row) => row.material_id)), [rows]);
  const exportSelectedSet = useMemo(
    () => new Set(exportMaterialIds.filter((materialId) => visibleMaterialIds.has(materialId))),
    [exportMaterialIds, visibleMaterialIds]
  );
  const exportRows = useMemo(
    () => rows.filter((row) => !exportSelectedSet.size || exportSelectedSet.has(row.material_id)),
    [exportSelectedSet, rows]
  );
  const exportSelectedRows = useMemo(
    () => rows.filter((row) => exportSelectedSet.has(row.material_id)),
    [exportSelectedSet, rows]
  );
  const filteredExportOptions = useMemo(() => {
    const keyword = exportKeyword.trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter((row) => `${row.name || row.material?.name || ""} ${row.unit || ""}`.toLowerCase().includes(keyword));
  }, [exportKeyword, rows]);
  const filteredExportOptionIds = useMemo(
    () => filteredExportOptions.map((row) => row.material_id),
    [filteredExportOptions]
  );
  const allFilteredExportSelected = Boolean(filteredExportOptionIds.length) && filteredExportOptionIds.every((materialId) => exportSelectedSet.has(materialId));
  const exportSelectionLabel = exportSelectedSet.size
    ? `${exportRows.length} dari ${rows.length} item dipilih`
    : rows.length
      ? `Semua ${rows.length} item yang tampil`
      : "Belum ada item";
  const exportSelectionNames = exportSelectedRows
    .slice(0, 4)
    .map((row) => row.name || row.material?.name)
    .filter(Boolean);
  const exportSelectionDetail = exportSelectedSet.size
    ? `${exportSelectionNames.join(", ")}${exportSelectedRows.length > exportSelectionNames.length ? ` +${exportSelectedRows.length - exportSelectionNames.length} lainnya` : ""}`
    : "Kosongkan pilihan untuk export semua item yang sedang tampil di worksheet.";

  function updateWorksheetParams(nextValues) {
    const params = new globalThis.URLSearchParams(searchParams);
    Object.entries(nextValues).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
    if (nextValues.outlet || nextValues.date) params.delete("material");
    if (nextValues.outlet || nextValues.date) {
      setExportMaterialIds([]);
      setExportKeyword("");
    }
    setSearchParams(params, { replace: true });
  }

  function updateDamage(row, value) {
    const key = getWorksheetEditKey(worksheetOutletId, opnameDate, row.material_id);
    const damageQuantity = Number(value || 0);
    const nextRealSystemQuantity = calculateRealSystem(row, damageQuantity);

    setEdits((current) => {
      const currentEdit = current[key] || {};
      return {
        ...current,
        [key]: {
          ...currentEdit,
          damage_quantity: damageQuantity,
          actual_quantity: currentEdit.actual_touched ? currentEdit.actual_quantity : Math.max(nextRealSystemQuantity, 0)
        }
      };
    });
  }

  function updateActual(row, value) {
    const key = getWorksheetEditKey(worksheetOutletId, opnameDate, row.material_id);
    setEdits((current) => ({
      ...current,
      [key]: {
        ...(current[key] || {}),
        actual_quantity: Number(value || 0),
        actual_touched: true
      }
    }));
  }

  async function saveWorksheet() {
    await createOpnameBatch.mutateAsync({
      outlet_id: worksheetOutletId,
      opname_date: opnameDate,
      created_by: session?.id,
      rows: rows.map((row) => ({
        material_id: row.material_id,
        opening_quantity: row.opening_quantity,
        purchase_quantity: getStockOpnameMovements(row).purchaseQuantity,
        transfer_in_quantity: getStockOpnameMovements(row).transferInQuantity,
        incoming_quantity: row.incoming_quantity,
        transfer_quantity: row.transfer_quantity,
        transfer_out_quantity: row.transfer_out_quantity,
        damage_quantity: row.damage_quantity,
        computed_sales_quantity: row.computed_sales_quantity,
        actual_quantity: row.actual_quantity,
        unit_price: row.unit_price,
        status: row.status,
        note: row.note
      }))
    });

    setEdits((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(editPrefix)))
    );
  }

  async function approveRequest(request) {
    await approveOpnameRequest.mutateAsync({
      id: request.id,
      payload: { approved_by: session?.id }
    });
  }

  async function rejectRequest(request, reason) {
    await rejectOpnameRequest.mutateAsync({
      id: request.id,
      payload: { rejection_note: reason, rejected_by: session?.id }
    });
  }

  function toggleExportMaterial(materialId) {
    setExportMaterialIds((current) =>
      current.includes(materialId) ? current.filter((id) => id !== materialId) : [...current, materialId]
    );
  }

  function selectFilteredExportMaterials() {
    setExportMaterialIds((current) => Array.from(new Set([...current, ...filteredExportOptionIds])));
  }

  function clearFilteredExportMaterials() {
    setExportMaterialIds((current) => current.filter((materialId) => !filteredExportOptionIds.includes(materialId)));
  }

  function exportWorksheet() {
    const outletName = outlets.find((outlet) => outlet.id === worksheetOutletId)?.name || "outlet";
    exportRowsToXlsx({
      filename: `stock-opname-${getExportFilePart(outletName)}-${opnameDate}`,
      sheetName: "Stock Opname",
      rows: exportRows,
      columns: [
        { header: "No", value: (row, index) => row.no || index + 1 },
        { header: "Nama Produk", value: (row) => row.name || row.material?.name || "" },
        { header: "Type", value: (row) => (row.material?.type === "biaya" ? "Biaya Produksi" : "HPP") },
        { header: "Harga", value: (row) => Number(row.unit_price || 0) },
        { header: "Satuan", value: (row) => row.unit || "" },
        { header: "Stok Awal", value: (row) => Number(row.opening_quantity || 0) },
        { header: "Pembelian", value: (row) => getStockOpnameMovements(row).purchaseQuantity },
        { header: "Transfer Masuk", value: (row) => getStockOpnameMovements(row).transferInQuantity },
        { header: "Transfer Keluar", value: (row) => getStockOpnameMovements(row).transferOutQuantity },
        { header: "Penjualan Bersih", value: (row) => getStockOpnameMovements(row).salesQuantity },
        { header: "Rusak", value: (row) => Number(row.damage_quantity || 0) },
        { header: "Sisa Sistem", value: (row) => Number(row.real_system_quantity || 0) },
        { header: "Sisa Stok Gudang", value: (row) => Number(row.actual_quantity || 0) },
        { header: "Selisih", value: (row) => formatStockQty(row.difference, row.unit) },
        { header: "Total Harga Kehilangan", value: (row) => Number(row.loss_amount || 0) },
        { header: "Keterangan", value: (row) => getOpnameStatusLabel(row.status, row.difference) }
      ]
    });
    adminApi
      .createActivityLog({
        module: "stock_opname",
        action: "stock_opname/export_xlsx",
        entity_type: "stock_opname_worksheet",
        entity_id: `${worksheetOutletId}:${opnameDate}`,
        outlet_id: worksheetOutletId,
        description: `Export worksheet stock opname ${outletName}.`,
        metadata_json: {
          opname_date: opnameDate,
          row_count: exportRows.length,
          selected_material_count: exportSelectedSet.size
        }
      })
      .catch(() => {});
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard title="Total Item" value={worksheetSummary.total_items} description="Semua tipe yang punya stok outlet" icon={PackageOpen} tone="blue" />
        <MetricCard title="Item Pas" value={worksheetSummary.match_items} description="Tidak ada selisih" icon={CheckCircle2} tone="green" />
        <MetricCard title="Selisih Hilang" value={formatNumber(worksheetSummary.total_missing_quantity)} description={`${worksheetSummary.missing_items} item perlu cek`} icon={AlertTriangle} tone="danger" />
        <MetricCard title="Nilai Kehilangan" value={formatCurrency(worksheetSummary.total_loss_amount)} description="Estimasi harga terakhir" icon={Scale} tone="gold" />
      </div>

      {worksheetOutletId ? (
        <StockOpnameApkMaterialSelection
          canEdit={canCreateInventory}
          outletId={worksheetOutletId}
          outlets={allowedOutlets.length ? allowedOutlets : outlets}
          onOutletChange={(value) => updateWorksheetParams({ outlet: value })}
        />
      ) : null}

      <section className="rounded-lg border bg-card shadow-soft">
        <div className="space-y-3 border-b p-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">Worksheet Stock Opname</h2>
            <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-muted-foreground">
              Sisa Sistem = Stok Awal + Pembelian + Transfer Masuk - Transfer Keluar - Penjualan Bersih - Rusak.
              Status dihitung otomatis dari selisih sistem dan fisik.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Select value={worksheetOutletId} onValueChange={(value) => updateWorksheetParams({ outlet: value })}>
              <SelectTrigger className="h-9 w-full sm:w-[220px]">
                <SelectValue placeholder="Pilih outlet" />
              </SelectTrigger>
              <SelectContent>
                {(allowedOutlets.length ? allowedOutlets : outlets).map((outlet) => (
                  <SelectItem key={outlet.id} value={outlet.id}>
                    {outlet.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DatePicker value={opnameDate} onChange={(value) => updateWorksheetParams({ date: value })} className="h-9 w-full sm:w-[180px]" />
            {canExportInventory ? (
              <>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" className="h-9 w-full justify-start px-3 sm:w-[240px]">
                      <Search className="shrink-0" />
                      <span className="truncate">
                        {exportSelectedSet.size ? `${exportSelectedSet.size} produk dipilih` : "Filter export produk"}
                      </span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[320px] p-3" align="end">
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="export-material-search">Produk diexport</Label>
                        <Input
                          id="export-material-search"
                          value={exportKeyword}
                          onChange={(event) => setExportKeyword(event.target.value)}
                          placeholder="Cari produk"
                        />
                      </div>
                      <div className="rounded-md border bg-muted/20 px-3 py-2">
                        <p className="text-[11px] font-medium text-muted-foreground">Target export</p>
                        <p className="mt-0.5 text-[12px] font-semibold">{exportSelectionLabel}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">{exportSelectionDetail}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={allFilteredExportSelected ? clearFilteredExportMaterials : selectFilteredExportMaterials}
                          disabled={!filteredExportOptionIds.length}
                        >
                          {allFilteredExportSelected ? "Lepas hasil cari" : "Pilih hasil cari"}
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setExportMaterialIds([])} disabled={!exportSelectedSet.size}>
                          <X />
                          Export semua
                        </Button>
                      </div>
                      <div className="max-h-64 overflow-y-auto rounded-md border">
                        {filteredExportOptions.length ? (
                          filteredExportOptions.map((row) => (
                            <label key={row.material_id} className="flex cursor-pointer items-center gap-2 border-b px-3 py-2 text-[12px] last:border-b-0 hover:bg-muted/45">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-primary"
                                checked={exportSelectedSet.has(row.material_id)}
                                onChange={() => toggleExportMaterial(row.material_id)}
                              />
                              <span className="min-w-0 flex-1 truncate">{row.name || row.material?.name || "-"}</span>
                              <span className="shrink-0 text-muted-foreground">{row.unit}</span>
                            </label>
                          ))
                        ) : (
                          <div className="px-3 py-4 text-[12px] text-muted-foreground">Produk tidak ditemukan.</div>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] text-muted-foreground">
                          Kosong berarti export semua produk yang tampil.
                        </p>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-full whitespace-nowrap px-3 sm:w-auto"
                  onClick={exportWorksheet}
                  disabled={worksheetQuery.isLoading || !exportRows.length}
                >
                  <Download className="shrink-0" />
                  {exportSelectedSet.size ? `Export ${exportRows.length} Item` : "Export Semua XLSX"}
                </Button>
              </>
            ) : null}
            {canCreateInventory ? (
              <Button
                className="h-9 w-full whitespace-nowrap px-3 sm:w-auto"
                onClick={saveWorksheet}
                disabled={createOpnameBatch.isPending || worksheetQuery.isLoading || !rows.length}
              >
                <Save className="shrink-0" />
                <span>{createOpnameBatch.isPending ? "Menyimpan..." : "Simpan Opname"}</span>
              </Button>
            ) : null}
          </div>
        </div>

        {!canCreateInventory ? (
          <div className="border-b bg-muted/25 px-4 py-3 text-[12px] text-muted-foreground">
            Role kamu bisa melihat worksheet, tapi tidak punya akses menyimpan stock opname.
          </div>
        ) : null}

        {canExportInventory ? (
          <div className="flex flex-col gap-1 border-b bg-muted/15 px-4 py-3 text-[12px] sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <span className="font-medium text-foreground">Target export: </span>
              <span className="text-muted-foreground">{exportSelectionLabel}</span>
              <p className="mt-1 truncate text-[11px] text-muted-foreground">{exportSelectionDetail}</p>
            </div>
            {exportSelectedSet.size ? (
              <Button type="button" variant="ghost" size="sm" className="h-7 self-start sm:self-center" onClick={() => setExportMaterialIds([])}>
                <X />
                Reset export
              </Button>
            ) : null}
          </div>
        ) : null}

        {worksheetQuery.isLoading ? (
          <div className="p-4 text-[12px] text-muted-foreground">Memuat worksheet...</div>
        ) : !worksheetOutletId ? (
          <div className="p-4 text-[12px] text-muted-foreground">Pilih outlet untuk membuat worksheet opname.</div>
        ) : rows.length ? (
          <Table className="min-w-[1880px]">
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="w-14">No</TableHead>
                <TableHead className="sticky left-0 z-10 min-w-56 bg-muted/40">Nama Produk</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Harga</TableHead>
                <TableHead>Satuan</TableHead>
                <TableHead>Stok Awal</TableHead>
                <TableHead>Pembelian</TableHead>
                <TableHead>Transfer Masuk</TableHead>
                <TableHead>Transfer Keluar</TableHead>
                <TableHead>Penjualan Bersih</TableHead>
                <TableHead>Rusak</TableHead>
                <TableHead>Sisa Sistem</TableHead>
                <TableHead>Sisa Stok Gudang</TableHead>
                <TableHead>Selisih</TableHead>
                <TableHead>Total Harga Kehilangan</TableHead>
                <TableHead>Keterangan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const isHighlighted = highlightedMaterialId === row.material_id;
                const differenceVariant = opnameStatusMeta[row.status || getWorksheetStatus(row.difference)]?.variant || "success";

                return (
                  <TableRow key={row.id || row.material_id} className={isHighlighted ? "bg-primary/10 hover:bg-primary/15" : undefined}>
                    <TableCell>{row.no || "-"}</TableCell>
                    <TableCell className={cn("sticky left-0 z-10 min-w-56 bg-card font-medium", isHighlighted && "bg-[#E6EEC9]")}>
                      {row.name || row.material?.name || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.material?.type === "biaya" ? "warning" : "info"}>
                        {row.material?.type === "biaya" ? "Biaya Produksi" : "HPP"}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatCurrency(row.unit_price)}</TableCell>
                    <TableCell>{row.unit}</TableCell>
                    <TableCell>{formatNumber(row.opening_quantity)}</TableCell>
                    <TableCell>{formatNumber(getStockOpnameMovements(row).purchaseQuantity)}</TableCell>
                    <TableCell>{formatNumber(getStockOpnameMovements(row).transferInQuantity)}</TableCell>
                    <TableCell className="text-destructive">
                      {formatNumber(getStockOpnameMovements(row).transferOutQuantity)}
                    </TableCell>
                    <TableCell>{formatNumber(getStockOpnameMovements(row).salesQuantity)}</TableCell>
                    <TableCell className="w-28">
                      <FormattedNumberInput
                        allowDecimal
                        value={row.damage_quantity}
                        onChange={(value) => updateDamage(row, value)}
                        disabled={!canCreateInventory}
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell className="font-medium">{formatNumber(row.real_system_quantity)}</TableCell>
                    <TableCell className="w-32">
                      <FormattedNumberInput
                        allowDecimal
                        value={row.actual_quantity}
                        onChange={(value) => updateActual(row, value)}
                        disabled={!canCreateInventory}
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant={differenceVariant}>{formatStockQty(row.difference, row.unit)}</Badge>
                    </TableCell>
                    <TableCell className={row.loss_amount ? "font-medium text-destructive" : "text-muted-foreground"}>
                      {formatCurrency(row.loss_amount)}
                    </TableCell>
                    <TableCell className="min-w-52">
                      <OpnameStatusBadge status={row.status} difference={row.difference} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="p-4 text-[12px] text-muted-foreground">Belum ada stok produk untuk outlet ini.</div>
        )}
      </section>

      <StockOpnameRequestSection
        canApprove={canApproveInventory}
        canReject={canRejectInventory}
        isApproving={approveOpnameRequest.isPending}
        isLoading={opnameRequestsQuery.isLoading}
        isRejecting={rejectOpnameRequest.isPending}
        requests={opnameRequestsQuery.data || []}
        onApprove={approveRequest}
        onReject={rejectRequest}
      />

      <StockOpnameHistory isLoading={isLoading} opnames={stockOpnames} />
    </div>
  );
}

function StockOpnameProdukPage() {
  return (
    <div className="rounded-lg border bg-card p-8 text-center shadow-soft">
      <Badge variant="warning">Fase Lanjut</Badge>
      <h2 className="mt-4 text-[18px] font-semibold">Stock Opname Produk</h2>
      <p className="mx-auto mt-2 max-w-lg text-muted-foreground">
        Sesuai PRD, fitur ini disiapkan sebagai placeholder MVP dan tidak menghalangi flow stok harga pokok produksi.
      </p>
    </div>
  );
}

export { PembelianBahanBakuPage, StockOpnameBahanBakuPage, StockOpnameProdukPage, StokBahanBakuPage, TransferStokPage };
