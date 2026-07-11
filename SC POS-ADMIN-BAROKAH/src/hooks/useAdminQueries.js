import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/adminApi";
import { normalizeReportData } from "@/lib/transactionNormalization";
import { useToast } from "@/components/ui/toast";
import { useAppStore } from "@/store/appStore";
import { hasAdminAccess } from "@/config/permissionCatalog";

export function useBootstrap() {
  return useQuery({
    queryKey: ["bootstrap"],
    queryFn: adminApi.getBootstrap
  });
}

export function useDashboard(filters) {
  return useQuery({
    queryKey: ["dashboard", filters],
    queryFn: () => adminApi.getDashboard(filters),
    placeholderData: keepPreviousData
  });
}

export function useDashboardMaterialPurchaseComparisons(filters) {
  return useQuery({
    queryKey: ["dashboard-material-purchase-comparisons", filters],
    queryFn: () => adminApi.getDashboardMaterialPurchaseComparisons(filters),
    placeholderData: keepPreviousData
  });
}

export function useSalesOutletComparison(filters) {
  return useQuery({
    queryKey: ["sales-outlet-comparison", filters],
    queryFn: () => adminApi.getSalesOutletComparison(filters),
    placeholderData: keepPreviousData
  });
}

export function useMasterData(filters) {
  return useQuery({
    queryKey: ["master-data", filters],
    queryFn: () => adminApi.getMasterData(filters)
  });
}

export function useProductDetail(productId, options = {}) {
  return useQuery({
    queryKey: ["product-detail", productId],
    queryFn: () => adminApi.getProductDetail(productId),
    enabled: Boolean(productId) && options.enabled !== false
  });
}

export function useCustomerDetail(customerId, options = {}) {
  return useQuery({
    queryKey: ["customer-detail", customerId],
    queryFn: () => adminApi.getCustomerDetail(customerId),
    enabled: Boolean(customerId) && options.enabled !== false
  });
}

export function useOutletDetail(outletId, options = {}) {
  return useQuery({
    queryKey: ["outlet-detail", outletId],
    queryFn: () => adminApi.getOutletDetail(outletId),
    enabled: Boolean(outletId) && options.enabled !== false
  });
}

export function useTableDetail(tableId, options = {}) {
  return useQuery({
    queryKey: ["table-detail", tableId],
    queryFn: () => adminApi.getTableDetail(tableId),
    enabled: Boolean(tableId) && options.enabled !== false
  });
}

export function useCategoryDetail(categoryId, options = {}) {
  return useQuery({
    queryKey: ["category-detail", categoryId],
    queryFn: () => adminApi.getCategoryDetail(categoryId),
    enabled: Boolean(categoryId) && options.enabled !== false
  });
}

export function useExpenseCategoryDetail(categoryId, options = {}) {
  return useQuery({
    queryKey: ["expense-category-detail", categoryId],
    queryFn: () => adminApi.getExpenseCategoryDetail(categoryId),
    enabled: Boolean(categoryId) && options.enabled !== false
  });
}

export function useMaterialCategoryDetail(categoryId, options = {}) {
  return useQuery({
    queryKey: ["material-category-detail", categoryId],
    queryFn: () => adminApi.getMaterialCategoryDetail(categoryId),
    enabled: Boolean(categoryId) && options.enabled !== false
  });
}

export function useSupplierDetail(supplierId, options = {}) {
  return useQuery({
    queryKey: ["supplier-detail", supplierId],
    queryFn: () => adminApi.getSupplierDetail(supplierId),
    enabled: Boolean(supplierId) && options.enabled !== false
  });
}

export function useInventory(filters) {
  return useQuery({
    queryKey: ["inventory", filters],
    queryFn: () => adminApi.getInventory(filters)
  });
}

export function useStockOpnameWorksheet(filters) {
  return useQuery({
    queryKey: ["stock-opname-worksheet", filters],
    queryFn: () => adminApi.getStockOpnameWorksheet(filters),
    enabled: Boolean(filters?.outletId && filters.outletId !== "all" && filters?.date)
  });
}

export function useStockOpnameRequests(filters) {
  return useQuery({
    queryKey: ["stock-opname-requests", filters],
    queryFn: () => adminApi.getStockOpnameRequests(filters),
    enabled: Boolean(filters?.outletId && filters.outletId !== "all")
  });
}

export function useStockOpnameMaterialSelection(outletId) {
  return useQuery({
    queryKey: ["stock-opname-material-selection", outletId],
    queryFn: () => adminApi.getStockOpnameMaterialSelection({ outletId }),
    enabled: Boolean(outletId && outletId !== "all")
  });
}

export function useReports(filters) {
  return useQuery({
    queryKey: ["reports", filters],
    queryFn: async () => {
      const masterDataPromise = adminApi.getMasterData({ outletId: filters?.outletId || "all" }).catch(() => null);
      const [reports, masterData] = await Promise.all([adminApi.getReports(filters), masterDataPromise]);
      return normalizeReportData(reports, masterData);
    }
  });
}

export function useReportAccountDetail(filters, options = {}) {
  return useQuery({
    queryKey: ["report-account-detail", filters],
    queryFn: () => adminApi.getReportAccountDetail(filters),
    enabled: Boolean(filters?.accountCode) && options.enabled !== false,
    placeholderData: keepPreviousData
  });
}

