import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/app_models.dart';
import '../providers/auth_provider.dart';
import '../providers/outlet_provider.dart';
import '../providers/stock_opname_provider.dart';
import '../services/activity_log_service.dart';
import '../theme/app_colors.dart';
import '../utils/formatters.dart';
import '../utils/responsive_layout.dart';

class StockOpnameScreen extends StatefulWidget {
  const StockOpnameScreen({super.key});

  @override
  State<StockOpnameScreen> createState() => _StockOpnameScreenState();
}

class _StockOpnameScreenState extends State<StockOpnameScreen> {
  final noteController = TextEditingController();
  final tableScrollController = ScrollController();
  final horizontalTableScrollController = ScrollController();
  final rows = <_OpnameDraftRow>[];
  DateTime opnameDate = DateTime.now();
  String? _lastFetchKey;
  StockOpnameRequest? _editingRequest;

  @override
  void dispose() {
    noteController.dispose();
    tableScrollController.dispose();
    horizontalTableScrollController.dispose();
    for (final row in rows) {
      row.dispose();
    }
    super.dispose();
  }

  void _fetchIfNeeded(String outletId) {
    final now = DateTime.now();
    final from = DateTime(now.year, now.month, 1);
    final key = '$outletId-${toApiDate(opnameDate)}';
    if (_lastFetchKey == key) return;
    _lastFetchKey = key;
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      if (_editingRequest != null && _editingRequest!.outletId != outletId) {
        setState(() {
          _editingRequest = null;
          noteController.clear();
        });
      }
      final provider = context.read<StockOpnameProvider>();
      await provider.fetchWorksheet(outletId: outletId, date: opnameDate);
      if (!mounted) return;
      _setRows(provider.worksheetRows);
      await provider.fetchRequests(outletId: outletId, from: from, to: now);
    });
  }

  void _setRows(
    List<StockOpnameWorksheetRow> nextRows, {
    Set<String> preserveValuesFor = const {},
  }) {
    setState(() {
      for (final row in rows) {
        row.dispose();
      }
      rows
        ..clear()
        ..addAll(nextRows.map((row) => _OpnameDraftRow(
              row,
              initializeFromData: preserveValuesFor.contains(row.materialId),
            )));
    });
  }

  List<StockOpnameWorksheetRow> _mergeWorksheetWithSnapshot(
    List<StockOpnameWorksheetRow> worksheet,
    List<StockOpnameWorksheetRow> snapshot,
  ) {
    final snapshotById = {for (final item in snapshot) item.materialId: item};
    final merged = worksheet.map((fresh) {
      final previous = snapshotById.remove(fresh.materialId);
      if (previous == null) return fresh;
      return fresh.copyWith(
        openingQuantity: previous.openingQuantity,
        damageQuantity: previous.damageQuantity,
        actualQuantity: previous.actualQuantity,
        note: previous.note,
      );
    }).toList();
    merged.addAll(snapshotById.values);
    return merged;
  }

  Future<void> _loadWorksheet({List<StockOpnameWorksheetRow>? snapshot}) async {
    final outlet = context.read<OutletProvider>().selectedOutlet!;
    final provider = context.read<StockOpnameProvider>();
    _lastFetchKey = '${outlet.id}-${toApiDate(opnameDate)}';
    await provider.fetchWorksheet(outletId: outlet.id, date: opnameDate);
    if (!mounted) return;
    final previous = snapshot ?? const <StockOpnameWorksheetRow>[];
    final merged = previous.isEmpty
        ? provider.worksheetRows
        : _mergeWorksheetWithSnapshot(provider.worksheetRows, previous);
    _setRows(
      merged,
      preserveValuesFor: previous.map((item) => item.materialId).toSet(),
    );
  }

  Future<void> _pickDate() async {
    final pickedDate = await showDatePicker(
      context: context,
      initialDate: opnameDate,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (pickedDate == null || !mounted) return;
    final pickedTime = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(opnameDate),
    );
    if (pickedTime == null) return;
    final snapshot = _editingRequest == null
        ? const <StockOpnameWorksheetRow>[]
        : rows.map((row) => row.data).toList();
    setState(() {
      opnameDate = DateTime(
        pickedDate.year,
        pickedDate.month,
        pickedDate.day,
        pickedTime.hour,
        pickedTime.minute,
      );
    });
    await _loadWorksheet(snapshot: snapshot);
  }

  Future<void> _refresh() async {
    final snapshot = _editingRequest == null
        ? const <StockOpnameWorksheetRow>[]
        : rows.map((row) => row.data).toList();
    await _loadWorksheet(snapshot: snapshot);
  }

  Future<void> _startEdit(StockOpnameRequest request) async {
    if (context.read<AuthProvider>().user?.can('apk.opnames', 'update') !=
        true) {
      return;
    }
    setState(() {
      _editingRequest = request;
      opnameDate = request.date;
      noteController.text = request.note;
    });
    await _loadWorksheet(snapshot: request.items);
  }

  Future<void> _cancelEdit() async {
    setState(() {
      _editingRequest = null;
      opnameDate = DateTime.now();
      noteController.clear();
    });
    await _loadWorksheet();
  }

  Future<void> _submit() async {
    final requiredAction = _editingRequest == null ? 'create' : 'update';
    if (context.read<AuthProvider>().user?.can('apk.opnames', requiredAction) !=
        true) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('Role tidak memiliki izin $requiredAction opname.')));
      return;
    }
    final outlet = context.read<OutletProvider>().selectedOutlet!;
    final provider = context.read<StockOpnameProvider>();
    final editing = _editingRequest;
    final saved = editing == null
        ? await provider.submitRequest(
            outletId: outlet.id,
            outletName: outlet.name,
            outletCode: outlet.code,
            date: opnameDate,
            rows: rows.map((row) => row.data).toList(),
            note: noteController.text.trim(),
          )
        : await provider.updateRequest(editing.copyWith(
            date: opnameDate,
            note: noteController.text.trim(),
            items: rows.map((row) => row.data).toList(),
          ));
    if (!mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    if (saved == null) {
      messenger.showSnackBar(SnackBar(
        content: Text(provider.errorMessage ??
            'Request opname gagal. Cek koneksi backend.'),
      ));
      return;
    }
    setState(() => _editingRequest = null);
    noteController.clear();
    messenger.showSnackBar(SnackBar(
      content: Text(editing == null
          ? 'Request opname terkirim. Menunggu approval admin.'
          : 'Request opname berhasil diperbarui.'),
    ));
    await _loadWorksheet();
  }

  @override
  Widget build(BuildContext context) {
    final keyboardInset = MediaQuery.viewInsetsOf(context).bottom;
    final keyboardOpen = keyboardInset > 0;
    final outlet = context.watch<OutletProvider>().selectedOutlet!;
    final currentUser = context.watch<AuthProvider>().user!;
    final currentUserId = currentUser.id;
    final canCreate = currentUser.can('apk.opnames', 'create');
    final canUpdate = currentUser.can('apk.opnames', 'update');
    final canWrite = _editingRequest == null ? canCreate : canUpdate;
    final provider = context.watch<StockOpnameProvider>();
    _fetchIfNeeded(outlet.id);
    final requests = provider.requests
        .where((request) => request.outletId == outlet.id)
        .toList();
    final pagePadding = ResponsiveLayout.pagePadding(context);
    final panelGap = ResponsiveLayout.panelGap(context);
    final formWidth = ResponsiveLayout.formPanelWidth(
      context,
      compact: 640,
      normal: 720,
      max: 760,
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
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                  _editingRequest == null
                                      ? 'Input Stock Opname'
                                      : 'Edit Request Stock Opname',
                                  style:
                                      Theme.of(context).textTheme.titleMedium),
                              Text(
                                outlet.name,
                                style: const TextStyle(
                                    color: AppColors.mutedBlue, fontSize: 12),
                              ),
                            ],
                          ),
                        ),
                        OutlinedButton.icon(
                          onPressed: canWrite ? _pickDate : null,
                          icon: const Icon(Icons.calendar_month),
                          label: Text(formatDateTime(opnameDate)),
                        ),
                        const SizedBox(width: 8),
                        IconButton.filledTonal(
                          onPressed:
                              provider.loadingWorksheet ? null : _refresh,
                          icon: const Icon(Icons.refresh),
                        ),
                      ]),
                      const SizedBox(height: 8),
                      TextField(
                        controller: noteController,
                        readOnly: !canWrite,
                        decoration: const InputDecoration(
                          labelText: 'Catatan opsional',
                          hintText: 'Catatan untuk admin approval',
                        ),
                      ),
                      const SizedBox(height: 12),
                      _Summary(rows: rows),
                      const SizedBox(height: 8),
                      const _OpnameInputHelp(),
                      const SizedBox(height: 12),
                      SizedBox(
                        height: keyboardOpen ? 240 : 400,
                        child: provider.loadingWorksheet
                            ? const Center(child: CircularProgressIndicator())
                            : rows.isEmpty
                                ? const Center(
                                    child: Text(
                                      'Admin belum memilih item Stock Opname APK untuk outlet ini.',
                                      textAlign: TextAlign.center,
                                    ),
                                  )
                                : IgnorePointer(
                                    ignoring: !canWrite,
                                    child: _OpnameInputTable(
                                      rows: rows,
                                      verticalController: tableScrollController,
                                      horizontalController:
                                          horizontalTableScrollController,
                                      onRowChanged: () => setState(() {}),
                                    ),
                                  ),
                      ),
                      const SizedBox(height: 10),
                      Row(children: [
                        if (_editingRequest != null) ...[
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed:
                                  provider.submitting ? null : _cancelEdit,
                              icon: const Icon(Icons.close),
                              label: const Text('Batal Edit'),
                            ),
                          ),
                          const SizedBox(width: 8),
                        ],
                        Expanded(
                          child: ElevatedButton.icon(
                            onPressed:
                                !canWrite || provider.submitting || rows.isEmpty
                                    ? null
                                    : _submit,
                            icon: const Icon(Icons.save_outlined),
                            label: Text(provider.submitting
                                ? 'Menyimpan...'
                                : _editingRequest == null
                                    ? 'Kirim Request Opname'
                                    : 'Simpan Perubahan'),
                          ),
                        ),
                      ]),
                      const SizedBox(height: 6),
                      const Text(
                        'Online wajib. Stok tidak berubah sampai Admin approve.',
                        style:
                            TextStyle(color: AppColors.mutedBlue, fontSize: 12),
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
                    Text('Riwayat Request Opname',
                        style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 4),
                    const Text(
                      'Status request dari APK dan hasil approval Admin.',
                      style:
                          TextStyle(color: AppColors.mutedBlue, fontSize: 12),
                    ),
                    const SizedBox(height: 12),
                    Expanded(
                      child: provider.loadingRequests
                          ? const Center(child: CircularProgressIndicator())
                          : requests.isEmpty
                              ? const Center(
                                  child: Text('Belum ada request opname.'))
                              : ListView.separated(
                                  itemCount: requests.length,
                                  separatorBuilder: (_, __) =>
                                      const Divider(height: 1),
                                  itemBuilder: (context, index) {
                                    final request = requests[index];
                                    return ListTile(
                                      contentPadding: EdgeInsets.zero,
                                      title: Text(request.batchId.isNotEmpty
                                          ? request.batchId
                                          : request.id),
                                      subtitle: Text(
                                          '${formatDateTime(request.date)} · ${request.items.length} item'),
                                      trailing: Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          if (request
                                                  .canEditBy(currentUserId) &&
                                              canUpdate)
                                            IconButton(
                                              tooltip: 'Edit request pending',
                                              onPressed: provider.submitting
                                                  ? null
                                                  : () => _startEdit(request),
                                              icon: const Icon(
                                                  Icons.edit_outlined),
                                            ),
                                          _StatusBadge(status: request.status),
                                        ],
                                      ),
                                      onTap: () =>
                                          _showRequestDetail(context, request),
                                    );
                                  },
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

class _Summary extends StatelessWidget {
  const _Summary({required this.rows});

  final List<_OpnameDraftRow> rows;

  @override
  Widget build(BuildContext context) {
    final openingFilled =
        rows.where((row) => row.data.openingQuantity > 0).length;
    final damageFilled =
        rows.where((row) => row.data.damageQuantity > 0).length;
    final actualFilled =
        rows.where((row) => row.data.actualQuantity > 0).length;
    return Row(children: [
      _SummaryChip(label: 'Item', value: '${rows.length}'),
      const SizedBox(width: 8),
      _SummaryChip(label: 'Stok Awal', value: '$openingFilled item'),
      const SizedBox(width: 8),
      _SummaryChip(label: 'Rusak', value: '$damageFilled item'),
      const SizedBox(width: 8),
      _SummaryChip(label: 'Sisa Stok', value: '$actualFilled item'),
    ]);
  }
}

class _SummaryChip extends StatelessWidget {
  const _SummaryChip({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Expanded(
        child: Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: AppColors.card,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: AppColors.border),
          ),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label,
                style:
                    const TextStyle(color: AppColors.mutedBlue, fontSize: 11)),
            const SizedBox(height: 2),
            Text(value,
                style:
                    const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          ]),
        ),
      );
}

