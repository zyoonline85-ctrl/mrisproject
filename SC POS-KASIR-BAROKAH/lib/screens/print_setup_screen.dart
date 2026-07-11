import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/app_models.dart';
import '../providers/auth_provider.dart';
import '../providers/catalog_provider.dart';
import '../providers/outlet_provider.dart';
import '../services/thermal_printer_service.dart';
import '../services/activity_log_service.dart';
import '../services/thermal_ticket_builder.dart';
import '../theme/app_colors.dart';
import '../utils/formatters.dart';
import '../widgets/keyboard_aware_scroll.dart';

class PrintSetupScreen extends StatefulWidget {
  const PrintSetupScreen({super.key});

  @override
  State<PrintSetupScreen> createState() => _PrintSetupScreenState();
}

class _PrintSetupScreenState extends State<PrintSetupScreen> {
  final printerService = ThermalPrinterService();
  bool loadingPrinters = false;
  bool connecting = false;
  bool bluetoothOn = false;
  bool connected = false;
  String? printerMessage;
  List<ThermalPrinterDevice> pairedPrinters = const [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => refreshPrinters());
  }

  List<TransactionItem> sampleItems(CatalogProvider catalog, Outlet outlet) {
    final products = catalog.printSampleProductsForOutlet(outlet.id);
    return products.asMap().entries.map((entry) {
      final quantity = entry.key + 1;
      final product = entry.value;
      final unitPrice = product.priceForOutlet(outlet.id);
      return TransactionItem(
        productId: product.id,
        productName: product.name,
        categoryId: product.categoryId,
        categoryName: product.categoryName.isNotEmpty
            ? product.categoryName
            : catalog.categoryName(product.categoryId),
        categorySortOrder: product.categorySortOrder,
        quantity: quantity,
        unitPrice: unitPrice,
        subtotal: unitPrice * quantity,
      );
    }).toList();
  }

  String sampleOrderNumber(Outlet outlet) =>
      '${outlet.code}-${formatOrderDate(DateTime.now())}-TEST';

  Future<void> refreshPrinters() async {
    setState(() {
      loadingPrinters = true;
      printerMessage = null;
    });
    try {
      final printers = await printerService.pairedPrinters();
      final isBluetoothOn = await printerService.bluetoothEnabled;
      final isConnected = await printerService.connectionStatus;
      if (!mounted) return;
      setState(() {
        pairedPrinters = printers;
        bluetoothOn = isBluetoothOn;
        connected = isConnected;
        printerMessage = printers.isEmpty
            ? 'Belum ada paired printer. Pair WOYA/WP58D dari Bluetooth Android dulu.'
            : null;
      });
    } catch (error) {
      final isBluetoothOn = await printerService.bluetoothEnabled;
      if (!mounted) return;
      setState(() {
        pairedPrinters = const [];
        bluetoothOn = isBluetoothOn;
        connected = false;
        printerMessage = cleanPrinterError(error);
      });
    } finally {
      if (mounted) setState(() => loadingPrinters = false);
    }
  }

  Future<void> connectSelectedPrinter(PrintSettings settings) async {
    final outletId = context.read<OutletProvider>().selectedOutlet?.id;
    if (context.read<AuthProvider>().user?.can('apk.printing', 'update') !=
        true) {
      showSnack('Role tidak memiliki izin mengubah printer.');
      return;
    }
    setState(() {
      connecting = true;
      printerMessage = null;
    });
    try {
      await printerService.connect(settings.printerAddress);
      await const ActivityLogService().record(
        outletId: outletId,
        module: 'printing',
        action: 'printer_connect',
        outcome: 'succeeded',
        entityType: 'printer',
        entityId: settings.printerAddress,
        description: 'Printer thermal berhasil dihubungkan.',
      );
      if (!mounted) return;
      setState(() {
        connected = true;
        bluetoothOn = true;
        printerMessage = 'Printer ${settings.printerName} berhasil terkoneksi.';
      });
    } catch (error) {
      await const ActivityLogService().record(
        outletId: outletId,
        module: 'printing',
        action: 'printer_connect',
        outcome: 'failed',
        entityType: 'printer',
        entityId: settings.printerAddress,
        description: 'Koneksi printer thermal gagal.',
        metadata: {'error': error.toString()},
      );
      if (!mounted) return;
      setState(() => printerMessage = cleanPrinterError(error));
    } finally {
      if (mounted) setState(() => connecting = false);
    }
  }

  Future<void> disconnectPrinter() async {
    final outletId = context.read<OutletProvider>().selectedOutlet?.id;
    if (context.read<AuthProvider>().user?.can('apk.printing', 'update') !=
        true) {
      showSnack('Role tidak memiliki izin mengubah printer.');
      return;
    }
    setState(() => connecting = true);
    await printerService.disconnect();
    await const ActivityLogService().record(
      outletId: outletId,
      module: 'printing',
      action: 'printer_disconnect',
      outcome: 'succeeded',
      description: 'Koneksi printer thermal diputus.',
    );
    if (!mounted) return;
    setState(() {
      connecting = false;
      connected = false;
      printerMessage = 'Printer diputus.';
    });
  }

  String cleanPrinterError(Object error) =>
      error.toString().replaceFirst('Exception: ', '');

  void showSnack(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> runPrint(Future<List<int>> Function() builder) async {
    final outletId = context.read<OutletProvider>().selectedOutlet?.id;
    if (context.read<AuthProvider>().user?.can('apk.printing', 'print') !=
        true) {
      showSnack('Role tidak memiliki izin test print.');
      return;
    }
    final settings = context.read<CatalogProvider>().printSettings;
    try {
      final bytes = await builder();
      await printerService.printBytes(settings: settings, bytes: bytes);
      await const ActivityLogService().record(
        outletId: outletId,
        module: 'printing',
        action: 'test_print',
        outcome: 'succeeded',
        entityType: 'printer',
        entityId: settings.printerAddress,
        description: 'Test print thermal berhasil.',
      );
      if (!mounted) return;
      setState(() => connected = true);
      showSnack('Print thermal berhasil.');
    } catch (error) {
      await const ActivityLogService().record(
        outletId: outletId,
        module: 'printing',
        action: 'test_print',
        outcome: 'failed',
        entityType: 'printer',
        entityId: settings.printerAddress,
        description: 'Test print thermal gagal.',
        metadata: {'error': error.toString()},
      );
      if (!mounted) return;
      showSnack(cleanPrinterError(error));
    }
  }

  Future<void> testCustomer(
      CatalogProvider catalog, Outlet outlet, CashierUser cashier) {
    final items = sampleItems(catalog, outlet);
    if (items.isEmpty) return Future.value();
    return runPrint(() => ThermalTicketBuilder.customerOrder(
        outlet: outlet,
        orderNumber: sampleOrderNumber(outlet),
        cashierName: cashier.name,
        serviceType: 'dine_in',
        tableNumber: 'TEST',
        items: items,
        footerText: catalog.printFooterText('customer_order')));
  }

  Future<void> testKitchen(
      CatalogProvider catalog, Outlet outlet, CashierUser cashier) {
    final items = sampleItems(catalog, outlet);
    if (items.isEmpty) return Future.value();
    return runPrint(() => ThermalTicketBuilder.kitchenOrder(
        outlet: outlet,
        orderNumber: sampleOrderNumber(outlet),
        cashierName: cashier.name,
        serviceType: 'dine_in',
        tableNumber: 'TEST',
        items: items,
        updateLabel: 'TEST PRINT'));
  }

  Future<void> testBill(
      CatalogProvider catalog, Outlet outlet, CashierUser cashier) {
    final items = sampleItems(catalog, outlet);
    if (items.isEmpty) return Future.value();
    final total = items.fold(0, (sum, item) => sum + item.subtotal);
    final transaction = PosTransaction(
      id: 'trx_print_test',
      orderNumber: sampleOrderNumber(outlet),
      outletId: outlet.id,
      cashierId: cashier.id,
      serviceType: 'dine_in',
      tableNumber: 'TEST',
      paymentMethod: 'cash',
      paidAmount: total,
      changeAmount: 0,
      subtotal: total,
      discount: 0,
      total: total,
      createdAt: DateTime.now(),
      synced: true,
      items: items,
      customerName: 'Customer Demo',
      customerPhone: '0812-0000-0000',
      customerPointsEarned: total ~/ 10000,
      customerPointsAfter: total ~/ 10000,
    );
    return runPrint(() => ThermalTicketBuilder.billReceipt(
        transaction: transaction,
        outlet: outlet,
        cashierName: cashier.name,
        footerText: catalog.printFooterText('bill_receipt')));
  }

  @override
  Widget build(BuildContext context) {
    final catalog = context.watch<CatalogProvider>();
    final outlet = context.watch<OutletProvider>().selectedOutlet!;
    final cashier = context.watch<AuthProvider>().user!;
    final canUpdate = cashier.can('apk.printing', 'update');
    final canPrint = cashier.can('apk.printing', 'print');
    final settings = catalog.printSettings;
    final templates = catalog.printTemplates;
    final hasSampleItems = sampleItems(catalog, outlet).isNotEmpty;
    final canUsePrinter = settings.hasSelectedPrinter;

    return KeyboardAwareScroll(
      padding: const EdgeInsets.all(12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 390,
            child: _PrintInfoCard(
              settings: settings,
              onReset: !canUpdate
                  ? null
                  : () async {
                      await catalog.resetLocalPrintSetup();
                      if (!context.mounted) return;
                      showSnack('Pilihan printer Bluetooth lokal direset.');
                    },
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(children: [
                          Text('Printer Bluetooth',
                              style: Theme.of(context).textTheme.titleMedium),
                          const Spacer(),
                          OutlinedButton.icon(
                            onPressed: loadingPrinters ? null : refreshPrinters,
                            icon: const Icon(Icons.refresh),
                            label: Text(
                                loadingPrinters ? 'Loading...' : 'Refresh'),
                          ),
                        ]),
                        const SizedBox(height: 8),
                        Text(
                          bluetoothOn
                              ? (connected
                                  ? 'Bluetooth aktif - connected'
                                  : 'Bluetooth aktif')
                              : 'Bluetooth belum aktif',
                          style: TextStyle(
                              color: bluetoothOn
                                  ? AppColors.primaryTeal
                                  : AppColors.accentGold,
                              fontSize: 12,
                              fontWeight: FontWeight.w800),
                        ),
                        if (printerMessage != null) ...[
                          const SizedBox(height: 6),
                          Text(printerMessage!,
                              style: const TextStyle(
                                  color: AppColors.mutedBlue,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w700)),
                        ],
                        const SizedBox(height: 10),
                        SizedBox(
                          height: 190,
                          child: pairedPrinters.isEmpty
                              ? const Center(
                                  child: Text(
                                      'Pair printer dari Bluetooth Android, lalu refresh.',
                                      style: TextStyle(
                                          color: AppColors.darkText,
                                          fontWeight: FontWeight.w700)))
                              : ListView.separated(
                                  itemCount: pairedPrinters.length,
                                  separatorBuilder: (_, __) =>
                                      const SizedBox(height: 8),
                                  itemBuilder: (context, index) {
                                    final printer = pairedPrinters[index];
                                    final selected = settings.printerAddress ==
                                        printer.address;
                                    return _PrinterDeviceTile(
                                      printer: printer,
                                      selected: selected,
                                      onTap: canUpdate
                                          ? () => catalog
                                              .selectThermalPrinter(printer)
                                          : null,
                                    );
                                  },
                                ),
                        ),
                        const SizedBox(height: 10),
                        Row(children: [
                          Expanded(
                            child: ElevatedButton.icon(
                              onPressed:
                                  canUpdate && canUsePrinter && !connecting
                                      ? () => connectSelectedPrinter(
                                          catalog.printSettings)
                                      : null,
                              icon: const Icon(Icons.bluetooth_connected),
                              label: Text(
                                  connecting ? 'Menghubungkan...' : 'Connect'),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: !canUpdate || connecting
                                  ? null
                                  : disconnectPrinter,
                              icon: const Icon(Icons.bluetooth_disabled),
                              label: const Text('Disconnect'),
                            ),
                          ),
                        ]),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Template Print',
                            style: Theme.of(context).textTheme.titleMedium),
                        const SizedBox(height: 6),
                        const Text(
                          'Template dikontrol dari Admin. APK hanya membaca status template dari snapshot/sync.',
                          style: TextStyle(
                              color: AppColors.mutedBlue,
                              fontSize: 12,
                              fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 12),
                        for (final entry in templates.asMap().entries) ...[
                          _TemplateTile(template: entry.value),
                          if (entry.key != templates.length - 1)
                            const SizedBox(height: 8),
                        ],
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Test Print',
                            style: Theme.of(context).textTheme.titleMedium),
                        const SizedBox(height: 10),
                        Row(children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: canPrint &&
                                      catalog
                                          .canPrintTemplate('customer_order') &&
                                      canUsePrinter &&
                                      hasSampleItems
                                  ? () => testCustomer(catalog, outlet, cashier)
                                  : null,
                              icon: const Icon(Icons.receipt_long_outlined),
                              label: const Text('Test Customer'),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: canPrint &&
                                      catalog
                                          .canPrintTemplate('kitchen_order') &&
                                      canUsePrinter &&
                                      hasSampleItems
                                  ? () => testKitchen(catalog, outlet, cashier)
                                  : null,
                              icon: const Icon(Icons.local_dining_outlined),
                              label: const Text('Test Kitchen'),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: ElevatedButton.icon(
                              onPressed: canPrint &&
                                      catalog
                                          .canPrintTemplate('bill_receipt') &&
                                      canUsePrinter &&
                                      hasSampleItems
                                  ? () => testBill(catalog, outlet, cashier)
                                  : null,
                              icon: const Icon(Icons.print),
                              label: const Text('Test Bill'),
                            ),
                          ),
                        ]),
                        if (!settings.hasSelectedPrinter) ...[
                          const SizedBox(height: 8),
                          const Text(
                            'Pilih printer Bluetooth dulu sebelum test print.',
                            style: TextStyle(
                                color: AppColors.mutedBlue,
                                fontSize: 12,
                                fontWeight: FontWeight.w700),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _PrintInfoCard extends StatelessWidget {
  const _PrintInfoCard({
    required this.settings,
    required this.onReset,
  });

  final PrintSettings settings;
  final VoidCallback? onReset;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Setup Printer Bluetooth',
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 6),
            const Text(
              'Pilih printer fisik dari daftar Bluetooth. Template print tetap mengikuti pengaturan Admin.',
              style: TextStyle(
                  color: AppColors.mutedBlue,
                  fontSize: 12,
                  fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 16),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: settings.hasSelectedPrinter
                    ? AppColors.primaryTeal.withOpacity(0.08)
                    : AppColors.appBackground,
                border: Border.all(
                    color: settings.hasSelectedPrinter
                        ? AppColors.primaryTeal
                        : AppColors.border),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(children: [
                Icon(
                  settings.hasSelectedPrinter
                      ? Icons.print
                      : Icons.print_disabled,
                  color: settings.hasSelectedPrinter
                      ? AppColors.primaryTeal
                      : AppColors.mutedBlue,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          settings.hasSelectedPrinter
                              ? settings.printerName
                              : 'Belum ada printer dipilih',
                          style: const TextStyle(
                              color: AppColors.darkText,
                              fontSize: 13,
                              fontWeight: FontWeight.w800),
                        ),
                        Text(
                          settings.hasSelectedPrinter
                              ? settings.printerAddress
                              : 'Refresh lalu pilih printer Bluetooth.',
                          style: const TextStyle(
                              color: AppColors.mutedBlue,
                              fontSize: 11,
                              fontWeight: FontWeight.w700),
                        ),
                      ]),
                ),
              ]),
            ),
            const SizedBox(height: 12),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppColors.appBackground,
                border: Border.all(color: AppColors.border),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Text(
                'Paper: 58mm\nArea cetak efektif: 48mm\nLebar aman: 30 karakter/baris',
                style: TextStyle(
                    color: AppColors.darkText,
                    fontSize: 12,
                    fontWeight: FontWeight.w700),
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: settings.hasSelectedPrinter && onReset != null
                    ? onReset
                    : null,
                icon: const Icon(Icons.restart_alt),
                label: const Text('Reset Pilihan Printer'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PrinterDeviceTile extends StatelessWidget {
  const _PrinterDeviceTile({
    required this.printer,
    required this.selected,
    required this.onTap,
  });

  final ThermalPrinterDevice printer;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color:
              selected ? AppColors.primaryTeal.withOpacity(0.12) : Colors.white,
          border: Border.all(
              color: selected ? AppColors.primaryTeal : AppColors.border),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(children: [
          Icon(selected ? Icons.check_circle : Icons.print,
              color: selected ? AppColors.primaryTeal : AppColors.mutedBlue),
          const SizedBox(width: 10),
          Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(printer.name.isEmpty ? 'Printer Bluetooth' : printer.name,
                  style: const TextStyle(
                      color: AppColors.darkText,
                      fontSize: 13,
                      fontWeight: FontWeight.w800)),
              Text(printer.address,
                  style: const TextStyle(
                      color: AppColors.mutedBlue,
                      fontSize: 11,
                      fontWeight: FontWeight.w700)),
            ]),
          ),
        ]),
      ),
    );
  }
}

