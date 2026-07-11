import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../models/app_models.dart';
import '../providers/catalog_provider.dart';
import '../providers/outlet_provider.dart';
import '../repositories/pos_repository.dart';
import '../services/api_client.dart';
import '../theme/app_colors.dart';
import '../utils/formatters.dart';
import '../utils/input_formatters.dart';

class DiscountsScreen extends StatefulWidget {
  const DiscountsScreen({super.key});

  @override
  State<DiscountsScreen> createState() => _DiscountsScreenState();
}

class _DiscountsScreenState extends State<DiscountsScreen> {
  final PosRepository _repository = const PosRepository();
  List<Discount> _discounts = const [];
  String? _lastOutletId;
  bool _loading = false;
  bool _submitting = false;
  String? _errorMessage;

  Future<void> _load(String outletId, {bool force = false}) async {
    if (_loading || (!force && _lastOutletId == outletId)) return;
    setState(() {
      _loading = true;
      _errorMessage = null;
      _lastOutletId = outletId;
    });
    try {
      final discounts = await _repository.getDiscounts(outletId: outletId);
      if (!mounted) return;
      setState(() => _discounts = discounts);
      context
          .read<CatalogProvider>()
          .replaceDiscountsForOutlet(outletId, discounts);
    } catch (error) {
      if (!mounted) return;
      final cached =
          context.read<CatalogProvider>().discountsForOutlet(outletId);
      setState(() {
        _discounts = cached;
        _errorMessage = error
            .toString()
            .replaceFirst(RegExp(r'^(Exception|ApiException):\s*'), '');
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<String?> _askReportPin() async {
    final security = context.read<CatalogProvider>().appSecurity;
    if (security.reportPinEnabled && !security.hasReportPin) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('PIN laporan APK belum diset dari Admin.')),
      );
      return null;
    }
    if (!security.reportPinEnabled) return '';
    return showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const _DiscountPinDialog(),
    );
  }