export function useActivityLogs(filters) {
  return useQuery({
    queryKey: ["activity-logs", filters],
    queryFn: () => adminApi.getActivityLogs(filters),
    placeholderData: keepPreviousData
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: adminApi.getSettings
  });
}

export function useCreateRecord(entity, invalidateKey) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (payload) => adminApi.createRecord(entity, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invalidateKey });
      toast({
        title: "Data tersimpan",
        description: "Record baru berhasil dibuat.",
        variant: "success"
      });
    },
    onError: (error) => {
      toast({
        title: "Gagal menyimpan",
        description: error.message,
        variant: "destructive"
      });
    }
  });
}

function invalidateKeys(queryClient, keys) {
  keys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
}

function syncSessionUser(user) {
  const { logout, session, setSession } = useAppStore.getState();

  if (!session || !user || session.id !== user.id) return;
  if (user.status !== "active") {
    logout();
    return;
  }

  setSession({
    ...session,
    ...user,
    role: user.role,
    outlets: user.outlets
  });
}

function syncSessionRole(role) {
  const { logout, session, updateSession } = useAppStore.getState();
  if (session?.role_id === role?.id) {
    if (!hasAdminAccess(role)) {
      logout();
      return;
    }
    updateSession({ role });
  }
}

function syncSessionOutletAccess(outlet) {
  const { selectedOutletId, session, setSelectedOutletId, updateSession } = useAppStore.getState();
  if (!session || !outlet) return;

  const currentOutletIds = session.outlet_ids || [];
  const shouldAttachOutlet = session.role_id === "role_owner" && !currentOutletIds.includes(outlet.id);
  const nextOutletIds = shouldAttachOutlet ? [...currentOutletIds, outlet.id] : currentOutletIds;
  const currentOutlets = session.outlets || [];
  const nextOutlets = shouldAttachOutlet ? [...currentOutlets, outlet] : currentOutlets.map((item) => (item.id === outlet.id ? outlet : item));

  if (shouldAttachOutlet || currentOutlets.some((item) => item.id === outlet.id)) {
    updateSession({
      outlet_ids: nextOutletIds,
      outlets: nextOutlets
    });
  }

  if (outlet.status !== "active" && selectedOutletId === outlet.id) {
    setSelectedOutletId("all");
  }
}

function useAdminMutation({
  mutationFn,
  successTitle,
  successDescription,
  errorTitle = "Gagal menyimpan data",
  invalidate = [["master-data"], ["bootstrap"], ["settings"]],
  onSuccessData
}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      invalidateKeys(queryClient, invalidate);
      onSuccessData?.(data);
      toast({
        title: successTitle,
        description: typeof successDescription === "function" ? successDescription(data) : successDescription,
        variant: "success"
      });
    },
    onError: (error) => {
      toast({
        title: errorTitle,
        description: error.message,
        variant: "destructive"
      });
    }
  });
}

export function useCorrectExpense() {
  return useAdminMutation({
    mutationFn: ({ id, payload }) => adminApi.correctExpense(id, payload),
    successTitle: "Pengeluaran dikoreksi",
    successDescription: "Nominal pengeluaran sudah diperbarui dan tercatat di log aktivitas.",
    errorTitle: "Gagal mengoreksi pengeluaran",
    invalidate: [["reports"], ["dashboard"], ["activity-logs"], ["master-data"], ["expense-category-detail"]]
  });
}

export function useApproveExpense() {
  return useAdminMutation({
    mutationFn: (id) => adminApi.approveExpense(id),
    successTitle: "Pengeluaran di-approve",
    successDescription: "Pengeluaran sekarang masuk laporan pengeluaran dan Laba Rugi.",
    errorTitle: "Gagal approve pengeluaran",
    invalidate: [["reports"], ["dashboard"], ["activity-logs"], ["master-data"], ["expense-category-detail"]]
  });
}

export function useRejectExpense() {
  return useAdminMutation({
    mutationFn: ({ id, payload }) => adminApi.rejectExpense(id, payload),
    successTitle: "Pengeluaran di-reject",
    successDescription: "Pengeluaran tetap tersimpan sebagai histori dan tidak masuk laporan nominal.",
    errorTitle: "Gagal reject pengeluaran",
    invalidate: [["reports"], ["dashboard"], ["activity-logs"], ["master-data"], ["expense-category-detail"]]
  });
}

export function useRefundTransaction() {
  return useAdminMutation({
    mutationFn: ({ id, payload }) => adminApi.refundTransaction(id, payload),
    successTitle: "Transaksi di-refund",
    successDescription: "Status transaksi berubah menjadi refunded, stok dikembalikan jika sebelumnya terpotong.",
    errorTitle: "Gagal refund transaksi",
    invalidate: [["reports"], ["dashboard"], ["inventory"], ["activity-logs"], ["sales-outlet-comparison"], ["stock-opname-worksheet"]]
  });
}

export function useCorrectTransactionItems() {
  return useAdminMutation({
    mutationFn: ({ id, payload }) => adminApi.correctTransactionItems(id, payload),
    successTitle: "Item transaksi dikoreksi",
    successDescription: "Item, total, serta dampak stok dan poin sudah diperbarui sesuai status transaksi.",
    errorTitle: "Gagal mengoreksi item transaksi",
    invalidate: [
      ["reports"],
      ["dashboard"],
      ["inventory"],
      ["activity-logs"],
      ["sales-outlet-comparison"],
      ["stock-opname-worksheet"],
      ["master-data"],
      ["mobile-catalog"]
    ]
  });
}

