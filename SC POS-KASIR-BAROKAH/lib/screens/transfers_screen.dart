import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/app_models.dart';
import '../providers/auth_provider.dart';
import '../providers/catalog_provider.dart';
import '../providers/outlet_provider.dart';
import '../providers/transfer_provider.dart';
import '../services/activity_log_service.dart';
import '../theme/app_colors.dart';
import '../utils/formatters.dart';
import '../utils/responsive_layout.dart';
import '../widgets/backend_loading.dart';
import '../widgets/material_picker_dialog.dart';

class TransfersScreen extends StatefulWidget {
  const TransfersScreen({super.key});

  @override
  State<TransfersScreen> createState() => _TransfersScreenState();
}

class _TransfersScreenState extends State<TransfersScreen> {
  final noteController = TextEditingController();
  final tableScrollController = ScrollController();
  final rows = <_TransferDraftRow>[_TransferDraftRow()];
  String? selectedToOutletId;
  String selectedTransferType = 'regular';
  String loanReturnForTransferId = '';
  DateTime transferDate = DateTime.now();
  String? _lastFetchKey;

  @override
  void dispose() {
    noteController.dispose();
    tableScrollController.dispose();
    for (final row in rows) {
      row.dispose();
    }
    super.dispose();
  }

  void _fetchIfNeeded(String outletId) {
    final now = DateTime.now();
    final from = DateTime(now.year, now.month, 1);
    final key =
        '$outletId-${from.toIso8601String()}-${dateOnly(now).toIso8601String()}';
    if (_lastFetchKey == key) return;
    _lastFetchKey = key;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      context.read<TransferProvider>().fetchTransfers(
            outletId: outletId,
            from: from,
            to: now,
          );
    });
  }

  void addRow() {
    setState(() => rows.add(_TransferDraftRow()));
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !tableScrollController.hasClients) return;
      tableScrollController.animateTo(
        tableScrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
      );
    });
  }

  void resetRows(List<_TransferDraftRow> nextRows) {
    for (final row in rows) {
      row.dispose();
    }
    rows
      ..clear()
      ..addAll(nextRows.isEmpty ? [_TransferDraftRow()] : nextRows);
  }

  Future<void> pickTransferDateTime() async {
    final picked = await _pickOperationalDateTime(context, transferDate);
    if (picked == null || !mounted) return;
    setState(() => transferDate = picked);
  }

  Future<void> pickMaterial(
    _TransferDraftRow row,
    List<RawMaterial> materials,
    List<RawMaterialCategory> categories,
    Outlet fromOutlet,
    Outlet? toOutlet,
  ) async {
    if (toOutlet == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Pilih outlet tujuan dulu.')),
      );
      return;
    }
    final result = await showDialog<MaterialPickerResult>(
      context: context,
      builder: (context) => MaterialPickerDialog.transfer(
        materials: materials,
        categories: categories,
        fromOutlet: fromOutlet,
        toOutlet: toOutlet,
        quantityToCheck: row.quantity,
      ),
    );
    if (result == null) return;
    setState(() => row.material = result.material);
  }

  Future<void> submit() async {
    if (context.read<AuthProvider>().user?.can('apk.transfers', 'create') !=
        true) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Role tidak memiliki izin membuat transfer.')));
      return;
    }
    final outlet = context.read<OutletProvider>().selectedOutlet!;
    final transferProvider = context.read<TransferProvider>();
    final destinationOutlets = context
        .read<CatalogProvider>()
        .transferOutlets
        .where((item) => item.id != outlet.id)
        .toList();
    Outlet? toOutlet;
    for (final item in destinationOutlets) {
      if (item.id == selectedToOutletId) {
        toOutlet = item;
        break;
      }
    }
    final validRows =
        rows.where((row) => row.material != null && row.quantity > 0).toList();
    if (toOutlet == null || validRows.isEmpty) return;

    await transferProvider.addTransfer(
      fromOutletId: outlet.id,
      toOutletId: toOutlet.id,
      fromOutletName: outlet.name,
      toOutletName: toOutlet.name,
      date: transferDate,
      note: noteController.text.trim(),
      transferType:
          loanReturnForTransferId.isNotEmpty ? 'regular' : selectedTransferType,
      loanReturnForTransferId: loanReturnForTransferId,
      items: validRows
          .map((row) => TransferRequestItem(
                materialId: row.material!.id,
                materialName: row.material!.name,
                materialType: row.material!.type,
                unit: row.material!.unit,
                quantity: row.quantity,
              ))
          .toList(),
    );

    setState(() {
      noteController.clear();
      selectedTransferType = 'regular';
      loanReturnForTransferId = '';
      transferDate = DateTime.now();
      resetRows([_TransferDraftRow()]);
    });
  }

  void startLoanReturn(TransferRequest transfer) {
    final catalog = context.read<CatalogProvider>();
    final materialById = {
      for (final material in catalog.rawMaterials) material.id: material,
    };
    final sourceItems = transfer.loanRemainingItems.isNotEmpty
        ? transfer.loanRemainingItems
        : transfer.items;
    final nextRows = sourceItems
        .where((item) => item.quantity > 0)
        .map((item) => _TransferDraftRow()
          ..material = materialById[item.materialId]
          ..quantityController.text = formatPlainNumber(item.quantity))
        .toList();
    setState(() {
      selectedToOutletId = transfer.fromOutletId;
      selectedTransferType = 'regular';
      loanReturnForTransferId = transfer.id;
      noteController.text = 'Pengembalian pinjaman ${transfer.id}';
      resetRows(nextRows);
    });
    Navigator.of(context).pop();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
            'Form pengembalian pinjaman sudah terisi. Cek qty lalu submit.'),
      ),
    );
  }

  Future<void> showTransferDetail(
      TransferRequest transfer, Outlet outlet) async {
    await const ActivityLogService().record(
      outletId: outlet.id,
      module: 'transfer',
      action: 'detail_open',
      entityType: 'stock_transfer',
      entityId: transfer.id,
      description: 'Membuka detail transfer.',
    );
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (context) => _TransferDetailDialog(
        transfer: transfer,
        currentOutletId: outlet.id,
        allowCreate: this
                .context
                .read<AuthProvider>()
                .user
                ?.can('apk.transfers', 'create') ==
            true,
        onCreateLoanReturn: () => startLoanReturn(transfer),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final keyboardInset = MediaQuery.viewInsetsOf(context).bottom;
    final keyboardOpen = keyboardInset > 0;
    final outlet = context.watch<OutletProvider>().selectedOutlet!;
    final canCreate =
        context.watch<AuthProvider>().user?.can('apk.transfers', 'create') ==
            true;
    _fetchIfNeeded(outlet.id);
    final catalog = context.watch<CatalogProvider>();
    final transferProvider = context.watch<TransferProvider>();
    final materials = catalog.rawMaterials;
    final destinationOutlets =
        catalog.transferOutlets.where((item) => item.id != outlet.id).toList();
    final selectedToOutlet =
        destinationOutlets.any((item) => item.id == selectedToOutletId)
            ? selectedToOutletId
            : destinationOutlets.isNotEmpty
                ? destinationOutlets.first.id
                : null;
    selectedToOutletId = selectedToOutlet;
    Outlet? selectedDestinationOutlet;
    for (final item in destinationOutlets) {
      if (item.id == selectedToOutlet) {
        selectedDestinationOutlet = item;
        break;
      }
    }
    final transfers = transferProvider.transfers
        .where((transfer) =>
            transfer.fromOutletId == outlet.id ||
            transfer.toOutletId == outlet.id)
        .toList();
    final pagePadding = ResponsiveLayout.pagePadding(context);
    final panelGap = ResponsiveLayout.panelGap(context);
    final formWidth = ResponsiveLayout.formPanelWidth(
      context,
      compact: 540,
      normal: 590,
      max: 620,
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
                      Text('Input Transfer',
                          style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 10),
                      Row(children: [
                        Expanded(
                          child: InputDecorator(
                            decoration:
                                const InputDecoration(labelText: 'Outlet asal'),
                            child: Text(outlet.name,
                                style: const TextStyle(
                                    fontWeight: FontWeight.w800)),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: DropdownButtonFormField<String>(
                            value: selectedToOutlet,
                            decoration: const InputDecoration(
                                labelText: 'Outlet tujuan'),
                            items: destinationOutlets
                                .map((item) => DropdownMenuItem(
                                    value: item.id, child: Text(item.name)))
                                .toList(),
                            onChanged: canCreate
                                ? (value) =>
                                    setState(() => selectedToOutletId = value)
                                : null,
                          ),
                        ),
                      ]),
                      const SizedBox(height: 8),
                      if (loanReturnForTransferId.isNotEmpty) ...[
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: const Color(0xFFE5F4EF),
                            border: Border.all(color: const Color(0xFF9DD6C3)),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            'Pengembalian pinjaman untuk $loanReturnForTransferId',
                            style: const TextStyle(
                              color: Color(0xFF13795B),
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        const SizedBox(height: 8),
                      ] else ...[
                        SegmentedButton<String>(
                          segments: const [
                            ButtonSegment(
                              value: 'regular',
                              label: Text('Transfer Biasa'),
                              icon: Icon(Icons.swap_horiz),
                            ),
                            ButtonSegment(
                              value: 'loan',
                              label: Text('Pinjaman'),
                              icon: Icon(Icons.handshake_outlined),
                            ),
                          ],
                          selected: {selectedTransferType},
                          onSelectionChanged: canCreate
                              ? (value) => setState(
                                    () => selectedTransferType = value.first,
                                  )
                              : null,
                        ),
                        const SizedBox(height: 8),
                      ],
                      TextField(
                        controller: noteController,
                        readOnly: !canCreate,
                        decoration: const InputDecoration(labelText: 'Catatan'),
                      ),
                      const SizedBox(height: 8),
                      _OperationalDateTimeField(
                        value: transferDate,
                        onPressed: pickTransferDateTime,
                      ),
                      const SizedBox(height: 12),
                      SizedBox(
                        height: keyboardOpen ? 240 : 400,
                        child: materials.isEmpty
                            ? const Center(
                                child: Text(
                                    'Harga Pokok Produksi belum tersedia. Sync catalog dari backend.'))
                            : SingleChildScrollView(
                                controller: tableScrollController,
                                child: Table(
                                  columnWidths: const {
                                    0: FixedColumnWidth(36),
                                    1: FlexColumnWidth(2.5),
                                    2: FixedColumnWidth(96),
                                    3: FixedColumnWidth(80),
                                    4: FixedColumnWidth(80),
                                    5: FixedColumnWidth(42),
                                  },
                                  defaultVerticalAlignment:
                                      TableCellVerticalAlignment.middle,
                                  children: [
                                    const TableRow(children: [
                                      _HeadCell('No'),
                                      _HeadCell('Harga Pokok Produksi'),
                                      _HeadCell('Jumlah'),
                                      _HeadCell('Satuan'),
                                      _HeadCell('Type'),
                                      SizedBox(),
                                    ]),
                                    ...rows.asMap().entries.map((entry) {
                                      final index = entry.key;
                                      final row = entry.value;
                                      return TableRow(children: [
                                        _BodyCell('${index + 1}'),
                                        Padding(
                                          padding: const EdgeInsets.all(4),
                                          child: OutlinedButton(
                                            onPressed:
                                                selectedDestinationOutlet ==
                                                        null
                                                    ? null
                                                    : () => pickMaterial(
                                                          row,
                                                          materials,
                                                          catalog
                                                              .rawMaterialCategories,
                                                          outlet,
                                                          selectedDestinationOutlet,
                                                        ),
                                            child: Align(
                                              alignment: Alignment.centerLeft,
                                              child: Text(
                                                row.material?.name ??
                                                    'Pilih produk',
                                                overflow: TextOverflow.ellipsis,
                                              ),
                                            ),
                                          ),
                                        ),
                                        Padding(
                                          padding: const EdgeInsets.all(4),
                                          child: TextField(
                                            controller: row.quantityController,
                                            keyboardType: const TextInputType
                                                .numberWithOptions(
                                                decimal: true),
                                            decoration: const InputDecoration(
                                                isDense: true),
                                            onChanged: (_) => setState(() {}),
                                          ),
                                        ),
                                        _BodyCell(row.material?.unit ?? '-'),
                                        _BodyCell(row.material?.type == 'biaya'
                                            ? 'Biaya Produksi'
                                            : row.material == null
                                                ? '-'
                                                : 'HPP'),
                                        IconButton(
                                          onPressed: rows.length == 1
                                              ? null
                                              : () => setState(() {
                                                    row.dispose();
                                                    rows.removeAt(index);
                                                  }),
                                          icon: const Icon(Icons.close),
                                        ),
                                      ]);
                                    }),
                                  ],
                                ),
                              ),
                      ),
                      const SizedBox(height: 8),
                      Row(children: [
                        OutlinedButton.icon(
                          onPressed: canCreate ? addRow : null,
                          icon: const Icon(Icons.add),
                          label: const Text('Tambah Baris'),
                        ),
                        const Spacer(),
                        Text(
                            '${rows.where((row) => row.material != null && row.quantity > 0).length} item valid',
                            style:
                                const TextStyle(fontWeight: FontWeight.w800)),
                      ]),
                      const SizedBox(height: 10),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton(
                          onPressed: !canCreate ||
                                  transferProvider.submitting ||
                                  selectedToOutlet == null
                              ? null
                              : submit,
                          child: Text(transferProvider.submitting
                              ? 'Menyimpan...'
                              : 'Submit Transfer'),
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
                    Text('Riwayat Transfer',
                        style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 12),
                    Expanded(
                      child: transferProvider.loading
                          ? const BackendSkeleton(rows: 6)
                          : BackendLoadingOverlay(
                              loading: transferProvider.refreshing,
                              child: transfers.isEmpty
                                  ? const Center(
                                      child: Text('Belum ada transfer.'))
                                  : ListView.separated(
                                      itemCount: transfers.length,
                                      separatorBuilder: (_, __) =>
                                          const Divider(),
                                      itemBuilder: (context, index) {
                                        final transfer = transfers[index];
                                        final status = transfer.synced
                                            ? transfer.status
                                            : 'pending sync';
                                        final isOutgoing =
                                            transfer.fromOutletId == outlet.id;
                                        final directionLabel =
                                            isOutgoing ? 'Keluar' : 'Masuk';
                                        final directionOutlet = isOutgoing
                                            ? (transfer.toOutletName.isEmpty
                                                ? transfer.toOutletId
                                                : transfer.toOutletName)
                                            : (transfer.fromOutletName.isEmpty
                                                ? transfer.fromOutletId
                                                : transfer.fromOutletName);
                                        return ListTile(
                                          onTap: () => showTransferDetail(
                                              transfer, outlet),
                                          title: Text(
                                            '${formatDateTime(transfer.date)} · ${transfer.items.length} item',
                                            style: const TextStyle(
                                                color: AppColors.darkText,
                                                fontWeight: FontWeight.w800),
                                          ),
                                          subtitle: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              const SizedBox(height: 4),
                                              Wrap(
                                                spacing: 6,
                                                runSpacing: 4,
                                                crossAxisAlignment:
                                                    WrapCrossAlignment.center,
                                                children: [
                                                  Container(
                                                    padding: const EdgeInsets
                                                        .symmetric(
                                                        horizontal: 8,
                                                        vertical: 3),
                                                    decoration: BoxDecoration(
                                                      color: isOutgoing
                                                          ? const Color(
                                                              0xFFFFE7E7)
                                                          : const Color(
                                                              0xFFE5F4EF),
                                                      borderRadius:
                                                          BorderRadius.circular(
                                                              8),
                                                    ),
                                                    child: Text(
                                                      directionLabel,
                                                      style: TextStyle(
                                                        color: isOutgoing
                                                            ? const Color(
                                                                0xFFB42318)
                                                            : const Color(
                                                                0xFF13795B),
                                                        fontWeight:
                                                            FontWeight.w800,
                                                        fontSize: 12,
                                                      ),
                                                    ),
                                                  ),
                                                  _SmallTransferBadge(
                                                    label: transferTypeLabel(
                                                        transfer),
                                                    color: transfer
                                                            .loanReturnForTransferId
                                                            .isNotEmpty
                                                        ? const Color(
                                                            0xFF7C3AED)
                                                        : transfer.transferType ==
                                                                'loan'
                                                            ? const Color(
                                                                0xFFB45309)
                                                            : AppColors
                                                                .mutedBlue,
                                                  ),
                                                  if (transfer
                                                      .loanStatus.isNotEmpty)
                                                    _SmallTransferBadge(
                                                      label: loanStatusLabel(
                                                          transfer.loanStatus),
                                                      color: const Color(
                                                          0xFF13795B),
                                                    ),
                                                  Text(
                                                    '${isOutgoing ? 'Ke' : 'Dari'} $directionOutlet · $status',
                                                    style: const TextStyle(
                                                        color: AppColors
                                                            .mutedBlue),
                                                  ),
                                                ],
                                              ),
                                              if (transfer
                                                  .rejectionNote.isNotEmpty)
                                                Padding(
                                                  padding:
                                                      const EdgeInsets.only(
                                                          top: 4),
                                                  child: Text(
                                                    transfer.rejectionNote,
                                                    style: const TextStyle(
                                                        color:
                                                            Color(0xFFB42318)),
                                                  ),
                                                ),
                                            ],
                                          ),
                                          trailing:
                                              const Icon(Icons.chevron_right),
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

class _TransferDetailDialog extends StatelessWidget {
  const _TransferDetailDialog({
    required this.currentOutletId,
    required this.allowCreate,
    required this.onCreateLoanReturn,
    required this.transfer,
  });

  final String currentOutletId;
  final bool allowCreate;
  final VoidCallback onCreateLoanReturn;
  final TransferRequest transfer;

  @override
  Widget build(BuildContext context) {
    final isOutgoing = transfer.fromOutletId == currentOutletId;
    final status = transfer.synced ? transfer.status : 'pending sync';
    final directionLabel = isOutgoing ? 'Keluar' : 'Masuk';
    final directionColor =
        isOutgoing ? const Color(0xFFB42318) : const Color(0xFF13795B);
    final sourceLabel = transfer.source.isEmpty
        ? (transfer.synced ? '-' : 'local')
        : transfer.source;
    final canCreateLoanReturn = transfer.transferType == 'loan' &&
        transfer.status == 'approved' &&
        transfer.toOutletId == currentOutletId &&
        transfer.loanStatus != 'returned' &&
        (transfer.loanRemainingItems.isNotEmpty
            ? transfer.loanRemainingItems.any((item) => item.quantity > 0)
            : transfer.items.any((item) => item.quantity > 0));
    return AlertDialog(
      title: const Text('Detail Transfer'),
      content: SizedBox(
        width: 640,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  _DetailPill(
                    label: directionLabel,
                    color: directionColor,
                    backgroundColor: isOutgoing
                        ? const Color(0xFFFFE7E7)
                        : const Color(0xFFE5F4EF),
                  ),
                  _DetailPill(label: status, color: AppColors.darkText),
                  _DetailPill(
                    label: transferTypeLabel(transfer),
                    color: transfer.loanReturnForTransferId.isNotEmpty
                        ? const Color(0xFF7C3AED)
                        : transfer.transferType == 'loan'
                            ? const Color(0xFFB45309)
                            : AppColors.mutedBlue,
                  ),
                  if (transfer.loanStatus.isNotEmpty)
                    _DetailPill(
                      label: loanStatusLabel(transfer.loanStatus),
                      color: const Color(0xFF13795B),
                      backgroundColor: const Color(0xFFE5F4EF),
                    ),
                ],
              ),
              const SizedBox(height: 14),
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  _InfoBox(
                    label: 'Tanggal & Jam Operasional',
                    value: formatDateTime(transfer.date),
                  ),
                  _InfoBox(
                    label: 'Outlet Asal',
                    value: transfer.fromOutletName.isEmpty
                        ? transfer.fromOutletId
                        : transfer.fromOutletName,
                  ),
                  _InfoBox(
                    label: 'Outlet Tujuan',
                    value: transfer.toOutletName.isEmpty
                        ? transfer.toOutletId
                        : transfer.toOutletName,
                  ),
                  _InfoBox(label: 'Source', value: sourceLabel),
                  if (transfer.loanReturnForTransferId.isNotEmpty)
                    _InfoBox(
                      label: 'Loan Asal',
                      value: transfer.loanReturnForTransferId,
                    ),
                ],
              ),
              const SizedBox(height: 12),
              _NoteBox(label: 'Catatan', value: transfer.note),
              if (transfer.rejectionNote.isNotEmpty) ...[
                const SizedBox(height: 8),
                _NoteBox(
                  label: 'Alasan reject',
                  value: transfer.rejectionNote,
                  color: const Color(0xFFB42318),
                ),
              ],
              const SizedBox(height: 14),
              if (transfer.transferType == 'loan') ...[
                Text(
                  'Sisa Pinjaman',
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                ),
                const SizedBox(height: 8),
                Table(
                  border: TableBorder.all(color: const Color(0xFFE2E8F0)),
                  columnWidths: const {
                    0: FlexColumnWidth(2.2),
                    1: FixedColumnWidth(92),
                    2: FixedColumnWidth(82),
                    3: FixedColumnWidth(82),
                  },
                  defaultVerticalAlignment: TableCellVerticalAlignment.middle,
                  children: [
                    const TableRow(
                      decoration: BoxDecoration(color: Color(0xFFF8FAFC)),
                      children: [
                        _HeadCell('Produk'),
                        _HeadCell('Dipinjam'),
                        _HeadCell('Kembali'),
                        _HeadCell('Sisa'),
                      ],
                    ),
                    ...transfer.items.map((item) {
                      final returned = transfer.loanReturnedItems
                          .where((returnedItem) =>
                              returnedItem.materialId == item.materialId)
                          .fold<double>(
                              0,
                              (sum, returnedItem) =>
                                  sum + returnedItem.quantity);
                      final remaining = transfer.loanRemainingItems
                          .where((remainingItem) =>
                              remainingItem.materialId == item.materialId)
                          .fold<double>(
                              0,
                              (sum, remainingItem) =>
                                  sum + remainingItem.quantity);
                      return TableRow(
                        children: [
                          _BodyCell(item.materialName.isEmpty
                              ? item.materialId
                              : item.materialName),
                          _BodyCell(formatNumber(item.quantity)),
                          _BodyCell(formatNumber(returned)),
                          _BodyCell(formatNumber(remaining)),
                        ],
                      );
                    }),
                  ],
                ),
                const SizedBox(height: 14),
              ],
              Text(
                'Item Transfer',
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
              ),
              const SizedBox(height: 8),
              Table(
                border: TableBorder.all(color: const Color(0xFFE2E8F0)),
                columnWidths: const {
                  0: FixedColumnWidth(42),
                  1: FlexColumnWidth(2.4),
                  2: FixedColumnWidth(112),
                  3: FixedColumnWidth(96),
                  4: FixedColumnWidth(80),
                },
                defaultVerticalAlignment: TableCellVerticalAlignment.middle,
                children: [
                  const TableRow(
                    decoration: BoxDecoration(color: Color(0xFFF8FAFC)),
                    children: [
                      _HeadCell('No'),
                      _HeadCell('Harga Pokok Produksi'),
                      _HeadCell('Type'),
                      _HeadCell('Jumlah'),
                      _HeadCell('Satuan'),
                    ],
                  ),
                  ...transfer.items.asMap().entries.map((entry) {
                    final item = entry.value;
                    return TableRow(
                      children: [
                        _BodyCell('${entry.key + 1}'),
                        _BodyCell(item.materialName.isEmpty
                            ? item.materialId
                            : item.materialName),
                        _BodyCell(item.materialType == 'biaya'
                            ? 'Biaya Produksi'
                            : 'HPP'),
                        _BodyCell(formatNumber(item.quantity)),
                        _BodyCell(item.unit),
                      ],
                    );
                  }),
                ],
              ),
            ],
          ),
        ),
      ),
      actions: [
        if (canCreateLoanReturn && allowCreate)
          ElevatedButton.icon(
            onPressed: onCreateLoanReturn,
            icon: const Icon(Icons.assignment_return_outlined),
            label: const Text('Buat Pengembalian'),
          ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Tutup'),
        ),
      ],
    );
  }
}

String transferTypeLabel(TransferRequest transfer) {
  if (transfer.loanReturnForTransferId.isNotEmpty) {
    return 'Pengembalian Pinjaman';
  }
  return transfer.transferType == 'loan' ? 'Pinjaman' : 'Transfer Biasa';
}

String loanStatusLabel(String status) {
  switch (status) {
    case 'pending':
      return 'Menunggu approval';
    case 'open':
      return 'Belum kembali';
    case 'partial_returned':
      return 'Dikembalikan sebagian';
    case 'returned':
      return 'Selesai';
    case 'rejected':
      return 'Ditolak';
    default:
      return status;
  }
}

class _SmallTransferBadge extends StatelessWidget {
  const _SmallTransferBadge({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          border: Border.all(color: color.withOpacity(0.35)),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: color,
            fontSize: 12,
            fontWeight: FontWeight.w800,
          ),
        ),
      );
}

class _DetailPill extends StatelessWidget {
  const _DetailPill({
    required this.color,
    required this.label,
    this.backgroundColor = const Color(0xFFEFF4F8),
  });

  final Color backgroundColor;
  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: backgroundColor,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: color,
            fontSize: 12,
            fontWeight: FontWeight.w800,
          ),
        ),
      );
}

