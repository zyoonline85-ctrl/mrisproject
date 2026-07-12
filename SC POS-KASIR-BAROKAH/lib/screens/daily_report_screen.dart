import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/app_models.dart';
import '../providers/auth_provider.dart';
import '../providers/catalog_provider.dart';
import '../providers/expense_provider.dart';
import '../providers/outlet_provider.dart';
import '../providers/pos_report_provider.dart';
import '../providers/purchase_provider.dart';
import '../services/daily_report_pdf_service.dart';
import '../services/api_client.dart';
import '../theme/app_colors.dart';
import '../utils/formatters.dart';

class DailyReportScreen extends StatefulWidget {
  const DailyReportScreen({super.key});

  @override
  State<DailyReportScreen> createState() => _DailyReportScreenState();
}

class _DailyReportScreenState extends State<DailyReportScreen> {
  static const _storageKey = 'barokah_pos_daily_reports_local';
  final List<Map<String, dynamic>> _reports = [];
  bool _loadingReports = true;

  // State untuk form input harian
  bool _showForm = false;
  DateTime _selectedDate = DateTime.now();
  final Map<String, int> _paymentIncomes = {};
  int _returnCashAmount = 0;
  DateTime _returnCashDate = DateTime.now();

  // List Pengeluaran di Form
  final List<_ExpenseInputLine> _expenseLines = [];

  // Autocomplete / Search data source
  List<Object> _searchItems = [];

  @override
  void initState() {
    super.initState();
    _loadOnlineReports();
  }