export function useCancelTransaction() {
  return useAdminMutation({
    mutationFn: ({ id, payload }) => adminApi.cancelTransaction(id, payload),
    successTitle: "Transaksi di-cancel",
    successDescription: "Status transaksi berubah menjadi cancelled dan stok dikembalikan jika sebelumnya terpotong.",
    errorTitle: "Gagal cancel transaksi",
    invalidate: [["reports"], ["dashboard"], ["inventory"], ["activity-logs"], ["sales-outlet-comparison"], ["stock-opname-worksheet"]]
  });
}

function useProductMutation({
  mutationFn,
  successTitle,
  successDescription,
  errorTitle = "Gagal menyimpan data",
  invalidate = [["master-data"], ["inventory"], ["dashboard"], ["reports"], ["mobile-catalog"], ["product-detail"]]
}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      invalidateKeys(queryClient, invalidate);
      toast({
        title: successTitle,
        description: successDescription,
        variant: "success"
      });
    },
    onError: (error) => {
      toast({
        title: errorTitle,
        description: error.message,
        variant: "destructive"
      });
    }
  });
}

function splitProductImagePayload(payload = {}) {
  const { _imageFile, _removeImage, ...productPayload } = payload;
  return {
    productPayload,
    imageFile: _imageFile || null,
    removeImage: Boolean(_removeImage)
  };
}

const userInvalidations = [["master-data"], ["bootstrap"], ["settings"], ["mobile-catalog"]];

export function useCreateUser() {
  return useAdminMutation({
    mutationFn: (payload) => adminApi.createUser(payload),
    successTitle: "User ditambahkan",
    successDescription: "User baru sudah tersimpan.",
    errorTitle: "Gagal menyimpan user",
    invalidate: userInvalidations
  });
}

export function useUpdateUser() {
  return useAdminMutation({
    mutationFn: ({ id, payload }) => adminApi.updateUser(id, payload),
    successTitle: "User diperbarui",
    successDescription: "Role, outlet, dan status user sudah tersimpan.",
    errorTitle: "Gagal menyimpan user",
    invalidate: userInvalidations,
    onSuccessData: syncSessionUser
  });
}

export function useUpdateProfile() {
  return useAdminMutation({
    mutationFn: ({ id, payload }) => adminApi.updateProfile(id, payload),
    successTitle: "Profil diperbarui",
    successDescription: "Informasi akun session sudah mengikuti data terbaru.",
    errorTitle: "Gagal menyimpan profil",
    invalidate: [["bootstrap"], ["master-data"]],
    onSuccessData: syncSessionUser
  });
}

export function useChangeProfilePassword() {
  return useAdminMutation({
    mutationFn: ({ id, payload }) => adminApi.changeProfilePassword(id, payload),
    successTitle: "Password diperbarui",
    successDescription: "Password akun sudah diperbarui.",
    errorTitle: "Gagal mengganti password",
    invalidate: [["bootstrap"], ["master-data"]],
    onSuccessData: syncSessionUser
  });
}

export function useToggleUserStatus() {
  return useAdminMutation({
    mutationFn: (id) => adminApi.toggleUserStatus(id),
    successTitle: "Status user diperbarui",
    successDescription: "User tetap tersedia di master data dengan status terbaru.",
    errorTitle: "Gagal mengubah status user",
    invalidate: userInvalidations,
    onSuccessData: syncSessionUser
  });
}

export function useResetUserPassword() {
  return useAdminMutation({
    mutationFn: (id) => adminApi.resetUserPassword(id),
    successTitle: "Password direset",
    successDescription: (data) => `Password sementara: ${data.temporary_password}`,
    errorTitle: "Gagal reset password",
    invalidate: userInvalidations
  });
}

const roleInvalidations = [["settings"], ["master-data"], ["bootstrap"], ["mobile-catalog"]];

export function useCreateRole() {
  return useAdminMutation({
    mutationFn: (payload) => adminApi.createRole(payload),
    successTitle: "Role ditambahkan",
    successDescription: "Role baru siap diberi permission.",
    errorTitle: "Gagal membuat role",
    invalidate: roleInvalidations
  });
}

export function useUpdateRole() {
  return useAdminMutation({
    mutationFn: ({ roleId, payload }) => adminApi.updateRole(roleId, payload),
    successTitle: "Role diperbarui",
    successDescription: "Nama dan deskripsi role sudah tersimpan.",
    errorTitle: "Gagal memperbarui role",
    invalidate: roleInvalidations,
    onSuccessData: syncSessionRole
  });
}

export function useDeleteRole() {
  return useAdminMutation({
    mutationFn: (roleId) => adminApi.deleteRole(roleId),
    successTitle: "Role dihapus",
    successDescription: "Role custom yang tidak digunakan sudah dihapus.",
    errorTitle: "Gagal menghapus role",
    invalidate: roleInvalidations
  });
}

export function useUpdateRolePermissions() {
  return useAdminMutation({
    mutationFn: ({ roleId, permissions }) => adminApi.updateRolePermissions(roleId, permissions),
    successTitle: "Permission diperbarui",
    successDescription: "Perubahan role langsung aktif di menu dan action.",
    errorTitle: "Gagal mengubah permission",
    invalidate: roleInvalidations,
    onSuccessData: syncSessionRole
  });
}

