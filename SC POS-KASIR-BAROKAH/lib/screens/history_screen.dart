import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/app_models.dart';
import '../providers/auth_provider.dart';
import '../providers/catalog_provider.dart';
import '../providers/outlet_provider.dart';
import '../providers/transaction_provider.dart';
import '../services/thermal_printer_service.dart';
import '../services/thermal_ticket_builder.dart';
import '../services/activity_log_service.dart';
import '../theme/app_colors.dart';
import '../utils/formatters.dart';
import '../widgets/backend_loading.dart';
import '../widgets/print_preview_dialog.dart';
import '../widgets/receipt_dialog.dart';

String _transactionPaymentLabel(
    CatalogProvider catalog, PosTransaction transaction) {
  return transaction.effectivePayments
      .map((payment) => catalog.paymentLabel(payment.method))
      .join(' + ');
}

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key});
  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  final printerService = ThermalPrinterService();
  DateTime from = _startOfDay(DateTime.now().subtract(const Duration(days: 7)));
  DateTime to = _endOfDay(DateTime.now());
  String payment = 'all';
  String? _lastFetchKey;
  DateTime? _lastFetchAt;

  static DateTime _startOfDay(DateTime value) {
    final local = value.toLocal();
    return DateTime(local.year, local.month, local.day);
  }

  static DateTime _endOfDay(DateTime value) {
    final local = value.toLocal();
    return DateTime(local.year, local.month, local.day, 23, 59, 59, 999);
  }

  DateTime get _activeFrom => _startOfDay(from);
  DateTime get _activeTo => _endOfDay(to);

  Future<void> _pickDate(
      {required bool isFrom, required String outletId}) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: isFrom ? from : to,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (picked == null) return;
    setState(() {
      if (isFrom) {
        from = _startOfDay(picked);
        if (from.isAfter(to)) to = _endOfDay(picked);
      } else {
        to = _endOfDay(picked);
        if (to.isBefore(from)) from = _startOfDay(picked);
      }
      _lastFetchKey = null;
    });
    const ActivityLogService().record(
      outletId: outletId,
      module: 'transaction',
      action: 'filter_apply',
      description: 'Menerapkan filter tanggal riwayat transaksi.',
      metadata: {
        'from': from.toIso8601String(),
        'to': to.toIso8601String(),
        'payment_method': payment
      },
    );
    _fetchIfNeeded(outletId, force: true);
  }

  void _fetchIfNeeded(String outletId, {bool force = false}) {
    final activeFrom = _activeFrom;
    final activeTo = _activeTo;
    final key =
        '$outletId-${dateOnly(activeFrom).toIso8601String()}-${dateOnly(activeTo).toIso8601String()}-$payment';
    final stale = _lastFetchAt == null ||
        DateTime.now().difference(_lastFetchAt!) > const Duration(seconds: 10);
    if (!force && _lastFetchKey == key && !stale) return;
    _lastFetchKey = key;
    _lastFetchAt = DateTime.now();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      context.read<TransactionProvider>().fetchHistory(
            outletId: outletId,
            from: activeFrom,
            to: activeTo,
            paymentMethod: payment,
          );
    });
  }

  Future<void> _showTransactionDetail(
    PosTransaction transaction,
    Outlet outlet,
    CashierUser cashier,
    CatalogProvider catalog,
  ) async {
    final printSettings = catalog.printSettings;
    await const ActivityLogService().record(
      outletId: outlet.id,
      module: 'transaction',
      action: 'detail_open',
      entityType: 'transaction',
      entityId: transaction.id,
      description: 'Membuka detail transaksi ${transaction.orderNumber}.',
    );
    if (!mounted) return;
    final canPrintHistory = cashier.can('apk.history', 'print');
    final orderPrintActions = <Widget>[
      if (canPrintHistory && catalog.canPrintTemplate('customer_order'))
        OutlinedButton.icon(
          onPressed: () => _showHistoryOrderPrintPreview(
            template: 'customer_order',
            transaction: transaction,
            outlet: outlet,
            cashier: cashier,
            catalog: catalog,
          ),
          icon: const Icon(Icons.receipt_long_outlined),
          label: const Text('Print Customer'),
        ),
      if (canPrintHistory && catalog.canPrintTemplate('kitchen_order'))
        OutlinedButton.icon(
          onPressed: () => _showHistoryOrderPrintPreview(
            template: 'kitchen_order',
            transaction: transaction,
            outlet: outlet,
            cashier: cashier,
            catalog: catalog,
          ),
          icon: const Icon(Icons.soup_kitchen_outlined),
          label: const Text('Print Kitchen'),
        ),
    ];
    await showDialog<void>(
      context: context,
      builder: (_) => ReceiptDialog(
        transaction: transaction,
        outlet: outlet,
        cashierName: cashier.name,
        paymentLabel: _transactionPaymentLabel(catalog, transaction),
        footerText: catalog.printFooterText('bill_receipt'),
        additionalActions: orderPrintActions,
        onPrint: canPrintHistory
            ? (lines) async {
                final bytes = await ThermalTicketBuilder.bytesFromLines(lines);
                await printerService.printBytes(
                  settings: printSettings,
                  bytes: bytes,
                );
              }
            : null,
      ),
    );
  }

  Future<void> _showHistoryOrderPrintPreview({
    required String template,
    required PosTransaction transaction,
    required Outlet outlet,
    required CashierUser cashier,
    required CatalogProvider catalog,
  }) {
    Future<void> onPrint(List<String> lines) async {
      final bytes = await ThermalTicketBuilder.bytesFromLines(lines);
      await printerService.printBytes(
        settings: catalog.printSettings,
        bytes: bytes,
      );
    }

    if (template == 'customer_order') {
      return showDialog<void>(
        context: context,
        builder: (_) => PrintPreviewDialog.customer(
          outlet: outlet,
          orderNumber: transaction.orderNumber,
          cashierName: cashier.name,
          serviceType: transaction.serviceType,
          tableNumber: transaction.tableNumber,
          customerName: transaction.customerName,
          items: transaction.items,
          updateLabel: 'REPRINT',
          footerText: catalog.printFooterText('customer_order'),
          onPrint: onPrint,
        ),
      );
    }

    return showDialog<void>(
      context: context,
      builder: (_) => PrintPreviewDialog.kitchen(
        outlet: outlet,
        orderNumber: transaction.orderNumber,
        cashierName: cashier.name,
        serviceType: transaction.serviceType,
        tableNumber: transaction.tableNumber,
        customerName: transaction.customerName,
        items: transaction.items,
        updateLabel: 'REPRINT',
        onPrint: onPrint,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final outlet = context.watch<OutletProvider>().selectedOutlet!;
    final cashier = context.watch<AuthProvider>().user!;
    final catalog = context.watch<CatalogProvider>();
    final transactionProvider = context.watch<TransactionProvider>();
    if (payment != 'all' && catalog.paymentMethodByCode(payment) == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        setState(() {
          payment = 'all';
          _lastFetchKey = null;
        });
      });
    }
    _fetchIfNeeded(outlet.id);
    final transactions = transactionProvider.filtered(
        outletId: outlet.id,
        from: _activeFrom,
        to: _activeTo,
        paymentMethod: payment);
    return Padding(
        padding: const EdgeInsets.all(12),
        child: Card(
            child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(children: [
                        Text('Riwayat Transaksi',
                            style: Theme.of(context).textTheme.titleMedium),
                        const Spacer(),
                        IconButton(
                          tooltip: 'Refresh riwayat',
                          onPressed: () {
                            const ActivityLogService().record(
                                outletId: outlet.id,
                                module: 'transaction',
                                action: 'refresh',
                                description: 'Refresh riwayat transaksi.');
                            _fetchIfNeeded(outlet.id, force: true);
                          },
                          icon: const Icon(Icons.refresh),
                        ),
                        const SizedBox(width: 6),
                        _PaymentFilter(
                          methods: catalog.paymentMethods,
                          value: payment,
                          onChanged: (value) {
                            setState(() {
                              payment = value;
                              _lastFetchKey = null;
                            });
                            const ActivityLogService().record(
                                outletId: outlet.id,
                                module: 'transaction',
                                action: 'filter_apply',
                                description:
                                    'Menerapkan filter metode pembayaran.',
                                metadata: {'payment_method': value});
                          },
                        )
                      ]),
                      const SizedBox(height: 10),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          _HistoryDateButton(
                            label: 'Dari',
                            value: from,
                            onPressed: () =>
                                _pickDate(isFrom: true, outletId: outlet.id),
                          ),
                          _HistoryDateButton(
                            label: 'Sampai',
                            value: to,
                            onPressed: () =>
                                _pickDate(isFrom: false, outletId: outlet.id),
                          ),
                          OutlinedButton.icon(
                            onPressed: () {
                              final now = DateTime.now();
                              setState(() {
                                from = _startOfDay(now);
                                to = _endOfDay(now);
                                _lastFetchKey = null;
                              });
                              _fetchIfNeeded(outlet.id, force: true);
                              const ActivityLogService().record(
                                  outletId: outlet.id,
                                  module: 'transaction',
                                  action: 'filter_apply',
                                  description:
                                      'Menerapkan filter riwayat hari ini.',
                                  metadata: {
                                    'from': from.toIso8601String(),
                                    'to': to.toIso8601String()
                                  });
                            },
                            icon: const Icon(Icons.today_outlined, size: 16),
                            label: const Text('Hari ini'),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Expanded(
                        child: transactionProvider.loading
                            ? const BackendSkeleton(rows: 6)
                            : BackendLoadingOverlay(
                                loading: transactionProvider.refreshing,
                                child: transactions.isEmpty
                                    ? const Center(
                                        child: Text('Belum ada transaksi.',
                                            style: TextStyle(
                                                color: AppColors.darkText)))
                                    : ListView.separated(
                                        itemCount: transactions.length,
                                        separatorBuilder: (_, __) =>
                                            const Divider(),
                                        itemBuilder: (context, index) {
                                          final trx = transactions[index];
                                          final statusLabel =
                                              transactionStatusLabel(
                                                  trx.status);
                                          final statusColor =
                                              transactionStatusColor(
                                                  trx.status);
                                          final adjusted =
                                              isAdjustedTransaction(trx.status);
                                          return ListTile(
                                              title: Row(children: [
                                                Expanded(
                                                  child: Text(trx.orderNumber,
                                                      maxLines: 1,
                                                      overflow:
                                                          TextOverflow.ellipsis,
                                                      style: const TextStyle(
                                                          color: AppColors
                                                              .darkText,
                                                          fontWeight:
                                                              FontWeight.w800)),
                                                ),
                                                if (adjusted) ...[
                                                  const SizedBox(width: 8),
                                                  _TransactionStatusBadge(
                                                      label: statusLabel,
                                                      color: statusColor),
                                                ],
                                              ]),
                                              subtitle: Text(
                                                  '${formatDate(trx.createdAt)} ${formatClock(trx.createdAt)} · ${adjusted ? '$statusLabel · ' : ''}${_transactionPaymentLabel(catalog, trx)} · Total ${formatCurrency(trx.total)} · Dibayar ${formatCurrency(trx.paidAmount)} · Kembali ${formatCurrency(trx.changeAmount)}${trx.discount > 0 ? ' · Diskon ${formatCurrency(trx.discount)}' : ''} · ${trx.customerName ?? 'Tanpa customer'} · ${trx.synced ? 'synced' : 'pending'}',
                                                  maxLines: 2,
                                                  overflow:
                                                      TextOverflow.ellipsis,
                                                  style: const TextStyle(
                                                      color:
                                                          AppColors.mutedBlue)),
                                              trailing: Text(
                                                  formatCurrency(trx.total),
                                                  style: TextStyle(
                                                      color: adjusted
                                                          ? statusColor
                                                          : AppColors.darkText,
                                                      fontWeight:
                                                          FontWeight.w800,
                                                      decoration: adjusted
                                                          ? TextDecoration
                                                              .lineThrough
                                                          : TextDecoration
                                                              .none)),
                                              onTap: () =>
                                                  _showTransactionDetail(
                                                      trx,
                                                      outlet,
                                                      cashier,
                                                      catalog));
                                        })),
                      ),
                    ]))));
  }
}