  Future<void> _saveDiscount(_DiscountFormValues values,
      {Discount? discount}) async {
    if (_submitting) return;
    final outlet = context.read<OutletProvider>().selectedOutlet!;
    final pin = await _askReportPin();
    if (pin == null) return;
    setState(() => _submitting = true);
    try {
      final saved = discount == null
          ? await _repository.createDiscount(
              outletId: outlet.id,
              reportPin: pin,
              name: values.name,
              type: values.type,
              value: values.value,
              startsAt: values.startsAt,
              endsAt: values.endsAt,
              status: values.status,
            )
          : await _repository.updateDiscount(
              id: discount.id,
              outletId: outlet.id,
              reportPin: pin,
              name: values.name,
              type: values.type,
              value: values.value,
              startsAt: values.startsAt,
              endsAt: values.endsAt,
              status: values.status,
            );
      if (!mounted) return;
      context.read<CatalogProvider>().upsertDiscount(saved);
      setState(() {
        final index = _discounts.indexWhere((item) => item.id == saved.id);
        _discounts = index >= 0
            ? [
                ..._discounts.take(index),
                saved,
                ..._discounts.skip(index + 1),
              ]
            : [..._discounts, saved];
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text(discount == null
                ? 'Discount dibuat.'
                : 'Discount diperbarui.')),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text(
                'Gagal menyimpan discount: ${error.toString().replaceFirst(RegExp(r'^(Exception|ApiException):\s*'), '')}')),
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _openForm({Discount? discount}) async {
    final values = await showDialog<_DiscountFormValues>(
      context: context,
      builder: (_) => _DiscountFormDialog(discount: discount),
    );
    if (values == null) return;
    await _saveDiscount(values, discount: discount);
  }

  Future<void> _toggleStatus(Discount discount) async {
    final startsAt = DateTime.tryParse(discount.startsAt) ?? DateTime.now();
    final endsAt = DateTime.tryParse(discount.endsAt) ?? startsAt;
    await _saveDiscount(
      _DiscountFormValues(
        name: discount.name,
        type: discount.type,
        value: discount.value,
        startsAt: startsAt,
        endsAt: endsAt,
        status: discount.status == 'active' ? 'inactive' : 'active',
      ),
      discount: discount,
    );
  }

  @override
  Widget build(BuildContext context) {
    final outlet = context.watch<OutletProvider>().selectedOutlet!;
    if (_lastOutletId != outlet.id && !_loading) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _load(outlet.id);
      });
    }
    final sorted = [..._discounts]
      ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    return Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Discount',
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                              fontWeight: FontWeight.w900,
                              color: AppColors.darkText,
                            )),
                    const SizedBox(height: 4),
                    Text(
                      'Discount dibuat dari APK untuk outlet ${outlet.name}. Admin hanya monitoring.',
                      style: const TextStyle(
                          color: AppColors.mutedBlue,
                          fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              ),
              OutlinedButton.icon(
                onPressed:
                    _loading ? null : () => _load(outlet.id, force: true),
                icon: _loading
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.refresh),
                label: const Text('Refresh'),
              ),
              const SizedBox(width: 8),
              FilledButton.icon(
                onPressed: _submitting ? null : () => _openForm(),
                icon: const Icon(Icons.add),
                label: const Text('Tambah Discount'),
              ),
            ],
          ),
          if (_errorMessage != null) ...[
            const SizedBox(height: 10),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppColors.danger.withOpacity(0.08),
                border: Border.all(color: AppColors.danger.withOpacity(0.3)),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(_errorMessage!,
                  style: const TextStyle(
                      color: AppColors.danger, fontWeight: FontWeight.w700)),
            ),
          ],
          const SizedBox(height: 12),
          Expanded(
            child: Card(
              child: _loading && sorted.isEmpty
                  ? const Center(child: CircularProgressIndicator())
                  : sorted.isEmpty
                      ? const Center(
                          child: Text(
                            'Belum ada discount untuk outlet ini.',
                            style: TextStyle(
                                color: AppColors.mutedBlue,
                                fontWeight: FontWeight.w700),
                          ),
                        )
                      : ListView.separated(
                          padding: const EdgeInsets.all(12),
                          itemCount: sorted.length,
                          separatorBuilder: (_, __) =>
                              const SizedBox(height: 10),
                          itemBuilder: (context, index) {
                            final discount = sorted[index];
                            return _DiscountCard(
                              discount: discount,
                              onEdit: _submitting
                                  ? null
                                  : () => _openForm(discount: discount),
                              onToggle: _submitting
                                  ? null
                                  : () => _toggleStatus(discount),
                            );
                          },
                        ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DiscountCard extends StatelessWidget {
  const _DiscountCard({
    required this.discount,
    required this.onEdit,
    required this.onToggle,
  });

  final Discount discount;
  final VoidCallback? onEdit;
  final VoidCallback? onToggle;

  @override
  Widget build(BuildContext context) {
    final active = discount.status == 'active';
    final startsAt = DateTime.tryParse(discount.startsAt);
    final endsAt = DateTime.tryParse(discount.endsAt);
    final period = startsAt != null && endsAt != null
        ? '${formatDate(startsAt)} - ${formatDate(endsAt)}'
        : '-';
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: active
                  ? AppColors.primaryTeal.withOpacity(0.12)
                  : AppColors.appBackground,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(
                discount.isPercent ? Icons.percent : Icons.sell_outlined,
                color: active ? AppColors.primaryTeal : AppColors.mutedBlue),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        discount.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            color: AppColors.darkText,
                            fontWeight: FontWeight.w900,
                            fontSize: 16),
                      ),
                    ),
                    const SizedBox(width: 8),
                    _StatusPill(active ? 'Aktif' : 'Nonaktif',
                        active ? AppColors.primaryTeal : AppColors.mutedBlue),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  '${discount.isPercent ? 'Persen' : 'Nominal'} · ${discount.valueLabel} · $period',
                  style: const TextStyle(
                      color: AppColors.mutedBlue, fontWeight: FontWeight.w700),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          OutlinedButton.icon(
              onPressed: onEdit,
              icon: const Icon(Icons.edit),
              label: const Text('Edit')),
          const SizedBox(width: 8),
          OutlinedButton.icon(
            onPressed: onToggle,
            icon: Icon(active ? Icons.visibility_off : Icons.visibility),
            label: Text(active ? 'Nonaktifkan' : 'Aktifkan'),
          ),
        ],
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill(this.label, this.color);

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(label,
          style: TextStyle(
              color: color, fontWeight: FontWeight.w900, fontSize: 12)),
    );
  }
}

