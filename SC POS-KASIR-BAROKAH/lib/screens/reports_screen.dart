import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/app_models.dart';
import '../providers/auth_provider.dart';
import '../providers/catalog_provider.dart';
import '../providers/outlet_provider.dart';
import '../providers/pos_report_provider.dart';
import '../providers/stock_opname_provider.dart';
import '../repositories/pos_repository.dart';
import '../services/profit_loss_pdf_service.dart';
import '../services/logistic_penalty_pdf_service.dart';
import '../services/activity_log_service.dart';
import '../theme/app_colors.dart';
import '../utils/formatters.dart';
import '../widgets/backend_loading.dart';
import 'stock_opname_screen.dart';

class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  late DateTime from;
  late DateTime to;
  late DateTime _draftFrom;
  late DateTime _draftTo;
  bool _showInputForm = false;
  bool _downloadingPdf = false;
  String? _lastFetchKey;

  @override
  void initState() {
    super.initState();
    final today = dateOnly(DateTime.now());
    to = today;
    from = today.subtract(const Duration(days: 30));
    _draftFrom = from;
    _draftTo = to;
  }

  void _fetchIfNeeded(String outletId) {
    final key =
        '$outletId-${dateOnly(from).toIso8601String()}-${dateOnly(to).toIso8601String()}';
    if (_lastFetchKey == key) return;
    _lastFetchKey = key;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      context.read<PosReportProvider>().fetchReport(
            outletId: outletId,
            from: from,
            to: to,
          );
    });
  }

  Future<void> _pickDate({required bool isFrom}) async {
    final initialDate = isFrom ? _draftFrom : _draftTo;
    final picked = await showDatePicker(
      context: context,
      initialDate: initialDate,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (picked == null) return;
    setState(() {
      final selected = dateOnly(picked);
      if (isFrom) {
        _draftFrom = selected;
        if (_draftTo.isBefore(_draftFrom)) _draftTo = _draftFrom;
      } else {
        _draftTo = selected;
        if (_draftFrom.isAfter(_draftTo)) _draftFrom = _draftTo;
      }
    });
  }

  void _applyFilters() {
    if (_draftFrom.isAfter(_draftTo)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Tanggal dari tidak boleh lewat sampai.')),
      );
      const ActivityLogService().record(
        module: 'report',
        action: 'filter_apply',
        outcome: 'failed',
        description: 'Filter laporan gagal diterapkan.',
        metadata: {
          'from': _draftFrom.toIso8601String(),
          'to': _draftTo.toIso8601String()
        },
      );
      return;
    }
    setState(() {
      from = _draftFrom;
      to = _draftTo;
      _lastFetchKey = null;
    });
    const ActivityLogService().record(
      module: 'report',
      action: 'filter_apply',
      description: 'Menerapkan filter tanggal laporan.',
      metadata: {'from': from.toIso8601String(), 'to': to.toIso8601String()},
    );
  }

  @override
  Widget build(BuildContext context) {
    final outlet = context.watch<OutletProvider>().selectedOutlet!;
    final reportProvider = context.watch<PosReportProvider>();

    if (_showInputForm) {
      return StockOpnameScreen(
        isFormOnly: true,
        onCancel: () {
          setState(() {
            _showInputForm = false;
            _lastFetchKey = null; // Memicu fetch ulang rekap logistik
          });
        },
      );
    }

    _fetchIfNeeded(outlet.id);

    return Padding(
      padding: const EdgeInsets.all(8),
      child: Card(
        color: Colors.white,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const _Header(),
                  ElevatedButton.icon(
                    onPressed: () {
                      setState(() => _showInputForm = true);
                    },
                    icon: const Icon(Icons.add_rounded),
                    label: const Text('Tambahkan Laporan Logistik'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primaryTeal,
                      foregroundColor: Colors.white,
                      elevation: 1,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              _FilterBar(
                from: _draftFrom,
                to: _draftTo,
                onPickFrom: () => _pickDate(isFrom: true),
                onPickTo: () => _pickDate(isFrom: false),
                onApply: _applyFilters,
              ),
              const SizedBox(height: 12),
              if (reportProvider.errorMessage != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Text(
                    reportProvider.errorMessage!,
                    style: const TextStyle(
                      color: AppColors.danger,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              Expanded(
                child: reportProvider.loading
                    ? const BackendSkeleton(rows: 7)
                    : BackendLoadingOverlay(
                        loading: reportProvider.refreshing,
                        child: _StockOpnameReportView(
                          outletId: outlet.id,
                          outletName: outlet.name,
                          from: from,
                          to: to,
                        ),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header();

  @override
  Widget build(BuildContext context) {
    return Text(
      'Laporan Logistik',
      style: Theme.of(context).textTheme.titleMedium?.copyWith(
            color: AppColors.darkText,
            fontWeight: FontWeight.w800,
          ),
    );
  }
}



class _FilterBar extends StatelessWidget {
  const _FilterBar({
    required this.from,
    required this.to,
    required this.onPickFrom,
    required this.onPickTo,
    required this.onApply,
  });

  final DateTime from;
  final DateTime to;
  final VoidCallback onPickFrom;
  final VoidCallback onPickTo;
  final VoidCallback onApply;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.appBackground.withOpacity(0.45),
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Wrap(
        spacing: 10,
        runSpacing: 10,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          _DateButton(label: 'Dari', value: from, onTap: onPickFrom),
          _DateButton(label: 'Sampai', value: to, onTap: onPickTo),
          ElevatedButton.icon(
            onPressed: onApply,
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('Terapkan'),
          ),
        ],
      ),
    );
  }
}

class _DateButton extends StatelessWidget {
  const _DateButton({
    required this.label,
    required this.value,
    required this.onTap,
  });

  final String label;
  final DateTime value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        width: 190,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: AppColors.border),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          children: [
            const Icon(Icons.calendar_month_rounded,
                size: 18, color: AppColors.mutedBlue),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: const TextStyle(
                      color: AppColors.mutedBlue,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Text(
                    formatDate(value),
                    style: const TextStyle(
                      color: AppColors.darkText,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ProfitLossView extends StatefulWidget {
  const _ProfitLossView({
    required this.report,
    required this.outletId,
    required this.outletName,
    required this.from,
    required this.to,
  });

  final AccountingReportSnapshot? report;
  final String outletId;
  final String outletName;
  final DateTime from;
  final DateTime to;

  @override
  State<_ProfitLossView> createState() => _ProfitLossViewState();
}

class _ProfitLossViewState extends State<_ProfitLossView> {
  final Map<String, AccountDetailSnapshot> _accountDetails = {};
  final Map<String, String> _accountDetailErrors = {};
  final Set<String> _loadingAccountCodes = {};
  String? _detailFetchKey;
  int _detailRequestVersion = 0;

  @override
  void initState() {
    super.initState();
    _fetchDetailsIfNeeded();
  }

  @override
  void didUpdateWidget(covariant _ProfitLossView oldWidget) {
    super.didUpdateWidget(oldWidget);
    _fetchDetailsIfNeeded();
  }

  List<String> _accountCodes() {
    final rows = widget.report?.rows ?? const <AccountingReportRow>[];
    final codes = <String>[];
    for (final row in rows) {
      if (!row.showsAccountDetails) continue;
      final code = row.accountCode;
      if (code == null) continue;
      if (!codes.contains(code)) codes.add(code);
    }
    return codes;
  }

  String _buildDetailFetchKey(List<String> accountCodes) {
    return [
      widget.outletId,
      toApiDateString(widget.from),
      toApiDateString(widget.to),
      ...accountCodes,
    ].join('|');
  }

  Future<void> _fetchDetailsIfNeeded() async {
    final data = widget.report;
    if (data == null || data.isEmpty) {
      if (_detailFetchKey != null) {
        _detailRequestVersion++;
        setState(() {
          _detailFetchKey = null;
          _accountDetails.clear();
          _accountDetailErrors.clear();
          _loadingAccountCodes.clear();
        });
      }
      return;
    }

    final accountCodes = _accountCodes();
    final key = _buildDetailFetchKey(accountCodes);
    if (_detailFetchKey == key) return;

    _detailFetchKey = key;
    final requestVersion = ++_detailRequestVersion;
    setState(() {
      _accountDetails.clear();
      _accountDetailErrors.clear();
      _loadingAccountCodes
        ..clear()
        ..addAll(accountCodes);
    });

    await Future.wait(
      accountCodes.map(
        (accountCode) => _fetchAccountDetail(
          accountCode,
          requestVersion: requestVersion,
        ),
      ),
    );
  }

  Future<void> _fetchAccountDetail(
    String accountCode, {
    int? requestVersion,
  }) async {
    final activeRequestVersion = requestVersion ?? _detailRequestVersion;
    try {
      final detail = await const PosRepository().getAccountDetail(
        outletId: widget.outletId,
        report: 'profit_loss',
        accountCode: accountCode,
        from: widget.from,
        to: widget.to,
      );
      if (!mounted || activeRequestVersion != _detailRequestVersion) return;
      setState(() {
        _accountDetails[accountCode] = detail;
        _accountDetailErrors.remove(accountCode);
        _loadingAccountCodes.remove(accountCode);
      });
    } catch (error) {
      if (!mounted || activeRequestVersion != _detailRequestVersion) return;
      setState(() {
        _accountDetailErrors[accountCode] = error.toString();
        _loadingAccountCodes.remove(accountCode);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = widget.report;
    if (data == null || data.isEmpty) {
      return const Center(
        child: Text(
          'Belum ada data laba rugi.',
          style: TextStyle(color: AppColors.darkText),
        ),
      );
    }

    return ListView(
      children: [
        Center(
          child: Text(
            data.title.isEmpty ? 'Laba & Rugi' : data.title,
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  color: AppColors.darkText,
                  fontWeight: FontWeight.w900,
                ),
          ),
        ),
        const SizedBox(height: 4),
        Center(
          child: Text(
            '${formatDate(widget.from)} - ${formatDate(widget.to)} · ${widget.outletName}',
            style: const TextStyle(
              color: AppColors.mutedBlue,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        const SizedBox(height: 16),
        _AccountingTable(
          report: data,
          details: _accountDetails,
          loadingAccountCodes: _loadingAccountCodes,
          detailErrors: _accountDetailErrors,
          onRetryDetail: _fetchAccountDetail,
        ),
      ],
    );
  }
}

class _AccountingTable extends StatelessWidget {
  const _AccountingTable({
    required this.report,
    required this.details,
    required this.loadingAccountCodes,
    required this.detailErrors,
    required this.onRetryDetail,
  });

  final AccountingReportSnapshot report;
  final Map<String, AccountDetailSnapshot> details;
  final Set<String> loadingAccountCodes;
  final Map<String, String> detailErrors;
  final ValueChanged<String> onRetryDetail;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        children: [
          const _AccountingRowView(
            description: 'Description',
            total: 'Total',
            percent: '% of Income',
            header: true,
          ),
          for (final row in report.rows) ...[
            _AccountingRowView.fromReport(row),
            if (_shouldShowAccountDetails(row))
              _AccountActivitySubList(
                row: row,
                detail: details[row.accountCode],
                loading: loadingAccountCodes.contains(row.accountCode),
                error: detailErrors[row.accountCode],
                onRetry: () => onRetryDetail(row.accountCode!),
              ),
          ],
        ],
      ),
    );
  }

  bool _shouldShowAccountDetails(AccountingReportRow row) {
    return row.showsAccountDetails;
  }
}

class _AccountingRowView extends StatelessWidget {
  const _AccountingRowView({
    required this.description,
    required this.total,
    required this.percent,
    this.level = 0,
    this.section = false,
    this.emphasized = false,
    this.grandTotal = false,
    this.header = false,
  });

  factory _AccountingRowView.fromReport(AccountingReportRow row) {
    return _AccountingRowView(
      description: row.description,
      total: row.isSection ? '' : formatAccountingCurrency(row.total),
      percent:
          row.isSection ? '' : formatAccountingPercent(row.percentOfIncome),
      level: row.level,
      section: row.isSection,
      emphasized: row.emphasized || row.isSection,
      grandTotal: row.isGrandTotal,
    );
  }

  final String description;
  final String total;
  final String percent;
  final int level;
  final bool section;
  final bool emphasized;
  final bool grandTotal;
  final bool header;

  @override
  Widget build(BuildContext context) {
    final bgColor = header
        ? AppColors.appBackground
        : grandTotal
            ? AppColors.primaryTeal.withOpacity(0.08)
            : section
                ? Colors.white
                : emphasized
                    ? AppColors.appBackground.withOpacity(0.35)
                    : Colors.white;
    final textStyle = TextStyle(
      color: AppColors.darkText,
      fontSize: section ? 16 : 14,
      fontWeight: header || emphasized ? FontWeight.w900 : FontWeight.w600,
    );
    final borderColor = grandTotal ? AppColors.primaryTeal : AppColors.border;

    return Container(
      decoration: BoxDecoration(
        color: bgColor,
        border: Border(
          top: BorderSide(
            color: grandTotal ? AppColors.primaryTeal : Colors.transparent,
            width: grandTotal ? 1.2 : 0,
          ),
          bottom: BorderSide(color: borderColor, width: grandTotal ? 1.2 : 1),
        ),
      ),
      padding: EdgeInsets.fromLTRB(12 + (level * 18), 10, 12, 10),
      child: Row(
        children: [
          Expanded(
            flex: 6,
            child: Text(description, style: textStyle),
          ),
          Expanded(
            flex: 3,
            child: Text(
              total,
              textAlign: TextAlign.right,
              style: textStyle,
            ),
          ),
          Expanded(
            flex: 2,
            child: Text(
              percent,
              textAlign: TextAlign.right,
              style: textStyle,
            ),
          ),
        ],
      ),
    );
  }
}

class _AccountActivitySubList extends StatelessWidget {
  const _AccountActivitySubList({
    required this.row,
    required this.detail,
    required this.loading,
    required this.error,
    required this.onRetry,
  });

  final AccountingReportRow row;
  final AccountDetailSnapshot? detail;
  final bool loading;
  final String? error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    Widget body;
    if (loading) {
      body = const _AccountActivityMessage('Memuat aktivitas...');
    } else if (error != null) {
      body = _AccountActivityError(message: error!, onRetry: onRetry);
    } else {
      final rows = detail?.rows ?? const <AccountDetailRow>[];
      if (rows.isEmpty) {
        body = const _AccountActivityMessage('Belum ada aktivitas');
      } else {
        final visibleRows = rows.take(5).toList();
        final hiddenCount = rows.length - visibleRows.length;
        body = Column(
          children: [
            for (final item in visibleRows) _AccountActivityRow(item: item),
            if (hiddenCount > 0)
              _AccountActivityMessage('+ $hiddenCount aktivitas lainnya'),
          ],
        );
      }
    }

    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: AppColors.appBackground.withOpacity(0.32),
        border: const Border(
          bottom: BorderSide(color: AppColors.border),
        ),
      ),
      padding: EdgeInsets.fromLTRB(28 + (row.level * 18), 6, 12, 8),
      child: body,
    );
  }
}

class _AccountActivityRow extends StatelessWidget {
  const _AccountActivityRow({required this.item});

  final AccountDetailRow item;

  @override
  Widget build(BuildContext context) {
    final meta = [
      if (item.sourceType.isNotEmpty && item.sourceType != '-') item.sourceType,
      if (item.reference.isNotEmpty && item.reference != '-') item.reference,
      if (item.status.isNotEmpty && item.status != '-') item.status,
    ].join(' · ');

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 7),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.border)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.description,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.darkText,
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  meta.isEmpty ? item.date : '${item.date} · $meta',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.mutedBlue,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Text(
            formatCurrency(item.signedAmount),
            textAlign: TextAlign.right,
            style: const TextStyle(
              color: AppColors.darkText,
              fontSize: 12,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _AccountActivityMessage extends StatelessWidget {
  const _AccountActivityMessage(this.message);

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Text(
        message,
        style: const TextStyle(
          color: AppColors.mutedBlue,
          fontSize: 12,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _AccountActivityError extends StatelessWidget {
  const _AccountActivityError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            'Gagal memuat aktivitas: $message',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.danger,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        TextButton(
          onPressed: onRetry,
          child: const Text('Coba lagi'),
        ),
      ],
    );
  }
}



Map<String, int> _paymentTotalsFromTransactions(
    List<PosTransaction> transactions) {
  final totals = <String, int>{};
  for (final transaction in transactions) {
    for (final payment in transaction.effectivePayments) {
      totals[payment.method] = (totals[payment.method] ?? 0) + payment.amount;
    }
  }
  return totals;
}

String _transactionPaymentLabel(
    CatalogProvider catalog, PosTransaction transaction) {
  return transaction.effectivePayments
      .map((payment) => catalog.paymentLabel(payment.method))
      .join(' + ');
}

class _FlatLogisticItem {
  _FlatLogisticItem({
    required this.id,
    required this.date,
    required this.createdAt,
    required this.materialId,
    required this.materialName,
    required this.openingQuantity,
    required this.purchaseQuantity,
    required this.transferInQuantity,
    required this.transferOutQuantity,
    required this.salesQuantity,
    required this.damageQuantity,
    required this.systemQuantity,
    required this.actualQuantity,
    required this.unitPrice,
    required this.unit,
    required this.rawRequest,
  });

  final String id;
  final DateTime date;
  final DateTime createdAt;
  final String materialId;
  final String materialName;
  final double openingQuantity;
  final double purchaseQuantity;
  final double transferInQuantity;
  final double transferOutQuantity;
  final double salesQuantity;
  final double damageQuantity;
  final double systemQuantity;
  final double actualQuantity;
  final int unitPrice;
  final String unit;
  final StockOpnameRequest rawRequest; // Untuk mempermudah Edit/Delete

  double get calculatedSystem =>
      (purchaseQuantity + transferInQuantity + openingQuantity) -
      (transferOutQuantity + salesQuantity + damageQuantity);

  String get statusText {
    final diff = calculatedSystem - actualQuantity;
    if (diff.abs() < 0.0001) {
      return 'Pas';
    } else if (calculatedSystem > actualQuantity) {
      return 'SOP tidak berjalan sempurna';
    } else {
      return 'ada produk yang hilang';
    }
  }

  int get calculatedDenda {
    if (statusText == 'ada produk yang hilang') {
      final lossQty = actualQuantity - calculatedSystem;
      return lossQty > 0 ? (lossQty * unitPrice).round() : 0;
    }
    return 0;
  }
}

class _StockOpnameReportView extends StatefulWidget {
  const _StockOpnameReportView({
    required this.outletId,
    required this.outletName,
    required this.from,
    required this.to,
  });

  final String outletId;
  final String outletName;
  final DateTime from;
  final DateTime to;

  @override
  State<_StockOpnameReportView> createState() => _StockOpnameReportViewState();
}

class _StockOpnameReportViewState extends State<_StockOpnameReportView> {
  List<StockOpnameRequest> _requests = const [];
  List<_FlatLogisticItem> _logisticItems = const [];
  bool _loading = false;
  String? _error;
  String? _fetchKey;
  int _requestVersion = 0;
  String _filterStatus = 'all';

  @override
  void initState() {
    super.initState();
    _fetchRequests();
  }

  @override
  void didUpdateWidget(covariant _StockOpnameReportView oldWidget) {
    super.didUpdateWidget(oldWidget);
    final nextKey = _buildFetchKey();
    if (_fetchKey != nextKey) _fetchRequests();
  }

  String _buildFetchKey() {
    return [
      widget.outletId,
      toApiDateString(widget.from),
      toApiDateString(widget.to),
    ].join('|');
  }

  Future<void> _fetchRequests() async {
    final key = _buildFetchKey();
    final requestVersion = ++_requestVersion;
    setState(() {
      _fetchKey = key;
      _loading = true;
      _error = null;
    });

    try {
      final response = await const PosRepository().getStockOpnameRequests(
        outletId: widget.outletId,
        from: widget.from,
        to: widget.to,
      );
      final requestsList = response
        ..sort((a, b) => b.date.compareTo(a.date));

      final List<_FlatLogisticItem> flatList = [];
      for (final req in requestsList) {
        for (final item in req.items) {
          if (item.hasUserInput) {
            flatList.add(_FlatLogisticItem(
              id: req.id,
              date: req.date,
              createdAt: req.date,
              materialId: item.materialId,
              materialName: item.materialName,
              openingQuantity: item.openingQuantity,
              purchaseQuantity: item.purchaseQuantity,
              transferInQuantity: item.transferInQuantity,
              transferOutQuantity: item.transferOutQuantity,
              salesQuantity: item.salesQuantity,
              damageQuantity: item.damageQuantity,
              systemQuantity: item.realSystemQuantity,
              actualQuantity: item.actualQuantity,
              unitPrice: item.unitPrice,
              unit: item.unit,
              rawRequest: req,
            ));
          }
        }
      }

      if (!mounted || requestVersion != _requestVersion) return;
      setState(() {
        _requests = requestsList;
        _logisticItems = flatList;
        _loading = false;
      });
    } catch (error) {
      if (!mounted || requestVersion != _requestVersion) return;
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  int get _totalItems => _logisticItems.length;

  int get _matchItems =>
      _logisticItems.where((item) => item.statusText == 'Pas').length;

  int get _issueItems =>
      _logisticItems.where((item) => item.statusText != 'Pas').length;

  int get _fineItems =>
      _logisticItems.where((item) => item.statusText == 'ada produk yang hilang').length;

  int get _lossAmount =>
      _logisticItems.fold(0, (total, item) => total + item.calculatedDenda);

  String _formatQty(double value) =>
      value % 1 == 0 ? value.toInt().toString() : value.toStringAsFixed(2);

  double get _totalOpening => _logisticItems.fold(0.0, (sum, item) => sum + item.openingQuantity);
  double get _totalPurchase => _logisticItems.fold(0.0, (sum, item) => sum + item.purchaseQuantity);
  double get _totalDamage => _logisticItems.fold(0.0, (sum, item) => sum + item.damageQuantity);
  double get _totalTransferIn => _logisticItems.fold(0.0, (sum, item) => sum + item.transferInQuantity);
  double get _totalTransferOut => _logisticItems.fold(0.0, (sum, item) => sum + item.transferOutQuantity);
  double get _totalSales => _logisticItems.fold(0.0, (sum, item) => sum + item.salesQuantity);
  double get _totalActual => _logisticItems.fold(0.0, (sum, item) => sum + item.actualQuantity);
  double get _totalSystem => _logisticItems.fold(0.0, (sum, item) => sum + item.calculatedSystem);

  bool _canEditOrDelete(DateTime inputDate) {
    final nextDay = DateTime(inputDate.year, inputDate.month, inputDate.day + 1);
    final deadline = DateTime(nextDay.year, nextDay.month, nextDay.day, 12, 0);
    return DateTime.now().isBefore(deadline);
  }

  String _generateOpnameNo(StockOpnameRequest r) {
    final cleanDate = r.date.toIso8601String().split('T')[0].replaceAll('-', '');
    final id = r.id;
    final shortId = id.length > 4 ? id.substring(id.length - 4).toUpperCase() : id.toUpperCase();
    return 'LOG-$cleanDate-$shortId';
  }

  void _showOpnamePreview(StockOpnameRequest r) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Detail Laporan ${_generateOpnameNo(r)}'),
        content: SizedBox(
          width: 600,
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('Tanggal Opname: ${formatDate(r.date)}'),
                Text('Pembuat: ${r.requestedByName.isNotEmpty ? r.requestedByName : '-'}'),
                Text('Status: ${r.status.toUpperCase()}'),
                Text('Catatan: ${r.note.isNotEmpty ? r.note : '-'}'),
                if (r.status.toLowerCase() == 'rejected' && r.rejectionNote.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text('Alasan Penolakan: ${r.rejectionNote}', style: const TextStyle(color: Colors.red, fontWeight: FontWeight.bold)),
                ],
                const Divider(),
                const Text('Rincian Bahan Baku:', style: TextStyle(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: DataTable(
                    columns: const [
                      DataColumn(label: Text('Nama Bahan')),
                      DataColumn(label: Text('Sistem')),
                      DataColumn(label: Text('Aktual')),
                      DataColumn(label: Text('Selisih')),
                      DataColumn(label: Text('Unit')),
                    ],
                    rows: r.items.map((item) {
                      final diff = item.actualQuantity - item.realSystemQuantity;
                      return DataRow(
                        cells: [
                          DataCell(Text(item.materialName)),
                          DataCell(Text(_formatQty(item.realSystemQuantity))),
                          DataCell(Text(_formatQty(item.actualQuantity))),
                          DataCell(Text(_formatQty(diff))),
                          DataCell(Text(item.unit)),
                        ],
                      );
                    }).toList(),
                  ),
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Tutup'),
          ),
        ],
      ),
    );
  }

  void _handleEditRequest(StockOpnameRequest req) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => StockOpnameScreen(
          isFormOnly: true,
          initialRequest: req,
          onCancel: () => Navigator.of(context).pop(),
        ),
      ),
    ).then((_) {
      if (mounted) _fetchRequests();
    });
  }

  Future<void> _handleDeleteRequest(StockOpnameRequest req) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Hapus Pengajuan Logistik'),
        content: Text('Apakah Anda yakin ingin menghapus pengajuan logistik ${_generateOpnameNo(req)}?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Batal'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.danger),
            child: const Text('Hapus'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final success = await context.read<StockOpnameProvider>().deleteRequest(req.id, widget.outletId);
    if (!mounted) return;
    if (success) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Laporan logistik berhasil dihapus.')),
      );
      _fetchRequests();
    } else {
      final error = context.read<StockOpnameProvider>().errorMessage ?? 'Gagal menghapus laporan.';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error)),
      );
    }
  }

  void _handleEdit(_FlatLogisticItem item) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => StockOpnameScreen(
          isFormOnly: true,
          initialRequest: item.rawRequest,
          onCancel: () => Navigator.of(context).pop(),
        ),
      ),
    ).then((_) {
      if (mounted) _fetchRequests();
    });
  }

  Future<void> _handleDelete(_FlatLogisticItem item) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Hapus Laporan'),
        content: Text('Apakah Anda yakin ingin menghapus laporan logistik untuk ${item.materialName}?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Batal'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.danger),
            child: const Text('Hapus'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final success = await context.read<StockOpnameProvider>().deleteRequest(item.id, widget.outletId);
    if (!mounted) return;
    if (success) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Laporan logistik berhasil dihapus.')),
      );
      _fetchRequests();
    } else {
      final error = context.read<StockOpnameProvider>().errorMessage ?? 'Gagal menghapus laporan.';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error)),
      );
    }
  }

  List<Map<String, dynamic>> _getDendaSummary() {
    final Map<String, Map<String, dynamic>> summary = {};
    for (final item in _logisticItems) {
      if (item.statusText == 'ada produk yang hilang') {
        final key = item.materialName;
        final qtyHilang = item.actualQuantity - item.calculatedSystem;
        final denda = item.calculatedDenda;
        if (summary.containsKey(key)) {
          summary[key]!['totalHilang'] = summary[key]!['totalHilang'] + qtyHilang;
          summary[key]!['totalDenda'] = summary[key]!['totalDenda'] + denda;
        } else {
          summary[key] = {
            'materialName': item.materialName,
            'totalHilang': qtyHilang,
            'unit': item.unit,
            'totalDenda': denda,
          };
        }
      }
    }
    return summary.values.toList();
  }

  Future<void> _downloadDendaPdf() async {
    final penalties = _getDendaSummary();
    if (penalties.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Tidak ada rekapan denda stok untuk periode ini.')),
      );
      return;
    }
    await LogisticPenaltyPdfService.download(
      penalties: penalties,
      outletName: widget.outletName,
      from: widget.from,
      to: widget.to,
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _logisticItems.isEmpty) {
      return const BackendSkeleton(rows: 7);
    }

    if (_error != null && _logisticItems.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Gagal memuat laporan logistik: $_error',
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: AppColors.danger,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: _fetchRequests,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Coba lagi'),
            ),
          ],
        ),
      );
    }

    return BackendLoadingOverlay(
      loading: _loading,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              _Metric(
                title: 'Total item dicek',
                value: '$_totalItems',
                color: AppColors.mutedBlue,
              ),
              _Metric(
                title: 'Item pas',
                value: '$_matchItems',
                color: AppColors.secondaryGreen,
              ),
              _Metric(
                title: 'Item selisih/hilang',
                value: '$_issueItems',
                color: AppColors.danger,
              ),
              _Metric(
                title: 'Item kena denda',
                value: '$_fineItems',
                color: AppColors.danger,
              ),
              _Metric(
                title: 'Total denda / nilai kehilangan',
                value: formatCurrency(_lossAmount),
                color: AppColors.accentGold,
              ),
            ],
          ),
          const SizedBox(height: 14),
          Text(
            'Laporan Logistik · ${formatDate(widget.from)} - ${formatDate(widget.to)} · ${widget.outletName}',
            style: const TextStyle(
              color: AppColors.darkText,
              fontSize: 15,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'Angka laporan hanya menghitung inputan logistik yang sudah approved Admin.',
            style: TextStyle(
              color: AppColors.mutedBlue,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 10),
          Expanded(
            child: Scrollbar(
              child: ListView(
                padding: EdgeInsets.zero,
                children: [
                  // 1. Dropdown Filter Status Pengajuan Logistik
                  Row(
                    children: [
                      const Text('Filter Status Pengajuan: ', style: TextStyle(fontWeight: FontWeight.bold, color: AppColors.darkText)),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        decoration: BoxDecoration(
                          border: Border.all(color: AppColors.border),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: DropdownButtonHideUnderline(
                          child: DropdownButton<String>(
                            value: _filterStatus,
                            items: const [
                              DropdownMenuItem(value: 'all', child: Text('Semua')),
                              DropdownMenuItem(value: 'pending', child: Text('Pending')),
                              DropdownMenuItem(value: 'approved', child: Text('Approved')),
                              DropdownMenuItem(value: 'rejected', child: Text('Rejected')),
                            ],
                            onChanged: (val) {
                              if (val != null) {
                                setState(() => _filterStatus = val);
                              }
                            },
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  // 2. Tabel Status Pengajuan Logistik (Batch)
                  Container(
                    decoration: BoxDecoration(
                      color: Colors.white,
                      border: Border.all(color: AppColors.border),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: SizedBox(
                        width: 1000,
                        child: Table(
                          border: const TableBorder(
                            horizontalInside: BorderSide(color: AppColors.border),
                          ),
                          columnWidths: const {
                            0: FixedColumnWidth(180), // No Laporan
                            1: FixedColumnWidth(120), // Tanggal
                            2: FixedColumnWidth(150), // Pembuat
                            3: FixedColumnWidth(250), // Catatan
                            4: FixedColumnWidth(120), // Status
                            5: FixedColumnWidth(180), // Aksi
                          },
                          defaultVerticalAlignment: TableCellVerticalAlignment.middle,
                          children: [
                            const TableRow(
                              decoration: BoxDecoration(color: Color(0xFFF5F8FA)),
                              children: [
                                _HeadCell('No Laporan'),
                                _HeadCell('Tanggal'),
                                _HeadCell('Pembuat'),
                                _HeadCell('Catatan'),
                                _HeadCell('Status'),
                                _HeadCell('Aksi'),
                              ],
                            ),
                            ..._requests.where((r) => _filterStatus == 'all' || r.status.toLowerCase() == _filterStatus).map((req) {
                              final editAllowed = _canEditOrDelete(req.date);
                              Color statusColor = Colors.grey;
                              if (req.status.toLowerCase() == 'approved') statusColor = Colors.green;
                              if (req.status.toLowerCase() == 'pending') statusColor = Colors.orange;
                              if (req.status.toLowerCase() == 'rejected') statusColor = Colors.red;

                              return TableRow(
                                children: [
                                  Padding(
                                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
                                    child: Text(_generateOpnameNo(req), style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppColors.darkText)),
                                  ),
                                  _BodyCell(formatDate(req.date)),
                                  _BodyCell(req.requestedByName.isNotEmpty ? req.requestedByName : '-'),
                                  Padding(
                                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
                                    child: Text(req.note.isNotEmpty ? req.note : '-', style: const TextStyle(fontSize: 13, color: AppColors.darkText), maxLines: 2, overflow: TextOverflow.ellipsis),
                                  ),
                                  Padding(
                                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
                                    child: Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                      decoration: BoxDecoration(
                                        color: statusColor.withOpacity(0.1),
                                        border: Border.all(color: statusColor),
                                        borderRadius: BorderRadius.circular(4),
                                      ),
                                      child: Text(req.status.toUpperCase(), style: TextStyle(color: statusColor, fontWeight: FontWeight.bold, fontSize: 10)),
                                    ),
                                  ),
                                  Padding(
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
                                    child: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        IconButton(
                                          icon: const Icon(Icons.remove_red_eye, size: 18, color: AppColors.mutedBlue),
                                          onPressed: () => _showOpnamePreview(req),
                                          tooltip: 'Preview Detail',
                                        ),
                                        if (req.status.toLowerCase() == 'pending') ...[
                                          if (editAllowed)
                                            IconButton(
                                              icon: const Icon(Icons.edit, size: 18, color: AppColors.primaryTeal),
                                              onPressed: () => _handleEditRequest(req),
                                              tooltip: 'Edit Laporan',
                                            )
                                          else
                                            const Text('Locked', style: TextStyle(color: Colors.red, fontSize: 10, fontWeight: FontWeight.bold)),
                                          IconButton(
                                            icon: const Icon(Icons.delete, size: 18, color: AppColors.danger),
                                            onPressed: () => _handleDeleteRequest(req),
                                            tooltip: 'Hapus Laporan',
                                          ),
                                        ],
                                      ],
                                    ),
                                  ),
                                ],
                              );
                            }).toList(),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 24),
                  const Divider(),
                  const SizedBox(height: 12),
                  const Text(
                    'Rekap Detail Item Opname (Approved)',
                    style: TextStyle(
                      color: AppColors.darkText,
                      fontSize: 15,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (_logisticItems.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 24),
                      child: Center(
                        child: Text(
                          'Belum ada data rekapan detail item approved pada periode ini.',
                          style: TextStyle(color: AppColors.mutedBlue, fontWeight: FontWeight.w600),
                        ),
                      ),
                    )
                  else
                    // A. Tabel Laporan Logistik Utama
                    Container(
                          decoration: BoxDecoration(
                            color: Colors.white,
                            border: Border.all(color: AppColors.border),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          clipBehavior: Clip.antiAlias,
                          child: SingleChildScrollView(
                            scrollDirection: Axis.horizontal,
                            child: SizedBox(
                              width: 1425,
                              child: Table(
                                border: const TableBorder(
                                  horizontalInside: BorderSide(color: AppColors.border),
                                ),
                                columnWidths: const {
                                  0: FixedColumnWidth(44), // No
                                  1: FixedColumnWidth(100), // Tanggal
                                  2: FixedColumnWidth(180), // Nama Item
                                  3: FixedColumnWidth(90), // Stok Awal
                                  4: FixedColumnWidth(90), // Stok Masuk
                                  5: FixedColumnWidth(90), // Stok Rusak
                                  6: FixedColumnWidth(120), // Transfer Masuk
                                  7: FixedColumnWidth(120), // Transfer Keluar
                                  8: FixedColumnWidth(110), // Sisa Manual
                                  9: FixedColumnWidth(110), // Sisa System
                                  10: FixedColumnWidth(160), // Keterangan
                                  11: FixedColumnWidth(110), // Denda
                                  12: FixedColumnWidth(100), // Aksi
                                },
                                defaultVerticalAlignment: TableCellVerticalAlignment.middle,
                                children: [
                                  // Header Row
                                  const TableRow(
                                    decoration: BoxDecoration(color: Color(0xFFF5F8FA)),
                                    children: [
                                      _HeadCell('No'),
                                      _HeadCell('Tanggal'),
                                      _HeadCell('Nama Item'),
                                      _HeadCell('Stok Awal'),
                                      _HeadCell('Stok Masuk'),
                                      _HeadCell('Stok Rusak'),
                                      _HeadCell('Trf Masuk'),
                                      _HeadCell('Trf Keluar'),
                                      _HeadCell('Sisa Manual'),
                                      _HeadCell('Sisa System'),
                                      _HeadCell('Keterangan'),
                                      _HeadCell('Denda Stok'),
                                      _HeadCell('Aksi'),
                                    ],
                                  ),
                                  // Data Rows
                                  ..._logisticItems.asMap().entries.map((entry) {
                                    final index = entry.key;
                                    final item = entry.value;
                                    final denda = item.calculatedDenda;
                                    final isPas = item.statusText == 'Pas';
                                    final editable = _canEditOrDelete(item.createdAt);

                                    return TableRow(
                                      children: [
                                        _BodyCell('${index + 1}'),
                                        _BodyCell(formatDate(item.date)),
                                        Padding(
                                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
                                          child: Text(
                                            item.materialName,
                                            style: const TextStyle(
                                              color: AppColors.darkText,
                                              fontSize: 13,
                                              fontWeight: FontWeight.bold,
                                            ),
                                          ),
                                        ),
                                        _BodyCell('${_formatQty(item.openingQuantity)} ${item.unit}'),
                                        _BodyCell('${_formatQty(item.purchaseQuantity)} ${item.unit}'),
                                        _BodyCell('${_formatQty(item.damageQuantity)} ${item.unit}'),
                                        _BodyCell('${_formatQty(item.transferInQuantity)} ${item.unit}'),
                                        _BodyCell('${_formatQty(item.transferOutQuantity)} ${item.unit}'),
                                        _BodyCell('${_formatQty(item.actualQuantity)} ${item.unit}'),
                                        _BodyCell('${_formatQty(item.calculatedSystem)} ${item.unit}'),
                                        Padding(
                                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
                                          child: Text(
                                            item.statusText,
                                            style: TextStyle(
                                              color: isPas
                                                  ? AppColors.secondaryGreen
                                                  : AppColors.danger,
                                              fontWeight: FontWeight.bold,
                                              fontSize: 12,
                                            ),
                                          ),
                                        ),
                                        Padding(
                                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
                                          child: Text(
                                            denda > 0 ? formatCurrency(denda) : '-',
                                            style: TextStyle(
                                              color: denda > 0 ? AppColors.danger : AppColors.mutedBlue,
                                              fontWeight: FontWeight.bold,
                                              fontSize: 12,
                                            ),
                                          ),
                                        ),
                                        // Aksi Edit & Delete
                                        Padding(
                                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
                                          child: editable
                                              ? Row(
                                                  mainAxisSize: MainAxisSize.min,
                                                  children: [
                                                    IconButton(
                                                      icon: const Icon(Icons.edit, size: 18, color: AppColors.primaryTeal),
                                                      padding: EdgeInsets.zero,
                                                      constraints: const BoxConstraints(),
                                                      onPressed: () => _handleEdit(item),
                                                      tooltip: 'Edit Laporan',
                                                    ),
                                                    const SizedBox(width: 8),
                                                    IconButton(
                                                      icon: const Icon(Icons.delete, size: 18, color: AppColors.danger),
                                                      padding: EdgeInsets.zero,
                                                      constraints: const BoxConstraints(),
                                                      onPressed: () => _handleDelete(item),
                                                      tooltip: 'Hapus Laporan',
                                                    ),
                                                  ],
                                                )
                                              : const Text('-', style: TextStyle(color: AppColors.mutedBlue)),
                                        ),
                                      ],
                                    );
                                  }),
                                  // TOTAL Row
                                  TableRow(
                                    decoration: const BoxDecoration(color: Color(0xFFF5F8FA)),
                                    children: [
                                      const _BodyCell(''),
                                      const _BodyCell(''),
                                      const Padding(
                                        padding: EdgeInsets.symmetric(horizontal: 10, vertical: 12),
                                        child: Text(
                                          'TOTAL',
                                          style: TextStyle(
                                            color: AppColors.darkText,
                                            fontWeight: FontWeight.w900,
                                            fontSize: 13,
                                          ),
                                        ),
                                      ),
                                      _BodyCell(_formatQty(_totalOpening)),
                                      _BodyCell(_formatQty(_totalPurchase)),
                                      _BodyCell(_formatQty(_totalDamage)),
                                      _BodyCell(_formatQty(_totalTransferIn)),
                                      _BodyCell(_formatQty(_totalTransferOut)),
                                      _BodyCell(_formatQty(_totalActual)),
                                      _BodyCell(_formatQty(_totalSystem)),
                                      const _BodyCell(''),
                                      Padding(
                                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
                                        child: Text(
                                          formatCurrency(_lossAmount),
                                          style: const TextStyle(
                                            color: AppColors.danger,
                                            fontWeight: FontWeight.w900,
                                            fontSize: 13,
                                          ),
                                        ),
                                      ),
                                      const _BodyCell(''),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 24),
                        // B. Tabel Rekapan Denda Stok & Tombol Download
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text(
                              'Rekapan Denda Stok',
                              style: TextStyle(
                                color: AppColors.darkText,
                                fontSize: 15,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            ElevatedButton.icon(
                              onPressed: _downloadDendaPdf,
                              icon: const Icon(Icons.picture_as_pdf_rounded),
                              label: const Text('Download Rekapan Denda'),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: AppColors.danger,
                                foregroundColor: Colors.white,
                                elevation: 1,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        _getDendaSummary().isEmpty
                            ? const Card(
                                child: Padding(
                                  padding: EdgeInsets.all(16),
                                  child: Text(
                                    'Tidak ada rekapan denda (tidak ada produk hilang pada periode ini).',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(color: AppColors.mutedBlue, fontWeight: FontWeight.w600),
                                  ),
                                ),
                              )
                            : Container(
                                decoration: BoxDecoration(
                                  color: Colors.white,
                                  border: Border.all(color: AppColors.border),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                clipBehavior: Clip.antiAlias,
                                child: Table(
                                  border: const TableBorder(
                                    horizontalInside: BorderSide(color: AppColors.border),
                                  ),
                                  columnWidths: const {
                                    0: FixedColumnWidth(50),
                                    1: FlexColumnWidth(4),
                                    2: FlexColumnWidth(2),
                                    3: FlexColumnWidth(2),
                                    4: FlexColumnWidth(3),
                                  },
                                  defaultVerticalAlignment: TableCellVerticalAlignment.middle,
                                  children: [
                                    const TableRow(
                                      decoration: BoxDecoration(color: Color(0xFFF5F8FA)),
                                      children: [
                                        _HeadCell('No'),
                                        _HeadCell('Nama Item'),
                                        _HeadCell('Total Hilang'),
                                        _HeadCell('Satuan'),
                                        _HeadCell('Total Denda Stok'),
                                      ],
                                    ),
                                    ..._getDendaSummary().asMap().entries.map((entry) {
                                      final idx = entry.key;
                                      final row = entry.value;
                                      return TableRow(
                                        children: [
                                          _BodyCell('${idx + 1}'),
                                          Padding(
                                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                                            child: Text(
                                              row['materialName'],
                                              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                                            ),
                                          ),
                                          _BodyCell(_formatQty(row['totalHilang'])),
                                          _BodyCell(row['unit']),
                                          Padding(
                                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                                            child: Text(
                                              formatCurrency(row['totalDenda']),
                                              style: const TextStyle(fontWeight: FontWeight.w900, color: AppColors.danger, fontSize: 13),
                                            ),
                                          ),
                                        ],
                                      );
                                    }),
                                    // Total Row
                                    TableRow(
                                      decoration: const BoxDecoration(color: Color(0xFFF5F8FA)),
                                      children: [
                                        const _BodyCell(''),
                                        const Padding(
                                          padding: EdgeInsets.symmetric(horizontal: 10, vertical: 12),
                                          child: Text(
                                            'TOTAL KESELURUHAN',
                                            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13),
                                          ),
                                        ),
                                        const _BodyCell(''),
                                        const _BodyCell(''),
                                        Padding(
                                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
                                          child: Text(
                                            formatCurrency(_lossAmount),
                                            style: const TextStyle(fontWeight: FontWeight.w900, color: AppColors.danger, fontSize: 14),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                      ],
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

class _StockOpnameBatchTile extends StatelessWidget {
  const _StockOpnameBatchTile({
    required this.request,
    required this.onTap,
  });

  final StockOpnameRequest request;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final user =
        request.requestedByName.isEmpty ? '-' : request.requestedByName;
    final source = request.source.isEmpty ? '-' : request.source;
    final lossItemCount =
        request.items.where((item) => item.difference > 0.001).length;
    final fineAmount = formatCurrency(request.totalLoss);
    final fineLabel = request.totalLoss > 0 ? fineAmount : 'Tidak ada denda';

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    request.batchId.isEmpty ? request.id : request.batchId,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppColors.darkText,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${formatDate(request.date)} ${formatClock(request.date)} · ${request.items.length} item · $source · $user',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppColors.mutedBlue,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    lossItemCount > 0
                        ? '$lossItemCount item kena denda • Total denda $fineAmount'
                        : 'Tidak ada item kena denda • Total denda Rp 0',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: lossItemCount > 0
                          ? AppColors.danger
                          : AppColors.secondaryGreen,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                _StatusBadge(
                  label: _stockOpnameRequestStatusLabel(request.status),
                  color: AppColors.secondaryGreen,
                ),
                const SizedBox(height: 8),
                const Text(
                  'Denda / Nilai Kehilangan',
                  style: TextStyle(
                    color: AppColors.mutedBlue,
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  fineLabel,
                  textAlign: TextAlign.right,
                  style: TextStyle(
                    color: request.totalLoss > 0
                        ? AppColors.darkText
                        : AppColors.secondaryGreen,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({
    required this.label,
    required this.color,
  });

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

Future<void> _showStockOpnameDetail(
  BuildContext context,
  StockOpnameRequest request,
) async {
  await const ActivityLogService().record(
    outletId: request.outletId,
    module: 'stock_opname',
    action: 'detail_open',
    entityType: 'stock_opname_request',
    entityId: request.id,
    description: 'Membuka detail laporan Stock Opname.',
  );
  if (!context.mounted) return;
  return showDialog<void>(
    context: context,
    builder: (context) {
      final height = MediaQuery.of(context).size.height;
      return Dialog(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        insetPadding: const EdgeInsets.all(18),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxWidth: 1100,
            maxHeight: height * 0.86,
          ),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Detail Stock Opname',
                            style: Theme.of(context)
                                .textTheme
                                .titleMedium
                                ?.copyWith(
                                  color: AppColors.darkText,
                                  fontWeight: FontWeight.w900,
                                ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '${formatDate(request.date)} ${formatClock(request.date)} · ${request.outletName.isEmpty ? request.outletId : request.outletName}',
                            style: const TextStyle(
                              color: AppColors.mutedBlue,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: 'Tutup',
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close_rounded),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    _DetailInfoBox(
                      title: 'Status',
                      value: _stockOpnameRequestStatusLabel(request.status),
                    ),
                    _DetailInfoBox(
                      title: 'User',
                      value: request.requestedByName.isEmpty
                          ? '-'
                          : request.requestedByName,
                    ),
                    _DetailInfoBox(
                      title: 'Source',
                      value: request.source.isEmpty ? '-' : request.source,
                    ),
                    _DetailInfoBox(
                      title: 'Item',
                      value: '${request.items.length}',
                    ),
                    _DetailInfoBox(
                      title: 'Nilai kehilangan',
                      value: formatCurrency(request.totalLoss),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Container(
                  width: double.infinity,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  decoration: BoxDecoration(
                    color: AppColors.primaryTeal.withOpacity(0.08),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: AppColors.primaryTeal.withOpacity(0.24),
                    ),
                  ),
                  child: const Text(
                    'Sisa Sistem = Stok Awal + Pembelian + Transfer Masuk '
                    '- Transfer Keluar - Penjualan Bersih - Rusak',
                    style: TextStyle(
                      color: AppColors.darkText,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Expanded(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      border: Border.all(color: AppColors.border),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: SingleChildScrollView(
                        child: SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: DataTable(
                            headingRowColor: MaterialStateProperty.all(
                              AppColors.appBackground,
                            ),
                            columns: const [
                              DataColumn(label: Text('No')),
                              DataColumn(label: Text('Produk/material')),
                              DataColumn(label: Text('Type')),
                              DataColumn(label: Text('Stok Awal')),
                              DataColumn(label: Text('Pembelian')),
                              DataColumn(label: Text('Transfer Masuk')),
                              DataColumn(label: Text('Transfer Keluar')),
                              DataColumn(label: Text('Penjualan Bersih')),
                              DataColumn(label: Text('Rusak')),
                              DataColumn(label: Text('Sisa Stok Gudang')),
                              DataColumn(label: Text('Sisa Sistem')),
                              DataColumn(label: Text('Selisih')),
                              DataColumn(label: Text('Keterangan')),
                              DataColumn(label: Text('Nilai')),
                            ],
                            rows: [
                              for (var index = 0;
                                  index < request.items.length;
                                  index++)
                                _stockOpnameDetailRow(
                                  index: index,
                                  item: request.items[index],
                                ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    },
  );
}

class _DetailInfoBox extends StatelessWidget {
  const _DetailInfoBox({
    required this.title,
    required this.value,
  });

  final String title;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 170,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              color: AppColors.mutedBlue,
              fontSize: 11,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            value,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.darkText,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

DataRow _stockOpnameDetailRow({
  required int index,
  required StockOpnameWorksheetRow item,
}) {
  final statusLabel = _stockOpnameItemStatusLabel(item.status);
  final statusColor = _stockOpnameItemStatusColor(item.status);
  return DataRow(
    cells: [
      DataCell(Text('${index + 1}')),
      DataCell(
        SizedBox(
          width: 180,
          child: Text(
            item.materialName,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
        ),
      ),
      DataCell(Text(item.materialType.toUpperCase())),
      DataCell(Text(_formatStockOpnameQty(item.openingQuantity, item.unit))),
      DataCell(Text(_formatStockOpnameQty(item.purchaseQuantity, item.unit))),
      DataCell(Text(_formatStockOpnameQty(item.transferInQuantity, item.unit))),
      DataCell(
          Text(_formatStockOpnameQty(item.transferOutQuantity, item.unit))),
      DataCell(Text(_formatStockOpnameQty(item.salesQuantity, item.unit))),
      DataCell(Text(_formatStockOpnameQty(item.damageQuantity, item.unit))),
      DataCell(Text(_formatStockOpnameQty(item.actualQuantity, item.unit))),
      DataCell(Text(_formatStockOpnameQty(item.realSystemQuantity, item.unit))),
      DataCell(
        Text(
          _formatStockOpnameQty(item.difference, item.unit),
          style: TextStyle(
            color: item.difference > 0
                ? AppColors.danger
                : item.difference < 0
                    ? AppColors.accentGold
                    : AppColors.secondaryGreen,
            fontWeight: FontWeight.w900,
          ),
        ),
      ),
      DataCell(
        _StatusBadge(
          label: statusLabel,
          color: statusColor,
        ),
      ),
      DataCell(Text(formatCurrency(item.lossAmount))),
    ],
  );
}

String _stockOpnameRequestStatusLabel(String status) {
  switch (status.toLowerCase()) {
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    case 'pending':
      return 'Pending';
    default:
      return status.isEmpty ? '-' : status;
  }
}

String _stockOpnameItemStatusLabel(String status) {
  switch (status.toLowerCase()) {
    case 'stock_hilang':
      return 'Stock Hilang';
    case 'tidak_sesuai_standar':
      return 'Tidak Sesuai Standar';
    case 'pas':
      return 'Pas';
    default:
      return status.isEmpty ? '-' : status;
  }
}

Color _stockOpnameItemStatusColor(String status) {
  switch (status.toLowerCase()) {
    case 'stock_hilang':
      return AppColors.danger;
    case 'tidak_sesuai_standar':
      return AppColors.accentGold;
    default:
      return AppColors.secondaryGreen;
  }
}

String _formatStockOpnameQty(num value, String unit) {
  final number = value % 1 == 0
      ? value.toInt().toString()
      : value
          .toStringAsFixed(2)
          .replaceFirst(RegExp(r'0+$'), '')
          .replaceFirst(RegExp(r'\.$'), '');
  final cleanUnit = unit.trim();
  return cleanUnit.isEmpty ? number : '$number $cleanUnit';
}

Color _paymentMetricColor(String code) {
  switch (code) {
    case 'cash':
      return AppColors.accentGold;
    case 'transfer':
      return AppColors.secondaryGreen;
    case 'qris':
      return AppColors.mutedBlue;
    default:
      return AppColors.primaryTeal;
  }
}

class _Metric extends StatelessWidget {
  const _Metric({
    required this.title,
    required this.value,
    required this.color,
  });

  final String title;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        width: 180,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: color.withOpacity(0.1),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: color.withOpacity(0.25)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: const TextStyle(
                color: AppColors.darkText,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              value,
              style: const TextStyle(
                color: AppColors.darkText,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      );
}

class _HeadCell extends StatelessWidget {
  const _HeadCell(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Container(
        constraints: const BoxConstraints(minHeight: 42),
        alignment: Alignment.centerLeft,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        child: Text(text,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
                color: AppColors.mutedBlue,
                fontWeight: FontWeight.w700,
                fontSize: 11)),
      );
}

class _BodyCell extends StatelessWidget {
  const _BodyCell(this.text, {this.maxLines = 1});
  final String text;
  final int maxLines;
  @override
  Widget build(BuildContext context) => Container(
        constraints: const BoxConstraints(minHeight: 52),
        alignment: Alignment.centerLeft,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        child: Text(
          text,
          maxLines: maxLines,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(color: AppColors.darkText, fontSize: 13),
        ),
      );
}
