import '../models/app_models.dart';
import '../services/api_client.dart';
import '../utils/formatters.dart';

class PosReportSnapshot {
  const PosReportSnapshot({
    required this.revenue,
    required this.transactionCount,
    required this.discountTotal,
    required this.expenseTotal,
    required this.netTotal,
    required this.paymentTotals,
    required this.accountingProfitLoss,
    required this.transactions,
    required this.expenses,
  });

  final int revenue;
  final int transactionCount;
  final int discountTotal;
  final int expenseTotal;
  final int netTotal;
  final Map<String, int> paymentTotals;
  int get cashTotal => paymentTotals['cash'] ?? 0;
  int get transferTotal => paymentTotals['transfer'] ?? 0;
  int get qrisTotal => paymentTotals['qris'] ?? 0;
  final AccountingReportSnapshot accountingProfitLoss;
  final List<PosTransaction> transactions;
  final List<PosExpense> expenses;

  factory PosReportSnapshot.fromJson(Map<String, dynamic> json) {
    final paymentTotals =
        Map<String, dynamic>.from(json['payment_totals'] ?? const {});
    final accountingJson = json['accounting_profit_loss'];
    final revenue = _toInt(json['revenue']);
    final discountTotal = _toInt(json['discount_total']);
    final expenseTotal = _toInt(json['expense_total']);
    final netTotal = _toInt(json['net_total']);
    return PosReportSnapshot(
      revenue: revenue,
      transactionCount: _toInt(json['transaction_count']),
      discountTotal: discountTotal,
      expenseTotal: expenseTotal,
      netTotal: netTotal,
      paymentTotals: paymentTotals.map(
        (key, value) => MapEntry(key.toString(), _toInt(value)),
      ),
      accountingProfitLoss: accountingJson is Map<String, dynamic>
          ? AccountingReportSnapshot.fromJson(accountingJson)
          : AccountingReportSnapshot.fromSimple(
              revenue: revenue,
              discountTotal: discountTotal,
              expenseTotal: expenseTotal,
              netTotal: netTotal,
            ),
      transactions: List<Map<String, dynamic>>.from(json['transactions'] ?? [])
          .map(PosTransaction.fromJson)
          .toList(),
      expenses: List<Map<String, dynamic>>.from(json['expenses'] ?? [])
          .map(PosExpense.fromJson)
          .toList(),
    );
  }
}

class AccountingReportSnapshot {
  const AccountingReportSnapshot({
    required this.title,
    required this.from,
    required this.to,
    required this.columns,
    required this.rows,
    required this.summary,
  });

  final String title;
  final String from;
  final String to;
  final List<String> columns;
  final List<AccountingReportRow> rows;
  final Map<String, int> summary;

  bool get isEmpty => rows.isEmpty;

  factory AccountingReportSnapshot.fromJson(Map<String, dynamic> json) {
    return AccountingReportSnapshot(
      title: json['title']?.toString() ?? 'Laba & Rugi',
      from: json['from']?.toString() ?? '',
      to: json['to']?.toString() ?? '',
      columns: List<dynamic>.from(
              json['columns'] ?? const ['Description', 'Total', '% of Income'])
          .map((item) => item.toString())
          .toList(),
      rows: List<Map<String, dynamic>>.from(json['rows'] ?? const [])
          .map(AccountingReportRow.fromJson)
          .toList(),
      summary: Map<String, dynamic>.from(json['summary'] ?? const {}).map(
        (key, value) => MapEntry(key.toString(), _toInt(value)),
      ),
    );
  }

  factory AccountingReportSnapshot.fromSimple({
    required int revenue,
    required int discountTotal,
    required int expenseTotal,
    required int netTotal,
  }) {
    final incomeBase = revenue == 0 ? 1 : revenue;
    return AccountingReportSnapshot(
      title: 'Laba & Rugi',
      from: '',
      to: '',
      columns: const ['Description', 'Total', '% of Income'],
      rows: [
        const AccountingReportRow(
          description: 'Income',
          total: 0,
          percentOfIncome: 0,
          kind: 'section',
        ),
        AccountingReportRow(
          description: 'Pendapatan Usaha',
          total: revenue + discountTotal,
          percentOfIncome: 100,
          level: 1,
        ),
        AccountingReportRow(
          description: 'Diskon Penjualan',
          total: -discountTotal,
          percentOfIncome: (-discountTotal / incomeBase) * 100,
          level: 1,
        ),
        AccountingReportRow(
          description: 'Total Income',
          total: revenue,
          percentOfIncome: 100,
          kind: 'total',
          bold: true,
        ),
        const AccountingReportRow(
          description: 'Expense',
          total: 0,
          percentOfIncome: 0,
          kind: 'section',
        ),
        AccountingReportRow(
          description: 'Biaya Operasional',
          total: expenseTotal,
          percentOfIncome: (expenseTotal / incomeBase) * 100,
          level: 1,
        ),
        AccountingReportRow(
          description: 'Total Expense',
          total: expenseTotal,
          percentOfIncome: (expenseTotal / incomeBase) * 100,
          kind: 'total',
          bold: true,
        ),
        AccountingReportRow(
          description: 'NET INCOME',
          total: netTotal,
          percentOfIncome: (netTotal / incomeBase) * 100,
          kind: 'grand_total',
          bold: true,
        ),
      ],
      summary: {
        'revenue': revenue,
        'discounts': discountTotal,
        'expense_total': expenseTotal,
        'net_income': netTotal,
      },
    );
  }
}

