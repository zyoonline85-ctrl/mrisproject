import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/app_models.dart';
import '../providers/auth_provider.dart';
import '../providers/catalog_provider.dart';
import '../providers/outlet_provider.dart';
import '../services/api_client.dart';
import '../theme/app_colors.dart';
import '../widgets/keyboard_aware_scroll.dart';
import 'home_shell.dart';
import 'outlet_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  List<CashierUser> cashiers = const [];
  CashierUser? selectedCashier;
  String pin = '';
  String? localError;
  bool submitting = false;
  bool checkingSession = true;
  bool loadingCashiers = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => restoreSession());
  }

  Future<void> restoreSession() async {
    final auth = context.read<AuthProvider>();
    await auth.restoreSession();
    if (!mounted) return;
    if (auth.isLoggedIn) {
      await enterApp();
      return;
    }
    await loadCashiers();
    if (mounted) {
      setState(() => checkingSession = false);
    }
  }

  Future<void> loadCashiers() async {
    final auth = context.read<AuthProvider>();
    setState(() {
      loadingCashiers = true;
      localError = null;
    });
    try {
      final result = await auth.fetchCashiersForPinLogin();
      if (!mounted) return;
      setState(() {
        cashiers = result;
        selectedCashier = result.length == 1 ? result.first : selectedCashier;
        if (result.isEmpty) {
          localError = 'Belum ada kasir aktif yang bisa login PIN.';
        }
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => localError = error.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => localError =
          'Gagal mengambil daftar kasir. Cek backend dan koneksi jaringan.');
    } finally {
      if (mounted) {
        setState(() => loadingCashiers = false);
      }
    }
  }

  Future<void> submit() async {
    if (selectedCashier == null) {
      setState(() => localError = 'Pilih kasir terlebih dahulu.');
      return;
    }
    if (!RegExp(r'^\d{6}$').hasMatch(pin)) {
      setState(() => localError = 'PIN wajib 6 digit.');
      return;
    }

    setState(() {
      submitting = true;
      localError = null;
    });
    final auth = context.read<AuthProvider>();
    final ok = await auth.loginWithPin(selectedCashier!.id, pin);
    if (!mounted) return;
    if (!ok) {
      setState(() {
        submitting = false;
        pin = '';
      });
      return;
    }
    await enterApp();
  }

  Future<void> enterApp() async {
    final auth = context.read<AuthProvider>();
    final catalog = context.read<CatalogProvider>();
    final outletProvider = context.read<OutletProvider>();
    try {
      await catalog.loadCatalog();
    } on ApiException catch (error) {
      if (error.isUnauthorized) {
        await auth.logout();
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error.message)),
        );
      }
      setState(() {
        checkingSession = false;
        submitting = false;
      });
      return;
    }
    if (!mounted) return;
    final outlets =
        outletProvider.outletsForUser(auth.user, outlets: catalog.outlets);
    if (outlets.length == 1) {
      outletProvider.selectOutlet(outlets.first);
      Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const HomeShell()));
    } else {
      Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const OutletScreen()));
    }
  }

  Future<void> pickCashier() async {
    final result = await showModalBottomSheet<CashierUser>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.white,
      builder: (_) => _CashierPickerSheet(
        cashiers: cashiers,
        selectedCashier: selectedCashier,
      ),
    );
    if (result == null || !mounted) return;
    setState(() {
      selectedCashier = result;
      pin = '';
      localError = null;
    });
  }

  void appendPin(String digit) {
    if (submitting || pin.length >= 6) return;
    setState(() {
      pin += digit;
      localError = null;
    });
  }

  void backspacePin() {
    if (submitting || pin.isEmpty) return;
    setState(() => pin = pin.substring(0, pin.length - 1));
  }

  void clearPin() {
    if (submitting || pin.isEmpty) return;
    setState(() => pin = '');
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final error = localError ?? auth.error;
    final disabled = submitting || auth.loading;

    if (checkingSession || auth.loading && !submitting) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    return Scaffold(
      body: SafeArea(
        child: KeyboardAwareScroll(
          centerContent: true,
          padding: const EdgeInsets.all(20),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 48,
                      height: 48,
                      decoration: BoxDecoration(
                        color: AppColors.primaryTeal,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child:
                          const Icon(Icons.pin, color: Colors.white, size: 26),
                    ),
                    const SizedBox(height: 16),
                    Text('Barokah POS Kasir',
                        style: Theme.of(context).textTheme.titleLarge),
                    const SizedBox(height: 4),
                    const Text(
                      'Pilih kasir lalu masukkan PIN 6 digit.',
                      style: TextStyle(color: AppColors.darkText),
                    ),
                    const SizedBox(height: 20),
                    _CashierSelectButton(
                      cashier: selectedCashier,
                      loading: loadingCashiers,
                      onPressed: loadingCashiers || cashiers.isEmpty
                          ? null
                          : pickCashier,
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: loadingCashiers ? null : loadCashiers,
                            icon: loadingCashiers
                                ? const SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2),
                                  )
                                : const Icon(Icons.refresh),
                            label: Text(loadingCashiers
                                ? 'Memuat kasir...'
                                : 'Refresh daftar kasir'),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 20),
                    Center(child: _PinDots(length: pin.length)),
                    const SizedBox(height: 18),
                    _PinKeypad(
                      disabled: disabled,
                      onDigit: appendPin,
                      onBackspace: backspacePin,
                      onClear: clearPin,
                    ),
                    if (error != null) ...[
                      const SizedBox(height: 12),
                      Text(error,
                          style: const TextStyle(color: AppColors.danger)),
                    ],
                    const SizedBox(height: 20),
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: disabled ? null : submit,
                        child: Text(disabled ? 'Menghubungkan...' : 'Masuk'),
                      ),
                    ),
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

