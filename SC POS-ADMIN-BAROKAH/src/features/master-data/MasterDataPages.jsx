import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { Barcode, Download, Edit, Eye, KeyRound, Loader2, Plus, Power, PowerOff, Printer, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormattedNumberInput } from "@/components/ui/formatted-number-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/shared/DataTable";
import { InlineRowActions, RowActionButton } from "@/components/shared/RowActions";
import { StatusBadge } from "@/components/shared/StatusBadge";
import {
  useCategoryDetail,
  useCreateCategory,
  useCreateCustomer,
  useCreateExpenseCategory,
  useCreateMaterialCategory,
  useCreateMaterial,
  useCreateOutlet,
  useCreatePaymentMethod,
  useCreateProduct,
  useCreateProductComposition,
  useCreateSupplier,
  useGenerateTables,
  useCreateUnit,
  useCreateUser,
  useCustomerDetail,
  useDeleteProductComposition,
  useExpenseCategoryDetail,
  useGenerateCustomerBarcode,
  useMasterData,
  useOutletDetail,
  useProductDetail,
  useReports,
  useResetUserPassword,
  useSupplierDetail,
  useToggleCategoryStatus,
  useToggleCustomerStatus,
  useToggleExpenseCategoryStatus,
  useToggleMaterialCategoryStatus,
  useToggleMaterialStatus,
  useToggleOutletStatus,
  useTogglePaymentMethodStatus,
  useToggleProductStatus,
  useToggleSupplierStatus,
  useToggleTableStatus,
  useToggleUnitStatus,
  useToggleUserStatus,
  useUpdateCategory,
  useUpdateCustomer,
  useUpdateExpenseCategory,
  useUpdateMaterialCategory,
  useUpdateMaterial,
  useUpdateOutlet,
  useUpdatePaymentMethod,
  useUpdateProduct,
  useUpdateProductComposition,
  useUpdateSupplier,
  useUpdateTable,
  useTableDetail,
  useUpdateUnit,
  useUpdateUser
} from "@/hooks/useAdminQueries";
import { adminApi } from "@/lib/adminApi";
import { hasAdminAccess, hasApkAccess } from "@/config/permissionCatalog";
import { can } from "@/lib/permissions";
import { normalizeTableRowsWithTransactions } from "@/lib/transactionNormalization";
import { formatCurrency, formatDate, formatDateTime, formatNumber, resolveBackendAssetUrl, toDateString } from "@/lib/utils";
import { useAppStore } from "@/store/appStore";
import { useToast } from "@/components/ui/toast";

function mergeMaterialCategoryUsage(categories = [], materials = []) {
  return categories.map((category) => {
    const categoryMaterials = materials.filter((material) => material.category_id === category.id);
    const existingMaterials = Array.isArray(category.materials) ? category.materials : [];
    return {
      ...category,
      materials: existingMaterials.length ? existingMaterials : categoryMaterials,
      material_count: Math.max(Number(category.material_count || 0), categoryMaterials.length, existingMaterials.length)
    };
  });
}

function useMasterDataPage() {
  const selectedOutletId = useAppStore((state) => state.selectedOutletId);
  const session = useAppStore((state) => state.session);
  const query = useMasterData({ outletId: selectedOutletId });
  const data = query.data || {};
  const materials = data.materials || data.raw_materials || [];

  return {
    ...query,
    session,
    selectedOutletId,
    users: data.users || [],
    outlets: data.outlets || [],
    roles: data.roles || [],
    customers: data.customers || [],
    products: data.products || [],
    categories: data.categories || [],
    expenseCategories: data.expense_categories || [],
    paymentMethods: data.payment_methods || [],
    discounts: data.discounts || [],
    materialCategories: mergeMaterialCategoryUsage(data.raw_material_categories || [], materials),
    compositions: data.product_compositions || data.compositions || [],
    materials,
    suppliers: data.suppliers || [],
    tables: data.tables || [],
    units: data.units || [],
    financialAccounts: data.financial_accounts || []
  };
}