export function useUpdatePrintSettings() {
  return useAdminMutation({
    mutationFn: (payload) => adminApi.updatePrintSettings(payload),
    successTitle: "Pengaturan printer diperbarui",
    successDescription: "Routing print siap masuk ke export catalog APK.",
    errorTitle: "Gagal menyimpan pengaturan printer",
    invalidate: [["settings"], ["master-data"]]
  });
}

export function useUpdateAppSecuritySettings() {
  return useAdminMutation({
    mutationFn: (payload) => adminApi.updateAppSecuritySettings(payload),
    successTitle: "Keamanan APK diperbarui",
    successDescription: "PIN laporan APK sudah mengikuti pengaturan terbaru.",
    errorTitle: "Gagal menyimpan keamanan APK",
    invalidate: [["settings"], ["mobile-catalog"]]
  });
}

export function useGenerateCustomerBarcode() {
  return useMutation({
    mutationFn: (outletId) => adminApi.generateCustomerBarcode(outletId)
  });
}

const customerInvalidations = [["master-data"], ["dashboard"], ["reports"], ["mobile-catalog"], ["customer-detail"]];

export function useCreateCustomer() {
  return useAdminMutation({
    mutationFn: (payload) => adminApi.createCustomer(payload),
    successTitle: "Customer ditambahkan",
    successDescription: "Barcode customer sudah dibuat.",
    errorTitle: "Gagal menyimpan customer",
    invalidate: customerInvalidations
  });
}

export function useUpdateCustomer() {
  return useAdminMutation({
    mutationFn: ({ id, payload }) => adminApi.updateCustomer(id, payload),
    successTitle: "Customer diperbarui",
    successDescription: "Data customer dan barcode sudah tersimpan.",
    errorTitle: "Gagal menyimpan customer",
    invalidate: customerInvalidations
  });
}

export function useToggleCustomerStatus() {
  return useAdminMutation({
    mutationFn: (id) => adminApi.toggleCustomerStatus(id),
    successTitle: "Status customer diperbarui",
    successDescription: "Customer tetap tersedia di master data dengan status terbaru.",
    errorTitle: "Gagal mengubah status customer",
    invalidate: customerInvalidations
  });
}

const outletInvalidations = [["bootstrap"], ["master-data"], ["inventory"], ["dashboard"], ["reports"], ["mobile-catalog"], ["outlet-detail"]];

export function useCreateOutlet() {
  return useAdminMutation({
    mutationFn: (payload) => adminApi.createOutlet(payload),
    successTitle: "Outlet ditambahkan",
    successDescription: "Outlet baru tersedia untuk filter dan assignment user. Harga produk dan stok harga pokok produksi diatur manual.",
    errorTitle: "Gagal menyimpan outlet",
    invalidate: outletInvalidations,
    onSuccessData: syncSessionOutletAccess
  });
}

export function useUpdateOutlet() {
  return useAdminMutation({
    mutationFn: ({ id, payload }) => adminApi.updateOutlet(id, payload),
    successTitle: "Outlet diperbarui",
    successDescription: "Perubahan outlet sudah tersimpan.",
    errorTitle: "Gagal menyimpan outlet",
    invalidate: outletInvalidations,
    onSuccessData: syncSessionOutletAccess
  });
}

export function useToggleOutletStatus() {
  return useAdminMutation({
    mutationFn: (id) => adminApi.toggleOutletStatus(id),
    successTitle: "Status outlet diperbarui",
    successDescription: "Outlet tetap tersedia di master data dengan status terbaru.",
    errorTitle: "Gagal mengubah status outlet",
    invalidate: outletInvalidations,
    onSuccessData: syncSessionOutletAccess
  });
}

const tableInvalidations = [["master-data"], ["bootstrap"], ["dashboard"], ["reports"], ["mobile-catalog"], ["table-detail"]];

export function useCreateTable() {
  return useAdminMutation({
    mutationFn: (payload) => adminApi.createTable(payload),
    successTitle: "Meja ditambahkan",
    successDescription: "Meja baru sudah tersedia di master data outlet.",
    errorTitle: "Gagal menyimpan meja",
    invalidate: tableInvalidations
  });
}

export function useGenerateTables() {
  return useAdminMutation({
    mutationFn: (payload) => adminApi.generateTables(payload),
    successTitle: "Meja berhasil digenerate",
    successDescription: (result) =>
      `${result.count} meja berhasil dibuat: ${result.first_number}–${result.last_number}.`,
    errorTitle: "Gagal generate meja",
    invalidate: tableInvalidations
  });
}

export function useUpdateTable() {
  return useAdminMutation({
    mutationFn: ({ id, payload }) => adminApi.updateTable(id, payload),
    successTitle: "Meja diperbarui",
    successDescription: "Perubahan meja sudah tersimpan.",
    errorTitle: "Gagal menyimpan meja",
    invalidate: tableInvalidations
  });
}

export function useToggleTableStatus() {
  return useAdminMutation({
    mutationFn: (id) => adminApi.toggleTableStatus(id),
    successTitle: "Status meja diperbarui",
    successDescription: "Meja tetap tersedia di histori transaksi dengan status terbaru.",
    errorTitle: "Gagal mengubah status meja",
    invalidate: tableInvalidations
  });
}

const categoryInvalidations = [["master-data"], ["dashboard"], ["reports"], ["mobile-catalog"], ["category-detail"], ["product-detail"]];

