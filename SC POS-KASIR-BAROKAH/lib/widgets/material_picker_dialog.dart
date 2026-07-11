import 'package:flutter/material.dart';

import '../models/app_models.dart';
import '../repositories/pos_repository.dart';
import '../theme/app_colors.dart';
import '../utils/formatters.dart';

enum MaterialPickerMode { purchase, transfer }

class MaterialPickerResult {
  const MaterialPickerResult({
    required this.material,
    required this.stocksByOutlet,
  });

  final RawMaterial material;
  final Map<String, MaterialStockSnapshot> stocksByOutlet;

  MaterialStockSnapshot? stockForOutlet(String outletId) =>
      stocksByOutlet[outletId];
}

class MaterialPickerDialog extends StatefulWidget {
  const MaterialPickerDialog.purchase({
    super.key,
    required this.materials,
    required this.outlet,
    this.categories = const [],
  })  : mode = MaterialPickerMode.purchase,
        fromOutlet = null,
        toOutlet = outlet,
        quantityToCheck = 0;

  const MaterialPickerDialog.transfer({
    super.key,
    required this.materials,
    this.categories = const [],
    required this.fromOutlet,
    required this.toOutlet,
    required this.quantityToCheck,
  })  : mode = MaterialPickerMode.transfer,
        outlet = toOutlet;

  final List<RawMaterial> materials;
  final List<RawMaterialCategory> categories;
  final Outlet outlet;
  final Outlet? fromOutlet;
  final Outlet toOutlet;
  final double quantityToCheck;
  final MaterialPickerMode mode;

  @override
  State<MaterialPickerDialog> createState() => _MaterialPickerDialogState();
}

class _MaterialPickerDialogState extends State<MaterialPickerDialog> {
  final searchController = TextEditingController();
  final repository = const PosRepository();
  final stocksByMaterial = <String, Map<String, MaterialStockSnapshot>>{};
  String keyword = '';
  bool loadingStocks = true;
  String? stockError;

  @override
  void initState() {
    super.initState();
    _loadStocks();
  }

  @override
  void dispose() {
    searchController.dispose();
    super.dispose();
  }

  List<String> get stockOutletIds {
    if (widget.mode == MaterialPickerMode.transfer) {
      return [
        if (widget.fromOutlet != null) widget.fromOutlet!.id,
        widget.toOutlet.id,
      ];
    }
    return [widget.outlet.id];
  }