bool isAdjustedTransaction(String status) {
  final normalized = status.toLowerCase();
  return normalized == 'cancelled' ||
      normalized == 'canceled' ||
      normalized == 'refunded';
}

String transactionStatusLabel(String status) {
  switch (status.toLowerCase()) {
    case 'cancelled':
    case 'canceled':
      return 'Dibatalkan';
    case 'refunded':
      return 'Refund';
    case 'paid':
      return 'Paid';
    default:
      return status.isEmpty ? '-' : status;
  }
}

Color transactionStatusColor(String status) {
  switch (status.toLowerCase()) {
    case 'cancelled':
    case 'canceled':
      return AppColors.danger;
    case 'refunded':
      return AppColors.accentGold;
    case 'paid':
      return AppColors.primaryTeal;
    default:
      return AppColors.mutedBlue;
  }
}

class _TransactionStatusBadge extends StatelessWidget {
  const _TransactionStatusBadge({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        border: Border.all(color: color.withOpacity(0.4)),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _PaymentFilter extends StatelessWidget {
  const _PaymentFilter({
    required this.methods,
    required this.value,
    required this.onChanged,
  });

  final List<PaymentMethod> methods;
  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 40,
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: AppColors.appBackground,
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(8),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          _PaymentFilterButton(
              label: 'Semua',
              value: 'all',
              active: value == 'all',
              onTap: onChanged),
          for (final method in methods)
            _PaymentFilterButton(
                label: method.name,
                value: method.code,
                active: value == method.code,
                onTap: onChanged),
        ]),
      ),
    );
  }
}