class _DiscountFormValues {
  const _DiscountFormValues({
    required this.name,
    required this.type,
    required this.value,
    required this.startsAt,
    required this.endsAt,
    required this.status,
  });

  final String name;
  final String type;
  final num value;
  final DateTime startsAt;
  final DateTime endsAt;
  final String status;
}

class _DiscountFormDialog extends StatefulWidget {
  const _DiscountFormDialog({this.discount});

  final Discount? discount;

  @override
  State<_DiscountFormDialog> createState() => _DiscountFormDialogState();
}

class _DiscountFormDialogState extends State<_DiscountFormDialog> {
  late final TextEditingController nameController;
  late final TextEditingController valueController;
  late String type;
  late String status;
  late DateTime startsAt;
  late DateTime endsAt;
  String? errorMessage;

  bool get isEdit => widget.discount != null;

  @override
  void initState() {
    super.initState();
    final discount = widget.discount;
    type = discount?.type == 'percent' ? 'percent' : 'nominal';
    status = discount?.status == 'inactive' ? 'inactive' : 'active';
    startsAt = DateTime.tryParse(discount?.startsAt ?? '') ?? DateTime.now();
    endsAt = DateTime.tryParse(discount?.endsAt ?? '') ?? startsAt;
    nameController = TextEditingController(text: discount?.name ?? '');
    valueController = TextEditingController(
      text: discount == null
          ? ''
          : type == 'percent'
              ? discount.value.toString().replaceFirst(RegExp(r'\.0$'), '')
              : formatNumber(discount.value),
    );
  }

  @override
  void dispose() {
    nameController.dispose();
    valueController.dispose();
    super.dispose();
  }

  Future<void> _pickDate({required bool start}) async {
    final current = start ? startsAt : endsAt;
    final picked = await showDatePicker(
      context: context,
      initialDate: current,
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
    );
    if (picked == null) return;
    setState(() {
      if (start) {
        startsAt = picked;
        if (endsAt.isBefore(startsAt)) endsAt = startsAt;
      } else {
        endsAt = picked;
      }
    });
  }