function getCurrentMonthReportRange() {
  const today = new Date();
  return {
    from: toDateString(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: toDateString(today)
  };
}

function getExpenseCategoryKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function mergeExpenseCategoryUsage(categories = [], expenses = []) {
  const usageByCategory = expenses.reduce((result, expense) => {
    const key = getExpenseCategoryKey(expense.category || expense.category_name);
    if (!key) return result;
    const current = result.get(key) || { expenses: [], expense_count: 0, expense_total: 0 };
    current.expenses.push(expense);
    current.expense_count += 1;
    current.expense_total += Number(expense.amount || 0);
    result.set(key, current);
    return result;
  }, new Map());

  return categories.map((category) => {
    const existingCount = Number(category.expense_count || 0);
    const existingTotal = Number(category.expense_total || 0);
    const existingExpenses = Array.isArray(category.expenses) ? category.expenses : [];
    if (existingCount || existingTotal || existingExpenses.length) return category;

    const fallback = usageByCategory.get(getExpenseCategoryKey(category.name));
    if (!fallback) return category;

    return {
      ...category,
      expenses: fallback.expenses,
      expense_count: fallback.expense_count,
      expense_total: fallback.expense_total
    };
  });
}

function getNestedError(errors, path) {
  return path.split(".").reduce((value, part) => value?.[part], errors);
}

function ProductFieldError({ errors, path }) {
  const error = getNestedError(errors, path);
  return error ? <p className="text-[11px] text-destructive">{error.message}</p> : null;
}

function productImageUrl(product) {
  return resolveBackendAssetUrl(product?.image_url || product?.imageUrl || "");
}

function ProductImageFallback({ name, className = "" }) {
  const initial = String(name || "P").trim().slice(0, 1).toUpperCase() || "P";
  return (
    <div className={`flex items-center justify-center rounded-md bg-muted text-sm font-semibold text-muted-foreground ${className}`}>
      {initial}
    </div>
  );
}

function ProductThumbnail({ product, className = "h-10 w-10" }) {
  const [failed, setFailed] = useState(false);
  const imageUrl = productImageUrl(product);

  if (!imageUrl || failed) {
    return <ProductImageFallback name={product?.name} className={className} />;
  }

  return (
    <img
      src={imageUrl}
      alt={product?.name || "Produk"}
      className={`${className} rounded-md object-cover`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function formatAccountLabel(account) {
  return account ? `[${account.code}] ${account.name}` : "-";
}

function formatRowAccount(row) {
  if (row?.account) return formatAccountLabel(row.account);
  return row?.account_code ? `[${row.account_code}] Akun belum terdaftar` : "-";
}

function formatMaterialCategoryAccount(row, accounts = []) {
  const category = row?.category || row;
  const accountCode = category?.account_code || "";
  const account = category?.account || accounts.find((item) => item.code === accountCode);

  if (account) return formatAccountLabel(account);
  return accountCode ? `[${accountCode}] Akun belum terdaftar` : "-";
}

function filterAccountsByGroup(accounts = [], groups = []) {
  const allowedGroups = new Set(groups);
  return accounts
    .filter((account) => account.status === "active" && (!allowedGroups.size || allowedGroups.has(account.report_group)))
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.code).localeCompare(String(b.code)));
}

function AccountSelectField({
  accounts = [],
  control,
  errors,
  helperText = "Akun ini menentukan posisi data di laporan.",
  label = "Akun Laporan",
  name = "account_code",
  placeholder = "Pilih akun laporan"
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Controller
        name={name}
        control={control}
        rules={{ required: "Akun laporan wajib dipilih" }}
        render={({ field }) => (
          <Select value={field.value} onValueChange={field.onChange} disabled={!accounts.length}>
            <SelectTrigger>
              <SelectValue placeholder={accounts.length ? placeholder : "Akun belum tersedia"} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {accounts.map((account) => (
                <SelectItem key={account.id || account.code} value={account.code}>
                  {formatAccountLabel(account)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <p className="text-[11px] text-muted-foreground">{helperText} Buka dropdown lalu ketik kode/nama untuk mencari.</p>
      <ProductFieldError errors={errors} path={name} />
    </div>
  );
}

function getProductFormDefaults({ product, categories, materials }) {
  const productPrices = product?.all_prices || product?.prices || [];
  const productComposition = product?.composition || [];
  const productVariants = product?.variants || [];
  const firstMaterial = materials[0];
  const currentCategoryId = product?.category_id || product?.category?.id;
  const defaultCategory = currentCategoryId
    ? categories.find((category) => category.id === currentCategoryId)
    : categories.find((category) => category.status === "active");

  return {
    name: product?.name || "",
    sku: product?.sku || "",
    category_id: currentCategoryId || defaultCategory?.id || "",
    status: product?.status || "active",
    prices: productPrices.map((price) => ({
      outlet_id: price.outlet_id,
      price: price.price ?? "",
      status: price.status || "active"
    })),
    variants: productVariants.map((variant, index) => ({
      id: variant.id,
      name: variant.name || "",
      status: variant.status || "active",
      sort_order: variant.sort_order ?? index + 1
    })),
    composition: productComposition.length
      ? productComposition.map((item) => ({
          material_id: item.material_id,
          quantity: item.quantity,
          unit: item.unit || item.material?.unit || ""
        }))
      : firstMaterial
        ? [
            {
              material_id: firstMaterial.id,
              quantity: "",
              unit: firstMaterial.unit
            }
          ]
        : []
  };
}

function ProductFormDialog({
  canManageComposition = true,
  canManagePrice = true,
  categories,
  materials,
  mode = "create",
  onOpenChange,
  onSubmit,
  open,
  outlets,
  isPending = false,
  product,
  trigger
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [imageError, setImageError] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [removeImage, setRemoveImage] = useState(false);
  const fileInputRef = useRef(null);
  const objectPreviewUrlRef = useRef("");
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;
  const existingImageUrl = productImageUrl(product);
  const defaults = useMemo(
    () => getProductFormDefaults({ product, categories, materials }),
    [categories, materials, product]
  );
  const {
    control,
    handleSubmit,
    register,
    reset,
    setValue,
    formState: { errors, isDirty, isSubmitting }
  } = useForm({
    defaultValues: defaults,
    mode: "onChange"
  });
  const {
    fields: priceFields,
    append: appendPrice,
    remove: removePrice
  } = useFieldArray({
    control,
    name: "prices"
  });
  const {
    fields: compositionFields,
    append: appendComposition,
    remove: removeComposition
  } = useFieldArray({
    control,
    name: "composition"
  });
  const {
    fields: variantFields,
    append: appendVariant,
    remove: removeVariant
  } = useFieldArray({
    control,
    name: "variants"
  });
  const isEdit = mode === "edit";
  const currentCategoryId = product?.category_id || product?.category?.id;
  const categoryOptions = categories.filter((category) => category.status === "active" || category.id === currentCategoryId);
  const watchedPrices = useWatch({ control, name: "prices" }) || [];
  const selectedPriceOutletIds = watchedPrices.map((price) => price?.outlet_id).filter(Boolean);
  const availablePriceOutlets = outlets.filter((outlet) => !selectedPriceOutletIds.includes(outlet.id));

  useEffect(() => {
    if (isOpen) {
      reset(defaults);
      if (objectPreviewUrlRef.current) {
        globalThis.URL.revokeObjectURL(objectPreviewUrlRef.current);
        objectPreviewUrlRef.current = "";
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setImageFile(null);
      setImageError("");
      setRemoveImage(false);
      setImagePreviewUrl(existingImageUrl);
    }
  }, [defaults, existingImageUrl, isOpen, reset]);

  useEffect(
    () => () => {
      if (objectPreviewUrlRef.current) {
        globalThis.URL.revokeObjectURL(objectPreviewUrlRef.current);
      }
    },
    []
  );

  function handleImageChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowedTypes.has(file.type)) {
      setImageError("Format gambar harus JPG, PNG, atau WEBP.");
      event.target.value = "";
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setImageError("Ukuran gambar maksimal 2MB.");
      event.target.value = "";
      return;
    }

    if (objectPreviewUrlRef.current) {
      globalThis.URL.revokeObjectURL(objectPreviewUrlRef.current);
    }

    const previewUrl = globalThis.URL.createObjectURL(file);
    objectPreviewUrlRef.current = previewUrl;
    setImageFile(file);
    setImagePreviewUrl(previewUrl);
    setRemoveImage(false);
    setImageError("");
  }

  function clearImage() {
    if (objectPreviewUrlRef.current) {
      globalThis.URL.revokeObjectURL(objectPreviewUrlRef.current);
      objectPreviewUrlRef.current = "";
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setImageFile(null);
    setImagePreviewUrl("");
    setRemoveImage(Boolean(existingImageUrl));
    setImageError("");
  }

  function addCompositionRow() {
    const material = materials[0];
    appendComposition({
      material_id: material?.id || "",
      quantity: "",
      unit: material?.unit || ""
    });
  }

  function addPriceRow() {
    const outlet = availablePriceOutlets[0];
    if (!outlet) return;
    appendPrice({
      outlet_id: outlet.id,
      price: "",
      status: "active"
    });
  }

  function addVariantRow() {
    appendVariant({
      name: "",
      status: "active",
      sort_order: variantFields.length + 1
    });
  }

  async function submit(values) {
    const payload = {
      name: values.name.trim(),
      category_id: values.category_id,
      status: values.status,
      prices: (canManagePrice ? values.prices : defaults.prices)
        .filter((price) => price.outlet_id && Number(price.price || 0) > 0)
        .map((price) => ({
          outlet_id: price.outlet_id,
          price: Number(price.price || 0),
          status: price.status || "active"
        })),
      composition: ((canManageComposition ? values.composition : defaults.composition) || [])
        .filter((item) => item.material_id && Number(item.quantity) > 0)
        .map((item) => {
          const material = materials.find((candidate) => candidate.id === item.material_id);
          return {
            material_id: item.material_id,
            quantity: Number(item.quantity),
            unit: item.unit || material?.unit || ""
          };
        }),
      variants: (values.variants || [])
        .map((variant, index) => ({
          id: variant.id,
          name: String(variant.name || "").trim(),
          status: variant.status || "active",
          sort_order: index + 1
        }))
        .filter((variant) => variant.name),
      _imageFile: imageFile,
      _removeImage: removeImage
    };

    await onSubmit(payload);
    reset(defaults);
    setOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Produk" : "Tambah Produk"}</DialogTitle>
          <DialogDescription>
            Kelola produk, harga outlet manual, dan komposisi harga pokok produksi.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit(submit)}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="product-name">Nama Produk</Label>
              <Input
                id="product-name"
                placeholder="Contoh: Nasi Goreng Barokah"
                {...register("name", {
                  required: "Nama produk wajib diisi",
                  minLength: { value: 2, message: "Nama produk minimal 2 karakter" }
                })}
              />
              <ProductFieldError errors={errors} path="name" />
            </div>

            {isEdit ? (
              <div className="space-y-1.5">
                <Label htmlFor="product-sku">SKU</Label>
                <Input id="product-sku" value={defaults.sku || "-"} disabled readOnly />
                <p className="text-[11px] text-muted-foreground">SKU tidak berubah saat produk diedit.</p>
              </div>
            ) : (
              <div className="space-y-1.5 rounded-md border border-dashed bg-muted/30 p-3">
                <Label>SKU</Label>
                <p className="text-[12px] font-medium text-foreground">Dibuat otomatis setelah produk disimpan.</p>
                <p className="text-[11px] text-muted-foreground">Contoh: MKN-010, MNM-008, SNK-004.</p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Kategori</Label>
              <Controller
                name="category_id"
                control={control}
                rules={{ required: "Kategori wajib dipilih" }}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih kategori" />
                    </SelectTrigger>
                    <SelectContent>
                      {categoryOptions.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                          {category.status === "inactive" ? " (Nonaktif)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <ProductFieldError errors={errors} path="category_id" />
            </div>

            <div className="space-y-1.5">
              <Label>Status</Label>
              <Controller
                name="status"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Aktif</SelectItem>
                      <SelectItem value="inactive">Nonaktif</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="rounded-md border p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {imagePreviewUrl ? (
                <img
                  src={imagePreviewUrl}
                  alt="Preview produk"
                  className="h-24 w-24 rounded-md border object-cover"
                />
              ) : (
                <ProductImageFallback name={product?.name || "Produk"} className="h-24 w-24 border text-lg" />
              )}
              <div className="flex-1 space-y-2">
                <div>
                  <p className="text-[13px] font-semibold">Gambar Produk</p>
                  <p className="text-[11px] text-muted-foreground">
                    Opsional. Gambar tampil di grid produk APK kasir. Format JPG, PNG, atau WEBP maksimal 2MB.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={fileInputRef}
                    className="hidden"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleImageChange}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    <Upload />
                    {imagePreviewUrl ? "Ganti Gambar" : "Pilih Gambar"}
                  </Button>
                  {imagePreviewUrl ? (
                    <Button type="button" variant="ghost" size="sm" onClick={clearImage}>
                      <Trash2 />
                      Hapus Gambar
                    </Button>
                  ) : null}
                </div>
                {imageFile ? <p className="text-[11px] text-muted-foreground">{imageFile.name}</p> : null}
                {imageError ? <p className="text-[11px] text-destructive">{imageError}</p> : null}
              </div>
            </div>
          </div>

          <div className="rounded-md border p-3">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold">Catatan Variant</p>
                <p className="text-[11px] text-muted-foreground">
                  Badge pilihan kecil untuk APK kasir. Bisa dipilih lebih dari satu dan tidak mengubah harga.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 w-full shrink-0 whitespace-nowrap sm:w-auto"
                onClick={addVariantRow}
                disabled={variantFields.length >= 20}
              >
                <Plus />
                Tambah Variant
              </Button>
            </div>
            {variantFields.length ? (
              <div className="space-y-2">
                {variantFields.map((field, index) => (
                  <div key={field.id} className="grid gap-2 rounded-md bg-muted/35 p-2 md:grid-cols-[1fr_180px_auto]">
                    <div className="space-y-1.5">
                      <Label htmlFor={`product-variant-${field.id}`}>Nama Variant</Label>
                      <Input
                        id={`product-variant-${field.id}`}
                        placeholder="Contoh: Sambal Matah"
                        {...register(`variants.${index}.name`, {
                          required: "Nama variant wajib diisi",
                          maxLength: { value: 120, message: "Nama variant maksimal 120 karakter" }
                        })}
                      />
                      <input type="hidden" {...register(`variants.${index}.id`)} />
                      <ProductFieldError errors={errors} path={`variants.${index}.name`} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Status</Label>
                      <Controller
                        name={`variants.${index}.status`}
                        control={control}
                        render={({ field }) => (
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger>
                              <SelectValue placeholder="Pilih status" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="active">Aktif</SelectItem>
                              <SelectItem value="inactive">Nonaktif</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </div>
                    <div className="flex items-end">
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeVariant(index)}>
                        <Trash2 />
                        <span className="sr-only">Hapus catatan variant</span>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-4 text-[12px] text-muted-foreground">
                Belum ada catatan variant. Produk tetap bisa dijual tanpa pilihan tambahan.
              </div>
            )}
            <ProductFieldError errors={errors} path="variants" />
          </div>

          {canManagePrice ? (
            <div className="rounded-md border p-3">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-semibold">Harga Outlet Manual</p>
                  <p className="text-[11px] text-muted-foreground">Tambahkan hanya outlet yang memang menjual produk ini.</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addPriceRow} disabled={!availablePriceOutlets.length}>
                  <Plus />
                  Tambah Harga Outlet
                </Button>
              </div>
              {priceFields.length ? (
                <div className="space-y-3">
                  {priceFields.map((field, index) => {
                    const currentOutletId = watchedPrices[index]?.outlet_id;
                    const selectableOutlets = outlets.filter(
                      (outlet) => outlet.id === currentOutletId || !selectedPriceOutletIds.includes(outlet.id)
                    );
                    return (
                      <div key={field.id} className="grid gap-3 rounded-md bg-muted/30 p-3 md:grid-cols-[1.4fr_1fr_0.9fr_auto]">
                        <div className="space-y-1.5">
                          <Label>Outlet</Label>
                          <Controller
                            name={`prices.${index}.outlet_id`}
                            control={control}
                            rules={{ required: "Outlet wajib dipilih" }}
                            render={({ field }) => (
                              <Select value={field.value} onValueChange={field.onChange}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Pilih outlet" />
                                </SelectTrigger>
                                <SelectContent>
                                  {selectableOutlets.map((outlet) => (
                                    <SelectItem key={outlet.id} value={outlet.id}>
                                      {outlet.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          />
                          <ProductFieldError errors={errors} path={`prices.${index}.outlet_id`} />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`product-price-${field.id}`}>Harga</Label>
                          <Controller
                            name={`prices.${index}.price`}
                            control={control}
                            rules={{
                              required: "Harga wajib diisi",
                              min: { value: 1, message: "Harga minimal 1" }
                            }}
                            render={({ field }) => (
                              <FormattedNumberInput
                                id={`product-price-${field.id}`}
                                placeholder="25.000"
                                value={field.value}
                                onChange={field.onChange}
                                onBlur={field.onBlur}
                                name={field.name}
                                ref={field.ref}
                              />
                            )}
                          />
                          <ProductFieldError errors={errors} path={`prices.${index}.price`} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Status</Label>
                          <Controller
                            name={`prices.${index}.status`}
                            control={control}
                            render={({ field }) => (
                              <Select value={field.value} onValueChange={field.onChange}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Pilih status" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="active">Aktif</SelectItem>
                                  <SelectItem value="inactive">Nonaktif</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          />
                        </div>
                        <div className="flex items-end">
                          <Button type="button" variant="ghost" size="icon" onClick={() => removePrice(index)}>
                            <Trash2 />
                            <span className="sr-only">Hapus harga outlet</span>
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-md border border-dashed p-4 text-[12px] text-muted-foreground">
                  Belum ada harga outlet. Produk belum muncul di APK sampai harga outlet ditambahkan.
                </div>
              )}
            </div>
          ) : null}

          {canManageComposition ? (
            <div className="rounded-md border p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-[13px] font-semibold">Komposisi Harga Pokok Produksi</p>
                  <p className="text-[11px] text-muted-foreground">Tambahkan harga pokok produksi untuk estimasi HPP dan stok.</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addCompositionRow}>
                  <Plus />
                  Tambah Harga Pokok Produksi
                </Button>
              </div>

              <div className="space-y-2">
                {compositionFields.length === 0 ? (
                  <div className="rounded-md border border-dashed p-4 text-center text-[12px] text-muted-foreground">
                    Belum ada komposisi.
                  </div>
                ) : null}

                {compositionFields.map((fieldItem, index) => (
                  <div key={fieldItem.id} className="grid gap-2 rounded-md bg-muted/45 p-2 md:grid-cols-[1.25fr_0.75fr_0.55fr_auto]">
                    <div className="space-y-1.5">
                      <Label>Harga Pokok Produksi</Label>
                      <Controller
                        name={`composition.${index}.material_id`}
                        control={control}
                        rules={{ required: "Harga Pokok Produksi wajib dipilih" }}
                        render={({ field }) => (
                          <Select
                            value={field.value}
                            onValueChange={(value) => {
                              field.onChange(value);
                              const material = materials.find((item) => item.id === value);
                              setValue(`composition.${index}.unit`, material?.unit || "", {
                                shouldDirty: true,
                                shouldValidate: true
                              });
                            }}
                          >
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
                      <ProductFieldError errors={errors} path={`composition.${index}.material_id`} />
                    </div>

                    <div className="space-y-1.5">
                      <Label>Qty</Label>
                      <Controller
                        name={`composition.${index}.quantity`}
                        control={control}
                        rules={{
                          required: "Qty wajib diisi",
                          min: { value: 0.001, message: "Qty minimal 0,001" }
                        }}
                        render={({ field }) => (
                          <FormattedNumberInput
                            allowDecimal
                            placeholder="0,18"
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            name={field.name}
                            ref={field.ref}
                          />
                        )}
                      />
                      <ProductFieldError errors={errors} path={`composition.${index}.quantity`} />
                    </div>

                    <div className="space-y-1.5">
                      <Label>Unit</Label>
                      <Input readOnly {...register(`composition.${index}.unit`)} />
                    </div>

                    <div className="flex items-end">
                      <Button type="button" variant="outline" size="icon" onClick={() => removeComposition(index)}>
                        <Trash2 />
                        <span className="sr-only">Hapus harga pokok produksi</span>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {isDirty ? <p className="text-[11px] text-muted-foreground">Perubahan belum disimpan.</p> : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting || isPending}>
              {isSubmitting || isPending ? <Loader2 className="animate-spin" /> : null}
              {isSubmitting || isPending ? "Menyimpan..." : isEdit ? "Simpan Perubahan" : "Simpan Produk"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProductDetailDialog({ open, onOpenChange, product }) {
  const detailQuery = useProductDetail(product?.id, { enabled: open });
  const detailProduct = detailQuery.data || product;
  const prices = detailProduct?.all_prices || detailProduct?.prices || [];
  const composition = detailProduct?.composition || [];
  const variants = detailProduct?.variants || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Detail Produk</DialogTitle>
          <DialogDescription>Ringkasan master produk, harga outlet, dan komposisi.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {detailQuery.isFetching ? (
            <div className="space-y-3 rounded-md border border-dashed p-3">
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Mengambil detail produk dari backend...
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="h-14 animate-pulse rounded-md bg-muted" />
                ))}
              </div>
            </div>
          ) : null}
          {detailQuery.isError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-[12px] text-destructive">
              {detailQuery.error?.message || "Gagal mengambil detail produk."}
            </div>
          ) : null}

          <div className="grid gap-2 md:grid-cols-2">
            {[
              ["Nama Produk", detailProduct?.name],
              ["SKU", detailProduct?.sku],
              ["Kategori", detailProduct?.category?.name],
              ["Status", <StatusBadge key="status" status={detailProduct?.status} />]
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border p-3">
                <p className="text-[11px] text-muted-foreground">{label}</p>
                <div className="mt-1 font-medium">{value || "-"}</div>
              </div>
            ))}
          </div>

          <div className="rounded-md border p-3">
            <p className="mb-2 text-[13px] font-semibold">Harga per Outlet</p>
            <div className="grid gap-2 md:grid-cols-2">
              {prices.map((price) => (
                <div key={price.id} className="flex items-center justify-between rounded-md bg-muted/45 px-3 py-2">
                  <span>{price.outlet?.name}</span>
                  <span className="font-medium">{formatCurrency(price.price)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-md border p-3">
            <p className="mb-2 text-[13px] font-semibold">Catatan Variant</p>
            {variants.length ? (
              <div className="flex flex-wrap gap-2">
                {variants.map((variant) => (
                  <Badge key={variant.id || variant.name} variant={variant.status === "inactive" ? "muted" : "info"}>
                    {variant.name}
                    {variant.status === "inactive" ? " (Nonaktif)" : ""}
                  </Badge>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-4 text-center text-[12px] text-muted-foreground">
                Belum ada catatan variant.
              </div>
            )}
          </div>

          <div className="rounded-md border p-3">
            <p className="mb-2 text-[13px] font-semibold">Komposisi Harga Pokok Produksi</p>
            {composition.length ? (
              <div className="space-y-2">
                {composition.map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-md bg-muted/45 px-3 py-2">
                    <span>{item.material?.name}</span>
                    <span className="font-medium">
                      {formatNumber(item.quantity)} {item.unit}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-4 text-center text-[12px] text-muted-foreground">
                Belum ada komposisi.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProductRowActions({ canManageComposition, canManagePrice, canToggleStatus, canUpdate, categories, materials, outlets, product }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const updateProduct = useUpdateProduct();
  const toggleProductStatus = useToggleProductStatus();
  const isInactive = product.status === "inactive";

  return (
    <>
      <InlineRowActions>
        <RowActionButton label={`Detail ${product.name}`} onClick={() => setDetailOpen(true)}>
          <Eye />
        </RowActionButton>
        {canUpdate ? (
          <RowActionButton label={`Edit ${product.name}`} onClick={() => setEditOpen(true)}>
            <Edit />
          </RowActionButton>
        ) : null}
        {canToggleStatus ? (
          <RowActionButton
            disabled={toggleProductStatus.isPending}
            label={toggleProductStatus.isPending ? "Memproses..." : isInactive ? `Aktifkan ${product.name}` : `Nonaktifkan ${product.name}`}
            onClick={() => toggleProductStatus.mutate(product.id)}
          >
            {toggleProductStatus.isPending ? <Loader2 className="animate-spin" /> : isInactive ? <Power /> : <PowerOff />}
          </RowActionButton>
        ) : null}
      </InlineRowActions>

      <ProductDetailDialog open={detailOpen} onOpenChange={setDetailOpen} product={product} />
      <ProductFormDialog
        mode="edit"
        open={editOpen}
        onOpenChange={setEditOpen}
        product={product}
        categories={categories}
        outlets={outlets}
        materials={materials}
        canManageComposition={canManageComposition}
        canManagePrice={canManagePrice}
        isPending={updateProduct.isPending}
        onSubmit={(values) => updateProduct.mutateAsync({ id: product.id, payload: values })}
      />
    </>
  );
}

function getMaterialFormDefaults(material) {
  return {
    name: material?.name || "",
    unit: material?.unit || "kg",
    type: material?.type || "hpp",
    category_id: material?.category_id || material?.category?.id || "",
    low_stock_threshold: material?.low_stock_threshold ?? "",
    status: material?.status || "active"
  };
}

function MaterialFormDialog({ categories = [], financialAccounts = [], mode = "create", onOpenChange, onSubmit, open, material, trigger, units = [] }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;
  const defaults = useMemo(() => getMaterialFormDefaults(material), [material]);
  const {
    control,
    handleSubmit,
    register,
    reset,
    setValue,
    formState: { errors, isDirty, isSubmitting }
  } = useForm({
    defaultValues: defaults
  });
  const isEdit = mode === "edit";
  const selectedType = useWatch({ control, name: "type" }) || defaults.type;
  const selectedCategoryId = useWatch({ control, name: "category_id" }) || defaults.category_id;
  const activeUnits = units.filter((unit) => unit.status === "active" || unit.code === defaults.unit);
  const activeCategories = categories.filter(
    (category) => category.type === selectedType && (category.status === "active" || category.id === defaults.category_id)
  );
  const selectedCategory = activeCategories.find((category) => category.id === selectedCategoryId);
  const selectedCategoryAccount = selectedCategory
    ? formatMaterialCategoryAccount(selectedCategory, financialAccounts)
    : "-";

  useEffect(() => {
    if (isOpen) {
      reset(defaults);
    }
  }, [defaults, isOpen, reset]);

  useEffect(() => {
    if (!isOpen || !activeCategories.length) return;
    const currentCategory = activeCategories.find((category) => category.id === selectedCategoryId);

    if (!currentCategory) {
      setValue("category_id", activeCategories[0].id, { shouldDirty: true });
    }
  }, [activeCategories, isOpen, selectedCategoryId, setValue]);

  async function submit(values) {
    await onSubmit({
      name: values.name.trim(),
      unit: values.unit,
      type: values.type,
      category_id: values.category_id,
      low_stock_threshold: Number(values.low_stock_threshold || 0),
      status: values.status
    });
    reset(defaults);
    setOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Harga Pokok Produksi" : "Tambah Harga Pokok Produksi"}</DialogTitle>
          <DialogDescription>
            Kelola master harga pokok produksi. Stok outlet dibuat dari pembelian, transfer approved, atau stock opname.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-3" onSubmit={handleSubmit(submit)}>
          <div className="space-y-1.5">
            <Label htmlFor="material-name">Nama Harga Pokok Produksi</Label>
            <Input
              id="material-name"
              placeholder="Contoh: Cabai Merah"
              {...register("name", {
                required: "Nama harga pokok produksi wajib diisi",
                minLength: { value: 2, message: "Nama harga pokok produksi minimal 2 karakter" }
              })}
            />
            <ProductFieldError errors={errors} path="name" />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Controller
                name="type"
                control={control}
                rules={{ required: "Type wajib dipilih" }}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hpp">HPP / Harga Pokok Penjualan</SelectItem>
                      <SelectItem value="biaya">Biaya Produksi</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
              <ProductFieldError errors={errors} path="type" />
            </div>

            <div className="space-y-1.5">
              <Label>Kategori</Label>
              <Controller
                name="category_id"
                control={control}
                rules={{ required: "Kategori wajib dipilih" }}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih kategori" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeCategories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <ProductFieldError errors={errors} path="category_id" />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Unit</Label>
              <Controller
                name="unit"
                control={control}
                rules={{ required: "Unit wajib dipilih" }}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih unit" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeUnits.map((unit) => (
                        <SelectItem key={unit.id} value={unit.code}>
                          {unit.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <ProductFieldError errors={errors} path="unit" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="material-threshold">Threshold Stok Menipis</Label>
              <Controller
                name="low_stock_threshold"
                control={control}
                rules={{
                  required: "Threshold wajib diisi",
                  min: { value: 0, message: "Threshold minimal 0" }
                }}
                render={({ field }) => (
                  <FormattedNumberInput
                    id="material-threshold"
                    allowDecimal
                    placeholder="10"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                  />
                )}
              />
              <ProductFieldError errors={errors} path="low_stock_threshold" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Akun Laporan</Label>
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-[13px] font-medium">
              {selectedCategoryAccount}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Akun mengikuti kategori. Ubah akun lewat menu Kategori Harga Pokok Produksi agar laporan tetap konsisten.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Aktif</SelectItem>
                    <SelectItem value="inactive">Nonaktif</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          {isDirty ? <p className="text-[11px] text-muted-foreground">Perubahan belum disimpan.</p> : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Menyimpan..." : isEdit ? "Simpan Perubahan" : "Simpan Harga Pokok Produksi"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MaterialDetailDialog({ financialAccounts = [], material, onOpenChange, open }) {
  const stocks = material?.stocks || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detail Harga Pokok Produksi</DialogTitle>
          <DialogDescription>Ringkasan master harga pokok produksi dan stok per outlet.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2 md:grid-cols-2">
            {[
              ["Nama", material?.name],
              ["Type", material?.type === "biaya" ? "Biaya Produksi" : "HPP"],
              ["Kategori", material?.category?.name],
              ["Akun Laporan", formatMaterialCategoryAccount(material, financialAccounts)],
              ["Unit", material?.unit],
              ["Threshold", `${formatNumber(material?.low_stock_threshold)} ${material?.unit || ""}`],
              ["Status", <StatusBadge key="status" status={material?.status} />]
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border p-3">
                <p className="text-[11px] text-muted-foreground">{label}</p>
                <div className="mt-1 font-medium">{value || "-"}</div>
              </div>
            ))}
          </div>

          <div className="rounded-md border p-3">
            <p className="mb-2 text-[13px] font-semibold">Stok per Outlet</p>
            <div className="space-y-2">
              {stocks.map((stock) => (
                <div key={stock.id} className="flex items-center justify-between rounded-md bg-muted/45 px-3 py-2">
                  <span>{stock.outlet?.name}</span>
                  <span className="font-medium">
                    {formatNumber(stock.quantity)} {stock.unit}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MaterialRowActions({ canToggleStatus, canUpdate, financialAccounts, material, materialCategories, units }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const updateMaterial = useUpdateMaterial();
  const toggleMaterialStatus = useToggleMaterialStatus();
  const isInactive = material.status === "inactive";

  return (
    <>
      <InlineRowActions>
        <RowActionButton label={`Detail ${material.name}`} onClick={() => setDetailOpen(true)}>
          <Eye />
        </RowActionButton>
        {canUpdate ? (
          <RowActionButton label={`Edit ${material.name}`} onClick={() => setEditOpen(true)}>
            <Edit />
          </RowActionButton>
        ) : null}
        {canToggleStatus ? (
          <RowActionButton
            disabled={toggleMaterialStatus.isPending}
            label={toggleMaterialStatus.isPending ? "Memproses..." : isInactive ? `Aktifkan ${material.name}` : `Nonaktifkan ${material.name}`}
            onClick={() => toggleMaterialStatus.mutate(material.id)}
          >
            {toggleMaterialStatus.isPending ? <Loader2 className="animate-spin" /> : isInactive ? <Power /> : <PowerOff />}
          </RowActionButton>
        ) : null}
      </InlineRowActions>

      <MaterialDetailDialog financialAccounts={financialAccounts} material={material} open={detailOpen} onOpenChange={setDetailOpen} />
      <MaterialFormDialog
        mode="edit"
        material={material}
        categories={materialCategories}
        financialAccounts={financialAccounts}
        units={units}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSubmit={(values) => updateMaterial.mutateAsync({ id: material.id, payload: values })}
      />
    </>
  );
}

function getUnitFormDefaults(unit) {
  return {
    name: unit?.name || "",
    code: unit?.code || "",
    status: unit?.status || "active"
  };
}

function UnitFormDialog({ mode = "create", onOpenChange, onSubmit, open, trigger, unit }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;
  const defaults = useMemo(() => getUnitFormDefaults(unit), [unit]);
  const {
    control,
    handleSubmit,
    register,
    reset,
    formState: { errors, isDirty, isSubmitting }
  } = useForm({
    defaultValues: defaults
  });
  const isEdit = mode === "edit";

  useEffect(() => {
    if (isOpen) {
      reset(defaults);
    }
  }, [defaults, isOpen, reset]);

  async function submit(values) {
    await onSubmit({
      name: values.name.trim(),
      code: values.code.trim(),
      status: values.status
    });
    reset(defaults);
    setOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Unit" : "Tambah Unit"}</DialogTitle>
          <DialogDescription>Unit dipakai pada master harga pokok produksi, stok, dan komposisi produk.</DialogDescription>
        </DialogHeader>

        <form className="space-y-3" onSubmit={handleSubmit(submit)}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="unit-name">Nama Unit</Label>
              <Input
                id="unit-name"
                placeholder="Kilogram"
                {...register("name", {
                  required: "Nama unit wajib diisi",
                  minLength: { value: 1, message: "Nama unit wajib diisi" }
                })}
              />
              <ProductFieldError errors={errors} path="name" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="unit-code">Kode Unit</Label>
              <Input
                id="unit-code"
                placeholder="kg"
                {...register("code", {
                  required: "Kode unit wajib diisi",
                  minLength: { value: 1, message: "Kode unit wajib diisi" }
                })}
              />
              <ProductFieldError errors={errors} path="code" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Aktif</SelectItem>
                    <SelectItem value="inactive">Nonaktif</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          {isDirty ? <p className="text-[11px] text-muted-foreground">Perubahan belum disimpan.</p> : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Menyimpan..." : isEdit ? "Simpan Perubahan" : "Simpan Unit"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UnitRowActions({ canToggleStatus, canUpdate, unit }) {
  const [editOpen, setEditOpen] = useState(false);
  const updateUnit = useUpdateUnit();
  const toggleUnitStatus = useToggleUnitStatus();
  const isInactive = unit.status === "inactive";

  return (
    <>
      <InlineRowActions>
        {canUpdate ? (
          <RowActionButton label={`Edit ${unit.name}`} onClick={() => setEditOpen(true)}>
            <Edit />
          </RowActionButton>
        ) : null}
        {canToggleStatus ? (
          <RowActionButton
            disabled={toggleUnitStatus.isPending}
            label={toggleUnitStatus.isPending ? "Memproses..." : isInactive ? `Aktifkan ${unit.name}` : `Nonaktifkan ${unit.name}`}
            onClick={() => toggleUnitStatus.mutate(unit.id)}
          >
            {toggleUnitStatus.isPending ? <Loader2 className="animate-spin" /> : isInactive ? <Power /> : <PowerOff />}
          </RowActionButton>
        ) : null}
      </InlineRowActions>

      <UnitFormDialog
        mode="edit"
        unit={unit}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSubmit={(values) => updateUnit.mutateAsync({ id: unit.id, payload: values })}
      />
    </>
  );
}

function getSupplierFormDefaults(supplier) {
  return {
    name: supplier?.name || "",
    phone: supplier?.phone || "",
    status: supplier?.status || "active"
  };
}

function SupplierFormDialog({ isPending = false, mode = "create", onOpenChange, onSubmit, open, supplier, trigger }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;
  const defaults = useMemo(() => getSupplierFormDefaults(supplier), [supplier]);
  const {
    control,
    handleSubmit,
    register,
    reset,
    formState: { errors, isDirty, isSubmitting }
  } = useForm({
    defaultValues: defaults
  });
  const isEdit = mode === "edit";

  useEffect(() => {
    if (isOpen) {
      reset(defaults);
    }
  }, [defaults, isOpen, reset]);

  async function submit(values) {
    await onSubmit({
      name: values.name.trim(),
      phone: values.phone.trim(),
      status: values.status
    });
    reset(defaults);
    setOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Supplier" : "Tambah Supplier"}</DialogTitle>
          <DialogDescription>Supplier aktif dapat dipilih saat membuat pembelian harga pokok produksi.</DialogDescription>
        </DialogHeader>

        <form className="space-y-3" onSubmit={handleSubmit(submit)}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="supplier-name">Nama Supplier</Label>
              <Input
                id="supplier-name"
                placeholder="Contoh: CV Sumber Pangan"
                {...register("name", {
                  required: "Nama supplier wajib diisi",
                  minLength: { value: 2, message: "Nama supplier minimal 2 karakter" }
                })}
              />
              <ProductFieldError errors={errors} path="name" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="supplier-phone">Nomor Telepon</Label>
              <Input
                id="supplier-phone"
                placeholder="021-7000-1001"
                {...register("phone", {
                  required: "Nomor telepon wajib diisi",
                  minLength: { value: 6, message: "Nomor telepon minimal 6 karakter" }
                })}
              />
              <ProductFieldError errors={errors} path="phone" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Aktif</SelectItem>
                    <SelectItem value="inactive">Nonaktif</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {isDirty ? <p className="text-[11px] text-muted-foreground">Perubahan belum disimpan.</p> : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" disabled={isSubmitting || isPending} onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting || isPending}>
              {isSubmitting || isPending ? <Loader2 className="animate-spin" /> : null}
              {isSubmitting || isPending ? "Menyimpan..." : isEdit ? "Simpan Perubahan" : "Simpan Supplier"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SupplierDetailDialog({ onOpenChange, open, supplier }) {
  const detailQuery = useSupplierDetail(supplier?.id, { enabled: open });
  const detailSupplier = { ...(supplier || {}), ...(detailQuery.data || {}) };
  const purchases = detailSupplier?.purchases?.length ? detailSupplier.purchases : supplier?.purchases || [];
  const purchaseCount = Number(detailSupplier?.purchase_count ?? supplier?.purchase_count ?? purchases.length ?? 0);
  const purchaseTotal = Number(detailSupplier?.purchase_total ?? supplier?.purchase_total ?? 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Detail Supplier</DialogTitle>
          <DialogDescription>Profil supplier dan ringkasan pembelian harga pokok produksi.</DialogDescription>
        </DialogHeader>

        {detailQuery.isFetching ? (
          <div className="space-y-4">
            <div className="grid gap-2 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-20 rounded-md" />
              ))}
            </div>
            <Skeleton className="h-40 rounded-md" />
          </div>
        ) : (
          <div className="space-y-4">
            {detailQuery.isError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-[12px] text-destructive">
                {detailQuery.error?.message || "Gagal mengambil detail supplier."}
              </div>
            ) : null}

            <div className="grid gap-2 md:grid-cols-2">
              {[
                ["Nama Supplier", detailSupplier?.name],
                ["Telepon", detailSupplier?.phone],
                ["Status", <StatusBadge key="status" status={detailSupplier?.status} />],
                ["Total Pembelian", formatCurrency(purchaseTotal)]
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border p-3">
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                  <div className="mt-1 font-medium">{value || "-"}</div>
                </div>
              ))}
            </div>

            <div className="rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold">Riwayat Pembelian</p>
                <Badge variant="info">{formatNumber(purchaseCount)} transaksi</Badge>
              </div>
              {purchases.length ? (
                <div className="space-y-2">
                  {purchases.slice(0, 6).map((purchase) => (
                    <div key={purchase.id} className="flex items-center justify-between gap-3 rounded-md bg-muted/45 px-3 py-2">
                      <div className="min-w-0">
                        <p className="font-medium">{formatDate(purchase.purchase_date)}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {purchase.outlet?.name || "-"} - {purchase.item_count} item
                        </p>
                      </div>
                      <span className="font-medium">{formatCurrency(purchase.total)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed p-4 text-center text-[12px] text-muted-foreground">
                  Belum ada pembelian dari supplier ini.
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SupplierRowActions({ canToggleStatus, canUpdate, supplier }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const updateSupplier = useUpdateSupplier();
  const toggleSupplierStatus = useToggleSupplierStatus();
  const isInactive = supplier.status === "inactive";

  return (
    <>
      <InlineRowActions>
        <RowActionButton label={`Detail ${supplier.name}`} onClick={() => setDetailOpen(true)}>
          <Eye />
        </RowActionButton>
        {canUpdate ? (
          <RowActionButton label={`Edit ${supplier.name}`} onClick={() => setEditOpen(true)}>
            <Edit />
          </RowActionButton>
        ) : null}
        {canToggleStatus ? (
          <RowActionButton
            disabled={toggleSupplierStatus.isPending}
            label={toggleSupplierStatus.isPending ? "Memproses..." : isInactive ? `Aktifkan ${supplier.name}` : `Nonaktifkan ${supplier.name}`}
            onClick={() => toggleSupplierStatus.mutate(supplier.id)}
          >
            {toggleSupplierStatus.isPending ? <Loader2 className="animate-spin" /> : isInactive ? <Power /> : <PowerOff />}
          </RowActionButton>
        ) : null}
      </InlineRowActions>

      <SupplierDetailDialog supplier={supplier} open={detailOpen} onOpenChange={setDetailOpen} />
      <SupplierFormDialog
        mode="edit"
        supplier={supplier}
        open={editOpen}
        onOpenChange={setEditOpen}
        isPending={updateSupplier.isPending}
        onSubmit={(values) => updateSupplier.mutateAsync({ id: supplier.id, payload: values })}
      />
    </>
  );
}

function isActiveProductPrice(price) {
  return Number(price?.price || 0) > 0 && price?.status !== "inactive";
}

function productPricesForOutlet(product, selectedOutletId = "all") {
  const prices = product?.prices || [];
  return prices.filter(
    (price) =>
      isActiveProductPrice(price) &&
      (selectedOutletId === "all" || price.outlet_id === selectedOutletId)
  );
}

function ProductPriceCell({ product, selectedOutletId }) {
  const prices = productPricesForOutlet(product, selectedOutletId);

  if (!prices.length) {
    return (
      <span className="text-[12px] text-muted-foreground">
        {selectedOutletId === "all" ? "Belum ada harga" : "Belum ada harga di outlet ini"}
      </span>
    );
  }

  if (selectedOutletId !== "all") {
    return <span className="font-semibold tabular-nums">{formatCurrency(prices[0].price)}</span>;
  }

  const visiblePrices = prices.slice(0, 2);
  const remainingCount = prices.length - visiblePrices.length;

  return (
    <div className="space-y-1">
      {visiblePrices.map((price) => (
        <div key={price.id} className="rounded-md bg-muted/35 px-2 py-1 leading-tight">
          <p className="truncate text-[11px] text-muted-foreground">{price.outlet?.name || "-"}</p>
          <p className="font-semibold tabular-nums">{formatCurrency(price.price)}</p>
        </div>
      ))}
      {remainingCount > 0 ? <Badge variant="info">+{remainingCount} outlet</Badge> : null}
    </div>
  );
}

function ProductNameCell({ product }) {
  return (
    <div className="flex items-center gap-3">
      <ProductThumbnail product={product} />
      <div className="min-w-0">
        <p className="truncate font-medium">{product.name}</p>
        <p className="text-[11px] text-muted-foreground">{product.image_url ? "Ada gambar" : "Tanpa gambar"}</p>
      </div>
    </div>
  );
}

function ProductCompositionCell({ product }) {
  const composition = product?.composition || [];
  if (!composition.length) {
    return <Badge variant="muted">Belum ada</Badge>;
  }

  const visibleComposition = composition.slice(0, 2);
  const remainingCount = composition.length - visibleComposition.length;

  return (
    <div className="flex max-w-[280px] flex-wrap gap-1">
      {visibleComposition.map((item) => (
        <Badge key={item.id || item.material_id} variant="info" className="max-w-full">
          <span className="truncate">{item.material?.name || item.material_name || "HPP belum terhubung"}</span>
        </Badge>
      ))}
      {remainingCount > 0 ? <Badge variant="muted">+{remainingCount}</Badge> : null}
    </div>
  );
}

function ProdukPage() {
  const { categories, isFetching, isLoading, materials, outlets, products, selectedOutletId, session } = useMasterDataPage();
  const createProduct = useCreateProduct();
  const canCreateProduct = can(session, "master.products", "create");
  const canUpdateProduct = can(session, "master.products", "update");
  const canToggleProductStatus = can(session, "master.products", "toggle_status");
  const canManageProductPrice = can(session, "master.products", "manage_price");
  const canManageProductComposition = can(session, "master.products", "manage_composition");

  return (
    <DataTable
      title="Produk"
      description="Master produk/menu, kategori, harga, dan komposisi harga pokok produksi."
      data={products}
      isFetching={isFetching}
      isLoading={isLoading}
      searchKeys={["name", "sku", "category.name"]}
      emptyText="Belum ada produk."
      actions={
        canCreateProduct ? (
        <ProductFormDialog
          categories={categories}
          outlets={outlets}
          materials={materials}
          canManageComposition={canManageProductComposition}
          canManagePrice={canManageProductPrice}
          isPending={createProduct.isPending}
          onSubmit={(values) => createProduct.mutateAsync(values)}
          trigger={
            <Button disabled={createProduct.isPending}>
              {createProduct.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
              {createProduct.isPending ? "Menyimpan..." : "Tambah Produk"}
            </Button>
          }
        />
        ) : null
      }
      columns={[
        { key: "sku", label: "SKU" },
        { key: "name", label: "Produk", render: (row) => <ProductNameCell product={row} />, className: "min-w-[260px]" },
        { key: "category", label: "Kategori", render: (row) => row.category?.name },
        {
          key: "price",
          label: "Harga",
          render: (row) => <ProductPriceCell product={row} selectedOutletId={selectedOutletId} />,
          sortValue: (row) => productPricesForOutlet(row, selectedOutletId)[0]?.price || 0,
          className: "min-w-[150px] max-w-[220px]"
        },
        {
          key: "composition_count",
          label: "Komposisi",
          render: (row) => <ProductCompositionCell product={row} />
        },
        {
          key: "variant_count",
          label: "Variant",
          render: (row) => <Badge variant={Number(row.variant_count || 0) ? "info" : "muted"}>{Number(row.variant_count || 0)} variant</Badge>
        },
        { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
        {
          key: "actions",
          label: "Aksi",
          render: (row) => (
            <ProductRowActions
              product={row}
              categories={categories}
              outlets={outlets}
              materials={materials}
              canUpdate={canUpdateProduct}
              canToggleStatus={canToggleProductStatus}
              canManagePrice={canManageProductPrice}
              canManageComposition={canManageProductComposition}
            />
          ),
          className: "text-right whitespace-nowrap",
          headerClassName: "text-right"
        }
      ]}
    />
  );
}

function getBarcodeBars(value) {
  const source = String(value || "CUST-BAROKAH");
  const bits = source
    .split("")
    .flatMap((char) => char.charCodeAt(0).toString(2).padStart(8, "0").split(""))
    .map((bit, index) => ({
      id: `${bit}-${index}`,
      width: bit === "1" ? 3 : 1,
      height: index % 5 === 0 ? 58 : 50
    }));

  return [
    { id: "start-1", width: 3, height: 62 },
    { id: "start-2", width: 1, height: 62 },
    ...bits,
    { id: "end-1", width: 1, height: 62 },
    { id: "end-2", width: 3, height: 62 }
  ];
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function printCustomerBarcode(customer) {
  const bars = getBarcodeBars(customer.barcode)
    .map((bar) => `<span style="display:block;width:${bar.width}px;height:${bar.height}px;background:#111;"></span>`)
    .join("");
  const printWindow = window.open("", "_blank", "width=420,height=560");

  if (!printWindow) return;

  printWindow.document.write(`
    <html>
      <head>
        <title>Barcode ${escapeHtml(customer.barcode)}</title>
        <style>
          body { font-family: Inter, Arial, sans-serif; margin: 24px; color: #2C3947; }
          .label { border: 1px solid #d7e0e7; border-radius: 8px; padding: 18px; width: 320px; }
          .brand { font-size: 11px; color: #547A95; text-transform: uppercase; letter-spacing: .08em; }
          .name { margin-top: 4px; font-size: 18px; font-weight: 700; }
          .meta { margin-top: 2px; font-size: 12px; color: #547A95; }
          .barcode { display: flex; align-items: flex-end; gap: 1px; height: 70px; margin-top: 16px; overflow: hidden; }
          .code { margin-top: 8px; font-size: 14px; font-weight: 700; letter-spacing: .12em; text-align: center; }
          @media print { body { margin: 0; } .label { border-color: #000; } }
        </style>
      </head>
      <body>
        <div class="label">
          <div class="brand">Barokah Group Customer</div>
          <div class="name">${escapeHtml(customer.name)}</div>
          <div class="meta">${escapeHtml(customer.outlet?.name)} - ${escapeHtml(customer.phone)}</div>
          <div class="barcode">${bars}</div>
          <div class="code">${escapeHtml(customer.barcode)}</div>
        </div>
        <script>window.print(); window.close();</script>
      </body>
    </html>
  `);
  printWindow.document.close();
  adminApi
    .createActivityLog({
      module: "customer",
      action: "customer/print_barcode",
      entity_type: "customer",
      entity_id: customer.id,
      outlet_id: customer.outlet_id,
      description: `Print barcode customer ${customer.name}.`,
      metadata_json: { barcode: customer.barcode }
    })
    .catch(() => {});
}

function BarcodePreview({ customer }) {
  const bars = getBarcodeBars(customer?.barcode);

  return (
    <div className="rounded-md border bg-card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Barokah Group Customer</p>
      <p className="mt-1 text-[16px] font-semibold">{customer?.name || "-"}</p>
      <p className="text-[12px] text-muted-foreground">
        {customer?.outlet?.name || "-"} - {customer?.phone || "-"}
      </p>
      <div className="mt-4 flex h-[70px] items-end gap-px overflow-hidden rounded-sm bg-white p-2">
        {bars.map((bar) => (
          <span key={bar.id} style={{ width: bar.width, height: bar.height }} className="block shrink-0 bg-[#111]" />
        ))}
      </div>
      <p className="mt-2 text-center text-[14px] font-semibold tracking-widest">{customer?.barcode || "-"}</p>
    </div>
  );
}

function getCustomerFormDefaults({ customer, outlets, selectedOutletId }) {
  const defaultOutletId = selectedOutletId && selectedOutletId !== "all" ? selectedOutletId : outlets[0]?.id || "";

  return {
    outlet_id: customer?.outlet_id || defaultOutletId,
    name: customer?.name || "",
    phone: customer?.phone || "",
    barcode: customer?.barcode || "",
    status: customer?.status || "active"
  };
}

function CustomerFormDialog({ canGenerateBarcode = true, isPending = false, mode = "create", onOpenChange, onSubmit, open, outlets, selectedOutletId, trigger, customer }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;
  const defaults = useMemo(
    () => getCustomerFormDefaults({ customer, outlets, selectedOutletId }),
    [customer, outlets, selectedOutletId]
  );
  const toast = useToast();
  const barcodeMutation = useGenerateCustomerBarcode();
  const lastGeneratedOutletRef = useRef("");
  const {
    control,
    handleSubmit,
    register,
    reset,
    setValue,
    formState: { errors, isDirty, isSubmitting }
  } = useForm({
    defaultValues: defaults
  });
  const outletId = useWatch({ control, name: "outlet_id" });
  const isEdit = mode === "edit";

  useEffect(() => {
    if (isOpen) {
      reset(defaults);
    } else {
      lastGeneratedOutletRef.current = "";
    }
  }, [defaults, isOpen, reset]);

  useEffect(() => {
    if (isOpen && !isEdit && canGenerateBarcode && outletId && lastGeneratedOutletRef.current !== outletId) {
      lastGeneratedOutletRef.current = outletId;
      requestBackendBarcode(outletId, false);
    }
  }, [canGenerateBarcode, isEdit, isOpen, outletId]);

  async function requestBackendBarcode(nextOutletId, shouldDirty = true) {
    try {
      const result = await barcodeMutation.mutateAsync(nextOutletId);
      setValue("barcode", result.barcode || "", {
        shouldDirty,
        shouldValidate: true
      });
    } catch (error) {
      toast({
        title: "Gagal generate barcode",
        description: error.message,
        variant: "destructive"
      });
    }
  }

  function handleGenerateBarcode() {
    if (!outletId) return;
    lastGeneratedOutletRef.current = outletId;
    requestBackendBarcode(outletId);
  }

  async function submit(values) {
    await onSubmit({
      outlet_id: values.outlet_id,
      name: values.name.trim(),
      phone: values.phone.trim(),
      barcode: values.barcode,
      status: values.status
    });
    reset(defaults);
    setOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Customer" : "Tambah Customer"}</DialogTitle>
          <DialogDescription>Customer dibuat per outlet dan memiliki barcode unik untuk POS Android.</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit(submit)}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Outlet</Label>
              <Controller
                name="outlet_id"
                control={control}
                rules={{ required: "Outlet wajib dipilih" }}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={outlets.length <= 1}>
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
              <ProductFieldError errors={errors} path="outlet_id" />
            </div>

            <div className="space-y-1.5">
              <Label>Status</Label>
              <Controller
                name="status"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Aktif</SelectItem>
                      <SelectItem value="inactive">Nonaktif</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="customer-name">Nama Customer</Label>
              <Input
                id="customer-name"
                placeholder="Contoh: Andi Wijaya"
                {...register("name", {
                  required: "Nama customer wajib diisi",
                  minLength: { value: 2, message: "Nama customer minimal 2 karakter" }
                })}
              />
              <ProductFieldError errors={errors} path="name" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="customer-phone">Nomor HP</Label>
              <Input
                id="customer-phone"
                placeholder="081210010001"
                {...register("phone", {
                  required: "Nomor HP wajib diisi",
                  minLength: { value: 8, message: "Nomor HP minimal 8 karakter" }
                })}
              />
              <ProductFieldError errors={errors} path="phone" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="customer-barcode">Barcode</Label>
            <div className="flex gap-2">
              <Input
                id="customer-barcode"
                readOnly
                className="font-semibold tracking-wide"
                placeholder="Dibuat otomatis saat simpan"
                {...register("barcode")}
              />
              {canGenerateBarcode ? (
                <Button type="button" variant="outline" disabled={barcodeMutation.isPending || !outletId} onClick={handleGenerateBarcode}>
                  {barcodeMutation.isPending ? <Loader2 className="animate-spin" /> : <Barcode />}
                  {barcodeMutation.isPending ? "Generate..." : "Generate"}
                </Button>
              ) : null}
            </div>
            <p className="text-[11px] text-muted-foreground">Barcode otomatis mengikuti kode outlet dan nomor urut customer.</p>
          </div>

          {isDirty ? <p className="text-[11px] text-muted-foreground">Perubahan belum disimpan.</p> : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting || isPending || barcodeMutation.isPending}>
              {isSubmitting || isPending ? <Loader2 className="animate-spin" /> : null}
              {isSubmitting || isPending ? "Menyimpan..." : isEdit ? "Simpan Perubahan" : "Simpan Customer"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CustomerBarcodeDialog({ customer, onOpenChange, open }) {
  const detailQuery = useCustomerDetail(customer?.id, { enabled: open });
  const detailCustomer = detailQuery.data || customer;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Preview Barcode</DialogTitle>
          <DialogDescription>Barcode ini bisa dicetak untuk kartu/member customer.</DialogDescription>
        </DialogHeader>
        {detailQuery.isFetching ? (
          <div className="space-y-3 rounded-md border border-dashed p-3">
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Mengambil detail customer dari backend...
            </div>
            <div className="h-32 animate-pulse rounded-md bg-muted" />
          </div>
        ) : null}
        {detailQuery.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-[12px] text-destructive">
            {detailQuery.error?.message || "Gagal mengambil detail customer."}
          </div>
        ) : null}
        <BarcodePreview customer={detailCustomer} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Tutup
          </Button>
          <Button type="button" disabled={!detailCustomer?.barcode} onClick={() => printCustomerBarcode(detailCustomer)}>
            <Printer />
            Print Barcode
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CustomerRowActions({ canGenerateBarcode, canPrintCustomer, canToggleCustomer, canUpdateCustomer, customer, outlets, selectedOutletId }) {
  const [editOpen, setEditOpen] = useState(false);
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const updateCustomer = useUpdateCustomer();
  const toggleCustomerStatus = useToggleCustomerStatus();
  const isInactive = customer.status === "inactive";
  const hasActions = canPrintCustomer || canUpdateCustomer || canToggleCustomer;

  if (!hasActions) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <>
      <InlineRowActions>
        {canPrintCustomer ? (
          <>
            <RowActionButton label={`Preview barcode ${customer.name}`} onClick={() => setBarcodeOpen(true)}>
              <Eye />
            </RowActionButton>
            <RowActionButton label={`Print barcode ${customer.name}`} onClick={() => printCustomerBarcode(customer)}>
              <Printer />
            </RowActionButton>
          </>
        ) : null}
        {canUpdateCustomer ? (
          <RowActionButton label={`Edit ${customer.name}`} onClick={() => setEditOpen(true)}>
            <Edit />
          </RowActionButton>
        ) : null}
        {canToggleCustomer ? (
          <RowActionButton
            disabled={toggleCustomerStatus.isPending}
            label={toggleCustomerStatus.isPending ? "Memproses..." : isInactive ? `Aktifkan ${customer.name}` : `Nonaktifkan ${customer.name}`}
            onClick={() => toggleCustomerStatus.mutate(customer.id)}
          >
            {toggleCustomerStatus.isPending ? <Loader2 className="animate-spin" /> : isInactive ? <Power /> : <PowerOff />}
          </RowActionButton>
        ) : null}
      </InlineRowActions>

      <CustomerFormDialog
        mode="edit"
        customer={customer}
        outlets={outlets}
        selectedOutletId={selectedOutletId}
        canGenerateBarcode={canGenerateBarcode}
        isPending={updateCustomer.isPending}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSubmit={(values) => updateCustomer.mutateAsync({ id: customer.id, payload: values })}
      />
      <CustomerBarcodeDialog customer={customer} open={barcodeOpen} onOpenChange={setBarcodeOpen} />
    </>
  );
}

function CustomerPage() {
  const { customers, isFetching, isLoading, outlets, selectedOutletId, session } = useMasterDataPage();
  const createCustomer = useCreateCustomer();
  const canCreateCustomer = can(session, "master.customers", "create");
  const canGenerateBarcode = can(session, "master.customers", "generate_barcode");
  const canPrintCustomer = can(session, "master.customers", "print_barcode");
  const canToggleCustomer = can(session, "master.customers", "toggle_status");
  const canUpdateCustomer = can(session, "master.customers", "update");
  const accessibleOutlets = outlets.filter((outlet) => session?.outlet_ids?.includes(outlet.id));
  const customerOutlets = accessibleOutlets.length ? accessibleOutlets : outlets;

  return (
    <DataTable
      title="Customer"
      description="Customer difilter per outlet, bisa dibuat per outlet, dan memiliki barcode unik."
      data={customers}
      isFetching={isFetching}
      isLoading={isLoading}
      searchKeys={["name", "phone", "barcode", "outlet.name"]}
      actions={
        canCreateCustomer ? (
          <CustomerFormDialog
            outlets={customerOutlets}
            selectedOutletId={selectedOutletId}
            canGenerateBarcode={canGenerateBarcode}
            isPending={createCustomer.isPending}
            onSubmit={(values) => createCustomer.mutateAsync(values)}
            trigger={
              <Button disabled={createCustomer.isPending}>
                {createCustomer.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                {createCustomer.isPending ? "Menyimpan..." : "Tambah Customer"}
              </Button>
            }
          />
        ) : null
      }
      columns={[
        { key: "name", label: "Nama", className: "font-medium" },
        { key: "phone", label: "HP" },
        { key: "outlet", label: "Outlet", render: (row) => row.outlet?.name },
        {
          key: "barcode",
          label: "Barcode",
          render: (row) => (
            <span className="inline-flex items-center gap-2 font-medium text-primary">
              <Barcode className="h-4 w-4" />
              {row.barcode}
            </span>
          )
        },
        { key: "registered_at", label: "Terdaftar", render: (row) => formatDate(row.registered_at), sortValue: (row) => row.registered_at },
        { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
        {
          key: "actions",
          label: "Aksi",
          render: (row) => (
            <CustomerRowActions
              customer={row}
              outlets={customerOutlets}
              selectedOutletId={selectedOutletId}
              canGenerateBarcode={canGenerateBarcode}
              canPrintCustomer={canPrintCustomer}
              canToggleCustomer={canToggleCustomer}
              canUpdateCustomer={canUpdateCustomer}
            />
          ),
          className: "text-right whitespace-nowrap",
          headerClassName: "text-right"
        }
      ]}
    />
  );
}

function getUserFormDefaults({ outlets, roles, user }) {
  const adminRole = roles.find((role) => role.id === "role_admin");

  return {
    name: user?.name || "",
    username: user?.username || "",
    email: user?.email || "",
    role_id: user?.role_id || adminRole?.id || roles[0]?.id || "",
    cashier_pin: "",
    outlet_ids: user?.outlet_ids?.length ? user.outlet_ids : outlets[0]?.id ? [outlets[0].id] : [],
    status: user?.status || "active"
  };
}

function UserOutletSelector({ control, errors, outlets }) {
  const selectedOutletIds = useWatch({ control, name: "outlet_ids" }) || [];

  return (
    <Controller
      name="outlet_ids"
      control={control}
      rules={{
        validate: (value) => (value?.length ? true : "Minimal 1 outlet wajib dipilih")
      }}
      render={({ field }) => (
        <div className="space-y-2">
          <div className="grid gap-2 md:grid-cols-2">
            {outlets.map((outlet) => {
              const checked = selectedOutletIds.includes(outlet.id);
              return (
                <label key={outlet.id} className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-[12px]">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={checked}
                    onChange={(event) => {
                      const nextValue = event.target.checked
                        ? [...new Set([...(field.value || []), outlet.id])]
                        : (field.value || []).filter((id) => id !== outlet.id);
                      field.onChange(nextValue);
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{outlet.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{outlet.code}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <ProductFieldError errors={errors} path="outlet_ids" />
        </div>
      )}
    />
  );
}

function UserFormDialog({ isPending = false, mode = "create", onOpenChange, onSubmit, open, outlets, roles, trigger, user }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;
  const defaults = useMemo(() => getUserFormDefaults({ outlets, roles, user }), [outlets, roles, user]);
  const {
    control,
    handleSubmit,
    register,
    reset,
    formState: { errors, isDirty, isSubmitting }
  } = useForm({
    defaultValues: defaults
  });
  const isEdit = mode === "edit";
  const selectedRoleId = useWatch({ control, name: "role_id" });
  const selectedRole = roles.find((role) => role.id === selectedRoleId);
  const isApkRole = hasApkAccess(selectedRole);
  const wasApkRole = hasApkAccess(user?.role);

  useEffect(() => {
    if (isOpen) {
      reset(defaults);
    }
  }, [defaults, isOpen, reset]);

  async function submit(values) {
    const payload = {
      name: values.name.trim(),
      username: values.username.trim().toLowerCase(),
      email: values.email.trim().toLowerCase(),
      role_id: values.role_id,
      outlet_ids: values.outlet_ids,
      status: values.status
    };

    const cashierPin = String(values.cashier_pin || "").trim();
    if (hasApkAccess(roles.find((role) => role.id === values.role_id)) && cashierPin) {
      payload.cashier_pin = cashierPin;
    }

    await onSubmit(payload);
    reset(defaults);
    setOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit User" : "Tambah User"}</DialogTitle>
          <DialogDescription>Kelola akun admin/kasir, role, outlet akses, PIN kasir, dan status user.</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit(submit)}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="user-name">Nama</Label>
              <Input
                id="user-name"
                placeholder="Nama lengkap"
                {...register("name", {
                  required: "Nama wajib diisi",
                  minLength: { value: 2, message: "Nama minimal 2 karakter" }
                })}
              />
              <ProductFieldError errors={errors} path="name" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-username">Username</Label>
              <Input
                id="user-username"
                placeholder="admin.outlet"
                {...register("username", {
                  required: "Username wajib diisi",
                  minLength: { value: 3, message: "Username minimal 3 karakter" },
                  validate: {
                    noWhitespace: (value) => !/\s/.test(value) || "Username tidak boleh memakai spasi",
                    allowedCharacters: (value) =>
                      /^[A-Za-z0-9._-]+$/.test(value) || "Username hanya boleh huruf, angka, titik, underscore, atau strip"
                  }
                })}
              />
              <ProductFieldError errors={errors} path="username" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                placeholder="admin@barokah.local"
                {...register("email", {
                  required: "Email wajib diisi",
                  pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Format email tidak valid" }
                })}
              />
              <ProductFieldError errors={errors} path="email" />
            </div>

            <div className="space-y-1.5">
              <Label>Role</Label>
              <Controller
                name="role_id"
                control={control}
                rules={{ required: "Role wajib dipilih" }}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih role" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          {role.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <ProductFieldError errors={errors} path="role_id" />
            </div>

            {isApkRole ? (
              <div className="space-y-1.5">
                <Label htmlFor="user-cashier-pin">PIN APK</Label>
                <Input
                  id="user-cashier-pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder={isEdit ? "Kosongkan jika tidak diubah" : "000000"}
                  autoComplete="new-password"
                  {...register("cashier_pin", {
                    validate: (value) => {
                      const pin = String(value || "").trim();
                      if (!isApkRole) return true;
                      if ((!isEdit || !wasApkRole || !user?.has_pin) && !pin) return "PIN APK wajib diisi 6 digit";
                      if (pin && !/^\d{6}$/.test(pin)) return "PIN APK wajib 6 digit angka";
                      return true;
                    }
                  })}
                />
                <p className="text-[11px] text-muted-foreground">
                  Role ini memiliki permission APK. PIN dipakai untuk login APK dan tidak ditampilkan kembali setelah disimpan.
                </p>
                <ProductFieldError errors={errors} path="cashier_pin" />
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label>Outlet Akses</Label>
            <p className="text-[11px] text-muted-foreground">Relasi outlet menentukan data outlet mana yang bisa diakses user ini.</p>
            <UserOutletSelector control={control} errors={errors} outlets={outlets} />
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Aktif</SelectItem>
                    <SelectItem value="inactive">Nonaktif</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {isDirty ? <p className="text-[11px] text-muted-foreground">Perubahan belum disimpan.</p> : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" disabled={isSubmitting || isPending} onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting || isPending}>
              {isSubmitting || isPending ? <Loader2 className="animate-spin" /> : null}
              {isSubmitting || isPending ? "Menyimpan..." : isEdit ? "Simpan Perubahan" : "Simpan User"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UserRowActions({ canResetPassword, canToggleStatus, canUpdate, currentUserId, outlets, roles, user }) {
  const [editOpen, setEditOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const updateUser = useUpdateUser();
  const toggleUserStatus = useToggleUserStatus();
  const resetPassword = useResetUserPassword();
  const isInactive = user.status === "inactive";
  const isCurrentUser = user.id === currentUserId;
  const canShowResetPassword = canResetPassword && hasAdminAccess(user.role);

  if (!canUpdate && !canShowResetPassword && !canToggleStatus) {
    return <span className="text-muted-foreground">-</span>;
  }

  async function handleResetPassword(event) {
    event.preventDefault();
    try {
      const result = await resetPassword.mutateAsync(user.id);
      setTemporaryPassword(result.temporary_password);
      setPasswordOpen(true);
    } catch {
      // Error toast is handled by the mutation hook.
    }
  }

  return (
    <>
      <InlineRowActions>
        {canUpdate ? (
          <RowActionButton label={`Edit ${user.name}`} onClick={() => setEditOpen(true)}>
            <Edit />
          </RowActionButton>
        ) : null}
        {canShowResetPassword ? (
          <RowActionButton
            disabled={resetPassword.isPending}
            label={resetPassword.isPending ? "Memproses..." : `Reset password ${user.name}`}
            onClick={handleResetPassword}
          >
            {resetPassword.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}
          </RowActionButton>
        ) : null}
        {canToggleStatus ? (
          <RowActionButton
            disabled={toggleUserStatus.isPending}
            label={toggleUserStatus.isPending ? "Memproses..." : isInactive ? `Aktifkan ${user.name}` : isCurrentUser ? "Nonaktifkan saya" : `Nonaktifkan ${user.name}`}
            onClick={() => toggleUserStatus.mutate(user.id)}
          >
            {toggleUserStatus.isPending ? <Loader2 className="animate-spin" /> : isInactive ? <Power /> : <PowerOff />}
          </RowActionButton>
        ) : null}
      </InlineRowActions>

      <UserFormDialog
        mode="edit"
        user={user}
        roles={roles}
        outlets={outlets}
        open={editOpen}
        onOpenChange={setEditOpen}
        isPending={updateUser.isPending}
        onSubmit={(values) => updateUser.mutateAsync({ id: user.id, payload: values })}
      />

      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Password Sementara</DialogTitle>
            <DialogDescription>Berikan password ini ke user lalu minta user menggantinya di backend final.</DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/45 p-4 text-center">
            <p className="text-[11px] text-muted-foreground">User</p>
            <p className="font-medium">{user.name}</p>
            <p className="mt-3 text-[11px] text-muted-foreground">Password Sementara</p>
            <p className="mt-1 text-[20px] font-semibold tracking-wider text-primary">{temporaryPassword}</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UserOutletBadges({ outlets = [] }) {
  const assignedOutlets = Array.isArray(outlets) ? outlets.filter((outlet) => outlet?.name) : [];
  if (!assignedOutlets.length) {
    return <Badge variant="warning" className="whitespace-nowrap">Belum ada outlet</Badge>;
  }

  return (
    <div className="flex max-w-[360px] flex-wrap gap-1">
      {assignedOutlets.map((outlet) => (
        <Badge key={outlet.id || outlet.name} variant="outline" className="border-[#547A95]/40 bg-[#547A95]/10 text-[#335C78]">
          {outlet.name}
        </Badge>
      ))}
    </div>
  );
}

function UserPermissionPage() {
  const { isFetching, isLoading, outlets, roles, session, users } = useMasterDataPage();
  const createUser = useCreateUser();
  const canCreateUser = can(session, "master.users", "create");
  const canResetUserPassword = can(session, "master.users", "reset_password");
  const canToggleUserStatus = can(session, "master.users", "toggle_status");
  const canUpdateUser = can(session, "master.users", "update");

  return (
    <DataTable
      title="User & Permission"
      description="Kelola akun, role, outlet assignment, reset password, dan status user."
      data={users}
      isFetching={isFetching}
      isLoading={isLoading}
      searchKeys={["name", "username", "email", "role.name", "outlets.name"]}
      actions={
        canCreateUser ? (
          <UserFormDialog
            roles={roles}
            outlets={outlets}
            isPending={createUser.isPending}
            onSubmit={(values) => createUser.mutateAsync(values)}
            trigger={
              <Button disabled={createUser.isPending}>
                {createUser.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                {createUser.isPending ? "Menyimpan..." : "Tambah User"}
              </Button>
            }
          />
        ) : null
      }
      columns={[
        {
          key: "name",
          label: "Nama",
          className: "font-medium",
          render: (row) => (
            <span className="inline-flex items-center gap-2">
              {row.name}
              {row.id === session?.id ? (
                <Badge variant="default" className="border-primary/30 bg-primary/10 text-primary">Saya</Badge>
              ) : null}
            </span>
          )
        },
        { key: "username", label: "Username" },
        { key: "email", label: "Email" },
        {
          key: "role",
          label: "Role",
          render: (row) =>
            row.role?.name ? (
              <Badge variant="info" className="whitespace-nowrap">{row.role.name}</Badge>
            ) : (
              <Badge variant="warning" className="whitespace-nowrap">Belum terhubung</Badge>
            ),
          sortValue: (row) => row.role?.name || row.role_id || ""
        },
        {
          key: "has_pin",
          label: "PIN APK",
          render: (row) =>
            hasApkAccess(row.role) ? (
              <Badge variant={row.has_pin ? "success" : "warning"} className="whitespace-nowrap">
                {row.has_pin ? "PIN diset" : "PIN belum diset"}
              </Badge>
            ) : (
              <span className="text-muted-foreground">-</span>
            )
        },
        {
          key: "outlets",
          label: "Outlet",
          render: (row) => <UserOutletBadges outlets={row.outlets} />,
          sortValue: (row) => (Array.isArray(row.outlets) ? row.outlets.map((outlet) => outlet?.name).filter(Boolean).join(" ") : "")
        },
        {
          key: "last_login_at",
          label: "Login Terakhir",
          render: (row) => (row.last_login_at ? formatDateTime(row.last_login_at) : "-"),
          sortValue: (row) => row.last_login_at || ""
        },
        { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
        {
          key: "actions",
          label: "Aksi",
          render: (row) => (
            <UserRowActions
              user={row}
              roles={roles}
              outlets={outlets}
              currentUserId={session?.id}
              canUpdate={canUpdateUser}
              canResetPassword={canResetUserPassword}
              canToggleStatus={canToggleUserStatus}
            />
          ),
          className: "text-right whitespace-nowrap",
          headerClassName: "text-right"
        }
      ]}
    />
  );
}

function getOutletFormDefaults(outlet) {
  return {
    name: outlet?.name || "",
    code: outlet?.code || "",
    address: outlet?.address || "",
    phone: outlet?.phone || "",
    opened_at: outlet?.opened_at || toDateString(new Date()),
    status: outlet?.status || "active"
  };
}

function OutletFormDialog({ isPending = false, mode = "create", onOpenChange, onSubmit, open, outlet, trigger }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;
  const defaults = useMemo(() => getOutletFormDefaults(outlet), [outlet]);
  const {
    control,
    handleSubmit,
    register,
    reset,
    formState: { errors, isDirty, isSubmitting }
  } = useForm({
    defaultValues: defaults
  });
  const isEdit = mode === "edit";

  useEffect(() => {
    if (isOpen) {
      reset(defaults);
    }
  }, [defaults, isOpen, reset]);

  async function submit(values) {
    await onSubmit({
      name: values.name.trim(),
      code: values.code.trim().toUpperCase(),
      address: values.address.trim(),
      phone: values.phone.trim(),
      opened_at: values.opened_at,
      status: values.status
    });
    reset(defaults);
    setOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Outlet" : "Tambah Outlet"}</DialogTitle>
          <DialogDescription>Outlet dipakai untuk filter dashboard, customer, dan laporan. Harga produk dan stok harga pokok produksi ditambahkan manual.</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit(submit)}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="outlet-name">Nama Outlet</Label>
              <Input
                id="outlet-name"
                placeholder="Contoh: Barokah Cabang 3"
                {...register("name", {
                  required: "Nama outlet wajib diisi",
                  minLength: { value: 2, message: "Nama outlet minimal 2 karakter" }
                })}
              />
              <ProductFieldError errors={errors} path="name" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="outlet-code">Kode Outlet</Label>
              <Input
                id="outlet-code"
                placeholder="BKC3"
                className="uppercase"
                {...register("code", {
                  required: "Kode outlet wajib diisi",
                  minLength: { value: 2, message: "Kode outlet minimal 2 karakter" }
                })}
              />
              <ProductFieldError errors={errors} path="code" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="outlet-phone">Telepon</Label>
              <Input
                id="outlet-phone"
                placeholder="021-555-0303"
                {...register("phone", {
                  required: "Telepon wajib diisi",
                  minLength: { value: 6, message: "Telepon minimal 6 karakter" }
                })}
              />
              <ProductFieldError errors={errors} path="phone" />
            </div>

            <div className="space-y-1.5">
              <Label>Tanggal Buka</Label>
              <Controller
                name="opened_at"
                control={control}
                rules={{ required: "Tanggal buka wajib diisi" }}
                render={({ field }) => <DatePicker value={field.value} onChange={field.onChange} />}
              />
              <ProductFieldError errors={errors} path="opened_at" />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="outlet-address">Alamat</Label>
              <Input
                id="outlet-address"
                placeholder="Jl. Kenanga No. 8, Depok"
                {...register("address", {
                  required: "Alamat wajib diisi",
                  minLength: { value: 5, message: "Alamat minimal 5 karakter" }
                })}
              />
              <ProductFieldError errors={errors} path="address" />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label>Status</Label>
              <Controller
                name="status"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Aktif</SelectItem>
                      <SelectItem value="inactive">Nonaktif</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          {isDirty ? <p className="text-[11px] text-muted-foreground">Perubahan belum disimpan.</p> : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" disabled={isSubmitting || isPending} onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting || isPending}>
              {isSubmitting || isPending ? <Loader2 className="animate-spin" /> : null}
              {isSubmitting || isPending ? "Menyimpan..." : isEdit ? "Simpan Perubahan" : "Simpan Outlet"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OutletDetailDialog({ onOpenChange, open, outlet }) {
  const detailQuery = useOutletDetail(outlet?.id, { enabled: open });
  const detailOutlet = detailQuery.data || outlet;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Detail Outlet</DialogTitle>
          <DialogDescription>Profil outlet dan ringkasan data operasional.</DialogDescription>
        </DialogHeader>

        {detailQuery.isFetching ? (
          <div className="space-y-4">
            <div className="grid gap-2 md:grid-cols-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-20 rounded-md" />
              ))}
            </div>
            <Skeleton className="h-40 rounded-md" />
          </div>
        ) : (
          <div className="space-y-4">
            {detailQuery.isError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-[12px] text-destructive">
                {detailQuery.error?.message || "Gagal mengambil detail outlet."}
              </div>
            ) : null}

            <div className="grid gap-2 md:grid-cols-2">
              {[
                ["Nama Outlet", detailOutlet?.name],
                ["Kode", detailOutlet?.code],
                ["Telepon", detailOutlet?.phone],
                ["Tanggal Buka", detailOutlet?.opened_at ? formatDate(detailOutlet.opened_at) : "-"],
                ["Alamat", detailOutlet?.address],
                ["Status", <StatusBadge key="status" status={detailOutlet?.status} />]
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border p-3">
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                  <div className="mt-1 font-medium">{value || "-"}</div>
                </div>
              ))}
            </div>

            <div className="rounded-md border p-3">
              <p className="mb-2 text-[13px] font-semibold">Ringkasan Operasional</p>
              <div className="grid gap-2 md:grid-cols-3">
                {[
                  ["User Assigned", `${formatNumber(detailOutlet?.user_count || 0)} user`],
                  ["Customer", `${formatNumber(detailOutlet?.customer_count || 0)} customer`],
                  ["Item Stok", `${formatNumber(detailOutlet?.stock_item_count || 0)} produk`],
                  ["Stok Menipis", `${formatNumber(detailOutlet?.low_stock_count || 0)} item`],
                  ["Pembelian", `${formatNumber(detailOutlet?.purchase_count || 0)} transaksi`],
                  ["Total Pembelian", formatCurrency(detailOutlet?.purchase_total || 0)]
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md bg-muted/45 px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">{label}</p>
                    <p className="mt-1 font-medium">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function OutletRowActions({ canToggleStatus, canUpdate, outlet }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const updateOutlet = useUpdateOutlet();
  const toggleOutletStatus = useToggleOutletStatus();
  const isInactive = outlet.status === "inactive";

  return (
    <>
      <InlineRowActions>
        <RowActionButton label={`Detail ${outlet.name}`} onClick={() => setDetailOpen(true)}>
          <Eye />
        </RowActionButton>
        {canUpdate ? (
          <RowActionButton label={`Edit ${outlet.name}`} onClick={() => setEditOpen(true)}>
            <Edit />
          </RowActionButton>
        ) : null}
        {canToggleStatus ? (
          <RowActionButton
            disabled={toggleOutletStatus.isPending}
            label={toggleOutletStatus.isPending ? "Memproses..." : isInactive ? `Aktifkan ${outlet.name}` : `Nonaktifkan ${outlet.name}`}
            onClick={() => toggleOutletStatus.mutate(outlet.id)}
          >
            {toggleOutletStatus.isPending ? <Loader2 className="animate-spin" /> : isInactive ? <Power /> : <PowerOff />}
          </RowActionButton>
        ) : null}
      </InlineRowActions>

      <OutletDetailDialog outlet={outlet} open={detailOpen} onOpenChange={setDetailOpen} />
      <OutletFormDialog
        mode="edit"
        outlet={outlet}
        open={editOpen}
        onOpenChange={setEditOpen}
        isPending={updateOutlet.isPending}
        onSubmit={(values) => updateOutlet.mutateAsync({ id: outlet.id, payload: values })}
      />
    </>
  );
}

function OutletPage() {
  const { isFetching, outlets, isLoading, session } = useMasterDataPage();
  const createOutlet = useCreateOutlet();
  const canCreateOutlet = can(session, "master.outlets", "create");
  const canToggleOutletStatus = can(session, "master.outlets", "toggle_status");
  const canUpdateOutlet = can(session, "master.outlets", "update");

  return (
    <DataTable
      title="Outlet"
      description="Daftar outlet untuk filter dashboard, transaksi, dan laporan. Harga produk serta stok diatur manual."
      data={outlets}
      isFetching={isFetching}
      isLoading={isLoading}
      searchKeys={["name", "code", "address", "phone"]}
      actions={
        canCreateOutlet ? (
          <OutletFormDialog
            isPending={createOutlet.isPending}
            onSubmit={(values) => createOutlet.mutateAsync(values)}
            trigger={
              <Button disabled={createOutlet.isPending}>
                {createOutlet.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                {createOutlet.isPending ? "Menyimpan..." : "Tambah Outlet"}
              </Button>
            }
          />
        ) : null
      }
      columns={[
        { key: "code", label: "Kode", className: "font-medium" },
        { key: "name", label: "Outlet" },
        { key: "address", label: "Alamat" },
        { key: "phone", label: "Telepon" },
        { key: "opened_at", label: "Tanggal Buka", render: (row) => formatDate(row.opened_at), sortValue: (row) => row.opened_at },
        { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
        {
          key: "actions",
          label: "Aksi",
          render: (row) => (
            <OutletRowActions
              outlet={row}
              canUpdate={canUpdateOutlet}
              canToggleStatus={canToggleOutletStatus}
            />
          ),
          className: "text-right whitespace-nowrap",
          headerClassName: "text-right"
        }
      ]}
    />
  );
}

function getTableFormDefaults(table, outlets) {
  const defaultOutlet = outlets.find((outlet) => outlet.status === "active") || outlets[0];

  return {
    outlet_id: table?.outlet_id || defaultOutlet?.id || "",
    number: table?.number || "",
    quantity: 1,
    status: table?.status || "active"
  };
}

function TableFormDialog({ isPending = false, mode = "create", onOpenChange, onSubmit, open, table, trigger, outlets = [] }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;
  const defaults = useMemo(() => getTableFormDefaults(table, outlets), [outlets, table]);
  const {
    control,
    handleSubmit,
    register,
    reset,
    formState: { errors, isDirty, isSubmitting }
  } = useForm({
    defaultValues: defaults
  });
  const isEdit = mode === "edit";

  useEffect(() => {
    if (isOpen) {
      reset(defaults);
    }
  }, [defaults, isOpen, reset]);

  async function submit(values) {
    const payload = isEdit
      ? {
          outlet_id: values.outlet_id,
          number: values.number.trim().toUpperCase(),
          status: values.status
        }
      : {
          outlet_id: values.outlet_id,
          quantity: Number(values.quantity),
          status: values.status
        };

    await onSubmit(payload);
    reset(defaults);
    setOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Meja" : "Tambah Meja"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Meja aktif nantinya tersedia untuk pilihan Dine In di aplikasi kasir."
              : "Masukkan jumlah meja. Nomor akan dibuat otomatis melanjutkan urutan outlet."}
          </DialogDescription>
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
              <ProductFieldError errors={errors} path="outlet_id" />
            </div>

            {isEdit ? (
              <div className="space-y-1.5">
                <Label htmlFor="table-number">Nomor Meja</Label>
                <Input
                  id="table-number"
                  placeholder="A1"
                  className="uppercase"
                  {...register("number", {
                    required: "Nomor meja wajib diisi",
                    minLength: { value: 1, message: "Nomor meja wajib diisi" }
                  })}
                />
                <ProductFieldError errors={errors} path="number" />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="table-quantity">Jumlah Meja</Label>
                <Input
                  id="table-quantity"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="100"
                  step="1"
                  placeholder="10"
                  {...register("quantity", {
                    required: "Jumlah meja wajib diisi",
                    valueAsNumber: true,
                    min: { value: 1, message: "Jumlah meja minimal 1" },
                    max: { value: 100, message: "Jumlah meja maksimal 100" },
                    validate: (value) => Number.isInteger(value) || "Jumlah meja harus berupa bilangan bulat"
                  })}
                />
                <ProductFieldError errors={errors} path="quantity" />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Aktif</SelectItem>
                    <SelectItem value="inactive">Nonaktif</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {isDirty ? <p className="text-[11px] text-muted-foreground">Perubahan belum disimpan.</p> : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" disabled={isPending || isSubmitting} onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting || isPending}>
              {isSubmitting || isPending ? <Loader2 className="animate-spin" /> : null}
              {isSubmitting || isPending ? (isEdit ? "Menyimpan..." : "Membuat...") : isEdit ? "Simpan Perubahan" : "Generate Meja"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TableDetailDialog({ onOpenChange, open, table, users = [] }) {
  const detailQuery = useTableDetail(table?.id, { enabled: open });
  const detailTable = useMemo(() => {
    const detail = detailQuery.data || table;
    const fallbackTransactions = detailQuery.data?.transactions?.length ? detailQuery.data.transactions : table?.transactions || [];
    return normalizeTableRowsWithTransactions(detail ? [detail] : [], fallbackTransactions, {
      outlets: [detail?.outlet, table?.outlet].filter(Boolean),
      users
    })[0] || detail;
  }, [detailQuery.data, table, users]);
  const transactions = detailTable?.transactions || [];
  const isLoadingDetail = detailQuery.isFetching;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Detail Meja</DialogTitle>
          <DialogDescription>Profil meja dan histori transaksi dine in yang pernah memakai meja ini.</DialogDescription>
        </DialogHeader>

        {isLoadingDetail ? (
          <div className="space-y-4">
            <div className="grid gap-2 md:grid-cols-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-20 rounded-md" />
              ))}
            </div>
            <Skeleton className="h-40 rounded-md" />
          </div>
        ) : (
          <div className="space-y-4">
            {detailQuery.isError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-[12px] text-destructive">
                {detailQuery.error?.message || "Gagal mengambil detail meja."}
              </div>
            ) : null}

            <div className="grid gap-2 md:grid-cols-2">
              {[
                ["Nomor Meja", detailTable?.number],
                ["Outlet", detailTable?.outlet?.name],
                ["Jumlah Transaksi", `${formatNumber(detailTable?.transaction_count || 0)} transaksi`],
                ["Total Penjualan", formatCurrency(detailTable?.sales_total || 0)],
                ["Status", <StatusBadge key="status" status={detailTable?.status} />]
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border p-3">
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                  <div className="mt-1 font-medium">{value || "-"}</div>
                </div>
              ))}
            </div>

            <div className="rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold">Histori Transaksi</p>
                <Badge variant="info">{formatNumber(transactions.length)} transaksi</Badge>
              </div>
              {transactions.length ? (
                <div className="space-y-2">
                  {transactions.slice(0, 8).map((transaction) => (
                    <div key={transaction.id} className="flex items-center justify-between gap-3 rounded-md bg-muted/45 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{transaction.order_number}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {formatDateTime(transaction.transaction_date)} - {transaction.cashier?.name || "-"}
                        </p>
                      </div>
                      <span className="font-medium">{formatCurrency(transaction.total)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed p-4 text-center text-[12px] text-muted-foreground">
                  Belum ada transaksi yang memakai meja ini.
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TableRowActions({ canToggleStatus, canUpdate, outlets, table, users = [] }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const updateTable = useUpdateTable();
  const toggleTableStatus = useToggleTableStatus();
  const isInactive = table.status === "inactive";

  return (
    <>
      <InlineRowActions>
        <RowActionButton label={`Detail meja ${table.number}`} onClick={() => setDetailOpen(true)}>
          <Eye />
        </RowActionButton>
        {canUpdate ? (
          <RowActionButton label={`Edit meja ${table.number}`} onClick={() => setEditOpen(true)}>
            <Edit />
          </RowActionButton>
        ) : null}
        {canToggleStatus ? (
          <RowActionButton
            disabled={toggleTableStatus.isPending}
            label={toggleTableStatus.isPending ? "Memproses..." : isInactive ? `Aktifkan meja ${table.number}` : `Nonaktifkan meja ${table.number}`}
            onClick={() => toggleTableStatus.mutate(table.id)}
          >
            {toggleTableStatus.isPending ? <Loader2 className="animate-spin" /> : isInactive ? <Power /> : <PowerOff />}
          </RowActionButton>
        ) : null}
      </InlineRowActions>

      <TableDetailDialog table={table} users={users} open={detailOpen} onOpenChange={setDetailOpen} />
      <TableFormDialog
        mode="edit"
        table={table}
        outlets={outlets}
        open={editOpen}
        onOpenChange={setEditOpen}
        isPending={updateTable.isPending}
        onSubmit={(values) => updateTable.mutateAsync({ id: table.id, payload: values })}
      />
    </>
  );
}

function MejaPage() {
  const { isFetching, isLoading, outlets, selectedOutletId, session, tables, users } = useMasterDataPage();
  const generateTables = useGenerateTables();
  const toast = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const tableReportRange = useMemo(() => {
    const today = new Date();
    return {
      from: toDateString(new Date(today.getFullYear(), today.getMonth(), 1)),
      to: toDateString(today)
    };
  }, []);
  const reportsQuery = useReports({ outletId: selectedOutletId, ...tableReportRange });
  const tableRows = useMemo(
    () => normalizeTableRowsWithTransactions(tables, reportsQuery.data?.transactions || [], { outlets, users }),
    [outlets, reportsQuery.data?.transactions, tables, users]
  );
  const canCreateTable = can(session, "master.tables", "create");
  const canToggleTableStatus = can(session, "master.tables", "toggle_status");
  const canUpdateTable = can(session, "master.tables", "update");

  async function handleExportCatalog() {
    try {
      setIsExporting(true);
      const snapshot = await adminApi.getMobileCatalogSnapshot();
      const blob = new globalThis.Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
      const url = globalThis.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);

      link.href = url;
      link.download = `pos-barokah-mobile-catalog-${date}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      globalThis.URL.revokeObjectURL(url);

      toast({
        title: "Catalog APK diexport",
        description: `${snapshot.tables.length} meja aktif, ${snapshot.products.length} produk, dan ${snapshot.expense_categories.length} biaya lain-lain siap dipakai APK.`,
        variant: "success"
      });
      adminApi
        .createActivityLog({
          module: "mobile_catalog",
          action: "mobile_catalog/export_json",
          entity_type: "mobile_catalog",
          entity_id: "catalog_snapshot",
          description: "Admin export catalog APK.",
          metadata_json: {
            product_count: snapshot.products.length,
            table_count: snapshot.tables.length,
            outlet_count: snapshot.outlets.length,
            payment_method_count: snapshot.payment_methods?.length || 0
          }
        })
        .catch(() => {});
    } catch (error) {
      toast({
        title: "Gagal export catalog",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <DataTable
      title="Meja"
      description="Master meja per outlet untuk pilihan Dine In di aplikasi kasir."
      data={tableRows}
      isFetching={isFetching || reportsQuery.isFetching}
      isLoading={isLoading}
      searchKeys={["number", "outlet.name", "transactions.order_number", "status"]}
      actions={
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={handleExportCatalog} disabled={isExporting}>
            <Download />
            {isExporting ? "Exporting..." : "Export Catalog APK"}
          </Button>
          {canCreateTable ? (
            <TableFormDialog
              outlets={outlets}
              isPending={generateTables.isPending}
              onSubmit={(values) => generateTables.mutateAsync(values)}
              trigger={
                <Button disabled={generateTables.isPending}>
                  {generateTables.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                  {generateTables.isPending ? "Membuat..." : "Tambah Meja"}
                </Button>
              }
            />
          ) : null}
        </div>
      }
      columns={[
        { key: "number", label: "Nomor Meja", className: "font-medium" },
        { key: "outlet", label: "Outlet", render: (row) => row.outlet?.name || "-", sortValue: (row) => row.outlet?.name || "" },
        {
          key: "transaction_count",
          label: "Transaksi",
          render: (row) => <Badge variant="info">{formatNumber(row.transaction_count || 0)} transaksi</Badge>,
          sortValue: (row) => row.transaction_count
        },
        {
          key: "sales_total",
          label: "Total Penjualan",
          render: (row) => formatCurrency(row.sales_total || 0),
          sortValue: (row) => row.sales_total
        },
        { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
        {
          key: "actions",
          label: "Aksi",
          render: (row) => (
            <TableRowActions
              table={row}
              outlets={outlets}
              users={users}
              canUpdate={canUpdateTable}
              canToggleStatus={canToggleTableStatus}
            />
          ),
          className: "text-right whitespace-nowrap",
          headerClassName: "text-right"
        }
      ]}
    />
  );
}

function getCategoryFormDefaults(category, categories) {
  const nextSortOrder = categories.reduce((max, item) => Math.max(max, Number(item.sort_order || 0)), 0) + 1;

  return {
    name: category?.name || "",
    sort_order: category?.sort_order ?? nextSortOrder,
    status: category?.status || "active"
  };
}

function CategoryFormDialog({ categories, category, isPending = false, mode = "create", onOpenChange, onSubmit, open, trigger }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;
  const defaults = useMemo(() => getCategoryFormDefaults(category, categories), [categories, category]);
  const {
    control,
    handleSubmit,
    register,
    reset,
    formState: { errors, isDirty, isSubmitting }
  } = useForm({
    defaultValues: defaults
  });
  const isEdit = mode === "edit";

  useEffect(() => {
    if (isOpen) {
      reset(defaults);
    }
  }, [defaults, isOpen, reset]);

  async function submit(values) {
    await onSubmit({
      name: values.name.trim(),
      sort_order: Number(values.sort_order || defaults.sort_order),
      status: values.status
    });
    reset(defaults);
    setOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Kategori" : "Tambah Kategori"}</DialogTitle>
          <DialogDescription>Kategori dipakai untuk pengelompokan produk dan filter master produk.</DialogDescription>
        </DialogHeader>

        <form className="space-y-3" onSubmit={handleSubmit(submit)}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="category-name">Nama Kategori</Label>
              <Input
                id="category-name"
                placeholder="Contoh: Dessert"
                {...register("name", {
                  required: "Nama kategori wajib diisi",
                  minLength: { value: 2, message: "Nama kategori minimal 2 karakter" }
                })}
              />
              <ProductFieldError errors={errors} path="name" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="category-sort-order">Urutan</Label>
              <Controller
                name="sort_order"
                control={control}
                rules={{
                  required: "Urutan wajib diisi",
                  min: { value: 1, message: "Urutan minimal 1" }
                }}
                render={({ field }) => (
                  <FormattedNumberInput
                    id="category-sort-order"
                    placeholder="5"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                  />
                )}
              />
              <ProductFieldError errors={errors} path="sort_order" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Aktif</SelectItem>
                    <SelectItem value="inactive">Nonaktif</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {isDirty ? <p className="text-[11px] text-muted-foreground">Perubahan belum disimpan.</p> : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" disabled={isSubmitting || isPending} onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting || isPending}>
              {isSubmitting || isPending ? <Loader2 className="animate-spin" /> : null}
              {isSubmitting || isPending ? "Menyimpan..." : isEdit ? "Simpan Perubahan" : "Simpan Kategori"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function getCategoryProductRows(category, products = []) {
  const categoryId = category?.id;
  const detailProducts = Array.isArray(category?.products) ? category.products : [];
  const fallbackProducts = products.filter((product) => (product.category_id || product.category?.id) === categoryId);
  const rows = detailProducts.length ? detailProducts : fallbackProducts;

  return [...rows].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "id-ID"));
}

function CategoryDetailDialog({ category, onOpenChange, open, products: masterProducts = [] }) {
  const detailQuery = useCategoryDetail(category?.id, { enabled: open });
  const detailCategory = detailQuery.data || category;
  const products = getCategoryProductRows(detailCategory, masterProducts);
  const productCount = Math.max(Number(detailCategory?.product_count || 0), products.length);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Detail Kategori</DialogTitle>
          <DialogDescription>Ringkasan kategori dan produk yang memakai kategori ini.</DialogDescription>
        </DialogHeader>

        {detailQuery.isFetching ? (
          <div className="space-y-4">
            <div className="grid gap-2 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-20 rounded-md" />
              ))}
            </div>
            <Skeleton className="h-40 rounded-md" />
          </div>
        ) : (
          <div className="space-y-4">
            {detailQuery.isError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-[12px] text-destructive">
                {detailQuery.error?.message || "Gagal mengambil detail kategori."}
              </div>
            ) : null}

            <div className="grid gap-2 md:grid-cols-2">
              {[
                ["Nama Kategori", detailCategory?.name],
                ["Urutan", formatNumber(detailCategory?.sort_order || 0)],
                ["Jumlah Produk", `${formatNumber(productCount)} produk`],
                ["Status", <StatusBadge key="status" status={detailCategory?.status} />]
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border p-3">
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                  <div className="mt-1 font-medium">{value || "-"}</div>
                </div>
              ))}
            </div>

            <div className="rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold">Produk dalam Kategori</p>
                <Badge variant="info">{formatNumber(products.length)} produk</Badge>
              </div>
              {products.length ? (
                <div className="space-y-2">
                  {products.map((product) => (
                    <div key={product.id} className="flex items-center justify-between rounded-md bg-muted/45 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{product.name}</p>
                        <p className="text-[11px] text-muted-foreground">{product.sku}</p>
                      </div>
                      <StatusBadge status={product.status} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed p-4 text-center text-[12px] text-muted-foreground">
                  Belum ada produk di kategori ini.
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CategoryRowActions({ canToggleStatus, canUpdate, categories, category, products = [] }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const updateCategory = useUpdateCategory();
  const toggleCategoryStatus = useToggleCategoryStatus();
  const isInactive = category.status === "inactive";

  return (
    <>
      <InlineRowActions>
        <RowActionButton label={`Detail ${category.name}`} onClick={() => setDetailOpen(true)}>
          <Eye />
        </RowActionButton>
        {canUpdate ? (
          <RowActionButton label={`Edit ${category.name}`} onClick={() => setEditOpen(true)}>
            <Edit />
          </RowActionButton>
        ) : null}
        {canToggleStatus ? (
          <RowActionButton
            disabled={toggleCategoryStatus.isPending}
            label={toggleCategoryStatus.isPending ? "Memproses..." : isInactive ? `Aktifkan ${category.name}` : `Nonaktifkan ${category.name}`}
            onClick={() => toggleCategoryStatus.mutate(category.id)}
          >
            {toggleCategoryStatus.isPending ? <Loader2 className="animate-spin" /> : isInactive ? <Power /> : <PowerOff />}
          </RowActionButton>
        ) : null}
      </InlineRowActions>

      <CategoryDetailDialog category={category} products={products} open={detailOpen} onOpenChange={setDetailOpen} />
      <CategoryFormDialog
        mode="edit"
        categories={categories}
        category={category}
        open={editOpen}
        onOpenChange={setEditOpen}
        isPending={updateCategory.isPending}
        onSubmit={(values) => updateCategory.mutateAsync({ id: category.id, payload: values })}
      />
    </>
  );
}

function KategoriProdukPage() {
  const { categories, isFetching, isLoading, products, session } = useMasterDataPage();
  const createCategory = useCreateCategory();
  const canCreateCategory = can(session, "master.categories", "create");
  const canToggleCategoryStatus = can(session, "master.categories", "toggle_status");
  const canUpdateCategory = can(session, "master.categories", "update");
  const categoriesWithProductCount = useMemo(
    () =>
      categories.map((category) => ({
        ...category,
        product_count:
          category.product_count == null
            ? products.filter((product) => product.category_id === category.id).length
            : Number(category.product_count || 0)
      })),
    [categories, products]
  );

  return (
    <DataTable
      title="Kategori Produk"
      description="Kategori yang digunakan pada table dan filter produk."
      data={categoriesWithProductCount}
      isFetching={isFetching}
      isLoading={isLoading}
      searchKeys={["name"]}
      actions={
        canCreateCategory ? (
          <CategoryFormDialog
            categories={categories}
            isPending={createCategory.isPending}
            onSubmit={(values) => createCategory.mutateAsync(values)}
            trigger={
              <Button disabled={createCategory.isPending}>
                {createCategory.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                {createCategory.isPending ? "Menyimpan..." : "Tambah Kategori"}
              </Button>
            }
          />
        ) : null
      }
      columns={[
        { key: "sort_order", label: "Urutan" },
        { key: "name", label: "Kategori", className: "font-medium" },
        {
          key: "product_count",
          label: "Produk",
          render: (row) => <Badge variant="info">{formatNumber(row.product_count || 0)} produk</Badge>,
          sortValue: (row) => row.product_count || 0
        },
        { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
        {
          key: "actions",
          label: "Aksi",
          render: (row) => (
            <CategoryRowActions
              categories={categories}
              category={row}
              products={products}
              canUpdate={canUpdateCategory}
              canToggleStatus={canToggleCategoryStatus}
            />
          ),
          className: "text-right whitespace-nowrap",
          headerClassName: "text-right"
        }
      ]}
    />
  );
}

function getExpenseCategoryFormDefaults(category, categories) {
  const nextSortOrder = categories.reduce((max, item) => Math.max(max, Number(item.sort_order || 0)), 0) + 1;

  return {
    name: category?.name || "",
    account_code: category?.account_code || "6000",
    sort_order: category?.sort_order ?? nextSortOrder,
    status: category?.status || "active"
  };
}

function ExpenseCategoryFormDialog({ categories, category, financialAccounts = [], isPending = false, mode = "create", onOpenChange, onSubmit, open, trigger }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;
  const defaults = useMemo(() => getExpenseCategoryFormDefaults(category, categories), [categories, category]);
  const {
    control,
    handleSubmit,
    register,
    reset,
    formState: { errors, isDirty, isSubmitting }
  } = useForm({ defaultValues: defaults });
  const isEdit = mode === "edit";
  const accountOptions = useMemo(() => filterAccountsByGroup(financialAccounts, ["expense"]), [financialAccounts]);

  useEffect(() => {
    if (isOpen) {
      reset(defaults);
    }
  }, [defaults, isOpen, reset]);

  async function submit(values) {
    await onSubmit({
      name: values.name.trim(),
      account_code: values.account_code,
      sort_order: Number(values.sort_order || defaults.sort_order),
      status: values.status
    });
    reset(defaults);
    setOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Biaya Lain Lain" : "Tambah Biaya Lain Lain"}</DialogTitle>
          <DialogDescription>Nama ini dipakai oleh input biaya lain-lain di APK kasir setelah export catalog.</DialogDescription>
        </DialogHeader>

        <form className="space-y-3" onSubmit={handleSubmit(submit)}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="expense-category-name">Nama Biaya Lain Lain</Label>
              <Input
                id="expense-category-name"
                placeholder="Contoh: Operasional"
                {...register("name", {
                  required: "Nama biaya lain-lain wajib diisi",
                  minLength: { value: 2, message: "Nama biaya lain-lain minimal 2 karakter" }
                })}
              />
              <ProductFieldError errors={errors} path="name" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="expense-category-sort-order">Urutan</Label>
              <Controller
                name="sort_order"
                control={control}
                rules={{
                  required: "Urutan wajib diisi",
                  min: { value: 1, message: "Urutan minimal 1" }
                }}
                render={({ field }) => (
                  <FormattedNumberInput
                    id="expense-category-sort-order"
                    placeholder="1"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                  />
                )}
              />
              <ProductFieldError errors={errors} path="sort_order" />
            </div>
          </div>

          <AccountSelectField accounts={accountOptions} control={control} errors={errors} />

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Aktif</SelectItem>
                    <SelectItem value="inactive">Nonaktif</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {isDirty ? <p className="text-[11px] text-muted-foreground">Perubahan belum disimpan.</p> : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" disabled={isSubmitting || isPending} onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting || isPending}>
              {isSubmitting || isPending ? <Loader2 className="animate-spin" /> : null}
              {isSubmitting || isPending ? "Menyimpan..." : isEdit ? "Simpan Perubahan" : "Simpan Nama"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ExpenseCategoryDetailDialog({ category, onOpenChange, open }) {
  const detailQuery = useExpenseCategoryDetail(category?.id, { enabled: open });
  const detailCategory = detailQuery.data || category;
  const expenses = detailCategory?.expenses || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Detail Biaya Lain Lain</DialogTitle>
          <DialogDescription>Ringkasan nama biaya lain-lain dan histori pengeluaran yang memakai nama ini.</DialogDescription>
        </DialogHeader>

        {detailQuery.isFetching ? (
          <div className="space-y-4">
            <div className="grid gap-2 md:grid-cols-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-20 rounded-md" />
              ))}
            </div>
            <Skeleton className="h-40 rounded-md" />
          </div>
        ) : (
          <div className="space-y-4">
            {detailQuery.isError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-[12px] text-destructive">
                {detailQuery.error?.message || "Gagal mengambil detail biaya lain-lain."}
              </div>
            ) : null}

            <div className="grid gap-2 md:grid-cols-2">
              {[
                ["Nama Biaya Lain Lain", detailCategory?.name],
                ["Akun Laporan", formatRowAccount(detailCategory)],
                ["Urutan", formatNumber(detailCategory?.sort_order || 0)],
                ["Jumlah Pengeluaran", `${formatNumber(detailCategory?.expense_count || 0)} transaksi`],
                ["Total Pengeluaran", formatCurrency(detailCategory?.expense_total || 0)],
                ["Status", <StatusBadge key="status" status={detailCategory?.status} />]
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border p-3">
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                  <div className="mt-1 font-medium">{value || "-"}</div>
                </div>
              ))}
            </div>

            <div className="rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold">Histori Pengeluaran</p>
                <Badge variant="info">{formatNumber(expenses.length)} data</Badge>
              </div>
              {expenses.length ? (
                <div className="space-y-2">
                  {expenses.slice(0, 8).map((expense) => (
                    <div key={expense.id} className="flex items-center justify-between gap-3 rounded-md bg-muted/45 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{expense.description}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {formatDate(expense.expense_date)} - {expense.outlet?.name || "-"}
                        </p>
                      </div>
                      <span className="font-medium">{formatCurrency(expense.amount)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed p-4 text-center text-[12px] text-muted-foreground">
                  Belum ada pengeluaran yang memakai nama ini.
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ExpenseCategoryRowActions({ canToggleStatus, canUpdate, categories, category, financialAccounts }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const updateCategory = useUpdateExpenseCategory();
  const toggleCategoryStatus = useToggleExpenseCategoryStatus();
  const isInactive = category.status === "inactive";

  return (
    <>
      <InlineRowActions>
        <RowActionButton label={`Detail ${category.name}`} onClick={() => setDetailOpen(true)}>
          <Eye />
        </RowActionButton>
        {canUpdate ? (
          <RowActionButton label={`Edit ${category.name}`} onClick={() => setEditOpen(true)}>
            <Edit />
          </RowActionButton>
        ) : null}
        {canToggleStatus ? (
          <RowActionButton
            disabled={toggleCategoryStatus.isPending}
            label={toggleCategoryStatus.isPending ? "Memproses..." : isInactive ? `Aktifkan ${category.name}` : `Nonaktifkan ${category.name}`}
            onClick={() => toggleCategoryStatus.mutate(category.id)}
          >
            {toggleCategoryStatus.isPending ? <Loader2 className="animate-spin" /> : isInactive ? <Power /> : <PowerOff />}
          </RowActionButton>
        ) : null}
      </InlineRowActions>

      <ExpenseCategoryDetailDialog category={category} open={detailOpen} onOpenChange={setDetailOpen} />
      <ExpenseCategoryFormDialog
        mode="edit"
        categories={categories}
        category={category}
        financialAccounts={financialAccounts}
        open={editOpen}
        onOpenChange={setEditOpen}
        isPending={updateCategory.isPending}
        onSubmit={(values) => updateCategory.mutateAsync({ id: category.id, payload: values })}
      />
    </>
  );
}

function KategoriPengeluaranPage() {
  const { expenseCategories, financialAccounts, isFetching, isLoading, selectedOutletId, session } = useMasterDataPage();
  const expenseUsageRange = useMemo(() => getCurrentMonthReportRange(), []);
  const expenseUsageFilters = useMemo(
    () => ({ outletId: selectedOutletId, ...expenseUsageRange }),
    [expenseUsageRange, selectedOutletId]
  );
  const expenseUsageReport = useReports(expenseUsageFilters);
  const expenseCategoriesWithUsage = useMemo(
    () => mergeExpenseCategoryUsage(expenseCategories, expenseUsageReport.data?.expenses || []),
    [expenseCategories, expenseUsageReport.data?.expenses]
  );
  const createCategory = useCreateExpenseCategory();
  const canCreateCategory = can(session, "master.expense_categories", "create");
  const canToggleCategoryStatus = can(session, "master.expense_categories", "toggle_status");
  const canUpdateCategory = can(session, "master.expense_categories", "update");

  return (
    <DataTable
      title="Biaya Lain Lain"
      description="Master nama biaya lain-lain POS untuk dropdown di aplikasi kasir."
      data={expenseCategoriesWithUsage}
      isFetching={isFetching || expenseUsageReport.isFetching}
      isLoading={isLoading}
      searchKeys={["name", "account_code", "account.name", "status"]}
      actions={
        canCreateCategory ? (
          <ExpenseCategoryFormDialog
            categories={expenseCategories}
            financialAccounts={financialAccounts}
            isPending={createCategory.isPending}
            onSubmit={(values) => createCategory.mutateAsync(values)}
            trigger={
              <Button disabled={createCategory.isPending}>
                {createCategory.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                {createCategory.isPending ? "Menyimpan..." : "Tambah Nama"}
              </Button>
            }
          />
        ) : null
      }
      columns={[
        { key: "sort_order", label: "Urutan" },
        { key: "name", label: "Nama Biaya Lain Lain", className: "font-medium" },
        { key: "account_code", label: "Akun", render: (row) => formatMaterialCategoryAccount(row, financialAccounts) },
        {
          key: "expense_count",
          label: "Pengeluaran",
          render: (row) => <Badge variant="info">{formatNumber(row.expense_count || 0)} data</Badge>,
          sortValue: (row) => row.expense_count || 0
        },
        {
          key: "expense_total",
          label: "Total",
          render: (row) => formatCurrency(row.expense_total || 0),
          sortValue: (row) => row.expense_total || 0
        },
        { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
        {
          key: "actions",
          label: "Aksi",
          render: (row) => (
            <ExpenseCategoryRowActions
              categories={expenseCategoriesWithUsage}
              category={row}
              financialAccounts={financialAccounts}
              canUpdate={canUpdateCategory}
              canToggleStatus={canToggleCategoryStatus}
            />
          ),
          className: "text-right whitespace-nowrap",
          headerClassName: "text-right"
        }
      ]}
    />
  );
}

function getPaymentMethodDefaults(method) {
  return {
    name: method?.name || "",
    code: method?.code || "",
    account_code: method?.account_code || "",
    sort_order: method?.sort_order ?? "",
    status: method?.status || "active"
  };
}

function PaymentMethodFormDialog({ financialAccounts = [], isPending = false, method, mode = "create", onOpenChange, onSubmit, open, trigger }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;
  const defaults = useMemo(() => getPaymentMethodDefaults(method), [method]);
  const {
    control,
    getValues,
    handleSubmit,
    register,
    reset,
    setValue,
    formState: { errors, isDirty, isSubmitting }
  } = useForm({
    defaultValues: defaults
  });
  const isEdit = mode === "edit";
  const accountOptions = useMemo(() => filterAccountsByGroup(financialAccounts, ["cash_bank"]), [financialAccounts]);

  useEffect(() => {
    if (isOpen) reset(defaults);
  }, [defaults, isOpen, reset]);

  useEffect(() => {
    if (!isOpen || getValues("account_code") || !accountOptions.length) return;
    setValue("account_code", accountOptions[0].code, { shouldDirty: false });
  }, [accountOptions, getValues, isOpen, setValue]);

  async function submit(values) {
    await onSubmit({
      name: values.name.trim(),
      code: values.code.trim().toLowerCase(),
      account_code: values.account_code.trim(),
      sort_order: Number(values.sort_order || 0),
      status: values.status
    });
    reset(defaults);
    setOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Metode Pembayaran" : "Tambah Metode Pembayaran"}</DialogTitle>
          <DialogDescription>Metode aktif akan muncul di APK kasir setelah sync catalog.</DialogDescription>
        </DialogHeader>

        <form className="space-y-3" onSubmit={handleSubmit(submit)}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="payment-method-name">Nama</Label>
              <Input
                id="payment-method-name"
                placeholder="Cash"
                {...register("name", {
                  required: "Nama metode wajib diisi",
                  minLength: { value: 2, message: "Nama minimal 2 karakter" }
                })}
              />
              <ProductFieldError errors={errors} path="name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payment-method-code">Kode</Label>
              <Input
                id="payment-method-code"
                placeholder="cash"
                {...register("code", {
                  required: "Kode metode wajib diisi",
                  pattern: {
                    value: /^[a-z0-9_/-]+$/i,
                    message: "Kode hanya huruf, angka, underscore, slash, atau strip"
                  }
                })}
              />
              <p className="text-[11px] text-muted-foreground">Kode dikirim APK ke backend, contoh: cash, transfer, qris.</p>
              <ProductFieldError errors={errors} path="code" />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <AccountSelectField accounts={accountOptions} control={control} errors={errors} />
            <div className="space-y-1.5">
              <Label htmlFor="payment-method-sort">Urutan</Label>
              <Input
                id="payment-method-sort"
                type="number"
                min="0"
                {...register("sort_order", {
                  valueAsNumber: true,
                  min: { value: 0, message: "Urutan minimal 0" }
                })}
              />
              <ProductFieldError errors={errors} path="sort_order" />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Controller
                name="status"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Aktif</SelectItem>
                      <SelectItem value="inactive">Nonaktif</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          {isDirty ? <p className="text-[11px] text-muted-foreground">Perubahan belum disimpan.</p> : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending || isSubmitting}>
              Batal
            </Button>
            <Button type="submit" disabled={isPending || isSubmitting}>
              {isPending || isSubmitting ? "Menyimpan..." : isEdit ? "Simpan Perubahan" : "Simpan Metode"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PaymentMethodRowActions({ canToggleStatus, canUpdate, financialAccounts, method }) {
  const [editOpen, setEditOpen] = useState(false);
  const updatePaymentMethod = useUpdatePaymentMethod();
  const togglePaymentMethodStatus = useTogglePaymentMethodStatus();
  const isInactive = method.status === "inactive";

  return (
    <>
      <InlineRowActions>
        {canUpdate ? (
          <RowActionButton label={`Edit ${method.name}`} onClick={() => setEditOpen(true)}>
            <Edit />
          </RowActionButton>
        ) : null}
        {canToggleStatus ? (
          <RowActionButton
            disabled={togglePaymentMethodStatus.isPending}
            label={togglePaymentMethodStatus.isPending ? "Memproses..." : isInactive ? `Aktifkan ${method.name}` : `Nonaktifkan ${method.name}`}
            onClick={() => togglePaymentMethodStatus.mutate(method.id)}
          >
            {togglePaymentMethodStatus.isPending ? <Loader2 className="animate-spin" /> : isInactive ? <Power /> : <PowerOff />}
          </RowActionButton>
        ) : null}
      </InlineRowActions>

      <PaymentMethodFormDialog
        financialAccounts={financialAccounts}
        mode="edit"
        method={method}
        open={editOpen}
        onOpenChange={setEditOpen}
        isPending={updatePaymentMethod.isPending}
        onSubmit={(values) => updatePaymentMethod.mutateAsync({ id: method.id, payload: values })}
      />
    </>
  );
}

function MetodePembayaranPage() {
  const { financialAccounts, isFetching, isLoading, paymentMethods, session } = useMasterDataPage();
  const createPaymentMethod = useCreatePaymentMethod();
  const canCreatePaymentMethod = can(session, "master.payment_methods", "create");
  const canTogglePaymentMethod = can(session, "master.payment_methods", "toggle_status");
  const canUpdatePaymentMethod = can(session, "master.payment_methods", "update");
  const rows = [...paymentMethods].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));

  return (
    <DataTable
      title="Metode Pembayaran"
      description="Master payment untuk checkout APK kasir, laporan, dan payment breakdown."
      data={rows}
      isFetching={isFetching}
      isLoading={isLoading}
      searchKeys={["name", "code", "account_code", "account.name", "status"]}
      actions={
        canCreatePaymentMethod ? (
          <PaymentMethodFormDialog
            financialAccounts={financialAccounts}
            isPending={createPaymentMethod.isPending}
            onSubmit={(values) => createPaymentMethod.mutateAsync(values)}
            trigger={
              <Button disabled={createPaymentMethod.isPending}>
                {createPaymentMethod.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                {createPaymentMethod.isPending ? "Menyimpan..." : "Tambah Metode"}
              </Button>
            }
          />
        ) : null
      }
      columns={[
        { key: "sort_order", label: "Urutan", sortValue: (row) => Number(row.sort_order || 0) },
        { key: "name", label: "Metode", className: "font-medium" },
        { key: "code", label: "Kode", render: (row) => <Badge variant="outline">{row.code}</Badge> },
        { key: "account_code", label: "Akun", render: (row) => formatRowAccount(row) },
        { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
        {
          key: "actions",
          label: "Aksi",
          render: (row) => (
            <PaymentMethodRowActions
              financialAccounts={financialAccounts}
              method={row}
              canUpdate={canUpdatePaymentMethod}
              canToggleStatus={canTogglePaymentMethod}
            />
          ),
          className: "text-right whitespace-nowrap",
          headerClassName: "text-right"
        }
      ]}
    />
  );
}

function formatDiscountValue(discount) {
  if (discount.type === "percent") return `${formatNumber(discount.value || 0)}%`;
  return formatCurrency(discount.value || 0);
}

function DiscountPage() {
  const { discounts, isFetching, isLoading } = useMasterDataPage();

  return (
    <DataTable
      title="Discount"
      description="Monitoring discount yang dibuat dari APK kasir. Tambah dan koreksi discount dilakukan di APK dengan PIN laporan."
      data={discounts}
      isFetching={isFetching}
      isLoading={isLoading}
      searchKeys={["name", "type", "status", "outlets.name"]}
      columns={[
        { key: "name", label: "Discount", className: "font-medium" },
        {
          key: "type",
          label: "Tipe",
          render: (row) => <Badge variant="outline">{row.type === "percent" ? "Persen" : "Nominal"}</Badge>
        },
        { key: "value", label: "Nilai", render: formatDiscountValue, sortValue: (row) => Number(row.value || 0) },
        { key: "outlets", label: "Outlet", render: (row) => (row.outlets || []).map((outlet) => outlet.name).join(", ") || "-" },
        { key: "period", label: "Periode", render: (row) => `${formatDate(row.starts_at)} - ${formatDate(row.ends_at)}` },
        { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> }
      ]}
    />
  );
}

function SupplierPage() {
  const { isFetching, isLoading, session, suppliers } = useMasterDataPage();
  const createSupplier = useCreateSupplier();
  const canCreateSupplier = can(session, "master.suppliers", "create");
  const canToggleSupplierStatus = can(session, "master.suppliers", "toggle_status");
  const canUpdateSupplier = can(session, "master.suppliers", "update");

  return (
    <DataTable
      title="Supplier"
      description="Master supplier harga pokok produksi untuk pembelian dan histori laporan."
      data={suppliers}
      isFetching={isFetching}
      isLoading={isLoading}
      searchKeys={["name", "phone", "status"]}
      actions={
        canCreateSupplier ? (
          <SupplierFormDialog
            isPending={createSupplier.isPending}
            onSubmit={(values) => createSupplier.mutateAsync(values)}
            trigger={
              <Button disabled={createSupplier.isPending}>
                {createSupplier.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                {createSupplier.isPending ? "Menyimpan..." : "Tambah Supplier"}
              </Button>
            }
          />
        ) : null
      }
      columns={[
        { key: "name", label: "Supplier", className: "font-medium" },
        { key: "phone", label: "Telepon" },
        {
          key: "purchase_count",
          label: "Jumlah Pembelian",
          render: (row) => <Badge variant="info">{formatNumber(row.purchase_count || 0)} transaksi</Badge>,
          sortValue: (row) => row.purchase_count || 0
        },
        {
          key: "purchase_total",
          label: "Total Pembelian",
          render: (row) => formatCurrency(row.purchase_total || 0),
          sortValue: (row) => row.purchase_total || 0
        },
        { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
        {
          key: "actions",
          label: "Aksi",
          render: (row) => (
            <SupplierRowActions
              supplier={row}
              canUpdate={canUpdateSupplier}
              canToggleStatus={canToggleSupplierStatus}
            />
          ),
          className: "text-right whitespace-nowrap",
          headerClassName: "text-right"
        }
      ]}
    />
  );
}

function getMaterialCategoryFormDefaults(category, categories) {
  return {
    name: category?.name || "",
    type: category?.type || "hpp",
    account_code: category?.account_code || (category?.type === "biaya" ? "6000" : "5002"),
    sort_order:
      category?.sort_order ??
      (categories || []).reduce((max, item) => Math.max(max, Number(item.sort_order || 0)), 0) + 1,
    status: category?.status || "active"
  };
}

function MaterialCategoryFormDialog({ categories = [], category, financialAccounts = [], mode = "create", onOpenChange, onSubmit, open, trigger }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;
  const defaults = useMemo(() => getMaterialCategoryFormDefaults(category, categories), [categories, category]);
  const {
    control,
    getValues,
    handleSubmit,
    register,
    reset,
    setValue,
    formState: { errors, isDirty, isSubmitting }
  } = useForm({ defaultValues: defaults });
  const isEdit = mode === "edit";
  const selectedType = useWatch({ control, name: "type" }) || defaults.type;
  const accountGroup = selectedType === "biaya" ? "expense" : "cogs";
  const accountOptions = useMemo(() => filterAccountsByGroup(financialAccounts, [accountGroup]), [accountGroup, financialAccounts]);

  useEffect(() => {
    if (isOpen) reset(defaults);
  }, [defaults, isOpen, reset]);

  useEffect(() => {
    if (!isOpen || !accountOptions.length) return;
    const currentCode = getValues("account_code");
    const currentAccount = financialAccounts.find((account) => account.code === currentCode);
    if (currentAccount?.report_group === accountGroup) return;
    const nextCode = accountOptions[0]?.code;
    if (nextCode && nextCode !== currentCode) {
      setValue("account_code", nextCode, { shouldDirty: false });
    }
  }, [accountGroup, accountOptions, financialAccounts, getValues, isOpen, setValue]);

  async function submit(values) {
    await onSubmit({
      name: values.name.trim(),
      type: values.type,
      account_code: values.account_code.trim(),
      sort_order: Number(values.sort_order || 0),
      status: values.status
    });
    reset(defaults);
    setOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Kategori Harga Pokok Produksi" : "Tambah Kategori Harga Pokok Produksi"}</DialogTitle>
          <DialogDescription>Kategori menentukan apakah pembelian masuk HPP atau biaya produksi.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={handleSubmit(submit)}>
          <div className="space-y-1.5">
            <Label htmlFor="material-category-name">Nama Kategori</Label>
            <Input
              id="material-category-name"
              placeholder="Harga Pokok Penjualan"
              {...register("name", { required: "Nama kategori wajib diisi" })}
            />
            <ProductFieldError errors={errors} path="name" />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Controller
                name="type"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hpp">HPP / Harga Pokok Penjualan</SelectItem>
                      <SelectItem value="biaya">Biaya Produksi</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <AccountSelectField
              accounts={accountOptions}
              control={control}
              errors={errors}
              helperText="Akun ini menentukan posisi data di laporan. Type HPP masuk Laba Rugi bagian HPP, Type Biaya Produksi masuk Expense."
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="material-category-sort">Urutan</Label>
              <Controller
                name="sort_order"
                control={control}
                rules={{ min: { value: 1, message: "Urutan minimal 1" } }}
                render={({ field }) => <FormattedNumberInput id="material-category-sort" {...field} />}
              />
              <ProductFieldError errors={errors} path="sort_order" />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Controller
                name="status"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Aktif</SelectItem>
                      <SelectItem value="inactive">Nonaktif</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>
          {isDirty ? <p className="text-[11px] text-muted-foreground">Perubahan belum disimpan.</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Menyimpan..." : "Simpan Kategori"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MaterialCategoryRowActions({ canToggleStatus, canUpdate, categories, category, financialAccounts }) {
  const [editOpen, setEditOpen] = useState(false);
  const updateCategory = useUpdateMaterialCategory();
  const toggleCategoryStatus = useToggleMaterialCategoryStatus();
  const isInactive = category.status === "inactive";

  return (
    <>
      <InlineRowActions>
        {canUpdate ? (
          <RowActionButton label={`Edit ${category.name}`} onClick={() => setEditOpen(true)}>
            <Edit />
          </RowActionButton>
        ) : null}
        {canToggleStatus ? (
          <RowActionButton
            disabled={toggleCategoryStatus.isPending}
            label={toggleCategoryStatus.isPending ? "Memproses..." : isInactive ? `Aktifkan ${category.name}` : `Nonaktifkan ${category.name}`}
            onClick={() => toggleCategoryStatus.mutate(category.id)}
          >
            {toggleCategoryStatus.isPending ? <Loader2 className="animate-spin" /> : isInactive ? <Power /> : <PowerOff />}
          </RowActionButton>
        ) : null}
      </InlineRowActions>
      <MaterialCategoryFormDialog
        mode="edit"
        category={category}
        categories={categories}
        financialAccounts={financialAccounts}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSubmit={(values) => updateCategory.mutateAsync({ id: category.id, payload: values })}
      />
    </>
  );
}

function KategoriBahanBakuPage() {
  const { financialAccounts, isLoading, materialCategories, session } = useMasterDataPage();
  const createCategory = useCreateMaterialCategory();
  const canCreate = can(session, "master.material_categories", "create");
  const canUpdate = can(session, "master.material_categories", "update");
  const canToggleStatus = can(session, "master.material_categories", "toggle_status");

  return (
    <DataTable
      title="Kategori Harga Pokok Produksi"
      description="Master kategori untuk memisahkan harga pokok produksi dan biaya produksi."
      data={materialCategories}
      isLoading={isLoading}
      searchKeys={["name", "type", "account_code", "account.name", "status"]}
      actions={
        canCreate ? (
          <MaterialCategoryFormDialog
            categories={materialCategories}
            financialAccounts={financialAccounts}
            onSubmit={(values) => createCategory.mutateAsync(values)}
            trigger={
              <Button>
                <Plus />
                Tambah Kategori
              </Button>
            }
          />
        ) : null
      }
      columns={[
        { key: "name", label: "Kategori", className: "font-medium" },
        { key: "type", label: "Type", render: (row) => (row.type === "biaya" ? "Biaya Produksi" : "HPP") },
        { key: "account_code", label: "Akun", render: (row) => formatRowAccount(row) },
        { key: "material_count", label: "Produk", render: (row) => <Badge variant="info">{formatNumber(row.material_count || 0)} produk</Badge> },
        { key: "sort_order", label: "Urutan" },
        { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
        {
          key: "actions",
          label: "Aksi",
          render: (row) => (
            <MaterialCategoryRowActions
              category={row}
              categories={materialCategories}
              financialAccounts={financialAccounts}
              canUpdate={canUpdate}
              canToggleStatus={canToggleStatus}
            />
          ),
          className: "text-right whitespace-nowrap",
          headerClassName: "text-right"
        }
      ]}
    />
  );
}

function BahanBakuPage() {
  const { financialAccounts, isLoading, materialCategories, materials, session, units } = useMasterDataPage();
  const createMaterial = useCreateMaterial();
  const canCreateMaterial = can(session, "master.materials", "create");
  const canToggleMaterialStatus = can(session, "master.materials", "toggle_status");
  const canUpdateMaterial = can(session, "master.materials", "update");

  return (
    <DataTable
      title="Harga Pokok Produksi"
      description="Master harga pokok produksi untuk komposisi produk. Stok outlet dibuat lewat transaksi inventory."
      data={materials}
      isLoading={isLoading}
      searchKeys={["name", "unit", "status", "type", "category.name", "category.account_code", "category.account.name"]}
      emptyText="Belum ada harga pokok produksi."
      actions={
        canCreateMaterial ? (
          <MaterialFormDialog
            categories={materialCategories}
            financialAccounts={financialAccounts}
            units={units}
            onSubmit={(values) => createMaterial.mutateAsync(values)}
            trigger={
              <Button>
                <Plus />
                Tambah Harga Pokok Produksi
              </Button>
            }
          />
        ) : null
      }
      columns={[
        { key: "name", label: "Harga Pokok Produksi", className: "font-medium" },
        { key: "type", label: "Type", render: (row) => (row.type === "biaya" ? "Biaya Produksi" : "HPP") },
        { key: "category", label: "Kategori", render: (row) => row.category?.name || "-" },
        { key: "account_code", label: "Akun", render: (row) => formatRowAccount(row) },
        { key: "unit", label: "Unit" },
        {
          key: "low_stock_threshold",
          label: "Threshold",
          render: (row) => `${formatNumber(row.low_stock_threshold)} ${row.unit}`,
          sortValue: (row) => row.low_stock_threshold
        },
        {
          key: "total_stock",
          label: "Total Stok",
          render: (row) => `${formatNumber(row.total_stock)} ${row.unit}`,
          sortValue: (row) => row.total_stock
        },
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
          key: "outlet_count",
          label: "Outlet",
          render: (row) =>
            Number(row.outlet_count || 0) > 0 ? (
              <Badge variant="info">{row.outlet_count} outlet</Badge>
            ) : (
              <Badge variant="warning">Belum ada stok outlet</Badge>
            )
        },
        { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
        {
          key: "actions",
          label: "Aksi",
          render: (row) => (
            <MaterialRowActions
              financialAccounts={financialAccounts}
              material={row}
              materialCategories={materialCategories}
              units={units}
              canUpdate={canUpdateMaterial}
              canToggleStatus={canToggleMaterialStatus}
            />
          ),
          className: "text-right whitespace-nowrap",
          headerClassName: "text-right"
        }
      ]}
    />
  );
}

function SatuanUnitPage() {
  const { isLoading, session, units } = useMasterDataPage();
  const createUnit = useCreateUnit();
  const canCreateUnit = can(session, "master.units", "create");
  const canToggleUnitStatus = can(session, "master.units", "toggle_status");
  const canUpdateUnit = can(session, "master.units", "update");

  return (
    <DataTable
      title="Satuan / Unit"
      description="Master satuan yang dipakai oleh harga pokok produksi, stok, dan komposisi produk."
      data={units}
      isLoading={isLoading}
      searchKeys={["name", "code", "status"]}
      actions={
        canCreateUnit ? (
        <UnitFormDialog
          onSubmit={(values) => createUnit.mutateAsync(values)}
          trigger={
            <Button>
              <Plus />
              Tambah Unit
            </Button>
          }
        />
        ) : null
      }
      columns={[
        { key: "name", label: "Nama Unit", className: "font-medium" },
        { key: "code", label: "Kode" },
        { key: "material_count", label: "Dipakai", render: (row) => <Badge variant="info">{row.material_count} produk</Badge>, sortValue: (row) => row.material_count },
        { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
        {
          key: "actions",
          label: "Aksi",
          render: (row) =>
            canUpdateUnit || canToggleUnitStatus ? (
            <UnitRowActions
              unit={row}
              canUpdate={canUpdateUnit}
              canToggleStatus={canToggleUnitStatus}
            />
            ) : (
              <span className="text-muted-foreground">-</span>
            ),
          className: "text-right whitespace-nowrap",
          headerClassName: "text-right"
        }
      ]}
    />
  );
}

function getCompositionFormDefaults({ composition, materials, products }) {
  const firstProduct = products.find((product) => product.status === "active") || products[0];
  const firstMaterial = materials.find((material) => material.status === "active") || materials[0];

  return {
    product_id: composition?.product_id || composition?.product?.id || firstProduct?.id || "",
    material_id: composition?.material_id || composition?.material?.id || firstMaterial?.id || "",
    quantity: composition?.quantity ?? "",
    unit: composition?.unit || composition?.material?.unit || firstMaterial?.unit || ""
  };
}

function getMaterialUnitForComposition(materials, materialId) {
  return materials.find((material) => material.id === materialId)?.unit || "";
}

function CompositionFormDialog({ composition, materials, mode = "create", onOpenChange, onSubmit, open, products, trigger }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;
  const defaults = useMemo(() => getCompositionFormDefaults({ composition, materials, products }), [composition, materials, products]);
  const {
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isDirty, isSubmitting }
  } = useForm({
    defaultValues: defaults
  });
  const materialId = useWatch({ control, name: "material_id" });
  const currentProductId = composition?.product_id || composition?.product?.id;
  const currentMaterialId = composition?.material_id || composition?.material?.id;
  const productOptions = products.filter((product) => product.status === "active" || product.id === currentProductId);
  const materialOptions = materials.filter((material) => material.status === "active" || material.id === currentMaterialId);
  const isEdit = mode === "edit";

  useEffect(() => {
    if (isOpen) {
      reset(defaults);
    }
  }, [defaults, isOpen, reset]);

  useEffect(() => {
    if (materialId) {
      setValue("unit", getMaterialUnitForComposition(materials, materialId), {
        shouldDirty: true,
        shouldValidate: true
      });
    }
  }, [materialId, materials, setValue]);

  async function submit(values) {
    await onSubmit({
      product_id: values.product_id,
      material_id: values.material_id,
      quantity: Number(values.quantity),
      unit: values.unit || getMaterialUnitForComposition(materials, values.material_id)
    });
    reset(defaults);
    setOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Komposisi" : "Tambah Komposisi"}</DialogTitle>
          <DialogDescription>Atur harga pokok produksi dan qty yang dibutuhkan untuk satu produk.</DialogDescription>
        </DialogHeader>

        <form className="space-y-3" onSubmit={handleSubmit(submit)}>
          <div className="space-y-1.5">
            <Label>Produk</Label>
            <Controller
              name="product_id"
              control={control}
              rules={{ required: "Produk wajib dipilih" }}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih produk" />
                  </SelectTrigger>
                  <SelectContent>
                    {productOptions.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name}
                        {product.status === "inactive" ? " (Nonaktif)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <ProductFieldError errors={errors} path="product_id" />
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
                    {materialOptions.map((material) => (
                      <SelectItem key={material.id} value={material.id}>
                        {material.name}
                        {material.status === "inactive" ? " (Nonaktif)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <ProductFieldError errors={errors} path="material_id" />
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_0.45fr]">
            <div className="space-y-1.5">
              <Label>Qty</Label>
              <Controller
                name="quantity"
                control={control}
                rules={{
                  required: "Qty wajib diisi",
                  min: { value: 0.001, message: "Qty minimal 0,001" }
                }}
                render={({ field }) => (
                  <FormattedNumberInput
                    allowDecimal
                    placeholder="0,18"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                  />
                )}
              />
              <ProductFieldError errors={errors} path="quantity" />
            </div>

            <div className="space-y-1.5">
              <Label>Unit</Label>
              <Controller
                name="unit"
                control={control}
                render={({ field }) => <Input readOnly {...field} />}
              />
            </div>
          </div>

          {isDirty ? <p className="text-[11px] text-muted-foreground">Perubahan belum disimpan.</p> : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Menyimpan..." : isEdit ? "Simpan Perubahan" : "Simpan Komposisi"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CompositionDetailDialog({ composition, onOpenChange, open }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Detail Komposisi Produk</DialogTitle>
          <DialogDescription>Harga Pokok Produksi yang akan dipakai untuk estimasi HPP dan stok.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 md:grid-cols-2">
          {[
            ["Produk", composition?.product?.name],
            ["SKU", composition?.product?.sku],
            ["Harga Pokok Produksi", composition?.material?.name],
            ["Qty", `${formatNumber(composition?.quantity || 0)} ${composition?.unit || ""}`],
            ["Status Produk", <StatusBadge key="product-status" status={composition?.product?.status} />],
            ["Status Harga Pokok Produksi", <StatusBadge key="material-status" status={composition?.material?.status} />]
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border p-3">
              <p className="text-[11px] text-muted-foreground">{label}</p>
              <div className="mt-1 font-medium">{value || "-"}</div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CompositionRowActions({ composition, materials, products }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const updateComposition = useUpdateProductComposition();
  const deleteComposition = useDeleteProductComposition();

  return (
    <>
      <InlineRowActions>
        <RowActionButton label={`Detail komposisi ${composition.product_name}`} onClick={() => setDetailOpen(true)}>
          <Eye />
        </RowActionButton>
        <RowActionButton label={`Edit komposisi ${composition.product_name}`} onClick={() => setEditOpen(true)}>
          <Edit />
        </RowActionButton>
        <RowActionButton
          className="text-destructive hover:bg-destructive/10"
          disabled={deleteComposition.isPending}
          label={deleteComposition.isPending ? "Memproses..." : `Hapus komposisi ${composition.product_name}`}
          onClick={() => deleteComposition.mutate(composition.id)}
        >
          {deleteComposition.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
        </RowActionButton>
      </InlineRowActions>

      <CompositionDetailDialog composition={composition} open={detailOpen} onOpenChange={setDetailOpen} />
      <CompositionFormDialog
        mode="edit"
        composition={composition}
        products={products}
        materials={materials}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSubmit={(values) => updateComposition.mutateAsync({ id: composition.id, payload: values })}
      />
    </>
  );
}

function KomposisiProdukPage() {
  const { compositions, products, isLoading, materials, session } = useMasterDataPage();
  const createComposition = useCreateProductComposition();
  const canCreateProduct = can(session, "master.products", "manage_composition");
  const canUpdateProduct = can(session, "master.products", "manage_composition");
  const rows = compositions.map((composition) => ({
    ...composition,
    product_name: composition.product?.name,
    sku: composition.product?.sku,
    product_status: composition.product?.status,
    material_name: composition.material?.name,
    material_status: composition.material?.status
  }));

  return (
    <DataTable
      title="Komposisi Produk"
      description="Harga Pokok Produksi yang digunakan untuk menghitung estimasi HPP dan stok."
      data={rows}
      isLoading={isLoading}
      searchKeys={["product_name", "sku", "material_name"]}
      actions={
        canCreateProduct ? (
          <CompositionFormDialog
            products={products}
            materials={materials}
            onSubmit={(values) => createComposition.mutateAsync(values)}
            trigger={
              <Button>
                <Plus />
                Tambah Komposisi
              </Button>
            }
          />
        ) : null
      }
      columns={[
        { key: "sku", label: "SKU" },
        { key: "product_name", label: "Produk", className: "font-medium" },
        { key: "material_name", label: "Harga Pokok Produksi" },
        { key: "quantity", label: "Qty", render: (row) => `${formatNumber(row.quantity)} ${row.unit}`, sortValue: (row) => row.quantity },
        { key: "product_status", label: "Produk", render: (row) => <StatusBadge status={row.product_status} /> },
        { key: "material_status", label: "Harga Pokok Produksi", render: (row) => <StatusBadge status={row.material_status} /> },
        {
          key: "actions",
          label: "Aksi",
          render: (row) =>
            canUpdateProduct ? (
              <CompositionRowActions composition={row} products={products} materials={materials} />
            ) : (
              <span className="text-muted-foreground">-</span>
            ),
          className: "text-right whitespace-nowrap",
          headerClassName: "text-right"
        }
      ]}
    />
  );
}

function ProductPriceRowActions({ categories, materials, outlets, product }) {
  const [editOpen, setEditOpen] = useState(false);
  const updateProduct = useUpdateProduct();

  return (
    <>
      <InlineRowActions>
        <RowActionButton label={`Edit harga ${product.name}`} onClick={() => setEditOpen(true)}>
          <Edit />
        </RowActionButton>
      </InlineRowActions>
      <ProductFormDialog
        mode="edit"
        open={editOpen}
        onOpenChange={setEditOpen}
        product={product}
        categories={categories}
        outlets={outlets}
        materials={materials}
        canManageComposition={false}
        canManagePrice
        isPending={updateProduct.isPending}
        onSubmit={(values) => updateProduct.mutateAsync({ id: product.id, payload: values })}
      />
    </>
  );
}

function HargaProdukPage() {
  const { categories, materials, outlets, products, isLoading, selectedOutletId, session } = useMasterDataPage();
  const canUpdateProduct = can(session, "master.products", "manage_price");
  const rows = products.flatMap((product) =>
    productPricesForOutlet(product, selectedOutletId).map((price) => ({
      id: `${product.id}-${price.outlet_id}`,
      product,
      product_name: product.name,
      sku: product.sku,
      outlet_name: price.outlet.name,
      price: price.price,
      status: price.status
    }))
  );

  return (
    <DataTable
      title="Harga Produk per Outlet"
      description="Harga dapat berbeda per outlet dan dibaca dari data backend."
      data={rows}
      isLoading={isLoading}
      searchKeys={["product_name", "sku", "outlet_name"]}
      columns={[
        { key: "sku", label: "SKU" },
        { key: "product_name", label: "Produk", className: "font-medium" },
        { key: "outlet_name", label: "Outlet" },
        { key: "price", label: "Harga", render: (row) => formatCurrency(row.price), sortValue: (row) => row.price },
        { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
        {
          key: "actions",
          label: "Aksi",
          render: (row) => canUpdateProduct ? (
            <ProductPriceRowActions categories={categories} materials={materials} outlets={outlets} product={row.product} />
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
          className: "text-right whitespace-nowrap",
          headerClassName: "text-right"
        }
      ]}
    />
  );
}

export {
  BahanBakuPage,
  CustomerPage,
  DiscountPage,
  HargaProdukPage,
  KategoriBahanBakuPage,
  KategoriPengeluaranPage,
  KategoriProdukPage,
  KomposisiProdukPage,
  MejaPage,
  MetodePembayaranPage,
  OutletPage,
  ProdukPage,
  SatuanUnitPage,
  SupplierPage,
  UserPermissionPage
};