export function useCreateCategory() {
  return useAdminMutation({
    mutationFn: (payload) => adminApi.createCategory(payload),
    successTitle: "Kategori ditambahkan",
    successDescription: "Kategori baru sudah tersedia di form produk.",
    errorTitle: "Gagal menyimpan kategori",
    invalidate: categoryInvalidations
  });
}

export function useUpdateCategory() {
  return useAdminMutation({
    mutationFn: ({ id, payload }) => adminApi.updateCategory(id, payload),
    successTitle: "Kategori diperbarui",
    successDescription: "Perubahan kategori sudah tersimpan.",
    errorTitle: "Gagal menyimpan kategori",
    invalidate: categoryInvalidations
  });
}

export function useToggleCategoryStatus() {
  return useAdminMutation({
    mutationFn: (id) => adminApi.toggleCategoryStatus(id),
    successTitle: "Status kategori diperbarui",
    successDescription: "Kategori tetap tersedia di histori dan produk existing.",
    errorTitle: "Gagal mengubah status kategori",
    invalidate: categoryInvalidations
  });
}

const expenseCategoryInvalidations = [["master-data"], ["dashboard"], ["reports"], ["mobile-catalog"], ["expense-category-detail"]];

export function useCreateExpenseCategory() {
  return useAdminMutation({
    mutationFn: (payload) => adminApi.createExpenseCategory(payload),
    successTitle: "Kategori pengeluaran ditambahkan",
    successDescription: "Kategori baru sudah tersedia untuk export catalog APK.",
    errorTitle: "Gagal menyimpan nama pengeluaran operasional",
    invalidate: expenseCategoryInvalidations
  });
}

export function useUpdateExpenseCategory() {
  return useAdminMutation({
    mutationFn: ({ id, payload }) => adminApi.updateExpenseCategory(id, payload),
    successTitle: "Kategori pengeluaran diperbarui",
    successDescription: "Perubahan nama pengeluaran operasional sudah tersimpan.",
    errorTitle: "Gagal menyimpan nama pengeluaran operasional",
    invalidate: expenseCategoryInvalidations
  });
}

export function useToggleExpenseCategoryStatus() {
  return useAdminMutation({
    mutationFn: (id) => adminApi.toggleExpenseCategoryStatus(id),
    successTitle: "Status nama pengeluaran operasional diperbarui",
    successDescription: "Kategori inactive tidak tersedia untuk expense baru di APK.",
    errorTitle: "Gagal mengubah status nama pengeluaran operasional",
    invalidate: expenseCategoryInvalidations
  });
}

const paymentMethodInvalidations = [["master-data"], ["reports"], ["mobile-catalog"]];

export function useCreatePaymentMethod() {
  return useAdminMutation({
    mutationFn: (payload) => adminApi.createPaymentMethod(payload),
    successTitle: "Metode pembayaran ditambahkan",
    successDescription: "Metode aktif akan tersedia di APK setelah sync catalog.",
    errorTitle: "Gagal menyimpan metode pembayaran",
    invalidate: paymentMethodInvalidations
  });
}

export function useUpdatePaymentMethod() {
  return useAdminMutation({
    mutationFn: ({ id, payload }) => adminApi.updatePaymentMethod(id, payload),
    successTitle: "Metode pembayaran diperbarui",
    successDescription: "Perubahan metode pembayaran sudah tersimpan.",
    errorTitle: "Gagal menyimpan metode pembayaran",
    invalidate: paymentMethodInvalidations
  });
}

export function useTogglePaymentMethodStatus() {
  return useAdminMutation({
    mutationFn: (id) => adminApi.togglePaymentMethodStatus(id),
    successTitle: "Status metode pembayaran diperbarui",
    successDescription: "APK hanya menampilkan metode aktif setelah sync catalog.",
    errorTitle: "Gagal mengubah status metode pembayaran",
    invalidate: paymentMethodInvalidations
  });
}

const financeInvalidations = [["master-data"], ["reports"], ["dashboard"], ["activity-logs"]];

export function useCreateFinancialAccount() {
  return useAdminMutation({
    mutationFn: (payload) => adminApi.createFinancialAccount(payload),
    successTitle: "Akun laporan ditambahkan",
    successDescription: "Akun baru bisa dipakai di laporan Laba Rugi dan Neraca.",
    errorTitle: "Gagal menyimpan akun laporan",
    invalidate: financeInvalidations
  });
}

export function useUpdateFinancialAccount() {
  return useAdminMutation({
    mutationFn: ({ id, payload }) => adminApi.updateFinancialAccount(id, payload),
    successTitle: "Akun laporan diperbarui",
    successDescription: "Perubahan akun sudah tersimpan.",
    errorTitle: "Gagal menyimpan akun laporan",
    invalidate: financeInvalidations
  });
}

export function useToggleFinancialAccountStatus() {
  return useAdminMutation({
    mutationFn: (id) => adminApi.toggleFinancialAccountStatus(id),
    successTitle: "Status akun laporan diperbarui",
    successDescription: "Laporan hanya memakai akun aktif untuk pilihan utama.",
    errorTitle: "Gagal mengubah status akun laporan",
    invalidate: financeInvalidations
  });
}

export function useCreateFinanceEntryGroup() {
  return useAdminMutation({
    mutationFn: (payload) => adminApi.createFinanceEntryGroup(payload),
    successTitle: "Pos Keuangan ditambahkan",
    successDescription: "Pos baru sudah tersedia untuk mencatat transaksi masuk/keluar.",
    errorTitle: "Gagal menyimpan Pos Keuangan",
    invalidate: financeInvalidations
  });
}

