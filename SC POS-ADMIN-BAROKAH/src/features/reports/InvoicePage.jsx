import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { toDateString } from "@/lib/utils";
import {
  Plus,
  Trash2,
  Loader2,
  ShoppingCart,
  Receipt,
  CreditCard,
  Tag,
  Eye,
  Search,
  ChevronDown,
  X,
  CheckCircle2,
  AlertCircle,
  Store,
  Calendar,
  User,
  Utensils,
  Package,
  Pencil,
  Printer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { FormattedNumberInput } from "@/components/ui/formatted-number-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useMasterData,
  useCreateTransaction,
  useReports,
  useCancelTransaction,
} from "@/hooks/useAdminQueries";
import { useAppStore } from "@/store/appStore";
import { formatCurrency, formatDateTime } from "@/lib/utils";

// ─── helpers ────────────────────────────────────────────────────────────────

function createRuntimeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function getProductPriceForOutlet(product, outletId) {
  if (!product || !outletId) return 0;
  const prices = product.all_prices || product.prices || [];
  const match = prices.find(
    (p) =>
      p.outlet_id === outletId &&
      p.status !== "inactive" &&
      Number(p.price || 0) > 0
  );
  return match ? Number(match.price) : 0;
}

function serviceTypeLabel(type) {
  return type === "dine_in" ? "Dine In" : "Take Away";
}

// ─── Product Search Dropdown ────────────────────────────────────────────────

