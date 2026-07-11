function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function metadataOf(row) {
  return parseObject(row?.metadata_json || row?.metadataJson || row?.metadata || row?.meta);
}

function firstText(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function normalizedText(value) {
  return String(value || "").trim().toLowerCase();
}

function buildMap(items = []) {
  return new Map(asArray(items).filter((item) => item?.id).map((item) => [item.id, item]));
}

function userNameOf(user) {
  return firstText(user?.name, user?.full_name, user?.fullName, user?.username, user?.email);
}

function productIdOf(item) {
  const metadata = metadataOf(item);
  return firstText(
    item?.product?.id,
    item?.product_id,
    item?.productId,
    item?.menu_id,
    item?.menuId,
    metadata.product?.id,
    metadata.product_id,
    metadata.productId,
    metadata.menu_id,
    metadata.menuId
  );
}

function productNameOf(item, product) {
  const metadata = metadataOf(item);
  return firstText(
    product?.name,
    product?.product_name,
    item?.product?.name,
    item?.product?.product_name,
    item?.product_name,
    item?.productName,
    item?.menu_name,
    item?.menuName,
    item?.name,
    metadata.product?.name,
    metadata.product?.product_name,
    metadata.product_name,
    metadata.productName,
    metadata.menu_name,
    metadata.menuName
  );
}

function normalizeTransactionItem(item, productMap) {
  const productId = productIdOf(item);
  const product = productMap.get(productId) || item?.product || metadataOf(item).product || null;
  const productName = productNameOf(item, product);

  return {
    ...item,
    product_id: productId || item?.product_id,
    product: product ? { ...product, name: productName || product.name } : item?.product,
    product_name: productName || item?.product_name || item?.productName || ""
  };
}

function tableNumberOf(table) {
  return firstText(table?.number, table?.table_number, table?.tableNumber, table?.name, table?.label);
}

function buildTableIndexes(tables = []) {
  const byId = buildMap(tables);
  const byOutletAndNumber = new Map();
  const byNumber = new Map();
  const duplicateNumbers = new Set();

  for (const table of asArray(tables)) {
    const number = normalizedText(tableNumberOf(table));
    const outletId = firstText(table?.outlet_id, table?.outlet?.id);
    if (!number) continue;

    if (outletId) {
      byOutletAndNumber.set(`${outletId}:${number}`, table);
    }

    if (byNumber.has(number)) {
      duplicateNumbers.add(number);
    } else {
      byNumber.set(number, table);
    }
  }

  for (const number of duplicateNumbers) {
    byNumber.delete(number);
  }

  return { byId, byOutletAndNumber, byNumber };
}

function tableInfoOf(transaction) {
  const metadata = metadataOf(transaction);
  const metadataTable = metadata.table && typeof metadata.table === "object" ? metadata.table : {};
  const table = transaction?.table && typeof transaction.table === "object" ? transaction.table : {};
  const tableId = firstText(
    table.id,
    transaction?.table_id,
    transaction?.tableId,
    transaction?.meja_id,
    transaction?.mejaId,
    metadataTable.id,
    metadata.table_id,
    metadata.tableId,
    metadata.meja_id,
    metadata.mejaId
  );
  const tableNumber = firstText(
    tableNumberOf(table),
    transaction?.table_number,
    transaction?.tableNumber,
    transaction?.table_no,
    transaction?.tableNo,
    transaction?.nomor_meja,
    transaction?.nomorMeja,
    transaction?.meja,
    metadata.table_number,
    metadata.tableNumber,
    metadata.table_no,
    metadata.tableNo,
    metadata.nomor_meja,
    metadata.nomorMeja,
    metadata.meja,
    tableNumberOf(metadataTable)
  );

  return { tableId, tableNumber };
}

function resolveTable(transaction, tableIndexes) {
  const { tableId, tableNumber } = tableInfoOf(transaction);
  const outletId = firstText(transaction?.outlet_id, transaction?.outlet?.id);
  const normalizedNumber = normalizedText(tableNumber);
  const existingTable = transaction?.table && typeof transaction.table === "object" ? transaction.table : null;

  if (existingTable?.id || tableNumberOf(existingTable)) return existingTable;
  if (tableId && tableIndexes.byId.has(tableId)) return tableIndexes.byId.get(tableId);
  if (outletId && normalizedNumber && tableIndexes.byOutletAndNumber.has(`${outletId}:${normalizedNumber}`)) {
    return tableIndexes.byOutletAndNumber.get(`${outletId}:${normalizedNumber}`);
  }
  if (normalizedNumber && tableIndexes.byNumber.has(normalizedNumber)) return tableIndexes.byNumber.get(normalizedNumber);
  if (tableId || tableNumber) {
    return {
      id: tableId || undefined,
      outlet_id: outletId || undefined,
      number: tableNumber || tableId
    };
  }
  return null;
}

function cashierInfoOf(transaction) {
  const metadata = metadataOf(transaction);
  const metadataCashier = metadata.cashier && typeof metadata.cashier === "object" ? metadata.cashier : {};
  const cashier = transaction?.cashier && typeof transaction.cashier === "object" ? transaction.cashier : {};
  const cashierId = firstText(
    cashier.id,
    transaction?.cashier_id,
    transaction?.cashierId,
    transaction?.user_id,
    transaction?.userId,
    transaction?.created_by,
    transaction?.createdBy,
    metadataCashier.id,
    metadata.cashier_id,
    metadata.cashierId,
    metadata.user_id,
    metadata.userId,
    metadata.created_by,
    metadata.createdBy
  );
  const cashierName = firstText(
    userNameOf(cashier),
    transaction?.cashier_name,
    transaction?.cashierName,
    transaction?.kasir,
    metadata.cashier_name,
    metadata.cashierName,
    metadata.kasir,
    userNameOf(metadataCashier)
  );

  return { cashierId, cashierName };
}

function resolveCashier(transaction, userMap) {
  const { cashierId, cashierName } = cashierInfoOf(transaction);
  const existingCashier = transaction?.cashier && typeof transaction.cashier === "object" ? transaction.cashier : null;

  if (existingCashier?.id || userNameOf(existingCashier)) return existingCashier;
  if (cashierId && userMap.has(cashierId)) return userMap.get(cashierId);
  if (cashierId || cashierName) {
    return {
      id: cashierId || undefined,
      name: cashierName || cashierId
    };
  }
  return null;
}

function normalizePayment(transaction) {
  const payments = normalizePayments(transaction);
  if (payments.length) return payments[0];

  const payment = transaction?.payment && typeof transaction.payment === "object" ? transaction.payment : null;
  return payment || transaction?.payment;
}

function normalizePaymentRow(row, transaction) {
  const metadata = metadataOf(row);
  const method = firstText(
    row?.method,
    row?.payment_method,
    row?.paymentMethod,
    row?.payment_type,
    row?.paymentType,
    metadata.payment_method,
    metadata.paymentMethod,
    metadata.payment_type,
    metadata.paymentType
  );

  if (!method) return null;

  return {
    ...row,
    method,
    amount: Number(row?.amount ?? row?.paid_amount ?? row?.paidAmount ?? transaction?.total ?? 0),
    change_amount: Number(row?.change_amount ?? row?.changeAmount ?? 0)
  };
}

function paymentRowsFromBreakdown(breakdown) {
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) return [];
  return Object.entries(breakdown).map(([method, amount]) => ({ method, amount }));
}

