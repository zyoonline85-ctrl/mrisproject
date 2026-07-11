import 'package:flutter/material.dart';
import '../models/app_models.dart';
import '../services/receipt_text_layout.dart';
import '../services/activity_log_service.dart';
import '../theme/app_colors.dart';

class ReceiptDialog extends StatelessWidget {
  const ReceiptDialog(
      {super.key,
      required this.transaction,
      required this.outlet,
      required this.cashierName,
      this.paymentLabel,
      this.footerText,
      this.additionalActions = const [],
      this.onPrint});
  final PosTransaction transaction;
  final Outlet outlet;
  final String cashierName;
  final String? paymentLabel;
  final String? footerText;
  final List<Widget> additionalActions;
  final Future<void> Function(List<String> lines)? onPrint;

  @override
  Widget build(BuildContext context) {
    var printedSuccessfully = false;
    final lines = ReceiptTextLayout.billReceipt(
      transaction: transaction,
      outlet: outlet,
      cashierName: cashierName,
      paymentLabel: paymentLabel,
      footerText: footerText,
    );
    final adjusted = _isAdjustedTransaction(transaction.status);
    final statusColor = _transactionStatusColor(transaction.status);

    return AlertDialog(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.white,
      insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 18),
      title: const Text(
        'Print Bill',
        style:
            TextStyle(color: AppColors.darkText, fontWeight: FontWeight.w800),
      ),
      content: SizedBox(
          width: 340,
          child: SingleChildScrollView(
              child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFFEFA),
                    border: Border.all(color: AppColors.border),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: DefaultTextStyle(
                      style: const TextStyle(
                        color: AppColors.darkText,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.center,
                          children: [
                            if (adjusted) ...[
                              Container(
                                width: double.infinity,
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 10, vertical: 8),
                                decoration: BoxDecoration(
                                  color: statusColor.withOpacity(0.1),
                                  border: Border.all(
                                      color: statusColor.withOpacity(0.36)),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Text(
                                  _transactionStatusLabel(transaction.status),
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    color: statusColor,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              ),
                              const SizedBox(height: 10),
                            ],
                            _ThermalReceiptPreview(lines: lines),
                            const SizedBox(height: 10),
                            const Text(
                              'Paper 58mm, area cetak efektif 48mm, 30 karakter/baris.',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                  color: AppColors.mutedBlue, fontSize: 11),
                            ),
                          ]))))),
      actions: [
        ...additionalActions,
        OutlinedButton.icon(
            onPressed: () async {
              try {
                if (onPrint == null) {
                  throw Exception('Printer thermal belum dikonfigurasi.');
                }
                await onPrint!(lines);
                printedSuccessfully = true;
                await const ActivityLogService().record(
                  outletId: outlet.id,
                  module: 'printing',
                  action: 'print_bill',
                  outcome: 'succeeded',
                  entityType: 'transaction',
                  entityId: transaction.id,
                  description:
                      'Bill ${transaction.orderNumber} berhasil dicetak.',
                  metadata: {
                    'item_count': transaction.items.length,
                    'total': transaction.total
                  },
                );
                if (!context.mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                    content: Text('Print Bill berhasil dicetak.')));
              } catch (error) {
                await const ActivityLogService().record(
                  outletId: outlet.id,
                  module: 'printing',
                  action: 'print_bill',
                  outcome: 'failed',
                  entityType: 'transaction',
                  entityId: transaction.id,
                  description: 'Bill ${transaction.orderNumber} gagal dicetak.',
                  metadata: {'error': error.toString()},
                );
                if (!context.mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                    content: Text(
                        error.toString().replaceFirst('Exception: ', ''))));
              }
            },
            icon: const Icon(Icons.print),
            label: const Text('Print Thermal')),
        ElevatedButton(
            onPressed: () async {
              if (!printedSuccessfully) {
                await const ActivityLogService().record(
                  outletId: outlet.id,
                  module: 'printing',
                  action: 'print_bill',
                  outcome: 'cancelled',
                  entityType: 'transaction',
                  entityId: transaction.id,
                  description: 'Preview bill ditutup tanpa mencetak.',
                );
              }
              if (context.mounted) Navigator.of(context).pop();
            },
            child: const Text('Selesai'))
      ],
    );
  }
}

bool _isAdjustedTransaction(String status) {
  final normalized = status.toLowerCase();
  return normalized == 'cancelled' ||
      normalized == 'canceled' ||
      normalized == 'refunded';
}

String _transactionStatusLabel(String status) {
  switch (status.toLowerCase()) {
    case 'cancelled':
    case 'canceled':
      return 'TRANSAKSI DIBATALKAN';
    case 'refunded':
      return 'TRANSAKSI REFUND';
    default:
      return status.isEmpty ? '-' : status.toUpperCase();
  }
}

Color _transactionStatusColor(String status) {
  switch (status.toLowerCase()) {
    case 'cancelled':
    case 'canceled':
      return AppColors.danger;
    case 'refunded':
      return AppColors.accentGold;
    default:
      return AppColors.mutedBlue;
  }
}

class _ThermalReceiptPreview extends StatelessWidget {
  const _ThermalReceiptPreview({required this.lines});

  final List<String> lines;

  @override
  Widget build(BuildContext context) {
    return Text(
      lines.join('\n'),
      style: const TextStyle(
        color: AppColors.darkText,
        fontFamily: 'monospace',
        fontSize: 13,
        fontWeight: FontWeight.w700,
        height: 1.22,
        letterSpacing: 0,
      ),
    );
  }
}
