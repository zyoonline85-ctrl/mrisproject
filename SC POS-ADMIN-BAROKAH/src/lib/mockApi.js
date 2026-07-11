import seedData from "../../mock-data/pos-barokah-admin-demo.json";
import { defaultRolePermissions, permissionCatalog } from "@/config/permissionCatalog";
import { includesText } from "@/lib/utils";

const delay = (ms = 220) => new Promise((resolve) => setTimeout(resolve, ms));
const clone = (value) => structuredClone(value);
const byId = (items) => new Map(items.map((item) => [item.id, item]));
const appTimeZone = "Asia/Jakarta";

let data = clone(seedData);
let units = [];
let outletMap = new Map();
let roleMap = new Map();
let userMap = new Map();
let customerMap = new Map();
let productMap = new Map();
let categoryMap = new Map();
let materialMap = new Map();
let supplierMap = new Map();
let tableMap = new Map();

const defaultPaymentMethods = [
  { id: "payment_method_cash", name: "Cash", code: "cash", account_code: "1001", sort_order: 1, status: "active" },
  { id: "payment_method_transfer", name: "Transfer", code: "transfer", account_code: "1002", sort_order: 2, status: "active" },
  { id: "payment_method_qris", name: "QRIS", code: "qris", account_code: "1044", sort_order: 3, status: "active" }
];

function normalizePermissionData() {
  data.permissions = clone(permissionCatalog);
  data.roles = data.roles.map((role) => ({
    ...role,
    permissions: defaultRolePermissions[role.id] || role.permissions || {}
  }));
}

function rebuildIndexes() {
  outletMap = byId(data.outlets);
  roleMap = byId(data.roles);
  userMap = byId(data.users);
  customerMap = byId(data.customers);
  productMap = byId(data.products);
  categoryMap = byId(data.categories);
  materialMap = byId(data.raw_materials);
  supplierMap = byId(data.suppliers);
  tableMap = byId(data.tables);
}

function initializeExpenseCategoriesFromExpenses() {
  if (Array.isArray(data.expense_categories) && data.expense_categories.length) return;

  const seen = new Set();
  data.expense_categories = (data.expenses || []).reduce((result, expense) => {
    const name = String(expense.category || "").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return result;
    seen.add(key);
    result.push({
      id: `expense_cat_${String(result.length + 1).padStart(3, "0")}`,
      name,
      sort_order: result.length + 1,
      status: "active"
    });
    return result;
  }, []);
}

function initializePaymentMethods() {
  data.payment_methods =
    Array.isArray(data.payment_methods) && data.payment_methods.length ? data.payment_methods : clone(defaultPaymentMethods);
  data.payments = Array.isArray(data.payments) ? data.payments : [];
}

function initializeDiscounts() {
  data.discounts = Array.isArray(data.discounts) ? data.discounts : [];
  data.discount_outlets = Array.isArray(data.discount_outlets) ? data.discount_outlets : [];
  const linkedDiscountIds = new Set(data.discount_outlets.map((row) => row.discount_id));
  for (const discount of data.discounts) {
    const embeddedOutletIds = Array.isArray(discount.outlet_ids) ? discount.outlet_ids : [];
    const outletIds = embeddedOutletIds.length
      ? embeddedOutletIds
      : linkedDiscountIds.has(discount.id)
        ? []
        : data.outlets.map((outlet) => outlet.id);
    for (const outletId of outletIds) {
      if (!data.discount_outlets.some((row) => row.discount_id === discount.id && row.outlet_id === outletId)) {
        data.discount_outlets.push({ discount_id: discount.id, outlet_id: outletId });
      }
    }
    delete discount.outlet_ids;
  }
}

function initializeProductVariants() {
  data.product_variants = Array.isArray(data.product_variants) ? data.product_variants : [];
}

function initializePrintSettings() {
  data.print_settings = {
    printer_name: data.print_settings?.printer_name || "Printer Kasir Utama",
    printer_status: data.print_settings?.printer_status || "active",
    mode: "single_printer_mock",
    item_sort_mode: data.print_settings?.item_sort_mode || "category_sort_order"
  };

  if (!Array.isArray(data.print_templates) || !data.print_templates.length) {
    data.print_templates = [
      { key: "customer_order", label: "Customer Order Copy", enabled: true, footer_text: "" },
      { key: "kitchen_order", label: "Kitchen Order", enabled: true, footer_text: "" },
      { key: "bill_receipt", label: "Bill / Receipt", enabled: true, footer_text: "Terima kasih" }
    ];
  }

  data.print_templates = data.print_templates.map((template) => ({
    ...template,
    label: template.key === "kitchen_order" ? "Kitchen Order" : template.label,
    footer_text:
      typeof template.footer_text === "string"
        ? template.footer_text
        : template.key === "bill_receipt"
          ? "Terima kasih"
          : ""
  }));
}

initializeExpenseCategoriesFromExpenses();
initializePaymentMethods();
initializeDiscounts();
initializeProductVariants();
initializePrintSettings();
normalizePermissionData();
rebuildIndexes();

function initializeUnitsFromMaterials() {
  const seen = new Set();
  units = data.raw_materials.reduce((result, material) => {
    if (!material.unit || seen.has(material.unit)) return result;
    seen.add(material.unit);
    result.push({
      id: `unit_${String(result.length + 1).padStart(3, "0")}`,
      name: material.unit,
      code: material.unit,
      status: "active"
    });
    return result;
  }, []);
}

initializeUnitsFromMaterials();

function createSequentialId(prefix, items) {
  const maxNumber = items.reduce((max, item) => {
    const match = String(item.id).match(new RegExp(`^${prefix}_(\\d+)$`));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return `${prefix}_${String(maxNumber + 1).padStart(3, "0")}`;
}

function createIdGenerator(prefix, items) {
  let maxNumber = items.reduce((max, item) => {
    const match = String(item.id).match(new RegExp(`^${prefix}_(\\d+)$`));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return () => {
    maxNumber += 1;
    return `${prefix}_${String(maxNumber).padStart(3, "0")}`;
  };
}

function outletFilter(outletId) {
  return !outletId || outletId === "all" ? () => true : (item) => item.outlet_id === outletId;
}

function withinDateRange(value, from, to) {
  const date = new Date(value);
  const fromDate = new Date(`${from || "2026-04-01"}T00:00:00+07:00`);
  const toDate = new Date(`${to || "2026-04-30"}T23:59:59+07:00`);
  return date >= fromDate && date <= toDate;
}

function isSameDate(value, date) {
  return getLocalDateKey(value) === date;
}

function getLocalDateKey(value) {
  if (!value) return "";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value || "").slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: appTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(parsed);
}

function getLocalHour(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const hourPart = new Intl.DateTimeFormat("en-US", {
    timeZone: appTimeZone,
    hour: "2-digit",
    hour12: false
  })
    .formatToParts(parsed)
    .find((part) => part.type === "hour")?.value;
  const hour = Number(hourPart);
  if (!Number.isFinite(hour)) return null;
  return hour === 24 ? 0 : hour;
}

function roundQuantity(value) {
  return Number(Number(value || 0).toFixed(3));
}

function getOpnameNote(difference) {
  if (Math.abs(difference) < 0.001) return "Pas";
  return difference > 0 ? "Ada barang yang hilang" : "Fisik lebih dari sistem";
}

function getOpnameStatus(difference) {
  if (Math.abs(difference) < 0.001) return "pas";
  return difference > 0 ? "stock_hilang" : "tidak_sesuai_standar";
}

function enrichTransaction(transaction) {
  const items = data.transaction_items
    .filter((item) => item.transaction_id === transaction.id)
    .map((item) => ({
      ...item,
      product: productMap.get(item.product_id)
    }));
  const payments = getTransactionPayments(transaction);
  const payment = payments[0] || null;
  const paidAmount = getTransactionPaidAmount({ ...transaction, payments, payment });
  const changeAmount = getTransactionChangeAmount({ ...transaction, payments, payment });

  return {
    ...transaction,
    outlet: outletMap.get(transaction.outlet_id),
    cashier: userMap.get(transaction.cashier_id),
    customer: transaction.customer_id ? customerMap.get(transaction.customer_id) : null,
    table: transaction.table_id ? tableMap.get(transaction.table_id) : null,
    payment,
    payments,
    paid_amount: paidAmount,
    change_amount: changeAmount,
    items
  };
}

function normalizeTransactionPayment(row, transaction) {
  const method = String(row?.method || row?.payment_method || row?.paymentMethod || "").trim().toLowerCase();
  if (!method) return null;

  return {
    ...row,
    method,
    amount: Number(row?.amount ?? row?.paid_amount ?? row?.paidAmount ?? transaction?.total ?? 0),
    change_amount: Number(row?.change_amount ?? row?.changeAmount ?? 0)
  };
}

function getTransactionPayments(transaction = {}) {
  const embeddedPayments = Array.isArray(transaction.payments) ? transaction.payments : [];
  const sourceRows = embeddedPayments.length
    ? embeddedPayments
    : data.payments.filter((item) => item.transaction_id === transaction.id);
  const payments = sourceRows
    .map((row) => normalizeTransactionPayment(row, transaction))
    .filter(Boolean);

  if (payments.length) return payments;

  const fallback = normalizeTransactionPayment(transaction.payment || transaction, transaction);
  return fallback ? [fallback] : [];
}

function getTransactionPaidAmount(transaction = {}) {
  const payments = getTransactionPayments(transaction);
  if (payments.length) {
    return payments.reduce((total, payment) => total + Number(payment.amount || 0), 0);
  }
  return Number(transaction.payment?.amount ?? transaction.paid_amount ?? transaction.paidAmount ?? transaction.total ?? 0);
}

function getTransactionChangeAmount(transaction = {}) {
  const explicitChange = Number(transaction.change_amount ?? transaction.changeAmount ?? 0);
  const paymentChange = getTransactionPayments(transaction).reduce((total, payment) => total + Number(payment.change_amount || 0), 0);
  if (paymentChange) return paymentChange;
  if (explicitChange) return explicitChange;
  return Math.max(getTransactionPaidAmount(transaction) - Number(transaction.total || 0), 0);
}

function getProductPrice(productId, outletId) {
  const price = data.product_prices.find((item) => item.product_id === productId && item.outlet_id === outletId);
  return price?.price || 0;
}

function productVariantsForProduct(productId, { activeOnly = false } = {}) {
  return (data.product_variants || [])
    .filter((variant) => variant.product_id === productId)
    .filter((variant) => !activeOnly || variant.status === "active")
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.name).localeCompare(String(b.name), "id-ID"));
}

function normalizeProductVariantsPayload(productId, variants = []) {
  const rows = Array.isArray(variants) ? variants : [];
  const cleaned = rows
    .map((variant, index) => ({
      id: variant.id ? String(variant.id) : null,
      product_id: productId,
      name: String(variant.name || "").trim(),
      price_delta: 0,
      sort_order: Number.isFinite(Number(variant.sort_order)) ? Number(variant.sort_order) : index + 1,
      status: variant.status === "inactive" ? "inactive" : "active"
    }))
    .filter((variant) => variant.name);

  if (cleaned.length > 20) {
    throw new Error("Catatan variant maksimal 20 per produk.");
  }

  const seenNames = new Set();
  cleaned.forEach((variant) => {
    const key = variant.name.toLowerCase();
    if (seenNames.has(key)) throw new Error(`Catatan variant ${variant.name} tidak boleh duplikat.`);
    seenNames.add(key);
  });

  const existingById = new Map(productVariantsForProduct(productId).map((variant) => [variant.id, variant]));
  const nextVariantId = createIdGenerator("variant", data.product_variants || []);
  return cleaned.map((variant) => ({
    ...variant,
    id: existingById.has(variant.id) ? variant.id : nextVariantId()
  }));
}

function getProductRows(outletId = "all") {
  return data.products.map((product) => {
    const prices = data.product_prices.filter((price) => price.product_id === product.id);
    const visiblePrices = outletId === "all" ? prices : prices.filter((price) => price.outlet_id === outletId);
    const composition = data.product_compositions
      .filter((item) => item.product_id === product.id)
      .map((item) => ({
        ...item,
        material: materialMap.get(item.material_id)
      }));
    const variants = productVariantsForProduct(product.id);

    return {
      ...product,
      category: categoryMap.get(product.category_id),
      all_prices: prices.map((price) => ({
        ...price,
        outlet: outletMap.get(price.outlet_id)
      })),
      prices: visiblePrices.map((price) => ({
        ...price,
        outlet: outletMap.get(price.outlet_id)
      })),
      composition_count: composition.length,
      composition,
      variant_count: variants.filter((variant) => variant.status === "active").length,
      variants
    };
  }).filter((product) => outletId === "all" || product.prices.some((price) => Number(price.price || 0) > 0 && price.status !== "inactive"));
}

function getCategoryRows() {
  return data.categories
    .map((category) => {
      const products = data.products
        .filter((product) => product.category_id === category.id)
        .map((product) => ({
          ...product,
          price_count: data.product_prices.filter((price) => price.product_id === product.id).length,
          composition_count: data.product_compositions.filter((item) => item.product_id === product.id).length
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "id-ID"));

      return {
        ...category,
        products,
        product_count: products.length
      };
    })
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.name).localeCompare(String(b.name), "id-ID"));
}

function getExpenseCategoryRows(keyword = "") {
  return data.expense_categories
    .map((category) => {
      const expenses = (data.expenses || [])
        .filter((expense) => expense.category?.toLowerCase() === category.name.toLowerCase())
        .map((expense) => ({
          ...expense,
          outlet: outletMap.get(expense.outlet_id),
          created_by_user: userMap.get(expense.created_by)
        }))
        .sort((a, b) => new Date(b.expense_date) - new Date(a.expense_date));

      return {
        ...category,
        expenses,
        expense_count: expenses.length,
        expense_total: expenses.reduce((total, expense) => total + Number(expense.amount || 0), 0)
      };
    })
    .filter((category) => includesText(`${category.name} ${category.status}`, keyword))
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
}

function getPaymentMethodRows(keyword = "") {
  return data.payment_methods
    .filter((method) => includesText(`${method.name} ${method.code} ${method.account_code} ${method.status}`, keyword))
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
}