function ProductSearchDropdown({ products, outletId, onAdd }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedVariantIds, setSelectedVariantIds] = useState([]);
  const ref = useRef(null);

  // close on outside click
  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = useMemo(() => {
    if (!outletId) return [];
    return products
      .filter((p) => {
        if (p.status !== "active") return false;
        const price = getProductPriceForOutlet(p, outletId);
        if (price <= 0) return false;
        if (!query.trim()) return true;
        return p.name.toLowerCase().includes(query.toLowerCase());
      })
      .slice(0, 30);
  }, [products, outletId, query]);

  const activeVariants = useMemo(() => {
    if (!selectedProduct) return [];
    return (selectedProduct.variants || []).filter((v) => v.status === "active");
  }, [selectedProduct]);

  function handleSelectProduct(product) {
    setSelectedProduct(product);
    setSelectedVariantIds([]);
    setOpen(false);
    setQuery(product.name);
  }

  function handleAddToCart() {
    if (!selectedProduct) return;

    const basePrice = getProductPriceForOutlet(selectedProduct, outletId);
    const selectedVariantsObj = activeVariants.filter((v) =>
      selectedVariantIds.includes(v.id)
    );
    const variantDelta = selectedVariantsObj.reduce(
      (s, v) => s + Number(v.price_delta || 0),
      0
    );
    const finalPrice = basePrice + variantDelta;

    onAdd({
      productId: selectedProduct.id,
      name: selectedProduct.name,
      unit: selectedProduct.unit || "pcs",
      price: finalPrice,
      quantity: 1,
      variantIds: selectedVariantIds,
      selectedVariants: selectedVariantsObj.map((v) => ({
        id: v.id,
        name: v.name,
        price_delta: Number(v.price_delta || 0),
      })),
    });

    setQuery("");
    setSelectedProduct(null);
    setSelectedVariantIds([]);
  }

  function toggleVariant(id) {
    setSelectedVariantIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  const displayPrice = selectedProduct
    ? getProductPriceForOutlet(selectedProduct, outletId) +
      activeVariants
        .filter((v) => selectedVariantIds.includes(v.id))
        .reduce((s, v) => s + Number(v.price_delta || 0), 0)
    : 0;

  return (
    <div ref={ref} className="space-y-3">
      {/* search box */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-9 pr-9"
          placeholder={
            outletId ? "Cari nama produk..." : "Pilih outlet terlebih dahulu"
          }
          disabled={!outletId}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (!e.target.value) {
              setSelectedProduct(null);
              setSelectedVariantIds([]);
            }
          }}
          onFocus={() => outletId && setOpen(true)}
          autoComplete="off"
        />
        {query && (
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setQuery("");
              setSelectedProduct(null);
              setSelectedVariantIds([]);
              setOpen(false);
            }}
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {/* dropdown list */}
        {open && filtered.length > 0 && (
          <div className="absolute z-50 top-full mt-1 w-full bg-white border rounded-md shadow-lg max-h-56 overflow-y-auto">
            {filtered.map((p) => {
              const price = getProductPriceForOutlet(p, outletId);
              return (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex justify-between items-center gap-2 border-b last:border-0"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelectProduct(p);
                  }}
                >
                  <span className="font-medium truncate">{p.name}</span>
                  <span className="text-primary font-semibold shrink-0 text-xs">
                    {formatCurrency(price)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {open && outletId && filtered.length === 0 && query && (
          <div className="absolute z-50 top-full mt-1 w-full bg-white border rounded-md shadow py-3 text-center text-sm text-muted-foreground">
            Produk tidak ditemukan
          </div>
        )}
      </div>

      {/* variant selector */}
      {selectedProduct && activeVariants.length > 0 && (
        <div className="p-2 bg-slate-50 rounded-md border space-y-2">
          <p className="text-xs text-muted-foreground font-semibold">
            Pilih Varian (Opsional):
          </p>
          <div className="flex flex-wrap gap-1.5">
            {activeVariants.map((v) => {
              const checked = selectedVariantIds.includes(v.id);
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => toggleVariant(v.id)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                    checked
                      ? "bg-primary text-white border-primary"
                      : "bg-white text-slate-700 border-slate-300 hover:border-primary"
                  }`}
                >
                  {v.name}
                  {Number(v.price_delta) > 0
                    ? ` (+${formatCurrency(v.price_delta)})`
                    : ""}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* add button */}
      <Button
        type="button"
        className="w-full gap-2"
        disabled={!selectedProduct}
        onClick={handleAddToCart}
      >
        <Plus className="h-4 w-4" />
        {selectedProduct
          ? `Tambah – ${formatCurrency(displayPrice)}`
          : "Tambah ke Keranjang"}
      </Button>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function InvoicePage() {
  const toast = useToast();
  const selectedOutletId = useAppStore((s) => s.selectedOutletId);
  const createTransactionMutation = useCreateTransaction();
  const cancelTransactionMutation = useCancelTransaction();

  // edit transaction state
  const [editingTrxId, setEditingTrxId] = useState(null);
  const [editingTrxNo, setEditingTrxNo] = useState("");

  // master data
  const { data: masterData, isLoading: isMasterLoading } = useMasterData({
    outletId: selectedOutletId,
  });
  const products = masterData?.products || [];
  const customers = masterData?.customers || [];
  const outlets = masterData?.outlets || [];
  const paymentMethods = masterData?.payment_methods || [];
  const discounts = masterData?.discounts || [];
  const tables = masterData?.tables || [];

  const activeOutlets = useMemo(
    () => outlets.filter((o) => o.status === "active"),
    [outlets]
  );
  const activePaymentMethods = useMemo(
    () => paymentMethods.filter((p) => p.status === "active"),
    [paymentMethods]
  );
  const activeDiscounts = useMemo(
    () => discounts.filter((d) => d.status === "active"),
    [discounts]
  );

  // reports for history table
  const today = useMemo(() => new Date(), []);
  const thirtyDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  }, []);

  const reportFilters = useMemo(
    () => ({
      outletId: selectedOutletId === "all" ? "" : selectedOutletId,
      from: thirtyDaysAgo.toISOString().split("T")[0],
      to: today.toISOString().split("T")[0],
    }),
    [selectedOutletId, thirtyDaysAgo, today]
  );

  const {
    data: reportsData,
    isLoading: isReportsLoading,
    refetch: refetchReports,
  } = useReports(reportFilters);

  const manualInvoices = useMemo(() => {
    const all = reportsData?.transactions || [];
    return all
      .filter((t) => String(t.note || "").toLowerCase() === "input manual")
      .sort(
        (a, b) =>
          new Date(b.transaction_date || b.operational_at) -
          new Date(a.transaction_date || a.operational_at)
      );
  }, [reportsData]);

  // form
  const defaultOutletId =
    selectedOutletId && selectedOutletId !== "all" ? selectedOutletId : "";

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm({
    defaultValues: {
      outletId: defaultOutletId,
      customerId: "",
      serviceType: "takeaway",
      tableId: "",
      operationalAt: toDateString(new Date()),
      items: [],
      discountId: "",
      discountType: "nominal",
      discountValue: 0,
      tax: 0,
      paymentMethod: "",
      paidAmount: 0,
    },
  });

  const { fields, append, remove, update } = useFieldArray({
    control,
    name: "items",
  });

  const watchOutletId = watch("outletId");
  const watchServiceType = watch("serviceType");
  const watchItems = watch("items") || [];
  const watchDiscountId = watch("discountId");
  const watchDiscountType = watch("discountType");
  const watchDiscountValue = watch("discountValue") || 0;
  const watchTax = watch("tax") || 0;
  const watchPaidAmount = watch("paidAmount") || 0;
  const watchPaymentMethod = watch("paymentMethod");

  // sync outlet from global selector
  useEffect(() => {
    if (selectedOutletId && selectedOutletId !== "all") {
      setValue("outletId", selectedOutletId);
    }
  }, [selectedOutletId, setValue]);

  // auto-set first payment method when methods load
  useEffect(() => {
    if (activePaymentMethods.length > 0 && !watchPaymentMethod) {
      const cashMethod = activePaymentMethods.find((m) => m.code === "cash");
      setValue("paymentMethod", cashMethod ? "cash" : activePaymentMethods[0].code);
    }
  }, [activePaymentMethods, watchPaymentMethod, setValue]);

  // filtered tables
  const filteredTables = useMemo(() => {
    if (!watchOutletId) return [];
    return tables.filter(
      (t) => t.outlet_id === watchOutletId && t.status === "active"
    );
  }, [tables, watchOutletId]);

  // calculations
  const subtotal = useMemo(
    () =>
      watchItems.reduce(
        (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
        0
      ),
    [watchItems]
  );

  const discountAmount = useMemo(() => {
    if (watchDiscountId && watchDiscountId !== "no_discount") {
      const disc = activeDiscounts.find((d) => d.id === watchDiscountId);
      if (!disc) return 0;
      return disc.type === "percent"
        ? Math.round((subtotal * Number(disc.value || 0)) / 100)
        : Math.round(Number(disc.value || 0));
    }
    if (watchDiscountValue > 0) {
      return watchDiscountType === "percent"
        ? Math.round((subtotal * watchDiscountValue) / 100)
        : Math.round(watchDiscountValue);
    }
    return 0;
  }, [
    watchDiscountId,
    watchDiscountType,
    watchDiscountValue,
    subtotal,
    activeDiscounts,
  ]);

  const total = useMemo(
    () => Math.max(0, subtotal - discountAmount + Number(watchTax)),
    [subtotal, discountAmount, watchTax]
  );

  const changeAmount = useMemo(
    () => Math.max(0, Number(watchPaidAmount) - total),
    [watchPaidAmount, total]
  );

  // auto fill paidAmount for non-cash
  useEffect(() => {
    if (watchPaymentMethod && watchPaymentMethod !== "cash") {
      setValue("paidAmount", total);
    }
  }, [watchPaymentMethod, total, setValue]);

  // auto fill paidAmount to total when total changes and paidAmount is 0 or cash
  useEffect(() => {
    if (watchPaymentMethod === "cash" && total > 0 && Number(watchPaidAmount) === 0) {
      setValue("paidAmount", total);
    }
  }, [total, watchPaymentMethod, watchPaidAmount, setValue]);

  // add item to cart (handles duplicates)
  function handleAddItem(item) {
    const identityKey = `${item.productId}:${[...(item.variantIds || [])]
      .sort()
      .join(",")}`;
    const existsIndex = watchItems.findIndex(
      (i) =>
        `${i.productId}:${[...(i.variantIds || [])].sort().join(",")}` ===
        identityKey
    );
    if (existsIndex > -1) {
      const existing = watchItems[existsIndex];
      update(existsIndex, {
        ...existing,
        quantity: Number(existing.quantity || 0) + 1,
      });
    } else {
      append(item);
    }
  }

  // Edit Action
  const handleEdit = (trx) => {
    // Scroll to top
    window.scrollTo({ top: 0, behavior: "smooth" });

    // mapping items
    const mappedItems = (trx.items || []).map((item) => {
      const product = products.find((p) => p.id === item.product_id);
      let meta = item.metadata_json || {};
      if (typeof meta === "string") {
        try {
          meta = JSON.parse(meta);
        } catch {
          meta = {};
        }
      }
      const variants =
        item.selectedVariants ||
        item.selected_variants ||
        meta.selected_variants ||
        [];

      return {
        productId: item.product_id,
        name: product?.name || item.product_name || `Produk ID: ${item.product_id}`,
        unit: product?.unit || "pcs",
        price: Number(item.unit_price),
        quantity: Number(item.quantity),
        variantIds: variants.map((v) => v.id),
        selectedVariants: variants.map((v) => ({
          id: v.id,
          name: v.name,
          price_delta: Number(v.price_delta || 0),
        })),
      };
    });

    reset({
      outletId: trx.outlet_id,
      customerId: trx.customer_id || "umum",
      serviceType: trx.service_type || "takeaway",
      tableId: trx.table_id || "",
      operationalAt: toDateString(new Date(trx.transaction_date || trx.operational_at)),
      items: mappedItems,
      discountId: trx.discount_id || "no_discount",
      discountType: trx.discount_type || "nominal",
      discountValue: trx.discount_value || 0,
      tax: trx.tax || 0,
      paymentMethod: trx.payment_method || "cash",
      paidAmount: trx.total || 0,
    });

    setEditingTrxId(trx.id);
    setEditingTrxNo(trx.order_number);
    toast({
      title: "Mode Edit Aktif",
      description: `Data transaksi #${trx.order_number} berhasil dimuat ke form.`,
      variant: "info",
    });
  };

  // Cancel / Delete Action
  const handleCancel = async (trxId, orderNumber) => {
    if (
      !window.confirm(
        `Apakah Anda yakin ingin membatalkan transaksi #${orderNumber}? Stok produk akan dikembalikan otomatis.`
      )
    ) {
      return;
    }

    try {
      await cancelTransactionMutation.mutateAsync({
        id: trxId,
        payload: { reason: "Batal transaksi manual via POS Admin" },
      });
      refetchReports();
    } catch {
      // error handled by mutation
    }
  };

  // Batal Edit
  const handleCancelEdit = () => {
    setEditingTrxId(null);
    setEditingTrxNo("");
    reset({
      outletId: defaultOutletId,
      customerId: "",
      serviceType: "takeaway",
      tableId: "",
      operationalAt: toDateString(new Date()),
      items: [],
      discountId: "",
      discountType: "nominal",
      discountValue: 0,
      tax: 0,
      paymentMethod: activePaymentMethods[0]?.code || "cash",
      paidAmount: 0,
    });
    toast({
      title: "Mode Edit Dibatalkan",
      description: "Form dibersihkan kembali.",
    });
  };

  // submit
  const onSubmit = async (formData) => {
    if (!formData.outletId) {
      toast({ title: "Outlet belum dipilih", variant: "destructive" });
      return;
    }
    if (!formData.items || formData.items.length === 0) {
      toast({
        title: "Keranjang kosong",
        description: "Tambahkan minimal satu produk.",
        variant: "destructive",
      });
      return;
    }
    if (formData.serviceType === "dine_in" && !formData.tableId) {
      toast({
        title: "Nomor meja belum dipilih",
        description: "Wajib pilih meja untuk Dine In.",
        variant: "destructive",
      });
      return;
    }
    if (!formData.paymentMethod) {
      toast({ title: "Metode pembayaran belum dipilih", variant: "destructive" });
      return;
    }
    // Auto-fill paidAmount to total if not enough (untuk non-cash atau jika lupa isi)
    const finalPaidAmount =
      !formData.paymentMethod || formData.paymentMethod !== "cash"
        ? total
        : Number(formData.paidAmount) >= total
        ? Number(formData.paidAmount)
        : total;

    if (formData.paymentMethod === "cash" && Number(formData.paidAmount) > 0 && Number(formData.paidAmount) < total) {
      toast({
        title: "Pembayaran kurang",
        description: `Jumlah bayar minimal ${formatCurrency(total)}. Diisi otomatis dengan total.`,
        variant: "destructive",
      });
      setValue("paidAmount", total);
      return;
    }

    const selectedTable = tables.find((t) => t.id === formData.tableId);

    // 1. IF IN EDIT MODE, CANCEL OLD TRANSACTION FIRST
    if (editingTrxId) {
      try {
        await cancelTransactionMutation.mutateAsync({
          id: editingTrxId,
          payload: { reason: "Revisi via edit manual POS Admin" },
        });
      } catch (err) {
        toast({
          title: "Gagal edit transaksi",
          description: "Gagal membatalkan transaksi lama.",
          variant: "destructive",
        });
        return;
      }
    }

    // 2. CREATE NEW TRANSACTION WITH THE UPDATED DATA
    const payload = {
      id: createRuntimeId("trx"),
      clientRef: createRuntimeId("client_ref"),
      outletId: formData.outletId,
      customerId:
        !formData.customerId || formData.customerId === "umum"
          ? null
          : formData.customerId,
      serviceType: formData.serviceType,
      tableNumber:
        formData.serviceType === "dine_in" && selectedTable
          ? selectedTable.number
          : null,
      tableId:
        formData.serviceType === "dine_in" ? formData.tableId || null : null,
      operationalAt: formData.operationalAt
        ? new Date(formData.operationalAt).toISOString()
        : new Date().toISOString(),
      subtotal,
      discountId:
        !formData.discountId || formData.discountId === "no_discount"
          ? null
          : formData.discountId,
      discountType:
        formData.discountId && formData.discountId !== "no_discount"
          ? null
          : formData.discountType,
      discountValue:
        formData.discountId && formData.discountId !== "no_discount"
          ? 0
          : Number(formData.discountValue || 0),
      discount: discountAmount,
      tax: Number(formData.tax || 0),
      total,
      note: "Input manual",
      paymentMethod: formData.paymentMethod,
      payments: [
        {
          method: formData.paymentMethod,
          amount: finalPaidAmount,
          change_amount: Math.max(0, finalPaidAmount - total),
        },
      ],
      items: formData.items.map((item) => ({
        productId: item.productId,
        quantity: Number(item.quantity),
        unitPrice: Number(item.price),
        subtotal: Number(item.price) * Number(item.quantity),
        selectedVariants: item.selectedVariants || [],
      })),
    };

    try {
      await createTransactionMutation.mutateAsync(payload);
      setEditingTrxId(null);
      setEditingTrxNo("");
      reset({
        outletId: formData.outletId,
        customerId: "",
        serviceType: "takeaway",
        tableId: "",
        operationalAt: toDateString(new Date()),
        items: [],
        discountId: "",
        discountType: "nominal",
        discountValue: 0,
        tax: 0,
        paymentMethod: formData.paymentMethod,
        paidAmount: 0,
      });
      refetchReports();
    } catch {
      // error handled by mutation
    }
  };

  // detail modal
  const [detailTrx, setDetailTrx] = useState(null);

  const getOutletName = (id) =>
    outlets.find((o) => o.id === id)?.name || id || "-";

  // ─── render ────────────────────────────────────────────────────────────────

  if (isMasterLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoice Penjualan</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Buat transaksi penjualan manual dari admin panel. Stok bahan baku
            otomatis berkurang setelah disimpan.
          </p>
        </div>
      </div>

      {/* ─── Edit Mode Warning Banner ─────────────────────────────────── */}
      {editingTrxId && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h5 className="font-semibold text-amber-800 text-sm">Mode Edit Aktif</h5>
              <p className="text-xs text-amber-700 mt-0.5">
                Anda sedang mengedit transaksi manual <strong>#{editingTrxNo}</strong>.
                Menyimpan form ini akan membatalkan transaksi lama dan membuat transaksi baru dengan data terupdate.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCancelEdit}
            className="border-amber-300 text-amber-700 hover:bg-amber-100/50 hover:text-amber-800 self-start sm:self-auto shrink-0"
          >
            Batal Edit
          </Button>
        </div>
      )}

      {/* ─── Form ──────────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
          {/* ── LEFT: Detail Transaksi ──────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">
            {/* Info Transaksi */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-primary" />
                  Detail Transaksi
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Outlet */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold flex items-center gap-1.5">
                    <Store className="h-3.5 w-3.5" /> Outlet Jual
                    <span className="text-destructive">*</span>
                  </Label>
                  <Controller
                    control={control}
                    name="outletId"
                    rules={{ required: "Outlet wajib dipilih" }}
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger
                          className={errors.outletId ? "border-destructive" : ""}
                        >
                          <SelectValue placeholder="Pilih outlet..." />
                        </SelectTrigger>
                        <SelectContent>
                          {activeOutlets.map((o) => (
                            <SelectItem key={o.id} value={o.id}>
                              {o.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {errors.outletId && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {errors.outletId.message}
                    </p>
                  )}
                </div>

                {/* Tanggal */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" /> Tanggal Transaksi
                  </Label>
                  <Controller
                    control={control}
                    name="operationalAt"
                    render={({ field }) => (
                      <DatePicker
                        value={field.value}
                        onChange={(dateStr) => field.onChange(dateStr || toDateString(new Date()))}
                        className="w-full"
                      />
                    )}
                  />
                </div>

                {/* Customer */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" /> Customer
                  </Label>
                  <Controller
                    control={control}
                    name="customerId"
                    render={({ field }) => (
                      <Select
                        onValueChange={field.onChange}
                        value={field.value || "umum"}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Pilih customer (opsional)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="umum">Umum</SelectItem>
                          {customers.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                              {c.phone ? ` (${c.phone})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>

                {/* Tipe Layanan */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold flex items-center gap-1.5">
                    <Utensils className="h-3.5 w-3.5" /> Tipe Layanan
                  </Label>
                  <Controller
                    control={control}
                    name="serviceType"
                    render={({ field }) => (
                      <div className="grid grid-cols-2 gap-2">
                        {["takeaway", "dine_in"].map((type) => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => {
                              field.onChange(type);
                              if (type === "takeaway") setValue("tableId", "");
                            }}
                            className={`py-2 px-3 rounded-md border text-sm font-medium transition-all ${
                              field.value === type
                                ? "bg-primary text-white border-primary shadow-sm"
                                : "bg-white text-slate-700 border-slate-200 hover:border-primary"
                            }`}
                          >
                            {serviceTypeLabel(type)}
                          </button>
                        ))}
                      </div>
                    )}
                  />
                </div>

                {/* Nomor Meja (Dine In only) */}
                {watchServiceType === "dine_in" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">
                      Nomor Meja <span className="text-destructive">*</span>
                    </Label>
                    <Controller
                      control={control}
                      name="tableId"
                      render={({ field }) => (
                        <Select onValueChange={field.onChange} value={field.value}>
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih meja..." />
                          </SelectTrigger>
                          <SelectContent>
                            {filteredTables.length ? (
                              filteredTables.map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                  Meja {t.number}
                                  {t.name ? ` - ${t.name}` : ""}
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

            {/* Diskon & Pajak */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Tag className="h-4 w-4 text-primary" />
                  Diskon & Pajak
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Diskon Toko */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Diskon Toko</Label>
                  <Controller
                    control={control}
                    name="discountId"
                    render={({ field }) => (
                      <Select
                        onValueChange={(v) => {
                          field.onChange(v);
                          if (v !== "no_discount") {
                            setValue("discountValue", 0);
                          }
                        }}
                        value={field.value}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Tanpa diskon toko" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="no_discount">
                            Tanpa Diskon Toko
                          </SelectItem>
                          {activeDiscounts.map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.name} (
                              {d.type === "percent"
                                ? `${d.value}%`
                                : formatCurrency(d.value)}
                              )
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>

                {/* Diskon Manual (only if no store discount) */}
                {(!watchDiscountId || watchDiscountId === "no_discount") && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Tipe Diskon</Label>
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
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Nilai Diskon</Label>
                      <Controller
                        control={control}
                        name="discountValue"
                        render={({ field }) => (
                          <FormattedNumberInput
                            value={field.value}
                            onChange={(v) => field.onChange(v || 0)}
                          />
                        )}
                      />
                    </div>
                  </div>
                )}

                {/* Pajak */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Pajak Tambahan (Rp)</Label>
                  <Controller
                    control={control}
                    name="tax"
                    render={({ field }) => (
                      <FormattedNumberInput
                        value={field.value}
                        onChange={(v) => field.onChange(v || 0)}
                      />
                    )}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── RIGHT: Keranjang + Pembayaran ──────────────────────────── */}
          <div className="lg:col-span-3 space-y-4">
            {/* Tambah Produk */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" />
                  Tambah Produk
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ProductSearchDropdown
                  products={products}
                  outletId={watchOutletId}
                  onAdd={handleAddItem}
                />
              </CardContent>
            </Card>

            {/* Keranjang */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-primary" />
                  Keranjang
                  {fields.length > 0 && (
                    <Badge variant="secondary" className="ml-auto text-xs">
                      {fields.length} item
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {fields.length > 0 ? (
                  <div className="border-t">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50">
                          <TableHead className="pl-4">Produk</TableHead>
                          <TableHead className="w-[90px] text-center">Qty</TableHead>
                          <TableHead className="w-[130px] text-right">
                            Harga
                          </TableHead>
                          <TableHead className="w-[130px] text-right">
                            Subtotal
                          </TableHead>
                          <TableHead className="w-[48px]" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {fields.map((field, index) => (
                          <TableRow key={field.id} className="group">
                            <TableCell className="pl-4">
                              <div className="font-medium text-sm">
                                {field.name}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {field.unit}
                              </div>
                              {field.selectedVariants?.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {field.selectedVariants.map((v) => (
                                    <Badge
                                      key={v.id || v.name}
                                      variant="outline"
                                      className="text-[10px] px-1.5 py-0"
                                    >
                                      {v.name}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              <Controller
                                control={control}
                                name={`items.${index}.quantity`}
                                render={({ field: f }) => (
                                  <Input
                                    type="number"
                                    min={1}
                                    value={f.value}
                                    onChange={(e) =>
                                      f.onChange(
                                        Math.max(1, Number(e.target.value) || 1)
                                      )
                                    }
                                    className="h-8 w-16 text-center mx-auto"
                                  />
                                )}
                              />
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {formatCurrency(
                                Number(watchItems[index]?.price || 0)
                              )}
                            </TableCell>
                            <TableCell className="text-right font-semibold text-sm">
                              {formatCurrency(
                                Number(watchItems[index]?.price || 0) *
                                  Number(watchItems[index]?.quantity || 0)
                              )}
                            </TableCell>
                            <TableCell className="text-center pr-2">
                              <button
                                type="button"
                                onClick={() => remove(index)}
                                className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 text-muted-foreground text-sm gap-2 border-t">
                    <ShoppingCart className="h-8 w-8 opacity-30" />
                    <span>Keranjang masih kosong</span>
                    <span className="text-xs">
                      Cari dan tambahkan produk di atas
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Pembayaran & Ringkasan */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-primary" />
                  Pembayaran
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Summary */}
                <div className="bg-slate-50 rounded-lg p-3 space-y-2 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span>{formatCurrency(subtotal)}</span>
                  </div>
                  {discountAmount > 0 && (
                    <div className="flex justify-between text-destructive">
                      <span>Diskon</span>
                      <span>-{formatCurrency(discountAmount)}</span>
                    </div>
                  )}
                  {Number(watchTax) > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Pajak</span>
                      <span>+{formatCurrency(watchTax)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-base pt-2 border-t">
                    <span>Total Akhir</span>
                    <span className="text-primary">{formatCurrency(total)}</span>
                  </div>
                </div>

                {/* Metode Pembayaran */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">
                    Metode Pembayaran <span className="text-destructive">*</span>
                  </Label>
                  <Controller
                    control={control}
                    name="paymentMethod"
                    render={({ field }) => (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {activePaymentMethods.map((m) => (
                          <button
                            key={m.code}
                            type="button"
                            onClick={() => field.onChange(m.code)}
                            className={`py-2 px-2 rounded-md border text-xs font-medium transition-all text-center ${
                              field.value === m.code
                                ? "bg-primary text-white border-primary shadow-sm"
                                : "bg-white text-slate-700 border-slate-200 hover:border-primary"
                            }`}
                          >
                            {m.name}
                          </button>
                        ))}
                      </div>
                    )}
                  />
                </div>

                {/* Nominal Bayar (Cash only) */}
                {watchPaymentMethod === "cash" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">
                      Jumlah Dibayar (Rp)
                    </Label>
                    <Controller
                      control={control}
                      name="paidAmount"
                      render={({ field }) => (
                        <FormattedNumberInput
                          value={field.value}
                          onChange={(v) => field.onChange(v || 0)}
                          className="text-lg font-semibold"
                          placeholder={formatCurrency(total)}
                        />
                      )}
                    />
                    <div className="flex justify-between text-sm pt-1">
                      <span className="text-muted-foreground">Kembalian:</span>
                      <span className={`font-bold ${changeAmount >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                        {formatCurrency(changeAmount)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Submit */}
                <Button
                  type="submit"
                  className="w-full h-11 text-base font-semibold gap-2"
                  disabled={createTransactionMutation.isPending}
                >
                  {createTransactionMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Menyimpan...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      {editingTrxId ? "Update & Simpan Invoice" : "Simpan Invoice"}
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </form>

      {/* ─── Tabel Riwayat Invoice Manual ─────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="h-4 w-4 text-primary" />
            Riwayat Invoice Manual
            <span className="text-xs text-muted-foreground font-normal ml-1">
              (30 hari terakhir)
            </span>
          </CardTitle>
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
                    <TableHead>No. Order</TableHead>
                    <TableHead>Waktu</TableHead>
                    <TableHead>Outlet</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Tipe</TableHead>
                    <TableHead>Pembayaran</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="w-[120px] text-center">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {manualInvoices.map((trx) => {
                    const paymentsList = trx.payments || [];
                    const paymentText = paymentsList.length
                      ? paymentsList.map((p) => p.method).join(" + ")
                      : trx.payment_method || "-";
                    return (
                      <TableRow key={trx.id} className="hover:bg-slate-50/60">
                        <TableCell className="font-semibold text-primary text-sm">
                          {trx.order_number}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateTime(
                            trx.transaction_date || trx.operational_at
                          )}
                        </TableCell>
                        <TableCell className="text-sm max-w-[120px] truncate">
                          {getOutletName(trx.outlet_id)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {trx.customer?.name ||
                            trx.customer_name ||
                            "Umum"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              trx.service_type === "dine_in"
                                ? "default"
                                : "outline"
                            }
                            className="text-xs"
                          >
                            {serviceTypeLabel(trx.service_type)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs capitalize">
                          {paymentText}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatCurrency(trx.total)}
                        </TableCell>
                        <TableCell className="text-center pr-2 flex justify-center gap-1.5">
                          <button
                            type="button"
                            title="Preview / Detail"
                            className="text-muted-foreground hover:text-primary p-1.5 rounded hover:bg-slate-100 transition-colors"
                            onClick={() => setDetailTrx(trx)}
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            title="Edit Invoice"
                            className="text-muted-foreground hover:text-blue-600 p-1.5 rounded hover:bg-slate-100 transition-colors"
                            onClick={() => handleEdit(trx)}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            title="Batal Transaksi"
                            className="text-muted-foreground hover:text-destructive p-1.5 rounded hover:bg-slate-100 transition-colors"
                            onClick={() => handleCancel(trx.id, trx.order_number)}
                            disabled={cancelTransactionMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-24 text-muted-foreground text-sm border border-dashed rounded-md gap-1">
              <Receipt className="h-6 w-6 opacity-30" />
              <span>Belum ada invoice manual dalam 30 hari terakhir.</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Detail Modal ──────────────────────────────────────────────── */}
      {detailTrx && (
        <Dialog
          open={Boolean(detailTrx)}
          onOpenChange={(open) => !open && setDetailTrx(null)}
        >
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Detail Invoice Manual</DialogTitle>
              <DialogDescription>
                Order #{detailTrx.order_number}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-1">
              {/* Info grid */}
              <div className="grid grid-cols-2 gap-3 text-sm bg-slate-50 p-3 rounded-md">
                {[
                  ["Nomor Order", detailTrx.order_number],
                  [
                    "Waktu",
                    formatDateTime(
                      detailTrx.transaction_date || detailTrx.operational_at
                    ),
                  ],
                  ["Outlet", getOutletName(detailTrx.outlet_id)],
                  [
                    "Tipe Layanan",
                    detailTrx.service_type === "dine_in"
                      ? `Dine In${
                          detailTrx.table_number
                            ? ` – Meja ${detailTrx.table_number}`
                            : ""
                        }`
                      : "Take Away",
                  ],
                  [
                    "Customer",
                    detailTrx.customer?.name ||
                      detailTrx.customer_name ||
                      "Umum",
                  ],
                  [
                    "Pembayaran",
                    (detailTrx.payments || [])
                      .map((p) => p.method)
                      .join(" + ") ||
                      detailTrx.payment_method ||
                      "-",
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="font-semibold capitalize">{value}</div>
                  </div>
                ))}
              </div>

              {/* Items */}
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader className="bg-slate-50">
                    <TableRow>
                      <TableHead>Produk</TableHead>
                      <TableHead className="w-[60px] text-center">Qty</TableHead>
                      <TableHead className="text-right">Harga</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(detailTrx.items || []).map((item, idx) => {
                      let meta = item.metadata_json || {};
                      if (typeof meta === "string") {
                        try {
                          meta = JSON.parse(meta);
                        } catch {
                          meta = {};
                        }
                      }
                      const variants =
                        item.selectedVariants ||
                        item.selected_variants ||
                        meta.selected_variants ||
                        [];
                      return (
                        <TableRow key={item.id || idx}>
                          <TableCell>
                            <div className="font-medium text-sm">
                              {item.product?.name ||
                                item.product_name ||
                                `Produk #${item.product_id}`}
                            </div>
                            {variants.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {variants.map((v) => (
                                  <Badge
                                    key={v.id || v.name}
                                    variant="outline"
                                    className="text-[10px] px-1 py-0"
                                  >
                                    {v.name}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {item.quantity}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(item.unit_price)}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatCurrency(item.subtotal)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Totals */}
              <div className="bg-slate-50 rounded-md p-3 text-sm space-y-1.5">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{formatCurrency(detailTrx.subtotal)}</span>
                </div>
                {Number(detailTrx.discount) > 0 && (
                  <div className="flex justify-between text-destructive">
                    <span>Diskon</span>
                    <span>-{formatCurrency(detailTrx.discount)}</span>
                  </div>
                )}
                {Number(detailTrx.tax) > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Pajak</span>
                    <span>+{formatCurrency(detailTrx.tax)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-base border-t pt-2">
                  <span>Total</span>
                  <span className="text-primary">
                    {formatCurrency(detailTrx.total)}
                  </span>
                </div>
              </div>

              <div className="flex justify-between items-center pt-3 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const printContents = document.getElementById("printable-invoice-content").innerHTML;
                    const originalContents = document.body.innerHTML;
                    const style = `<style>
                      @media print {
                        body { font-family: sans-serif; padding: 20px; color: #000; }
                        table { width: 100%; border-collapse: collapse; margin-top: 15px; }
                        th, td { border-bottom: 1px solid #ddd; padding: 8px; text-align: left; }
                        th { background-color: #f5f5f5; }
                        .no-print { display: none; }
                        .text-right { text-align: right; }
                        .text-center { text-align: center; }
                        .font-bold { font-weight: bold; }
                        .bg-slate-50 { background-color: #fafafa !important; }
                        .border { border: 1px solid #ddd; }
                        .rounded-md { border-radius: 4px; }
                        .p-3 { padding: 12px; }
                        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
                        .mt-1 { margin-top: 4px; }
                        .text-xs { font-size: 11px; }
                        .text-sm { font-size: 13px; }
                        .text-muted-foreground { color: #666; }
                      }
                    </style>`;
                    
                    const printWindow = window.open("", "_blank");
                    printWindow.document.write("<html><head><title>Invoice " + detailTrx.order_number + "</title>" + style + "</head><body>");
                    printWindow.document.write(printContents);
                    printWindow.document.write("</body></html>");
                    printWindow.document.close();
                    printWindow.print();
                  }}
                  className="gap-1.5"
                >
                  <Printer className="h-4 w-4" /> Print Struk
                </Button>
                <Button variant="outline" onClick={() => setDetailTrx(null)}>
                  Tutup
                </Button>
              </div>
            </div>
            
            {/* Wrap the printable area with an ID */}
            <div id="printable-invoice-content" className="hidden">
              <div style={{ padding: "20px", maxWidth: "600px", margin: "0 auto" }}>
                <div style={{ textAlign: "center", marginBottom: "20px" }}>
                  <h2 style={{ margin: "0 0 5px 0" }}>MRIS Integration System</h2>
                  <p style={{ margin: "0", fontSize: "12px", color: "#666" }}>Invoice Penjualan Manual</p>
                </div>
                
                <hr style={{ border: "0", borderTop: "1px dashed #ccc", margin: "15px 0" }} />
                
                <table style={{ width: "100%", fontSize: "13px", lineHeight: "20px" }}>
                  <tbody>
                    <tr>
                      <td style={{ width: "35%", color: "#666" }}>Nomor Order</td>
                      <td style={{ fontWeight: "bold" }}>: {detailTrx.order_number}</td>
                    </tr>
                    <tr>
                      <td style={{ color: "#666" }}>Waktu</td>
                      <td>: {formatDateTime(detailTrx.transaction_date || detailTrx.operational_at)}</td>
                    </tr>
                    <tr>
                      <td style={{ color: "#666" }}>Outlet</td>
                      <td>: {getOutletName(detailTrx.outlet_id)}</td>
                    </tr>
                    <tr>
                      <td style={{ color: "#666" }}>Tipe Layanan</td>
                      <td>: {detailTrx.service_type === "dine_in" ? `Dine In ${detailTrx.table_number ? `(Meja ${detailTrx.table_number})` : ""}` : "Take Away"}</td>
                    </tr>
                    <tr>
                      <td style={{ color: "#666" }}>Customer</td>
                      <td>: {detailTrx.customer?.name || detailTrx.customer_name || "Umum"}</td>
                    </tr>
                    <tr>
                      <td style={{ color: "#666" }}>Metode Bayar</td>
                      <td style={{ textTransform: "capitalize" }}>: {(detailTrx.payments || []).map((p) => p.method).join(" + ") || detailTrx.payment_method || "-"}</td>
                    </tr>
                  </tbody>
                </table>
                
                <hr style={{ border: "0", borderTop: "1px dashed #ccc", margin: "15px 0" }} />
                
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #eee" }}>
                      <th style={{ textAlign: "left", padding: "8px 0" }}>Produk</th>
                      <th style={{ textAlign: "center", padding: "8px 0", width: "50px" }}>Qty</th>
                      <th style={{ textAlign: "right", padding: "8px 0" }}>Harga</th>
                      <th style={{ textAlign: "right", padding: "8px 0" }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailTrx.items || []).map((item, idx) => {
                      let meta = item.metadata_json || {};
                      if (typeof meta === "string") {
                        try { meta = JSON.parse(meta); } catch { meta = {}; }
                      }
                      const variants = item.selectedVariants || item.selected_variants || meta.selected_variants || [];
                      return (
                        <tr key={item.id || idx} style={{ borderBottom: "1px solid #f9f9f9" }}>
                          <td style={{ padding: "8px 0" }}>
                            <div>{item.product?.name || item.product_name || `Produk #${item.product_id}`}</div>
                            {variants.length > 0 && (
                              <div style={{ fontSize: "10px", color: "#888", marginTop: "2px" }}>
                                Varian: {variants.map(v => v.name).join(", ")}
                              </div>
                            )}
                          </td>
                          <td style={{ textAlign: "center", padding: "8px 0" }}>{item.quantity}</td>
                          <td style={{ textAlign: "right", padding: "8px 0" }}>{formatCurrency(item.unit_price)}</td>
                          <td style={{ textAlign: "right", padding: "8px 0", fontWeight: "bold" }}>{formatCurrency(item.subtotal)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                
                <hr style={{ border: "0", borderTop: "1px dashed #ccc", margin: "15px 0" }} />
                
                <table style={{ width: "100%", fontSize: "13px", lineHeight: "22px" }}>
                  <tbody>
                    <tr>
                      <td style={{ width: "60%" }}>Subtotal</td>
                      <td style={{ textAlign: "right" }}>{formatCurrency(detailTrx.subtotal)}</td>
                    </tr>
                    {Number(detailTrx.discount) > 0 && (
                      <tr style={{ color: "red" }}>
                        <td>Diskon</td>
                        <td style={{ textAlign: "right" }}>-{formatCurrency(detailTrx.discount)}</td>
                      </tr>
                    )}
                    {Number(detailTrx.tax) > 0 && (
                      <tr>
                        <td>Pajak</td>
                        <td style={{ textAlign: "right" }}>+{formatCurrency(detailTrx.tax)}</td>
                      </tr>
                    )}
                    <tr style={{ fontSize: "15px", fontWeight: "bold", borderTop: "1px solid #ddd" }}>
                      <td style={{ paddingTop: "8px" }}>Total Akhir</td>
                      <td style={{ textAlign: "right", paddingTop: "8px" }}>{formatCurrency(detailTrx.total)}</td>
                    </tr>
                  </tbody>
                </table>
                
                <div style={{ textAlign: "center", marginTop: "30px", fontSize: "12px", color: "#888" }}>
                  <p>Terima Kasih</p>
                </div>
              </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