export function useUpdateFinanceEntryGroup() {
  return useAdminMutation({
    mutationFn: ({ id, payload }) => adminApi.updateFinanceEntryGroup(id, payload),
    successTitle: "Pos Keuangan dikoreksi",
    successDescription: "Perubahan pos sudah tersimpan dan transaksi terkait mengikuti pos ini.",
    errorTitle: "Gagal menyimpan koreksi Pos Keuangan",
    invalidate: financeInvalidations
  });
}

export function useToggleFinanceEntryGroupStatus() {
  return useAdminMutation({
    mutationFn: (id) => adminApi.toggleFinanceEntryGroupStatus(id),
    successTitle: "Status Pos Keuangan diperbarui",
    successDescription: "Pos inactive tidak bisa dipakai untuk transaksi baru.",
    errorTitle: "Gagal mengubah status Pos Keuangan",
    invalidate: financeInvalidations
  });
}

export function useCreateFinanceEntry() {
  return useAdminMutation({
    mutationFn: (payload) => adminApi.createFinanceEntry(payload),
    successTitle: "Transaksi keuangan ditambahkan",
    successDescription: "Transaksi baru langsung masuk histori dan mempengaruhi laporan sesuai akun.",
    errorTitle: "Gagal menyimpan transaksi keuangan",
    invalidate: financeInvalidations
  });
}

export function useUpdateFinanceEntry() {
  return useAdminMutation({
    mutationFn: ({ id, payload }) => adminApi.updateFinanceEntry(id, payload),
    successTitle: "Transaksi keuangan dikoreksi",
    successDescription: "Koreksi transaksi sudah masuk ke histori laporan.",
    errorTitle: "Gagal menyimpan koreksi transaksi keuangan",
    invalidate: financeInvalidations
  });
}

export function useToggleFinanceEntryStatus() {
  return useAdminMutation({
    mutationFn: (id) => adminApi.toggleFinanceEntryStatus(id),
    successTitle: "Status transaksi keuangan diperbarui",
    successDescription: "Transaksi inactive tidak dihitung ke laporan.",
    errorTitle: "Gagal mengubah status transaksi keuangan",
    invalidate: financeInvalidations
  });
}

const discountInvalidations = [["master-data"], ["reports"], ["mobile-catalog"]];

export function useCreateDiscount() {
  return useAdminMutation({
    mutationFn: (payload) => adminApi.createDiscount(payload),
    successTitle: "Discount ditambahkan",
    successDescription: "Discount aktif dalam periode akan muncul di APK setelah sync catalog.",
    errorTitle: "Gagal menyimpan discount",
    invalidate: discountInvalidations
  });
}

export function useUpdateDiscount() {
  return useAdminMutation({
    mutationFn: ({ id, payload }) => adminApi.updateDiscount(id, payload),
    successTitle: "Discount diperbarui",
    successDescription: "Perubahan discount sudah tersimpan.",
    errorTitle: "Gagal menyimpan discount",
    invalidate: discountInvalidations
  });
}

export function useToggleDiscountStatus() {
  return useAdminMutation({
    mutationFn: (id) => adminApi.toggleDiscountStatus(id),
    successTitle: "Status discount diperbarui",
    successDescription: "APK hanya menampilkan discount aktif dalam periode.",
    errorTitle: "Gagal mengubah status discount",
    invalidate: discountInvalidations
  });
}

const materialCategoryInvalidations = [["master-data"], ["inventory"], ["reports"], ["mobile-catalog"], ["material-category-detail"]];

export function useCreateMaterialCategory() {
  return useAdminMutation({
    mutationFn: (payload) => adminApi.createMaterialCategory(payload),
    successTitle: "Kategori harga pokok produksi ditambahkan",
    successDescription: "Kategori baru sudah tersedia untuk harga pokok produksi.",
    errorTitle: "Gagal menyimpan kategori harga pokok produksi",
    invalidate: materialCategoryInvalidations
  });
}

export function useUpdateMaterialCategory() {
  return useAdminMutation({
    mutationFn: ({ id, payload }) => adminApi.updateMaterialCategory(id, payload),
    successTitle: "Kategori harga pokok produksi diperbarui",
    successDescription: "Perubahan kategori harga pokok produksi sudah tersimpan.",
    errorTitle: "Gagal menyimpan kategori harga pokok produksi",
    invalidate: materialCategoryInvalidations
  });
}

export function useToggleMaterialCategoryStatus() {
  return useAdminMutation({
    mutationFn: (id) => adminApi.toggleMaterialCategoryStatus(id),
    successTitle: "Status kategori harga pokok produksi diperbarui",
    successDescription: "Kategori inactive tidak tersedia untuk harga pokok produksi baru.",
    errorTitle: "Gagal mengubah status kategori harga pokok produksi",
    invalidate: materialCategoryInvalidations
  });
}

const compositionInvalidations = [["master-data"], ["dashboard"], ["reports"], ["mobile-catalog"], ["product-detail"]];

export function useCreateProductComposition() {
  return useAdminMutation({
    mutationFn: (payload) => adminApi.createProductComposition(payload),
    successTitle: "Komposisi ditambahkan",
    successDescription: "Harga Pokok Produksi sudah masuk ke komposisi produk.",
    errorTitle: "Gagal menyimpan komposisi",
    invalidate: compositionInvalidations
  });
}