function normalizePayments(transaction) {
  const metadata = metadataOf(transaction);
  const payment = transaction?.payment && typeof transaction.payment === "object" ? transaction.payment : null;
  const submittedPayments = asArray(
    transaction?.payments ||
      transaction?.payment_details ||
      transaction?.paymentDetails ||
      transaction?.transaction_payments ||
      transaction?.transactionPayments ||
      paymentRowsFromBreakdown(transaction?.payment_breakdown || transaction?.paymentBreakdown || metadata.payment_breakdown || metadata.paymentBreakdown)
  )
    .map((row) => normalizePaymentRow(row, transaction))
    .filter(Boolean);

  if (submittedPayments.length) return submittedPayments;

  const method = firstText(
    payment?.method,
    transaction?.payment_method,
    transaction?.paymentMethod,
    transaction?.payment_type,
    transaction?.paymentType,
    metadata.payment_method,
    metadata.paymentMethod,
    metadata.payment_type,
    metadata.paymentType
  );

  if (!method) return [];

  return [{
    ...payment,
    method,
    amount: Number(payment?.amount ?? transaction?.paid_amount ?? transaction?.paidAmount ?? transaction?.total ?? 0),
    change_amount: Number(payment?.change_amount ?? transaction?.change_amount ?? transaction?.changeAmount ?? 0)
  }];
}

function normalizeTransaction(transaction, references = {}) {
  const productMap = references.productMap || buildMap(references.products);
  const tableIndexes = references.tableIndexes || buildTableIndexes(references.tables);
  const outletMap = references.outletMap || buildMap(references.outlets);
  const userMap = references.userMap || buildMap(references.users);
  const table = resolveTable(transaction, tableIndexes);
  const { tableId } = tableInfoOf(transaction);
  const cashier = resolveCashier(transaction, userMap);
  const { cashierId } = cashierInfoOf(transaction);
  const items = asArray(transaction?.items || transaction?.transaction_items || transaction?.details).map((item) =>
    normalizeTransactionItem(item, productMap)
  );
  const outletId = firstText(transaction?.outlet_id, transaction?.outlet?.id);

  return {
    ...transaction,
    outlet: transaction?.outlet || outletMap.get(outletId),
    cashier_id: cashierId || cashier?.id || transaction?.cashier_id,
    cashier,
    table_id: tableId || table?.id || transaction?.table_id,
    table,
    payment: normalizePayment(transaction),
    payments: normalizePayments(transaction),
    items
  };
}