  void _submit() {
    final name = nameController.text.trim();
    final value = type == 'percent'
        ? num.tryParse(valueController.text.replaceAll(',', '.')) ?? 0
        : parseThousandsInput(valueController.text);
    if (name.length < 2) {
      setState(() => errorMessage = 'Nama discount minimal 2 karakter.');
      return;
    }
    if (type == 'percent' && (value < 1 || value > 100)) {
      setState(() => errorMessage = 'Persen wajib 1 sampai 100.');
      return;
    }
    if (type == 'nominal' && value <= 0) {
      setState(() => errorMessage = 'Nominal wajib lebih dari 0.');
      return;
    }
    if (endsAt.isBefore(startsAt)) {
      setState(
          () => errorMessage = 'Tanggal selesai tidak boleh sebelum mulai.');
      return;
    }
    Navigator.of(context).pop(
      _DiscountFormValues(
        name: name,
        type: type,
        value: value,
        startsAt: startsAt,
        endsAt: endsAt,
        status: status,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(isEdit ? 'Edit Discount' : 'Tambah Discount'),
      content: SizedBox(
        width: 560,
        child: SingleChildScrollView(
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameController,
                decoration: const InputDecoration(labelText: 'Nama discount'),
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      value: type,
                      decoration: const InputDecoration(labelText: 'Tipe'),
                      dropdownColor: Colors.white,
                      items: const [
                        DropdownMenuItem(
                            value: 'nominal', child: Text('Nominal')),
                        DropdownMenuItem(
                            value: 'percent', child: Text('Persen')),
                      ],
                      onChanged: (value) {
                        if (value == null) return;
                        setState(() {
                          type = value;
                          valueController.clear();
                        });
                      },
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: TextField(
                      controller: valueController,
                      keyboardType: TextInputType.numberWithOptions(
                          decimal: type == 'percent'),
                      inputFormatters: type == 'nominal'
                          ? const [ThousandsInputFormatter()]
                          : [
                              FilteringTextInputFormatter.allow(
                                  RegExp(r'[0-9,.]'))
                            ],
                      decoration: InputDecoration(
                          labelText: type == 'percent'
                              ? 'Nilai persen'
                              : 'Nilai nominal'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: _DateButton(
                      label: 'Tanggal mulai',
                      date: startsAt,
                      onTap: () => _pickDate(start: true),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _DateButton(
                      label: 'Tanggal selesai',
                      date: endsAt,
                      onTap: () => _pickDate(start: false),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                value: status,
                decoration: const InputDecoration(labelText: 'Status'),
                dropdownColor: Colors.white,
                items: const [
                  DropdownMenuItem(value: 'active', child: Text('Aktif')),
                  DropdownMenuItem(value: 'inactive', child: Text('Nonaktif')),
                ],
                onChanged: (value) {
                  if (value != null) setState(() => status = value);
                },
              ),
              if (errorMessage != null) ...[
                const SizedBox(height: 12),
                Text(
                  errorMessage!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                      color: AppColors.danger, fontWeight: FontWeight.w800),
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Batal')),
        FilledButton.icon(
            onPressed: _submit,
            icon: const Icon(Icons.save),
            label: const Text('Simpan')),
      ],
    );
  }
}

class _DateButton extends StatelessWidget {
  const _DateButton({
    required this.label,
    required this.date,
    required this.onTap,
  });

  final String label;
  final DateTime date;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: onTap,
      child: InputDecorator(
        decoration: InputDecoration(
            labelText: label, suffixIcon: const Icon(Icons.calendar_month)),
        child: Text(formatDate(date),
            style: const TextStyle(
                color: AppColors.darkText, fontWeight: FontWeight.w800)),
      ),
    );
  }
}

class _DiscountPinDialog extends StatefulWidget {
  const _DiscountPinDialog();

  @override
  State<_DiscountPinDialog> createState() => _DiscountPinDialogState();
}

class _DiscountPinDialogState extends State<_DiscountPinDialog> {
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

  Future<void> _verify() async {
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
        Navigator.of(context).pop(pin);
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
      title: const Text('Konfirmasi PIN'),
      content: SizedBox(
        width: 360,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'Masukkan PIN laporan untuk menyimpan discount.',
              textAlign: TextAlign.center,
              style: TextStyle(
                  color: AppColors.mutedBlue, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 18),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(
                6,
                (index) => Container(
                  margin: const EdgeInsets.symmetric(horizontal: 4),
                  width: 14,
                  height: 14,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: index < pin.length
                        ? AppColors.primaryTeal
                        : Colors.transparent,
                    border: Border.all(
                        color: index < pin.length
                            ? AppColors.primaryTeal
                            : AppColors.border,
                        width: 1.5),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 18),
            GridView.count(
              crossAxisCount: 3,
              mainAxisSpacing: 8,
              crossAxisSpacing: 8,
              childAspectRatio: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              children: [
                for (final digit in [
                  '1',
                  '2',
                  '3',
                  '4',
                  '5',
                  '6',
                  '7',
                  '8',
                  '9'
                ])
                  OutlinedButton(
                      onPressed: verifying ? null : () => _appendPin(digit),
                      child: Text(digit)),
                OutlinedButton(
                    onPressed:
                        verifying ? null : () => setState(() => pin = ''),
                    child: const Text('Clear')),
                OutlinedButton(
                    onPressed: verifying ? null : () => _appendPin('0'),
                    child: const Text('0')),
                OutlinedButton(
                    onPressed: verifying ? null : _backspacePin,
                    child: const Icon(Icons.backspace_outlined)),
              ],
            ),
            if (errorMessage != null) ...[
              const SizedBox(height: 12),
              Text(
                errorMessage!,
                textAlign: TextAlign.center,
                style: const TextStyle(
                    color: AppColors.danger, fontWeight: FontWeight.w800),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
            onPressed: verifying ? null : () => Navigator.of(context).pop(),
            child: const Text('Batal')),
        FilledButton.icon(
          onPressed: verifying ? null : _verify,
          icon: verifying
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.lock_open),
          label: Text(verifying ? 'Memeriksa...' : 'Konfirmasi'),
        ),
      ],
    );
  }
}