  Future<void> _loadStocks() async {
    final outletIds = stockOutletIds;
    if (outletIds.isEmpty || widget.materials.isEmpty) {
      setState(() => loadingStocks = false);
      return;
    }

    setState(() {
      loadingStocks = true;
      stockError = null;
    });

    try {
      final snapshots = await repository.getMaterialStocks(
        outletIds: outletIds,
        materialIds: widget.materials.map((material) => material.id).toList(),
      );
      stocksByMaterial.clear();
      for (final snapshot in snapshots) {
        final byOutlet = stocksByMaterial.putIfAbsent(
          snapshot.materialId,
          () => <String, MaterialStockSnapshot>{},
        );
        byOutlet[snapshot.outletId] = snapshot;
      }
      if (!mounted) return;
      setState(() => loadingStocks = false);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        loadingStocks = false;
        stockError = 'Gagal memuat stok live';
      });
    }
  }

  List<RawMaterial> get filteredMaterials {
    final text = keyword.trim().toLowerCase();
    if (text.isEmpty) return widget.materials;
    return widget.materials
        .where((material) =>
            material.name.toLowerCase().contains(text) ||
            material.unit.toLowerCase().contains(text) ||
            _categoryName(material).toLowerCase().contains(text) ||
            material.type.toLowerCase().contains(text))
        .toList();
  }

  String _categoryName(RawMaterial material) {
    for (final category in widget.categories) {
      if (category.id == material.categoryId) return category.name;
    }
    return material.categoryId;
  }

  void _select(RawMaterial material) {
    Navigator.of(context).pop(MaterialPickerResult(
      material: material,
      stocksByOutlet: Map<String, MaterialStockSnapshot>.from(
        stocksByMaterial[material.id] ??
            const <String, MaterialStockSnapshot>{},
      ),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final materials = filteredMaterials;
    final isTransfer = widget.mode == MaterialPickerMode.transfer;
    final screenWidth = MediaQuery.of(context).size.width;
    final dialogWidth = screenWidth < 720 ? screenWidth - 32 : 680.0;
    final dialogHeight = MediaQuery.of(context).size.height * 0.78;

    return AlertDialog(
      clipBehavior: Clip.antiAlias,
      titlePadding: const EdgeInsets.fromLTRB(20, 18, 20, 8),
      contentPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Pilih Harga Pokok Produksi',
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
          ),
          const SizedBox(height: 4),
          Text(
            isTransfer
                ? 'Stok asal dan tujuan ditarik live saat dialog dibuka.'
                : 'Stok outlet dan harga terakhir ditarik live saat dialog dibuka.',
            style: const TextStyle(color: AppColors.mutedBlue, fontSize: 12),
          ),
        ],
      ),
      content: SizedBox(
        width: dialogWidth,
        height: dialogHeight.clamp(420.0, 620.0).toDouble(),
        child: Column(
          children: [
            TextField(
              controller: searchController,
              autofocus: true,
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                labelText: 'Cari produk',
                hintText: 'Nama, satuan, atau type',
              ),
              onChanged: (value) => setState(() => keyword = value),
            ),
            const SizedBox(height: 10),
            _StockLoadBanner(
              loading: loadingStocks,
              message: stockError,
              onRetry: _loadStocks,
            ),
            Expanded(
              child: materials.isEmpty
                  ? const Center(child: Text('Produk tidak ditemukan.'))
                  : ListView.separated(
                      itemCount: materials.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (context, index) {
                        final material = materials[index];
                        final stocks = stocksByMaterial[material.id] ??
                            const <String, MaterialStockSnapshot>{};
                        return _MaterialPickerRow(
                          material: material,
                          mode: widget.mode,
                          stocksByOutlet: stocks,
                          fromOutlet: widget.fromOutlet,
                          toOutlet: widget.toOutlet,
                          currentOutlet: widget.outlet,
                          quantityToCheck: widget.quantityToCheck,
                          stockLoadFailed: stockError != null,
                          categoryName: _categoryName(material),
                          onTap: () => _select(material),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Batal'),
        ),
      ],
    );
  }
}

class _StockLoadBanner extends StatelessWidget {
  const _StockLoadBanner({
    required this.loading,
    required this.message,
    required this.onRetry,
  });

  final bool loading;
  final String? message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Padding(
        padding: EdgeInsets.only(bottom: 10),
        child: LinearProgressIndicator(minHeight: 3),
      );
    }
    if (message == null) return const SizedBox(height: 10);
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(
        color: Colors.orange.withOpacity(0.08),
        border: Border.all(color: Colors.orange.withOpacity(0.35)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          const Icon(Icons.info_outline, size: 18, color: Colors.orange),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message!,
              style: const TextStyle(fontSize: 12, color: AppColors.darkText),
            ),
          ),
          TextButton(onPressed: onRetry, child: const Text('Muat ulang')),
        ],
      ),
    );
  }
}

class _MaterialPickerRow extends StatelessWidget {
  const _MaterialPickerRow({
    required this.material,
    required this.mode,
    required this.stocksByOutlet,
    required this.fromOutlet,
    required this.toOutlet,
    required this.currentOutlet,
    required this.quantityToCheck,
    required this.stockLoadFailed,
    required this.categoryName,
    required this.onTap,
  });

