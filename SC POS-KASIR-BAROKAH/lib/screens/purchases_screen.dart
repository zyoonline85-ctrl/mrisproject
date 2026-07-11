import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/app_models.dart';
import '../providers/auth_provider.dart';
import '../providers/catalog_provider.dart';
import '../providers/outlet_provider.dart';
import '../providers/purchase_provider.dart';
import '../services/activity_log_service.dart';
import '../theme/app_colors.dart';
import '../utils/formatters.dart';
import '../utils/input_formatters.dart';
import '../utils/responsive_layout.dart';
import '../widgets/backend_loading.dart';
import '../widgets/material_picker_dialog.dart';

class PurchasesScreen extends StatefulWidget {
  const PurchasesScreen({super.key});

  @override
  State<PurchasesScreen> createState() => _PurchasesScreenState();
}

class _PurchasesScreenState extends State<PurchasesScreen> {
  final noteController = TextEditingController();
  final tableScrollController = ScrollController();
  final rows = <_PurchaseDraftRow>[_PurchaseDraftRow()];
  String? selectedSupplierId;
  String paymentType = 'lunas';
  DateTime purchaseDate = DateTime.now();
  late DateTime historyFrom;
  late DateTime historyTo;
  String? _lastFetchKey;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    historyFrom = DateTime(now.year, now.month, 1);
    historyTo = now;
  }

  @override
  void dispose() {
    noteController.dispose();
    tableScrollController.dispose();
    for (final row in rows) {
      row.dispose();
    }
    super.dispose();
  }

  int get hppTotal => rows
      .where((row) => row.material?.type != 'biaya')
      .fold(0, (total, row) => total + row.subtotal);

  int get biayaTotal => rows
      .where((row) => row.material?.type == 'biaya')
      .fold(0, (total, row) => total + row.subtotal);

  int get grandTotal => hppTotal + biayaTotal;

  String _historyFetchKey(String outletId) =>
      '$outletId-${dateOnly(historyFrom).toIso8601String()}-${dateOnly(historyTo).toIso8601String()}';

  void _fetchIfNeeded(String outletId, {bool force = false}) {
    final key = _historyFetchKey(outletId);
    if (!force && _lastFetchKey == key) return;
    _lastFetchKey = key;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _fetchHistoryFromBackend(outletId);
    });
  }

  Future<void> _fetchHistoryFromBackend(String outletId) {
    return context.read<PurchaseProvider>().fetchPurchases(
          outletId: outletId,
          from: historyFrom,
          to: historyTo,
        );
  }

  Future<void> pickHistoryDate({
    required bool isFrom,
    required String outletId,
  }) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: isFrom ? historyFrom : historyTo,
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
    );
    if (picked == null) return;
    setState(() {
      if (isFrom) {
        historyFrom = picked;
        if (historyFrom.isAfter(historyTo)) historyTo = picked;
      } else {
        historyTo = picked;
        if (historyTo.isBefore(historyFrom)) historyFrom = picked;
      }
      _lastFetchKey = _historyFetchKey(outletId);
    });
    await _fetchHistoryFromBackend(outletId);
  }

  Future<void> pickPurchaseDateTime() async {
    final picked = await _pickOperationalDateTime(context, purchaseDate);
    if (picked == null || !mounted) return;
    setState(() => purchaseDate = picked);
  }

  Future<void> submit() async {
    if (context.read<AuthProvider>().user?.can('apk.purchases', 'create') !=
        true) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Role tidak memiliki izin membuat pembelian.')));
      return;
    }
    final validRows = rows
        .where((row) =>
            row.material != null && row.quantity > 0 && row.unitPrice > 0)
        .toList();
    if (validRows.isEmpty) return;

    Supplier? supplier;
    for (final item in context.read<CatalogProvider>().suppliers) {
      if (item.id == selectedSupplierId) {
        supplier = item;
        break;
      }
    }
    final outlet = context.read<OutletProvider>().selectedOutlet!;
    final purchaseItems = validRows
        .map((row) => PurchaseBatchItem(
              materialId: row.material!.id,
              materialName: row.material!.name,
              materialType: row.material!.type,
              unit: row.material!.unit,
              quantity: row.quantity,
              unitPrice: row.unitPrice,
            ))
        .toList();
    final confirmed = await _confirmSubmitPurchase(
      outlet: outlet,
      supplier: supplier,
      items: purchaseItems,
      note: noteController.text.trim(),
    );
    if (confirmed != true || !mounted) return;

    await context.read<PurchaseProvider>().addPurchase(
          outletId: outlet.id,
          date: purchaseDate,
          supplierId: supplier?.id,
          supplierName: supplier?.name ?? '',
          paymentType: paymentType,
          note: noteController.text.trim(),
          items: purchaseItems,
        );
    setState(() {
      noteController.clear();
      purchaseDate = DateTime.now();
      for (final row in rows) {
        row.dispose();
      }
      rows
        ..clear()
        ..add(_PurchaseDraftRow());
    });
  }

  Future<bool?> _confirmSubmitPurchase({
    required Outlet outlet,
    required Supplier? supplier,
    required List<PurchaseBatchItem> items,
    required String note,
  }) {
    final hpp = items
        .where((item) => item.materialType != 'biaya')
        .fold<int>(0, (total, item) => total + item.subtotal);
    final biaya = items
        .where((item) => item.materialType == 'biaya')
        .fold<int>(0, (total, item) => total + item.subtotal);
    final total = hpp + biaya;

    return showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) {
        return AlertDialog(
          backgroundColor: Colors.white,
          surfaceTintColor: Colors.white,
          title: const Text('Konfirmasi Pembelian'),
          content: SizedBox(
            width: 760,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Pastikan data pembelian sudah benar sebelum dikirim. Data menunggu approval Admin sebelum masuk stok/laporan.',
                    style: TextStyle(
                      color: AppColors.mutedBlue,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _ConfirmInfo(label: 'Outlet', value: outlet.name),
                      _ConfirmInfo(
                        label: 'Tanggal & Jam Operasional',
                        value: formatDateTime(purchaseDate),
                      ),
                      _ConfirmInfo(
                        label: 'Supplier',
                        value: supplier?.name ?? 'Tanpa supplier',
                      ),
                      _ConfirmInfo(
                        label: 'Bayar',
                        value: paymentType == 'bon' ? 'Bon' : 'Lunas',
                      ),
                    ],
                  ),
                  if (note.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    _ConfirmInfo(
                        label: 'Catatan', value: note, fullWidth: true),
                  ],
                  const SizedBox(height: 14),
                  Text('Item Pembelian',
                      style: Theme.of(dialogContext).textTheme.titleSmall),
                  const SizedBox(height: 8),
                  Container(
                    constraints: const BoxConstraints(maxHeight: 260),
                    decoration: BoxDecoration(
                      border: Border.all(color: AppColors.border),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: SingleChildScrollView(
                      child: Table(
                        columnWidths: const {
                          0: FixedColumnWidth(34),
                          1: FlexColumnWidth(2.5),
                          2: FixedColumnWidth(96),
                          3: FixedColumnWidth(116),
                          4: FixedColumnWidth(116),
                        },
                        defaultVerticalAlignment:
                            TableCellVerticalAlignment.middle,
                        children: [
                          const TableRow(
                            decoration: BoxDecoration(color: Color(0xFFF4F7FA)),
                            children: [
                              _HeadCell('No'),
                              _HeadCell('Produk'),
                              _HeadCell('Qty'),
                              _HeadCell('Harga'),
                              _HeadCell('Subtotal'),
                            ],
                          ),
                          ...items.asMap().entries.map((entry) {
                            final item = entry.value;
                            return TableRow(children: [
                              _BodyCell('${entry.key + 1}'),
                              Padding(
                                padding: const EdgeInsets.all(6),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      item.materialName,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                          fontWeight: FontWeight.w800),
                                    ),
                                    Text(
                                      item.materialType == 'biaya'
                                          ? 'Biaya Produksi'
                                          : 'HPP',
                                      style: const TextStyle(
                                        color: AppColors.mutedBlue,
                                        fontSize: 11,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              _BodyCell(
                                  '${_quantityText(item.quantity)} ${item.unit}'),
                              _BodyCell(formatCurrency(item.unitPrice)),
                              _BodyCell(formatCurrency(item.subtotal)),
                            ]);
                          }),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                          child: _SummaryBox(label: 'Total HPP', value: hpp)),
                      const SizedBox(width: 8),
                      Expanded(
                          child: _SummaryBox(
                              label: 'Total Biaya Produksi', value: biaya)),
                      const SizedBox(width: 8),
                      Expanded(
                          child: _SummaryBox(
                              label: 'Grand Total',
                              value: total,
                              highlighted: true)),
                    ],
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Batal'),
            ),
            ElevatedButton.icon(
              onPressed: () => Navigator.pop(dialogContext, true),
              icon: const Icon(Icons.check_circle_outline),
              label: const Text('Setujui & Submit'),
            ),
          ],
        );
      },
    );
  }

  Future<void> pickMaterial(
    _PurchaseDraftRow row,
    List<RawMaterial> materials,
    List<RawMaterialCategory> categories,
    Outlet outlet,
  ) async {
    final result = await showDialog<MaterialPickerResult>(
      context: context,
      builder: (context) => MaterialPickerDialog.purchase(
        materials: materials,
        categories: categories,
        outlet: outlet,
      ),
    );
    if (result == null) return;
    setState(() {
      row.material = result.material;
      final lastPrice =
          result.stockForOutlet(outlet.id)?.lastPurchasePrice ?? 0;
      if (row.priceController.text.trim().isEmpty && lastPrice > 0) {
        row.priceController.text = formatNumber(lastPrice);
      }
    });
  }

  void addRow() {
    setState(() => rows.add(_PurchaseDraftRow()));
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !tableScrollController.hasClients) return;
      tableScrollController.animateTo(
        tableScrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
      );
    });
  }

  String _quantityText(double value) {
    if (value == value.roundToDouble()) return value.round().toString();
    return value.toString().replaceAll('.', ',');
  }

  _PurchaseDraftRow _draftRowFromItem(
    PurchaseBatchItem item,
    List<RawMaterial> materials,
  ) {
    final row = _PurchaseDraftRow();
    for (final material in materials) {
      if (material.id == item.materialId) {
        row.material = material;
        break;
      }
    }
    row.quantityController.text = _quantityText(item.quantity);
    row.priceController.text = formatNumber(item.unitPrice);
    return row;
  }

  Future<void> editPurchase(
    PurchaseBatch purchase,
    CatalogProvider catalog,
    Outlet outlet,
  ) async {
    if (!purchase.canEdit ||
        context.read<AuthProvider>().user?.can('apk.purchases', 'update') !=
            true) {
      return;
    }
    final editNoteController = TextEditingController(text: purchase.note);
    final editRows = purchase.items
        .map((item) => _draftRowFromItem(item, catalog.rawMaterials))
        .toList();
    if (editRows.isEmpty) editRows.add(_PurchaseDraftRow());
    var editSupplierId =
        catalog.suppliers.any((supplier) => supplier.id == purchase.supplierId)
            ? purchase.supplierId
            : null;
    var editPaymentType = purchase.paymentType == 'bon' ? 'bon' : 'lunas';

    final result = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return StatefulBuilder(builder: (context, setDialogState) {
          final validRows = editRows
              .where((row) =>
                  row.material != null && row.quantity > 0 && row.unitPrice > 0)
              .toList();
          final total =
              validRows.fold<int>(0, (sum, row) => sum + row.subtotal);
          return AlertDialog(
            title: const Text('Edit Pembelian'),
            content: SizedBox(
              width: 760,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Bisa diedit selama pembelian belum approved admin.',
                      style: TextStyle(
                        color: AppColors.mutedBlue,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Row(children: [
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          value: editSupplierId,
                          decoration: const InputDecoration(
                              labelText: 'Supplier opsional'),
                          items: catalog.suppliers
                              .map((supplier) => DropdownMenuItem(
                                    value: supplier.id,
                                    child: Text(supplier.name),
                                  ))
                              .toList(),
                          onChanged: (value) =>
                              setDialogState(() => editSupplierId = value),
                        ),
                      ),
                      const SizedBox(width: 8),
                      SizedBox(
                        width: 140,
                        child: DropdownButtonFormField<String>(
                          value: editPaymentType,
                          decoration: const InputDecoration(labelText: 'Bayar'),
                          items: const [
                            DropdownMenuItem(
                                value: 'lunas', child: Text('Lunas')),
                            DropdownMenuItem(value: 'bon', child: Text('Bon')),
                          ],
                          onChanged: (value) => setDialogState(
                              () => editPaymentType = value ?? 'lunas'),
                        ),
                      ),
                    ]),
                    const SizedBox(height: 8),
                    TextField(
                      controller: editNoteController,
                      decoration: const InputDecoration(labelText: 'Catatan'),
                    ),
                    const SizedBox(height: 12),
                    Table(
                      columnWidths: const {
                        0: FixedColumnWidth(34),
                        1: FlexColumnWidth(2.4),
                        2: FixedColumnWidth(90),
                        3: FixedColumnWidth(68),
                        4: FixedColumnWidth(116),
                        5: FixedColumnWidth(116),
                        6: FixedColumnWidth(42),
                      },
                      defaultVerticalAlignment:
                          TableCellVerticalAlignment.middle,
                      children: [
                        const TableRow(children: [
                          _HeadCell('No'),
                          _HeadCell('Harga Pokok Produksi'),
                          _HeadCell('Jumlah'),
                          _HeadCell('Satuan'),
                          _HeadCell('Harga'),
                          _HeadCell('Total'),
                          SizedBox(),
                        ]),
                        ...editRows.asMap().entries.map((entry) {
                          final index = entry.key;
                          final row = entry.value;
                          return TableRow(children: [
                            _BodyCell('${index + 1}'),
                            Padding(
                              padding: const EdgeInsets.all(4),
                              child: OutlinedButton(
                                onPressed: () async {
                                  final result =
                                      await showDialog<MaterialPickerResult>(
                                    context: dialogContext,
                                    builder: (context) =>
                                        MaterialPickerDialog.purchase(
                                      materials: catalog.rawMaterials,
                                      categories: catalog.rawMaterialCategories,
                                      outlet: outlet,
                                    ),
                                  );
                                  if (result == null) return;
                                  setDialogState(() {
                                    row.material = result.material;
                                    final lastPrice = result
                                            .stockForOutlet(outlet.id)
                                            ?.lastPurchasePrice ??
                                        0;
                                    if (row.priceController.text
                                            .trim()
                                            .isEmpty &&
                                        lastPrice > 0) {
                                      row.priceController.text =
                                          formatNumber(lastPrice);
                                    }
                                  });
                                },
                                child: Align(
                                  alignment: Alignment.centerLeft,
                                  child: Text(
                                    row.material == null
                                        ? 'Pilih produk'
                                        : '${row.material!.name} (${row.material!.type == 'biaya' ? 'Biaya Produksi' : 'HPP'})',
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ),
                            ),
                            Padding(
                              padding: const EdgeInsets.all(4),
                              child: TextField(
                                controller: row.quantityController,
                                keyboardType:
                                    const TextInputType.numberWithOptions(
                                        decimal: true),
                                decoration:
                                    const InputDecoration(isDense: true),
                                onChanged: (_) => setDialogState(() {}),
                              ),
                            ),
                            _BodyCell(row.material?.unit ?? '-'),
                            Padding(
                              padding: const EdgeInsets.all(4),
                              child: TextField(
                                controller: row.priceController,
                                keyboardType: TextInputType.number,
                                inputFormatters: const [
                                  ThousandsInputFormatter()
                                ],
                                decoration:
                                    const InputDecoration(isDense: true),
                                onChanged: (_) => setDialogState(() {}),
                              ),
                            ),
                            _BodyCell(formatCurrency(row.subtotal)),
                            IconButton(
                              onPressed: editRows.length == 1
                                  ? null
                                  : () => setDialogState(() {
                                        row.dispose();
                                        editRows.removeAt(index);
                                      }),
                              icon: const Icon(Icons.close),
                            ),
                          ]);
                        }),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(children: [
                      OutlinedButton.icon(
                        onPressed: () => setDialogState(
                            () => editRows.add(_PurchaseDraftRow())),
                        icon: const Icon(Icons.add),
                        label: const Text('Tambah Baris'),
                      ),
                      const Spacer(),
                      Text(
                        formatCurrency(total),
                        style: const TextStyle(
                          color: AppColors.darkText,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ]),
                  ],
                ),
              ),
            ),
            actions: [
              OutlinedButton(
                onPressed: () => Navigator.of(dialogContext).pop(false),
                child: const Text('Batal'),
              ),
              ElevatedButton(
                onPressed: total <= 0
                    ? null
                    : () => Navigator.of(dialogContext).pop(true),
                child: const Text('Simpan'),
              ),
            ],
          );
        });
      },
    );

    if (result != true || !mounted) {
      editNoteController.dispose();
      for (final row in editRows) {
        row.dispose();
      }
      return;
    }

    Supplier? supplier;
    for (final item in catalog.suppliers) {
      if (item.id == editSupplierId) {
        supplier = item;
        break;
      }
    }
    final validRows = editRows
        .where((row) =>
            row.material != null && row.quantity > 0 && row.unitPrice > 0)
        .toList();
    final success = await context.read<PurchaseProvider>().updatePurchase(
          purchase: purchase,
          supplierId: supplier?.id,
          supplierName: supplier?.name ?? '',
          paymentType: editPaymentType,
          note: editNoteController.text.trim(),
          items: validRows
              .map((row) => PurchaseBatchItem(
                    materialId: row.material!.id,
                    materialName: row.material!.name,
                    materialType: row.material!.type,
                    unit: row.material!.unit,
                    quantity: row.quantity,
                    unitPrice: row.unitPrice,
                  ))
              .toList(),
        );
    editNoteController.dispose();
    for (final row in editRows) {
      row.dispose();
    }
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(success
          ? 'Pembelian berhasil diperbarui.'
          : context.read<PurchaseProvider>().errorMessage ??
              'Gagal update pembelian.'),
    ));
  }

  Future<void> showPurchaseDetail(PurchaseBatch purchase) async {
    await const ActivityLogService().record(
      outletId: purchase.outletId,
      module: 'purchase',
      action: 'detail_open',
      entityType: 'purchase',
      entityId: purchase.id,
      description: 'Membuka detail pembelian.',
    );
    if (!mounted) return;
    return showDialog<void>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          backgroundColor: Colors.white,
          surfaceTintColor: Colors.white,
          title: const Text('Detail Pembelian'),
          content: SizedBox(
            width: 760,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _ConfirmInfo(
                        label: 'Tanggal & Jam Operasional',
                        value: formatDateTime(purchase.date),
                      ),
                      _ConfirmInfo(
                        label: 'Supplier',
                        value: purchase.supplierName.isEmpty
                            ? 'Tanpa supplier'
                            : purchase.supplierName,
                      ),
                      _ConfirmInfo(
                        label: 'Bayar',
                        value: purchase.paymentType == 'bon' ? 'Bon' : 'Lunas',
                      ),
                      _ConfirmInfo(
                        label: 'Status',
                        value:
                            purchase.synced ? purchase.status : 'pending sync',
                      ),
                    ],
                  ),
                  if (purchase.note.trim().isNotEmpty) ...[
                    const SizedBox(height: 10),
                    _ConfirmInfo(
                      label: 'Catatan',
                      value: purchase.note.trim(),
                      fullWidth: true,
                    ),
                  ],
                  const SizedBox(height: 14),
                  Text(
                    'Item Pembelian',
                    style: Theme.of(dialogContext).textTheme.titleSmall,
                  ),
                  const SizedBox(height: 8),
                  Container(
                    constraints: const BoxConstraints(maxHeight: 280),
                    decoration: BoxDecoration(
                      border: Border.all(color: AppColors.border),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: SingleChildScrollView(
                      child: Table(
                        columnWidths: const {
                          0: FixedColumnWidth(34),
                          1: FlexColumnWidth(2.4),
                          2: FixedColumnWidth(90),
                          3: FixedColumnWidth(116),
                          4: FixedColumnWidth(116),
                        },
                        defaultVerticalAlignment:
                            TableCellVerticalAlignment.middle,
                        children: [
                          const TableRow(
                            decoration: BoxDecoration(color: Color(0xFFF4F7FA)),
                            children: [
                              _HeadCell('No'),
                              _HeadCell('Produk'),
                              _HeadCell('Qty'),
                              _HeadCell('Harga'),
                              _HeadCell('Subtotal'),
                            ],
                          ),
                          ...purchase.items.asMap().entries.map((entry) {
                            final item = entry.value;
                            return TableRow(children: [
                              _BodyCell('${entry.key + 1}'),
                              Padding(
                                padding: const EdgeInsets.all(6),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      item.materialName,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w900,
                                      ),
                                    ),
                                    Text(
                                      item.materialType == 'biaya'
                                          ? 'Biaya Produksi'
                                          : 'HPP',
                                      style: const TextStyle(
                                        color: AppColors.mutedBlue,
                                        fontSize: 11,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              _BodyCell(
                                  '${_quantityText(item.quantity)} ${item.unit}'),
                              _BodyCell(formatCurrency(item.unitPrice)),
                              _BodyCell(formatCurrency(item.subtotal)),
                            ]);
                          }),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: _SummaryBox(
                          label: 'Total HPP',
                          value: purchase.hppTotal,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: _SummaryBox(
                          label: 'Total Biaya Produksi',
                          value: purchase.biayaTotal,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: _SummaryBox(
                          label: 'Grand Total',
                          value: purchase.total,
                          highlighted: true,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Tutup'),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final keyboardInset = MediaQuery.viewInsetsOf(context).bottom;
    final keyboardOpen = keyboardInset > 0;
    final outlet = context.watch<OutletProvider>().selectedOutlet!;
    final user = context.watch<AuthProvider>().user!;
    final canCreate = user.can('apk.purchases', 'create');
    final canUpdate = user.can('apk.purchases', 'update');
    _fetchIfNeeded(outlet.id);
    final catalog = context.watch<CatalogProvider>();
    final purchaseProvider = context.watch<PurchaseProvider>();
    final materials = catalog.rawMaterials;
    final suppliers = catalog.suppliers;
    final purchases = purchaseProvider.filtered(
      outletId: outlet.id,
      from: historyFrom,
      to: historyTo,
    );
    final pagePadding = ResponsiveLayout.pagePadding(context);
    final panelGap = ResponsiveLayout.panelGap(context);
    final formWidth = ResponsiveLayout.formPanelWidth(
      context,
      compact: 620,
      normal: 700,
      max: 740,
    );

    return Padding(
      padding: EdgeInsets.all(pagePadding),
      child: Row(children: [
        SizedBox(
          width: formWidth,
          child: Card(
            child: Padding(
              padding: EdgeInsets.all(pagePadding == 6 ? 8 : 12),
              child: SingleChildScrollView(
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                padding: EdgeInsets.only(bottom: keyboardInset + 12),
                child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Input Pembelian',
                          style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 10),
                      Row(children: [
                        Expanded(
                          child: DropdownButtonFormField<String>(
                            value: suppliers.any(
                                    (item) => item.id == selectedSupplierId)
                                ? selectedSupplierId
                                : null,
                            decoration: const InputDecoration(
                                labelText: 'Supplier opsional'),
                            items: suppliers
                                .map((supplier) => DropdownMenuItem(
                                    value: supplier.id,
                                    child: Text(supplier.name)))
                                .toList(),
                            onChanged: canCreate
                                ? (value) =>
                                    setState(() => selectedSupplierId = value)
                                : null,
                          ),
                        ),
                        const SizedBox(width: 8),
                        SizedBox(
                          width: 150,
                          child: DropdownButtonFormField<String>(
                            value: paymentType,
                            decoration:
                                const InputDecoration(labelText: 'Bayar'),
                            items: const [
                              DropdownMenuItem(
                                  value: 'lunas', child: Text('Lunas')),
                              DropdownMenuItem(
                                  value: 'bon', child: Text('Bon')),
                            ],
                            onChanged: canCreate
                                ? (value) => setState(
                                    () => paymentType = value ?? 'lunas')
                                : null,
                          ),
                        ),
                      ]),
                      const SizedBox(height: 8),
                      TextField(
                        controller: noteController,
                        readOnly: !canCreate,
                        decoration: const InputDecoration(labelText: 'Catatan'),
                      ),
                      const SizedBox(height: 8),
                      _OperationalDateTimeField(
                        value: purchaseDate,
                        onPressed: pickPurchaseDateTime,
                      ),
                      const SizedBox(height: 12),
                      SizedBox(
                        height: keyboardOpen ? 240 : 400,
                        child: materials.isEmpty
                            ? const Center(
                                child: Text(
                                    'Harga Pokok Produksi belum tersedia. Sync catalog dari backend.'))
                            : ListView.separated(
                                controller: tableScrollController,
                                itemCount: rows.length,
                                separatorBuilder: (_, __) =>
                                    const SizedBox(height: 8),
                                itemBuilder: (context, index) {
                                  final row = rows[index];
                                  return _PurchaseDraftCard(
                                    index: index,
                                    row: row,
                                    canRemove: rows.length > 1,
                                    onPick: () => pickMaterial(
                                      row,
                                      materials,
                                      catalog.rawMaterialCategories,
                                      outlet,
                                    ),
                                    onChanged: () => setState(() {}),
                                    onRemove: () => setState(() {
                                      row.dispose();
                                      rows.removeAt(index);
                                    }),
                                  );
                                },
                              ),
                      ),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          OutlinedButton.icon(
                            onPressed: canCreate ? addRow : null,
                            icon: const Icon(Icons.add),
                            label: const Text('Tambah Baris'),
                          ),
                          _SummaryChip(label: 'HPP', value: hppTotal),
                          _SummaryChip(label: 'Biaya', value: biayaTotal),
                          _SummaryChip(label: 'Total', value: grandTotal),
                        ],
                      ),
                      const SizedBox(height: 10),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton(
                          onPressed: !canCreate ||
                                  purchaseProvider.submitting ||
                                  grandTotal <= 0
                              ? null
                              : submit,
                          child: Text(purchaseProvider.submitting
                              ? 'Menyimpan...'
                              : 'Submit Pembelian'),
                        ),
                      ),
                    ]),
              ),
            ),
          ),
        ),
        SizedBox(width: panelGap),
        Expanded(
          child: Card(
            child: Padding(
              padding: EdgeInsets.all(pagePadding == 6 ? 8 : 12),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text('Riwayat Pembelian',
                              style: Theme.of(context).textTheme.titleMedium),
                        ),
                        IconButton(
                          tooltip: 'Refresh riwayat',
                          onPressed: () {
                            _lastFetchKey = _historyFetchKey(outlet.id);
                            _fetchHistoryFromBackend(outlet.id);
                          },
                          icon: const Icon(Icons.refresh),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        _HistoryDateButton(
                          label: 'Dari',
                          value: historyFrom,
                          onPressed: () => pickHistoryDate(
                              isFrom: true, outletId: outlet.id),
                        ),
                        _HistoryDateButton(
                          label: 'Sampai',
                          value: historyTo,
                          onPressed: () => pickHistoryDate(
                              isFrom: false, outletId: outlet.id),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Expanded(
                      child: purchaseProvider.loading
                          ? const BackendSkeleton(rows: 6)
                          : BackendLoadingOverlay(
                              loading: purchaseProvider.refreshing,
                              child: purchases.isEmpty
                                  ? const Center(
                                      child: Text(
                                          'Belum ada pembelian pada rentang tanggal ini.'))
                                  : ListView.separated(
                                      itemCount: purchases.length,
                                      separatorBuilder: (_, __) =>
                                          const Divider(),
                                      itemBuilder: (context, index) {
                                        final purchase = purchases[index];
                                        return ListTile(
                                          onTap: () =>
                                              showPurchaseDetail(purchase),
                                          title: Text(
                                            '${formatDateTime(purchase.date)} · ${purchase.items.length} item',
                                            style: const TextStyle(
                                                color: AppColors.darkText,
                                                fontWeight: FontWeight.w800),
                                          ),
                                          subtitle: Text(
                                            'HPP ${formatCurrency(purchase.hppTotal)} · Biaya ${formatCurrency(purchase.biayaTotal)} · ${purchase.synced ? purchase.status : 'pending sync'}',
                                            style: const TextStyle(
                                                color: AppColors.mutedBlue),
                                          ),
                                          trailing: Row(
                                            mainAxisSize: MainAxisSize.min,
                                            children: [
                                              Text(
                                                formatCurrency(purchase.total),
                                                style: const TextStyle(
                                                    color: AppColors.darkText,
                                                    fontWeight:
                                                        FontWeight.w800),
                                              ),
                                              if (purchase.canEdit &&
                                                  canUpdate) ...[
                                                const SizedBox(width: 8),
                                                IconButton(
                                                  tooltip:
                                                      'Edit sebelum approved',
                                                  onPressed: () => editPurchase(
                                                    purchase,
                                                    catalog,
                                                    outlet,
                                                  ),
                                                  icon: const Icon(
                                                      Icons.edit_outlined),
                                                ),
                                              ],
                                            ],
                                          ),
                                        );
                                      }),
                            ),
                    ),
                  ]),
            ),
          ),
        ),
      ]),
    );
  }
}

