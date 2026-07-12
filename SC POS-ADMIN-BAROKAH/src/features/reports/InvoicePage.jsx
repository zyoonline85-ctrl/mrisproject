import { useEffect, useMemo, useState } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { Plus, Trash2, Loader2, Calendar, ShoppingBag, Receipt, CreditCard, Tag, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { FormattedNumberInput } from "@/components/ui/formatted-number-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMasterData, useCreateTransaction, useReports } from "@/hooks/useAdminQueries";
import { useAppStore } from "@/store/appStore";
import { formatCurrency, formatDateTime } from "@/lib/utils";

function createRuntimeId(prefix) {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${randomStr}`;
}

const getProductPriceForOutlet = (product, outletId) => {
  const prices = product?.all_prices || product?.prices || [];
  const activePrice = prices.find(
    (p) => p.outlet_id === outletId && p.status !== "inactive" && Number(p.price || 0) > 0
  );
  return activePrice ? Number(activePrice.price) : 0;
};

export function InvoicePage() {
  const toast = useToast();
  const selectedOutletId = useAppStore((state) => state.selectedOutletId);
  const session = useAppStore((state) => state.session);
  const createTransactionMutation = useCreateTransaction();

  // Load master data
  const { data: masterData, isLoading: isMasterLoading } = useMasterData({ outletId: selectedOutletId });
  const products = masterData?.products || [];
  const customers = masterData?.customers || [];
  const outlets = masterData?.outlets || [];
  const paymentMethods = masterData?.payment_methods || [];
  const discounts = masterData?.discounts || [];
  const tables = masterData?.tables || [];

  const activeOutlets = useMemo(() => outlets.filter((o) => o.status === "active"), [outlets]);
  const activePaymentMethods = useMemo(() => paymentMethods.filter((p) => p.status === "active"), [paymentMethods]);
  const activeDiscounts = useMemo(() => discounts.filter((d) => d.status === "active"), [discounts]);

  // Load recent reports for transaction history table
  const today = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(today.getDate() - 30);

  const reportFilters = useMemo(() => ({
    outletId: selectedOutletId === "all" ? "" : selectedOutletId,
    from: thirtyDaysAgo.toISOString().split("T")[0],
    to: today.toISOString().split("T")[0]
  }), [selectedOutletId]);

  const { data: reportsData, isLoading: isReportsLoading, refetch: refetchReports } = useReports(reportFilters);
  const transactions = reportsData?.transactions || [];

  // Filter transactions where note is "Input manual"
  const manualInvoices = useMemo(() => {
    return transactions.filter(
      (t) => String(t.note || "").toLowerCase() === "input manual"
    ).sort((a, b) => new Date(b.transaction_date || b.operational_at) - new Date(a.transaction_date || a.operational_at));
  }, [transactions]);

  // Form setup
  const { register, control, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm({
    defaultValues: {
      outletId: selectedOutletId === "all" ? "" : selectedOutletId,
      customerId: "",
      serviceType: "takeaway",
      tableNumber: "",
      operationalAt: new Date(),
      items: [],
      discountId: "",
      discountType: "nominal",
      discountValue: 0,
      tax: 0,
      paymentMethod: "cash",
      paidAmount: 0
    }
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items"
  });

  const watchOutletId = watch("outletId");
  const watchServiceType = watch("serviceType");
  const watchItems = watch("items") || [];
  const watchDiscountId = watch("discountId");
  const watchDiscountType = watch("discountType");
  const watchDiscountValue = watch("discountValue");
  const watchTax = watch("tax") || 0;
  const watchPaidAmount = watch("paidAmount") || 0;

  // Filter tables by selected outlet
  const filteredTables = useMemo(() => {
    if (!watchOutletId) return [];
    return tables.filter((t) => t.outlet_id === watchOutletId && t.status === "active");
  }, [tables, watchOutletId]);

  // Sync default outlet
  useEffect(() => {
    if (selectedOutletId && selectedOutletId !== "all") {
      setValue("outletId", selectedOutletId);
    }
  }, [selectedOutletId, setValue]);

  // Compute subtotal
  const subtotal = useMemo(() => {
    return watchItems.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)), 0);
  }, [watchItems]);

  // Compute discount
  const discountAmount = useMemo(() => {
    if (watchDiscountId) {
      const selectedDiscount = activeDiscounts.find((d) => d.id === watchDiscountId);
      if (!selectedDiscount) return 0;
      const value = Number(selectedDiscount.value || 0);
      return selectedDiscount.type === "percent"
        ? Math.round((subtotal * value) / 100)
        : Math.round(value);
    } else {
      if (watchDiscountValue <= 0) return 0;
      return watchDiscountType === "percent"
        ? Math.round((subtotal * watchDiscountValue) / 100)
        : Math.round(watchDiscountValue);
    }
  }, [watchDiscountId, watchDiscountType, watchDiscountValue, subtotal, activeDiscounts]);

  // Total Akhir
  const total = useMemo(() => {
    return Math.max(0, subtotal - discountAmount + Number(watchTax));
  }, [subtotal, discountAmount, watchTax]);

  // Change amount
  const changeAmount = useMemo(() => {
    return Math.max(0, Number(watchPaidAmount) - total);
  }, [watchPaidAmount, total]);

  // Set paidAmount to total automatically if not cash
  const watchPaymentMethod = watch("paymentMethod");
  useEffect(() => {
    if (watchPaymentMethod !== "cash") {
      setValue("paidAmount", total);
    }
  }, [watchPaymentMethod, total, setValue]);

  // Product selection and variants states
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedVariantIds, setSelectedVariantIds] = useState([]);

  const filteredProductsByOutlet = useMemo(() => {
    if (!watchOutletId) return [];
    return products.filter((product) => {
      if (product.status !== "active") return false;
      const price = getProductPriceForOutlet(product, watchOutletId);
      return price > 0;
    });
  }, [products, watchOutletId]);

  const currentSelectedProduct = useMemo(() => {
    return products.find((p) => p.id === selectedProductId);
  }, [products, selectedProductId]);

  const activeVariants = useMemo(() => {
    if (!currentSelectedProduct) return [];
    return (currentSelectedProduct.variants || []).filter((v) => v.status === "active");
  }, [currentSelectedProduct]);

  // Reset selected variants when selected product changes
  useEffect(() => {
    setSelectedVariantIds([]);
  }, [selectedProductId]);

  // Recalculate existing item prices in the cart if the outlet changes
  useEffect(() => {
    if (!watchOutletId || !watchItems.length) return;
    watchItems.forEach((item, index) => {
      const product = products.find((p) => p.id === item.productId);
      if (product) {
        const basePrice = getProductPriceForOutlet(product, watchOutletId);
        if (basePrice > 0) {
          const selectedVariantsObj = (product.variants || []).filter((v) => (item.variantIds || []).includes(v.id));
          const variantPriceDelta = selectedVariantsObj.reduce((sum, v) => sum + Number(v.price_delta || 0), 0);
          const finalUnitPrice = basePrice + variantPriceDelta;
          if (Number(item.price) !== finalUnitPrice) {
            setValue(`items.${index}.price`, finalUnitPrice);
          }
        }
      }
    });
  }, [watchOutletId, products, setValue]);

  const handleAddItem = () => {
    if (!selectedProductId || !currentSelectedProduct) return;

    // Get selected variants objects and compute price delta
    const selectedVariantsObj = activeVariants.filter((v) => selectedVariantIds.includes(v.id));
    const variantPriceDelta = selectedVariantsObj.reduce((sum, v) => sum + Number(v.price_delta || 0), 0);

    // Get product price at selected outlet
    const basePrice = getProductPriceForOutlet(currentSelectedProduct, watchOutletId);
    const finalUnitPrice = basePrice + variantPriceDelta;

    const identityKey = `${selectedProductId}:${[...selectedVariantIds].sort().join(",")}`;

    // Check duplicate
    const existsIndex = watchItems.findIndex(
      (item) => `${item.productId}:${[...(item.variantIds || [])].sort().join(",")}` === identityKey
    );

    if (existsIndex > -1) {
      const currentQty = Number(watchItems[existsIndex].quantity || 0);
      setValue(`items.${existsIndex}.quantity`, currentQty + 1);
    } else {
      append({
        productId: currentSelectedProduct.id,
        name: currentSelectedProduct.name,
        unit: currentSelectedProduct.unit || "pcs",
        price: finalUnitPrice,
        quantity: 1,
        variantIds: selectedVariantIds,
        selectedVariants: selectedVariantsObj.map((v) => ({
          id: v.id,
          name: v.name,
          price_delta: Number(v.price_delta || 0)
        }))
      });
    }

    setSelectedProductId("");
    setSelectedVariantIds([]);
  };

  const onSubmit = async (formData) => {
    if (!formData.items.length) {
      toast({
        title: "Keranjang Kosong",
        description: "Tambahkan minimal satu produk untuk membuat invoice.",
        variant: "destructive"
      });
      return;
    }

    if (formData.serviceType === "dine_in" && !formData.tableNumber) {
      toast({
        title: "Meja Belum Dipilih",
        description: "Nomor meja wajib diisi jika tipe layanan Dine In.",
        variant: "destructive"
      });
      return;
    }

    if (Number(formData.paidAmount) < total) {
      toast({
        title: "Pembayaran Kurang",
        description: "Jumlah bayar tidak boleh kurang dari total tagihan.",
        variant: "destructive"
      });
      return;
    }

    // Build payload matching POS standard structure
    const payload = {
      id: createRuntimeId("trx"),
      clientRef: createRuntimeId("client_ref"),
      outletId: formData.outletId,
      customerId: formData.customerId === "umum" || !formData.customerId ? null : formData.customerId,
      serviceType: formData.serviceType,
      tableNumber: formData.serviceType === "dine_in" ? formData.tableNumber : null,
      operationalAt: formData.operationalAt.toISOString(),
      subtotal,
      discountId: formData.discountId === "no_discount" || !formData.discountId ? null : formData.discountId,
      discountType: formData.discountId && formData.discountId !== "no_discount" ? null : formData.discountType,
      discountValue: formData.discountId && formData.discountId !== "no_discount" ? 0 : Number(formData.discountValue),
      discount: discountAmount,
      tax: Number(formData.tax),
      total,
      note: "Input manual", // Hardcoded note as requested
      paymentMethod: formData.paymentMethod,
      payments: [
        {
          method: formData.paymentMethod,
          amount: Number(formData.paidAmount),
          change_amount: changeAmount
        }
      ],
      items: formData.items.map((item) => ({
        productId: item.productId,
        quantity: Number(item.quantity),
        unitPrice: Number(item.price),
        subtotal: Number(item.price) * Number(item.quantity),
        selectedVariants: item.selectedVariants || [] // metadata JSON target
      }))
    };

    try {
      await createTransactionMutation.mutateAsync(payload);
      reset({
        outletId: selectedOutletId === "all" ? "" : selectedOutletId,
        customerId: "",
        serviceType: "takeaway",
        tableNumber: "",
        operationalAt: new Date(),
        items: [],
        discountId: "",
        discountType: "nominal",
        discountValue: 0,
        tax: 0,
        paymentMethod: "cash",
        paidAmount: 0
      });
      refetchReports();
    } catch (err) {
      // React query hook handles error toast notification
    }
  };

  // Transaction details modal state
  const [detailTransaction, setDetailTransaction] = useState(null);

  const getOutletName = (outletId) => {
    return outlets.find((o) => o.id === outletId)?.name || outletId || "-";
  };

  if (isMasterLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Invoice Penjualan</h1>
            <p className="text-sm text-muted-foreground">Entri manual transaksi penjualan langsung dari admin panel.</p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left Form: Transaction details */}
          <div className="space-y-6 lg:col-span-1">
            <Card className="shadow-soft border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-primary" /> Detail Transaksi
                </CardTitle>
                <CardDescription>Masukkan rincian informasi pemesanan.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Outlet Selection */}
                <div className="space-y-2">
                  <Label htmlFor="outletId">Outlet Jual</Label>
                  <Controller
                    control={control}
                    name="outletId"
                    rules={{ required: "Outlet wajib dipilih" }}
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger>
                          <SelectValue placeholder="Pilih Outlet" />
                        </SelectTrigger>
                        <SelectContent>
                          {activeOutlets.map((outlet) => (
                            <SelectItem key={outlet.id} value={outlet.id}>
                              {outlet.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {errors.outletId && <p className="text-xs text-destructive">{errors.outletId.message}</p>}
                </div>

                {/* Transaction Date */}
                <div className="space-y-2 flex flex-col">
                  <Label htmlFor="operationalAt">Tanggal & Waktu Transaksi</Label>
                  <Controller
                    control={control}
                    name="operationalAt"
                    render={({ field }) => (
                      <DatePicker
                        date={field.value}
                        onDateChange={(date) => field.onChange(date || new Date())}
                        className="w-full"
                      />
                    )}
                  />
                </div>

                {/* Customer */}
                <div className="space-y-2">
                  <Label htmlFor="customerId">Customer</Label>
                  <Controller
                    control={control}
                    name="customerId"
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value || "umum"}>
                        <SelectTrigger>
                          <SelectValue placeholder="Pilih Customer (Umum)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="umum">Umum</SelectItem>
                          {customers.map((customer) => (
                            <SelectItem key={customer.id} value={customer.id}>
                              {customer.name} {customer.phone ? `(${customer.phone})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>

                {/* Service Type */}
                <div className="space-y-2">
                  <Label htmlFor="serviceType">Tipe Layanan</Label>
                  <Controller
                    control={control}
                    name="serviceType"
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="takeaway">Take Away (Bungkus)</SelectItem>
                          <SelectItem value="dine_in">Dine In (Makan di Sini)</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>

                {/* Table Number */}
                {watchServiceType === "dine_in" && (
                  <div className="space-y-2">
                    <Label htmlFor="tableNumber">Nomor Meja</Label>
                    <Controller
                      control={control}
                      name="tableNumber"
                      render={({ field }) => (
                        <Select onValueChange={field.onChange} value={field.value}>
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih Meja" />
                          </SelectTrigger>
                          <SelectContent>
                            {filteredTables.length ? (
                              filteredTables.map((table) => (
                                <SelectItem key={table.id} value={table.number}>
                                  Meja {table.number}
                                </SelectItem>
                              ))
                            ) : (
                              <SelectItem value="-" disabled>
                                Tidak ada meja aktif di outlet ini
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Form: Basket Items */}
          <div className="space-y-6 lg:col-span-2">
            <Card className="shadow-soft border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ShoppingBag className="h-4 w-4 text-primary" /> Daftar Item Penjualan
                </CardTitle>
                <CardDescription>Pilih produk, tentukan varian, dan masukkan kuantitas.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Product & Variant Selector */}
                <div className="space-y-3 p-3 bg-slate-50/50 border rounded-md">
                  <div className="flex gap-2 items-end">
                    <div className="flex-1 space-y-2">
                      <Label>Pilih Produk</Label>
                      <Select onValueChange={setSelectedProductId} value={selectedProductId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Pilih Produk..." />
                        </SelectTrigger>
                        <SelectContent>
                          {filteredProductsByOutlet.map((product) => {
                            const displayPrice = getProductPriceForOutlet(product, watchOutletId);
                            return (
                              <SelectItem key={product.id} value={product.id}>
                                {product.name} ({formatCurrency(displayPrice)})
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button type="button" onClick={handleAddItem} disabled={!selectedProductId} className="flex gap-1 items-center">
                      <Plus className="h-4 w-4" /> Tambah
                    </Button>
                  </div>

                  {/* Active Variants Selection Checklist */}
                  {activeVariants.length > 0 && (
                    <div className="space-y-2 pt-2 border-t">
                      <Label className="text-xs text-muted-foreground font-semibold">Pilih Varian (Opsional)</Label>
                      <div className="flex flex-wrap gap-2">
                        {activeVariants.map((variant) => {
                          const isChecked = selectedVariantIds.includes(variant.id);
                          return (
                            <label
                              key={variant.id}
                              className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                                isChecked
                                  ? "bg-primary/10 border-primary text-primary font-medium"
                                  : "bg-white hover:bg-slate-50 text-slate-700"
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="sr-only"
                                checked={isChecked}
                                onChange={(event) => {
                                  setSelectedVariantIds((ids) =>
                                    event.target.checked ? [...ids, variant.id] : ids.filter((id) => id !== variant.id)
                                  );
                                }}
                              />
                              {variant.name} {Number(variant.price_delta) > 0 ? `(+${formatCurrency(variant.price_delta)})` : ""}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Items Table */}
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nama Produk</TableHead>
                        <TableHead className="w-[120px]">Qty</TableHead>
                        <TableHead className="w-[180px]">Harga Satuan (Rp)</TableHead>
                        <TableHead className="w-[150px] text-right">Subtotal (Rp)</TableHead>
                        <TableHead className="w-[50px] text-center"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fields.length ? (
                        fields.map((field, index) => (
                          <TableRow key={field.id}>
                            <TableCell className="font-medium">
                              <div>{field.name}</div>
                              <div className="text-[11px] text-muted-foreground">Satuan: {field.unit}</div>
                              {field.selectedVariants?.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {field.selectedVariants.map((v) => (
                                    <Badge key={v.id || v.name} variant="info" className="text-[9px] px-1.5 py-0">
                                      {v.name}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min="1"
                                {...register(`items.${index}.quantity`, {
                                  required: true,
                                  min: 1,
                                  valueAsNumber: true
                                })}
                                className="h-8 w-20"
                              />
                            </TableCell>
                            <TableCell>
                              <Controller
                                control={control}
                                name={`items.${index}.price`}
                                render={({ field: inputField }) => (
                                  <FormattedNumberInput
                                    value={inputField.value}
                                    onValueChange={(val) => inputField.onChange(val || 0)}
                                    className="h-8"
                                  />
                                )}
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(Number(watchItems[index]?.price || 0) * Number(watchItems[index]?.quantity || 0))}
                            </TableCell>
                            <TableCell className="text-center">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => remove(index)}
                                className="text-destructive hover:bg-destructive/10 h-8 w-8"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={5} className="h-32 text-center text-muted-foreground text-sm">
                            Belum ada item terpilih. Silakan cari dan tambah produk di atas.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* Calculation Summary & Payment Section */}
                <div className="grid md:grid-cols-2 gap-6 pt-4 border-t">
                  {/* Left: Discounts and Taxes */}
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5"><Tag className="h-3.5 w-3.5 text-primary" /> Diskon Toko (Aktif)</Label>
                      <Controller
                        control={control}
                        name="discountId"
                        render={({ field }) => (
                          <Select
                            onValueChange={(val) => {
                              field.onChange(val);
                              if (val && val !== "no_discount") {
                                setValue("discountValue", 0);
                              }
                            }}
                            value={field.value}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Pilih Diskon Toko" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="no_discount">Tanpa Diskon Toko</SelectItem>
                              {activeDiscounts.map((discount) => (
                                <SelectItem key={discount.id} value={discount.id}>
                                  {discount.name} ({discount.type === "percent" ? `${discount.value}%` : formatCurrency(discount.value)})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </div>

                    {(!watchDiscountId || watchDiscountId === "no_discount") && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-2">
                          <Label>Tipe Diskon Manual</Label>
                          <Controller
                            control={control}
                            name="discountType"
                            render={({ field }) => (
                              <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="percent">Persen (%)</SelectItem>
                                  <SelectItem value="nominal">Nominal (Rp)</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Diskon Manual</Label>
                          <Controller
                            control={control}
                            name="discountValue"
                            render={({ field }) => (
                              <FormattedNumberInput
                                value={field.value}
                                onValueChange={(val) => field.onChange(val || 0)}
                              />
                            )}
                          />
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>Pajak Tambahan (Rp)</Label>
                      <Controller
                        control={control}
                        name="tax"
                        render={({ field }) => (
                          <FormattedNumberInput
                            value={field.value}
                            onValueChange={(val) => field.onChange(val || 0)}
                          />
                        )}
                      />
                    </div>
                  </div>

                  {/* Right: Subtotal, Total, Payment Method, Amount Paid */}
                  <div className="bg-muted/50 p-4 rounded-lg space-y-4">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Subtotal:</span>
                        <span className="font-semibold">{formatCurrency(subtotal)}</span>
                      </div>
                      <div className="flex justify-between text-destructive">
                        <span>Potongan Diskon:</span>
                        <span>-{formatCurrency(discountAmount)}</span>
                      </div>
                      {watchTax > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Pajak:</span>
                          <span>{formatCurrency(watchTax)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-base font-bold border-t pt-2 mt-2">
                        <span>Total Akhir:</span>
                        <span className="text-primary">{formatCurrency(total)}</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5"><CreditCard className="h-3.5 w-3.5 text-primary" /> Metode Pembayaran</Label>
                      <Controller
                        control={control}
                        name="paymentMethod"
                        render={({ field }) => (
                          <Select onValueChange={field.onChange} value={field.value}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {activePaymentMethods.map((method) => (
                                <SelectItem key={method.code} value={method.code}>
                                  {method.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </div>

                    {watchPaymentMethod === "cash" && (
                      <div className="space-y-2">
                        <Label>Nominal Dibayar (Rp)</Label>
                        <Controller
                          control={control}
                          name="paidAmount"
                          render={({ field }) => (
                            <FormattedNumberInput
                              value={field.value}
                              onValueChange={(val) => field.onChange(val || 0)}
                            />
                          )}
                        />
                      </div>
                    )}

                    <div className="flex justify-between text-sm font-semibold border-t pt-2">
                      <span className="text-muted-foreground">Kembalian:</span>
                      <span className="text-green-600 font-bold">{formatCurrency(changeAmount)}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Form Actions */}
            <div className="flex justify-end gap-2">
              <Button
                type="submit"
                disabled={createTransactionMutation.isPending}
                className="px-6 py-2 flex gap-2 items-center"
              >
                {createTransactionMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Menyimpan...
                  </>
                ) : (
                  "Simpan Invoice Jual"
                )}
              </Button>
            </div>
          </div>
        </div>
      </form>

      {/* BOTTOM SECTION: Table of Manual Invoices */}
      <Card className="shadow-soft border-slate-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="h-4 w-4 text-primary" /> Daftar Invoice Manual Terbaru
          </CardTitle>
          <CardDescription>Menampilkan daftar seluruh transaksi penjualan yang diinput secara manual dari admin panel.</CardDescription>
        </CardHeader>
        <CardContent>
          {isReportsLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : manualInvoices.length > 0 ? (
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead>Nomor Order</TableHead>
                    <TableHead>Waktu Transaksi</TableHead>
                    <TableHead>Outlet</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Tipe Layanan</TableHead>
                    <TableHead>Metode Bayar</TableHead>
                    <TableHead className="text-right">Total Belanja</TableHead>
                    <TableHead className="w-[80px] text-center"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {manualInvoices.map((trx) => {
                    const paymentsList = trx.payments || [];
                    const paymentMethodText = paymentsList.length
                      ? paymentsList.map((p) => p.method).join(" + ")
                      : trx.payment_method || "-";
                    return (
                      <TableRow key={trx.id} className="hover:bg-slate-50/50">
                        <TableCell className="font-semibold text-primary">{trx.order_number}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{formatDateTime(trx.transaction_date || trx.operational_at)}</TableCell>
                        <TableCell className="max-w-[150px] truncate">{getOutletName(trx.outlet_id)}</TableCell>
                        <TableCell>{trx.customer?.name || trx.customer_name || "Umum"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {trx.service_type === "dine_in" ? "Dine In" : "Take Away"}
                          </Badge>
                        </TableCell>
                        <TableCell className="capitalize text-xs">{paymentMethodText}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(trx.total)}</TableCell>
                        <TableCell className="text-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-primary"
                            onClick={() => setDetailTransaction(trx)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="h-24 flex items-center justify-center text-muted-foreground text-sm border border-dashed rounded-md">
              Belum ada data invoice manual untuk rentang tanggal terpilih.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transaction Detail Modal Dialog */}
      {detailTransaction && (
        <Dialog open={Boolean(detailTransaction)} onOpenChange={(open) => !open && setDetailTransaction(null)}>
          <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto border-slate-200">
            <DialogHeader>
              <DialogTitle>Detail Invoice Manual</DialogTitle>
              <DialogDescription>Rincian data transaksi penjualan manual.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-4 text-sm bg-slate-50 p-3 rounded-md">
                <div>
                  <div className="text-muted-foreground text-xs">Nomor Order</div>
                  <div className="font-semibold">{detailTransaction.order_number}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Waktu Pembuatan</div>
                  <div className="font-semibold">{formatDateTime(detailTransaction.transaction_date || detailTransaction.operational_at)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Outlet</div>
                  <div className="font-semibold">{getOutletName(detailTransaction.outlet_id)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Tipe Layanan</div>
                  <div className="font-semibold capitalize">{detailTransaction.service_type === "dine_in" ? `Dine In (Meja ${detailTransaction.table_number || "-"})` : "Take Away"}</div>
                </div>
              </div>

              <div>
                <Label className="text-xs font-semibold text-muted-foreground">Daftar Item</Label>
                <div className="border rounded-md overflow-hidden mt-1">
                  <Table>
                    <TableHeader className="bg-slate-50">
                      <TableRow>
                        <TableHead>Produk</TableHead>
                        <TableHead className="w-[80px] text-center">Qty</TableHead>
                        <TableHead className="text-right">Harga</TableHead>
                        <TableHead className="text-right">Subtotal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(detailTransaction.items || []).map((item, index) => {
                        let variantsList = [];
                        let metadata = item.metadata_json || {};
                        if (typeof metadata === "string") {
                          try { metadata = JSON.parse(metadata); } catch { metadata = {}; }
                        }
                        variantsList = item.selectedVariants || item.selected_variants || metadata.selected_variants || [];

                        return (
                          <TableRow key={item.id || index}>
                            <TableCell>
                              <div className="font-medium">{item.product?.name || item.product_name || `Produk ID: ${item.product_id}`}</div>
                              {variantsList.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {variantsList.map((v) => (
                                    <Badge key={v.id || v.name} variant="info" className="text-[9px] px-1 py-0">
                                      {v.name}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-center tabular-nums">{item.quantity}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatCurrency(item.unit_price)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatCurrency(item.subtotal)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="flex justify-end pt-2 border-t">
                <Button variant="outline" onClick={() => setDetailTransaction(null)}>
                  Tutup
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