class _InfoBox extends StatelessWidget {
  const _InfoBox({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Container(
        width: 148,
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          border: Border.all(color: const Color(0xFFE2E8F0)),
          borderRadius: BorderRadius.circular(10),
        ),
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
            const SizedBox(height: 4),
            Text(
              value.isEmpty ? '-' : value,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ],
        ),
      );
}

class _NoteBox extends StatelessWidget {
  const _NoteBox({
    required this.label,
    required this.value,
    this.color = AppColors.darkText,
  });

  final Color color;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          border: Border.all(color: const Color(0xFFE2E8F0)),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text(
          '$label: ${value.isEmpty ? '-' : value}',
          style: TextStyle(color: color, fontSize: 13),
        ),
      );
}

class _TransferDraftRow {
  RawMaterial? material;
  final quantityController = TextEditingController();

  double get quantity =>
      double.tryParse(quantityController.text.replaceAll(',', '.')) ?? 0;

  void dispose() {
    quantityController.dispose();
  }
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
  Widget build(BuildContext context) => SizedBox(
        width: double.infinity,
        child: OutlinedButton.icon(
          onPressed: onPressed,
          icon: const Icon(Icons.event_available_outlined, size: 18),
          label: Align(
            alignment: Alignment.centerLeft,
            child: Text('Tanggal & Jam Operasional: ${formatDateTime(value)}'),
          ),
        ),
      );
}

String formatPlainNumber(num value) =>
    value % 1 == 0 ? value.toInt().toString() : value.toStringAsFixed(2);