class _OpnameInputHelp extends StatelessWidget {
  const _OpnameInputHelp();

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: AppColors.primaryTeal.withOpacity(0.08),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: AppColors.primaryTeal.withOpacity(0.22)),
        ),
        child: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Isi stok awal, rusak, dan sisa stok fisik/gudang.',
              style: TextStyle(
                color: AppColors.darkText,
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
            SizedBox(height: 4),
            Text(
              'Selisih dan nilai akan dihitung setelah request dikirim dan dicek Admin.',
              style: TextStyle(
                color: AppColors.mutedBlue,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      );
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final color = status == 'approved'
        ? Colors.green
        : status == 'rejected'
            ? AppColors.danger
            : Colors.orange;
    final label = status == 'approved'
        ? 'Approved'
        : status == 'rejected'
            ? 'Rejected'
            : 'Pending';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(label,
          style: TextStyle(
              color: color, fontWeight: FontWeight.w700, fontSize: 12)),
    );
  }
}

class _OpnameInputTable extends StatelessWidget {
  const _OpnameInputTable({
    required this.rows,
    required this.verticalController,
    required this.horizontalController,
    required this.onRowChanged,
  });

  static const _tableWidth = 720.0;

  final List<_OpnameDraftRow> rows;
  final ScrollController verticalController;
  final ScrollController horizontalController;
  final VoidCallback onRowChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(8),
      ),
      clipBehavior: Clip.antiAlias,
      child: Scrollbar(
        controller: horizontalController,
        thumbVisibility: true,
        notificationPredicate: (notification) => notification.depth == 0,
        child: SingleChildScrollView(
          controller: horizontalController,
          scrollDirection: Axis.horizontal,
          child: SizedBox(
            width: _tableWidth,
            child: Scrollbar(
              controller: verticalController,
              thumbVisibility: true,
              child: SingleChildScrollView(
                controller: verticalController,
                child: Table(
                  border: const TableBorder(
                    horizontalInside: BorderSide(color: AppColors.border),
                  ),
                  columnWidths: const {
                    0: FixedColumnWidth(44),
                    1: FixedColumnWidth(260),
                    2: FixedColumnWidth(136),
                    3: FixedColumnWidth(124),
                    4: FixedColumnWidth(136),
                  },
                  defaultVerticalAlignment: TableCellVerticalAlignment.middle,
                  children: [
                    const TableRow(
                      decoration: BoxDecoration(color: Color(0xFFF5F8FA)),
                      children: [
                        _HeadCell('No'),
                        _HeadCell('Produk'),
                        _HeadCell('Stok Awal'),
                        _HeadCell('Rusak'),
                        _HeadCell('Sisa Stok'),
                      ],
                    ),
                    ...rows.asMap().entries.map((entry) {
                      final index = entry.key;
                      final row = entry.value;
                      return TableRow(children: [
                        _BodyCell('${index + 1}'),
                        Padding(
                          padding: const EdgeInsets.all(10),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(row.data.materialName,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                      color: AppColors.darkText,
                                      fontSize: 13,
                                      fontWeight: FontWeight.w800)),
                              const SizedBox(height: 3),
                              Text(
                                '${row.data.materialType == 'biaya' ? 'Biaya Produksi' : 'HPP'} · ${row.data.unit}',
                                style: const TextStyle(
                                    color: AppColors.mutedBlue,
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700),
                              ),
                            ],
                          ),
                        ),
                        _QtyInputCell(
                          controller: row.openingController,
                          onChanged: () {
                            row.updateOpening();
                            onRowChanged();
                          },
                        ),
                        _QtyInputCell(
                          controller: row.damageController,
                          onChanged: () {
                            row.updateDamage();
                            onRowChanged();
                          },
                        ),
                        _QtyInputCell(
                          controller: row.actualController,
                          onChanged: () {
                            row.updateActual();
                            onRowChanged();
                          },
                        ),
                      ]);
                    }),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _QtyInputCell extends StatelessWidget {
  const _QtyInputCell({required this.controller, required this.onChanged});

  final TextEditingController controller;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(8),
      child: TextField(
        controller: controller,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        decoration: const InputDecoration(
          isDense: true,
          contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 12),
        ),
        onChanged: (_) => onChanged(),
      ),
    );
  }
}

class _OpnameRequestDetailTable extends StatelessWidget {
  const _OpnameRequestDetailTable({required this.items});

  static const _tableWidth = 700.0;

  final List<StockOpnameWorksheetRow> items;

  @override
  Widget build(BuildContext context) {
    final visibleItems = items.where((item) => item.hasUserInput).toList();
    if (visibleItems.isEmpty) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
        decoration: BoxDecoration(
          color: const Color(0xFFF5F8FA),
          border: Border.all(color: AppColors.border),
          borderRadius: BorderRadius.circular(8),
        ),
        child: const Text(
          'Tidak ada input Stock Opname.',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: AppColors.mutedBlue,
            fontWeight: FontWeight.w600,
          ),
        ),
      );
    }

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(8),
      ),
      clipBehavior: Clip.antiAlias,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: SizedBox(
          width: _tableWidth,
          child: Table(
            border: const TableBorder(
              horizontalInside: BorderSide(color: AppColors.border),
            ),
            columnWidths: const {
              0: FixedColumnWidth(250),
              1: FixedColumnWidth(150),
              2: FixedColumnWidth(150),
              3: FixedColumnWidth(150),
            },
            defaultVerticalAlignment: TableCellVerticalAlignment.middle,
            children: [
              const TableRow(
                decoration: BoxDecoration(color: Color(0xFFF5F8FA)),
                children: [
                  _HeadCell('Produk'),
                  _HeadCell('Stok Awal'),
                  _HeadCell('Rusak'),
                  _HeadCell('Sisa Stok'),
                ],
              ),
              ...visibleItems.map((row) {
                return TableRow(children: [
                  _BodyCell(row.materialName, maxLines: 2),
                  _BodyCell('${formatQty(row.openingQuantity)} ${row.unit}'),
                  _BodyCell('${formatQty(row.damageQuantity)} ${row.unit}'),
                  _BodyCell('${formatQty(row.actualQuantity)} ${row.unit}'),
                ]);
              }),
            ],
          ),
        ),
      ),
    );
  }
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

