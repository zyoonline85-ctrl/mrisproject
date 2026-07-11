import 'package:flutter/material.dart';

import '../models/app_models.dart';
import '../services/receipt_text_layout.dart';
import '../services/activity_log_service.dart';
import '../theme/app_colors.dart';

class PrintPreviewDialog extends StatelessWidget {
  const PrintPreviewDialog.customer({
    super.key,
    required this.outlet,
    required this.orderNumber,
    required this.cashierName,
    required this.serviceType,
    required this.tableNumber,
    required this.items,
    this.customerName,
    this.updateLabel,
    this.footerText,
    this.onPrint,
  })  : title = 'Print Customer',
        subtitle = 'Customer Order Copy';

  const PrintPreviewDialog.kitchen({
    super.key,
    required this.outlet,
    required this.orderNumber,
    required this.cashierName,
    required this.serviceType,
    required this.tableNumber,
    required this.items,
    this.customerName,
    this.updateLabel,
    this.onPrint,
  })  : title = 'Print Kitchen',
        subtitle = 'Kitchen Order - Satu Printer',
        footerText = null;

  final Outlet outlet;
  final String title;
  final String subtitle;
  final String orderNumber;
  final String cashierName;
  final String serviceType;
  final String? tableNumber;
  final List<TransactionItem> items;
  final String? customerName;
  final String? updateLabel;
  final String? footerText;
  final Future<void> Function(List<String> lines)? onPrint;

  @override
  Widget build(BuildContext context) {
    var printedSuccessfully = false;
    final lines = title == 'Print Kitchen'
        ? ReceiptTextLayout.kitchenOrder(
            outlet: outlet,
            orderNumber: orderNumber,
            cashierName: cashierName,
            serviceType: serviceType,
            tableNumber: tableNumber,
            items: items,
            customerName: customerName,
            updateLabel: updateLabel,
          )
        : ReceiptTextLayout.customerOrder(
            outlet: outlet,
            orderNumber: orderNumber,
            cashierName: cashierName,
            serviceType: serviceType,
            tableNumber: tableNumber,
            items: items,
            customerName: customerName,
            updateLabel: updateLabel,
            footerText: footerText,
          );

    return AlertDialog(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.white,
      insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 18),
      title: Text(title,
          style: const TextStyle(
              color: AppColors.darkText, fontWeight: FontWeight.w800)),
      content: SizedBox(
        width: 360,
        child: SingleChildScrollView(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: const Color(0xFFFFFEFA),
              border: Border.all(color: AppColors.border),
              borderRadius: BorderRadius.circular(8),
            ),
            child: DefaultTextStyle(
              style: const TextStyle(
                  color: AppColors.darkText,
                  fontSize: 12,
                  fontWeight: FontWeight.w700),
              child: Column(children: [
                _ThermalTextPreview(lines: lines),
                const SizedBox(height: 10),
                const Text(
                  'Paper 58mm, area cetak efektif 48mm, 30 karakter/baris.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: AppColors.mutedBlue, fontSize: 11),
                ),
              ]),
            ),
          ),
        ),
      ),
      actions: [
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
                  action: title == 'Print Kitchen'
                      ? 'print_kitchen'
                      : 'print_customer',
                  outcome: 'succeeded',
                  entityType: 'order',
                  entityId: orderNumber,
                  description: '$title berhasil dicetak.',
                  metadata: {
                    'item_count': items.length,
                    'update_label': updateLabel
                  },
                );
                if (!context.mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('$title berhasil dicetak.')));
              } catch (error) {
                await const ActivityLogService().record(
                  outletId: outlet.id,
                  module: 'printing',
                  action: title == 'Print Kitchen'
                      ? 'print_kitchen'
                      : 'print_customer',
                  outcome: 'failed',
                  entityType: 'order',
                  entityId: orderNumber,
                  description: '$title gagal dicetak.',
                  metadata: {
                    'error': error.toString(),
                    'item_count': items.length
                  },
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
                  action: title == 'Print Kitchen'
                      ? 'print_kitchen'
                      : 'print_customer',
                  outcome: 'cancelled',
                  entityType: 'order',
                  entityId: orderNumber,
                  description: 'Preview $title ditutup tanpa mencetak.',
                );
              }
              if (context.mounted) Navigator.of(context).pop();
            },
            child: const Text('Selesai'))
      ],
    );
  }
}

class _ThermalTextPreview extends StatelessWidget {
  const _ThermalTextPreview({required this.lines});

  final List<String> lines;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.center,
      child: Text(
        lines.join('\n'),
        style: const TextStyle(
          color: AppColors.darkText,
          fontFamily: 'monospace',
          fontSize: 13,
          fontWeight: FontWeight.w700,
          height: 1.22,
          letterSpacing: 0,
        ),
      ),
    );
  }
}