class _PaymentFilterButton extends StatelessWidget {
  const _PaymentFilterButton({
    required this.label,
    required this.value,
    required this.active,
    required this.onTap,
  });

  final String label;
  final String value;
  final bool active;
  final ValueChanged<String> onTap;

  @override
  Widget build(BuildContext context) {
    final foreground = active ? Colors.white : AppColors.darkText;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2),
      child: InkWell(
        borderRadius: BorderRadius.circular(7),
        onTap: () => onTap(value),
        child: Container(
          height: 34,
          constraints: const BoxConstraints(minWidth: 66),
          padding: const EdgeInsets.symmetric(horizontal: 12),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: active ? AppColors.primaryTeal : Colors.white,
            borderRadius: BorderRadius.circular(7),
            border: Border.all(
                color: active ? AppColors.primaryTeal : AppColors.border),
          ),
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: foreground,
              fontSize: 12,
              fontWeight: active ? FontWeight.w800 : FontWeight.w700,
            ),
          ),
        ),
      ),
    );
  }
}

class _HistoryDateButton extends StatelessWidget {
  const _HistoryDateButton({
    required this.label,
    required this.value,
    required this.onPressed,
  });

  final String label;
  final DateTime value;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
        onPressed: onPressed,
        icon: const Icon(Icons.calendar_today_outlined, size: 16),
        label: Text('$label ${formatDate(value)}'),
      );
}
