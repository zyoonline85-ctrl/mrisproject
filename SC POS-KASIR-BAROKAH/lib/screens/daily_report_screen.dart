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
import '../widgets/material_picker_dialog.dart';

class DailyReportScreen extends StatefulWidget {
  const DailyReportScreen({super.key});

  @override
  State<DailyReportScreen> createState() => _DailyReportScreenState();
}

class _DailyReportScreenState extends State<DailyReportScreen> {
  static const _storageKey = 'barokah_pos_daily_reports_local';
  final List<Map<String, dynamic>> _reports = [];
  bool _loadingReports = true;

  // Filter rekapitulasi harian
  int _filterMonth = DateTime.now().month;
  int _filterYear = DateTime.now().year;

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
      final allLocal = decoded.map((item) => Map<String, dynamic>.from(item)).toList();
      _reports.clear();
      for (final r in allLocal) {
        final dateStr = r['tanggal']?.toString() ?? r['report_date']?.toString() ?? '';
        final parsedDate = DateTime.tryParse(dateStr);
        if (parsedDate != null && parsedDate.month == _filterMonth && parsedDate.year == _filterYear) {
          _reports.add(r);
        }
      }
    }
    setState(() => _loadingReports = false);
  }

  Future<void> _loadOnlineReports() async {
    setState(() => _loadingReports = true);
    try {
      final outlet = context.read<OutletProvider>().selectedOutlet;
      if (outlet != null) {
        final fromDate = DateTime(_filterYear, _filterMonth, 1);
        final toDate = DateTime(_filterYear, _filterMonth + 1, 0); // hari terakhir bulan
        
        final dynamic data = await ApiClient.instance.get(
          '/admin/daily-reports',
          query: {
            'outletId': outlet.id,
            'from': formatIsoDate(fromDate),
            'to': formatIsoDate(toDate),
          },
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

  int get _drawerMoney => (_paymentIncomes['cash'] ?? 0) - _totalExpense - _returnCashAmount;

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
      'reportDate': formatIsoDate(_selectedDate),
      'cashierId': authProvider.user?.id ?? '',
      'cashIncome': _paymentIncomes['cash'] ?? 0,
      'transferIncome': _paymentIncomes['transfer'] ?? 0,
      'qrisIncome': _paymentIncomes['qris'] ?? 0,
      'totalIncome': _totalIncome,
      'totalExpense': _totalExpense,
      'returnCashAmount': _returnCashAmount,
      'returnCashDate': formatIsoDate(_returnCashDate),
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

  int _parseAmount(dynamic val) {
    if (val == null) return 0;
    if (val is num) return val.toInt();
    return int.tryParse(val.toString()) ?? 0;
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
      grandPendapatan += _parseAmount(r['total_income'] ?? r['pendapatan'] ?? r['totalIncome']);
      grandPengeluaran += _parseAmount(r['total_expense'] ?? r['pengeluaran'] ?? r['totalExpense']);
      grandKembalikan += _parseAmount(r['return_cash_amount'] ?? r['kembalikan_uang_kas'] ?? r['returnCashAmount']);
      grandLabaKotor += _parseAmount(r['gross_profit'] ?? r['laba_kotor'] ?? r['grossProfit']);
      grandUangLaci += _parseAmount(r['drawer_money'] ?? r['uang_laci'] ?? r['drawerMoney']);
    }

    return Scaffold(
      body: _showForm
          ? Padding(
              padding: const EdgeInsets.all(16.0),
              child: Card(
                color: Colors.white,
                elevation: 4,
                child: Padding(
                  padding: const EdgeInsets.all(24.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            'Form Entri Laporan Harian',
                            style: Theme.of(context).textTheme.titleLarge?.copyWith(
                                  fontWeight: FontWeight.bold,
                                  color: AppColors.primaryTeal,
                                ),
                          ),
                          IconButton(
                            icon: const Icon(Icons.close_rounded),
                            onPressed: () {
                              setState(() {
                                _showForm = false;
                                _resetForm();
                              });
                            },
                          ),
                        ],
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
                                        await _autoFillSalesData();
                                      }
                                    },
                                    child: const Text('Ubah'),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 12),

                              // 2. Pendapatan
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
                                    onPressed: _showAddExpenseOptions,
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: AppColors.primaryTeal.withOpacity(0.1),
                                      foregroundColor: AppColors.primaryTeal,
                                      elevation: 0,
                                    ),
                                    icon: const Icon(Icons.add, size: 16),
                                    label: const Text('Tambah Baris'),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              if (_expenseLines.isEmpty)
                                const Padding(
                                  padding: EdgeInsets.symmetric(vertical: 12),
                                  child: Text('Belum ada pengeluaran harian.', style: TextStyle(color: Colors.grey, fontSize: 11)),
                                )
                              else
                                ..._expenseLines.map((line) => _buildExpenseRow(line)),
                              const Divider(height: 24),
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  const Text('Total Pengeluaran:', style: TextStyle(fontWeight: FontWeight.bold)),
                                  Text(formatAccountingCurrency(_totalExpense), style: const TextStyle(fontWeight: FontWeight.bold, color: AppColors.danger)),
                                ],
                              ),
                              const SizedBox(height: 16),

                              // 4. Setoran Kas
                              Card(
                                color: Colors.blue.withOpacity(0.05),
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
                                            '🏦 SETORAN KAS (KEMBALIKAN UANG KAS)',
                                            style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: Colors.blue),
                                          ),
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
                                            child: const Text('Pilih Tgl'),
                                          ),
                                        ],
                                      ),
                                      TextFormField(
                                        initialValue: _returnCashAmount > 0 ? _returnCashAmount.toString() : '',
                                        keyboardType: TextInputType.number,
                                        decoration: const InputDecoration(
                                          labelText: 'Nominal Setoran (Rp)',
                                          isDense: true,
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
                          const SizedBox(width: 12),
                          Expanded(
                            child: ElevatedButton(
                              style: ElevatedButton.styleFrom(
                                backgroundColor: AppColors.primaryTeal,
                                foregroundColor: Colors.white,
                              ),
                              onPressed: _showSubmitPreview,
                              child: const Text('Simpan & Submit'),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            )
          : Padding(
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
                              // Dropdown Filter Bulan
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8),
                                decoration: BoxDecoration(
                                  border: Border.all(color: AppColors.border),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: DropdownButtonHideUnderline(
                                  child: DropdownButton<int>(
                                    value: _filterMonth,
                                    items: const [
                                      DropdownMenuItem(value: 1, child: Text('Januari')),
                                      DropdownMenuItem(value: 2, child: Text('Februari')),
                                      DropdownMenuItem(value: 3, child: Text('Maret')),
                                      DropdownMenuItem(value: 4, child: Text('April')),
                                      DropdownMenuItem(value: 5, child: Text('Mei')),
                                      DropdownMenuItem(value: 6, child: Text('Juni')),
                                      DropdownMenuItem(value: 7, child: Text('Juli')),
                                      DropdownMenuItem(value: 8, child: Text('Agustus')),
                                      DropdownMenuItem(value: 9, child: Text('September')),
                                      DropdownMenuItem(value: 10, child: Text('Oktober')),
                                      DropdownMenuItem(value: 11, child: Text('November')),
                                      DropdownMenuItem(value: 12, child: Text('Desember')),
                                    ],
                                    onChanged: (val) {
                                      if (val != null) {
                                        setState(() => _filterMonth = val);
                                        _loadOnlineReports();
                                      }
                                    },
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              // Dropdown Filter Tahun
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8),
                                decoration: BoxDecoration(
                                  border: Border.all(color: AppColors.border),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: DropdownButtonHideUnderline(
                                  child: DropdownButton<int>(
                                    value: _filterYear,
                                    items: [
                                      DateTime.now().year - 1,
                                      DateTime.now().year,
                                      DateTime.now().year + 1
                                    ].map((yr) {
                                      return DropdownMenuItem(value: yr, child: Text(yr.toString()));
                                    }).toList(),
                                    onChanged: (val) {
                                      if (val != null) {
                                        setState(() => _filterYear = val);
                                        _loadOnlineReports();
                                      }
                                    },
                                  ),
                                ),
                              ),
                              const SizedBox(width: 16),
                              ElevatedButton.icon(
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: AppColors.primaryTeal,
                                  foregroundColor: Colors.white,
                                ),
                                onPressed: () {
                                  setState(() {
                                    _showForm = true;
                                    _resetForm();
                                  });
                                  _autoFillSalesData();
                                },
                                icon: const Icon(Icons.add_rounded),
                                label: const Text('Tambah Laporan'),
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
                                                DataCell(Text(_formatReportDate(r['tanggal']?.toString() ?? r['report_date']?.toString()))),
                                                DataCell(Text(formatAccountingCurrency(_parseAmount(r['total_income'] ?? r['pendapatan'] ?? r['totalIncome'])))),
                                                DataCell(Text(formatAccountingCurrency(_parseAmount(r['total_expense'] ?? r['pengeluaran'] ?? r['totalExpense'])))),
                                                DataCell(Text(formatAccountingCurrency(_parseAmount(r['return_cash_amount'] ?? r['kembalikan_uang_kas'] ?? r['returnCashAmount'])))),
                                                DataCell(Text(formatAccountingCurrency(_parseAmount(r['gross_profit'] ?? r['laba_kotor'] ?? r['grossProfit'])))),
                                                DataCell(Text(formatAccountingCurrency(_parseAmount(r['drawer_money'] ?? r['uang_laci'] ?? r['drawerMoney'])))),
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
    );
  }

  String _formatReportDate(String? raw) {
    if (raw == null || raw.isEmpty) return '';
    final parsed = DateTime.tryParse(raw);
    if (parsed == null) return raw;
    return '${parsed.day.toString().padLeft(2, '0')}-${parsed.month.toString().padLeft(2, '0')}-${parsed.year}';
  }

  void _showAddExpenseOptions() {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Padding(
                padding: EdgeInsets.all(16.0),
                child: Text(
                  'Tambah Pengeluaran',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
              ),
              ListTile(
                leading: const Icon(Icons.shopping_bag_outlined, color: AppColors.primaryTeal),
                title: const Text('Belanja Bahan Baku (HPP)'),
                subtitle: const Text('Bahan pangan, kemasan, atau bahan pokok produksi outlet'),
                onTap: () {
                  Navigator.pop(context);
                  _selectHppLine();
                },
              ),
              ListTile(
                leading: const Icon(Icons.payments_outlined, color: Colors.orange),
                title: const Text('Biaya Operasional / Lain-lain'),
                subtitle: const Text('Listrik, air, kebersihan, servis, dsb.'),
                onTap: () {
                  Navigator.pop(context);
                  _addOperationalLine();
                },
              ),
              const SizedBox(height: 8),
            ],
          ),
        );
      },
    );
  }

  void _selectHppLine() async {
    final catalog = context.read<CatalogProvider>();
    final outlet = context.read<OutletProvider>().selectedOutlet!;
    
    final result = await showDialog<MaterialPickerResult>(
      context: context,
      builder: (context) => MaterialPickerDialog.purchase(
        materials: catalog.rawMaterials,
        outlet: outlet,
        categories: catalog.rawMaterialCategories,
      ),
    );

    if (result != null) {
      final lastPrice = result.stocksByOutlet[outlet.id]?.lastPurchasePrice ?? 0;
      setState(() {
        _expenseLines.add(_ExpenseInputLine()
          ..isHpp = true
          ..rawMaterial = result.material
          ..categoryName = 'HPP'
          ..price = lastPrice
          ..quantity = 1.0
          ..amount = lastPrice);
      });
    }
  }

  void _addOperationalLine() {
    setState(() {
      _expenseLines.add(_ExpenseInputLine()
        ..isHpp = false
        ..quantity = 0
        ..price = 0
        ..amount = 0);
    });
  }

  void _showSubmitPreview() {
    if (_totalIncome == 0 && _expenseLines.isEmpty && _returnCashAmount == 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Laporan tidak boleh kosong!')),
      );
      return;
    }

    for (final line in _expenseLines) {
      if (!line.isHpp && line.expenseCategory == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Ada kategori biaya operasional yang belum dipilih!')),
        );
        return;
      }
    }

    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Row(
            children: [
              const Icon(Icons.rate_review_rounded, color: AppColors.primaryTeal),
              const SizedBox(width: 8),
              const Text('Preview Laporan Harian'),
            ],
          ),
          content: SizedBox(
            width: 500,
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Tanggal Laporan: ${formatDate(_selectedDate)}',
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                  ),
                  const SizedBox(height: 12),
                  const Divider(),
                  
                  const Text('💰 Pendapatan Penjualan', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.green)),
                  const SizedBox(height: 4),
                  _previewRow('Tunai / Cash', _paymentIncomes['cash'] ?? 0),
                  _previewRow('Transfer Bank', _paymentIncomes['transfer'] ?? 0),
                  _previewRow('QRIS', _paymentIncomes['qris'] ?? 0),
                  _previewRow('Total Pendapatan', _totalIncome, isTotal: true),
                  const SizedBox(height: 12),

                  const Text('🛒 Pengeluaran', style: TextStyle(fontWeight: FontWeight.bold, color: AppColors.danger)),
                  const SizedBox(height: 4),
                  if (_expenseLines.isEmpty)
                    const Padding(
                      padding: EdgeInsets.only(left: 8.0, bottom: 4.0),
                      child: Text('Tidak ada pengeluaran.', style: TextStyle(fontSize: 12, color: Colors.grey)),
                    )
                  else
                    ..._expenseLines.map((line) {
                      final label = line.isHpp 
                          ? '${line.rawMaterial?.name} (x${formatNumber(line.quantity)})'
                          : '${line.categoryName} (${line.note.isNotEmpty ? line.note : "-"})';
                      return _previewRow(label, line.amount);
                    }).toList(),
                  _previewRow('Total Pengeluaran', _totalExpense, isTotal: true),
                  const SizedBox(height: 12),

                  const Text('🏦 Setoran & Kas Laci', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.blue)),
                  const SizedBox(height: 4),
                  _previewRow('Laba Kotor (Pendapatan - Pengeluaran)', _grossProfit),
                  _previewRow('Setoran Kas (Kembalikan Kas)', _returnCashAmount),
                  _previewRow('Estimasi Sisa Uang Laci', _drawerMoney, isTotal: true, color: AppColors.primaryTeal),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Edit Kembali', style: TextStyle(color: Colors.grey)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primaryTeal,
                foregroundColor: Colors.white,
              ),
              onPressed: () {
                Navigator.pop(context);
                _submitReport();
              },
              child: const Text('Oke, Kirim Laporan'),
            ),
          ],
        );
      },
    );
  }

  Widget _previewRow(String label, int val, {bool isTotal = false, Color? color}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontWeight: isTotal ? FontWeight.bold : FontWeight.normal,
                fontSize: 12,
              ),
            ),
          ),
          Text(
            formatAccountingCurrency(val),
            style: TextStyle(
              fontWeight: isTotal ? FontWeight.bold : FontWeight.normal,
              fontSize: 12,
              color: color ?? (isTotal ? Colors.black : Colors.grey[700]),
            ),
          ),
        ],
      ),
    );
  }

  // Baris Form Pengeluaran
  Widget _buildExpenseRow(_ExpenseInputLine line) {
    final catalog = context.read<CatalogProvider>();
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: line.isHpp 
            ? AppColors.primaryTeal.withOpacity(0.02)
            : Colors.orange.withOpacity(0.02),
        border: Border.all(
          color: line.isHpp
              ? AppColors.primaryTeal.withOpacity(0.3)
              : Colors.orange.withOpacity(0.3),
        ),
        borderRadius: BorderRadius.circular(8),
      ),
      child: line.isHpp
          ? Row(
              children: [
                Expanded(
                  flex: 4,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        line.rawMaterial?.name ?? 'Bahan Baku',
                        style: const TextStyle(fontWeight: FontWeight.bold, color: AppColors.primaryTeal),
                      ),
                      Text(
                        'Satuan: ${line.rawMaterial?.unit ?? "-"} (Kategori: HPP)',
                        style: const TextStyle(fontSize: 11, color: Colors.grey),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  flex: 2,
                  child: TextFormField(
                    initialValue: line.quantity > 0 ? formatNumber(line.quantity) : '',
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
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
                    initialValue: line.price > 0 ? line.price.toString() : '',
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
                  child: Text(
                    'Total: Rp ${formatNumber(line.amount)}',
                    style: const TextStyle(fontWeight: FontWeight.bold, color: AppColors.primaryTeal),
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
            )
          : Row(
              children: [
                Expanded(
                  flex: 4,
                  child: DropdownButtonFormField<ExpenseCategory>(
                    value: line.expenseCategory,
                    hint: const Text('Pilih Kategori', style: TextStyle(fontSize: 12)),
                    isExpanded: true,
                    decoration: const InputDecoration(
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    ),
                    items: catalog.expenseCategories.map((cat) {
                      return DropdownMenuItem<ExpenseCategory>(
                        value: cat,
                        child: Text(cat.name, style: const TextStyle(fontSize: 12)),
                      );
                    }).toList(),
                    onChanged: (val) {
                      setState(() {
                        line.expenseCategory = val;
                        line.categoryName = val?.name ?? '';
                      });
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  flex: 3,
                  child: TextFormField(
                    initialValue: line.amount > 0 ? line.amount.toString() : '',
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
                    initialValue: line.note,
                    decoration: const InputDecoration(
                      labelText: 'Keterangan',
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
    );
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