class AccountingReportRow {
  const AccountingReportRow({
    required this.description,
    required this.total,
    required this.percentOfIncome,
    this.level = 0,
    this.kind = 'account',
    this.bold = false,
    this.accountCode,
  });

  final String description;
  final int total;
  final double percentOfIncome;
  final int level;
  final String kind;
  final bool bold;
  final String? accountCode;

  bool get isSection => kind == 'section';
  bool get isTotal => kind == 'total' || kind == 'grand_total';
  bool get isGrandTotal => kind == 'grand_total';
  bool get emphasized => bold || isTotal;
  bool get isBusinessIncome {
    final normalizedDescription = description
        .replaceFirst(RegExp(r'^\s*\[[^\]]+\]\s*'), '')
        .trim()
        .toLowerCase();
    return accountCode == '4001' || normalizedDescription == 'pendapatan usaha';
  }

  bool get showsAccountDetails =>
      accountCode != null &&
      accountCode!.isNotEmpty &&
      !isSection &&
      !isTotal &&
      !isBusinessIncome;

  factory AccountingReportRow.fromJson(Map<String, dynamic> json) {
    return AccountingReportRow(
      description: json['description']?.toString() ?? '-',
      total: _toInt(json['total']),
      percentOfIncome: _toDouble(json['percent_of_income'] ?? json['percent']),
      level: _toInt(json['level']),
      kind: json['kind']?.toString() ?? 'account',
      bold: json['bold'] == true,
      accountCode: json['account_code']?.toString(),
    );
  }
}

class AccountDetailSnapshot {
  const AccountDetailSnapshot({
    required this.accountCode,
    required this.accountName,
    required this.total,
    required this.rows,
  });

  final String accountCode;
  final String accountName;
  final int total;
  final List<AccountDetailRow> rows;

  factory AccountDetailSnapshot.fromJson(Map<String, dynamic> json) {
    final account = Map<String, dynamic>.from(json['account'] ?? const {});
    return AccountDetailSnapshot(
      accountCode:
          account['code']?.toString() ?? json['account_code']?.toString() ?? '',
      accountName: account['name']?.toString() ??
          json['account_name']?.toString() ??
          '-',
      total: _toInt(json['total_report'] ?? json['total']),
      rows: List<Map<String, dynamic>>.from(json['rows'] ?? const [])
          .map(AccountDetailRow.fromJson)
          .toList(),
    );
  }
}

class AccountDetailRow {
  const AccountDetailRow({
    required this.date,
    required this.sourceType,
    required this.reference,
    required this.outlet,
    required this.description,
    required this.amount,
    required this.signedAmount,
    required this.status,
  });

  final String date;
  final String sourceType;
  final String reference;
  final String outlet;
  final String description;
  final int amount;
  final int signedAmount;
  final String status;

  factory AccountDetailRow.fromJson(Map<String, dynamic> json) {
    return AccountDetailRow(
      date: json['date']?.toString() ?? '',
      sourceType: json['source_type']?.toString() ?? '-',
      reference: json['reference']?.toString() ?? '-',
      outlet: json['outlet']?.toString() ?? '-',
      description: json['description']?.toString() ?? '-',
      amount: _toInt(json['amount']),
      signedAmount: _toInt(json['signed_amount'] ?? json['amount']),
      status: json['status']?.toString() ?? '-',
    );
  }
}

class PosRepository {
  const PosRepository();

  Future<List<PosTransaction>> getHistory({
    required String outletId,
    required DateTime from,
    required DateTime to,
    String paymentMethod = 'all',
  }) async {
    final response = await ApiClient.instance.get('/pos/history', query: {
      'outletId': outletId,
      'from': toApiDateString(from),
      'to': toApiDateString(to),
      'paymentMethod': paymentMethod,
    });
    return List<Map<String, dynamic>>.from(response)
        .map(PosTransaction.fromJson)
        .toList();
  }