class _PurchaseDraftRow {
  RawMaterial? material;
  final quantityController = TextEditingController();
  final priceController = TextEditingController();

  double get quantity =>
      double.tryParse(quantityController.text.replaceAll(',', '.')) ?? 0;
  int get unitPrice => parseThousandsInput(priceController.text);
  int get subtotal => (quantity * unitPrice).round();

  void dispose() {
    quantityController.dispose();
    priceController.dispose();
  }
}

class _PurchaseDraftCard extends StatelessWidget {
  const _PurchaseDraftCard({
    required this.index,
    required this.row,
    required this.canRemove,
    required this.onPick,
    required this.onChanged,
    required this.onRemove,
  });

  final int index;
  final _PurchaseDraftRow row;
  final bool canRemove;
  final VoidCallback onPick;
  final VoidCallback onChanged;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final material = row.material;
    final typeLabel = material?.type == 'biaya' ? 'Biaya Produksi' : 'HPP';
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(8),
        color: const Color(0xFFF8FAFC),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 28,
                height: 28,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.primaryTeal.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  '${index + 1}',
                  style: const TextStyle(
                    color: AppColors.primaryTeal,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton(
                  onPressed: onPick,
                  style: OutlinedButton.styleFrom(
                    alignment: Alignment.centerLeft,
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 10),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        material?.name ?? 'Pilih Harga Pokok Produksi',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w900),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        material == null
                            ? 'Tap untuk memilih item pembelian'
                            : '$typeLabel · ${material.unit}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.mutedBlue,
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              IconButton(
                tooltip: 'Hapus baris',
                onPressed: canRemove ? onRemove : null,
                icon: const Icon(Icons.close),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                flex: 2,
                child: TextField(
                  controller: row.quantityController,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(
                    labelText: 'Jumlah',
                    isDense: true,
                  ),
                  onChanged: (_) => onChanged(),
                ),
              ),
              const SizedBox(width: 8),
              SizedBox(
                width: 76,
                child: _ReadonlyBox(
                  label: 'Satuan',
                  value: material?.unit ?? '-',
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                flex: 3,
                child: TextField(
                  controller: row.priceController,
                  keyboardType: TextInputType.number,
                  inputFormatters: const [ThousandsInputFormatter()],
                  decoration: const InputDecoration(
                    labelText: 'Harga Satuan',
                    isDense: true,
                  ),
                  onChanged: (_) => onChanged(),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                flex: 3,
                child: _ReadonlyBox(
                  label: 'Total',
                  value: formatCurrency(row.subtotal),
                  highlighted: row.subtotal > 0,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ReadonlyBox extends StatelessWidget {
  const _ReadonlyBox({
    required this.label,
    required this.value,
    this.highlighted = false,
  });

  final String label;
  final String value;
  final bool highlighted;

  @override
  Widget build(BuildContext context) => Container(
        height: 52,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
        decoration: BoxDecoration(
          border: Border.all(
              color: highlighted ? AppColors.primaryTeal : AppColors.border),
          borderRadius: BorderRadius.circular(8),
          color: highlighted
              ? AppColors.primaryTeal.withOpacity(0.08)
              : Colors.white,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              label,
              style: const TextStyle(
                color: AppColors.mutedBlue,
                fontSize: 10,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: highlighted ? AppColors.primaryTeal : AppColors.darkText,
                fontWeight: FontWeight.w900,
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
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.all(6),
        child: Text(text, style: const TextStyle(fontWeight: FontWeight.w800)),
      );
}

class _BodyCell extends StatelessWidget {
  const _BodyCell(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.all(6),
        child: Text(text, overflow: TextOverflow.ellipsis),
      );
}

class _SummaryChip extends StatelessWidget {
  const _SummaryChip({required this.label, required this.value});
  final String label;
  final int value;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.border),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text('$label ${formatCurrency(value)}',
            style: const TextStyle(fontWeight: FontWeight.w800)),
      );
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

Future<DateTime?> _pickOperationalDateTime(
  BuildContext context,
  DateTime initial,
) async {
  final date = await showDatePicker(
    context: context,
    initialDate: initial,
    firstDate: DateTime(2020),
    lastDate: DateTime(2035),
  );
  if (date == null || !context.mounted) return null;
  final time = await showTimePicker(
    context: context,
    initialTime: TimeOfDay.fromDateTime(initial),
  );
  if (time == null) return null;
  return DateTime(date.year, date.month, date.day, time.hour, time.minute);
}

class _OperationalDateTimeField extends StatelessWidget {
  const _OperationalDateTimeField({
    required this.value,
    required this.onPressed,
  });

  final DateTime value;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
        onPressed: onPressed,
        icon: const Icon(Icons.event_available_outlined, size: 18),
        label: Align(
          alignment: Alignment.centerLeft,
          child: Text('Tanggal & Jam Operasional: ${formatDateTime(value)}'),
        ),
      );
}

class _ConfirmInfo extends StatelessWidget {
  const _ConfirmInfo({
    required this.label,
    required this.value,
    this.fullWidth = false,
  });

  final String label;
  final String value;
  final bool fullWidth;

  @override
  Widget build(BuildContext context) => SizedBox(
        width: fullWidth ? double.infinity : 176,
        child: Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            border: Border.all(color: AppColors.border),
            borderRadius: BorderRadius.circular(8),
            color: const Color(0xFFF8FAFC),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                label,
                style: const TextStyle(
                  color: AppColors.mutedBlue,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                value,
                maxLines: fullWidth ? 3 : 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
            ],
          ),
        ),
      );
}

class _SummaryBox extends StatelessWidget {
  const _SummaryBox({
    required this.label,
    required this.value,
    this.highlighted = false,
  });

  final String label;
  final int value;
  final bool highlighted;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          border: Border.all(
              color: highlighted ? AppColors.primaryTeal : AppColors.border),
          borderRadius: BorderRadius.circular(8),
          color: highlighted
              ? AppColors.primaryTeal.withOpacity(0.08)
              : const Color(0xFFF8FAFC),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: TextStyle(
                color:
                    highlighted ? AppColors.primaryTeal : AppColors.mutedBlue,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              formatCurrency(value),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w900),
            ),
          ],
        ),
      );
}