export function useUpdateProductComposition() {
  return useAdminMutation({
    mutationFn: ({ id, payload }) => adminApi.updateProductComposition(id, payload),
    successTitle: "Komposisi diperbarui",
    successDescription: "Perubahan harga pokok produksi dan qty komposisi sudah tersimpan.",
    errorTitle: "Gagal menyimpan komposisi",
    invalidate: compositionInvalidations
  });
}

export function useDeleteProductComposition() {
  return useAdminMutation({
    mutationFn: (id) => adminApi.deleteProductComposition(id),
    successTitle: "Komposisi dihapus",
    successDescription: "Harga Pokok Produksi sudah dihapus dari komposisi produk.",
    errorTitle: "Gagal menghapus komposisi",
    invalidate: compositionInvalidations
  });
}

export function useCreateProduct() {
  return useProductMutation({
    mutationFn: async (payload) => {
      const { productPayload, imageFile } = splitProductImagePayload(payload);
      const product = await adminApi.createProduct(productPayload);
      if (!imageFile) return product;
      return adminApi.uploadProductImage(product.id, imageFile);
    },
    successTitle: "Produk ditambahkan",
    successDescription: "Produk baru sudah tersimpan.",
    errorTitle: "Gagal menyimpan produk"
  });
}

export function useUpdateProduct() {
  return useProductMutation({
    mutationFn: async ({ id, payload }) => {
      const { productPayload, imageFile, removeImage } = splitProductImagePayload(payload);
      let product = await adminApi.updateProduct(id, productPayload);
      if (imageFile) {
        product = await adminApi.uploadProductImage(id, imageFile);
      } else if (removeImage) {
        product = await adminApi.deleteProductImage(id);
      }
      return product;
    },
    successTitle: "Produk diperbarui",
    successDescription: "Perubahan produk sudah tersimpan.",
    errorTitle: "Gagal menyimpan produk"
  });
}

export function useToggleProductStatus() {
  return useProductMutation({
    mutationFn: (id) => adminApi.toggleProductStatus(id),
    successTitle: "Status produk diperbarui",
    successDescription: "Produk tetap tersedia di tabel dengan status terbaru.",
    errorTitle: "Gagal mengubah status produk"
  });
}

export function useCreateMaterial() {
  return useProductMutation({
    mutationFn: (payload) => adminApi.createMaterial(payload),
    successTitle: "Harga Pokok Produksi ditambahkan",
    successDescription: "Harga Pokok Produksi sudah tersimpan dengan type dan kategori.",
    errorTitle: "Gagal menyimpan harga pokok produksi"
  });
}

export function useUpdateMaterial() {
  return useProductMutation({
    mutationFn: ({ id, payload }) => adminApi.updateMaterial(id, payload),
    successTitle: "Harga Pokok Produksi diperbarui",
    successDescription: "Master harga pokok produksi sudah diperbarui. Stok outlet tetap mengikuti transaksi inventory.",
    errorTitle: "Gagal menyimpan harga pokok produksi"
  });
}

export function useToggleMaterialStatus() {
  return useProductMutation({
    mutationFn: (id) => adminApi.toggleMaterialStatus(id),
    successTitle: "Status harga pokok produksi diperbarui",
    successDescription: "Harga Pokok Produksi tetap tersedia di master data dengan status terbaru.",
    errorTitle: "Gagal mengubah status harga pokok produksi"
  });
}

export function useCreateUnit() {
  return useProductMutation({
    mutationFn: (payload) => adminApi.createUnit(payload),
    successTitle: "Unit ditambahkan",
    successDescription: "Unit baru sudah tersedia di form harga pokok produksi.",
    errorTitle: "Gagal menyimpan unit"
  });
}

export function useUpdateUnit() {
  return useProductMutation({
    mutationFn: ({ id, payload }) => adminApi.updateUnit(id, payload),
    successTitle: "Unit diperbarui",
    successDescription: "Perubahan unit sudah disinkronkan ke data harga pokok produksi.",
    errorTitle: "Gagal menyimpan unit"
  });
}

export function useToggleUnitStatus() {
  return useProductMutation({
    mutationFn: (id) => adminApi.toggleUnitStatus(id),
    successTitle: "Status unit diperbarui",
    successDescription: "Unit tetap tersedia di master data dengan status terbaru.",
    errorTitle: "Gagal mengubah status unit"
  });
}

const supplierInvalidations = [["master-data"], ["inventory"], ["dashboard"], ["reports"], ["mobile-catalog"], ["supplier-detail"]];

export function useCreateSupplier() {
  return useProductMutation({
    mutationFn: (payload) => adminApi.createSupplier(payload),
    successTitle: "Supplier ditambahkan",
    successDescription: "Supplier aktif sudah tersedia untuk pembelian harga pokok produksi.",
    errorTitle: "Gagal menyimpan supplier",
    invalidate: supplierInvalidations
  });
}

export function useUpdateSupplier() {
  return useProductMutation({
    mutationFn: ({ id, payload }) => adminApi.updateSupplier(id, payload),
    successTitle: "Supplier diperbarui",
    successDescription: "Perubahan supplier sudah tersimpan.",
    errorTitle: "Gagal menyimpan supplier",
    invalidate: supplierInvalidations
  });
}

