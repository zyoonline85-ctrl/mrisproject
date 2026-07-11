function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function buildDashboardSalesByOutlet({ outlets = [], transactions = [] } = {}) {
  const rowsByOutlet = new Map();

  outlets
    .filter((outlet) => outlet.status !== "inactive")
    .forEach((outlet) => {
      rowsByOutlet.set(outlet.id, {
        outlet_id: outlet.id,
        outlet_name: outlet.name || "-",
        outlet,
        total: 0,
        transaction_count: 0
      });
    });

  transactions
    .filter((transaction) => transaction.status === "paid")
    .forEach((transaction) => {
      const current = rowsByOutlet.get(transaction.outlet_id);
      if (!current) return;
      current.total += numberValue(transaction.total);
      current.transaction_count += 1;
    });

  const totalRevenue = [...rowsByOutlet.values()].reduce((total, row) => total + row.total, 0);

  return [...rowsByOutlet.values()]
    .sort((left, right) => right.total - left.total || left.outlet_name.localeCompare(right.outlet_name, "id-ID"))
    .map((row, index) => ({
      ...row,
      average_transaction: row.transaction_count ? Math.round(row.total / row.transaction_count) : 0,
      percentage: totalRevenue ? Number(((row.total / totalRevenue) * 100).toFixed(2)) : 0,
      rank: index + 1
    }));
}

module.exports = {
  buildDashboardSalesByOutlet
};