class _TemplateTile extends StatelessWidget {
  const _TemplateTile({required this.template});

  final PrintTemplate template;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: template.enabled
            ? AppColors.primaryTeal.withOpacity(0.08)
            : AppColors.appBackground,
        border: Border.all(
            color: template.enabled ? AppColors.primaryTeal : AppColors.border),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(children: [
        Container(
          width: 30,
          height: 30,
          decoration: BoxDecoration(
            color: template.enabled ? AppColors.primaryTeal : Colors.white,
            border: Border.all(
                color: template.enabled
                    ? AppColors.primaryTeal
                    : AppColors.border),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(
            template.enabled ? Icons.check : Icons.close,
            size: 18,
            color: template.enabled ? Colors.white : AppColors.mutedBlue,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(template.label,
                style: const TextStyle(
                    color: AppColors.darkText,
                    fontSize: 13,
                    fontWeight: FontWeight.w800)),
            Text(template.key,
                style:
                    const TextStyle(color: AppColors.mutedBlue, fontSize: 11)),
          ]),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          decoration: BoxDecoration(
            color: template.enabled
                ? AppColors.primaryTeal.withOpacity(0.12)
                : AppColors.danger.withOpacity(0.08),
            border: Border.all(
                color: template.enabled
                    ? AppColors.primaryTeal
                    : AppColors.danger.withOpacity(0.35)),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            template.enabled ? 'Aktif' : 'Nonaktif',
            style: TextStyle(
              color:
                  template.enabled ? AppColors.primaryTeal : AppColors.danger,
              fontSize: 11,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
      ]),
    );
  }
}