  Future<void> _loadLocalReports() async {
    setState(() => _loadingReports = true);
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_storageKey);
    if (raw != null) {
      final decoded = jsonDecode(raw) as List;
      _reports.clear();
      _reports.addAll(decoded.map((item) => Map<String, dynamic>.from(item)));
    }
    setState(() => _loadingReports = false);
  }

  Future<void> _loadOnlineReports() async {
    setState(() => _loadingReports = true);
    try {
      final outlet = context.read<OutletProvider>().selectedOutlet;
      if (outlet != null) {
        final dynamic data = await ApiClient.instance.get(
          '/admin/daily-reports',
          query: {'outletId': outlet.id},
        );
        if (data is List) {
          setState(() {
            _reports.clear();
            _reports.addAll(data.map((item) => Map<String, dynamic>.from(item)));
          });
          final prefs = await SharedPreferences.getInstance();
          await prefs.setString(_storageKey, jsonEncode(_reports));
        } else {
          await _loadLocalReports();
        }
      } else {
        await _loadLocalReports();
      }
    } catch (e) {
      await _loadLocalReports();
    } finally {
      setState(() => _loadingReports = false);
    }
  }

  Future<void> _saveLocalReports() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_storageKey, jsonEncode(_reports));
  }

  void _prepareSearchItems(BuildContext context) {
    final catalog = context.read<CatalogProvider>();
    _searchItems = [
      ...catalog.rawMaterials, // Type RawMaterial
      ...catalog.expenseCategories, // Type ExpenseCategory
    ];
  }

  // Otomatis fetch data penjualan untuk tanggal yang dipilih
  Future<void> _autoFillSalesData() async {
    final outlet = context.read<OutletProvider>().selectedOutlet!;
    final posReportProvider = context.read<PosReportProvider>();

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const Center(child: CircularProgressIndicator()),
    );

    try {
      await posReportProvider.fetchReport(
        outletId: outlet.id,
        from: _selectedDate,
        to: _selectedDate,
      );

      final report = posReportProvider.report;
      if (report != null) {
        setState(() {
          _paymentIncomes.clear();
          report.paymentTotals.forEach((key, val) {
            _paymentIncomes[key] = val;
          });
          // Pastikan cash, transfer, qris ada di map
          if (!_paymentIncomes.containsKey('cash')) _paymentIncomes['cash'] = 0;
          if (!_paymentIncomes.containsKey('transfer')) _paymentIncomes['transfer'] = 0;
          if (!_paymentIncomes.containsKey('qris')) _paymentIncomes['qris'] = 0;
        });
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Gagal mengambil data penjualan: $e')),
      );
    } finally {
      Navigator.pop(context); // Tutup loading dialog
    }
  }

  int get _totalIncome => _paymentIncomes.values.fold(0, (sum, val) => sum + val);

  int get _totalExpense {
    int sum = 0;
    for (final line in _expenseLines) {
      sum += line.amount;
    }
    return sum;
  }

  int get _grossProfit => _totalIncome - _totalExpense;

  int get _drawerMoney => _grossProfit - _totalIncome;

  // Jalankan Aksi Simpan Laporan Online ke Server
  Future<void> _submitReport() async {
    if (_totalIncome == 0 && _expenseLines.isEmpty && _returnCashAmount == 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Laporan tidak boleh kosong!')),
      );
      return;
    }

    final outlet = context.read<OutletProvider>().selectedOutlet!;
    final authProvider = context.read<AuthProvider>();

    final payload = {
      'outletId': outlet.id,
      'reportDate': formatDate(_selectedDate),
      'cashierId': authProvider.user?.id ?? '',
      'cashIncome': _paymentIncomes['cash'] ?? 0,
      'transferIncome': _paymentIncomes['transfer'] ?? 0,
      'qrisIncome': _paymentIncomes['qris'] ?? 0,
      'totalIncome': _totalIncome,
      'totalExpense': _totalExpense,
      'returnCashAmount': _returnCashAmount,
      'returnCashDate': formatDate(_returnCashDate),
      'grossProfit': _grossProfit,
      'drawerMoney': _drawerMoney,
      'details': _expenseLines.map((line) => {
        'isHpp': line.isHpp,
        'quantity': line.quantity,
        'price': line.price,
        'amount': line.amount,
        'note': line.note,
        'rawMaterial': line.rawMaterial != null ? {
          'id': line.rawMaterial!.id,
          'name': line.rawMaterial!.name,
          'unit': line.rawMaterial!.unit
        } : null,
        'expenseCategory': line.expenseCategory != null ? {
          'id': line.expenseCategory!.id,
          'name': line.expenseCategory!.name
        } : null
      }).toList()
    };

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const Center(child: CircularProgressIndicator()),
    );

    try {
      await ApiClient.instance.post('/admin/daily-reports', body: payload);

      setState(() {
        _showForm = false;
        _resetForm();
      });

      await _loadOnlineReports();

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Laporan harian berhasil di-submit (Pending Approval)!')),
      );
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Gagal mengirim laporan harian: $e')),
      );
    } finally {
      Navigator.pop(context);
    }
  }

  void _resetForm() {
    setState(() {
      _selectedDate = DateTime.now();
      _paymentIncomes.clear();
      _paymentIncomes['cash'] = 0;
      _paymentIncomes['transfer'] = 0;
      _paymentIncomes['qris'] = 0;
      _returnCashAmount = 0;
      _returnCashDate = DateTime.now();
      _expenseLines.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final outlet = context.watch<OutletProvider>().selectedOutlet!;
    _prepareSearchItems(context);

    // Hitung grand total rekapitulasi harian
    int grandPendapatan = 0;
    int grandPengeluaran = 0;
    int grandKembalikan = 0;
    int grandLabaKotor = 0;
    int grandUangLaci = 0;

    for (final r in _reports) {
      grandPendapatan += (r['pendapatan'] as num).toInt();
      grandPengeluaran += (r['pengeluaran'] as num).toInt();
      grandKembalikan += (r['kembalikan_uang_kas'] as num).toInt();
      grandLabaKotor += (r['laba_kotor'] as num).toInt();
      grandUangLaci += (r['uang_laci'] as num).toInt();
    }

    return Scaffold(
      body: Row(
        children: [
          // Bagian Kiri: Tabel Laporan
          Expanded(
            flex: 5,
            child: Padding(
              padding: const EdgeInsets.all(12.0),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            'Rekapitulasi Laporan Harian (MRIS)',
                            style: Theme.of(context).textTheme.titleLarge?.copyWith(
                                  fontWeight: FontWeight.bold,
                                  color: AppColors.darkText,
                                ),
                          ),
                          Row(
                            children: [
                              ElevatedButton.icon(
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: AppColors.primaryTeal,
                                  foregroundColor: Colors.white,
                                ),
                                onPressed: () {
                                  setState(() {
                                    _showForm = !_showForm;
                                    if (_showForm) {
                                      _resetForm();
                                    }
                                  });
                                  if (_showForm) {
                                    _autoFillSalesData();
                                  }
                                },
                                icon: Icon(_showForm ? Icons.close : Icons.add_rounded),
                                label: Text(_showForm ? 'Tutup Form' : 'Tambah Laporan'),
                              ),
                              const SizedBox(width: 8),
                              OutlinedButton.icon(
                                onPressed: _reports.isEmpty
                                    ? null
                                    : () async {
                                        await DailyReportPdfService.download(
                                          reports: _reports,
                                          outletName: outlet.name,
                                        );
                                      },
                                icon: const Icon(Icons.picture_as_pdf_rounded),
                                label: const Text('Download PDF'),
                              ),
                            ],
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      Expanded(
                        child: _loadingReports
                            ? const Center(child: CircularProgressIndicator())
                            : _reports.isEmpty
                                ? const Center(
                                    child: Text(
                                      'Belum ada data laporan harian yang disimpan.',
                                      style: TextStyle(color: Colors.grey),
                                    ),
                                  )
                                : SingleChildScrollView(
                                    scrollDirection: Axis.vertical,
                                    child: SingleChildScrollView(
                                      scrollDirection: Axis.horizontal,
                                      child: DataTable(
                                        border: TableBorder.all(
                                          color: AppColors.border,
                                          borderRadius: BorderRadius.circular(4),
                                        ),
                                        columns: const [
                                          DataColumn(label: Text('Tanggal')),
                                          DataColumn(label: Text('Pendapatan (A)')),
                                          DataColumn(label: Text('Pengeluaran (B)')),
                                          DataColumn(label: Text('Kembalikan Kas (C)')),
                                          DataColumn(label: Text('Laba Kotor (A-B)')),
                                          DataColumn(label: Text('Uang Laci')),
                                          DataColumn(label: Text('Status')),
                                        ],
                                        rows: [
                                          ..._reports.map((r) {
                                            final String status = r['status']?.toString() ?? 'approved';
                                            Color badgeColor = Colors.grey;
                                            if (status == 'approved') badgeColor = Colors.green;
                                            if (status == 'pending') badgeColor = Colors.orange;
                                            if (status == 'rejected') badgeColor = Colors.red;

                                            return DataRow(
                                              cells: [
                                                DataCell(Text(r['tanggal']?.toString() ?? r['report_date']?.toString() ?? '')),
                                                DataCell(Text(formatAccountingCurrency((r['pendapatan'] as num).toInt()))),
                                                DataCell(Text(formatAccountingCurrency((r['pengeluaran'] as num).toInt()))),
                                                DataCell(Text(formatAccountingCurrency((r['kembalikan_uang_kas'] as num).toInt()))),
                                                DataCell(Text(formatAccountingCurrency((r['laba_kotor'] as num).toInt()))),
                                                DataCell(Text(formatAccountingCurrency((r['uang_laci'] as num).toInt()))),
                                                DataCell(
                                                  Container(
                                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                                    decoration: BoxDecoration(
                                                      color: badgeColor.withOpacity(0.1),
                                                      border: Border.all(color: badgeColor),
                                                      borderRadius: BorderRadius.circular(4),
                                                    ),
                                                    child: Text(
                                                      status.toUpperCase(),
                                                      style: TextStyle(
                                                        color: badgeColor,
                                                        fontWeight: FontWeight.bold,
                                                        fontSize: 10,
                                                      ),
                                                    ),
                                                  ),
                                                ),
                                              ],
                                            );
                                          }),
                                          // Grand Total Row
                                          DataRow(
                                            color: MaterialStateProperty.all(AppColors.appBackground),
                                            cells: [
                                              const DataCell(Text('TOTAL', style: TextStyle(fontWeight: FontWeight.bold))),
                                              DataCell(Text(formatAccountingCurrency(grandPendapatan), style: const TextStyle(fontWeight: FontWeight.bold))),
                                              DataCell(Text(formatAccountingCurrency(grandPengeluaran), style: const TextStyle(fontWeight: FontWeight.bold))),
                                              DataCell(Text(formatAccountingCurrency(grandKembalikan), style: const TextStyle(fontWeight: FontWeight.bold))),
                                              DataCell(Text(formatAccountingCurrency(grandLabaKotor), style: const TextStyle(fontWeight: FontWeight.bold))),
                                              DataCell(Text(formatAccountingCurrency(grandUangLaci), style: const TextStyle(fontWeight: FontWeight.bold))),
                                              const DataCell(Text('')),
                                            ],
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),

          // Bagian Kanan: Form Entri Data Laporan Harian (Ditampilkan split screen jika _showForm = true)
          if (_showForm)
            Container(
              width: 650,
              padding: const EdgeInsets.all(12.0),
              child: Card(
                color: Colors.white,
                elevation: 4,
                child: Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Form Entri Laporan Harian',
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.bold,
                              color: AppColors.primaryTeal,
                            ),
                      ),
                      const Divider(height: 24),
                      Expanded(
                        child: SingleChildScrollView(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              // 1. Pilih Tanggal
                              Row(
                                children: [
                                  const Icon(Icons.calendar_today, size: 18),
                                  const SizedBox(width: 8),
                                  Text(
                                    'Pilih Tanggal: ${formatDate(_selectedDate)}',
                                    style: const TextStyle(fontWeight: FontWeight.bold),
                                  ),
                                  const Spacer(),
                                  TextButton(
                                    onPressed: () async {
                                      final picked = await showDatePicker(
                                        context: context,
                                        initialDate: _selectedDate,
                                        firstDate: DateTime(2022),
                                        lastDate: DateTime.now().add(const Duration(days: 30)),
                                      );
                                      if (picked != null) {
                                        setState(() => _selectedDate = picked);
                                        // Auto-fetch data penjualan begitu tanggal diubah
                                        await _autoFillSalesData();
                                      }
                                    },
                                    child: const Text('Ubah'),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 12),

                              // 2. Pendapatan (Penjabaran metode pembayaran)
                              Card(
                                color: AppColors.appBackground,
                                margin: EdgeInsets.zero,
                                child: Padding(
                                  padding: const EdgeInsets.all(10.0),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                        children: [
                                          const Text(
                                            '💰 PENDAPATAN SALES',
                                            style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
                                          ),
                                          IconButton(
                                            icon: const Icon(Icons.sync_rounded, size: 18),
                                            onPressed: _autoFillSalesData,
                                            tooltip: 'Ambil ulang data penjualan',
                                          ),
                                        ],
                                      ),
                                      const SizedBox(height: 6),
                                      ..._paymentIncomes.entries.map((entry) {
                                        String label = entry.key.toUpperCase();
                                        if (label == 'CASH') label = 'Tunai / Cash';
                                        if (label == 'TRANSFER') label = 'Transfer Bank';
                                        return _salesField(
                                          label,
                                          entry.value,
                                          (val) => setState(() => _paymentIncomes[entry.key] = val),
                                        );
                                      }).toList(),
                                      const Divider(),
                                      Row(
                                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                        children: [
                                          const Text('Total Pendapatan', style: TextStyle(fontWeight: FontWeight.bold)),
                                          Text(formatAccountingCurrency(_totalIncome), style: const TextStyle(fontWeight: FontWeight.bold)),
                                        ],
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                              const SizedBox(height: 16),

                              // 3. Pengeluaran
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  const Text(
                                    '🛒 PENGELUARAN',
                                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                                  ),
                                  ElevatedButton.icon(
                                    onPressed: _addExpenseLine,
                                    icon: const Icon(Icons.add, size: 16),
                                    label: const Text('Tambah Baris', style: TextStyle(fontSize: 11)),
                                    style: ElevatedButton.styleFrom(
                                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                      backgroundColor: AppColors.primaryTeal.withOpacity(0.1),
                                      foregroundColor: AppColors.primaryTeal,
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              ..._expenseLines.map((line) => _buildExpenseRow(line)),
                              const SizedBox(height: 16),

                              // 4. Kembalikan Uang Kas
                              Card(
                                color: AppColors.appBackground,
                                margin: EdgeInsets.zero,
                                child: Padding(
                                  padding: const EdgeInsets.all(10.0),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      const Text(
                                        '🏦 KEMBALIKAN UANG KAS (SETORAN)',
                                        style: TextStyle(fontWeight: FontWeight.bold, fontSize: 11),
                                      ),
                                      const SizedBox(height: 6),
                                      Row(
                                        children: [
                                          const Text('Tgl Setor: ', style: TextStyle(fontSize: 11)),
                                          Text(formatDate(_returnCashDate), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                                          const Spacer(),
                                          TextButton(
                                            onPressed: () async {
                                              final picked = await showDatePicker(
                                                context: context,
                                                initialDate: _returnCashDate,
                                                firstDate: DateTime(2022),
                                                lastDate: DateTime.now().add(const Duration(days: 30)),
                                              );
                                              if (picked != null) {
                                                setState(() => _returnCashDate = picked);
                                              }
                                            },
                                            child: const Text('Pilih', style: TextStyle(fontSize: 11)),
                                          ),
                                        ],
                                      ),
                                      TextFormField(
                                        initialValue: _returnCashAmount > 0 ? _returnCashAmount.toString() : '',
                                        keyboardType: TextInputType.number,
                                        decoration: const InputDecoration(
                                          labelText: 'Nominal Setoran (Rp)',
                                          isDense: true,
                                          contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                                        ),
                                        onChanged: (val) {
                                          setState(() => _returnCashAmount = int.tryParse(val) ?? 0);
                                        },
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                              const SizedBox(height: 20),

                              // 5. Perhitungan Laba & Uang Laci
                              Container(
                                decoration: BoxDecoration(
                                  border: Border.all(color: AppColors.border),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                padding: const EdgeInsets.all(10.0),
                                child: Column(
                                  children: [
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                        const Text('Laba Kotor (Pendapatan - Pengeluaran):'),
                                        Text(formatAccountingCurrency(_grossProfit), style: const TextStyle(fontWeight: FontWeight.bold)),
                                      ],
                                    ),
                                    const SizedBox(height: 6),
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                        const Text('Uang Laci (Laba Kotor - Pendapatan):'),
                                        Text(
                                          formatAccountingCurrency(_drawerMoney),
                                          style: TextStyle(
                                            fontWeight: FontWeight.bold,
                                            color: _drawerMoney < 0 ? AppColors.danger : AppColors.darkText,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(height: 24),
                            ],
                          ),
                        ),
                      ),
                      // Action buttons
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton(
                              onPressed: () {
                                setState(() {
                                  _showForm = false;
                                  _resetForm();
                                });
                              },
                              child: const Text('Batal'),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: ElevatedButton(
                              style: ElevatedButton.styleFrom(
                                backgroundColor: AppColors.primaryTeal,
                                foregroundColor: Colors.white,
                              ),
                              onPressed: _submitReport,
                              child: const Text('Simpan'),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  // Baris Form Pengeluaran
  Widget _buildExpenseRow(_ExpenseInputLine line) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: AppColors.appBackground.withOpacity(0.5),
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Autocomplete<Object>(
                  optionsBuilder: (TextEditingValue textEditingValue) {
                    if (textEditingValue.text.isEmpty) {
                      return const Iterable<Object>.empty();
                    }
                    return _searchItems.where((Object item) {
                      final name = item is RawMaterial ? item.name : (item as ExpenseCategory).name;
                      return name.toLowerCase().contains(textEditingValue.text.toLowerCase());
                    });
                  },
                  displayStringForOption: (Object option) {
                    return option is RawMaterial ? option.name : (option as ExpenseCategory).name;
                  },
                  onSelected: (Object selection) {
                    setState(() {
                      if (selection is RawMaterial) {
                        line.isHpp = true;
                        line.rawMaterial = selection;
                        line.expenseCategory = null;
                        line.categoryName = 'HPP';
                      } else {
                        line.isHpp = false;
                        line.rawMaterial = null;
                        line.expenseCategory = selection as ExpenseCategory;
                        line.categoryName = selection.name;
                      }
                    });
                  },
                  fieldViewBuilder: (context, textController, focusNode, onFieldSubmitted) {
                    return TextFormField(
                      controller: textController,
                      focusNode: focusNode,
                      decoration: const InputDecoration(
                        labelText: 'Cari Nama Bahan Baku / Expense...',
                        isDense: true,
                        contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                      ),
                    );
                  },
                ),
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline, color: AppColors.danger),
                onPressed: () {
                  setState(() {
                    _expenseLines.remove(line);
                  });
                },
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (line.categoryName.isNotEmpty)
            Row(
              children: [
                Text(
                  line.isHpp
                      ? 'Kategori: ${line.categoryName} (Satuan: ${line.rawMaterial?.unit ?? "-"})'
                      : 'Kategori: ${line.categoryName}',
                  style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.blueGrey),
                ),
              ],
            ),
          const SizedBox(height: 4),
          if (line.isHpp)
            Row(
              children: [
                Expanded(
                  flex: 2,
                  child: TextFormField(
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Qty',
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                    ),
                    onChanged: (val) {
                      setState(() {
                        line.quantity = double.tryParse(val) ?? 0;
                        line.amount = (line.quantity * line.price).toInt();
                      });
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  flex: 3,
                  child: TextFormField(
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Harga Beli (Rp)',
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                    ),
                    onChanged: (val) {
                      setState(() {
                        line.price = int.tryParse(val) ?? 0;
                        line.amount = (line.quantity * line.price).toInt();
                      });
                    },
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  flex: 3,
                  child: Container(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      'Total: Rp ${formatAccountingCurrency(line.amount)}',
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 11, color: AppColors.primaryTeal),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
              ],
            )
          else
            Row(
              children: [
                Expanded(
                  flex: 3,
                  child: TextFormField(
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Nominal (Rp)',
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                    ),
                    onChanged: (val) {
                      setState(() {
                        line.amount = int.tryParse(val) ?? 0;
                      });
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  flex: 4,
                  child: TextFormField(
                    decoration: const InputDecoration(
                      labelText: 'Catatan/Keterangan',
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                    ),
                    onChanged: (val) {
                      setState(() {
                        line.note = val;
                      });
                    },
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  flex: 3,
                  child: Container(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      'Total: Rp ${formatAccountingCurrency(line.amount)}',
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 11, color: Colors.blueGrey),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }

  void _addExpenseLine() {
    setState(() {
      _expenseLines.add(_ExpenseInputLine());
    });
  }

  Widget _salesField(String label, int value, ValueChanged<int> onChanged) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6.0),
      child: Row(
        children: [
          Expanded(flex: 3, child: Text(label, style: const TextStyle(fontSize: 12))),
          Expanded(
            flex: 4,
            child: SizedBox(
              height: 36,
              child: TextFormField(
                initialValue: value > 0 ? value.toString() : '',
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  isDense: true,
                  contentPadding: EdgeInsets.symmetric(horizontal: 6, vertical: 6),
                ),
                style: const TextStyle(fontSize: 12),
                onChanged: (val) {
                  onChanged(int.tryParse(val) ?? 0);
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ExpenseInputLine {
  bool isHpp = false;
  RawMaterial? rawMaterial;
  ExpenseCategory? expenseCategory;
  String categoryName = '';

  double quantity = 0;
  int price = 0;
  int amount = 0;
  String note = '';
}
