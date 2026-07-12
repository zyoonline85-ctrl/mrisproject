import { useEffect, useMemo, useState } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { Plus, Trash2, Loader2, Calendar, ShoppingBag, Receipt, CreditCard, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { FormattedNumberInput } from "@/components/ui/formatted-number-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useMasterData, useCreateTransaction } from "@/hooks/useAdminQueries";
import { useAppStore } from "@/store/appStore";
import { formatCurrency, createRuntimeId } from "@/lib/utils";

export function InvoicePage() {
  const toast = useToast();
  const selectedOutletId = useAppStore((state) => state.selectedOutletId);
  const session = useAppStore((state) => state.session);
  const createTransactionMutation = useCreateTransaction();

  // Load master data
  const { data: masterData, isLoading } = useMasterData({ outletId: selectedOutletId });
  const products = masterData?.products || [];
  const customers = masterData?.customers || [];
  const outlets = masterData?.outlets || [];
  const paymentMethods = masterData?.payment_methods || [];
  const discounts = masterData?.discounts || [];
  const tables = masterData?.tables || [];

  const activeOutlets = useMemo(() => outlets.filter((o) => o.status === "active"), [outlets]);
  const activePaymentMethods = useMemo(() => paymentMethods.filter((p) => p.status === "active"), [paymentMethods]);
  const activeDiscounts = useMemo(() => discounts.filter((d) => d.status === "active"), [discounts]);

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

  // Add item handler
  const [selectedProductId, setSelectedProductId] = useState("");
  const handleAddItem = () => {
    if (!selectedProductId) return;
    const product = products.find((p) => p.id === selectedProductId);
    if (!product) return;

    // Check duplicate
    const existsIndex = watchItems.findIndex((item) => item.productId === selectedProductId);
    if (existsIndex > -1) {
      const currentQty = Number(watchItems[existsIndex].quantity || 0);
      setValue(`items.${existsIndex}.quantity`, currentQty + 1);
    } else {
      append({
        productId: product.id,
        name: product.name,
        unit: product.unit || "pcs",
        price: Number(product.price || 0),
        quantity: 1
      });
    }
    setSelectedProductId("");
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

    // Build payload to POS standard
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
        subtotal: Number(item.price) * Number(item.quantity)
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
    } catch (err) {
      // React query useAdminMutation already handles toast alerts
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
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
          <Card className="shadow-soft">
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
          <Card className="shadow-soft">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-primary" /> Daftar Item Penjualan
              </CardTitle>
              <CardDescription>Pilih produk dan masukkan kuantitas.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Product Selector */}
              <div className="flex gap-2 items-end">
                <div className="flex-1 space-y-2">
                  <Label>Cari Produk</Label>
                  <Select onValueChange={setSelectedProductId} value={selectedProductId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih Produk untuk Ditambahkan..." />
                    </SelectTrigger>
                    <SelectContent>
                      {products.filter((p) => p.status === "active").map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.name} ({formatCurrency(product.price)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="button" onClick={handleAddItem} className="flex gap-1 items-center">
                  <Plus className="h-4 w-4" /> Tambah
                </Button>
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
  );
}