export function useToggleSupplierStatus() {
  return useProductMutation({
    mutationFn: (id) => adminApi.toggleSupplierStatus(id),
    successTitle: "Status supplier diperbarui",
    successDescription: "Supplier tetap tersedia di histori pembelian dengan status terbaru.",
    errorTitle: "Gagal mengubah status supplier",
    invalidate: supplierInvalidations
  });
}

export function useCreatePurchase() {
  return useProductMutation({
    mutationFn: (payload) => adminApi.createPurchase(payload),
    successTitle: "Pembelian disimpan",
    successDescription: "Pembelian menunggu approval admin sebelum menambah stok.",
    errorTitle: "Gagal menyimpan pembelian"
  });
}

export function useUpdatePurchase() {
  return useProductMutation({
    mutationFn: ({ id, payload }) => adminApi.updatePurchase(id, payload),
    successTitle: "Pembelian diperbarui",
    successDescription: "Koreksi pembelian sudah tersimpan dan data terkait diperbarui.",
    errorTitle: "Gagal menyimpan pembelian"
  });
}

export function useApprovePurchase() {
  return useProductMutation({
    mutationFn: ({ id, payload }) => adminApi.approvePurchase(id, payload),
    successTitle: "Pembelian disetujui",
    successDescription: "Stok dan laporan sudah diperbarui.",
    errorTitle: "Gagal approve pembelian"
  });
}

export function useRejectPurchase() {
  return useProductMutation({
    mutationFn: ({ id, payload }) => adminApi.rejectPurchase(id, payload),
    successTitle: "Pembelian ditolak",
    successDescription: "Pembelian tidak mengubah stok dan laporan.",
    errorTitle: "Gagal reject pembelian"
  });
}

export function useCreateStockTransfer() {
  return useProductMutation({
    mutationFn: (payload) => adminApi.createStockTransfer(payload),
    successTitle: "Request transfer disimpan",
    successDescription: "Transfer menunggu approval admin.",
    errorTitle: "Gagal menyimpan transfer stok"
  });
}

export function useUpdateStockTransfer() {
  return useProductMutation({
    mutationFn: ({ id, payload }) => adminApi.updateStockTransfer(id, payload),
    successTitle: "Transfer diperbarui",
    successDescription: "Request transfer pending sudah dikoreksi.",
    errorTitle: "Gagal menyimpan transfer stok"
  });
}

export function useApproveStockTransfer() {
  return useProductMutation({
    mutationFn: ({ id, payload }) => adminApi.approveStockTransfer(id, payload),
    successTitle: "Transfer disetujui",
    successDescription: "Stok outlet asal dan tujuan sudah diperbarui.",
    errorTitle: "Gagal approve transfer stok"
  });
}

export function useRejectStockTransfer() {
  return useProductMutation({
    mutationFn: ({ id, payload }) => adminApi.rejectStockTransfer(id, payload),
    successTitle: "Transfer ditolak",
    successDescription: "Request transfer sudah ditandai ditolak.",
    errorTitle: "Gagal reject transfer stok"
  });
}

export function useCreateStockOpname() {
  return useProductMutation({
    mutationFn: (payload) => adminApi.createStockOpname(payload),
    successTitle: "Stock opname disimpan",
    successDescription: "Stok sistem sudah disesuaikan dengan stok fisik.",
    errorTitle: "Gagal menyimpan stock opname",
    invalidate: [["master-data"], ["inventory"], ["dashboard"], ["reports"], ["stock-opname-worksheet"]]
  });
}

export function useCreateStockOpnameBatch() {
  return useProductMutation({
    mutationFn: (payload) => adminApi.createStockOpnameBatch(payload),
    successTitle: "Stock opname batch disimpan",
    successDescription: "Stok harga pokok produksi outlet sudah disesuaikan dari worksheet.",
    errorTitle: "Gagal menyimpan stock opname batch",
    invalidate: [["master-data"], ["inventory"], ["dashboard"], ["reports"], ["stock-opname-worksheet"], ["stock-opname-requests"]]
  });
}

export function useApproveStockOpnameRequest() {
  return useProductMutation({
    mutationFn: ({ id, payload }) => adminApi.approveStockOpnameRequest(id, payload),
    successTitle: "Request opname di-approve",
    successDescription: "Stok outlet sudah disesuaikan dari request APK.",
    errorTitle: "Gagal approve request opname",
    invalidate: [["master-data"], ["inventory"], ["dashboard"], ["reports"], ["stock-opname-worksheet"], ["stock-opname-requests"], ["activity-logs"]]
  });
}

export function useRejectStockOpnameRequest() {
  return useProductMutation({
    mutationFn: ({ id, payload }) => adminApi.rejectStockOpnameRequest(id, payload),
    successTitle: "Request opname ditolak",
    successDescription: "Request APK sudah ditandai ditolak.",
    errorTitle: "Gagal reject request opname",
    invalidate: [["inventory"], ["stock-opname-requests"], ["activity-logs"]]
  });
}

export function useUpdateStockOpnameMaterialSelection() {
  return useProductMutation({
    mutationFn: (payload) => adminApi.updateStockOpnameMaterialSelection(payload),
    successTitle: "Pilihan item APK disimpan",
    successDescription: "Daftar Stock Opname APK untuk outlet sudah diperbarui.",
    errorTitle: "Gagal menyimpan pilihan item APK",
    invalidate: [["stock-opname-material-selection"], ["activity-logs"]]
  });
}