  Future<PosReportSnapshot> getReport({
    required String outletId,
    required DateTime from,
    required DateTime to,
  }) async {
    final response = Map<String, dynamic>.from(
      await ApiClient.instance.get('/pos/reports', query: {
        'outletId': outletId,
        'from': toApiDateString(from),
        'to': toApiDateString(to),
      }),
    );
    return PosReportSnapshot.fromJson(response);
  }

  Future<AccountDetailSnapshot> getAccountDetail({
    required String outletId,
    required String report,
    required String accountCode,
    required DateTime from,
    required DateTime to,
  }) async {
    final response = Map<String, dynamic>.from(
      await ApiClient.instance.get('/pos/reports/account-detail', query: {
        'outletId': outletId,
        'report': report,
        'accountCode': accountCode,
        'from': toApiDateString(from),
        'to': toApiDateString(to),
      }),
    );
    return AccountDetailSnapshot.fromJson(response);
  }

  Future<List<PosExpense>> getExpenses({
    required String outletId,
    required DateTime from,
    required DateTime to,
  }) async {
    final response = await ApiClient.instance.get('/pos/expenses', query: {
      'outletId': outletId,
      'from': toApiDateString(from),
      'to': toApiDateString(to),
    });
    return List<Map<String, dynamic>>.from(response)
        .map(PosExpense.fromJson)
        .toList();
  }

  Future<List<Discount>> getDiscounts({
    required String outletId,
  }) async {
    final response = await ApiClient.instance.get('/pos/discounts', query: {
      'outletId': outletId,
    });
    return List<Map<String, dynamic>>.from(response)
        .map(Discount.fromJson)
        .toList();
  }

  Future<Set<String>> getProductFavorites({
    required String outletId,
  }) async {
    final response = await ApiClient.instance
        .get('/pos/product-favorites', query: {'outletId': outletId});
    final map = Map<String, dynamic>.from(response is Map ? response : {});
    return List<dynamic>.from(map['product_ids'] ?? map['productIds'] ?? [])
        .map((id) => id.toString())
        .where((id) => id.isNotEmpty)
        .toSet();
  }

  Future<Set<String>> updateProductFavorites({
    required String outletId,
    required Set<String> productIds,
  }) async {
    final response =
        await ApiClient.instance.put('/pos/product-favorites', body: {
      'outlet_id': outletId,
      'product_ids': productIds.toList(),
    });
    final map = Map<String, dynamic>.from(response is Map ? response : {});
    return List<dynamic>.from(map['product_ids'] ?? map['productIds'] ?? [])
        .map((id) => id.toString())
        .where((id) => id.isNotEmpty)
        .toSet();
  }

  Future<Discount> createDiscount({
    required String outletId,
    required String reportPin,
    required String name,
    required String type,
    required num value,
    required DateTime startsAt,
    required DateTime endsAt,
    required String status,
  }) async {
    final response = Map<String, dynamic>.from(
      await ApiClient.instance.post('/pos/discounts', body: {
        'outletId': outletId,
        'report_pin': reportPin,
        'name': name,
        'type': type,
        'value': value,
        'starts_at': toApiDateString(startsAt),
        'ends_at': toApiDateString(endsAt),
        'status': status,
      }),
    );
    return Discount.fromJson(response);
  }

  Future<Discount> updateDiscount({
    required String id,
    required String outletId,
    required String reportPin,
    required String name,
    required String type,
    required num value,
    required DateTime startsAt,
    required DateTime endsAt,
    required String status,
  }) async {
    final response = Map<String, dynamic>.from(
      await ApiClient.instance.put('/pos/discounts/$id', body: {
        'outletId': outletId,
        'report_pin': reportPin,
        'name': name,
        'type': type,
        'value': value,
        'starts_at': toApiDateString(startsAt),
        'ends_at': toApiDateString(endsAt),
        'status': status,
      }),
    );
    return Discount.fromJson(response);
  }

  Future<List<MaterialStockSnapshot>> getMaterialStocks({
    required List<String> outletIds,
    List<String> materialIds = const [],
  }) async {
    final query = <String, String>{
      'outletIds': outletIds.where((id) => id.isNotEmpty).join(','),
      if (materialIds.isNotEmpty)
        'materialIds': materialIds.where((id) => id.isNotEmpty).join(','),
    };
    final response = await ApiClient.instance.get(
      '/pos/material-stocks',
      query: query,
    );
    return List<Map<String, dynamic>>.from(response)
        .map(MaterialStockSnapshot.fromJson)
        .toList();
  }