  final RawMaterial material;
  final MaterialPickerMode mode;
  final Map<String, MaterialStockSnapshot> stocksByOutlet;
  final Outlet? fromOutlet;
  final Outlet toOutlet;
  final Outlet currentOutlet;
  final double quantityToCheck;
  final bool stockLoadFailed;
  final String categoryName;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final isTransfer = mode == MaterialPickerMode.transfer;
    final fromStock =
        fromOutlet == null ? null : stocksByOutlet[fromOutlet!.id];
    final toStock = stocksByOutlet[toOutlet.id];
    final currentStock = stocksByOutlet[currentOutlet.id];
    final sourceQuantity = fromStock?.quantity ?? 0;
    final hasSourceWarning = isTransfer &&
        !stockLoadFailed &&
        fromStock != null &&
        (sourceQuantity <= 0 ||
            (quantityToCheck > 0 && sourceQuantity < quantityToCheck));

    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            border: Border.all(
              color: hasSourceWarning
                  ? Colors.orange.withOpacity(0.55)
                  : AppColors.border,
            ),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          material.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.darkText,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Satuan: ${material.unit} · Kategori: ${categoryName.isEmpty ? '-' : categoryName}',
                          style: const TextStyle(
                            color: AppColors.mutedBlue,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  _TypeBadge(type: material.type),
                ],
              ),
              const SizedBox(height: 10),
              if (isTransfer)
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    _StockPill(
                      label: 'Stok Asal',
                      value:
                          _stockText(fromStock, material.unit, stockLoadFailed),
                      highlighted: hasSourceWarning,
                    ),
                    _StockPill(
                      label: 'Stok Tujuan',
                      value:
                          _stockText(toStock, material.unit, stockLoadFailed),
                    ),
                    if (hasSourceWarning)
                      const _WarningPill(text: 'Stok asal perlu dicek'),
                  ],
                )
              else
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    _StockPill(
                      label: 'Stok Outlet Ini',
                      value: _stockText(
                          currentStock, material.unit, stockLoadFailed),
                    ),
                    _StockPill(
                      label: 'Harga Terakhir',
                      value: currentStock == null ||
                              currentStock.lastPurchasePrice <= 0
                          ? '-'
                          : formatCurrency(currentStock.lastPurchasePrice),
                    ),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }

  String _stockText(
    MaterialStockSnapshot? stock,
    String fallbackUnit,
    bool failed,
  ) {
    if (failed) return '-';
    if (stock == null) return '0 $fallbackUnit';
    return '${formatNumber(stock.quantity)} ${stock.unit.isEmpty ? fallbackUnit : stock.unit}';
  }
}

class _TypeBadge extends StatelessWidget {
  const _TypeBadge({required this.type});
  final String type;

  @override
  Widget build(BuildContext context) {
    final isBiaya = type == 'biaya';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: isBiaya
            ? Colors.orange.withOpacity(0.12)
            : AppColors.primaryTeal.withOpacity(0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        isBiaya ? 'Biaya Produksi' : 'HPP',
        style: TextStyle(
          color: isBiaya ? Colors.orange.shade800 : AppColors.primaryTeal,
          fontSize: 12,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _StockPill extends StatelessWidget {
  const _StockPill({
    required this.label,
    required this.value,
    this.highlighted = false,
  });

  final String label;
  final String value;
  final bool highlighted;

  @override
  Widget build(BuildContext context) => Container(
        constraints: const BoxConstraints(minWidth: 128),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: highlighted
              ? Colors.orange.withOpacity(0.10)
              : const Color(0xFFF7FAFC),
          border: Border.all(
            color: highlighted
                ? Colors.orange.withOpacity(0.55)
                : AppColors.border,
          ),
          borderRadius: BorderRadius.circular(8),
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
            const SizedBox(height: 3),
            Text(
              value,
              style: const TextStyle(
                color: AppColors.darkText,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      );
}

class _WarningPill extends StatelessWidget {
  const _WarningPill({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.orange.withOpacity(0.12),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.warning_amber_rounded,
                size: 16, color: Colors.orange.shade800),
            const SizedBox(width: 6),
            Text(
              text,
              style: TextStyle(
                color: Colors.orange.shade900,
                fontWeight: FontWeight.w800,
                fontSize: 12,
              ),
            ),
          ],
        ),
      );
}