function dateOnly(value = new Date()) {
  if (value instanceof Date) {
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${value.getFullYear()}-${month}-${day}`;
  }
  return String(value || new Date().toISOString()).slice(0, 10);
}

function isDiscountActiveForDate(discount, date = new Date()) {
  if (!discount || discount.status !== "active") return false;
  const currentDate = dateOnly(date);
  const startsAt = dateOnly(discount.starts_at);
  const endsAt = dateOnly(discount.ends_at);
  return startsAt <= currentDate && endsAt >= currentDate;
}

function getDiscountOutletIds(discountId) {
  return (data.discount_outlets || [])
    .filter((row) => row.discount_id === discountId)
    .map((row) => row.outlet_id)
    .filter((outletId) => outletMap.has(outletId));
}

function syncDiscountOutlets(discountId, outletIds = []) {
  const uniqueOutletIds = [...new Set(outletIds)].filter((outletId) => outletMap.has(outletId));
  data.discount_outlets = (data.discount_outlets || []).filter((row) => row.discount_id !== discountId);
  data.discount_outlets.push(...uniqueOutletIds.map((outletId) => ({ discount_id: discountId, outlet_id: outletId })));
}

function withDiscountOutlets(discount) {
  if (!discount) return null;
  const outletIds = getDiscountOutletIds(discount.id);
  return {
    ...discount,
    outlet_ids: outletIds,
    outlets: outletIds.map((outletId) => outletMap.get(outletId)).filter(Boolean)
  };
}

function getDiscountRows(keyword = "", { activeForDate = null } = {}) {
  return data.discounts
    .filter((discount) => !activeForDate || isDiscountActiveForDate(discount, activeForDate))
    .map(withDiscountOutlets)
    .filter((discount) =>
      includesText(
        `${discount.name} ${discount.type} ${discount.value} ${discount.status} ${discount.outlets.map((outlet) => outlet.name).join(" ")}`,
        keyword
      )
    )
    .sort((a, b) => String(a.starts_at || "").localeCompare(String(b.starts_at || "")) || a.name.localeCompare(b.name));
}

function getPrintSettings() {
  return {
    printer_name: data.print_settings?.printer_name || "Printer Kasir Utama",
    printer_status: data.print_settings?.printer_status || "active",
    mode: "single_printer_mock",
    item_sort_mode: data.print_settings?.item_sort_mode || "category_sort_order",
    templates: data.print_templates.map((template) => ({ ...template }))
  };
}

function getCompositionRows() {
  return data.product_compositions.map((composition) => ({
    ...composition,
    product: productMap.get(composition.product_id),
    material: materialMap.get(composition.material_id)
  }));
}

function getMaterialRows(outletId = "all") {
  return data.raw_materials.map((material) => {
    const category = (data.raw_material_categories || []).find((item) => item.id === material.category_id) || null;
    const accountCode = category?.account_code || material.account_code || (material.type === "biaya" ? "6000" : "5002");
    const account = (data.financial_accounts || []).find((item) => item.code === accountCode) || null;
    const stocks = data.raw_material_stocks
      .filter((stock) => stock.material_id === material.id)
      .filter(outletFilter(outletId))
      .map((stock) => ({
        ...stock,
        outlet: outletMap.get(stock.outlet_id)
      }));

    return {
      ...material,
      category,
      type: material.type || category?.type || "hpp",
      account_code: accountCode,
      account,
      stocks,
      total_stock: stocks.reduce((total, stock) => total + Number(stock.quantity || 0), 0),
      outlet_count: stocks.length
    };
  }).filter((material) => outletId === "all" || material.stocks.length > 0);
}

function getUnitRows() {
  return units.map((unit) => {
    const materialCount = data.raw_materials.filter((material) => material.unit === unit.code).length;

    return {
      ...unit,
      material_count: materialCount
    };
  });
}

function getSupplierRows() {
  return data.suppliers.map((supplier) => {
    const purchases = data.purchases
      .filter((purchase) => purchase.supplier_id === supplier.id)
      .map((purchase) => ({
        ...purchase,
        outlet: outletMap.get(purchase.outlet_id),
        item_count: purchase.items.length
      }))
      .sort((a, b) => new Date(b.purchase_date) - new Date(a.purchase_date));

    return {
      ...supplier,
      purchases,
      purchase_count: purchases.length,
      purchase_total: purchases.reduce((total, purchase) => total + Number(purchase.total || 0), 0)
    };
  });
}

function getUserRows() {
  return data.users.map((user) => {
    const { cashier_pin: _cashierPin, pin_hash: _pinHash, ...safeUser } = user;
    return {
      ...safeUser,
      has_pin: user.role_id === "role_cashier" && Boolean(user.cashier_pin || user.pin_hash || "000000"),
      role: roleMap.get(user.role_id),
      outlets: user.outlet_ids.map((id) => outletMap.get(id)).filter(Boolean)
    };
  });
}

function getCustomerRows(outletId = "all", keyword = "") {
  return data.customers
    .filter(outletFilter(outletId))
    .filter((customer) => includesText(`${customer.name} ${customer.phone} ${customer.barcode}`, keyword))
    .map((customer) => ({ ...customer, outlet: outletMap.get(customer.outlet_id) }));
}

function getOutletRows() {
  return data.outlets.map((outlet) => {
    const stocks = data.raw_material_stocks.filter((stock) => stock.outlet_id === outlet.id);
    const purchases = data.purchases.filter((purchase) => purchase.outlet_id === outlet.id);

    return {
      ...outlet,
      user_count: data.users.filter((user) => user.outlet_ids.includes(outlet.id)).length,
      customer_count: data.customers.filter((customer) => customer.outlet_id === outlet.id).length,
      stock_item_count: stocks.length,
      low_stock_count: stocks.filter((stock) => {
        const material = materialMap.get(stock.material_id);
        return material && Number(stock.quantity || 0) <= Number(material.low_stock_threshold || 0);
      }).length,
      purchase_count: purchases.length,
      purchase_total: purchases.reduce((total, purchase) => total + Number(purchase.total || 0), 0)
    };
  });
}

function getTableRows(outletId = "all", keyword = "") {
  return data.tables
    .filter(outletFilter(outletId))
    .map((table) => {
      const transactions = data.transactions
        .filter((transaction) => transaction.table_id === table.id)
        .map((transaction) => ({
          ...transaction,
          outlet: outletMap.get(transaction.outlet_id),
          cashier: userMap.get(transaction.cashier_id),
          customer: transaction.customer_id ? customerMap.get(transaction.customer_id) : null
        }))
        .sort((a, b) => new Date(b.transaction_date) - new Date(a.transaction_date));

      return {
        ...table,
        outlet: outletMap.get(table.outlet_id),
        transactions,
        transaction_count: transactions.length,
        sales_total: transactions.reduce((total, transaction) => total + Number(transaction.total || 0), 0)
      };
    })
    .filter((table) => includesText(`${table.number} ${table.outlet?.name} ${table.status}`, keyword));
}

function getMobileCatalogSnapshot() {
  const activeOutlets = data.outlets.filter((outlet) => outlet.status === "active");
  const activeOutletIds = new Set(activeOutlets.map((outlet) => outlet.id));
  const activeCategories = data.categories
    .filter((category) => category.status === "active")
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.name).localeCompare(String(b.name), "id-ID"));
  const activeCategoryIds = new Set(activeCategories.map((category) => category.id));
  const activePriceRows = data.product_prices.filter(
    (price) => price.status === "active" && activeOutletIds.has(price.outlet_id) && Number(price.price || 0) > 0
  );
  const productIdsWithActivePrice = new Set(activePriceRows.map((price) => price.product_id));
  const activeProducts = data.products.filter(
    (product) =>
      product.status === "active" &&
      activeCategoryIds.has(product.category_id) &&
      productIdsWithActivePrice.has(product.id)
  );
  const activeProductIds = new Set(activeProducts.map((product) => product.id));

  return {
    schema_version: "admin-mobile-catalog-v1",
    generated_at: new Date().toISOString(),
    source: "pos-admin-barokah-runtime-mock",
    outlets: activeOutlets.map((outlet) => ({
      id: outlet.id,
      name: outlet.name,
      code: outlet.code,
      address: outlet.address,
      phone: outlet.phone,
      status: outlet.status
    })),
    cashiers: data.users
      .filter((user) => user.status === "active" && user.role_id === "role_cashier")
      .map((user) => ({
        id: user.id,
        name: user.name,
        username: user.username,
        password: "",
        has_pin: Boolean(user.cashier_pin || "000000"),
        outlet_ids: user.outlet_ids.filter((outletId) => activeOutletIds.has(outletId)),
        status: user.status
      }))
      .filter((user) => user.outlet_ids.length),
    categories: activeCategories.map((category) => ({
      id: category.id,
      name: category.name,
      sort_order: category.sort_order,
      status: category.status
    })),
    products: activeProducts.map((product) => ({
      id: product.id,
      category_id: product.category_id,
      sku: product.sku,
      name: product.name,
      status: product.status
    })),
    product_prices: activePriceRows
      .filter((price) => activeProductIds.has(price.product_id))
      .map((price) => ({
        id: price.id,
        product_id: price.product_id,
        outlet_id: price.outlet_id,
        price: Number(price.price || 0),
        status: price.status
      })),
    customers: data.customers
      .filter((customer) => customer.status === "active" && activeOutletIds.has(customer.outlet_id))
      .map((customer) => ({
        id: customer.id,
        outlet_id: customer.outlet_id,
        name: customer.name,
        phone: customer.phone,
        barcode: customer.barcode,
        status: customer.status
      })),
    tables: data.tables
      .filter((table) => table.status === "active" && activeOutletIds.has(table.outlet_id))
      .map((table) => ({
        id: table.id,
        outlet_id: table.outlet_id,
        number: table.number,
        status: table.status
      })),
    expense_categories: data.expense_categories
      .filter((category) => category.status === "active")
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
      .map((category) => ({
        id: category.id,
        name: category.name,
        sort_order: Number(category.sort_order || 0),
        status: category.status
      })),
    payment_methods: data.payment_methods
      .filter((method) => method.status === "active")
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
      .map((method) => ({
        id: method.id,
        name: method.name,
        code: method.code,
        account_code: method.account_code,
        sort_order: Number(method.sort_order || 0),
        status: method.status
      })),
    discounts: getDiscountRows("", { activeForDate: new Date() }).map((discount) => ({
      id: discount.id,
      name: discount.name,
      type: discount.type,
      value: Number(discount.value || 0),
      starts_at: dateOnly(discount.starts_at),
      ends_at: dateOnly(discount.ends_at),
      outlet_ids: (discount.outlet_ids || []).filter((outletId) => activeOutletIds.has(outletId)),
      status: discount.status
    })).filter((discount) => discount.outlet_ids.length),
    print_templates: data.print_templates.map((template) => ({
      key: template.key,
      label: template.label,
      enabled: template.enabled !== false,
      footer_text: template.footer_text || ""
    })),
    print_settings: {
      printer_name: data.print_settings?.printer_name || "Printer Kasir Utama",
      printer_status: data.print_settings?.printer_status || "active",
      mode: "single_printer_mock",
      item_sort_mode: data.print_settings?.item_sort_mode || "category_sort_order"
    }
  };
}

function getStockRows(outletId = "all") {
  return data.raw_material_stocks.filter(outletFilter(outletId)).map((stock) => {
    const material = materialMap.get(stock.material_id);
    return {
      ...stock,
      outlet: outletMap.get(stock.outlet_id),
      material,
      status:
        stock.quantity <= 0
          ? "out_of_stock"
          : stock.quantity <= material.low_stock_threshold
            ? "low_stock"
            : "normal"
    };
  });
}

function getPurchaseRows(outletId = "all") {
  return data.purchases.filter(outletFilter(outletId)).map((purchase) => {
    const items = (purchase.items || []).map((item) => {
      const material = materialMap.get(item.material_id);
      return {
        ...item,
        material,
        material_name: item.material_name || material?.name || item.material_id,
        material_type: item.material_type || material?.type || "hpp"
      };
    });
    const hppTotal = purchase.hpp_total ?? items
      .filter((item) => item.material_type !== "biaya")
      .reduce((total, item) => total + Number(item.subtotal || 0), 0);
    const biayaTotal = purchase.biaya_total ?? items
      .filter((item) => item.material_type === "biaya")
      .reduce((total, item) => total + Number(item.subtotal || 0), 0);
    const grandTotal = purchase.grand_total ?? purchase.total ?? hppTotal + biayaTotal;

    return {
      ...purchase,
      items,
      outlet: outletMap.get(purchase.outlet_id),
      supplier: supplierMap.get(purchase.supplier_id),
      item_count: items.length,
      hpp_total: hppTotal,
      biaya_total: biayaTotal,
      grand_total: grandTotal,
      total: purchase.total ?? grandTotal
    };
  });
}

function getTransferRows(outletId = "all") {
  return data.stock_transfers
    .filter((transfer) => outletId === "all" || transfer.from_outlet_id === outletId || transfer.to_outlet_id === outletId)
    .map((transfer) => ({
      ...transfer,
      from_outlet: outletMap.get(transfer.from_outlet_id),
      to_outlet: outletMap.get(transfer.to_outlet_id),
      requested_user: userMap.get(transfer.requested_by),
      approved_user: transfer.approved_by ? userMap.get(transfer.approved_by) : null,
      item_count: transfer.items.length
    }));
}

function getOpnameRows(outletId = "all") {
  return data.stock_opnames
    .filter(outletFilter(outletId))
    .map((opname) => ({
      ...opname,
      outlet: outletMap.get(opname.outlet_id),
      material: materialMap.get(opname.material_id),
      user: userMap.get(opname.created_by)
    }))
    .sort((a, b) => {
      const dateCompare = String(b.opname_date).localeCompare(String(a.opname_date));
      if (dateCompare !== 0) return dateCompare;
      return String(b.id).localeCompare(String(a.id), "id-ID", { numeric: true });
    });
}

function getStockRow(outletId, materialId) {
  return data.raw_material_stocks.find((stock) => stock.outlet_id === outletId && stock.material_id === materialId);
}

function ensureStockRow(outletId, materialId) {
  const existing = getStockRow(outletId, materialId);
  if (existing) return existing;

  const material = materialMap.get(materialId);
  const stock = {
    id: createSequentialId("stock", data.raw_material_stocks),
    outlet_id: outletId,
    material_id: materialId,
    quantity: 0,
    unit: material?.unit || ""
  };
  data.raw_material_stocks.push(stock);
  return stock;
}

function addMaterialQuantity(totals, materialId, quantity) {
  totals.set(materialId, roundQuantity((totals.get(materialId) || 0) + Number(quantity || 0)));
}

function getDailyPurchaseTotals(outletId, date) {
  const totals = new Map();
  data.purchases
    .filter((purchase) => purchase.outlet_id === outletId && purchase.status === "approved" && isSameDate(purchase.purchase_date, date))
    .forEach((purchase) => {
      purchase.items.forEach((item) => addMaterialQuantity(totals, item.material_id, item.quantity));
    });
  return totals;
}

function getDailyTransferTotals(outletId, date) {
  const totals = new Map();
  data.stock_transfers
    .filter((transfer) => transfer.status === "approved" && isSameDate(transfer.transfer_date, date))
    .forEach((transfer) => {
      transfer.items.forEach((item) => {
        if (transfer.to_outlet_id === outletId) addMaterialQuantity(totals, item.material_id, item.quantity);
        if (transfer.from_outlet_id === outletId) addMaterialQuantity(totals, item.material_id, -Number(item.quantity || 0));
      });
    });
  return totals;
}

function getDailySalesMaterialTotals(outletId, date, { deductedOnly = false } = {}) {
  const totals = new Map();
  const transactionIds = new Set(
    data.transactions
      .filter((transaction) => transaction.outlet_id === outletId && transaction.status === "paid" && isSameDate(transaction.transaction_date, date))
      .filter((transaction) => !deductedOnly || transaction.stock_deducted === true)
      .map((transaction) => transaction.id)
  );

  data.transaction_items
    .filter((item) => transactionIds.has(item.transaction_id))
    .forEach((item) => {
      data.product_compositions
        .filter((composition) => composition.product_id === item.product_id)
        .forEach((composition) => {
          addMaterialQuantity(totals, composition.material_id, Number(composition.quantity || 0) * Number(item.quantity || 0));
        });
    });

  return totals;
}

function getLatestMaterialPrice(materialId, outletId, date) {
  const matchingItems = data.purchases
    .filter((purchase) => purchase.outlet_id === outletId && purchase.status === "approved" && (!date || purchase.purchase_date <= date))
    .flatMap((purchase) =>
      purchase.items
        .filter((item) => item.material_id === materialId)
        .map((item) => ({
          purchase_date: purchase.purchase_date,
          unit_price: Number(item.unit_price || 0)
        }))
    )
    .sort((a, b) => b.purchase_date.localeCompare(a.purchase_date));

  if (matchingItems[0]) return matchingItems[0].unit_price;

  const fallback = data.purchases
    .filter((purchase) => purchase.outlet_id === outletId && purchase.status === "approved")
    .flatMap((purchase) => purchase.items.filter((item) => item.material_id === materialId))
    .at(-1);
  return Number(fallback?.unit_price || 0);
}

function getMaterialPriceComparisons({ outletId = "all", from, to } = {}) {
  const activeMaterials = new Set(data.raw_materials.filter((material) => material.status !== "inactive").map((material) => material.id));
  const purchaseItems = data.purchases
    .map((purchase, purchaseIndex) => ({ purchase, purchaseIndex }))
    .filter(({ purchase }) => purchase.status === "approved")
    .flatMap(({ purchase, purchaseIndex }) =>
      (purchase.items || [])
        .filter((item) => activeMaterials.has(item.material_id))
        .map((item, itemIndex) => ({
          id: `${purchase.id}_${item.material_id}_${itemIndex}`,
          material_id: item.material_id,
          outlet_id: purchase.outlet_id,
          supplier_id: purchase.supplier_id,
          purchase_id: purchase.id,
          purchase_date: purchase.purchase_date,
          purchase_index: purchaseIndex,
          item_index: itemIndex,
          unit_price: Number(item.unit_price || 0)
        }))
    );

  const grouped = new Map();
  purchaseItems.forEach((item) => {
    const key = `${item.outlet_id}_${item.material_id}`;
    const rows = grouped.get(key) || [];
    rows.push(item);
    grouped.set(key, rows);
  });

  const latestRows = Array.from(grouped.entries())
    .map(([key, rows]) => {
      const sortedRows = rows.sort((a, b) => {
        const dateCompare = String(b.purchase_date || "").localeCompare(String(a.purchase_date || ""));
        if (dateCompare !== 0) return dateCompare;
        if (b.purchase_index !== a.purchase_index) return b.purchase_index - a.purchase_index;
        return b.item_index - a.item_index;
      });
      const latestIndex = sortedRows.findIndex((row) => withinDateRange(row.purchase_date, from, to));
      if (latestIndex < 0) return null;
      const latest = sortedRows[latestIndex];
      const material = materialMap.get(latest.material_id);
      const outlet = outletMap.get(latest.outlet_id);
      const supplier = supplierMap.get(latest.supplier_id);

      return {
        id: key,
        material_id: latest.material_id,
        material,
        material_name: material?.name || "-",
        outlet_id: latest.outlet_id,
        outlet,
        outlet_name: outlet?.name || "-",
        supplier_id: latest.supplier_id || null,
        supplier,
        supplier_name: supplier?.name || "-",
        latest_purchase_id: latest.purchase_id,
        latest_purchase_date: latest.purchase_date,
        latest_price: latest.unit_price
      };
    })
    .filter(Boolean);

  const rowsByMaterial = new Map();
  latestRows.forEach((row) => {
    const rows = rowsByMaterial.get(row.material_id) || [];
    rows.push(row);
    rowsByMaterial.set(row.material_id, rows);
  });

  return latestRows
    .filter((row) => outletFilter(outletId)(row))
    .map((row) => {
      const peers = rowsByMaterial.get(row.material_id) || [row];
      const validPrices = peers.map((peer) => Number(peer.latest_price || 0)).filter((price) => Number.isFinite(price) && price >= 0);
      const benchmarkPrice = validPrices.length ? Math.min(...validPrices) : Number(row.latest_price || 0);
      const benchmarkRows = peers.filter((peer) => Math.abs(Number(peer.latest_price || 0) - benchmarkPrice) < 0.0001);
      const benchmarkOutlet = benchmarkRows[0]?.outlet || null;
      const difference = Number(row.latest_price || 0) - benchmarkPrice;
      const changePercent = benchmarkPrice ? (difference / benchmarkPrice) * 100 : 0;
      const status =
        difference > 0
          ? "lebih_mahal"
          : benchmarkRows.length > 1 && peers.length > 1
            ? "sama"
            : "termurah";

      return {
        ...row,
        benchmark_outlet_id: benchmarkOutlet?.id || null,
        benchmark_outlet: benchmarkOutlet,
        benchmark_outlet_name: benchmarkOutlet?.name || "-",
        benchmark_price: benchmarkPrice,
        previous_purchase_date: null,
        previous_price: benchmarkPrice,
        difference,
        change_percent: changePercent,
        status,
        trend: status
      };
    })
    .sort((a, b) => {
      const diffCompare = Number(b.difference || 0) - Number(a.difference || 0);
      if (diffCompare !== 0) return diffCompare;
      const materialCompare = String(a.material_name || "").localeCompare(String(b.material_name || ""), "id-ID");
      if (materialCompare !== 0) return materialCompare;
      return String(b.latest_purchase_date || "").localeCompare(String(a.latest_purchase_date || ""));
    });
}

function parseQueryList(value) {
  if (Array.isArray(value)) return value.flatMap((item) => parseQueryList(item));
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getMaterialPurchaseComparisons({ from, to, outletIds = "", materialIds = "" } = {}) {
  const selectedOutletIds = new Set(parseQueryList(outletIds));
  const selectedMaterialIds = new Set(parseQueryList(materialIds));
  const outletOptions = getOutletRows().filter((outlet) => outlet.status !== "inactive");
  const materialOptions = data.raw_materials
    .filter((material) => material.status !== "inactive")
    .map((material) => {
      const category = (data.raw_material_categories || []).find((item) => item.id === material.category_id);
      return {
        id: material.id,
        name: material.name,
        type: material.type || category?.type || "hpp",
        unit: material.unit,
        category_id: material.category_id,
        category_name: category?.name || "-"
      };
    })
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "id-ID"));

  const allowedOutletIds = selectedOutletIds.size ? selectedOutletIds : new Set(outletOptions.map((outlet) => outlet.id));
  const allowedMaterialIds = selectedMaterialIds.size ? selectedMaterialIds : new Set(materialOptions.map((material) => material.id));
  const matrixOutlets = selectedOutletIds.size ? outletOptions.filter((outlet) => selectedOutletIds.has(outlet.id)) : outletOptions;

  const rows = getPurchaseRows("all")
    .filter((purchase) => purchase.status === "approved")
    .filter((purchase) => withinDateRange(purchase.purchase_date, from, to))
    .filter((purchase) => allowedOutletIds.has(purchase.outlet_id))
    .flatMap((purchase) =>
      (purchase.items || [])
        .filter((item) => allowedMaterialIds.has(item.material_id))
        .map((item, itemIndex) => {
          const material = item.material || materialMap.get(item.material_id);
          const category = item.category || (data.raw_material_categories || []).find((row) => row.id === material?.category_id);
          const outlet = purchase.outlet || outletMap.get(purchase.outlet_id);
          const supplier = purchase.supplier || supplierMap.get(purchase.supplier_id);
          const quantity = Number(item.quantity || 0);
          const unitPrice = Number(item.unit_price || 0);
          const subtotal = Number(item.subtotal ?? quantity * unitPrice);

          return {
            id: `${purchase.id}_${item.material_id}_${itemIndex}`,
            purchase_id: purchase.id,
            purchase_date: purchase.purchase_date,
            outlet_id: purchase.outlet_id,
            outlet,
            outlet_name: outlet?.name || "-",
            material_id: item.material_id,
            material,
            material_name: material?.name || "-",
            material_type: material?.type || category?.type || "hpp",
            category_id: category?.id || null,
            category_name: category?.name || "-",
            quantity,
            unit: item.unit || material?.unit || "",
            unit_price: unitPrice,
            subtotal,
            supplier_id: purchase.supplier_id || null,
            supplier,
            supplier_name: supplier?.name || "-"
          };
        })
    )
    .sort((a, b) => {
      const dateCompare = String(b.purchase_date || "").localeCompare(String(a.purchase_date || ""));
      if (dateCompare !== 0) return dateCompare;
      const outletCompare = String(a.outlet_name || "").localeCompare(String(b.outlet_name || ""), "id-ID");
      if (outletCompare !== 0) return outletCompare;
      return String(a.material_name || "").localeCompare(String(b.material_name || ""), "id-ID");
    });

  const byOutlet = Array.from(
    rows.reduce((result, row) => {
      const current = result.get(row.outlet_id) || {
        outlet_id: row.outlet_id,
        outlet_name: row.outlet_name,
        item_count: 0,
        total: 0
      };
      current.item_count += 1;
      current.total += Number(row.subtotal || 0);
      result.set(row.outlet_id, current);
      return result;
    }, new Map()).values()
  ).sort((a, b) => Number(b.total || 0) - Number(a.total || 0));

  const byMaterial = Array.from(
    rows.reduce((result, row) => {
      const current = result.get(row.material_id) || {
        material_id: row.material_id,
        material_name: row.material_name,
        type: row.material_type,
        unit: row.unit,
        item_count: 0,
        total_quantity: 0,
        total: 0
      };
      current.item_count += 1;
      current.total_quantity += Number(row.quantity || 0);
      current.total += Number(row.subtotal || 0);
      current.average_unit_price = current.total_quantity ? current.total / current.total_quantity : 0;
      result.set(row.material_id, current);
      return result;
    }, new Map()).values()
  ).sort((a, b) => Number(b.total || 0) - Number(a.total || 0));

  const matrixRows = materialOptions
    .filter((material) => rows.some((row) => row.material_id === material.id) || selectedMaterialIds.has(material.id))
    .map((material) => {
      const cells = matrixOutlets.map((outlet) => {
        const details = rows
          .filter((row) => row.material_id === material.id && row.outlet_id === outlet.id)
          .sort((a, b) => String(b.purchase_date || "").localeCompare(String(a.purchase_date || "")));
        const latest = details[0] || null;
        return {
          outlet_id: outlet.id,
          outlet_name: outlet.name,
          latest_price: Number(latest?.unit_price || 0),
          latest_purchase_date: latest?.purchase_date || null,
          quantity_total: details.reduce((total, row) => total + Number(row.quantity || 0), 0),
          total: details.reduce((total, row) => total + Number(row.subtotal || 0), 0),
          item_count: details.length,
          supplier_name: latest?.supplier_name || "-",
          details
        };
      });
      const cellsWithData = cells.filter((cell) => cell.item_count > 0);
      const benchmarkPrice = cellsWithData.length ? Math.min(...cellsWithData.map((cell) => Number(cell.latest_price || 0))) : 0;
      const benchmarkCount = cellsWithData.filter((cell) => Math.abs(Number(cell.latest_price || 0) - benchmarkPrice) < 0.0001).length;
      const outletCells = cells.map((cell) => {
        if (!cell.item_count) {
          return {
            ...cell,
            benchmark_price: benchmarkPrice,
            difference: 0,
            change_percent: 0,
            status: "belum_ada_data"
          };
        }
        const difference = Number(cell.latest_price || 0) - benchmarkPrice;
        return {
          ...cell,
          benchmark_price: benchmarkPrice,
          difference,
          change_percent: benchmarkPrice ? (difference / benchmarkPrice) * 100 : 0,
          status: difference > 0 ? "lebih_mahal" : benchmarkCount > 1 && cellsWithData.length > 1 ? "sama" : "termurah"
        };
      });
      const maxDifference = cellsWithData.length > 1 ? Math.max(...outletCells.map((cell) => Number(cell.difference || 0))) : 0;

      return {
        id: material.id,
        material_id: material.id,
        material_name: material.name,
        material_type: material.type || "hpp",
        category_name: material.category_name || "-",
        unit: material.unit || "",
        max_difference: maxDifference,
        outlet_cells: outletCells
      };
    })
    .sort((a, b) => {
      const differenceCompare = Number(b.max_difference || 0) - Number(a.max_difference || 0);
      if (differenceCompare !== 0) return differenceCompare;
      return String(a.material_name || "").localeCompare(String(b.material_name || ""), "id-ID");
    });

  return {
    outlets: outletOptions,
    matrix_outlets: matrixOutlets,
    materials: materialOptions,
    rows,
    matrix_rows: matrixRows,
    summary: {
      total_items: rows.length,
      total_amount: rows.reduce((total, row) => total + Number(row.subtotal || 0), 0),
      by_outlet: byOutlet,
      by_material: byMaterial
    }
  };
}

function getStockOpnameWorksheetRows({ outletId, date }) {
  const outlet = outletMap.get(outletId);
  if (!outlet || !date) return [];

  const purchaseTotals = getDailyPurchaseTotals(outletId, date);
  const transferTotals = getDailyTransferTotals(outletId, date);
  const salesTotals = getDailySalesMaterialTotals(outletId, date);
  const deductedSalesTotals = getDailySalesMaterialTotals(outletId, date, { deductedOnly: true });
  const stockByMaterialId = new Map(
    data.raw_material_stocks
      .filter((stock) => stock.outlet_id === outletId)
      .map((stock) => [stock.material_id, stock])
  );

  return data.raw_materials
    .filter((material) => material.status === "active")
    .filter((material) => stockByMaterialId.has(material.id))
    .map((material, index) => {
      const stock = stockByMaterialId.get(material.id);
      const incomingQuantity = roundQuantity(purchaseTotals.get(material.id) || 0);
      const transferQuantity = roundQuantity(transferTotals.get(material.id) || 0);
      const salesQuantity = roundQuantity(salesTotals.get(material.id) || 0);
      const deductedSalesQuantity = roundQuantity(deductedSalesTotals.get(material.id) || 0);
      const damageQuantity = 0;
      const currentStockQuantity = roundQuantity(stock?.quantity || 0);
      const openingQuantity = roundQuantity(currentStockQuantity - incomingQuantity - transferQuantity + deductedSalesQuantity);
      const realSystemQuantity = roundQuantity(openingQuantity + incomingQuantity + transferQuantity - damageQuantity - salesQuantity);
      const actualQuantity = Math.max(realSystemQuantity, 0);
      const difference = roundQuantity(realSystemQuantity - actualQuantity);
      const unitPrice = getLatestMaterialPrice(material.id, outletId, date);

      return {
        id: `worksheet_${outletId}_${material.id}`,
        no: index + 1,
        outlet_id: outletId,
        outlet,
        material_id: material.id,
        material,
        stock_id: stock?.id || null,
        name: material.name,
        unit: material.unit,
        unit_price: unitPrice,
        opening_quantity: openingQuantity,
        incoming_quantity: incomingQuantity,
        transfer_quantity: transferQuantity,
        damage_quantity: damageQuantity,
        computed_sales_quantity: salesQuantity,
        real_system_quantity: realSystemQuantity,
        actual_quantity: actualQuantity,
        difference,
        loss_amount: Math.max(difference, 0) * unitPrice,
        status: getOpnameStatus(difference),
        note: getOpnameNote(difference)
      };
    });
}

function createOpnameBatchId() {
  const maxNumber = data.stock_opnames.reduce((max, item) => {
    const match = String(item.batch_id || "").match(/^opname_batch_(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return `opname_batch_${String(maxNumber + 1).padStart(3, "0")}`;
}

function getTransactionRows({ outletId = "all", from = "2026-04-01", to = "2026-04-30" } = {}) {
  return data.transactions
    .filter(outletFilter(outletId))
    .filter((transaction) => withinDateRange(transaction.transaction_date, from, to))
    .map(enrichTransaction)
    .sort((a, b) => new Date(b.transaction_date) - new Date(a.transaction_date));
}

function getTopProducts(transactions) {
  const totals = new Map();
  for (const transaction of transactions) {
    for (const item of transaction.items) {
      const current = totals.get(item.product_id) || { product: item.product, quantity: 0, total: 0 };
      current.quantity += item.quantity;
      current.total += item.subtotal;
      totals.set(item.product_id, current);
    }
  }
  return [...totals.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 6);
}

function getDailySales(transactions) {
  const totals = new Map();
  for (const transaction of transactions) {
    const date = getLocalDateKey(transaction.transaction_date);
    if (!date) continue;
    totals.set(date, (totals.get(date) || 0) + transaction.total);
  }
  return [...totals.entries()]
    .map(([date, total]) => ({ date, total }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function getSalesByOutlet(transactions, outletId = "all") {
  const totals = new Map();
  const baseOutlets = data.outlets.filter((outlet) => !outletId || outletId === "all" || outlet.id === outletId);

  baseOutlets.forEach((outlet) => {
    totals.set(outlet.id, {
      outlet,
      total: 0,
      transactions: 0,
      average_transaction: 0
    });
  });

  for (const transaction of transactions) {
    const current = totals.get(transaction.outlet_id) || {
      outlet: outletMap.get(transaction.outlet_id),
      total: 0,
      transactions: 0,
      average_transaction: 0
    };
    current.total += transaction.total;
    current.transactions += 1;
    current.average_transaction = Math.round(current.total / current.transactions);
    totals.set(transaction.outlet_id, current);
  }
  return [...totals.values()].sort((a, b) => String(a.outlet?.name || "").localeCompare(String(b.outlet?.name || ""), "id-ID"));
}

function getSalesByCustomer(transactions) {
  const totals = new Map();
  for (const transaction of transactions) {
    const customerId = transaction.customer?.id || transaction.customer_id || "umum";
    const customerName = transaction.customer?.name || transaction.customer_name || "Umum";
    const current = totals.get(customerId) || {
      id: customerId,
      customer: transaction.customer || null,
      customer_name: customerName,
      total: 0,
      transactions: 0
    };
    current.total += Number(transaction.total || 0);
    current.transactions += 1;
    current.average_transaction = Math.round(current.total / current.transactions);
    totals.set(customerId, current);
  }
  return [...totals.values()].sort((a, b) => b.total - a.total);
}

function getSalesByHour(transactions) {
  const rows = Array.from({ length: 24 }, (_, hour) => ({
    id: `${String(hour).padStart(2, "0")}:00`,
    hour: `${String(hour).padStart(2, "0")}:00`,
    total: 0,
    transactions: 0,
    average_transaction: 0
  }));

  for (const transaction of transactions) {
    const hour = getLocalHour(transaction.transaction_date);
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) continue;
    rows[hour].total += Number(transaction.total || 0);
    rows[hour].transactions += 1;
    rows[hour].average_transaction = Math.round(rows[hour].total / rows[hour].transactions);
  }

  return rows;
}

function getSalesByServiceType(transactions) {
  const labels = {
    dine_in: "Dine In",
    takeaway: "Takeaway"
  };
  const totals = new Map([
    ["dine_in", { id: "dine_in", service_type: "dine_in", label: labels.dine_in, total: 0, transactions: 0, average_transaction: 0 }],
    ["takeaway", { id: "takeaway", service_type: "takeaway", label: labels.takeaway, total: 0, transactions: 0, average_transaction: 0 }]
  ]);

  for (const transaction of transactions) {
    const serviceType = transaction.service_type === "dine_in" ? "dine_in" : "takeaway";
    const current = totals.get(serviceType);
    current.total += Number(transaction.total || 0);
    current.transactions += 1;
    current.average_transaction = Math.round(current.total / current.transactions);
  }

  return [...totals.values()];
}

function addTransactionPaymentBreakdown(result, transaction) {
  const payments = getTransactionPayments(transaction);
  if (!payments.length) {
    const method = transaction.payment?.method || transaction.payment_method || "unknown";
    result[method] = (result[method] || 0) + Number(transaction.total || 0);
    return result;
  }

  for (const payment of payments) {
    const method = payment.method || "unknown";
    result[method] = (result[method] || 0) + Number(payment.amount || 0);
  }
  return result;
}

function getSalesComparisonDateRange(from, to) {
  const safeFrom = from || "2026-05-01";
  const safeTo = to || safeFrom;
  const cursor = new Date(`${safeFrom}T00:00:00`);
  const end = new Date(`${safeTo}T00:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime()) || cursor > end) return [];

  const dates = [];
  while (cursor <= end) {
    dates.push(dateOnly(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function buildSalesOutletComparison({ transactions = [], outlets = [], outletOptions = [], from, to } = {}) {
  const dates = getSalesComparisonDateRange(from, to);
  const paymentMethodMap = new Map(getPaymentMethodRows().map((method) => [method.code, method]));
  const rows = transactions
    .filter((transaction) => transaction.status === "paid")
    .map((transaction) => {
      const payments = getTransactionPayments(transaction);
      const payment = payments[0] || transaction.payment || null;
      const paymentMethod = payment?.method || transaction.payment_method || "unknown";
      const paymentLabel = payments.length
        ? payments.map((item) => paymentMethodMap.get(item.method)?.name || String(item.method || "-").toUpperCase()).join(" + ")
        : paymentMethodMap.get(paymentMethod)?.name || String(paymentMethod || "-").toUpperCase();
      const paidAmount = getTransactionPaidAmount({ ...transaction, payment, payments });
      const changeAmount = getTransactionChangeAmount({ ...transaction, payment, payments });

      return {
        id: transaction.id,
        order_number: transaction.order_number,
        transaction_date: transaction.transaction_date,
        date: getLocalDateKey(transaction.transaction_date),
        outlet_id: transaction.outlet_id,
        outlet: transaction.outlet || outletMap.get(transaction.outlet_id) || null,
        outlet_name: transaction.outlet?.name || outletMap.get(transaction.outlet_id)?.name || "-",
        customer_id: transaction.customer_id || null,
        customer: transaction.customer || null,
        customer_name: transaction.customer?.name || transaction.customer_name || "Umum",
        payment_method: paymentMethod,
        payment_label: paymentLabel,
        payment: payment || {
          method: paymentMethod,
          amount: paidAmount,
          change_amount: changeAmount
        },
        payments,
        subtotal: Number(transaction.subtotal || 0),
        discount: Number(transaction.discount || 0),
        total: Number(transaction.total || 0),
        paid_amount: paidAmount,
        change_amount: changeAmount,
        status: transaction.status
      };
    })
    .filter((row) => dates.includes(row.date));

  const groupedRows = rows.reduce((result, row) => {
    const key = `${row.outlet_id}:${row.date}`;
    const current = result.get(key) || [];
    current.push(row);
    result.set(key, current);
    return result;
  }, new Map());

  const matrixRows = outlets.map((outlet) => {
    const dateCells = dates.map((date) => {
      const details = groupedRows.get(`${outlet.id}:${date}`) || [];
      const total = details.reduce((sum, row) => sum + Number(row.total || 0), 0);
      const discountTotal = details.reduce((sum, row) => sum + Number(row.discount || 0), 0);
      return {
        id: `${outlet.id}_${date}`,
        date,
        outlet_id: outlet.id,
        outlet_name: outlet.name,
        total,
        transaction_count: details.length,
        average_transaction: details.length ? Math.round(total / details.length) : 0,
        discount_total: discountTotal,
        rows: details.sort((a, b) => String(a.transaction_date || "").localeCompare(String(b.transaction_date || "")))
      };
    });
    const periodTotal = dateCells.reduce((sum, cell) => sum + Number(cell.total || 0), 0);
    const transactionCount = dateCells.reduce((sum, cell) => sum + Number(cell.transaction_count || 0), 0);

    return {
      id: outlet.id,
      outlet_id: outlet.id,
      outlet_name: outlet.name,
      outlet,
      date_cells: dateCells,
      period_total: periodTotal,
      transaction_count: transactionCount,
      average_transaction: transactionCount ? Math.round(periodTotal / transactionCount) : 0,
      discount_total: dateCells.reduce((sum, cell) => sum + Number(cell.discount_total || 0), 0)
    };
  });

  const totalsByDate = dates.map((date) => {
    const details = rows.filter((row) => row.date === date);
    const total = details.reduce((sum, row) => sum + Number(row.total || 0), 0);
    const discountTotal = details.reduce((sum, row) => sum + Number(row.discount || 0), 0);
    return {
      date,
      total,
      transaction_count: details.length,
      average_transaction: details.length ? Math.round(total / details.length) : 0,
      discount_total: discountTotal
    };
  });

  return {
    outlet_options: outletOptions,
    outlets,
    dates,
    matrix_rows: matrixRows,
    rows: rows.sort((a, b) => String(b.transaction_date || "").localeCompare(String(a.transaction_date || ""))),
    totals_by_date: totalsByDate,
    summary: {
      total: rows.reduce((sum, row) => sum + Number(row.total || 0), 0),
      transaction_count: rows.length,
      discount_total: rows.reduce((sum, row) => sum + Number(row.discount || 0), 0)
    }
  };
}

function getGrossProfitEstimate(transactions) {
  const revenue = transactions.reduce((total, item) => total + item.total, 0);
  return Math.round(revenue * 0.42);
}

function normalizeCashierPin(payload, { required = false } = {}) {
  const pin = String(payload.cashier_pin ?? payload.cashierPin ?? payload.pin ?? "").trim();
  if (!pin) {
    if (required) throw new Error("PIN kasir wajib diisi 6 digit.");
    return null;
  }
  if (!/^\d{6}$/.test(pin)) {
    throw new Error("PIN kasir wajib 6 digit angka.");
  }
  return pin;
}

function normalizeUserPayload(payload, { isCreate = false, requirePin = false } = {}) {
  const name = String(payload.name || "").trim();
  const username = String(payload.username || "").trim().toLowerCase();
  const email = String(payload.email || "").trim().toLowerCase();
  const roleId = payload.role_id;
  const outletIds = Array.isArray(payload.outlet_ids) ? payload.outlet_ids.filter((id) => outletMap.has(id)) : [];

  if (!name || !username || !email || !roleMap.has(roleId) || !outletIds.length) {
    throw new Error("Nama, username, email, role, dan minimal 1 outlet wajib diisi.");
  }

  const cashierPin = roleId === "role_cashier" ? normalizeCashierPin(payload, { required: isCreate || requirePin }) : null;
  const normalized = {
    name,
    username,
    email,
    role_id: roleId,
    outlet_ids: [...new Set(outletIds)],
    status: payload.status || "active"
  };

  if (roleId === "role_cashier" && cashierPin) {
    normalized.cashier_pin = cashierPin;
  }

  return normalized;
}

function assertUniqueUser({ email, userId, username }) {
  if (data.users.some((user) => user.id !== userId && user.username.toLowerCase() === username.toLowerCase())) {
    throw new Error("Username sudah digunakan.");
  }

  if (data.users.some((user) => user.id !== userId && user.email.toLowerCase() === email.toLowerCase())) {
    throw new Error("Email sudah digunakan.");
  }
}

function normalizeProfilePayload(payload) {
  const name = String(payload.name || "").trim();
  const username = String(payload.username || "").trim().toLowerCase();
  const email = String(payload.email || "").trim().toLowerCase();

  if (!name || !username || !email) {
    throw new Error("Nama, username, dan email wajib diisi.");
  }

  if (!email.includes("@")) {
    throw new Error("Format email tidak valid.");
  }

  return { name, username, email };
}

function createTemporaryPassword() {
  return `BRK-${Math.floor(100000 + Math.random() * 900000)}`;
}

function createCustomerBarcode(outletId) {
  const outlet = outletMap.get(outletId);
  const outletCode = outlet?.code || "BRK";
  const prefix = `CUST-${outletCode}-`;
  const maxNumber = data.customers
    .filter((customer) => customer.outlet_id === outletId && customer.barcode?.startsWith(prefix))
    .reduce((max, customer) => {
      const number = Number(customer.barcode.replace(prefix, ""));
      return Number.isNaN(number) ? max : Math.max(max, number);
    }, 0);

  return `${prefix}${String(maxNumber + 1).padStart(4, "0")}`;
}

function normalizeCustomerPayload(payload, customerId) {
  const name = String(payload.name || "").trim();
  const phone = String(payload.phone || "").trim();
  const outletId = payload.outlet_id;
  const status = payload.status || "active";
  const barcode = String(payload.barcode || "").trim().toUpperCase();

  if (!name || !phone || !outletMap.has(outletId)) {
    throw new Error("Nama customer, nomor HP, dan outlet wajib diisi.");
  }

  if (data.customers.some((customer) => customer.id !== customerId && customer.phone === phone && customer.outlet_id === outletId)) {
    throw new Error("Nomor HP sudah terdaftar di outlet ini.");
  }

  if (barcode && data.customers.some((customer) => customer.id !== customerId && customer.barcode.toLowerCase() === barcode.toLowerCase())) {
    throw new Error("Barcode sudah digunakan customer lain.");
  }

  return {
    name,
    phone,
    outlet_id: outletId,
    status,
    barcode
  };
}

function normalizeOutletPayload(payload, outletId) {
  const name = String(payload.name || "").trim();
  const code = String(payload.code || "").trim().toUpperCase();
  const address = String(payload.address || "").trim();
  const phone = String(payload.phone || "").trim();
  const openedAt = String(payload.opened_at || "").trim();
  const status = payload.status || "active";

  if (!name || !code || !address || !phone || !openedAt) {
    throw new Error("Nama, kode, alamat, telepon, dan tanggal buka outlet wajib diisi.");
  }

  if (data.outlets.some((outlet) => outlet.id !== outletId && outlet.code.toLowerCase() === code.toLowerCase())) {
    throw new Error("Kode outlet sudah digunakan.");
  }

  return {
    name,
    code,
    address,
    phone,
    opened_at: openedAt,
    status
  };
}

function normalizeTablePayload(payload, tableId) {
  const outletId = payload.outlet_id;
  const number = String(payload.number || "").trim().toUpperCase();
  const status = payload.status || "active";

  if (!outletMap.has(outletId) || !number) {
    throw new Error("Outlet dan nomor meja wajib diisi.");
  }

  if (!["active", "inactive"].includes(status)) {
    throw new Error("Status meja tidak valid.");
  }

  if (
    data.tables.some(
      (table) =>
        table.id !== tableId &&
        table.outlet_id === outletId &&
        table.number.toLowerCase() === number.toLowerCase()
    )
  ) {
    throw new Error("Nomor meja sudah digunakan di outlet ini.");
  }

  return {
    outlet_id: outletId,
    number,
    status
  };
}

function normalizeCategoryPayload(payload, categoryId, fallbackSortOrder) {
  const name = String(payload.name || "").trim();
  const sortOrder = Number(payload.sort_order || fallbackSortOrder);
  const status = payload.status || "active";

  if (!name || !Number.isFinite(sortOrder) || sortOrder <= 0) {
    throw new Error("Nama kategori dan urutan wajib valid.");
  }

  if (data.categories.some((category) => category.id !== categoryId && category.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("Nama kategori sudah digunakan.");
  }

  return {
    name,
    sort_order: sortOrder,
    status
  };
}

function normalizeExpenseCategoryPayload(payload, categoryId, fallbackSortOrder) {
  const name = String(payload.name || "").trim();
  const sortOrder = Number(payload.sort_order || fallbackSortOrder);
  const status = payload.status || "active";

  if (!name || !Number.isFinite(sortOrder) || sortOrder <= 0) {
    throw new Error("Nama pengeluaran operasional dan urutan wajib valid.");
  }

  if (!["active", "inactive"].includes(status)) {
    throw new Error("Status nama pengeluaran operasional tidak valid.");
  }

  if (
    data.expense_categories.some(
      (category) => category.id !== categoryId && category.name.toLowerCase() === name.toLowerCase()
    )
  ) {
    throw new Error("Nama pengeluaran operasional sudah digunakan.");
  }

  return {
    name,
    sort_order: sortOrder,
    status
  };
}

function normalizePaymentMethodCode(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizePaymentMethodPayload(payload, methodId, fallbackSortOrder) {
  const name = String(payload.name || "").trim();
  const code = normalizePaymentMethodCode(payload.code || name);
  const accountCode = String(payload.account_code || payload.accountCode || "").trim();
  const sortOrder = Number(payload.sort_order || payload.sortOrder || fallbackSortOrder);
  const status = payload.status || "active";

  if (!name || !code || !Number.isFinite(sortOrder) || sortOrder <= 0) {
    throw new Error("Nama, kode, dan urutan metode pembayaran wajib valid.");
  }

  if (!["active", "inactive"].includes(status)) {
    throw new Error("Status metode pembayaran tidak valid.");
  }

  if (data.payment_methods.some((method) => method.id !== methodId && method.code.toLowerCase() === code.toLowerCase())) {
    throw new Error("Kode metode pembayaran sudah digunakan.");
  }

  if (data.payment_methods.some((method) => method.id !== methodId && method.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("Nama metode pembayaran sudah digunakan.");
  }

  return {
    name,
    code,
    account_code: accountCode,
    sort_order: sortOrder,
    status
  };
}

function normalizeDiscountPayload(payload, discountId) {
  const name = String(payload.name || "").trim();
  const type = String(payload.type || "").trim();
  const value = Number(payload.value);
  const startsAt = String(payload.starts_at || payload.startsAt || "").slice(0, 10);
  const endsAt = String(payload.ends_at || payload.endsAt || "").slice(0, 10);
  const status = payload.status || "active";
  const outletIds = [...new Set(payload.outlet_ids || payload.outletIds || [])].map(String).filter(Boolean);

  if (!name || !["nominal", "percent"].includes(type) || !Number.isFinite(value)) {
    throw new Error("Nama, tipe, dan nilai discount wajib valid.");
  }

  if (!outletIds.length || outletIds.some((outletId) => !outletMap.has(outletId))) {
    throw new Error("Minimal 1 outlet discount wajib dipilih.");
  }

  if (type === "percent" && (value < 1 || value > 100)) {
    throw new Error("Nilai discount persen wajib 1 sampai 100.");
  }

  if (type === "nominal" && value <= 0) {
    throw new Error("Nilai discount nominal wajib lebih dari 0.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsAt) || !/^\d{4}-\d{2}-\d{2}$/.test(endsAt)) {
    throw new Error("Periode discount wajib diisi.");
  }

  if (endsAt < startsAt) {
    throw new Error("Tanggal selesai tidak boleh sebelum tanggal mulai.");
  }

  if (!["active", "inactive"].includes(status)) {
    throw new Error("Status discount tidak valid.");
  }

  if (data.discounts.some((discount) => discount.id !== discountId && discount.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("Nama discount sudah digunakan.");
  }

  return {
    name,
    type,
    value: type === "percent" ? Number(value) : Math.round(value),
    starts_at: startsAt,
    ends_at: endsAt,
    outlet_ids: outletIds,
    status
  };
}

function normalizePrintSettingsPayload(payload) {
  const defaultTemplateMap = new Map(data.print_templates.map((template) => [template.key, template]));
  const submittedTemplateMap = new Map((payload.templates || []).map((template) => [template.key, template]));
  const templateKeys = ["customer_order", "kitchen_order", "bill_receipt"];
  const templates = templateKeys.map((key) => {
    const current = submittedTemplateMap.get(key) || defaultTemplateMap.get(key) || {};
    return {
      key,
      label:
        current.label ||
        {
          customer_order: "Customer Order Copy",
          kitchen_order: "Kitchen Order",
          bill_receipt: "Bill / Receipt"
        }[key],
      enabled: current.enabled !== false,
      footer_text: normalizePrintFooterText(key, current.footer_text)
    };
  });

  const printerName = String(payload.printer_name || data.print_settings?.printer_name || "").trim();
  if (!printerName) {
    throw new Error("Nama printer wajib diisi.");
  }

  const printerStatus = payload.printer_status === "inactive" ? "inactive" : "active";

  return {
    settings: {
      printer_name: printerName,
      printer_status: printerStatus,
      mode: "single_printer_mock",
      item_sort_mode: "category_sort_order"
    },
    templates
  };
}

function normalizePrintFooterText(templateKey, value) {
  if (templateKey === "kitchen_order") return "";
  const text = String(value || "").replace(/\r\n/g, "\n").trim();
  if (text.length > 300) {
    throw new Error("Footer struk maksimal 300 karakter.");
  }
  return text;
}

function normalizeCompositionPayload(payload, compositionId) {
  const productId = payload.product_id;
  const materialId = payload.material_id;
  const quantity = Number(payload.quantity || 0);
  const product = productMap.get(productId);
  const material = materialMap.get(materialId);

  if (!product || !material || quantity <= 0) {
    throw new Error("Produk jual, harga pokok produksi, dan qty komposisi wajib valid.");
  }

  if (
    data.product_compositions.some(
      (composition) =>
        composition.id !== compositionId &&
        composition.product_id === productId &&
        composition.material_id === materialId
    )
  ) {
    throw new Error("Harga Pokok Produksi sudah ada di komposisi produk ini.");
  }

  return {
    product_id: productId,
    material_id: materialId,
    quantity,
    unit: payload.unit || material.unit
  };
}

function getProductSkuPrefix(category) {
  const name = String(category?.name || "").trim().toLowerCase();
  const knownPrefixes = {
    makanan: "MKN",
    minuman: "MNM",
    snack: "SNK",
    paket: "PKT"
  };
  if (knownPrefixes[name]) return knownPrefixes[name];

  const sanitized = String(category?.name || "Produk")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
  return (sanitized || "PRD").slice(0, 3).padEnd(3, "X");
}

function generateProductSku(categoryId) {
  const category = categoryMap.get(categoryId);
  const prefix = getProductSkuPrefix(category);
  const usedNumbers = data.products
    .map((product) => String(product.sku || "").toUpperCase())
    .map((sku) => sku.match(new RegExp(`^${prefix}-(\\d+)$`))?.[1])
    .filter(Boolean)
    .map((value) => Number(value));
  let nextNumber = (usedNumbers.length ? Math.max(...usedNumbers) : 0) + 1;
  let sku = `${prefix}-${String(nextNumber).padStart(3, "0")}`;
  const existingSkus = new Set(data.products.map((product) => String(product.sku || "").toUpperCase()));

  while (existingSkus.has(sku)) {
    nextNumber += 1;
    sku = `${prefix}-${String(nextNumber).padStart(3, "0")}`;
  }

  return sku;
}

export const mockApi = {
  async getMobileCatalogSnapshot() {
    await delay(180);
    return clone(getMobileCatalogSnapshot());
  },

  async login({ username, password }) {
    await delay(350);
    const user = data.users.find((item) => item.username === username);
    if (!user || !password) {
      throw new Error("Username atau password tidak valid.");
    }
    if (user.status !== "active") {
      throw new Error("User nonaktif. Hubungi Owner/Admin.");
    }
    return {
      ...clone(user),
      role: clone(roleMap.get(user.role_id)),
      outlets: user.outlet_ids.map((id) => outletMap.get(id))
    };
  },

  async getBootstrap() {
    await delay();
    return clone({
      outlets: getOutletRows(),
      tables: getTableRows("all"),
      roles: data.roles,
      users: getUserRows(),
      permissions: data.permissions,
      metadata: data.metadata
    });
  },

  async getDashboard({ outletId = "all", from = "2026-04-01", to = "2026-04-30" } = {}) {
    await delay();
    const transactions = getTransactionRows({ outletId, from, to });
    const purchases = getPurchaseRows(outletId)
      .filter((purchase) => purchase.status === "approved" && withinDateRange(purchase.purchase_date, from, to));
    const expenses = data.expenses.filter(outletFilter(outletId)).filter((expense) => withinDateRange(expense.expense_date, from, to));
    const lowStocks = getStockRows(outletId).filter((stock) => stock.status !== "normal");
    const revenue = transactions.reduce((total, item) => total + item.total, 0);
    const purchaseTotal = purchases.reduce((total, item) => total + item.total, 0);
    const expenseTotal = expenses.reduce((total, item) => total + item.amount, 0);

    return clone({
      metrics: {
        revenue,
        transactions: transactions.length,
        purchases: purchaseTotal,
        expenses: expenseTotal,
        gross_profit_estimate: getGrossProfitEstimate(transactions),
        low_stock_count: lowStocks.length
      },
      daily_sales: getDailySales(transactions),
      top_products: getTopProducts(transactions),
      recent_transactions: transactions.slice(0, 8),
      low_stocks: lowStocks.slice(0, 8),
      sales_by_outlet: getSalesByOutlet(transactions),
      material_price_comparisons: getMaterialPriceComparisons({ outletId, from, to })
    });
  },

  async getDashboardMaterialPurchaseComparisons(filters = {}) {
    await delay();
    return clone(getMaterialPurchaseComparisons(filters));
  },

  async getMasterData({ outletId = "all", keyword = "" } = {}) {
    await delay();
    const users = getUserRows();
    const customers = getCustomerRows(outletId, keyword);

    return clone({
      users,
      outlets: getOutletRows(),
      roles: data.roles,
      categories: getCategoryRows(),
      expense_categories: getExpenseCategoryRows(keyword),
      payment_methods: getPaymentMethodRows(keyword),
      discounts: getDiscountRows(keyword),
      materials: getMaterialRows(outletId),
      compositions: getCompositionRows(),
      units: getUnitRows(),
      suppliers: getSupplierRows(),
      tables: getTableRows(outletId, keyword),
      customers,
      products: getProductRows(outletId).filter((product) => includesText(`${product.name} ${product.sku} ${product.category?.name}`, keyword))
    });
  },

  async getInventory({ outletId = "all" } = {}) {
    await delay();
    return clone({
      stocks: getStockRows(outletId),
      all_stocks: getStockRows("all"),
      purchases: getPurchaseRows(outletId),
      transfers: getTransferRows(outletId),
      opnames: getOpnameRows(outletId),
      materials: data.raw_materials,
      suppliers: getSupplierRows(),
      outlets: getOutletRows()
    });
  },

  async getStockOpnameWorksheet({ outletId, date } = {}) {
    await delay();
    const outlet = outletMap.get(outletId);

    if (!outletId || outletId === "all" || !outlet) {
      return clone({
        outlet: null,
        date,
        rows: [],
        summary: {
          total_items: 0,
          match_items: 0,
          missing_items: 0,
          total_missing_quantity: 0,
          total_loss_amount: 0
        }
      });
    }

    const rows = getStockOpnameWorksheetRows({ outletId, date });
    const totalMissingQuantity = rows.reduce((total, row) => total + Math.max(Number(row.difference || 0), 0), 0);

    return clone({
      outlet,
      date,
      rows,
      summary: {
        total_items: rows.length,
        match_items: rows.filter((row) => Math.abs(Number(row.difference || 0)) < 0.001).length,
        missing_items: rows.filter((row) => Number(row.difference || 0) > 0).length,
        total_missing_quantity: roundQuantity(totalMissingQuantity),
        total_loss_amount: rows.reduce((total, row) => total + Number(row.loss_amount || 0), 0)
      }
    });
  },

  async getReports({ outletId = "all", from = "2026-04-01", to = "2026-04-30" } = {}) {
    await delay();
    const transactions = getTransactionRows({ outletId, from, to });
    const purchases = getPurchaseRows(outletId).filter((purchase) => withinDateRange(purchase.purchase_date, from, to));
    const expenses = data.expenses.filter(outletFilter(outletId)).filter((expense) => withinDateRange(expense.expense_date, from, to));
    const revenue = transactions.reduce((total, item) => total + item.total, 0);
    const purchaseTotal = purchases.reduce((total, item) => total + item.total, 0);
    const expenseTotal = expenses.reduce((total, item) => total + item.amount, 0);
    const payment_breakdown = transactions.reduce(addTransactionPaymentBreakdown, {});

    return clone({
      transactions,
      outlets: getOutletRows(),
      sales_by_day: getDailySales(transactions),
      sales_by_product: getTopProducts(transactions),
      sales_by_outlet: getSalesByOutlet(transactions, outletId),
      sales_by_customer: getSalesByCustomer(transactions),
      sales_by_hour: getSalesByHour(transactions),
      sales_by_service_type: getSalesByServiceType(transactions),
      payment_methods: getPaymentMethodRows(),
      purchases,
      expenses,
      profit_loss: {
        revenue,
        cogs_estimate: Math.round(revenue * 0.58),
        gross_profit: getGrossProfitEstimate(transactions),
        expenses: expenseTotal + purchaseTotal,
        net_profit: revenue - purchaseTotal - expenseTotal,
        payment_breakdown
      },
      balance_sheet: {
        assets: revenue + getStockRows(outletId).length * 125000,
        liabilities: Math.round(purchaseTotal * 0.22),
        equity: revenue - purchaseTotal - expenseTotal
      }
    });
  },

  async getSalesOutletComparison({ from = "2026-05-01", to = "2026-05-16", outletIds = "" } = {}) {
    await delay();
    const outletIdList = parseQueryList(outletIds);
    const outletOptions = getOutletRows().filter((outlet) => outlet.status !== "inactive");
    const selectedOutlets = outletIdList.length
      ? outletOptions.filter((outlet) => outletIdList.includes(outlet.id))
      : outletOptions;
    const allowedOutletIds = new Set(selectedOutlets.map((outlet) => outlet.id));
    const transactions = getTransactionRows({ outletId: "all", from, to })
      .filter((transaction) => transaction.status === "paid")
      .filter((transaction) => allowedOutletIds.has(transaction.outlet_id));

    return clone(buildSalesOutletComparison({
      transactions,
      outlets: selectedOutlets,
      outletOptions,
      from,
      to
    }));
  },

  async getSettings() {
    await delay();
    return clone({
      roles: data.roles,
      permissions: data.permissions,
      categories: getCategoryRows(),
      print_settings: getPrintSettings()
    });
  },

  async updatePrintSettings(payload) {
    await delay(360);
    const next = normalizePrintSettingsPayload(payload);
    data.print_settings = next.settings;
    data.print_templates = next.templates;
    rebuildIndexes();
    return clone(getPrintSettings());
  },

  async createUser(payload) {
    await delay(360);
    const userPayload = normalizeUserPayload(payload, { isCreate: true });
    assertUniqueUser(userPayload);

    const user = {
      id: createSequentialId("user", data.users),
      ...userPayload,
      last_login_at: null
    };

    data.users.push(user);
    rebuildIndexes();

    return clone(getUserRows().find((item) => item.id === user.id));
  },

  async updateUser(userId, payload) {
    await delay(360);
    const user = data.users.find((item) => item.id === userId);

    if (!user) {
      throw new Error("User tidak ditemukan.");
    }

    const userPayload = normalizeUserPayload(payload, { requirePin: user.role_id !== "role_cashier" && payload.role_id === "role_cashier" });
    assertUniqueUser({ ...userPayload, userId });

    user.name = userPayload.name;
    user.username = userPayload.username;
    user.email = userPayload.email;
    user.role_id = userPayload.role_id;
    user.outlet_ids = userPayload.outlet_ids;
    user.status = userPayload.status;
    if (userPayload.role_id === "role_cashier") {
      if (userPayload.cashier_pin) user.cashier_pin = userPayload.cashier_pin;
      if (!user.cashier_pin) user.cashier_pin = "000000";
    } else {
      delete user.cashier_pin;
    }
    rebuildIndexes();

    return clone(getUserRows().find((item) => item.id === userId));
  },

  async updateProfile(userId, payload) {
    await delay(320);
    const user = data.users.find((item) => item.id === userId);

    if (!user) {
      throw new Error("User tidak ditemukan.");
    }

    const profilePayload = normalizeProfilePayload(payload);
    assertUniqueUser({ ...profilePayload, userId });

    user.name = profilePayload.name;
    user.username = profilePayload.username;
    user.email = profilePayload.email;
    user.profile_updated_at = new Date().toISOString();
    rebuildIndexes();

    return clone(getUserRows().find((item) => item.id === userId));
  },

  async changeProfilePassword(userId, payload) {
    await delay(360);
    const user = data.users.find((item) => item.id === userId);
    const currentPassword = String(payload.current_password || "");
    const newPassword = String(payload.new_password || "");
    const confirmPassword = String(payload.confirm_password || "");

    if (!user) {
      throw new Error("User tidak ditemukan.");
    }

    if (!currentPassword) {
      throw new Error("Password lama wajib diisi.");
    }

    if (newPassword.length < 6) {
      throw new Error("Password baru minimal 6 karakter.");
    }

    if (newPassword !== confirmPassword) {
      throw new Error("Konfirmasi password tidak sama.");
    }

    user.password_changed_at = new Date().toISOString();
    rebuildIndexes();

    return clone(getUserRows().find((item) => item.id === userId));
  },

  async toggleUserStatus(userId) {
    await delay(260);
    const user = data.users.find((item) => item.id === userId);

    if (!user) {
      throw new Error("User tidak ditemukan.");
    }

    user.status = user.status === "active" ? "inactive" : "active";
    rebuildIndexes();

    return clone(getUserRows().find((item) => item.id === userId));
  },

  async resetUserPassword(userId) {
    await delay(320);
    const user = data.users.find((item) => item.id === userId);

    if (!user) {
      throw new Error("User tidak ditemukan.");
    }

    user.password_reset_at = new Date().toISOString();
    rebuildIndexes();

    return clone({
      user: getUserRows().find((item) => item.id === userId),
      temporary_password: createTemporaryPassword()
    });
  },

  async updateRolePermissions(roleId, permissions) {
    await delay(320);
    const role = data.roles.find((item) => item.id === roleId);

    if (!role) {
      throw new Error("Role tidak ditemukan.");
    }

    if (role.id === "role_owner") {
      throw new Error("Permission Owner dikunci agar akses penuh tetap aman.");
    }

    const allowedByKey = new Map(data.permissions.map((permission) => [permission.key, permission.actions]));
    role.permissions = Object.entries(permissions || {}).reduce((result, [permissionKey, actions]) => {
      const allowedActions = allowedByKey.get(permissionKey);
      if (!allowedActions) return result;

      result[permissionKey] = (Array.isArray(actions) ? actions : []).filter((action) => allowedActions.includes(action));
      return result;
    }, {});
    rebuildIndexes();

    return clone(role);
  },

  async generateCustomerBarcode(outletId) {
    await delay(180);
    if (!outletMap.has(outletId)) {
      throw new Error("Outlet tidak ditemukan.");
    }

    return clone({
      barcode: createCustomerBarcode(outletId)
    });
  },

  async createCustomer(payload) {
    await delay(360);
    const customerId = createSequentialId("customer", data.customers);
    const customerPayload = normalizeCustomerPayload(payload, customerId);
    const customer = {
      id: customerId,
      outlet_id: customerPayload.outlet_id,
      name: customerPayload.name,
      phone: customerPayload.phone,
      barcode: customerPayload.barcode || createCustomerBarcode(customerPayload.outlet_id),
      status: customerPayload.status,
      registered_at: payload.registered_at || new Date().toISOString().slice(0, 10)
    };

    data.customers.push(customer);
    rebuildIndexes();

    return clone(getCustomerRows("all").find((item) => item.id === customerId));
  },

  async updateCustomer(customerId, payload) {
    await delay(360);
    const customer = data.customers.find((item) => item.id === customerId);

    if (!customer) {
      throw new Error("Customer tidak ditemukan.");
    }

    const customerPayload = normalizeCustomerPayload(payload, customerId);
    customer.name = customerPayload.name;
    customer.phone = customerPayload.phone;
    customer.outlet_id = customerPayload.outlet_id;
    customer.barcode = customerPayload.barcode || customer.barcode || createCustomerBarcode(customerPayload.outlet_id);
    customer.status = customerPayload.status;
    rebuildIndexes();

    return clone(getCustomerRows("all").find((item) => item.id === customerId));
  },

  async toggleCustomerStatus(customerId) {
    await delay(260);
    const customer = data.customers.find((item) => item.id === customerId);

    if (!customer) {
      throw new Error("Customer tidak ditemukan.");
    }

    customer.status = customer.status === "active" ? "inactive" : "active";
    rebuildIndexes();

    return clone(getCustomerRows("all").find((item) => item.id === customerId));
  },

  async createOutlet(payload) {
    await delay(360);
    const outletPayload = normalizeOutletPayload(payload);
    const outlet = {
      id: createSequentialId("outlet", data.outlets),
      ...outletPayload
    };

    data.outlets.push(outlet);

    data.users = data.users.map((user) =>
      user.role_id === "role_owner" && !user.outlet_ids.includes(outlet.id)
        ? { ...user, outlet_ids: [...user.outlet_ids, outlet.id] }
        : user
    );
    rebuildIndexes();

    return clone(getOutletRows().find((item) => item.id === outlet.id));
  },

  async updateOutlet(outletId, payload) {
    await delay(360);
    const outlet = data.outlets.find((item) => item.id === outletId);

    if (!outlet) {
      throw new Error("Outlet tidak ditemukan.");
    }

    const outletPayload = normalizeOutletPayload(payload, outletId);
    outlet.name = outletPayload.name;
    outlet.code = outletPayload.code;
    outlet.address = outletPayload.address;
    outlet.phone = outletPayload.phone;
    outlet.opened_at = outletPayload.opened_at;
    outlet.status = outletPayload.status;
    rebuildIndexes();

    return clone(getOutletRows().find((item) => item.id === outletId));
  },

  async toggleOutletStatus(outletId) {
    await delay(260);
    const outlet = data.outlets.find((item) => item.id === outletId);

    if (!outlet) {
      throw new Error("Outlet tidak ditemukan.");
    }

    outlet.status = outlet.status === "active" ? "inactive" : "active";
    rebuildIndexes();

    return clone(getOutletRows().find((item) => item.id === outletId));
  },

  async createTable(payload) {
    await delay(320);
    const tablePayload = normalizeTablePayload(payload);
    const table = {
      id: createSequentialId("table", data.tables),
      ...tablePayload
    };

    data.tables.push(table);
    rebuildIndexes();

    return clone(getTableRows("all").find((item) => item.id === table.id));
  },

  async updateTable(tableId, payload) {
    await delay(320);
    const table = data.tables.find((item) => item.id === tableId);

    if (!table) {
      throw new Error("Meja tidak ditemukan.");
    }

    const tablePayload = normalizeTablePayload(payload, tableId);
    table.outlet_id = tablePayload.outlet_id;
    table.number = tablePayload.number;
    table.status = tablePayload.status;
    rebuildIndexes();

    return clone(getTableRows("all").find((item) => item.id === tableId));
  },

  async toggleTableStatus(tableId) {
    await delay(260);
    const table = data.tables.find((item) => item.id === tableId);

    if (!table) {
      throw new Error("Meja tidak ditemukan.");
    }

    table.status = table.status === "active" ? "inactive" : "active";
    rebuildIndexes();

    return clone(getTableRows("all").find((item) => item.id === tableId));
  },

  async createCategory(payload) {
    await delay(320);
    const nextSortOrder = data.categories.reduce((max, category) => Math.max(max, Number(category.sort_order || 0)), 0) + 1;
    const categoryPayload = normalizeCategoryPayload(payload, null, nextSortOrder);
    const category = {
      id: createSequentialId("cat", data.categories),
      ...categoryPayload
    };

    data.categories.push(category);
    rebuildIndexes();

    return clone(getCategoryRows().find((item) => item.id === category.id));
  },

  async updateCategory(categoryId, payload) {
    await delay(320);
    const category = data.categories.find((item) => item.id === categoryId);

    if (!category) {
      throw new Error("Kategori tidak ditemukan.");
    }

    const categoryPayload = normalizeCategoryPayload(payload, categoryId, category.sort_order);
    category.name = categoryPayload.name;
    category.sort_order = categoryPayload.sort_order;
    category.status = categoryPayload.status;
    rebuildIndexes();

    return clone(getCategoryRows().find((item) => item.id === categoryId));
  },

  async toggleCategoryStatus(categoryId) {
    await delay(260);
    const category = data.categories.find((item) => item.id === categoryId);

    if (!category) {
      throw new Error("Kategori tidak ditemukan.");
    }

    category.status = category.status === "active" ? "inactive" : "active";
    rebuildIndexes();

    return clone(getCategoryRows().find((item) => item.id === categoryId));
  },

  async createExpenseCategory(payload) {
    await delay(320);
    const nextSortOrder =
      data.expense_categories.reduce((max, category) => Math.max(max, Number(category.sort_order || 0)), 0) + 1;
    const categoryPayload = normalizeExpenseCategoryPayload(payload, null, nextSortOrder);
    const category = {
      id: createSequentialId("expense_cat", data.expense_categories),
      ...categoryPayload
    };

    data.expense_categories.push(category);
    rebuildIndexes();

    return clone(getExpenseCategoryRows().find((item) => item.id === category.id));
  },

  async updateExpenseCategory(categoryId, payload) {
    await delay(320);
    const category = data.expense_categories.find((item) => item.id === categoryId);

    if (!category) {
      throw new Error("Kategori pengeluaran tidak ditemukan.");
    }

    const categoryPayload = normalizeExpenseCategoryPayload(payload, categoryId, category.sort_order);
    category.name = categoryPayload.name;
    category.sort_order = categoryPayload.sort_order;
    category.status = categoryPayload.status;
    rebuildIndexes();

    return clone(getExpenseCategoryRows().find((item) => item.id === categoryId));
  },

  async toggleExpenseCategoryStatus(categoryId) {
    await delay(260);
    const category = data.expense_categories.find((item) => item.id === categoryId);

    if (!category) {
      throw new Error("Kategori pengeluaran tidak ditemukan.");
    }

    category.status = category.status === "active" ? "inactive" : "active";
    rebuildIndexes();

    return clone(getExpenseCategoryRows().find((item) => item.id === categoryId));
  },

  async createPaymentMethod(payload) {
    await delay(320);
    const nextSortOrder =
      data.payment_methods.reduce((max, method) => Math.max(max, Number(method.sort_order || 0)), 0) + 1;
    const methodPayload = normalizePaymentMethodPayload(payload, null, nextSortOrder);
    const method = {
      id: createSequentialId("payment_method", data.payment_methods),
      ...methodPayload
    };

    data.payment_methods.push(method);
    rebuildIndexes();

    return clone(getPaymentMethodRows().find((item) => item.id === method.id));
  },

  async updatePaymentMethod(methodId, payload) {
    await delay(320);
    const method = data.payment_methods.find((item) => item.id === methodId);

    if (!method) {
      throw new Error("Metode pembayaran tidak ditemukan.");
    }

    const methodPayload = normalizePaymentMethodPayload(payload, methodId, method.sort_order);
    method.name = methodPayload.name;
    method.code = methodPayload.code;
    method.account_code = methodPayload.account_code;
    method.sort_order = methodPayload.sort_order;
    method.status = methodPayload.status;
    rebuildIndexes();

    return clone(getPaymentMethodRows().find((item) => item.id === methodId));
  },

  async togglePaymentMethodStatus(methodId) {
    await delay(260);
    const method = data.payment_methods.find((item) => item.id === methodId);

    if (!method) {
      throw new Error("Metode pembayaran tidak ditemukan.");
    }

    method.status = method.status === "active" ? "inactive" : "active";
    rebuildIndexes();

    return clone(getPaymentMethodRows().find((item) => item.id === methodId));
  },

  async createDiscount(payload) {
    await delay(320);
    const discountPayload = normalizeDiscountPayload(payload, null);
    const { outlet_ids: outletIds, ...discountFields } = discountPayload;
    const discount = {
      id: createSequentialId("discount", data.discounts),
      ...discountFields
    };

    data.discounts.push(discount);
    syncDiscountOutlets(discount.id, outletIds);
    rebuildIndexes();

    return clone(getDiscountRows().find((item) => item.id === discount.id));
  },

  async updateDiscount(discountId, payload) {
    await delay(320);
    const discount = data.discounts.find((item) => item.id === discountId);

    if (!discount) {
      throw new Error("Discount tidak ditemukan.");
    }

    const discountPayload = normalizeDiscountPayload(payload, discountId);
    const { outlet_ids: outletIds, ...discountFields } = discountPayload;
    discount.name = discountFields.name;
    discount.type = discountFields.type;
    discount.value = discountFields.value;
    discount.starts_at = discountFields.starts_at;
    discount.ends_at = discountFields.ends_at;
    discount.status = discountFields.status;
    syncDiscountOutlets(discount.id, outletIds);
    rebuildIndexes();

    return clone(getDiscountRows().find((item) => item.id === discountId));
  },

  async toggleDiscountStatus(discountId) {
    await delay(260);
    const discount = data.discounts.find((item) => item.id === discountId);

    if (!discount) {
      throw new Error("Discount tidak ditemukan.");
    }

    discount.status = discount.status === "active" ? "inactive" : "active";
    rebuildIndexes();

    return clone(getDiscountRows().find((item) => item.id === discountId));
  },

  async createProductComposition(payload) {
    await delay(320);
    const compositionPayload = normalizeCompositionPayload(payload);
    const composition = {
      id: createSequentialId("comp", data.product_compositions),
      ...compositionPayload
    };

    data.product_compositions.push(composition);
    rebuildIndexes();

    return clone(getCompositionRows().find((item) => item.id === composition.id));
  },

  async updateProductComposition(compositionId, payload) {
    await delay(320);
    const composition = data.product_compositions.find((item) => item.id === compositionId);

    if (!composition) {
      throw new Error("Komposisi produk tidak ditemukan.");
    }

    const compositionPayload = normalizeCompositionPayload(payload, compositionId);
    composition.product_id = compositionPayload.product_id;
    composition.material_id = compositionPayload.material_id;
    composition.quantity = compositionPayload.quantity;
    composition.unit = compositionPayload.unit;
    rebuildIndexes();

    return clone(getCompositionRows().find((item) => item.id === compositionId));
  },

  async deleteProductComposition(compositionId) {
    await delay(260);
    const composition = data.product_compositions.find((item) => item.id === compositionId);

    if (!composition) {
      throw new Error("Komposisi produk tidak ditemukan.");
    }

    data.product_compositions = data.product_compositions.filter((item) => item.id !== compositionId);
    rebuildIndexes();

    return clone(composition);
  },

  async createRecord(entity, payload) {
    await delay(420);
    return clone({
      id: `${entity}_${Date.now()}`,
      ...payload,
      status: payload.status || "active"
    });
  },

  async getProductDetail(productId) {
    await delay();
    const product = getProductRows("all").find((item) => item.id === productId);

    if (!product) {
      throw new Error("Produk tidak ditemukan.");
    }

    return clone(product);
  },

  async createProduct(payload) {
    await delay(420);
    const sku = generateProductSku(payload.category_id);
    const name = String(payload.name || "").trim();

    if (!name || !payload.category_id || !categoryMap.has(payload.category_id)) {
      throw new Error("Nama produk dan kategori wajib diisi.");
    }

    if (data.products.some((product) => product.sku.toLowerCase() === sku.toLowerCase())) {
      throw new Error("SKU otomatis gagal dibuat unik.");
    }

    const productId = createSequentialId("product", data.products);
    const product = {
      id: productId,
      category_id: payload.category_id,
      sku,
      name,
      status: payload.status || "active"
    };

    data.products.push(product);

    const nextPriceId = createIdGenerator("price", data.product_prices);
    const priceRows = (payload.prices || [])
      .filter((price) => price.outlet_id && outletMap.has(price.outlet_id) && Number(price.price || 0) > 0)
      .map((price) => ({
        id: nextPriceId(),
        product_id: productId,
        outlet_id: price.outlet_id,
        price: Number(price.price || 0),
        status: price.status || "active"
      }));

    data.product_prices.push(...priceRows);

    const nextCompositionId = createIdGenerator("comp", data.product_compositions);
    const compositionRows = (payload.composition || [])
      .filter((item) => item.material_id && Number(item.quantity) > 0)
      .map((item) => {
        const material = materialMap.get(item.material_id);
        return {
          id: nextCompositionId(),
          product_id: productId,
          material_id: item.material_id,
          quantity: Number(item.quantity),
          unit: item.unit || material?.unit || ""
        };
      });

    data.product_compositions.push(...compositionRows);
    data.product_variants.push(...normalizeProductVariantsPayload(productId, payload.variants || []));
    rebuildIndexes();

    return clone(getProductRows("all").find((item) => item.id === productId));
  },

  async updateProduct(productId, payload) {
    await delay(420);
    const product = data.products.find((item) => item.id === productId);

    if (!product) {
      throw new Error("Produk tidak ditemukan.");
    }

    const name = String(payload.name || "").trim();

    if (!name || !payload.category_id || !categoryMap.has(payload.category_id)) {
      throw new Error("Nama produk dan kategori wajib diisi.");
    }

    product.name = name;
    product.category_id = payload.category_id;
    product.status = payload.status || "active";

    const existingPrices = data.product_prices.filter((price) => price.product_id === productId);
    const existingPriceByOutlet = new Map(existingPrices.map((price) => [price.outlet_id, price]));
    const nextPriceId = createIdGenerator("price", data.product_prices);

    const nextPrices = (payload.prices || [])
      .filter((price) => price.outlet_id && outletMap.has(price.outlet_id) && Number(price.price || 0) > 0)
      .map((price) => {
        const existingPrice = existingPriceByOutlet.get(price.outlet_id);
        return {
          id: existingPrice?.id || nextPriceId(),
          product_id: productId,
          outlet_id: price.outlet_id,
          price: Number(price.price || 0),
          status: price.status || "active"
        };
      });

    data.product_prices = [
      ...data.product_prices.filter((price) => price.product_id !== productId),
      ...nextPrices
    ];

    data.product_compositions = data.product_compositions.filter((item) => item.product_id !== productId);
    const nextCompositionId = createIdGenerator("comp", data.product_compositions);
    const nextComposition = (payload.composition || [])
      .filter((item) => item.material_id && Number(item.quantity) > 0)
      .map((item) => {
        const material = materialMap.get(item.material_id);
        return {
          id: nextCompositionId(),
          product_id: productId,
          material_id: item.material_id,
          quantity: Number(item.quantity),
          unit: item.unit || material?.unit || ""
        };
      });

    data.product_compositions.push(...nextComposition);
    data.product_variants = [
      ...data.product_variants.filter((item) => item.product_id !== productId),
      ...normalizeProductVariantsPayload(productId, payload.variants || [])
    ];
    rebuildIndexes();

    return clone(getProductRows("all").find((item) => item.id === productId));
  },

  async toggleProductStatus(productId) {
    await delay(260);
    const product = data.products.find((item) => item.id === productId);

    if (!product) {
      throw new Error("Produk tidak ditemukan.");
    }

    product.status = product.status === "active" ? "inactive" : "active";
    rebuildIndexes();

    return clone(getProductRows("all").find((item) => item.id === productId));
  },

  async createMaterial(payload) {
    await delay(360);
    const name = String(payload.name || "").trim();
    const unit = String(payload.unit || "").trim();
    const lowStockThreshold = Number(payload.low_stock_threshold || 0);
    const type = String(payload.type || "hpp").trim();
    const categoryId = payload.category_id || (data.raw_material_categories || []).find((category) => category.type === type)?.id;
    const category = (data.raw_material_categories || []).find((item) => item.id === categoryId);
    const accountCode = category?.account_code || (type === "biaya" ? "6000" : "5002");

    if (!name || !unit || lowStockThreshold < 0 || !["hpp", "biaya"].includes(type) || !category || category.type !== type) {
      throw new Error("Nama, unit, type, kategori, dan threshold harga pokok produksi wajib valid.");
    }

    if (data.raw_materials.some((material) => material.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("Nama harga pokok produksi sudah digunakan.");
    }

    const materialId = createSequentialId("material", data.raw_materials);
    const material = {
      id: materialId,
      name,
      unit,
      type,
      category_id: categoryId,
      account_code: accountCode,
      low_stock_threshold: lowStockThreshold,
      status: payload.status || "active"
    };

    data.raw_materials.push(material);

    rebuildIndexes();

    return clone(getMaterialRows().find((item) => item.id === materialId));
  },

  async updateMaterial(materialId, payload) {
    await delay(360);
    const material = data.raw_materials.find((item) => item.id === materialId);

    if (!material) {
      throw new Error("Harga Pokok Produksi tidak ditemukan.");
    }

    const name = String(payload.name || "").trim();
    const unit = String(payload.unit || "").trim();
    const lowStockThreshold = Number(payload.low_stock_threshold || 0);
    const type = String(payload.type || material.type || "hpp").trim();
    const categoryId = payload.category_id || material.category_id || (data.raw_material_categories || []).find((category) => category.type === type)?.id;
    const category = (data.raw_material_categories || []).find((item) => item.id === categoryId);
    const accountCode = category?.account_code || (type === "biaya" ? "6000" : "5002");

    if (!name || !unit || lowStockThreshold < 0 || !["hpp", "biaya"].includes(type) || !category || category.type !== type) {
      throw new Error("Nama, unit, type, kategori, dan threshold harga pokok produksi wajib valid.");
    }

    if (data.raw_materials.some((item) => item.id !== materialId && item.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("Nama harga pokok produksi sudah digunakan.");
    }

    material.name = name;
    material.unit = unit;
    material.type = type;
    material.category_id = categoryId;
    material.account_code = accountCode;
    material.low_stock_threshold = lowStockThreshold;
    material.status = payload.status || "active";

    data.raw_material_stocks = data.raw_material_stocks.map((stock) =>
      stock.material_id === materialId ? { ...stock, unit } : stock
    );
    data.product_compositions = data.product_compositions.map((composition) =>
      composition.material_id === materialId ? { ...composition, unit } : composition
    );

    rebuildIndexes();

    return clone(getMaterialRows().find((item) => item.id === materialId));
  },

  async toggleMaterialStatus(materialId) {
    await delay(260);
    const material = data.raw_materials.find((item) => item.id === materialId);

    if (!material) {
      throw new Error("Harga Pokok Produksi tidak ditemukan.");
    }

    material.status = material.status === "active" ? "inactive" : "active";
    rebuildIndexes();

    return clone(getMaterialRows().find((item) => item.id === materialId));
  },

  async createUnit(payload) {
    await delay(320);
    const name = String(payload.name || "").trim();
    const code = String(payload.code || name).trim();

    if (!name || !code) {
      throw new Error("Nama dan kode unit wajib diisi.");
    }

    if (units.some((unit) => unit.code.toLowerCase() === code.toLowerCase())) {
      throw new Error("Kode unit sudah digunakan.");
    }

    const unit = {
      id: createSequentialId("unit", units),
      name,
      code,
      status: payload.status || "active"
    };

    units.push(unit);

    return clone(getUnitRows().find((item) => item.id === unit.id));
  },

  async updateUnit(unitId, payload) {
    await delay(320);
    const unit = units.find((item) => item.id === unitId);

    if (!unit) {
      throw new Error("Unit tidak ditemukan.");
    }

    const name = String(payload.name || "").trim();
    const code = String(payload.code || name).trim();

    if (!name || !code) {
      throw new Error("Nama dan kode unit wajib diisi.");
    }

    if (units.some((item) => item.id !== unitId && item.code.toLowerCase() === code.toLowerCase())) {
      throw new Error("Kode unit sudah digunakan.");
    }

    const previousCode = unit.code;
    unit.name = name;
    unit.code = code;
    unit.status = payload.status || "active";

    if (previousCode !== code) {
      data.raw_materials = data.raw_materials.map((material) =>
        material.unit === previousCode ? { ...material, unit: code } : material
      );
      data.raw_material_stocks = data.raw_material_stocks.map((stock) =>
        stock.unit === previousCode ? { ...stock, unit: code } : stock
      );
      data.product_compositions = data.product_compositions.map((composition) =>
        composition.unit === previousCode ? { ...composition, unit: code } : composition
      );
      rebuildIndexes();
    }

    return clone(getUnitRows().find((item) => item.id === unitId));
  },

  async toggleUnitStatus(unitId) {
    await delay(260);
    const unit = units.find((item) => item.id === unitId);

    if (!unit) {
      throw new Error("Unit tidak ditemukan.");
    }

    unit.status = unit.status === "active" ? "inactive" : "active";

    return clone(getUnitRows().find((item) => item.id === unitId));
  },

  async createSupplier(payload) {
    await delay(320);
    const name = String(payload.name || "").trim();
    const phone = String(payload.phone || "").trim();

    if (!name || !phone) {
      throw new Error("Nama supplier dan nomor telepon wajib diisi.");
    }

    if (data.suppliers.some((supplier) => supplier.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("Nama supplier sudah digunakan.");
    }

    const supplier = {
      id: createSequentialId("supplier", data.suppliers),
      name,
      phone,
      status: payload.status || "active"
    };

    data.suppliers.push(supplier);
    rebuildIndexes();

    return clone(getSupplierRows().find((item) => item.id === supplier.id));
  },

  async updateSupplier(supplierId, payload) {
    await delay(320);
    const supplier = data.suppliers.find((item) => item.id === supplierId);

    if (!supplier) {
      throw new Error("Supplier tidak ditemukan.");
    }

    const name = String(payload.name || "").trim();
    const phone = String(payload.phone || "").trim();

    if (!name || !phone) {
      throw new Error("Nama supplier dan nomor telepon wajib diisi.");
    }

    if (data.suppliers.some((item) => item.id !== supplierId && item.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("Nama supplier sudah digunakan.");
    }

    supplier.name = name;
    supplier.phone = phone;
    supplier.status = payload.status || "active";
    rebuildIndexes();

    return clone(getSupplierRows().find((item) => item.id === supplierId));
  },

  async toggleSupplierStatus(supplierId) {
    await delay(260);
    const supplier = data.suppliers.find((item) => item.id === supplierId);

    if (!supplier) {
      throw new Error("Supplier tidak ditemukan.");
    }

    supplier.status = supplier.status === "active" ? "inactive" : "active";
    rebuildIndexes();

    return clone(getSupplierRows().find((item) => item.id === supplierId));
  },

  async createPurchase(payload) {
    await delay(420);
    const outletId = payload.outlet_id;
    const supplierId = payload.supplier_id;
    const materialId = payload.material_id;
    const quantity = Number(payload.quantity || 0);
    const unitPrice = Number(payload.unit_price || 0);
    const material = materialMap.get(materialId);

    const supplier = supplierMap.get(supplierId);

    if (!outletMap.has(outletId) || !supplier || supplier.status !== "active" || !material || quantity <= 0 || unitPrice <= 0) {
      throw new Error("Outlet, supplier, harga pokok produksi, qty, dan harga satuan wajib valid.");
    }

    const subtotal = Math.round(quantity * unitPrice);
    const purchase = {
      id: createSequentialId("purchase", data.purchases),
      outlet_id: outletId,
      supplier_id: supplierId,
      purchase_date: payload.purchase_date || "2026-04-30",
      status: "approved",
      total: subtotal,
      items: [
        {
          material_id: materialId,
          quantity,
          unit: material.unit,
          unit_price: unitPrice,
          subtotal
        }
      ]
    };

    const stock = ensureStockRow(outletId, materialId);
    stock.quantity = Number((Number(stock.quantity || 0) + quantity).toFixed(3));
    stock.unit = material.unit;
    data.purchases.unshift(purchase);
    rebuildIndexes();

    return clone(getPurchaseRows("all").find((item) => item.id === purchase.id));
  },

  async createStockTransfer(payload) {
    await delay(420);
    const fromOutletId = payload.from_outlet_id;
    const toOutletId = payload.to_outlet_id;
    const materialId = payload.material_id;
    const quantity = Number(payload.quantity || 0);
    const material = materialMap.get(materialId);

    if (!outletMap.has(fromOutletId) || !outletMap.has(toOutletId) || !material || quantity <= 0) {
      throw new Error("Outlet asal, outlet tujuan, harga pokok produksi, dan qty wajib valid.");
    }

    if (fromOutletId === toOutletId) {
      throw new Error("Outlet asal dan tujuan tidak boleh sama.");
    }

    const fromStock = ensureStockRow(fromOutletId, materialId);
    if (Number(fromStock.quantity || 0) < quantity) {
      throw new Error("Stok outlet asal tidak mencukupi.");
    }

    const toStock = ensureStockRow(toOutletId, materialId);
    fromStock.quantity = Number((Number(fromStock.quantity || 0) - quantity).toFixed(3));
    toStock.quantity = Number((Number(toStock.quantity || 0) + quantity).toFixed(3));
    fromStock.unit = material.unit;
    toStock.unit = material.unit;

    const transfer = {
      id: createSequentialId("transfer", data.stock_transfers),
      from_outlet_id: fromOutletId,
      to_outlet_id: toOutletId,
      requested_by: payload.requested_by || data.users[0]?.id,
      approved_by: payload.approved_by || data.users[0]?.id,
      status: "approved",
      transfer_date: payload.transfer_date || "2026-04-30",
      items: [
        {
          material_id: materialId,
          quantity,
          unit: material.unit
        }
      ]
    };

    data.stock_transfers.unshift(transfer);
    rebuildIndexes();

    return clone(getTransferRows("all").find((item) => item.id === transfer.id));
  },

  async createStockOpname(payload) {
    await delay(420);
    const outletId = payload.outlet_id;
    const materialId = payload.material_id;
    const actualQuantity = Number(payload.actual_quantity);
    const material = materialMap.get(materialId);

    if (!outletMap.has(outletId) || !material || Number.isNaN(actualQuantity) || actualQuantity < 0) {
      throw new Error("Outlet, produk, dan qty fisik wajib valid.");
    }

    const stock = ensureStockRow(outletId, materialId);
    const systemQuantity = Number(stock.quantity || 0);
    const difference = Number((systemQuantity - actualQuantity).toFixed(3));
    stock.quantity = Number(actualQuantity.toFixed(3));
    stock.unit = material.unit;

    const opname = {
      id: createSequentialId("opname", data.stock_opnames),
      outlet_id: outletId,
      material_id: materialId,
      system_quantity: systemQuantity,
      actual_quantity: stock.quantity,
      unit: material.unit,
      difference,
      status: getOpnameStatus(difference),
      note: getOpnameNote(difference),
      created_by: payload.created_by || data.users[0]?.id,
      opname_date: payload.opname_date || "2026-04-30"
    };

    data.stock_opnames.unshift(opname);
    rebuildIndexes();

    return clone(getOpnameRows("all").find((item) => item.id === opname.id));
  },

  async createStockOpnameBatch(payload) {
    await delay(520);
    const outletId = payload.outlet_id;
    const date = payload.opname_date;
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const outlet = outletMap.get(outletId);

    if (!outlet || !date || !rows.length) {
      throw new Error("Outlet, tanggal, dan baris opname wajib valid.");
    }

    const batchId = createOpnameBatchId();
    const createdRows = [];

    for (const row of rows) {
      const material = materialMap.get(row.material_id);
      const actualQuantity = Number(row.actual_quantity);
      const damageQuantity = Number(row.damage_quantity || 0);

      if (!material || Number.isNaN(actualQuantity) || actualQuantity < 0 || Number.isNaN(damageQuantity) || damageQuantity < 0) {
        throw new Error("Produk, qty fisik, dan qty rusak wajib valid.");
      }

      const stock = ensureStockRow(outletId, material.id);
      const incomingQuantity = roundQuantity(row.incoming_quantity);
      const transferQuantity = roundQuantity(row.transfer_quantity);
      const salesQuantity = roundQuantity(row.computed_sales_quantity);
      const deductedSalesQuantity = roundQuantity((getDailySalesMaterialTotals(outletId, date, { deductedOnly: true })).get(material.id) || 0);
      const fallbackOpeningQuantity = roundQuantity(Number(stock.quantity || 0) - incomingQuantity - transferQuantity + deductedSalesQuantity);
      const openingQuantity = roundQuantity(row.opening_quantity ?? fallbackOpeningQuantity);
      const realSystemQuantity = roundQuantity(openingQuantity + incomingQuantity + transferQuantity - damageQuantity - salesQuantity);
      const physicalQuantity = roundQuantity(actualQuantity);
      const difference = roundQuantity(realSystemQuantity - physicalQuantity);
      const unitPrice = Number(row.unit_price || getLatestMaterialPrice(material.id, outletId, date));
      const lossAmount = Math.max(difference, 0) * unitPrice;

      stock.quantity = physicalQuantity;
      stock.unit = material.unit;

      const opname = {
        id: createSequentialId("opname", data.stock_opnames),
        batch_id: batchId,
        outlet_id: outletId,
        material_id: material.id,
        opening_quantity: openingQuantity,
        incoming_quantity: incomingQuantity,
        transfer_quantity: transferQuantity,
        damage_quantity: roundQuantity(damageQuantity),
        computed_sales_quantity: salesQuantity,
        system_quantity: realSystemQuantity,
        actual_quantity: physicalQuantity,
        unit: material.unit,
        unit_price: unitPrice,
        difference,
        status: getOpnameStatus(difference),
        loss_amount: lossAmount,
        note: getOpnameNote(difference),
        created_by: payload.created_by || data.users[0]?.id,
        opname_date: date
      };

      data.stock_opnames.unshift(opname);
      createdRows.push(opname);
    }

    rebuildIndexes();

    return clone({
      batch_id: batchId,
      outlet: outletMap.get(outletId),
      opname_date: date,
      rows: getOpnameRows("all").filter((item) => item.batch_id === batchId),
      total_items: createdRows.length,
      total_loss_amount: createdRows.reduce((total, item) => total + Number(item.loss_amount || 0), 0)
    });
  },

  getStaticData() {
    return data;
  },

  getProductPrice
};
