import { apiClient } from "@/lib/apiClient";

export const adminApi = {
  async login(payload) {
    return apiClient.post("/auth/login", payload);
  },

  async getBootstrap() {
    return apiClient.get("/bootstrap");
  },

  async getDashboard(filters) {
    return apiClient.get("/dashboard", { params: filters });
  },

  async getDashboardMaterialPurchaseComparisons(filters) {
    return apiClient.get("/dashboard/material-purchase-comparisons", { params: filters });
  },

  async getMasterData(filters) {
    return apiClient.get("/master-data", { params: filters });
  },

  async downloadMasterImportTemplate() {
    return apiClient.get("/admin/imports/master-data/template", {
      responseType: "blob"
    });
  },

  async previewMasterImport(file) {
    const formData = new globalThis.FormData();
    formData.append("file", file);
    return apiClient.post("/admin/imports/master-data/preview", formData, {
      headers: { "Content-Type": "multipart/form-data" }
    });
  },

  async commitMasterImport(file) {
    const formData = new globalThis.FormData();
    formData.append("file", file);
    return apiClient.post("/admin/imports/master-data/commit", formData, {
      headers: { "Content-Type": "multipart/form-data" }
    });
  },

  async getInventory(filters) {
    return apiClient.get("/inventory", { params: filters });
  },

  async getStockOpnameWorksheet(filters) {
    return apiClient.get("/inventory/stock-opname-worksheet", { params: filters });
  },

  async getStockOpnameRequests(filters) {
    return apiClient.get("/admin/inventory/opname-requests", { params: filters });
  },

  async getStockOpnameMaterialSelection(filters) {
    return apiClient.get("/admin/inventory/opname-material-selection", { params: filters });
  },

  async updateStockOpnameMaterialSelection(payload) {
    return apiClient.put("/admin/inventory/opname-material-selection", payload);
  },

  async getReports(filters) {
    return apiClient.get("/reports", { params: filters });
  },

  async getReportAccountDetail(filters) {
    return apiClient.get("/reports/account-detail", { params: filters });
  },

  async getSalesOutletComparison(filters) {
    return apiClient.get("/reports/sales-outlet-comparison", { params: filters });
  },

  async getSettings() {
    return apiClient.get("/settings");
  },

  async getMobileCatalogSnapshot() {
    return apiClient.get("/mobile/catalog");
  },

  async createRecord(entity, payload) {
    return apiClient.post(`/admin/records/${entity}`, payload);
  },

  async createUser(payload) {
    return apiClient.post("/admin/users", payload);
  },

  async updateUser(id, payload) {
    return apiClient.put(`/admin/users/${id}`, payload);
  },

  async updateProfile(id, payload) {
    return apiClient.put(`/admin/profile/${id}`, payload);
  },

  async changeProfilePassword(id, payload) {
    return apiClient.put(`/admin/profile/${id}/password`, payload);
  },

  async toggleUserStatus(id) {
    return apiClient.patch(`/admin/users/${id}/toggle-status`);
  },

  async resetUserPassword(id) {
    return apiClient.post(`/admin/users/${id}/reset-password`);
  },

  async createRole(payload) {
    return apiClient.post("/admin/roles", payload);
  },

  async updateRole(roleId, payload) {
    return apiClient.put(`/admin/roles/${roleId}`, payload);
  },

  async deleteRole(roleId) {
    return apiClient.delete(`/admin/roles/${roleId}`);
  },

  async updateRolePermissions(roleId, permissions) {
    return apiClient.put(`/admin/roles/${roleId}/permissions`, { permissions });
  },

  async updatePrintSettings(payload) {
    return apiClient.put("/admin/settings/print", payload);
  },

  async updateAppSecuritySettings(payload) {
    return apiClient.put("/admin/settings/app-security", payload);
  },

  async getCustomerDetail(id) {
    return apiClient.get(`/admin/customers/${id}`);
  },

  async generateCustomerBarcode(outletId) {
    return apiClient.post("/admin/customers/barcode", { outlet_id: outletId });
  },

  async createCustomer(payload) {
    return apiClient.post("/admin/customers", payload);
  },

  async updateCustomer(id, payload) {
    return apiClient.put(`/admin/customers/${id}`, payload);
  },

  async toggleCustomerStatus(id) {
    return apiClient.patch(`/admin/customers/${id}/toggle-status`);
  },

  async createOutlet(payload) {
    return apiClient.post("/admin/outlets", payload);
  },

  async getOutletDetail(id) {
    return apiClient.get(`/admin/outlets/${id}`);
  },

  async updateOutlet(id, payload) {
    return apiClient.put(`/admin/outlets/${id}`, payload);
  },

  async toggleOutletStatus(id) {
    return apiClient.patch(`/admin/outlets/${id}/toggle-status`);
  },

  async createTable(payload) {
    return apiClient.post("/admin/tables", payload);
  },

  async generateTables(payload) {
    return apiClient.post("/admin/tables/generate", payload);
  },

  async getTableDetail(id) {
    return apiClient.get(`/admin/tables/${id}`);
  },

  async updateTable(id, payload) {
    return apiClient.put(`/admin/tables/${id}`, payload);
  },

  async toggleTableStatus(id) {
    return apiClient.patch(`/admin/tables/${id}/toggle-status`);
  },

  async getCategoryDetail(id) {
    return apiClient.get(`/admin/categories/${id}`);
  },

  async createCategory(payload) {
    return apiClient.post("/admin/categories", payload);
  },

  async updateCategory(id, payload) {
    return apiClient.put(`/admin/categories/${id}`, payload);
  },

  async toggleCategoryStatus(id) {
    return apiClient.patch(`/admin/categories/${id}/toggle-status`);
  },

  async getExpenseCategoryDetail(id) {
    return apiClient.get(`/admin/expense-categories/${id}`);
  },

  async createExpenseCategory(payload) {
    return apiClient.post("/admin/expense-categories", payload);
  },

  async updateExpenseCategory(id, payload) {
    return apiClient.put(`/admin/expense-categories/${id}`, payload);
  },

  async toggleExpenseCategoryStatus(id) {
    return apiClient.patch(`/admin/expense-categories/${id}/toggle-status`);
  },

  async correctExpense(id, payload) {
    return apiClient.patch(`/admin/expenses/${id}/correction`, payload);
  },

  async approveExpense(id) {
    return apiClient.patch(`/admin/expenses/${id}/approve`);
  },

  async rejectExpense(id, payload) {
    return apiClient.patch(`/admin/expenses/${id}/reject`, payload);
  },

  async createTransaction(payload) {
    return apiClient.post("/admin/transactions", payload);
  },

  async refundTransaction(id, payload) {
    return apiClient.post(`/admin/transactions/${id}/refund`, payload);
  },

  async correctTransactionItems(id, payload) {
    return apiClient.patch(`/admin/transactions/${id}/items`, payload);
  },

  async cancelTransaction(id, payload) {
    return apiClient.post(`/admin/transactions/${id}/cancel`, payload);
  },

  async createPaymentMethod(payload) {
    return apiClient.post("/admin/payment-methods", payload);
  },

  async updatePaymentMethod(id, payload) {
    return apiClient.put(`/admin/payment-methods/${id}`, payload);
  },

  async togglePaymentMethodStatus(id) {
    return apiClient.patch(`/admin/payment-methods/${id}/toggle-status`);
  },

  async createFinancialAccount(payload) {
    return apiClient.post("/admin/financial-accounts", payload);
  },

  async updateFinancialAccount(id, payload) {
    return apiClient.put(`/admin/financial-accounts/${id}`, payload);
  },

  async toggleFinancialAccountStatus(id) {
    return apiClient.patch(`/admin/financial-accounts/${id}/toggle-status`);
  },

  async createFinanceEntryGroup(payload) {
    return apiClient.post("/admin/finance-entry-groups", payload);
  },

  async updateFinanceEntryGroup(id, payload) {
    return apiClient.put(`/admin/finance-entry-groups/${id}`, payload);
  },

  async toggleFinanceEntryGroupStatus(id) {
    return apiClient.patch(`/admin/finance-entry-groups/${id}/toggle-status`);
  },

  async createFinanceEntry(payload) {
    return apiClient.post("/admin/finance-entries", payload);
  },

  async updateFinanceEntry(id, payload) {
    return apiClient.put(`/admin/finance-entries/${id}`, payload);
  },

  async toggleFinanceEntryStatus(id) {
    return apiClient.patch(`/admin/finance-entries/${id}/toggle-status`);
  },

  async createDiscount(payload) {
    return apiClient.post("/admin/discounts", payload);
  },

  async updateDiscount(id, payload) {
    return apiClient.put(`/admin/discounts/${id}`, payload);
  },

  async toggleDiscountStatus(id) {
    return apiClient.patch(`/admin/discounts/${id}/toggle-status`);
  },

  async getMaterialCategoryDetail(id) {
    return apiClient.get(`/admin/material-categories/${id}`);
  },

  async createMaterialCategory(payload) {
    return apiClient.post("/admin/material-categories", payload);
  },

  async updateMaterialCategory(id, payload) {
    return apiClient.put(`/admin/material-categories/${id}`, payload);
  },

  async toggleMaterialCategoryStatus(id) {
    return apiClient.patch(`/admin/material-categories/${id}/toggle-status`);
  },

  async createProductComposition(payload) {
    return apiClient.post("/admin/product-compositions", payload);
  },

  async updateProductComposition(id, payload) {
    return apiClient.put(`/admin/product-compositions/${id}`, payload);
  },

  async deleteProductComposition(id) {
    return apiClient.delete(`/admin/product-compositions/${id}`);
  },

  async getProductDetail(id) {
    return apiClient.get(`/admin/products/${id}`);
  },

  async createProduct(payload) {
    return apiClient.post("/admin/products", payload);
  },

  async updateProduct(id, payload) {
    return apiClient.put(`/admin/products/${id}`, payload);
  },

  async uploadProductImage(id, file) {
    const formData = new globalThis.FormData();
    formData.append("image", file);
    return apiClient.post(`/admin/products/${id}/image`, formData, {
      headers: { "Content-Type": "multipart/form-data" }
    });
  },

  async deleteProductImage(id) {
    return apiClient.delete(`/admin/products/${id}/image`);
  },

  async toggleProductStatus(id) {
    return apiClient.patch(`/admin/products/${id}/toggle-status`);
  },

  async createMaterial(payload) {
    return apiClient.post("/admin/materials", payload);
  },

  async updateMaterial(id, payload) {
    return apiClient.put(`/admin/materials/${id}`, payload);
  },

  async toggleMaterialStatus(id) {
    return apiClient.patch(`/admin/materials/${id}/toggle-status`);
  },

  async createUnit(payload) {
    return apiClient.post("/admin/units", payload);
  },

  async updateUnit(id, payload) {
    return apiClient.put(`/admin/units/${id}`, payload);
  },

  async toggleUnitStatus(id) {
    return apiClient.patch(`/admin/units/${id}/toggle-status`);
  },

  async getSupplierDetail(id) {
    return apiClient.get(`/admin/suppliers/${id}`);
  },

  async createSupplier(payload) {
    return apiClient.post("/admin/suppliers", payload);
  },

  async updateSupplier(id, payload) {
    return apiClient.put(`/admin/suppliers/${id}`, payload);
  },

  async toggleSupplierStatus(id) {
    return apiClient.patch(`/admin/suppliers/${id}/toggle-status`);
  },

  async createPurchase(payload) {
    return apiClient.post("/admin/inventory/purchases", payload);
  },

  async updatePurchase(id, payload) {
    return apiClient.put(`/admin/inventory/purchases/${id}`, payload);
  },

  async approvePurchase(id, payload = {}) {
    return apiClient.patch(`/admin/inventory/purchases/${id}/approve`, payload);
  },

  async rejectPurchase(id, payload = {}) {
    return apiClient.patch(`/admin/inventory/purchases/${id}/reject`, payload);
  },

  async createStockTransfer(payload) {
    return apiClient.post("/admin/inventory/transfers", payload);
  },

  async updateStockTransfer(id, payload) {
    return apiClient.put(`/admin/inventory/transfers/${id}`, payload);
  },

  async approveStockTransfer(id, payload = {}) {
    return apiClient.patch(`/admin/inventory/transfers/${id}/approve`, payload);
  },

  async rejectStockTransfer(id, payload = {}) {
    return apiClient.patch(`/admin/inventory/transfers/${id}/reject`, payload);
  },

  async createStockOpname(payload) {
    return apiClient.post("/admin/inventory/opnames", payload);
  },

  async createStockOpnameBatch(payload) {
    return apiClient.post("/admin/inventory/opname-batches", payload);
  },

  async approveStockOpnameRequest(id, payload = {}) {
    return apiClient.patch(`/admin/inventory/opname-requests/${id}/approve`, payload);
  },

  async rejectStockOpnameRequest(id, payload = {}) {
    return apiClient.patch(`/admin/inventory/opname-requests/${id}/reject`, payload);
  },

  async getActivityLogs(filters) {
    return apiClient.get("/admin/activity-logs", { params: filters });
  },

  async createActivityLog(payload) {
    return apiClient.post("/admin/activity-logs", payload);
  },

  async getDailyReports(filters) {
    return apiClient.get("/admin/daily-reports", { params: filters });
  },

  async approveDailyReport(id) {
    return apiClient.post(`/admin/daily-reports/${id}/approve`);
  },

  async rejectDailyReport(id) {
    return apiClient.post(`/admin/daily-reports/${id}/reject`);
  },

  async updateDailyReport(id, payload) {
    return apiClient.put(`/admin/daily-reports/${id}`, payload);
  },

  async updateStockOpnameRequest(id, payload) {
    return apiClient.put(`/pos/stock-opname-requests/${id}`, payload);
  }
};