class _OpnameDraftRow {
  _OpnameDraftRow(
    StockOpnameWorksheetRow row, {
    bool initializeFromData = false,
  }) : data = row {
    final opening = initializeFromData ? row.openingQuantity : 0.0;
    final damage = initializeFromData ? row.damageQuantity : 0.0;
    final actual = initializeFromData ? row.actualQuantity : 0.0;
    openingController.text = formatQty(opening);
    damageController.text = formatQty(damage);
    actualController.text = formatQty(actual);
    final realSystem =
        _calculateRealSystem(row, opening: opening, damage: damage);
    final difference = realSystem - actual;
    data = row.copyWith(
      openingQuantity: opening,
      damageQuantity: damage,
      realSystemQuantity: realSystem,
      actualQuantity: actual,
      difference: difference,
      status: statusFromDifference(difference),
    );
  }

  StockOpnameWorksheetRow data;
  final openingController = TextEditingController();
  final damageController = TextEditingController();
  final actualController = TextEditingController();

  void updateOpening() {
    _recalculate();
  }

  void updateDamage() {
    _recalculate();
  }

  void _recalculate() {
    final opening = parseQty(openingController.text);
    final damage = parseQty(damageController.text);
    final actual = parseQty(actualController.text);
    final realSystem =
        _calculateRealSystem(data, opening: opening, damage: damage);
    final difference = realSystem - actual;
    data = data.copyWith(
      openingQuantity: opening,
      damageQuantity: damage,
      realSystemQuantity: realSystem,
      actualQuantity: actual,
      difference: difference,
      status: statusFromDifference(difference),
    );
  }

