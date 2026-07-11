import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../providers/catalog_provider.dart';
import '../providers/expense_provider.dart';
import '../providers/open_bill_provider.dart';
import '../providers/outlet_provider.dart';
import '../providers/pos_report_provider.dart';
import '../providers/purchase_provider.dart';
import '../providers/sync_provider.dart';
import '../providers/transaction_provider.dart';
import '../providers/transfer_provider.dart';
import '../services/api_client.dart';
import '../services/activity_log_service.dart';
import '../theme/app_colors.dart';
import '../utils/logout_flow.dart';
import '../utils/responsive_layout.dart';
import 'expenses_screen.dart';
import 'history_screen.dart';
import 'login_screen.dart';
import 'outlet_screen.dart';
import 'pos_screen.dart';
import 'print_setup_screen.dart';
import 'purchases_screen.dart';
import 'reports_screen.dart';
import 'stock_opname_screen.dart';
import 'transfers_screen.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> with WidgetsBindingObserver {
  String? selectedDestinationId;
  String? loadedOpenBillOutletId;
  static const destinations = [
    _HomeDestination(
        'sales', 'apk.sales', Icons.shopping_cart, 'Kasir', PosScreen()),
    _HomeDestination('history', 'apk.history', Icons.receipt_long, 'Riwayat',
        HistoryScreen()),
    _HomeDestination('purchases', 'apk.purchases', Icons.inventory_2,
        'Pembelian', PurchasesScreen()),
    _HomeDestination('transfers', 'apk.transfers', Icons.compare_arrows,
        'Transfer', TransfersScreen()),
    _HomeDestination('opnames', 'apk.opnames', Icons.fact_check, 'Opname',
        StockOpnameScreen()),
    _HomeDestination('expenses', 'apk.expenses', Icons.payments, 'Expense',
        ExpensesScreen()),
    _HomeDestination(
        'reports', 'apk.reports', Icons.bar_chart, 'Laporan', ReportsScreen()),
    _HomeDestination(
        'printing', 'apk.printing', Icons.print, 'Print', PrintSetupScreen()),
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) return;
    context.read<AuthProvider>().refreshSession().catchError((_) => false);
    const ActivityLogService().syncPending();
  }

  @override
  Widget build(BuildContext context) {
    final outlet = context.watch<OutletProvider>().selectedOutlet;
    final auth = context.watch<AuthProvider>();
    final transactions = context.watch<TransactionProvider>();
    final expenses = context.watch<ExpenseProvider>();
    final purchases = context.watch<PurchaseProvider>();
    final transfers = context.watch<TransferProvider>();
    final openBills = context.watch<OpenBillProvider>();
    final sync = context.watch<SyncProvider>();
    if (!auth.isLoggedIn) return const LoginScreen();
    if (outlet == null) return const OutletScreen();
    final user = auth.user!;
    final allowedDestinations = destinations
        .where((destination) => user.can(destination.permissionKey))
        .toList(growable: false);
    if (allowedDestinations.isEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) async {
        if (mounted) await context.read<AuthProvider>().logout();
      });
      return const Scaffold(
        body: Center(
            child: Text('Role tidak memiliki menu APK yang dapat digunakan.')),
      );
    }
    final selectedDestination = allowedDestinations.firstWhere(
      (destination) => destination.id == selectedDestinationId,
      orElse: () => allowedDestinations.first,
    );
    if (selectedDestinationId != selectedDestination.id) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          setState(() => selectedDestinationId = selectedDestination.id);
          const ActivityLogService().record(
            outletId: outlet.id,
            module: 'navigation',
            action: 'page_open',
            entityType: 'screen',
            entityId: selectedDestination.id,
            description: 'Membuka menu ${selectedDestination.label}.',
          );
        }
      });
    }
    final pending =
        (user.can('apk.sales', 'create') ? transactions.pendingCount : 0) +
            (user.can('apk.sales', 'create') || user.can('apk.sales', 'update')
                ? openBills.pendingCount
                : 0);
    if (loadedOpenBillOutletId != outlet.id) {
      loadedOpenBillOutletId = outlet.id;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          final now = DateTime.now();
          final from = DateTime(now.year, now.month, 1);
          if (user.can('apk.sales')) {
            context.read<OpenBillProvider>().fetchRemote(outletId: outlet.id);
          }
          if (user.can('apk.history')) {
            context
                .read<TransactionProvider>()
                .fetchHistory(outletId: outlet.id, from: from, to: now);
          }
          if (user.can('apk.expenses')) {
            context
                .read<ExpenseProvider>()
                .fetchExpenses(outletId: outlet.id, from: from, to: now);
          }
          if (user.can('apk.purchases')) {
            context
                .read<PurchaseProvider>()
                .fetchPurchases(outletId: outlet.id, from: from, to: now);
          }
          if (user.can('apk.transfers')) {
            context
                .read<TransferProvider>()
                .fetchTransfers(outletId: outlet.id, from: from, to: now);
          }
          if (user.can('apk.reports')) {
            context
                .read<PosReportProvider>()
                .fetchReport(outletId: outlet.id, from: from, to: now);
          }
        }
      });
    }

    return Scaffold(
      body: SafeArea(
        child: Row(children: [
          _SideNav(
            items: allowedDestinations,
            selectedId: selectedDestination.id,
            onDestinationSelected: _selectDestination,
          ),
          Expanded(
              child: Column(children: [
            _TopBar(
              outletName: outlet.name,
              cashierName: auth.user?.name ?? 'Kasir',
              pendingCount: pending,
              syncing: sync.syncing,
              showSalesSync: selectedDestination.id == 'sales',
              onDiagnostics: () => _showBackendDiagnostics(context),
              onSync: () async {
                final messenger = ScaffoldMessenger.of(context);
                final authProvider = context.read<AuthProvider>();
                final syncProvider = context.read<SyncProvider>();
                final catalogProvider = context.read<CatalogProvider>();
                final reportProvider = context.read<PosReportProvider>();
                try {
                  final refreshed = await authProvider.refreshSession();
                  if (!refreshed || !mounted) return;
                  await syncProvider.syncNow(
                    transactions,
                    expenses,
                    purchases,
                    transfers,
                    openBills,
                    catalogProvider,
                    outlet,
                    reportProvider,
                    authProvider.user!,
                  );
                  if (!mounted) return;
                  await const ActivityLogService().record(
                    outletId: outlet.id,
                    module: 'sync',
                    action: 'sync_all',
                    outcome: 'succeeded',
                    description: 'Sinkronisasi APK selesai.',
                    metadata: {'pending_before': pending},
                  );
                  messenger.showSnackBar(const SnackBar(
                      content: Text('Sync selesai. Data backend terbaru.')));
                } catch (error) {
                  await const ActivityLogService().record(
                    outletId: outlet.id,
                    module: 'sync',
                    action: 'sync_all',
                    outcome: 'failed',
                    description: 'Sinkronisasi APK gagal.',
                    metadata: {'error': error.toString()},
                  );
                  if (!mounted) return;
                  messenger.showSnackBar(SnackBar(
                      content: Text(
                          'Sync gagal: ${error.toString().replaceFirst('Exception: ', '')}')));
                }
              },
              onLogout: () => performLogout(context),
            ),
            Expanded(child: selectedDestination.page),
          ])),
        ]),
      ),
    );
  }

  Future<void> _selectDestination(String destinationId) async {
    final outletId = context.read<OutletProvider>().selectedOutlet?.id;
    if (destinationId == 'reports' && selectedDestinationId != destinationId) {
      final security = context.read<CatalogProvider>().appSecurity;
      if (security.reportPinEnabled) {
        if (!security.hasReportPin) {
          await const ActivityLogService().record(
            outletId: outletId,
            module: 'navigation',
            action: 'page_open',
            outcome: 'failed',
            entityType: 'screen',
            entityId: destinationId,
            description: 'Akses laporan gagal karena PIN belum tersedia.',
          );
          if (!mounted) return;
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('PIN laporan APK belum diset dari Admin.'),
            ),
          );
          return;
        }
        final allowed = await showDialog<bool>(
          context: context,
          barrierDismissible: false,
          builder: (_) => const _ReportPinDialog(),
        );
        if (allowed != true || !mounted) {
          await const ActivityLogService().record(
            outletId: outletId,
            module: 'navigation',
            action: 'page_open',
            outcome: 'cancelled',
            entityType: 'screen',
            entityId: destinationId,
            description: 'Akses menu Laporan dibatalkan.',
          );
          return;
        }
      }
    }
    setState(() => selectedDestinationId = destinationId);
    final destination =
        destinations.firstWhere((item) => item.id == destinationId);
    await const ActivityLogService().record(
      outletId: outletId,
      module: 'navigation',
      action: 'page_open',
      entityType: 'screen',
      entityId: destinationId,
      description: 'Membuka menu ${destination.label}.',
    );
  }

  Future<void> _showBackendDiagnostics(BuildContext context) async {
    final outletId = context.read<OutletProvider>().selectedOutlet?.id;
    final transactions = context.read<TransactionProvider>();
    await const ActivityLogService().record(
      outletId: outletId,
      module: 'system',
      action: 'diagnostics_open',
      entityType: 'screen',
      entityId: 'backend_diagnostics',
      description: 'Membuka diagnostik backend APK.',
    );
    if (!context.mounted) return;
    var checking = false;
    var pendingTransactions = transactions.pendingCount;
    var statusText = 'Belum dicek.';
    var statusColor = AppColors.mutedBlue;

    await showDialog(
      context: context,
      builder: (dialogContext) {
        return StatefulBuilder(builder: (context, setDialogState) {
          Future<void> checkBackend() async {
            setDialogState(() {
              checking = true;
              statusText = 'Mengecek koneksi backend...';
              statusColor = AppColors.mutedBlue;
            });
            try {
              final response = Map<String, dynamic>.from(
                  await ApiClient.instance.get('/health'));
              setDialogState(() {
                checking = false;
                statusColor = AppColors.primaryTeal;
                statusText =
                    'Backend OK (${response['service'] ?? 'service'}), waktu ${response['time'] ?? '-'}.';
              });
            } catch (error) {
              setDialogState(() {
                checking = false;
                statusColor = AppColors.danger;
                statusText = error
                    .toString()
                    .replaceFirst(RegExp(r'^(Exception|ApiException):\s*'), '');
              });
            }
          }

          Future<void> clearPendingSales() async {
            final removed = await transactions.clearPendingTransactions();
            setDialogState(() {
              pendingTransactions = transactions.pendingCount;
              statusColor =
                  removed > 0 ? AppColors.primaryTeal : AppColors.mutedBlue;
              statusText = removed > 0
                  ? '$removed pending transaksi penjualan lokal dibersihkan.'
                  : 'Tidak ada pending transaksi penjualan lokal.';
            });
          }

          return AlertDialog(
            title: const Text('Diagnostik Backend'),
            content: SizedBox(
              width: 520,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'API_BASE_URL',
                    style: TextStyle(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 6),
                  SelectableText(
                    ApiClient.instance.baseUrl,
                    style: const TextStyle(fontFamily: 'monospace'),
                  ),
                  const SizedBox(height: 14),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: statusColor.withOpacity(0.08),
                      border: Border.all(color: statusColor.withOpacity(0.28)),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      statusText,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    'Pending transaksi penjualan lokal: $pendingTransactions',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Mode simulasi penjualan sekarang online wajib. Pending lama boleh dibersihkan jika sudah gagal validasi atau salah URL backend.',
                    style: TextStyle(color: AppColors.mutedBlue),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: checking ? null : clearPendingSales,
                child: const Text('Bersihkan Pending Penjualan'),
              ),
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: const Text('Tutup'),
              ),
              FilledButton.icon(
                onPressed: checking ? null : checkBackend,
                icon: checking
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.wifi_tethering),
                label: const Text('Cek Backend'),
              ),
            ],
          );
        });
      },
    );
  }
}

