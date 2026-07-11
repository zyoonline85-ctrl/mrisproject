import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/app_models.dart';
import '../providers/auth_provider.dart';
import '../providers/catalog_provider.dart';
import '../providers/outlet_provider.dart';
import '../providers/pos_report_provider.dart';
import '../repositories/pos_repository.dart';
import '../services/profit_loss_pdf_service.dart';
import '../services/activity_log_service.dart';
import '../theme/app_colors.dart';
import '../utils/formatters.dart';
import '../widgets/backend_loading.dart';

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
  int _tabIndex = 0;
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

  Future<void> _downloadPdf(
    AccountingReportSnapshot report,
    String outletName,
  ) async {
    if (context.read<AuthProvider>().user?.can('apk.reports', 'export') !=
        true) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Role tidak memiliki izin export laporan.')));
      return;
    }
    if (report.isEmpty || _downloadingPdf) return;
    setState(() => _downloadingPdf = true);
    try {
      await ProfitLossPdfService.download(
        report: report,
        outletName: outletName,
        from: from,
        to: to,
      );
      await const ActivityLogService().record(
        module: 'report',
        action: 'report/export_pdf',
        outcome: 'succeeded',
        entityType: 'report',
        entityId: report.title,
        description: 'Download PDF ${report.title} berhasil.',
        metadata: {
          'from': from.toIso8601String(),
          'to': to.toIso8601String(),
          'row_count': report.rows.length
        },
      );
    } catch (error) {
      await const ActivityLogService().record(
        module: 'report',
        action: 'report/export_pdf',
        outcome: 'failed',
        entityType: 'report',
        entityId: report.title,
        description: 'Download PDF laporan gagal.',
        metadata: {'error': error.toString()},
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Gagal download PDF: $error')),
      );
    } finally {
      if (mounted) setState(() => _downloadingPdf = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final outlet = context.watch<OutletProvider>().selectedOutlet!;
    final catalog = context.watch<CatalogProvider>();
    final canExport =
        context.watch<AuthProvider>().user?.can('apk.reports', 'export') ==
            true;
    _fetchIfNeeded(outlet.id);

    final reportProvider = context.watch<PosReportProvider>();
    final report = reportProvider.report;
    final accountingReport = report?.accountingProfitLoss;

    return Padding(
      padding: const EdgeInsets.all(8),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Header(
                selectedTab: _tabIndex,
                downloadingPdf: _downloadingPdf,
                canDownload: canExport &&
                    accountingReport != null &&
                    !accountingReport.isEmpty,
                onTabChanged: (index) {
                  setState(() => _tabIndex = index);
                  const ActivityLogService().record(
                    outletId: null,
                    module: 'navigation',
                    action: 'tab_open',
                    entityType: 'report_tab',
                    entityId: index == 0 ? 'profit_loss' : 'stock_opname',
                    description: index == 0
                        ? 'Membuka tab Laba Rugi.'
                        : 'Membuka tab Stock Opname.',
                  );
                },
                onDownload: accountingReport == null
                    ? null
                    : () => _downloadPdf(accountingReport, outlet.name),
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
                        child: _tabIndex == 0
                            ? _ProfitLossView(
                                report: accountingReport,
                                outletId: outlet.id,
                                outletName: outlet.name,
                                from: from,
                                to: to,
                              )
                            : _tabIndex == 1
                                ? _SalesReportView(
                                    report: report,
                                    catalog: catalog,
                                  )
                                : _StockOpnameReportView(
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
  const _Header({
    required this.selectedTab,
    required this.downloadingPdf,
    required this.canDownload,
    required this.onTabChanged,
    required this.onDownload,
  });

  final int selectedTab;
  final bool downloadingPdf;
  final bool canDownload;
  final ValueChanged<int> onTabChanged;
  final VoidCallback? onDownload;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 12,
      runSpacing: 10,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Text(
          'Laporan POS',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                color: AppColors.darkText,
                fontWeight: FontWeight.w800,
              ),
        ),
        _TabButton(
          label: 'Laba Rugi',
          selected: selectedTab == 0,
          onTap: () => onTabChanged(0),
        ),
        _TabButton(
          label: 'Stock Opname',
          selected: selectedTab == 2,
          onTap: () => onTabChanged(2),
        ),
        if (selectedTab == 0)
          ElevatedButton.icon(
            onPressed: canDownload && !downloadingPdf ? onDownload : null,
            icon: downloadingPdf
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.download_rounded),
            label: Text(downloadingPdf ? 'Menyiapkan PDF' : 'Download PDF'),
          ),
      ],
    );
  }
}