function normalizeSalesByProduct(rows = [], productMap) {
  return asArray(rows).map((row) => {
    const productId = firstText(row?.product?.id, row?.product_id, row?.productId);
    const product = productMap.get(productId) || row?.product || null;
    const productName = firstText(product?.name, row?.product?.name, row?.product_name, row?.productName, row?.name);

    return {
      ...row,
      product_id: productId || row?.product_id,
      product: product ? { ...product, name: productName || product.name } : row?.product,
      product_name: productName || row?.product_name || ""
    };
  });
}

export function normalizeReportData(reportData = {}, masterData = {}) {
  const products = [...asArray(reportData?.products), ...asArray(masterData?.products)];
  const tables = [...asArray(reportData?.tables), ...asArray(masterData?.tables)];
  const outlets = [...asArray(reportData?.outlets), ...asArray(masterData?.outlets)];
  const users = [
    ...asArray(reportData?.users),
    ...asArray(reportData?.cashiers),
    ...asArray(masterData?.users),
    ...asArray(masterData?.cashiers)
  ];
  const productMap = buildMap(products);
  const tableIndexes = buildTableIndexes(tables);
  const outletMap = buildMap(outlets);
  const userMap = buildMap(users);
  const transactions = asArray(reportData?.transactions).map((transaction) =>
    normalizeTransaction(transaction, { productMap, tableIndexes, outletMap, userMap })
  );

  return {
    ...reportData,
    transactions,
    transaction_edit_products: asArray(masterData?.products),
    sales_by_product: normalizeSalesByProduct(reportData?.sales_by_product, productMap)
  };
}

function transactionMatchesTable(transaction, table, uniqueTableByNumber) {
  const tableId = firstText(table?.id);
  const outletId = firstText(table?.outlet_id, table?.outlet?.id);
  const tableNumber = normalizedText(tableNumberOf(table));
  const transactionTableId = firstText(transaction?.table?.id, transaction?.table_id, transaction?.tableId);
  const transactionOutletId = firstText(transaction?.outlet_id, transaction?.outlet?.id);
  const transactionTableNumber = normalizedText(tableNumberOf(transaction?.table) || tableInfoOf(transaction).tableNumber);

  if (tableId && transactionTableId && tableId === transactionTableId) return true;
  if (!tableNumber || !transactionTableNumber || tableNumber !== transactionTableNumber) return false;
  if (outletId && transactionOutletId) return outletId === transactionOutletId;

  return uniqueTableByNumber.get(tableNumber)?.id === tableId;
}

export function normalizeTableRowsWithTransactions(tables = [], transactions = [], references = {}) {
  const outletsById = buildMap(references.outlets);
  const tableIndexes = buildTableIndexes(tables);
  const userMap = buildMap(references.users);
  const normalizedTransactions = asArray(transactions)
    .map((transaction) => normalizeTransaction(transaction, { tables, outlets: references.outlets || [], userMap }))
    .sort((a, b) => new Date(b.transaction_date || b.created_at || 0) - new Date(a.transaction_date || a.created_at || 0));

  return asArray(tables).map((table) => {
    const outletId = firstText(table?.outlet_id, table?.outlet?.id);
    const matchedTransactions = normalizedTransactions.filter((transaction) =>
      transactionMatchesTable(transaction, table, tableIndexes.byNumber)
    );
    const existingTransactions = asArray(table?.transactions);
    const transactionsForTable = matchedTransactions.length ? matchedTransactions : existingTransactions;
    const computedSalesTotal = transactionsForTable.reduce((total, transaction) => total + Number(transaction?.total || 0), 0);
    const existingTransactionCount = Number(table?.transaction_count ?? table?.transactionCount ?? 0);
    const existingSalesTotal = Number(table?.sales_total ?? table?.salesTotal ?? 0);

    return {
      ...table,
      outlet: table?.outlet || outletsById.get(outletId),
      transactions: transactionsForTable,
      transaction_count: Math.max(existingTransactionCount, transactionsForTable.length),
      sales_total: existingSalesTotal || computedSalesTotal
    };
  });
}

export function getTransactionItemProductLabel(item) {
  const productName = productNameOf(item, item?.product);
  if (productName) return productName;
  const productId = productIdOf(item);
  return productId ? `Produk tidak ditemukan (${productId})` : "-";
}

export function getTransactionTableLabel(transaction) {
  return tableNumberOf(transaction?.table) || tableInfoOf(transaction).tableNumber || "-";
}

export function getTransactionCashierLabel(transaction) {
  return userNameOf(transaction?.cashier) || cashierInfoOf(transaction).cashierName || cashierInfoOf(transaction).cashierId || "-";
}