class _SideNav extends StatelessWidget {
  const _SideNav({
    required this.items,
    required this.selectedId,
    required this.onDestinationSelected,
  });

  final List<_HomeDestination> items;
  final String selectedId;
  final ValueChanged<String> onDestinationSelected;

  @override
  Widget build(BuildContext context) {
    final navWidth = ResponsiveLayout.sideNavWidth(context);
    final itemHeight = ResponsiveLayout.sideNavItemHeight(context);
    final compact = ResponsiveLayout.isLandscapeTablet(context);
    return SizedBox(
      width: navWidth,
      child: Material(
        color: AppColors.darkText,
        child: Column(
          children: [
            Padding(
              padding: EdgeInsets.symmetric(vertical: compact ? 8 : 12),
              child: Container(
                width: compact ? 34 : 38,
                height: compact ? 34 : 38,
                decoration: BoxDecoration(
                  color: AppColors.primaryTeal,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(Icons.point_of_sale, color: Colors.white),
              ),
            ),
            Expanded(
              child: ListView.separated(
                padding: EdgeInsets.fromLTRB(
                    compact ? 6 : 8, 0, compact ? 6 : 8, compact ? 8 : 12),
                itemCount: items.length,
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                separatorBuilder: (_, __) => SizedBox(height: compact ? 4 : 6),
                itemBuilder: (context, index) {
                  final item = items[index];
                  final selected = item.id == selectedId;
                  return Tooltip(
                    message: item.label,
                    waitDuration: const Duration(milliseconds: 500),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(10),
                      onTap: () => onDestinationSelected(item.id),
                      child: Container(
                        height: itemHeight,
                        padding: const EdgeInsets.symmetric(
                            horizontal: 5, vertical: 6),
                        decoration: BoxDecoration(
                          color: selected
                              ? AppColors.primaryTeal
                              : Colors.transparent,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              item.icon,
                              color: selected ? Colors.white : Colors.white70,
                              size: compact ? 20 : 22,
                            ),
                            SizedBox(height: compact ? 3 : 4),
                            SizedBox(
                              width: double.infinity,
                              child: FittedBox(
                                fit: BoxFit.scaleDown,
                                child: Text(
                                  item.label,
                                  maxLines: 1,
                                  style: TextStyle(
                                    color: selected
                                        ? Colors.white
                                        : Colors.white70,
                                    fontSize: compact ? 10 : 11,
                                    fontWeight: selected
                                        ? FontWeight.w800
                                        : FontWeight.w600,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _HomeDestination {
  const _HomeDestination(
      this.id, this.permissionKey, this.icon, this.label, this.page);

  final String id;
  final String permissionKey;
  final IconData icon;
  final String label;
  final Widget page;
}

class _ReportPinDialog extends StatefulWidget {
  const _ReportPinDialog();

  @override
  State<_ReportPinDialog> createState() => _ReportPinDialogState();
}

class _ReportPinDialogState extends State<_ReportPinDialog> {
  String pin = '';
  bool verifying = false;
  String? errorMessage;

  void _appendPin(String digit) {
    if (verifying || pin.length >= 6) return;
    setState(() {
      pin += digit;
      errorMessage = null;
    });
  }

  void _backspacePin() {
    if (verifying || pin.isEmpty) return;
    setState(() => pin = pin.substring(0, pin.length - 1));
  }

  void _clearPin() {
    if (verifying || pin.isEmpty) return;
    setState(() => pin = '');
  }

  Future<void> _verify() async {
    if (verifying) return;
    if (!RegExp(r'^\d{6}$').hasMatch(pin)) {
      setState(() => errorMessage = 'PIN wajib 6 digit.');
      return;
    }
    setState(() {
      verifying = true;
      errorMessage = null;
    });
    try {
      final response = Map<String, dynamic>.from(
        await ApiClient.instance
            .post('/pos/report-pin/verify', body: {'pin': pin}),
      );
      if (response['valid'] == true && mounted) {
        Navigator.of(context).pop(true);
        return;
      }
      setState(() => errorMessage = 'PIN laporan tidak valid.');
    } catch (error) {
      setState(() {
        errorMessage = error
            .toString()
            .replaceFirst(RegExp(r'^(Exception|ApiException):\s*'), '');
      });
    } finally {
      if (mounted) setState(() => verifying = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('PIN Laporan'),
      content: SizedBox(
        width: 360,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'Masukkan PIN khusus untuk membuka menu Laporan.',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.mutedBlue),
            ),
            const SizedBox(height: 18),
            _ReportPinDots(length: pin.length),
            const SizedBox(height: 18),
            _ReportPinKeypad(
              disabled: verifying,
              onDigit: _appendPin,
              onBackspace: _backspacePin,
              onClear: _clearPin,
            ),
            if (errorMessage != null) ...[
              const SizedBox(height: 12),
              Text(
                errorMessage!,
                textAlign: TextAlign.center,
                style: const TextStyle(
                    color: AppColors.danger, fontWeight: FontWeight.w700),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: verifying ? null : () => Navigator.of(context).pop(false),
          child: const Text('Batal'),
        ),
        FilledButton.icon(
          onPressed: verifying ? null : _verify,
          icon: verifying
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.lock_open),
          label: Text(verifying ? 'Memeriksa...' : 'Buka Laporan'),
        ),
      ],
    );
  }
}

class _ReportPinDots extends StatelessWidget {
  const _ReportPinDots({required this.length});

  final int length;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(6, (index) {
        final filled = index < length;
        return Container(
          width: 16,
          height: 16,
          margin: const EdgeInsets.symmetric(horizontal: 6),
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: filled ? AppColors.primaryTeal : Colors.transparent,
            border: Border.all(
              color: filled ? AppColors.primaryTeal : AppColors.border,
              width: 1.5,
            ),
          ),
        );
      }),
    );
  }
}

class _ReportPinKeypad extends StatelessWidget {
  const _ReportPinKeypad({
    required this.disabled,
    required this.onDigit,
    required this.onBackspace,
    required this.onClear,
  });

  final bool disabled;
  final ValueChanged<String> onDigit;
  final VoidCallback onBackspace;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '<'];
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: keys.length,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        mainAxisSpacing: 10,
        crossAxisSpacing: 10,
        childAspectRatio: 2.2,
      ),
      itemBuilder: (context, index) {
        final key = keys[index];
        final isBackspace = key == '<';
        final isClear = key == 'C';
        return OutlinedButton(
          onPressed: disabled
              ? null
              : () {
                  if (isClear) return onClear();
                  if (isBackspace) return onBackspace();
                  onDigit(key);
                },
          child: isBackspace
              ? const Icon(Icons.backspace_outlined)
              : Text(
                  key,
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                  ),
                ),
        );
      },
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({
    required this.outletName,
    required this.cashierName,
    required this.pendingCount,
    required this.syncing,
    required this.showSalesSync,
    required this.onDiagnostics,
    required this.onSync,
    required this.onLogout,
  });

  final String outletName;
  final String cashierName;
  final int pendingCount;
  final bool syncing;
  final bool showSalesSync;
  final VoidCallback onDiagnostics;
  final Future<void> Function() onSync;
  final Future<void> Function() onLogout;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 64,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: AppColors.border)),
      ),
      child: LayoutBuilder(builder: (context, constraints) {
        final compact = constraints.maxWidth < 760;
        return Row(children: [
          Expanded(
            child: Row(children: [
              Flexible(
                child: Text(
                  outletName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.darkText,
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              _StatusPill(
                icon: Icons.person,
                label: cashierName,
                color: AppColors.mutedBlue,
              ),
            ]),
          ),
          if (showSalesSync) ...[
            const SizedBox(width: 12),
            _StatusPill(
              icon: pendingCount > 0 ? Icons.sync_problem : Icons.cloud_done,
              label: pendingCount > 0 ? '$pendingCount pending' : 'Synced',
              color: pendingCount > 0
                  ? AppColors.accentGold
                  : AppColors.primaryTeal,
            ),
            const SizedBox(width: 8),
          ] else
            const SizedBox(width: 12),
          _TopBarButton(
            icon: Icons.dns_outlined,
            label: compact ? '' : 'Backend',
            onTap: onDiagnostics,
          ),
          if (showSalesSync) ...[
            const SizedBox(width: 8),
            _TopBarButton(
              icon: Icons.sync,
              label: compact
                  ? ''
                  : syncing
                      ? 'Syncing...'
                      : 'Sync',
              loading: syncing,
              onTap: syncing ? null : () => onSync(),
            ),
            const SizedBox(width: 8),
          ] else
            const SizedBox(width: 8),
          _TopBarButton(
            icon: Icons.logout,
            label: compact ? '' : 'Logout',
            onTap: () => onLogout(),
          ),
        ]);
      }),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({
    required this.icon,
    required this.label,
    required this.color,
  });

  final IconData icon;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 36,
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        border: Border.all(color: color.withOpacity(0.35)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 16, color: color),
        const SizedBox(width: 6),
        ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 130),
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.darkText,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ]),
    );
  }
}

class _TopBarButton extends StatelessWidget {
  const _TopBarButton({
    required this.icon,
    required this.label,
    required this.onTap,
    this.loading = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: onTap,
      child: Container(
        height: 40,
        constraints: BoxConstraints(minWidth: label.isEmpty ? 42 : 92),
        padding: const EdgeInsets.symmetric(horizontal: 12),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: AppColors.border),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          if (loading)
            const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          else
            Icon(icon, size: 18, color: AppColors.darkText),
          if (label.isNotEmpty) ...[
            const SizedBox(width: 6),
            Text(
              label,
              style: const TextStyle(
                color: AppColors.darkText,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ]),
      ),
    );
  }
}