class _TabButton extends StatelessWidget {
  const _TabButton({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: onTap,
      style: OutlinedButton.styleFrom(
        foregroundColor: selected ? Colors.white : AppColors.darkText,
        backgroundColor: selected ? AppColors.primaryTeal : Colors.white,
        side: BorderSide(
          color: selected ? AppColors.primaryTeal : AppColors.border,
        ),
      ),
      child: Text(label),
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

class _SalesReportView extends StatelessWidget {
  const _SalesReportView({
    required this.report,
    required this.catalog,
  });

  final PosReportSnapshot? report;
  final CatalogProvider catalog;

  @override
  Widget build(BuildContext context) {
    final transactions = report?.transactions ?? const [];
    final revenue = report?.revenue ?? 0;
    final discountTotal = report?.discountTotal ?? 0;
    final expenseTotal = report?.expenseTotal ?? 0;
    final paymentTotals = report?.paymentTotals.isNotEmpty == true
        ? report!.paymentTotals
        : _paymentTotalsFromTransactions(transactions);
    final knownPaymentCodes =
        catalog.paymentMethods.map((method) => method.code).toSet();
    final unknownPaymentTotals = paymentTotals.entries
        .where((entry) =>
            !knownPaymentCodes.contains(entry.key) && entry.value != 0)
        .toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            _Metric(
              title: 'Omzet',
              value: formatCurrency(revenue),
              color: AppColors.primaryTeal,
            ),
            _Metric(
              title: 'Transaksi',
              value: '${transactions.length}',
              color: AppColors.mutedBlue,
            ),
            _Metric(
              title: 'Discount',
              value: formatCurrency(discountTotal),
              color: AppColors.danger,
            ),
            for (final method in catalog.paymentMethods)
              _Metric(
                title: method.name,
                value: formatCurrency(paymentTotals[method.code] ?? 0),
                color: _paymentMetricColor(method.code),
              ),
            for (final entry in unknownPaymentTotals)
              _Metric(
                title: entry.key.toUpperCase(),
                value: formatCurrency(entry.value),
                color: AppColors.mutedBlue,
              ),
            _Metric(
              title: 'Pengeluaran',
              value: formatCurrency(expenseTotal),
              color: AppColors.danger,
            ),
            _Metric(
              title: 'Net Sederhana',
              value: formatCurrency(revenue - expenseTotal),
              color: AppColors.darkText,
            ),
          ],
        ),
        const SizedBox(height: 18),
        Expanded(
          child: transactions.isEmpty
              ? const Center(
                  child: Text(
                    'Belum ada data laporan.',
                    style: TextStyle(color: AppColors.darkText),
                  ),
                )
              : ListView.separated(
                  itemCount: transactions.length,
                  separatorBuilder: (_, __) => const Divider(),
                  itemBuilder: (context, index) {
                    final trx = transactions[index];
                    return ListTile(
                      title: Text(
                        trx.orderNumber,
                        style: const TextStyle(
                          color: AppColors.darkText,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      subtitle: Text(
                        '${formatDate(trx.createdAt)} ${formatClock(trx.createdAt)} · ${_transactionPaymentLabel(catalog, trx)}${trx.discount > 0 ? ' · Diskon ${formatCurrency(trx.discount)}' : ''}',
                        style: const TextStyle(color: AppColors.mutedBlue),
                      ),
                      trailing: Text(
                        formatCurrency(trx.total),
                        style: const TextStyle(
                          color: AppColors.darkText,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    );
                  },
                ),
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
  bool _loading = false;
  String? _error;
  String? _fetchKey;
  int _requestVersion = 0;

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
      final approved = response
          .where((request) => request.status.toLowerCase() == 'approved')
          .toList()
        ..sort((a, b) => b.date.compareTo(a.date));
      if (!mounted || requestVersion != _requestVersion) return;
      setState(() {
        _requests = approved;
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

  int get _totalItems =>
      _requests.fold(0, (total, request) => total + request.items.length);

  int get _matchItems => _requests.fold(
        0,
        (total, request) =>
            total +
            request.items.where((item) => item.difference.abs() < 0.001).length,
      );

  int get _issueItems => _requests.fold(
        0,
        (total, request) =>
            total +
            request.items
                .where((item) => item.difference.abs() >= 0.001)
                .length,
      );

  int get _fineItems => _requests.fold(
        0,
        (total, request) =>
            total +
            request.items.where((item) => item.difference > 0.001).length,
      );

  int get _lossAmount =>
      _requests.fold(0, (total, request) => total + request.totalLoss);

  @override
  Widget build(BuildContext context) {
    if (_loading && _requests.isEmpty) {
      return const BackendSkeleton(rows: 7);
    }

    if (_error != null && _requests.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Gagal memuat laporan stock opname: $_error',
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
            'Stock Opname · ${formatDate(widget.from)} - ${formatDate(widget.to)} · ${widget.outletName}',
            style: const TextStyle(
              color: AppColors.darkText,
              fontSize: 15,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'Angka laporan hanya menghitung request yang sudah approved Admin.',
            style: TextStyle(
              color: AppColors.mutedBlue,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 10),
          Expanded(
            child: _requests.isEmpty
                ? const Center(
                    child: Text(
                      'Belum ada stock opname approved pada periode ini.',
                      style: TextStyle(color: AppColors.darkText),
                    ),
                  )
                : ListView.separated(
                    itemCount: _requests.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (context, index) {
                      final request = _requests[index];
                      return _StockOpnameBatchTile(
                        request: request,
                        onTap: () => _showStockOpnameDetail(context, request),
                      );
                    },
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