  Future<List<PurchaseBatch>> getPurchases({
    required String outletId,
    required DateTime from,
    required DateTime to,
  }) async {
    final response = await ApiClient.instance.get('/pos/purchases', query: {
      'outletId': outletId,
      'from': toApiDateString(from),
      'to': toApiDateString(to),
    });
    return List<Map<String, dynamic>>.from(response)
        .map(PurchaseBatch.fromJson)
        .toList();
  }

  Future<PurchaseBatch> createPurchaseBatch(PurchaseBatch batch) async {
    final response = Map<String, dynamic>.from(await ApiClient.instance
        .post('/pos/purchase-batches', body: batch.toJson()));
    return PurchaseBatch.fromJson(response).copyWith(synced: true);
  }

  Future<PurchaseBatch> updatePurchaseBatch(PurchaseBatch batch) async {
    final response = Map<String, dynamic>.from(await ApiClient.instance
        .put('/pos/purchases/${batch.id}', body: batch.toJson()));
    return PurchaseBatch.fromJson(response).copyWith(synced: true);
  }

  Future<List<TransferRequest>> getTransfers({
    required String outletId,
    required DateTime from,
    required DateTime to,
  }) async {
    final response = await ApiClient.instance.get('/pos/transfers', query: {
      'outletId': outletId,
      'from': toApiDateString(from),
      'to': toApiDateString(to),
    });
    return List<Map<String, dynamic>>.from(response)
        .map(TransferRequest.fromJson)
        .toList();
  }

  Future<TransferRequest> createTransferRequest(
      TransferRequest transfer) async {
    final response = Map<String, dynamic>.from(await ApiClient.instance
        .post('/pos/transfer-requests', body: transfer.toJson()));
    return TransferRequest.fromJson(response).copyWith(synced: true);
  }

  Future<List<StockOpnameWorksheetRow>> getStockOpnameWorksheet({
    required String outletId,
    required DateTime date,
  }) async {
    final response = Map<String, dynamic>.from(
      await ApiClient.instance.get('/pos/stock-opname-worksheet', query: {
        'outletId': outletId,
        'date': toApiDateString(date),
      }),
    );
    return List<Map<String, dynamic>>.from(response['rows'] ?? [])
        .map(StockOpnameWorksheetRow.fromJson)
        .toList();
  }

  Future<List<StockOpnameRequest>> getStockOpnameRequests({
    required String outletId,
    required DateTime from,
    required DateTime to,
  }) async {
    final response =
        await ApiClient.instance.get('/pos/stock-opname-requests', query: {
      'outletId': outletId,
      'from': toApiDateString(from),
      'to': toApiDateString(to),
    });
    return List<Map<String, dynamic>>.from(response)
        .map(StockOpnameRequest.fromJson)
        .toList();
  }

  Future<StockOpnameRequest> createStockOpnameRequest(
      StockOpnameRequest request) async {
    final response = Map<String, dynamic>.from(await ApiClient.instance.post(
      '/pos/stock-opname-requests',
      body: request.toJson(),
    ));
    return StockOpnameRequest.fromJson(response).copyWith(synced: true);
  }

  Future<StockOpnameRequest> updateStockOpnameRequest(
      StockOpnameRequest request) async {
    final response = Map<String, dynamic>.from(await ApiClient.instance.put(
      '/pos/stock-opname-requests/${request.id}',
      body: request.toJson(),
    ));
    return StockOpnameRequest.fromJson(response).copyWith(synced: true);
  }

  Future<List<Customer>> getCustomers({
    required String outletId,
    String keyword = '',
  }) async {
    final response = await ApiClient.instance.get('/pos/customers', query: {
      'outletId': outletId,
      'keyword': keyword,
    });
    return List<Map<String, dynamic>>.from(response)
        .map(Customer.fromJson)
        .toList();
  }

  Future<Customer> createCustomer({
    required String outletId,
    required String name,
    String? phone,
  }) async {
    final response = Map<String, dynamic>.from(
      await ApiClient.instance.post('/pos/customers', body: {
        'outletId': outletId,
        'name': name,
        'phone': phone,
      }),
    );
    return Customer.fromJson(response);
  }
}

String toApiDateString(DateTime value) {
  final date = dateOnly(value);
  final month = date.month.toString().padLeft(2, '0');
  final day = date.day.toString().padLeft(2, '0');
  return '${date.year}-$month-$day';
}

int _toInt(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.round();
  return int.tryParse(value?.toString() ?? '') ?? 0;
}

double _toDouble(dynamic value) {
  if (value is double) return value;
  if (value is num) return value.toDouble();
  return double.tryParse(value?.toString() ?? '') ?? 0;
}
