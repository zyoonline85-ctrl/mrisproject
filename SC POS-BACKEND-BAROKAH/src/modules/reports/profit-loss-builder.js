function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function percentOfIncome(amount, income) {
  if (!income) return 0;
  return Number(((numberValue(amount) / numberValue(income)) * 100).toFixed(2));
}

function reportRow(description, total, income, options = {}) {
  return {
    description,
    total: Math.round(numberValue(total)),
    percent_of_income: percentOfIncome(total, income),
    level: options.level || 0,
    kind: options.kind || "account",
    bold: Boolean(options.bold),
    account_code: options.account_code || null,
    payment_method_code: options.payment_method_code || null
  };
}

function buildSimpleAccountingProfitLoss({
  rows = [],
  approvedPurchases = [],
  approvedExpenses = [],
  paymentMethods = [],
  paymentTotals = {},
  from,
  to,
  outletId = "all"
} = {}) {
  const totalIncome = rows.reduce((total, transaction) => total + numberValue(transaction.total), 0);
  const discount = rows.reduce((total, transaction) => total + numberValue(transaction.discount), 0);
  const grossRevenue = totalIncome + discount;
  const purchaseItems = approvedPurchases.flatMap((purchase) => purchase.items || []);
  const cogs = purchaseItems
    .filter((item) => (item.material_type || item.material?.type || "hpp") !== "biaya")
    .reduce((total, item) => total + numberValue(item.subtotal), 0);
  const purchaseExpense = purchaseItems
    .filter((item) => (item.material_type || item.material?.type || "hpp") === "biaya")
    .reduce((total, item) => total + numberValue(item.subtotal), 0);
  const expense = approvedExpenses.reduce((total, item) => total + numberValue(item.amount), 0) + purchaseExpense;
  const netIncome = totalIncome - cogs - expense;

  return {
    title: "Laba & Rugi",
    from: from || null,
    to: to || null,
    outlet_id: outletId,
    columns: ["Description", "Total", "% of Income"],
    rows: [
      reportRow("Income", 0, totalIncome, { kind: "section" }),
      reportRow("Pendapatan Usaha", grossRevenue, totalIncome, { level: 1, account_code: "4001" }),
      ...paymentMethods.map((method) =>
        reportRow(method.name || method.code || "Metode Pembayaran", paymentTotals[method.code] || 0, totalIncome, {
          level: 2,
          kind: "payment_method",
          payment_method_code: method.code || null
        })
      ),
      reportRow("Diskon Penjualan", -discount, totalIncome, { level: 1 }),
      reportRow("Total Income", totalIncome, totalIncome, { kind: "total", bold: true }),
      reportRow("Cost of Goods Sold", 0, totalIncome, { kind: "section" }),
      reportRow("Harga Pokok Penjualan", cogs, totalIncome, { level: 1, account_code: "5002" }),
      reportRow("Total Cost of Goods Sold", cogs, totalIncome, { kind: "total", bold: true }),
      reportRow("Expense", 0, totalIncome, { kind: "section" }),
      reportRow("Biaya / Expense", expense, totalIncome, { level: 1, account_code: "6000" }),
      reportRow("Total Expense", expense, totalIncome, { kind: "total", bold: true }),
      reportRow("NET INCOME", netIncome, totalIncome, { kind: "grand_total", bold: true })
    ],
    summary: {
      income: totalIncome,
      discounts: discount,
      cogs,
      expense,
      net_income: netIncome
    }
  };
}

module.exports = {
  buildSimpleAccountingProfitLoss,
  percentOfIncome
};