  void updateActual() {
    _recalculate();
  }

  void dispose() {
    openingController.dispose();
    damageController.dispose();
    actualController.dispose();
  }
}

double _calculateRealSystem(
  StockOpnameWorksheetRow row, {
  required double opening,
  required double damage,
}) =>
    row.calculateSystemQuantity(opening: opening, damage: damage);

Future<void> _showRequestDetail(
    BuildContext context, StockOpnameRequest request) async {
  await const ActivityLogService().record(
    outletId: request.outletId,
    module: 'stock_opname',
    action: 'detail_open',
    entityType: 'stock_opname_request',
    entityId: request.id,
    description: 'Membuka detail request Stock Opname.',
  );
  if (!context.mounted) return;
  showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(request.batchId.isNotEmpty ? request.batchId : request.id),
      content: SizedBox(
        width: 900,
        child: SingleChildScrollView(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${formatDateTime(request.date)} · ${request.outletName}'),
            if (request.note.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text('Catatan: ${request.note}'),
            ],
            if (request.rejectionNote.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text('Reject: ${request.rejectionNote}',
                  style: const TextStyle(color: AppColors.danger)),
            ],
            const SizedBox(height: 12),
            _OpnameRequestDetailTable(items: request.items),
          ]),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Tutup'),
        )
      ],
    ),
  );
}

String statusFromDifference(double difference) {
  if (difference.abs() < 0.001) return 'pas';
  return difference > 0 ? 'stock_hilang' : 'tidak_sesuai_standar';
}

double parseQty(String value) =>
    double.tryParse(value.trim().replaceAll(',', '.')) ?? 0;

String formatQty(num value) =>
    value % 1 == 0 ? value.toInt().toString() : value.toStringAsFixed(2);

String formatPlainNumber(num value) =>
    value % 1 == 0 ? value.toInt().toString() : value.toString();

String toApiDate(DateTime value) {
  final date = dateOnly(value);
  final month = date.month.toString().padLeft(2, '0');
  final day = date.day.toString().padLeft(2, '0');
  return '${date.year}-$month-$day';
}