class _CashierSelectButton extends StatelessWidget {
  const _CashierSelectButton({
    required this.cashier,
    required this.loading,
    required this.onPressed,
  });

  final CashierUser? cashier;
  final bool loading;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final selected = cashier;
    return InkWell(
      onTap: onPressed,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.border),
          borderRadius: BorderRadius.circular(12),
          color: Colors.white,
        ),
        child: Row(
          children: [
            CircleAvatar(
              backgroundColor: AppColors.primaryTeal.withOpacity(0.1),
              child: Icon(
                selected == null ? Icons.person_search : Icons.person,
                color: AppColors.primaryTeal,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    loading
                        ? 'Memuat kasir...'
                        : selected?.name ?? 'Pilih kasir',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    selected == null
                        ? 'Daftar kasir aktif dari backend'
                        : '${selected.username} · ${selected.outletIds.length} outlet',
                    style: const TextStyle(
                        color: AppColors.mutedBlue, fontSize: 12),
                  ),
                ],
              ),
            ),
            const Icon(Icons.expand_more),
          ],
        ),
      ),
    );
  }
}

class _CashierPickerSheet extends StatefulWidget {
  const _CashierPickerSheet({
    required this.cashiers,
    required this.selectedCashier,
  });

  final List<CashierUser> cashiers;
  final CashierUser? selectedCashier;

  @override
  State<_CashierPickerSheet> createState() => _CashierPickerSheetState();
}

class _CashierPickerSheetState extends State<_CashierPickerSheet> {
  String keyword = '';

  @override
  Widget build(BuildContext context) {
    final filtered = widget.cashiers.where((cashier) {
      final target = '${cashier.name} ${cashier.username}'.toLowerCase();
      return target.contains(keyword.toLowerCase());
    }).toList();

    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 560),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text('Pilih Kasir',
                    style: Theme.of(context).textTheme.titleMedium),
                const Spacer(),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            const SizedBox(height: 8),
            TextField(
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                labelText: 'Cari kasir',
              ),
              onChanged: (value) => setState(() => keyword = value),
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: 360,
              child: filtered.isEmpty
                  ? const Center(child: Text('Kasir tidak ditemukan.'))
                  : ListView.separated(
                      itemCount: filtered.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (context, index) {
                        final cashier = filtered[index];
                        final selected =
                            widget.selectedCashier?.id == cashier.id;
                        return ListTile(
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                            side: BorderSide(
                              color: selected
                                  ? AppColors.primaryTeal
                                  : AppColors.border,
                            ),
                          ),
                          tileColor: selected
                              ? AppColors.primaryTeal.withOpacity(0.08)
                              : Colors.white,
                          leading: CircleAvatar(
                            backgroundColor:
                                AppColors.primaryTeal.withOpacity(0.1),
                            child: const Icon(Icons.person,
                                color: AppColors.primaryTeal),
                          ),
                          title: Text(cashier.name),
                          subtitle: Text(
                              '${cashier.username} · ${cashier.outletIds.length} outlet'),
                          trailing: selected
                              ? const Icon(Icons.check_circle,
                                  color: AppColors.primaryTeal)
                              : null,
                          onTap: () => Navigator.of(context).pop(cashier),
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

class _PinDots extends StatelessWidget {
  const _PinDots({required this.length});

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

class _PinKeypad extends StatelessWidget {
  const _PinKeypad({
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
    final keys = [
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      'C',
      '0',
      '<',
    ];

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
