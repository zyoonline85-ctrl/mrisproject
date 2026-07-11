import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/app_models.dart';
import '../providers/auth_provider.dart';
import '../providers/catalog_provider.dart';
import '../providers/expense_provider.dart';
import '../providers/outlet_provider.dart';
import '../services/activity_log_service.dart';
import '../theme/app_colors.dart';
import '../utils/formatters.dart';
import '../utils/input_formatters.dart';
import '../utils/responsive_layout.dart';
import '../widgets/backend_loading.dart';

class ExpensesScreen extends StatefulWidget {
  const ExpensesScreen({super.key});
  @override
  State<ExpensesScreen> createState() => _ExpensesScreenState();
}

class _ExpensesScreenState extends State<ExpensesScreen> {
  final amountController = TextEditingController();
  final noteController = TextEditingController();
  String? selectedCategory;
  DateTime expenseDate = DateTime.now();
  String? _lastFetchKey;

  @override
  void dispose() {
    amountController.dispose();
    noteController.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    if (context.read<AuthProvider>().user?.can('apk.expenses', 'create') !=
        true) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Role tidak memiliki izin membuat pengeluaran.')));
      return;
    }
    final amount = parseThousandsInput(amountController.text);
    final category = selectedCategory;
    if (amount <= 0 || category == null) return;
    final outlet = context.read<OutletProvider>().selectedOutlet!;
    await context.read<ExpenseProvider>().addExpense(
        outletId: outlet.id,
        category: category,
        amount: amount,
        note: noteController.text.trim(),
        date: expenseDate);
    amountController.clear();
    noteController.clear();
    setState(() => expenseDate = DateTime.now());
  }

  Future<void> pickExpenseDateTime() async {
    final picked = await _pickOperationalDateTime(context, expenseDate);
    if (picked == null || !mounted) return;
    setState(() => expenseDate = picked);
  }

  Future<void> editExpense(
      PosExpense expense, List<ExpenseCategory> categories) async {
    if (!expense.canEdit ||
        context.read<AuthProvider>().user?.can('apk.expenses', 'update') !=
            true) {
      return;
    }
    final editAmountController =
        TextEditingController(text: formatNumber(expense.amount));
    final editNoteController = TextEditingController(text: expense.note);
    var editCategory = categories
            .any((category) => category.name == expense.category)
        ? expense.category
        : (categories.isNotEmpty ? categories.first.name : expense.category);

    final result = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return StatefulBuilder(builder: (context, setDialogState) {
          return AlertDialog(
            title: const Text('Edit Pengeluaran'),
            content: SizedBox(
              width: 420,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Bisa diedit selama belum approved admin.',
                    style: TextStyle(
                      color: AppColors.mutedBlue,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    value: editCategory,
                    decoration: const InputDecoration(labelText: 'Kategori'),
                    dropdownColor: Colors.white,
                    items: categories
                        .map((category) => DropdownMenuItem(
                              value: category.name,
                              child: Text(category.name),
                            ))
                        .toList(),
                    onChanged: (value) {
                      if (value == null) return;
                      setDialogState(() => editCategory = value);
                    },
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: editAmountController,
                    keyboardType: TextInputType.number,
                    inputFormatters: const [ThousandsInputFormatter()],
                    decoration: const InputDecoration(labelText: 'Nominal'),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: editNoteController,
                    decoration: const InputDecoration(labelText: 'Catatan'),
                  ),
                ],
              ),
            ),
            actions: [
              OutlinedButton(
                onPressed: () => Navigator.of(dialogContext).pop(false),
                child: const Text('Batal'),
              ),
              ElevatedButton(
                onPressed: () => Navigator.of(dialogContext).pop(true),
                child: const Text('Simpan'),
              ),
            ],
          );
        });
      },
    );

    if (result != true || !mounted) return;
    final amount = parseThousandsInput(editAmountController.text);
    if (amount <= 0) return;
    final success = await context.read<ExpenseProvider>().updateExpense(
          expense: expense,
          category: editCategory,
          amount: amount,
          note: editNoteController.text.trim(),
        );
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(success
          ? 'Pengeluaran berhasil diperbarui.'
          : context.read<ExpenseProvider>().errorMessage ??
              'Gagal update pengeluaran.'),
    ));
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
      context.read<ExpenseProvider>().fetchExpenses(
            outletId: outletId,
            from: from,
            to: now,
          );
    });
  }

  @override
  Widget build(BuildContext context) {
    final outlet = context.watch<OutletProvider>().selectedOutlet!;
    final user = context.watch<AuthProvider>().user!;
    final canCreate = user.can('apk.expenses', 'create');
    final canUpdate = user.can('apk.expenses', 'update');
    _fetchIfNeeded(outlet.id);
    final categories = context.watch<CatalogProvider>().expenseCategories;
    final expenseProvider = context.watch<ExpenseProvider>();
    final selectedValue =
        categories.any((category) => category.name == selectedCategory)
            ? selectedCategory
            : categories.isNotEmpty
                ? categories.first.name
                : null;
    selectedCategory = selectedValue;
    final expenses = expenseProvider.expenses
        .where((expense) => expense.outletId == outlet.id)
        .toList();
    final keyboardBottom = MediaQuery.viewInsetsOf(context).bottom;
    final pagePadding = ResponsiveLayout.pagePadding(context);
    final panelGap = ResponsiveLayout.panelGap(context);
    final formWidth =
        ResponsiveLayout.isLandscapeTablet(context) ? 390.0 : 400.0;
    return Padding(
        padding: EdgeInsets.all(pagePadding),
        child: Row(children: [
          SizedBox(
              width: formWidth,
              child: Card(
                  child: SingleChildScrollView(
                      keyboardDismissBehavior:
                          ScrollViewKeyboardDismissBehavior.onDrag,
                      padding: EdgeInsets.fromLTRB(
                          pagePadding == 6 ? 8 : 12,
                          pagePadding == 6 ? 8 : 12,
                          pagePadding == 6 ? 8 : 12,
                          (pagePadding == 6 ? 8 : 12) + keyboardBottom),
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Input Pengeluaran',
                                style: Theme.of(context).textTheme.titleMedium),
                            Text(
                              '${outlet.name} · menunggu approval Admin',
                              style: const TextStyle(
                                color: AppColors.mutedBlue,
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 12),
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                color:
                                    AppColors.appBackground.withOpacity(0.65),
                                border: Border.all(color: AppColors.border),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: const Text(
                                'Input biaya operasional dari kasir. Data belum masuk laporan sampai Admin approve.',
                                style: TextStyle(
                                  color: AppColors.mutedBlue,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            const SizedBox(height: 12),
                            if (categories.isEmpty)
                              Container(
                                  width: double.infinity,
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                      color: AppColors.appBackground,
                                      border:
                                          Border.all(color: AppColors.border),
                                      borderRadius: BorderRadius.circular(8)),
                                  child: const Text(
                                      'Kategori pengeluaran belum tersedia. Buat atau aktifkan dari Admin, lalu sync catalog.',
                                      style: TextStyle(
                                          color: AppColors.mutedBlue,
                                          fontSize: 12,
                                          fontWeight: FontWeight.w700)))
                            else
                              DropdownButtonFormField<String>(
                                  value: selectedValue,
                                  decoration: const InputDecoration(
                                      labelText: 'Kategori Pengeluaran',
                                      prefixIcon:
                                          Icon(Icons.category_outlined)),
                                  dropdownColor: Colors.white,
                                  style: const TextStyle(
                                      color: AppColors.darkText,
                                      fontWeight: FontWeight.w700),
                                  items: categories
                                      .map((category) => DropdownMenuItem(
                                          value: category.name,
                                          child: Text(category.name,
                                              style: const TextStyle(
                                                  color: AppColors.darkText))))
                                      .toList(),
                                  onChanged: canCreate
                                      ? (value) => setState(
                                          () => selectedCategory = value)
                                      : null),
                            const SizedBox(height: 8),
                            _OperationalDateTimeField(
                              value: expenseDate,
                              onPressed: pickExpenseDateTime,
                            ),
                            const SizedBox(height: 8),
                            TextField(
                                style:
                                    const TextStyle(color: AppColors.darkText),
                                controller: amountController,
                                readOnly: !canCreate,
                                scrollPadding:
                                    const EdgeInsets.only(bottom: 220),
                                keyboardType: TextInputType.number,
                                inputFormatters: const [
                                  ThousandsInputFormatter()
                                ],
                                decoration: const InputDecoration(
                                    labelText: 'Nominal',
                                    prefixText: 'Rp ',
                                    prefixIcon: Icon(Icons.payments_outlined))),
                            const SizedBox(height: 8),
                            TextField(
                                style:
                                    const TextStyle(color: AppColors.darkText),
                                controller: noteController,
                                readOnly: !canCreate,
                                scrollPadding:
                                    const EdgeInsets.only(bottom: 220),
                                minLines: 2,
                                maxLines: 4,
                                decoration: const InputDecoration(
                                    labelText: 'Catatan',
                                    hintText:
                                        'Contoh: gas tambahan, tissue, service alat',
                                    alignLabelWithHint: true,
                                    prefixIcon: Icon(Icons.notes_outlined))),
                            const SizedBox(height: 12),
                            SizedBox(
                                width: double.infinity,
                                child: ElevatedButton(
                                    onPressed: !canCreate ||
                                            categories.isEmpty ||
                                            expenseProvider.submitting
                                        ? null
                                        : submit,
                                    child: Text(expenseProvider.submitting
                                        ? 'Menyimpan...'
                                        : 'Simpan Pengeluaran')))
                          ])))),
          SizedBox(width: panelGap),
          Expanded(
              child: Card(
                  child: Padding(
                      padding: EdgeInsets.all(pagePadding == 6 ? 8 : 12),
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Riwayat Pengeluaran',
                                style: Theme.of(context).textTheme.titleMedium),
                            const SizedBox(height: 12),
                            Expanded(
                              child: expenseProvider.loading
                                  ? const BackendSkeleton(rows: 6)
                                  : BackendLoadingOverlay(
                                      loading: expenseProvider.refreshing,
                                      child: expenses.isEmpty
                                          ? const Center(
                                              child: Text(
                                                  'Belum ada pengeluaran.',
                                                  style: TextStyle(
                                                      color:
                                                          AppColors.darkText)))
                                          : ListView.separated(
                                              itemCount: expenses.length,
                                              separatorBuilder: (_, __) =>
                                                  const Divider(),
                                              itemBuilder: (context, index) {
                                                final expense = expenses[index];
                                                final statusText = !expense
                                                        .synced
                                                    ? 'pending sync'
                                                    : expense.status ==
                                                            'approved'
                                                        ? 'approved'
                                                        : expense.status ==
                                                                'rejected'
                                                            ? 'rejected'
                                                            : 'menunggu approval';
                                                final rejectionText = expense
                                                                .status ==
                                                            'rejected' &&
                                                        expense.rejectionNote
                                                            .isNotEmpty
                                                    ? ' · Ditolak: ${expense.rejectionNote}'
                                                    : '';
                                                return ListTile(
                                                    onTap: expense.canEdit &&
                                                            canUpdate
                                                        ? () async {
                                                            await const ActivityLogService()
                                                                .record(
                                                              outletId: expense
                                                                  .outletId,
                                                              module: 'expense',
                                                              action:
                                                                  'edit_open',
                                                              entityType:
                                                                  'expense',
                                                              entityId:
                                                                  expense.id,
                                                              description:
                                                                  'Membuka form edit pengeluaran.',
                                                            );
                                                            if (!context
                                                                .mounted) {
                                                              return;
                                                            }
                                                            editExpense(expense,
                                                                categories);
                                                          }
                                                        : null,
                                                    title: Text(
                                                        expense.category,
                                                        style: const TextStyle(
                                                            color: AppColors
                                                                .darkText,
                                                            fontWeight:
                                                                FontWeight
                                                                    .w800)),
                                                    subtitle: Text(
                                                        '${formatDateTime(expense.date)} · ${expense.note} · $statusText$rejectionText',
                                                        style: const TextStyle(
                                                            color: AppColors
                                                                .mutedBlue)),
                                                    trailing: Row(
                                                      mainAxisSize:
                                                          MainAxisSize.min,
                                                      children: [
                                                        Text(
                                                            formatCurrency(
                                                                expense.amount),
                                                            style: const TextStyle(
                                                                color: AppColors
                                                                    .darkText,
                                                                fontWeight:
                                                                    FontWeight
                                                                        .w800)),
                                                        if (expense.canEdit &&
                                                            canUpdate) ...[
                                                          const SizedBox(
                                                              width: 8),
                                                          IconButton(
                                                            tooltip:
                                                                'Edit sebelum approved',
                                                            onPressed: () =>
                                                                editExpense(
                                                                    expense,
                                                                    categories),
                                                            icon: const Icon(Icons
                                                                .edit_outlined),
                                                          ),
                                                        ],
                                                      ],
                                                    ));
                                              })),
                            )
                          ])))),
        ]));
  }
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
