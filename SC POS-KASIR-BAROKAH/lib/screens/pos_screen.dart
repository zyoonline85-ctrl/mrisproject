import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/app_models.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../providers/catalog_provider.dart';
import '../providers/favorite_product_provider.dart';
import '../providers/open_bill_provider.dart';
import '../providers/outlet_provider.dart';
import '../providers/transaction_provider.dart';
import '../services/api_client.dart';
import '../services/activity_log_service.dart';
import '../services/thermal_printer_service.dart';
import '../services/thermal_ticket_builder.dart';
import '../theme/app_colors.dart';
import '../utils/formatters.dart';
import '../utils/input_formatters.dart';
import '../utils/order_print_delta.dart';
import '../utils/payment_shortcuts.dart';
import '../utils/responsive_layout.dart';
import '../utils/table_number_sort.dart';
import '../widgets/print_preview_dialog.dart';
import '../widgets/receipt_dialog.dart';

class PosScreen extends StatefulWidget {
  const PosScreen({super.key});

  @override
  State<PosScreen> createState() => _PosScreenState();
}

class _PosScreenState extends State<PosScreen> {
  String? _favoriteLoadKey;

  @override
  Widget build(BuildContext context) {
    final outlet = context.watch<OutletProvider>().selectedOutlet!;
    final auth = context.watch<AuthProvider>();
    final catalog = context.watch<CatalogProvider>();
    final favorites = context.watch<FavoriteProductProvider>();
    final userId = auth.user?.id ?? '';
    final favoriteKey = '$userId:${outlet.id}';
    if (userId.isNotEmpty && _favoriteLoadKey != favoriteKey) {
      _favoriteLoadKey = favoriteKey;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          context
              .read<FavoriteProductProvider>()
              .load(userId: userId, outletId: outlet.id);
        }
      });
    }
    final products = catalog.productsForOutlet(
      outlet.id,
      favoriteProductIds: favorites.idsFor(outlet.id),
    );
    final productArea = _ProductArea(outlet: outlet, products: products);
    final cart = _CartPanel(outlet: outlet);

    return LayoutBuilder(builder: (context, constraints) {
      final isTabletLandscape = ResponsiveLayout.isLandscapeTablet(context);
      final cartWidth = isTabletLandscape
          ? constraints.maxWidth >= 1360
              ? 420.0
              : constraints.maxWidth >= 1200
                  ? 380.0
                  : 360.0
          : constraints.maxWidth >= 1360
              ? 460.0
              : constraints.maxWidth >= 1120
                  ? 430.0
                  : 390.0;
      final gap = ResponsiveLayout.panelGap(context);
      final padding = ResponsiveLayout.pagePadding(context);
      return Padding(
        padding: EdgeInsets.all(padding),
        child: Row(children: [
          Expanded(flex: 7, child: productArea),
          SizedBox(width: gap),
          SizedBox(width: cartWidth, child: cart),
        ]),
      );
    });
  }
}

class _ProductArea extends StatelessWidget {
  const _ProductArea({required this.outlet, required this.products});
  final Outlet outlet;
  final List<Product> products;

  Future<List<ProductVariant>?> _selectVariants(
      BuildContext context, Product product) async {
    final variants = product.activeVariants;
    if (variants.isEmpty) return const [];
    final selectedIds = <String>{};

    return showModalBottomSheet<List<ProductVariant>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      builder: (sheetContext) => StatefulBuilder(
        builder: (context, setState) {
          final selectedVariants = variants
              .where((variant) => selectedIds.contains(variant.id))
              .toList();
          return SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 18),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Pilih Catatan Variant',
                              style: Theme.of(context).textTheme.titleMedium),
                          const SizedBox(height: 4),
                          Text(product.name,
                              style: const TextStyle(
                                  color: AppColors.mutedBlue,
                                  fontWeight: FontWeight.w700)),
                        ],
                      ),
                    ),
                    IconButton(
                        onPressed: () => Navigator.pop(sheetContext),
                        icon: const Icon(Icons.close))
                  ]),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: variants.map((variant) {
                      final selected = selectedIds.contains(variant.id);
                      return FilterChip(
                        label: Text(variant.name),
                        selected: selected,
                        onSelected: (value) {
                          setState(() {
                            if (value) {
                              selectedIds.add(variant.id);
                            } else {
                              selectedIds.remove(variant.id);
                            }
                          });
                        },
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 16),
                  Row(children: [
                    TextButton(
                        onPressed: () => Navigator.pop(sheetContext, const []),
                        child: const Text('Tanpa Variant')),
                    const Spacer(),
                    FilledButton.icon(
                        onPressed: () =>
                            Navigator.pop(sheetContext, selectedVariants),
                        icon: const Icon(Icons.add_shopping_cart),
                        label: const Text('Tambah ke Cart'))
                  ])
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final catalog = context.watch<CatalogProvider>();
    final user = context.watch<AuthProvider>().user!;
    final editingOpenBill =
        context.watch<CartProvider>().currentOpenBillId != null;
    final canChangeCart =
        user.can('apk.sales', editingOpenBill ? 'update' : 'create');
    final compactTablet = ResponsiveLayout.isLandscapeTablet(context);
    return Card(
        child: Padding(
            padding: EdgeInsets.all(compactTablet ? 6 : 8),
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Text('Produk', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(width: 10),
                Expanded(
                    child: TextField(
                        style: const TextStyle(color: AppColors.darkText),
                        scrollPadding: const EdgeInsets.only(bottom: 220),
                        onChanged: catalog.search,
                        decoration: const InputDecoration(
                            prefixIcon: Icon(Icons.search),
                            prefixIconConstraints:
                                BoxConstraints(minWidth: 38, minHeight: 36),
                            contentPadding: EdgeInsets.symmetric(
                                horizontal: 10, vertical: 8),
                            hintText: 'Cari produk')))
              ]),
              const SizedBox(height: 8),
              SizedBox(
                  height: 38,
                  child: ListView(scrollDirection: Axis.horizontal, children: [
                    _CategoryButton(
                        id: 'favorites',
                        label: 'Favorit',
                        active: catalog.selectedCategoryId == 'favorites'),
                    _CategoryButton(
                        id: 'all',
                        label: 'Semua',
                        active: catalog.selectedCategoryId == 'all'),
                    ...catalog.categories.map((cat) => _CategoryButton(
                        id: cat.id,
                        label: cat.name,
                        active: catalog.selectedCategoryId == cat.id))
                  ])),
              const SizedBox(height: 8),
              Expanded(
                  child: products.isEmpty
                      ? Center(
                          child: Text(
                            catalog.selectedCategoryId == 'favorites'
                                ? 'Belum ada produk favorit.'
                                : 'Produk tidak ditemukan.',
                            style: const TextStyle(
                                color: AppColors.mutedBlue,
                                fontWeight: FontWeight.w700),
                          ),
                        )
                      : GridView.builder(
                          gridDelegate:
                              SliverGridDelegateWithMaxCrossAxisExtent(
                                  maxCrossAxisExtent: compactTablet ? 176 : 190,
                                  mainAxisExtent: compactTablet ? 178 : 190,
                                  crossAxisSpacing: compactTablet ? 6 : 8,
                                  mainAxisSpacing: compactTablet ? 6 : 8),
                          itemCount: products.length,
                          itemBuilder: (context, index) {
                            final product = products[index];
                            final favoriteProvider =
                                context.watch<FavoriteProductProvider>();
                            final isFavorite = favoriteProvider.isFavorite(
                                outlet.id, product.id);
                            return InkWell(
                                borderRadius: BorderRadius.circular(8),
                                onTap: !canChangeCart
                                    ? null
                                    : () async {
                                        if (product.activeVariants.isEmpty) {
                                          context
                                              .read<CartProvider>()
                                              .addProduct(product, outlet.id);
                                          return;
                                        }
                                        final selectedVariants =
                                            await _selectVariants(
                                                context, product);
                                        if (selectedVariants == null) return;
                                        if (!context.mounted) return;
                                        context.read<CartProvider>().addProduct(
                                            product, outlet.id,
                                            selectedVariants: selectedVariants);
                                      },
                                child: Stack(children: [
                                  Container(
                                      decoration: BoxDecoration(
                                          color: Colors.white,
                                          border: Border.all(
                                              color: AppColors.border),
                                          borderRadius:
                                              BorderRadius.circular(8)),
                                      clipBehavior: Clip.antiAlias,
                                      child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                            _ProductCardImage(product: product),
                                            Expanded(
                                                child: Padding(
                                                    padding:
                                                        const EdgeInsets.all(8),
                                                    child: Column(
                                                        crossAxisAlignment:
                                                            CrossAxisAlignment
                                                                .start,
                                                        children: [
                                                          Text(product.name,
                                                              maxLines: 2,
                                                              overflow:
                                                                  TextOverflow
                                                                      .ellipsis,
                                                              style: const TextStyle(
                                                                  color: AppColors
                                                                      .darkText,
                                                                  fontSize: 13,
                                                                  fontWeight:
                                                                      FontWeight
                                                                          .w800)),
                                                          const Spacer(),
                                                          Text(product.sku,
                                                              style: const TextStyle(
                                                                  fontSize: 11,
                                                                  color: AppColors
                                                                      .mutedBlue)),
                                                          const SizedBox(
                                                              height: 4),
                                                          Text(
                                                              formatCurrency(product
                                                                  .priceForOutlet(
                                                                      outlet
                                                                          .id)),
                                                              style: const TextStyle(
                                                                  fontWeight:
                                                                      FontWeight
                                                                          .w700,
                                                                  color: AppColors
                                                                      .primaryTeal))
                                                        ])))
                                          ])),
                                  Positioned(
                                    top: 6,
                                    right: 6,
                                    child: Material(
                                      color: Colors.white.withOpacity(0.92),
                                      borderRadius: BorderRadius.circular(999),
                                      child: IconButton(
                                        tooltip: isFavorite
                                            ? 'Hapus dari favorit'
                                            : 'Tambah ke favorit',
                                        visualDensity: VisualDensity.compact,
                                        iconSize: 20,
                                        onPressed: !user.can(
                                                'apk.sales', 'update')
                                            ? null
                                            : () async {
                                                final userId = context
                                                        .read<AuthProvider>()
                                                        .user
                                                        ?.id ??
                                                    '';
                                                if (userId.isEmpty) return;
                                                final success = await context
                                                    .read<
                                                        FavoriteProductProvider>()
                                                    .toggle(
                                                      userId: userId,
                                                      outletId: outlet.id,
                                                      productId: product.id,
                                                    );
                                                if (!success &&
                                                    context.mounted) {
                                                  final message = context
                                                          .read<
                                                              FavoriteProductProvider>()
                                                          .errorMessage ??
                                                      'Gagal menyimpan favorit produk.';
                                                  ScaffoldMessenger.of(context)
                                                      .showSnackBar(
                                                    SnackBar(
                                                        content: Text(message)),
                                                  );
                                                }
                                              },
                                        icon: Icon(
                                          isFavorite
                                              ? Icons.star
                                              : Icons.star_border,
                                          color: isFavorite
                                              ? const Color(0xFFD99A00)
                                              : AppColors.mutedBlue,
                                        ),
                                      ),
                                    ),
                                  )
                                ]));
                          })),
            ])));
  }
}

String _resolveProductImageUrl(String value) {
  final rawValue = value.trim();
  if (rawValue.isEmpty) return '';
  final uri = Uri.tryParse(rawValue);
  if (uri != null && uri.hasScheme) return rawValue;

  final apiUri = Uri.parse(ApiClient.instance.baseUrl);
  final origin = Uri(
    scheme: apiUri.scheme,
    host: apiUri.host,
    port: apiUri.hasPort ? apiUri.port : null,
  ).toString().replaceAll(RegExp(r'/$'), '');
  final normalizedPath = rawValue.startsWith('/') ? rawValue : '/$rawValue';
  return '$origin$normalizedPath';
}

class _ProductCardImage extends StatelessWidget {
  const _ProductCardImage({required this.product});

  final Product product;

  @override
  Widget build(BuildContext context) {
    final imageUrl = _resolveProductImageUrl(product.imageUrl);
    if (imageUrl.isEmpty) return _ProductImageFallback(product: product);

    return SizedBox(
      height: 82,
      width: double.infinity,
      child: Image.network(
        imageUrl,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => _ProductImageFallback(product: product),
        loadingBuilder: (context, child, progress) {
          if (progress == null) return child;
          return Container(
            color: const Color(0xFFEAF1F4),
            alignment: Alignment.center,
            child: const SizedBox(
              height: 18,
              width: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          );
        },
      ),
    );
  }
}

class _ProductImageFallback extends StatelessWidget {
  const _ProductImageFallback({required this.product});

  final Product product;

  @override
  Widget build(BuildContext context) {
    final initial = product.name.trim().isEmpty
        ? 'P'
        : product.name.trim()[0].toUpperCase();
    return Container(
      height: 82,
      width: double.infinity,
      alignment: Alignment.center,
      color: const Color(0xFFEAF1F4),
      child: Text(initial,
          style: const TextStyle(
              color: AppColors.primaryTeal,
              fontSize: 26,
              fontWeight: FontWeight.w800)),
    );
  }
}

class _CategoryButton extends StatelessWidget {
  const _CategoryButton(
      {required this.id, required this.label, required this.active});
  final String id;
  final String label;
  final bool active;
  @override
  Widget build(BuildContext context) {
    final foreground = active ? Colors.white : AppColors.darkText;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: () => context.read<CatalogProvider>().selectCategory(id),
        child: Container(
          height: 38,
          constraints: const BoxConstraints(minWidth: 72),
          padding: const EdgeInsets.symmetric(horizontal: 16),
          decoration: BoxDecoration(
            color: active ? AppColors.primaryTeal : Colors.white,
            border: Border.all(
                color: active ? AppColors.primaryTeal : AppColors.border),
            borderRadius: BorderRadius.circular(8),
          ),
          alignment: Alignment.center,
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: foreground,
              fontSize: 12,
              fontWeight: active ? FontWeight.w800 : FontWeight.w700,
            ),
          ),
        ),
      ),
    );
  }
}

class _CartPanel extends StatefulWidget {
  const _CartPanel({required this.outlet});
  final Outlet outlet;
  @override
  State<_CartPanel> createState() => _CartPanelState();
}

class _CartPanelState extends State<_CartPanel> {
  final printerService = ThermalPrinterService();
  final noteController = TextEditingController();
  String paymentMethod = 'cash';
  int paidAmount = 0;
  bool splitPayment = false;
  String? secondPaymentMethod;
  int secondPaidAmount = 0;

  @override
  void dispose() {
    noteController.dispose();
    super.dispose();
  }

  void _syncNoteController(CartProvider cart) {
    if (noteController.text == cart.transactionNote) return;
    noteController.value = TextEditingValue(
      text: cart.transactionNote,
      selection: TextSelection.collapsed(offset: cart.transactionNote.length),
    );
  }

  void addPaidDigit(String digit) {
    final next = '$paidAmount$digit'.replaceFirst(RegExp('^0+'), '');
    setState(() => paidAmount = int.tryParse(next) ?? 0);
  }

  void backspacePaid() {
    final text = paidAmount.toString();
    setState(() => paidAmount =
        text.length <= 1 ? 0 : int.parse(text.substring(0, text.length - 1)));
  }

  void clearPaid() => setState(() => paidAmount = 0);

  void addPaidAmount(int amount) {
    setState(() => paidAmount = addCashShortcut(paidAmount, amount));
    const ActivityLogService().record(
      outletId: widget.outlet.id,
      module: 'payment',
      action: 'cash_shortcut',
      entityType: 'cash_shortcut',
      entityId: 'add_$amount',
      description: 'Menggunakan shortcut pecahan pembayaran.',
      metadata: {'amount_added': amount, 'paid_amount': paidAmount},
    );
  }

  PaymentMethod _selectedPayment(CatalogProvider catalog) {
    final method = catalog.paymentMethodByCode(paymentMethod) ??
        catalog.defaultPaymentMethod;
    if (method.code != paymentMethod) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) setState(() => paymentMethod = method.code);
      });
    }
    return method;
  }

  PaymentMethod _methodByCode(CatalogProvider catalog, String code) =>
      catalog.paymentMethodByCode(code) ?? catalog.defaultPaymentMethod;

  List<TransactionPayment> _checkoutPayments(
      CatalogProvider catalog, int total) {
    final primary = _methodByCode(catalog, paymentMethod);
    if (total <= 0) {
      return [TransactionPayment(method: primary.code, amount: 0)];
    }
    if (!splitPayment) {
      return [
        TransactionPayment(
          method: primary.code,
          amount: primary.isCash ? paidAmount : total,
        )
      ];
    }

    final secondCode = secondPaymentMethod;
    final rows = <TransactionPayment>[
      TransactionPayment(method: primary.code, amount: paidAmount),
      if (secondCode != null && secondCode != primary.code)
        TransactionPayment(method: secondCode, amount: secondPaidAmount),
    ].where((payment) => payment.amount > 0).toList();
    return rows.take(2).toList();
  }

  String? _paymentValidationMessage(
      List<TransactionPayment> payments, int total) {
    if (payments.isEmpty) return 'Pilih minimal satu metode pembayaran.';
    if (payments.length > 2) return 'Maksimal dua metode pembayaran.';
    final paid = payments.fold(0, (sum, payment) => sum + payment.amount);
    if (paid < total) return 'Nominal bayar kurang dari total.';
    final hasCash = payments.any((payment) => payment.isCash);
    if (!hasCash && paid != total) {
      return 'Pembayaran non-tunai harus pas sesuai total.';
    }
    return null;
  }

  int _paidTotal(List<TransactionPayment> payments) =>
      payments.fold(0, (sum, payment) => sum + payment.amount);

  void _enableSplitPayment(CatalogProvider catalog, int total) {
    final methods = catalog.paymentMethods;
    if (methods.length < 2) return;
    final primary = _methodByCode(catalog, paymentMethod);
    final fallback = methods.firstWhere(
      (method) => method.code != primary.code,
      orElse: () => methods.first,
    );
    setState(() {
      splitPayment = true;
      paidAmount = primary.isCash ? paidAmount : total;
      secondPaymentMethod = fallback.code;
      secondPaidAmount = (total - paidAmount).clamp(0, total).toInt();
    });
  }

  void _disableSplitPayment() {
    setState(() {
      splitPayment = false;
      secondPaymentMethod = null;
      secondPaidAmount = 0;
    });
  }

  List<TransactionItem> printableItems(
      CartProvider cart, CatalogProvider catalog) {
    return cart.items
        .map((item) => TransactionItem(
            productId: item.product.id,
            productName: item.product.name,
            categoryId: item.product.categoryId,
            categoryName: item.product.categoryName.isNotEmpty
                ? item.product.categoryName
                : catalog.categoryName(item.product.categoryId),
            categorySortOrder: item.product.categorySortOrder,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            subtotal: item.subtotal,
            selectedVariants: item.selectedVariants))
        .toList();
  }

  String printableOrderNumber(CartProvider cart) =>
      cart.currentOpenBillOrderNumber ?? 'ORDER BELUM DISIMPAN';

  Future<OpenBill> _ensureOpenBillForPrint(CartProvider cart) async {
    final tableNumber = cart.tableNumber?.trim();
    if (cart.serviceType == 'dine_in' &&
        (tableNumber == null || tableNumber.isEmpty)) {
      throw Exception('Pilih meja dulu sebelum print order dine in.');
    }
    final auth = context.read<AuthProvider>().user!;
    final provider = context.read<OpenBillProvider>();
    final bill = await provider.saveFromCart(
      outlet: widget.outlet,
      cashier: auth,
      serviceType: cart.serviceType,
      tableNumber: tableNumber,
      cartItems: cart.items,
      transactions: context.read<TransactionProvider>().transactions,
      customer: cart.selectedCustomer,
      openBillId: cart.currentOpenBillId,
    );
    cart.attachOpenBill(bill);
    return bill;
  }

  Future<void> _showOrderPrintPreview({
    required String template,
    required CartProvider cart,
    required CatalogProvider catalog,
    required List<TransactionItem> items,
    required String updateLabel,
    OpenBill? bill,
    bool removal = false,
    bool updateCheckpoint = true,
  }) {
    final auth = context.read<AuthProvider>().user!;
    final openBillProvider = context.read<OpenBillProvider>();
    final selectedCustomerName = cart.selectedCustomer?.name.trim();
    final billCustomerName = bill?.customerName?.trim();
    final customerName = selectedCustomerName?.isNotEmpty == true
        ? selectedCustomerName
        : billCustomerName;
    final checkpointBeforePrint = bill == null
        ? const <TransactionItem>[]
        : template == 'customer_order'
            ? (openBillProvider.findById(bill.id) ?? bill).customerPrintedItems
            : (openBillProvider.findById(bill.id) ?? bill).kitchenPrintedItems;
    Future<void> commitCheckpoint() async {
      if (!updateCheckpoint || bill == null) return;
      final nextCheckpoint = applyPrintedItems(
        checkpoint: checkpointBeforePrint,
        printed: items,
        removal: removal,
      );
      await openBillProvider.savePrintCheckpoint(
        billId: bill.id,
        template: template,
        items: nextCheckpoint,
      );
    }

    Future<void> onPrint(List<String> lines) async {
      final bytes = await ThermalTicketBuilder.bytesFromLines(lines);
      await printerService.printBytes(
        settings: catalog.printSettings,
        bytes: bytes,
      );
      await commitCheckpoint();
    }

    return showDialog<void>(
      context: context,
      builder: (_) => template == 'customer_order'
          ? PrintPreviewDialog.customer(
              outlet: widget.outlet,
              orderNumber: printableOrderNumber(cart),
              cashierName: auth.name,
              serviceType: cart.serviceType,
              tableNumber: cart.tableNumber,
              customerName: customerName,
              items: items,
              updateLabel: updateLabel,
              footerText: catalog.printFooterText('customer_order'),
              onPrint: onPrint,
            )
          : PrintPreviewDialog.kitchen(
              outlet: widget.outlet,
              orderNumber: printableOrderNumber(cart),
              cashierName: auth.name,
              serviceType: cart.serviceType,
              tableNumber: cart.tableNumber,
              customerName: customerName,
              items: items,
              updateLabel: updateLabel,
              onPrint: onPrint,
            ),
    );
  }

  Future<void> _printOrder(String template) async {
    if (context.read<AuthProvider>().user?.can('apk.sales', 'print') != true) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Role tidak memiliki izin print order.')));
      return;
    }
    final cart = context.read<CartProvider>();
    final catalog = context.read<CatalogProvider>();
    if (cart.isEmpty) return;

    try {
      final bill = await _ensureOpenBillForPrint(cart);
      if (!mounted) return;
      if (cart.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Cart sudah kosong. Print order dibatalkan.')));
        return;
      }
      final currentItems = printableItems(cart, catalog);
      final currentKeys = currentItems.map(orderPrintItemKey).toSet();
      final checkpoint = template == 'customer_order'
          ? bill.customerPrintedItems
          : bill.kitchenPrintedItems;
      final delta = calculateOrderPrintDelta(
        current: currentItems,
        checkpoint: checkpoint,
      );
      final addedItems = delta.added
          .where((item) => currentKeys.contains(orderPrintItemKey(item)))
          .toList();
      if (delta.isEmpty) {
        final reprint = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Tidak Ada Perubahan Order'),
            content: const Text(
                'Tidak ada tambahan atau koreksi sejak cetak terakhir. Cetak ulang seluruh order?'),
            actions: [
              OutlinedButton(
                  onPressed: () => Navigator.pop(context, false),
                  child: const Text('Batal')),
              ElevatedButton(
                  onPressed: () => Navigator.pop(context, true),
                  child: const Text('Reprint Semua')),
            ],
          ),
        );
        if (reprint == true && mounted) {
          await _showOrderPrintPreview(
            template: template,
            cart: cart,
            catalog: catalog,
            items: currentItems,
            updateLabel: 'REPRINT',
            bill: bill,
            updateCheckpoint: false,
          );
        }
        return;
      }
      if (addedItems.isNotEmpty && mounted) {
        await _showOrderPrintPreview(
          template: template,
          cart: cart,
          catalog: catalog,
          items: addedItems,
          updateLabel: checkpoint.isEmpty ? 'NEW ORDER' : 'TAMBAHAN ORDER',
          bill: bill,
        );
      }
      if (delta.removed.isNotEmpty && mounted) {
        await _showOrderPrintPreview(
          template: template,
          cart: cart,
          catalog: catalog,
          items: delta.removed,
          updateLabel: 'KOREKSI / BATAL',
          bill: bill,
          removal: true,
        );
      }
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(error.toString().replaceFirst('Exception: ', ''))));
    }
  }

  Future<void> printCustomerOrder() => _printOrder('customer_order');

  Future<void> printKitchenOrder() => _printOrder('kitchen_order');

  Future<void> saveOpenBill() async {
    final cart = context.read<CartProvider>();
    final auth = context.read<AuthProvider>().user!;
    final requiredAction = cart.currentOpenBillId == null ? 'create' : 'update';
    if (!auth.can('apk.sales', requiredAction)) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('Role tidak memiliki izin $requiredAction order.')));
      return;
    }
    if (cart.isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Cart masih kosong.')));
      return;
    }
    final selectedTableNumber = cart.tableNumber?.trim();
    if (cart.serviceType == 'dine_in' &&
        (selectedTableNumber == null || selectedTableNumber.isEmpty)) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Pilih meja dulu untuk simpan order.')));
      return;
    }

    final openBills = context.read<OpenBillProvider>();
    final existingBill = cart.serviceType == 'dine_in'
        ? openBills.findByTable(widget.outlet.id, selectedTableNumber!)
        : null;
    if (existingBill != null && existingBill.id != cart.currentOpenBillId) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Meja ini sedang terpakai. Lanjutkan ordernya dulu.')));
      return;
    }

    late final OpenBill bill;
    try {
      bill = await openBills.saveFromCart(
        outlet: widget.outlet,
        cashier: auth,
        serviceType: cart.serviceType,
        tableNumber: selectedTableNumber,
        cartItems: cart.items,
        transactions: context.read<TransactionProvider>().transactions,
        customer: cart.selectedCustomer,
        openBillId: cart.currentOpenBillId,
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(error.toString().replaceFirst('Exception: ', ''))));
      return;
    }
    cart.clear();
    clearPaid();
    _disableSplitPayment();
    if (!mounted) return;
    final savedTarget = bill.serviceType == 'dine_in'
        ? '${_openBillTargetLabel(bill)} terpakai.'
        : 'Takeaway tersimpan.';
    ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${bill.orderNumber} disimpan. $savedTarget')));
  }

  Future<void> cancelOpenBill() async {
    if (context.read<AuthProvider>().user?.can('apk.sales', 'cancel') != true) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Role tidak memiliki izin membatalkan order.')));
      return;
    }
    final cart = context.read<CartProvider>();
    final bill =
        context.read<OpenBillProvider>().findById(cart.currentOpenBillId);
    if (bill == null) {
      cart.clear();
      return;
    }
    final billTarget = _openBillTargetLabel(bill);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        title: const Text('Batalkan Order',
            style: TextStyle(
                color: AppColors.darkText, fontWeight: FontWeight.w800)),
        content: Text(
          'Order ${bill.orderNumber} ($billTarget) akan dibatalkan tanpa membuat transaksi.',
          style: const TextStyle(color: AppColors.darkText),
        ),
        actions: [
          OutlinedButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Kembali')),
          ElevatedButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Batalkan Order')),
        ],
      ),
    );
    if (confirmed != true) {
      await const ActivityLogService().record(
        outletId: widget.outlet.id,
        module: 'open_bill',
        action: 'cancel',
        outcome: 'cancelled',
        entityType: 'open_bill',
        entityId: bill.id,
        description: 'Pembatalan open bill dibatalkan pengguna.',
      );
      return;
    }
    if (!mounted) return;
    try {
      await context.read<OpenBillProvider>().remove(bill.id);
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(error.toString().replaceFirst('Exception: ', ''))));
      return;
    }
    cart.clear();
    clearPaid();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Order ${bill.orderNumber} dibatalkan.')));
  }

  Future<void> openOccupiedBill(OpenBill bill) async {
    final cart = context.read<CartProvider>();
    if (!cart.isEmpty && cart.currentOpenBillId != bill.id) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content:
              Text('Selesaikan cart aktif dulu sebelum membuka meja ini.')));
      return;
    }

    final billTarget = _openBillTargetLabel(bill);
    final continueOrder = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        title: Text('$billTarget Sedang Aktif',
            style: const TextStyle(
                color: AppColors.darkText, fontWeight: FontWeight.w800)),
        content: SizedBox(
          width: 340,
          child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                _BillSummaryLine(label: 'Order', value: bill.orderNumber),
                _BillSummaryLine(label: 'Layanan', value: billTarget),
                if (bill.customerName != null)
                  _BillSummaryLine(
                      label: 'Customer', value: bill.customerName!),
                _BillSummaryLine(
                    label: 'Total', value: formatCurrency(bill.total)),
                _BillSummaryLine(
                    label: 'Item', value: '${bill.items.length} item'),
                const SizedBox(height: 8),
                const Text(
                  'Lanjutkan order untuk tambah item atau bayar order ini.',
                  style: TextStyle(color: AppColors.mutedBlue, fontSize: 12),
                ),
              ]),
        ),
        actions: [
          OutlinedButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Tutup')),
          ElevatedButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Lanjutkan Order')),
        ],
      ),
    );
    if (continueOrder != true) return;
    if (!mounted) return;
    _loadOpenBill(bill);
  }

  void _loadOpenBill(OpenBill bill) {
    final cart = context.read<CartProvider>();
    final products =
        context.read<CatalogProvider>().productsForOutlet(widget.outlet.id);
    final customer =
        context.read<CatalogProvider>().customerById(bill.customerId);
    cart.loadOpenBill(bill, products, customer);
  }

  Future<void> _showRunningOrders(List<OpenBill> bills) async {
    final selected = await showModalBottomSheet<OpenBill>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      builder: (sheetContext) => _RunningOrdersSheet(bills: bills),
    );
    if (selected == null || !mounted) return;
    final cart = context.read<CartProvider>();
    if (!cart.isEmpty && cart.currentOpenBillId != selected.id) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content:
              Text('Selesaikan cart aktif dulu sebelum membuka order ini.')));
      return;
    }
    _loadOpenBill(selected);
  }

  Future<void> pay() async {
    final cart = context.read<CartProvider>();
    final auth = context.read<AuthProvider>().user!;
    if (!auth.can('apk.sales', 'create')) {
      await const ActivityLogService().record(
          outletId: widget.outlet.id,
          module: 'transaction',
          action: 'checkout',
          outcome: 'failed',
          description: 'Checkout ditolak karena permission tidak tersedia.');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Role tidak memiliki izin membuat transaksi.')));
      return;
    }
    final openBillProvider = context.read<OpenBillProvider>();
    final transactionProvider = context.read<TransactionProvider>();
    final catalogProvider = context.read<CatalogProvider>();
    final selectedTableNumber = cart.tableNumber?.trim();
    final openBillId = cart.currentOpenBillId;
    final customer = cart.selectedCustomer == null
        ? null
        : catalogProvider.customerById(cart.selectedCustomer!.id) ??
            cart.selectedCustomer;
    final pointsEarned =
        customer == null ? 0 : cart.totalAfterDiscount ~/ 10000;
    if (cart.isEmpty) {
      await const ActivityLogService().record(
          outletId: widget.outlet.id,
          module: 'transaction',
          action: 'checkout',
          outcome: 'failed',
          description: 'Checkout gagal karena keranjang kosong.');
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Cart masih kosong.')));
      return;
    }
    if (cart.serviceType == 'dine_in' &&
        (selectedTableNumber == null || selectedTableNumber.isEmpty)) {
      await const ActivityLogService().record(
          outletId: widget.outlet.id,
          module: 'transaction',
          action: 'checkout',
          outcome: 'failed',
          description: 'Checkout dine in gagal karena meja belum dipilih.');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content:
              Text('Pilih meja dulu untuk dine in, atau ubah ke takeaway.')));
      return;
    }
    var checkoutPayments =
        _checkoutPayments(catalogProvider, cart.totalAfterDiscount);
    final isDineIn = cart.serviceType == 'dine_in';
    if (isDineIn) {
      final result = await _showDineInPaymentSheet(
        cart: cart,
        catalog: catalogProvider,
        customerName: customer?.name,
      );
      if (result == null) {
        await const ActivityLogService().record(
            outletId: widget.outlet.id,
            module: 'transaction',
            action: 'checkout',
            outcome: 'cancelled',
            description: 'Pembayaran dine in dibatalkan.',
            metadata: {
              'total': cart.totalAfterDiscount,
              'item_count': cart.itemCount
            });
        return;
      }
      if (!mounted) return;
      checkoutPayments = result.payments;
      setState(() {
        paymentMethod = result.paymentMethod.code;
        paidAmount = result.payments.first.amount;
        splitPayment = result.payments.length > 1;
        secondPaymentMethod =
            result.payments.length > 1 ? result.payments[1].method : null;
        secondPaidAmount =
            result.payments.length > 1 ? result.payments[1].amount : 0;
      });
    }
    final paymentError =
        _paymentValidationMessage(checkoutPayments, cart.totalAfterDiscount);
    final paid = _paidTotal(checkoutPayments);
    if (paymentError != null) {
      await const ActivityLogService().record(
          outletId: widget.outlet.id,
          module: 'transaction',
          action: 'checkout',
          outcome: 'failed',
          description: 'Checkout gagal karena pembayaran tidak valid.',
          metadata: {'total': cart.totalAfterDiscount, 'paid_amount': paid});
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(paymentError)));
      return;
    }
    final hasNonCashPayment =
        checkoutPayments.any((payment) => !payment.isCash);
    if (hasNonCashPayment && !isDineIn) {
      final nonCashPayment = checkoutPayments.firstWhere(
          (payment) => !payment.isCash,
          orElse: () => checkoutPayments.first);
      final selectedPayment =
          catalogProvider.paymentMethodByCode(nonCashPayment.method) ??
              catalogProvider.defaultPaymentMethod;
      final confirmed =
          await _confirmNonCashPayment(selectedPayment, nonCashPayment.amount);
      if (!confirmed) {
        await const ActivityLogService().record(
            outletId: widget.outlet.id,
            module: 'transaction',
            action: 'checkout',
            outcome: 'cancelled',
            description: 'Konfirmasi pembayaran non-tunai dibatalkan.',
            metadata: {
              'payment_method': selectedPayment.code,
              'total': cart.totalAfterDiscount
            });
        return;
      }
      if (!mounted) return;
    }
    final operationalAt = DateTime.now();
    late final PosTransaction trx;
    try {
      trx = await transactionProvider.createTransaction(
          outlet: widget.outlet,
          cashier: auth,
          cartItems: cart.items,
          serviceType: cart.serviceType,
          tableNumber: selectedTableNumber,
          paymentMethod: checkoutPayments.first.method,
          paidAmount: paid,
          payments: checkoutPayments,
          subtotal: cart.subtotal,
          discountAmount: cart.discountAmount,
          discountType: cart.manualDiscountType,
          discountValue: cart.manualDiscountValue,
          discountName: cart.discountLabel,
          note: cart.transactionNote,
          customer: customer,
          customerPointsEarned: pointsEarned,
          openBillId: openBillId,
          orderNumberOverride: cart.currentOpenBillOrderNumber,
          operationalAt: operationalAt);
    } catch (error) {
      if (!mounted) return;
      final message =
          error.toString().replaceFirst(RegExp(r'^Exception:\s*'), '');
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message)));
      return;
    }
    if (pointsEarned > 0) {
      await catalogProvider.addCustomerPoints(customer?.id, pointsEarned);
    }
    if (openBillId != null) {
      await openBillProvider.remove(openBillId);
    }
    final refreshNow = DateTime.now();
    final refreshFrom =
        DateTime(refreshNow.year, refreshNow.month, refreshNow.day);
    final refreshTo = DateTime(
        refreshNow.year, refreshNow.month, refreshNow.day, 23, 59, 59, 999);
    Future.microtask(() => transactionProvider.fetchHistory(
          outletId: widget.outlet.id,
          from: refreshFrom,
          to: refreshTo,
        ));
    cart.clear();
    if (!mounted) return;
    setState(() {
      paidAmount = 0;
      splitPayment = false;
      secondPaymentMethod = null;
      secondPaidAmount = 0;
    });
    if (catalogProvider.canPrintTemplate('bill_receipt')) {
      showDialog(
          context: context,
          builder: (_) => ReceiptDialog(
              transaction: trx,
              outlet: widget.outlet,
              cashierName: auth.name,
              paymentLabel:
                  _paymentLabel(catalogProvider, trx.effectivePayments),
              footerText: catalogProvider.printFooterText('bill_receipt'),
              onPrint: (lines) async {
                final bytes = await ThermalTicketBuilder.bytesFromLines(lines);
                await printerService.printBytes(
                  settings: catalogProvider.printSettings,
                  bytes: bytes,
                );
              }));
    } else {
      final statusText = trx.synced ? 'lunas (Online).' : 'disimpan lokal (Offline). Jaringan bermasalah.';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(
              '${trx.orderNumber} $statusText Total ${formatCurrency(trx.total)}, dibayar ${formatCurrency(trx.paidAmount)}, kembali ${formatCurrency(trx.changeAmount)}.')));
    }
  }

  Future<_PaymentCheckoutResult?> _showDineInPaymentSheet({
    required CartProvider cart,
    required CatalogProvider catalog,
    required String? customerName,
  }) {
    return showModalBottomSheet<_PaymentCheckoutResult>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      constraints: const BoxConstraints(maxWidth: 760),
      builder: (_) => _DineInPaymentSheet(
        paymentMethods: catalog.paymentMethods,
        initialPaymentCode: paymentMethod,
        initialPaidAmount: paidAmount,
        orderNumber: cart.currentOpenBillOrderNumber,
        tableNumber: cart.tableNumber,
        customerName: customerName,
        subtotal: cart.subtotal,
        discountName: cart.discountLabel,
        discountAmount: cart.discountAmount,
        total: cart.totalAfterDiscount,
      ),
    );
  }

  Future<bool> _confirmNonCashPayment(PaymentMethod method, int total) async {
    final label = method.name;
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        title: Text(
          'Konfirmasi $label',
          style: const TextStyle(
            color: AppColors.darkText,
            fontWeight: FontWeight.w800,
          ),
        ),
        content: SizedBox(
          width: 340,
          child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Pastikan pembayaran $label sudah diterima sebelum melanjutkan.',
                  style: const TextStyle(
                    color: AppColors.darkText,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  'Total tagihan: ${formatCurrency(total)}',
                  style: const TextStyle(
                    color: AppColors.darkText,
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ]),
        ),
        actions: [
          OutlinedButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Batal')),
          ElevatedButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Tandai Lunas')),
        ],
      ),
    );
    return result ?? false;
  }

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartProvider>();
    final user = context.watch<AuthProvider>().user!;
    final canCreateSale = user.can('apk.sales', 'create');
    final canUpdateSale = user.can('apk.sales', 'update');
    final canModifyCart =
        cart.currentOpenBillId == null ? canCreateSale : canUpdateSale;
    final canPrintSale = user.can('apk.sales', 'print');
    _syncNoteController(cart);
    final catalog = context.watch<CatalogProvider>();
    final paymentMethods = catalog.paymentMethods;
    final selectedPayment = _selectedPayment(catalog);
    final tables = catalog.tablesForOutlet(widget.outlet.id);
    final openBills = context.watch<OpenBillProvider>();
    final transactions = context.watch<TransactionProvider>();
    final actionBusy = openBills.submitting || transactions.submitting;
    final currentBill = openBills.findById(cart.currentOpenBillId);
    final runningBills = openBills.openBills
        .where((bill) => bill.outletId == widget.outlet.id)
        .toList()
      ..sort(_compareOpenBills);
    final selectedCustomer = cart.selectedCustomer == null
        ? null
        : catalog.customerById(cart.selectedCustomer!.id) ??
            cart.selectedCustomer;
    final compactTablet = ResponsiveLayout.isLandscapeTablet(context);
    final keyboardOpen = MediaQuery.viewInsetsOf(context).bottom > 0;
    final showTakeawayPayment = cart.serviceType == 'takeaway';
    final cartItems = cart.items.isEmpty
        ? const Padding(
            padding: EdgeInsets.symmetric(vertical: 28),
            child: Center(
                child: Text('Cart masih kosong.',
                    style: TextStyle(color: AppColors.darkText))),
          )
        : Column(
            children: [
              for (var index = 0; index < cart.items.length; index++) ...[
                if (index > 0) const Divider(),
                Builder(builder: (context) {
                  final item = cart.items[index];
                  return Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(item.product.name,
                            style: const TextStyle(
                                color: AppColors.darkText,
                                fontSize: 12,
                                fontWeight: FontWeight.w800)),
                        if (item.selectedVariants.isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Wrap(
                            spacing: 4,
                            runSpacing: 4,
                            children: item.selectedVariants
                                .map((variant) => Container(
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 6, vertical: 3),
                                      decoration: BoxDecoration(
                                          color: const Color(0xFFEAF1F4),
                                          borderRadius:
                                              BorderRadius.circular(999)),
                                      child: Text(variant.name,
                                          style: const TextStyle(
                                              color: AppColors.darkText,
                                              fontSize: 10,
                                              fontWeight: FontWeight.w700)),
                                    ))
                                .toList(),
                          ),
                        ],
                        Row(children: [
                          Text(formatCurrency(item.unitPrice),
                              style: const TextStyle(
                                  color: AppColors.mutedBlue,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600)),
                          const Spacer(),
                          IconButton(
                              onPressed: canModifyCart
                                  ? () => cart.decrease(item.lineKey)
                                  : null,
                              icon: const Icon(Icons.remove_circle_outline)),
                          Text('${item.quantity}',
                              style: const TextStyle(
                                  color: AppColors.darkText,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w800)),
                          IconButton(
                              onPressed: canModifyCart
                                  ? () => cart.increase(item.lineKey)
                                  : null,
                              icon: const Icon(Icons.add_circle_outline))
                        ])
                      ]);
                }),
              ],
            ],
          );
    List<Widget> buildChildren(bool compactPanel) {
      return [
        Row(children: [
          Text('Cart', style: Theme.of(context).textTheme.titleMedium),
          const Spacer(),
          TextButton(
              onPressed: canModifyCart ? cart.clear : null,
              child: const Text('Clear'))
        ]),
        const SizedBox(height: 6),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: runningBills.isEmpty
                ? null
                : () => _showRunningOrders(runningBills),
            icon: const Icon(Icons.receipt_long_outlined),
            label: Text('Order Berjalan (${runningBills.length})'),
          ),
        ),
        if (currentBill != null) ...[
          const SizedBox(height: 6),
          _OpenBillBanner(bill: currentBill),
        ],
        const SizedBox(height: 6),
        _CustomerSelector(
          outlet: widget.outlet,
          customer: selectedCustomer,
          canModify: canModifyCart,
          canCreate: canCreateSale,
          onSelect: (customer) => cart.setCustomer(customer),
          onClear: () => cart.setCustomer(null),
        ),
        const SizedBox(height: 6),
        _ServiceSelector(
          value: cart.serviceType,
          onChanged: cart.setServiceType,
        ),
        if (cart.serviceType == 'dine_in') ...[
          const SizedBox(height: 6),
          _TableSelector(
            tables: tables,
            value: cart.tableNumber,
            outletId: widget.outlet.id,
            openBills: openBills,
            currentOpenBillId: cart.currentOpenBillId,
            onChanged: (tableNumber) {
              final bill = openBills.findByTable(widget.outlet.id, tableNumber);
              if (bill != null && bill.id != cart.currentOpenBillId) {
                openOccupiedBill(bill);
                return;
              }
              cart.setTable(tableNumber);
            },
          )
        ],
        const SizedBox(height: 6),
        TextField(
          controller: noteController,
          maxLength: 500,
          minLines: 1,
          maxLines: compactPanel ? 2 : 3,
          readOnly: !canModifyCart,
          onChanged: canModifyCart ? cart.setTransactionNote : null,
          decoration: const InputDecoration(
            labelText: 'Catatan transaksi',
            hintText: 'Opsional, tampil di riwayat transaksi admin',
            border: OutlineInputBorder(),
          ),
        ),
        const Divider(height: 16),
        cartItems,
        const Divider(height: 16),
        if (showTakeawayPayment && canCreateSale) ...[
          if (splitPayment && secondPaymentMethod != null)
            _SplitPaymentSection(
              paymentMethods: paymentMethods,
              total: cart.totalAfterDiscount,
              firstMethodCode: paymentMethod,
              firstAmount: paidAmount,
              secondMethodCode: secondPaymentMethod!,
              secondAmount: secondPaidAmount,
              onFirstMethodChanged: (method) => setState(() {
                paymentMethod = method.code;
                if (secondPaymentMethod == method.code) {
                  secondPaymentMethod = paymentMethods
                      .firstWhere((item) => item.code != method.code,
                          orElse: () => method)
                      .code;
                }
              }),
              onFirstAmountChanged: (amount) =>
                  setState(() => paidAmount = amount),
              onSecondMethodChanged: (method) => setState(() {
                secondPaymentMethod = method.code;
                if (paymentMethod == method.code) {
                  paymentMethod = paymentMethods
                      .firstWhere((item) => item.code != method.code,
                          orElse: () => method)
                      .code;
                }
              }),
              onSecondAmountChanged: (amount) =>
                  setState(() => secondPaidAmount = amount),
              onRemoveSecond: _disableSplitPayment,
            )
          else ...[
            _PaymentSection(
              paymentMethods: paymentMethods,
              selectedPayment: selectedPayment,
              total: cart.totalAfterDiscount,
              paidAmount: paidAmount,
              onPaymentChanged: (method) {
                setState(() => paymentMethod = method.code);
                const ActivityLogService().record(
                    outletId: widget.outlet.id,
                    module: 'payment',
                    action: 'method_select',
                    entityType: 'payment_method',
                    entityId: method.code,
                    description: 'Memilih metode pembayaran ${method.name}.');
              },
              onDigit: addPaidDigit,
              onAddAmount: addPaidAmount,
              onExact: () {
                setState(() =>
                    paidAmount = exactCashShortcut(cart.totalAfterDiscount));
                const ActivityLogService().record(
                    outletId: widget.outlet.id,
                    module: 'payment',
                    action: 'cash_shortcut',
                    entityType: 'cash_shortcut',
                    entityId: 'exact',
                    description: 'Menggunakan shortcut Uang Pas.',
                    metadata: {'paid_amount': paidAmount});
              },
              onBackspace: backspacePaid,
              onClear: clearPaid,
            ),
            if (paymentMethods.length > 1) ...[
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () =>
                      _enableSplitPayment(catalog, cart.totalAfterDiscount),
                  icon: const Icon(Icons.call_split),
                  label: const Text('Tambah metode pembayaran'),
                ),
              ),
            ],
          ],
          const Divider(height: 16),
        ],
        Row(children: [
          const Text('Subtotal',
              style: TextStyle(
                  color: AppColors.darkText, fontWeight: FontWeight.w700)),
          const Spacer(),
          Text(formatCurrency(cart.subtotal),
              style: const TextStyle(
                  color: AppColors.darkText, fontWeight: FontWeight.w800))
        ]),
        const SizedBox(height: 6),
        if (canModifyCart)
          _ManualDiscountInput(
            type: cart.manualDiscountType,
            value: cart.manualDiscountValue,
            subtotal: cart.subtotal,
            discountAmount: cart.discountAmount,
            onChanged: cart.setManualDiscount,
            onClear: cart.clearDiscount,
          ),
        if (cart.hasManualDiscount) ...[
          const SizedBox(height: 6),
          Row(children: [
            const Text('Diskon Manual',
                style: TextStyle(
                    color: AppColors.mutedBlue,
                    fontSize: 12,
                    fontWeight: FontWeight.w700)),
            const Spacer(),
            Text('-${formatCurrency(cart.discountAmount)}',
                style: const TextStyle(
                    color: AppColors.danger, fontWeight: FontWeight.w800))
          ]),
        ],
        const SizedBox(height: 6),
        Row(children: [
          const Text('Total',
              style: TextStyle(
                  color: AppColors.darkText, fontWeight: FontWeight.w800)),
          const Spacer(),
          Text(formatCurrency(cart.totalAfterDiscount),
              style: Theme.of(context).textTheme.titleMedium)
        ]),
        if (catalog.canPrintTemplate('customer_order') ||
            catalog.canPrintTemplate('kitchen_order')) ...[
          const SizedBox(height: 8),
          Row(children: [
            if (catalog.canPrintTemplate('customer_order'))
              Expanded(
                  child: OutlinedButton.icon(
                      onPressed: cart.isEmpty || actionBusy || !canPrintSale
                          ? null
                          : printCustomerOrder,
                      icon: const Icon(Icons.receipt_long_outlined),
                      label: const Text('Print Customer'))),
            if (catalog.canPrintTemplate('customer_order') &&
                catalog.canPrintTemplate('kitchen_order'))
              const SizedBox(width: 8),
            if (catalog.canPrintTemplate('kitchen_order'))
              Expanded(
                  child: OutlinedButton.icon(
                      onPressed: cart.isEmpty || actionBusy || !canPrintSale
                          ? null
                          : printKitchenOrder,
                      icon: const Icon(Icons.local_dining_outlined),
                      label: const Text('Print Kitchen'))),
          ]),
        ],
        const SizedBox(height: 8),
        SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
                onPressed: cart.isEmpty ||
                        actionBusy ||
                        !(cart.currentOpenBillId == null
                            ? canCreateSale
                            : canUpdateSale)
                    ? null
                    : saveOpenBill,
                icon: const Icon(Icons.save_outlined),
                label: Text(actionBusy
                    ? 'Memproses...'
                    : cart.currentOpenBillId == null
                        ? 'Simpan Order'
                        : 'Update Order'))),
        if (cart.currentOpenBillId != null) ...[
          const SizedBox(height: 6),
          SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                  onPressed: actionBusy || !user.can('apk.sales', 'cancel')
                      ? null
                      : cancelOpenBill,
                  icon: const Icon(Icons.cancel_outlined),
                  label: Text(actionBusy ? 'Memproses...' : 'Batal Order'))),
          const SizedBox(height: 6),
        ],
        SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
                onPressed:
                    cart.isEmpty || actionBusy || !canCreateSale ? null : pay,
                icon: const Icon(Icons.payments),
                label: Text(actionBusy
                    ? 'Memproses...'
                    : cart.serviceType == 'dine_in'
                        ? 'Bayar Final'
                        : splitPayment
                            ? 'Bayar Split'
                            : selectedPayment.isCash
                                ? 'Bayar'
                                : 'Konfirmasi ${selectedPayment.name}'))),
      ];
    }

    return Card(
      child: LayoutBuilder(builder: (context, constraints) {
        final compactPanel = keyboardOpen ||
            (showTakeawayPayment && selectedPayment.isCash) ||
            constraints.maxHeight < 680;
        final content = Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: buildChildren(compactPanel));
        return Padding(
          padding: EdgeInsets.all(compactTablet ? 6 : 8),
          child: SingleChildScrollView(
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            child: content,
          ),
        );
      }),
    );
  }
}

IconData _paymentIcon(String code) {
  switch (code) {
    case 'cash':
      return Icons.payments;
    case 'transfer':
      return Icons.account_balance;
    case 'qris':
      return Icons.qr_code_2;
    default:
      return Icons.credit_card;
  }
}

String _paymentLabel(
    CatalogProvider catalog, List<TransactionPayment> payments) {
  if (payments.isEmpty) return '-';
  return payments
      .map((payment) => catalog.paymentLabel(payment.method))
      .join(' + ');
}

class _PaymentCheckoutResult {
  const _PaymentCheckoutResult({
    required this.paymentMethod,
    required this.paidAmount,
    required this.payments,
  });

  final PaymentMethod paymentMethod;
  final int paidAmount;
  final List<TransactionPayment> payments;
}

class _SplitPaymentSection extends StatelessWidget {
  const _SplitPaymentSection({
    required this.paymentMethods,
    required this.total,
    required this.firstMethodCode,
    required this.firstAmount,
    required this.secondMethodCode,
    required this.secondAmount,
    required this.onFirstMethodChanged,
    required this.onFirstAmountChanged,
    required this.onSecondMethodChanged,
    required this.onSecondAmountChanged,
    required this.onRemoveSecond,
  });

  final List<PaymentMethod> paymentMethods;
  final int total;
  final String firstMethodCode;
  final int firstAmount;
  final String secondMethodCode;
  final int secondAmount;
  final ValueChanged<PaymentMethod> onFirstMethodChanged;
  final ValueChanged<int> onFirstAmountChanged;
  final ValueChanged<PaymentMethod> onSecondMethodChanged;
  final ValueChanged<int> onSecondAmountChanged;
  final VoidCallback onRemoveSecond;

  @override
  Widget build(BuildContext context) {
    final methods =
        paymentMethods.isEmpty ? PaymentMethod.defaults : paymentMethods;
    final paid = firstAmount + secondAmount;
    final change = paid - total;
    final hasCash = [firstMethodCode, secondMethodCode]
        .any((code) => code.toLowerCase() == 'cash');
    final valid = paid >= total && (hasCash || paid == total);

    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        const Expanded(
          child: Text('Split Pembayaran',
              style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                  color: AppColors.darkText)),
        ),
        TextButton.icon(
          onPressed: onRemoveSecond,
          icon: const Icon(Icons.close, size: 16),
          label: const Text('Batal split'),
        )
      ]),
      const SizedBox(height: 6),
      _PaymentAmountRow(
        label: 'Metode 1',
        methods: methods,
        methodCode: firstMethodCode,
        amount: firstAmount,
        onMethodChanged: onFirstMethodChanged,
        onAmountChanged: onFirstAmountChanged,
        onRemaining: () => onFirstAmountChanged(
            (total - secondAmount).clamp(0, total).toInt()),
      ),
      const SizedBox(height: 8),
      _PaymentAmountRow(
        label: 'Metode 2',
        methods: methods,
        methodCode: secondMethodCode,
        amount: secondAmount,
        onMethodChanged: onSecondMethodChanged,
        onAmountChanged: onSecondAmountChanged,
        onRemaining: () => onSecondAmountChanged(
            (total - firstAmount).clamp(0, total).toInt()),
      ),
      const SizedBox(height: 8),
      Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: valid
              ? AppColors.secondaryGreen.withOpacity(0.18)
              : AppColors.danger.withOpacity(0.08),
          border: Border.all(
              color: valid
                  ? AppColors.secondaryGreen
                  : AppColors.danger.withOpacity(0.35)),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(
          change >= 0
              ? 'Total bayar ${formatCurrency(paid)}${change > 0 ? ' · Kembali ${formatCurrency(change)}' : ''}'
              : 'Kurang ${formatCurrency(change.abs())}',
          style: TextStyle(
            color: valid ? AppColors.darkText : AppColors.danger,
            fontWeight: FontWeight.w800,
            fontSize: 12,
          ),
        ),
      ),
    ]);
  }
}

class _PaymentAmountRow extends StatefulWidget {
  const _PaymentAmountRow({
    required this.label,
    required this.methods,
    required this.methodCode,
    required this.amount,
    required this.onMethodChanged,
    required this.onAmountChanged,
    required this.onRemaining,
  });

  final String label;
  final List<PaymentMethod> methods;
  final String methodCode;
  final int amount;
  final ValueChanged<PaymentMethod> onMethodChanged;
  final ValueChanged<int> onAmountChanged;
  final VoidCallback onRemaining;

  @override
  State<_PaymentAmountRow> createState() => _PaymentAmountRowState();
}

class _PaymentAmountRowState extends State<_PaymentAmountRow> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: _formattedAmount(widget.amount));
  }

  @override
  void didUpdateWidget(covariant _PaymentAmountRow oldWidget) {
    super.didUpdateWidget(oldWidget);
    final currentAmount = parseThousandsInput(_controller.text);
    if (currentAmount == widget.amount) return;
    final nextText = _formattedAmount(widget.amount);
    _controller.value = TextEditingValue(
      text: nextText,
      selection: TextSelection.collapsed(offset: nextText.length),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  String _formattedAmount(int amount) =>
      amount <= 0 ? '' : formatNumber(amount);

  @override
  Widget build(BuildContext context) {
    final selectedCode =
        widget.methods.any((method) => method.code == widget.methodCode)
            ? widget.methodCode
            : widget.methods.first.code;
    return Row(children: [
      Expanded(
        flex: 4,
        child: DropdownButtonFormField<String>(
          value: selectedCode,
          decoration: InputDecoration(labelText: widget.label),
          items: [
            for (final method in widget.methods)
              DropdownMenuItem(value: method.code, child: Text(method.name))
          ],
          onChanged: (code) {
            if (code == null) return;
            widget.onMethodChanged(
                widget.methods.firstWhere((method) => method.code == code));
          },
        ),
      ),
      const SizedBox(width: 8),
      Expanded(
        flex: 3,
        child: TextFormField(
          controller: _controller,
          keyboardType: TextInputType.number,
          inputFormatters: const [ThousandsInputFormatter()],
          decoration: const InputDecoration(labelText: 'Nominal'),
          onChanged: (value) =>
              widget.onAmountChanged(parseThousandsInput(value)),
        ),
      ),
      const SizedBox(width: 6),
      TextButton(onPressed: widget.onRemaining, child: const Text('Sisa')),
    ]);
  }
}

class _PaymentSection extends StatelessWidget {
  const _PaymentSection({
    required this.paymentMethods,
    required this.selectedPayment,
    required this.total,
    required this.paidAmount,
    required this.onPaymentChanged,
    required this.onDigit,
    required this.onAddAmount,
    required this.onExact,
    required this.onBackspace,
    required this.onClear,
  });

  final List<PaymentMethod> paymentMethods;
  final PaymentMethod selectedPayment;
  final int total;
  final int paidAmount;
  final ValueChanged<PaymentMethod> onPaymentChanged;
  final ValueChanged<String> onDigit;
  final ValueChanged<int> onAddAmount;
  final VoidCallback onExact;
  final VoidCallback onBackspace;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final methods =
        paymentMethods.isEmpty ? PaymentMethod.defaults : paymentMethods;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Metode Pembayaran',
            style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: AppColors.darkText)),
        const SizedBox(height: 6),
        GridView.count(
          crossAxisCount: methods.length <= 2 ? 2 : 3,
          childAspectRatio: 2.25,
          crossAxisSpacing: 8,
          mainAxisSpacing: 8,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          children: [
            for (final method in methods)
              _PaymentMethodButton(
                label: method.name,
                icon: _paymentIcon(method.code),
                active: selectedPayment.code == method.code,
                onTap: () => onPaymentChanged(method),
              ),
          ],
        ),
        if (selectedPayment.isCash) ...[
          const SizedBox(height: 6),
          _CashKeypad(
            paidAmount: paidAmount,
            changeAmount: paidAmount - total,
            onDigit: onDigit,
            onAddAmount: onAddAmount,
            onExact: onExact,
            onBackspace: onBackspace,
            onClear: onClear,
          )
        ] else ...[
          const SizedBox(height: 6),
          _PaymentHint(
            paymentMethod: selectedPayment,
            total: total,
          )
        ],
      ],
    );
  }
}

class _DineInPaymentSheet extends StatefulWidget {
  const _DineInPaymentSheet({
    required this.paymentMethods,
    required this.initialPaymentCode,
    required this.initialPaidAmount,
    required this.orderNumber,
    required this.tableNumber,
    required this.customerName,
    required this.subtotal,
    required this.discountName,
    required this.discountAmount,
    required this.total,
  });

  final List<PaymentMethod> paymentMethods;
  final String initialPaymentCode;
  final int initialPaidAmount;
  final String? orderNumber;
  final String? tableNumber;
  final String? customerName;
  final int subtotal;
  final String? discountName;
  final int discountAmount;
  final int total;

  @override
  State<_DineInPaymentSheet> createState() => _DineInPaymentSheetState();
}

class _DineInPaymentSheetState extends State<_DineInPaymentSheet> {
  late String paymentMethodCode;
  late int paidAmount;
  bool splitPayment = false;
  String? secondPaymentMethodCode;
  int secondPaidAmount = 0;

  List<PaymentMethod> get methods => widget.paymentMethods.isEmpty
      ? PaymentMethod.defaults
      : widget.paymentMethods;

  PaymentMethod methodByCode(String code) {
    final normalized = code.toLowerCase();
    return methods.firstWhere(
      (method) => method.code == normalized,
      orElse: () => methods.firstWhere(
        (method) => method.code == 'cash',
        orElse: () => methods.first,
      ),
    );
  }

  PaymentMethod get selectedPayment => methodByCode(paymentMethodCode);

  List<TransactionPayment> get checkoutPayments {
    final primary = selectedPayment;
    if (widget.total <= 0) {
      return [TransactionPayment(method: primary.code, amount: 0)];
    }
    if (!splitPayment) {
      return [
        TransactionPayment(
          method: primary.code,
          amount: primary.isCash ? paidAmount : widget.total,
        )
      ];
    }
    final secondCode = secondPaymentMethodCode;
    return <TransactionPayment>[
      TransactionPayment(method: primary.code, amount: paidAmount),
      if (secondCode != null && secondCode != primary.code)
        TransactionPayment(method: secondCode, amount: secondPaidAmount),
    ].where((payment) => payment.amount > 0).take(2).toList();
  }

  String? get paymentError {
    final payments = checkoutPayments;
    if (payments.isEmpty) return 'Pilih minimal satu metode pembayaran.';
    final paid = payments.fold(0, (sum, payment) => sum + payment.amount);
    if (paid < widget.total) return 'Nominal bayar kurang dari total.';
    final hasCash = payments.any((payment) => payment.isCash);
    if (!hasCash && paid != widget.total) {
      return 'Pembayaran non-tunai harus pas sesuai total.';
    }
    return null;
  }

  @override
  void initState() {
    super.initState();
    final method = methodByCode(widget.initialPaymentCode);
    paymentMethodCode = method.code;
    paidAmount = method.isCash ? widget.initialPaidAmount : widget.total;
  }

  void addPaidDigit(String digit) {
    setState(() {
      paidAmount = int.parse('$paidAmount$digit');
    });
  }

  void backspacePaid() {
    final text = paidAmount.toString();
    setState(() {
      paidAmount =
          text.length <= 1 ? 0 : int.parse(text.substring(0, text.length - 1));
    });
  }

  void clearPaid() {
    setState(() => paidAmount = 0);
  }

  void addPaidAmount(int amount) {
    setState(() => paidAmount = addCashShortcut(paidAmount, amount));
    const ActivityLogService().record(
        module: 'payment',
        action: 'cash_shortcut',
        entityType: 'cash_shortcut',
        entityId: 'add_$amount',
        description: 'Menggunakan shortcut pecahan pembayaran dine in.',
        metadata: {'amount_added': amount, 'paid_amount': paidAmount});
  }

  void selectPayment(PaymentMethod method) {
    setState(() {
      paymentMethodCode = method.code;
      if (!method.isCash) paidAmount = widget.total;
    });
    const ActivityLogService().record(
        module: 'payment',
        action: 'method_select',
        entityType: 'payment_method',
        entityId: method.code,
        description: 'Memilih metode pembayaran ${method.name}.');
  }

  void enableSplitPayment() {
    if (methods.length < 2) return;
    final primary = selectedPayment;
    final fallback = methods.firstWhere(
      (method) => method.code != primary.code,
      orElse: () => methods.first,
    );
    setState(() {
      splitPayment = true;
      paidAmount = primary.isCash ? paidAmount : widget.total;
      secondPaymentMethodCode = fallback.code;
      secondPaidAmount =
          (widget.total - paidAmount).clamp(0, widget.total).toInt();
    });
  }

  void disableSplitPayment() {
    setState(() {
      splitPayment = false;
      secondPaymentMethodCode = null;
      secondPaidAmount = 0;
    });
  }

  void submitPayment() {
    final error = paymentError;
    if (error != null) return;
    final payments = checkoutPayments;
    final paid = payments.fold(0, (sum, payment) => sum + payment.amount);
    Navigator.of(context).pop(_PaymentCheckoutResult(
      paymentMethod: methodByCode(payments.first.method),
      paidAmount: paid,
      payments: payments,
    ));
  }

  @override
  Widget build(BuildContext context) {
    final method = selectedPayment;
    final canSubmit = paymentError == null;

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 16,
          right: 16,
          top: 16,
          bottom: MediaQuery.viewInsetsOf(context).bottom + 16,
        ),
        child: SingleChildScrollView(
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                const Expanded(
                  child: Text(
                    'Pembayaran Dine In',
                    style: TextStyle(
                      color: AppColors.darkText,
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close),
                )
              ]),
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.appBackground,
                  border: Border.all(color: AppColors.border),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (widget.orderNumber != null)
                      _PaymentSummaryLine(
                          label: 'Order', value: widget.orderNumber!),
                    _PaymentSummaryLine(
                        label: 'Meja', value: widget.tableNumber ?? '-'),
                    _PaymentSummaryLine(
                        label: 'Customer',
                        value: widget.customerName?.isNotEmpty == true
                            ? widget.customerName!
                            : 'Umum'),
                    const Divider(height: 18),
                    _PaymentSummaryLine(
                        label: 'Subtotal',
                        value: formatCurrency(widget.subtotal)),
                    if (widget.discountAmount > 0)
                      _PaymentSummaryLine(
                          label: 'Discount ${widget.discountName ?? ''}'.trim(),
                          value: '-${formatCurrency(widget.discountAmount)}'),
                    _PaymentSummaryLine(
                        label: 'Total',
                        value: formatCurrency(widget.total),
                        emphasize: true),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              if (splitPayment && secondPaymentMethodCode != null)
                _SplitPaymentSection(
                  paymentMethods: methods,
                  total: widget.total,
                  firstMethodCode: paymentMethodCode,
                  firstAmount: paidAmount,
                  secondMethodCode: secondPaymentMethodCode!,
                  secondAmount: secondPaidAmount,
                  onFirstMethodChanged: (nextMethod) => setState(() {
                    paymentMethodCode = nextMethod.code;
                    if (secondPaymentMethodCode == nextMethod.code) {
                      secondPaymentMethodCode = methods
                          .firstWhere((item) => item.code != nextMethod.code,
                              orElse: () => nextMethod)
                          .code;
                    }
                  }),
                  onFirstAmountChanged: (amount) =>
                      setState(() => paidAmount = amount),
                  onSecondMethodChanged: (nextMethod) => setState(() {
                    secondPaymentMethodCode = nextMethod.code;
                    if (paymentMethodCode == nextMethod.code) {
                      paymentMethodCode = methods
                          .firstWhere((item) => item.code != nextMethod.code,
                              orElse: () => nextMethod)
                          .code;
                    }
                  }),
                  onSecondAmountChanged: (amount) =>
                      setState(() => secondPaidAmount = amount),
                  onRemoveSecond: disableSplitPayment,
                )
              else ...[
                _PaymentSection(
                  paymentMethods: methods,
                  selectedPayment: method,
                  total: widget.total,
                  paidAmount: paidAmount,
                  onPaymentChanged: selectPayment,
                  onDigit: addPaidDigit,
                  onAddAmount: addPaidAmount,
                  onExact: () {
                    setState(
                        () => paidAmount = exactCashShortcut(widget.total));
                    const ActivityLogService().record(
                        module: 'payment',
                        action: 'cash_shortcut',
                        entityType: 'cash_shortcut',
                        entityId: 'exact',
                        description: 'Menggunakan shortcut Uang Pas dine in.',
                        metadata: {'paid_amount': paidAmount});
                  },
                  onBackspace: backspacePaid,
                  onClear: clearPaid,
                ),
                if (methods.length > 1) ...[
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: enableSplitPayment,
                      icon: const Icon(Icons.call_split),
                      label: const Text('Tambah metode pembayaran'),
                    ),
                  ),
                ],
              ],
              const SizedBox(height: 12),
              Row(children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('Batal'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: canSubmit ? submitPayment : null,
                    icon: const Icon(Icons.payments),
                    label: Text(splitPayment
                        ? 'Bayar Split'
                        : method.isCash
                            ? 'Bayar'
                            : 'Tandai Lunas'),
                  ),
                ),
              ]),
            ],
          ),
        ),
      ),
    );
  }
}

class _PaymentSummaryLine extends StatelessWidget {
  const _PaymentSummaryLine({
    required this.label,
    required this.value,
    this.emphasize = false,
  });

  final String label;
  final String value;
  final bool emphasize;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(children: [
        Expanded(
          child: Text(
            label,
            style: TextStyle(
              color: emphasize ? AppColors.darkText : AppColors.mutedBlue,
              fontSize: 12,
              fontWeight: emphasize ? FontWeight.w800 : FontWeight.w600,
            ),
          ),
        ),
        Text(
          value,
          textAlign: TextAlign.right,
          style: TextStyle(
            color: AppColors.darkText,
            fontSize: emphasize ? 14 : 12,
            fontWeight: emphasize ? FontWeight.w800 : FontWeight.w700,
          ),
        ),
      ]),
    );
  }
}

class _ManualDiscountInput extends StatefulWidget {
  const _ManualDiscountInput({
    required this.type,
    required this.value,
    required this.subtotal,
    required this.discountAmount,
    required this.onChanged,
    required this.onClear,
  });

  final String? type;
  final int value;
  final int subtotal;
  final int discountAmount;
  final void Function(String? type, int value) onChanged;
  final VoidCallback onClear;

  @override
  State<_ManualDiscountInput> createState() => _ManualDiscountInputState();
}

class _ManualDiscountInputState extends State<_ManualDiscountInput> {
  late final TextEditingController controller;
  late final FocusNode focusNode;

  @override
  void initState() {
    super.initState();
    controller = TextEditingController(
        text: widget.value > 0 ? widget.value.toString() : '');
    focusNode = FocusNode();
  }

  @override
  void didUpdateWidget(covariant _ManualDiscountInput oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!focusNode.hasFocus && oldWidget.value != widget.value) {
      controller.text = widget.value > 0 ? widget.value.toString() : '';
    }
    if (oldWidget.type != widget.type && widget.type == null) {
      controller.clear();
    }
  }

  @override
  void dispose() {
    controller.dispose();
    focusNode.dispose();
    super.dispose();
  }

  void _changeType(String? value) {
    if (value == null || value == 'none') {
      controller.clear();
      widget.onClear();
      return;
    }
    final currentValue = int.tryParse(controller.text.replaceAll('.', '')) ?? 0;
    widget.onChanged(value, currentValue);
  }

  @override
  Widget build(BuildContext context) {
    final type = widget.type ?? 'none';
    final isPercent = widget.type == 'percent';
    final isNominal = widget.type == 'nominal';
    final helper = widget.discountAmount > 0
        ? 'Potongan ${formatCurrency(widget.discountAmount)}'
        : widget.type == null
            ? 'Opsional, diisi langsung saat transaksi.'
            : isPercent
                ? 'Masukkan persen 1-100.'
                : 'Masukkan nominal rupiah.';

    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Expanded(
          child: DropdownButtonFormField<String>(
            value: type,
            decoration: const InputDecoration(
              labelText: 'Diskon Manual',
              border: OutlineInputBorder(),
              isDense: true,
            ),
            items: const [
              DropdownMenuItem(value: 'none', child: Text('Tanpa Diskon')),
              DropdownMenuItem(value: 'percent', child: Text('Persen')),
              DropdownMenuItem(value: 'nominal', child: Text('Nominal/Rp')),
            ],
            onChanged: widget.subtotal <= 0 ? null : _changeType,
          ),
        ),
        if (widget.type != null) ...[
          const SizedBox(width: 8),
          Expanded(
            child: TextField(
              controller: controller,
              focusNode: focusNode,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                labelText: isPercent ? 'Nilai %' : 'Nominal',
                prefixText: isNominal ? 'Rp ' : null,
                suffixText: isPercent ? '%' : null,
                border: const OutlineInputBorder(),
                isDense: true,
              ),
              onChanged: (value) {
                final parsed = int.tryParse(value.replaceAll('.', '')) ?? 0;
                widget.onChanged(widget.type, parsed);
              },
            ),
          ),
        ],
      ]),
      const SizedBox(height: 4),
      Text(
        helper,
        style: const TextStyle(color: AppColors.mutedBlue, fontSize: 11),
      ),
    ]);
  }
}

class _PaymentHint extends StatelessWidget {
  const _PaymentHint({required this.paymentMethod, required this.total});

  final PaymentMethod paymentMethod;
  final int total;

  @override
  Widget build(BuildContext context) {
    final label = paymentMethod.name;
    final icon = _paymentIcon(paymentMethod.code);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.appBackground,
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(children: [
        Container(
          width: 34,
          height: 34,
          decoration: BoxDecoration(
            color: AppColors.primaryTeal.withOpacity(0.12),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(icon, size: 18, color: AppColors.primaryTeal),
        ),
        const SizedBox(width: 10),
        Expanded(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(
              '$label siap dikonfirmasi',
              style: const TextStyle(
                color: AppColors.darkText,
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              'Total ${formatCurrency(total)} akan ditandai lunas setelah dikonfirmasi.',
              style: const TextStyle(
                color: AppColors.mutedBlue,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ]),
        ),
      ]),
    );
  }
}

class _CustomerSelector extends StatelessWidget {
  const _CustomerSelector({
    required this.outlet,
    required this.customer,
    required this.canModify,
    required this.canCreate,
    required this.onSelect,
    required this.onClear,
  });

  final Outlet outlet;
  final Customer? customer;
  final bool canModify;
  final bool canCreate;
  final ValueChanged<Customer> onSelect;
  final VoidCallback onClear;

  Future<void> _pickCustomer(BuildContext context) async {
    final picked = await showDialog<Customer>(
      context: context,
      builder: (_) => _CustomerPickerDialog(outlet: outlet),
    );
    if (picked != null) onSelect(picked);
  }

  Future<void> _addCustomer(BuildContext context) async {
    final created = await showDialog<Customer>(
      context: context,
      builder: (_) => _AddCustomerDialog(outlet: outlet),
    );
    if (created != null) onSelect(created);
  }

  @override
  Widget build(BuildContext context) {
    final selected = customer;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.appBackground,
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Text(
            'Customer',
            style: TextStyle(
              color: AppColors.darkText,
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
          const Spacer(),
          TextButton(
            onPressed: canModify ? () => _pickCustomer(context) : null,
            child: Text(selected == null ? 'Pilih' : 'Ganti'),
          ),
          const SizedBox(width: 4),
          OutlinedButton(
            onPressed:
                canModify && canCreate ? () => _addCustomer(context) : null,
            child: const Text('Tambah'),
          ),
        ]),
        const SizedBox(height: 6),
        if (selected == null)
          const Text(
            'Opsional. Pilih customer agar point loyalty bertambah saat bayar.',
            style: TextStyle(
              color: AppColors.mutedBlue,
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          )
        else
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border.all(color: AppColors.border),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: AppColors.primaryTeal.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(Icons.person,
                    color: AppColors.primaryTeal, size: 18),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        selected.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.darkText,
                          fontSize: 12,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        selected.phone.trim().isEmpty
                            ? '${selected.points} point'
                            : '${selected.phone} · ${selected.points} point',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.mutedBlue,
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ]),
              ),
              IconButton(
                tooltip: 'Hapus customer dari cart',
                onPressed: onClear,
                icon: const Icon(Icons.close, size: 18),
              )
            ]),
          ),
      ]),
    );
  }
}

class _CustomerPickerDialog extends StatefulWidget {
  const _CustomerPickerDialog({required this.outlet});

  final Outlet outlet;

  @override
  State<_CustomerPickerDialog> createState() => _CustomerPickerDialogState();
}

class _CustomerPickerDialogState extends State<_CustomerPickerDialog> {
  String keyword = '';
  String? _lastFetchKey;

  void _fetchIfNeeded() {
    final key = '${widget.outlet.id}-$keyword';
    if (_lastFetchKey == key) return;
    _lastFetchKey = key;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      context
          .read<CatalogProvider>()
          .fetchCustomers(widget.outlet.id, keyword: keyword);
    });
  }

  @override
  Widget build(BuildContext context) {
    _fetchIfNeeded();
    final catalog = context.watch<CatalogProvider>();
    final customers =
        catalog.customersForOutlet(widget.outlet.id, keyword: keyword);
    final keyboardBottom = MediaQuery.viewInsetsOf(context).bottom;
    final availableHeight =
        MediaQuery.sizeOf(context).height - keyboardBottom - 180;
    final dialogHeight = availableHeight < 190
        ? 190.0
        : availableHeight > 420
            ? 420.0
            : availableHeight;
    return AlertDialog(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.white,
      title: const Text(
        'Pilih Customer',
        style:
            TextStyle(color: AppColors.darkText, fontWeight: FontWeight.w800),
      ),
      content: SizedBox(
        width: 380,
        height: dialogHeight,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          TextField(
            style: const TextStyle(color: AppColors.darkText),
            scrollPadding: const EdgeInsets.only(bottom: 220),
            onChanged: (value) => setState(() {
              keyword = value;
              _lastFetchKey = null;
            }),
            decoration: const InputDecoration(
              prefixIcon: Icon(Icons.search),
              hintText: 'Cari nama atau nomor HP',
            ),
          ),
          const SizedBox(height: 10),
          Expanded(
            child: catalog.refreshingCustomers && customers.isEmpty
                ? const Center(child: CircularProgressIndicator())
                : customers.isEmpty
                    ? const Center(
                        child: Text(
                          'Customer tidak ditemukan.',
                          style: TextStyle(color: AppColors.darkText),
                        ),
                      )
                    : ListView.separated(
                        itemCount: customers.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (context, index) {
                          final customer = customers[index];
                          return ListTile(
                            contentPadding: EdgeInsets.zero,
                            title: Text(
                              customer.name,
                              style: const TextStyle(
                                color: AppColors.darkText,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            subtitle: Text(
                              customer.phone.trim().isEmpty
                                  ? '${customer.points} point'
                                  : '${customer.phone} · ${customer.points} point',
                              style:
                                  const TextStyle(color: AppColors.mutedBlue),
                            ),
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () => Navigator.of(context).pop(customer),
                          );
                        },
                      ),
          ),
        ]),
      ),
      actions: [
        OutlinedButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Tutup'),
        ),
      ],
    );
  }
}

class _AddCustomerDialog extends StatefulWidget {
  const _AddCustomerDialog({required this.outlet});

  final Outlet outlet;

  @override
  State<_AddCustomerDialog> createState() => _AddCustomerDialogState();
}

class _AddCustomerDialogState extends State<_AddCustomerDialog> {
  final nameController = TextEditingController();
  final phoneController = TextEditingController();
  String? error;
  bool saving = false;

  @override
  void dispose() {
    nameController.dispose();
    phoneController.dispose();
    super.dispose();
  }

  Future<void> save() async {
    final name = nameController.text.trim();
    final phone = phoneController.text.trim();
    if (name.isEmpty) {
      setState(() => error = 'Nama customer wajib diisi.');
      return;
    }
    setState(() {
      saving = true;
      error = null;
    });
    try {
      final customer = await context
          .read<CatalogProvider>()
          .addCustomer(outlet: widget.outlet, name: name, phone: phone);
      if (!mounted) return;
      Navigator.of(context).pop(customer);
    } catch (err) {
      if (!mounted) return;
      setState(() {
        error = err.toString().replaceFirst('Exception: ', '');
        saving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.white,
      title: const Text(
        'Tambah Customer',
        style:
            TextStyle(color: AppColors.darkText, fontWeight: FontWeight.w800),
      ),
      content: SizedBox(
        width: 360,
        child: SingleChildScrollView(
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(
              controller: nameController,
              scrollPadding: const EdgeInsets.only(bottom: 220),
              style: const TextStyle(color: AppColors.darkText),
              decoration: const InputDecoration(
                labelText: 'Nama customer',
                prefixIcon: Icon(Icons.person_outline),
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: phoneController,
              scrollPadding: const EdgeInsets.only(bottom: 220),
              keyboardType: TextInputType.phone,
              style: const TextStyle(color: AppColors.darkText),
              decoration: const InputDecoration(
                labelText: 'Nomor HP (opsional)',
                prefixIcon: Icon(Icons.phone_outlined),
              ),
            ),
            if (error != null) ...[
              const SizedBox(height: 10),
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  error!,
                  style: const TextStyle(
                    color: AppColors.danger,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ]),
        ),
      ),
      actions: [
        OutlinedButton(
          onPressed: saving ? null : () => Navigator.of(context).pop(),
          child: const Text('Batal'),
        ),
        ElevatedButton(
          onPressed: saving ? null : save,
          child: Text(saving ? 'Menyimpan...' : 'Simpan'),
        ),
      ],
    );
  }
}

String _openBillTargetLabel(OpenBill bill) {
  if (bill.serviceType == 'dine_in') {
    final number = bill.tableNumber?.trim();
    return number == null || number.isEmpty ? 'Dine In' : 'Meja $number';
  }
  return 'Takeaway';
}

int _compareOpenBills(OpenBill left, OpenBill right) {
  if (left.serviceType == 'dine_in' && right.serviceType == 'dine_in') {
    return compareTableNumbers(left.tableNumber ?? '', right.tableNumber ?? '');
  }
  if (left.serviceType == 'dine_in') return -1;
  if (right.serviceType == 'dine_in') return 1;
  final byTime = right.updatedAt.compareTo(left.updatedAt);
  if (byTime != 0) return byTime;
  return left.orderNumber.compareTo(right.orderNumber);
}

class _OpenBillBanner extends StatelessWidget {
  const _OpenBillBanner({required this.bill});

  final OpenBill bill;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.softLime.withOpacity(0.22),
        border: Border.all(color: AppColors.secondaryGreen.withOpacity(0.45)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(children: [
        const Icon(Icons.receipt_long, color: AppColors.primaryTeal, size: 18),
        const SizedBox(width: 8),
        Expanded(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(
              'Melanjutkan ${bill.orderNumber}',
              style: const TextStyle(
                color: AppColors.darkText,
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              '${_openBillTargetLabel(bill)} · ${bill.customerName ?? 'Tanpa customer'} · ${formatCurrency(bill.total)}',
              style: const TextStyle(
                color: AppColors.mutedBlue,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
          ]),
        ),
      ]),
    );
  }
}

class _RunningOrdersSheet extends StatelessWidget {
  const _RunningOrdersSheet({required this.bills});

  final List<OpenBill> bills;

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 16,
          right: 16,
          top: 16,
          bottom: MediaQuery.viewInsetsOf(context).bottom + 16,
        ),
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(context).height * 0.82,
          ),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Order Berjalan',
                          style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 3),
                      Text(
                        '${bills.length} order sedang aktif',
                        style: const TextStyle(
                          color: AppColors.mutedBlue,
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ]),
              ),
              IconButton(
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.close),
              )
            ]),
            const SizedBox(height: 12),
            Expanded(
              child: ListView.separated(
                itemCount: bills.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (context, index) {
                  final bill = bills[index];
                  return _RunningOrderTile(
                    bill: bill,
                    now: now,
                    onTap: () => Navigator.pop(context, bill),
                  );
                },
              ),
            ),
          ]),
        ),
      ),
    );
  }
}

class _RunningOrderTile extends StatelessWidget {
  const _RunningOrderTile({
    required this.bill,
    required this.now,
    required this.onTap,
  });

  final OpenBill bill;
  final DateTime now;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: AppColors.border),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(children: [
          Container(
            width: 54,
            height: 54,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.primaryTeal.withOpacity(0.12),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              bill.serviceType == 'dine_in' ? (bill.tableNumber ?? '-') : 'TA',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.primaryTeal,
                fontSize: 18,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(
                bill.orderNumber,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.darkText,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                '${bill.customerName ?? 'Tanpa customer'} · ${bill.items.length} item · ${_formatSeatDuration(now, bill.createdAt)}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.mutedBlue,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ]),
          ),
          const SizedBox(width: 10),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text(
              formatCurrency(bill.total),
              style: const TextStyle(
                color: AppColors.darkText,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 4),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: (bill.synced ? AppColors.secondaryGreen : Colors.orange)
                    .withOpacity(0.12),
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(
                bill.synced ? 'Synced' : 'Pending sync',
                style: TextStyle(
                  color: bill.synced ? AppColors.secondaryGreen : Colors.orange,
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ]),
        ]),
      ),
    );
  }
}

class _BillSummaryLine extends StatelessWidget {
  const _BillSummaryLine({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(children: [
        Text(label,
            style: const TextStyle(
                color: AppColors.mutedBlue,
                fontSize: 12,
                fontWeight: FontWeight.w700)),
        const Spacer(),
        Text(value,
            style: const TextStyle(
                color: AppColors.darkText,
                fontSize: 12,
                fontWeight: FontWeight.w800)),
      ]),
    );
  }
}

class _TableSelector extends StatelessWidget {
  const _TableSelector({
    required this.tables,
    required this.value,
    required this.outletId,
    required this.openBills,
    required this.currentOpenBillId,
    required this.onChanged,
  });

  final List<DiningTable> tables;
  final String? value;
  final String outletId;
  final OpenBillProvider openBills;
  final String? currentOpenBillId;
  final ValueChanged<String> onChanged;

  Future<void> _openPicker(BuildContext context) async {
    final selected = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => _TablePickerScreen(
          tables: tables,
          value: value,
          outletId: outletId,
          openBills: openBills,
          currentOpenBillId: currentOpenBillId,
        ),
      ),
    );
    if (selected != null) onChanged(selected);
  }

  @override
  Widget build(BuildContext context) {
    final selectedLabel = value == null ? 'Belum dipilih' : 'Meja $value';
    final selectedBill =
        value == null ? null : openBills.findByTable(outletId, value!);
    final occupiedCount = tables
        .where((table) => openBills.findByTable(outletId, table.number) != null)
        .length;
    final selectedDetail = selectedBill == null
        ? '${tables.length} meja · $occupiedCount terisi'
        : '${selectedBill.orderNumber} · ${formatCurrency(selectedBill.total)}';

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.appBackground,
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text(
                'Meja',
                style: TextStyle(
                  color: AppColors.darkText,
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                selectedDetail,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.mutedBlue,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ]),
          ),
          OutlinedButton.icon(
            onPressed: tables.isEmpty ? null : () => _openPicker(context),
            icon: const Icon(Icons.table_restaurant_outlined, size: 18),
            label: Text(value == null ? 'Pilih Meja' : 'Ganti'),
          )
        ]),
        const SizedBox(height: 8),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
          decoration: BoxDecoration(
            color: Colors.white,
            border: Border.all(
              color: selectedBill != null
                  ? AppColors.primaryTeal.withOpacity(0.5)
                  : AppColors.border,
            ),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(children: [
            Icon(
              selectedBill != null
                  ? Icons.receipt_long_outlined
                  : Icons.event_seat_outlined,
              size: 18,
              color:
                  value == null ? AppColors.mutedBlue : AppColors.primaryTeal,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                selectedLabel,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color:
                      value == null ? AppColors.mutedBlue : AppColors.darkText,
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            if (selectedBill != null)
              Text(
                _formatSeatDuration(DateTime.now(), selectedBill.createdAt),
                style: const TextStyle(
                  color: AppColors.primaryTeal,
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                ),
              ),
          ]),
        ),
      ]),
    );
  }
}

class _TablePickerScreen extends StatefulWidget {
  const _TablePickerScreen({
    required this.tables,
    required this.value,
    required this.outletId,
    required this.openBills,
    required this.currentOpenBillId,
  });

  final List<DiningTable> tables;
  final String? value;
  final String outletId;
  final OpenBillProvider openBills;
  final String? currentOpenBillId;

  @override
  State<_TablePickerScreen> createState() => _TablePickerScreenState();
}

class _TablePickerScreenState extends State<_TablePickerScreen> {
  String keyword = '';
  Timer? timer;

  @override
  void initState() {
    super.initState();
    timer = Timer.periodic(const Duration(minutes: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final filtered = widget.tables
        .where((table) =>
            table.number.toLowerCase().contains(keyword.trim().toLowerCase()))
        .toList();
    final occupiedCount = widget.tables
        .where((table) =>
            widget.openBills.findByTable(widget.outletId, table.number) != null)
        .length;
    final emptyCount = widget.tables.length - occupiedCount;

    return Scaffold(
      backgroundColor: AppColors.appBackground,
      appBar: AppBar(
        title: const Text('Pilih Meja'),
        backgroundColor: Colors.white,
        foregroundColor: AppColors.darkText,
        elevation: 0,
        surfaceTintColor: Colors.white,
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              _TablePickerSummaryCard(
                label: 'Total Meja',
                value: '${widget.tables.length}',
                color: AppColors.mutedBlue,
              ),
              const SizedBox(width: 10),
              _TablePickerSummaryCard(
                label: 'Kosong',
                value: '$emptyCount',
                color: AppColors.primaryTeal,
              ),
              const SizedBox(width: 10),
              _TablePickerSummaryCard(
                label: 'Terisi',
                value: '$occupiedCount',
                color: AppColors.danger,
              ),
            ]),
            const SizedBox(height: 12),
            TextField(
              onChanged: (value) => setState(() => keyword = value),
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                hintText: 'Cari nomor meja',
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            Expanded(
              child: filtered.isEmpty
                  ? const Center(
                      child: Text(
                        'Meja tidak ditemukan.',
                        style: TextStyle(
                          color: AppColors.darkText,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    )
                  : LayoutBuilder(builder: (context, constraints) {
                      final columns =
                          (constraints.maxWidth / 210).floor().clamp(2, 6);
                      return GridView.builder(
                        itemCount: filtered.length,
                        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: columns,
                          mainAxisExtent: 168,
                          crossAxisSpacing: 12,
                          mainAxisSpacing: 12,
                        ),
                        itemBuilder: (context, index) {
                          final table = filtered[index];
                          final bill = widget.openBills
                              .findByTable(widget.outletId, table.number);
                          final selected = table.number == widget.value;
                          final current = bill != null &&
                              bill.id == widget.currentOpenBillId;
                          return _TablePickerCard(
                            table: table,
                            bill: bill,
                            selected: selected,
                            current: current,
                            now: now,
                            onTap: () =>
                                Navigator.of(context).pop(table.number),
                          );
                        },
                      );
                    }),
            ),
          ]),
        ),
      ),
    );
  }
}

class _TablePickerSummaryCard extends StatelessWidget {
  const _TablePickerSummaryCard({
    required this.label,
    required this.value,
    required this.color,
  });

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: AppColors.border),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
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
            style: TextStyle(
              color: color,
              fontSize: 20,
              fontWeight: FontWeight.w900,
            ),
          ),
        ]),
      ),
    );
  }
}

class _TablePickerCard extends StatelessWidget {
  const _TablePickerCard({
    required this.table,
    required this.bill,
    required this.selected,
    required this.current,
    required this.now,
    required this.onTap,
  });

  final DiningTable table;
  final OpenBill? bill;
  final bool selected;
  final bool current;
  final DateTime now;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final occupied = bill != null;
    final background = current
        ? AppColors.primaryTeal.withOpacity(0.14)
        : occupied
            ? AppColors.danger.withOpacity(0.1)
            : Colors.white;
    final borderColor = current
        ? AppColors.primaryTeal
        : occupied
            ? AppColors.danger.withOpacity(0.6)
            : selected
                ? AppColors.primaryTeal
                : AppColors.border;
    final statusColor = current
        ? AppColors.primaryTeal
        : occupied
            ? AppColors.danger
            : AppColors.secondaryGreen;
    final statusText = current
        ? 'Order Aktif'
        : occupied
            ? 'Terisi'
            : 'Kosong';

    return InkWell(
      borderRadius: BorderRadius.circular(10),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: background,
          border: Border.all(color: borderColor, width: current ? 1.6 : 1),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(
              child: Text(
                'Meja ${table.number}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.darkText,
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            if (selected)
              const Icon(Icons.check_circle,
                  color: AppColors.primaryTeal, size: 20),
          ]),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: statusColor.withOpacity(0.12),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              statusText,
              style: TextStyle(
                color: statusColor,
                fontSize: 11,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          const SizedBox(height: 10),
          if (bill == null)
            const Text(
              'Siap dipakai',
              style: TextStyle(
                color: AppColors.mutedBlue,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            )
          else ...[
            Text(
              formatCurrency(bill!.total),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.darkText,
                fontSize: 16,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              '${bill!.customerName ?? 'Tanpa customer'} · ${_formatSeatDuration(now, bill!.createdAt)}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.mutedBlue,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              bill!.orderNumber,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.mutedBlue,
                fontSize: 10,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ]),
      ),
    );
  }
}

String _formatSeatDuration(DateTime now, DateTime startedAt) {
  final minutes = now.difference(startedAt).inMinutes;
  if (minutes <= 0) return 'Baru';
  if (minutes < 60) return '${minutes}m';
  final hours = minutes ~/ 60;
  final restMinutes = minutes % 60;
  if (restMinutes == 0) return '${hours}j';
  return '${hours}j ${restMinutes}m';
}

class _PaymentMethodButton extends StatelessWidget {
  const _PaymentMethodButton(
      {required this.label,
      required this.icon,
      required this.active,
      required this.onTap});
  final String label;
  final IconData icon;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final foreground = active ? Colors.white : AppColors.darkText;
    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: onTap,
      child: Container(
        height: 44,
        decoration: BoxDecoration(
          color: active ? AppColors.primaryTeal : Colors.white,
          border: Border.all(
              color: active ? AppColors.primaryTeal : AppColors.border),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 16, color: foreground),
            const SizedBox(height: 2),
            Text(label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    color: foreground,
                    fontSize: 11,
                    fontWeight: FontWeight.w700)),
          ],
        ),
      ),
    );
  }
}

class _CashKeypad extends StatelessWidget {
  const _CashKeypad({
    required this.paidAmount,
    required this.changeAmount,
    required this.onDigit,
    required this.onAddAmount,
    required this.onExact,
    required this.onBackspace,
    required this.onClear,
  });

  final int paidAmount;
  final int changeAmount;
  final ValueChanged<String> onDigit;
  final ValueChanged<int> onAddAmount;
  final VoidCallback onExact;
  final VoidCallback onBackspace;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];
    return Column(children: [
      Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: AppColors.appBackground,
          border: Border.all(color: AppColors.border),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Nominal Bayar',
              style: TextStyle(
                  color: AppColors.mutedBlue,
                  fontSize: 11,
                  fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text(formatCurrency(paidAmount),
              style: const TextStyle(
                  color: AppColors.darkText,
                  fontSize: 16,
                  fontWeight: FontWeight.w800)),
          if (paidAmount > 0) ...[
            const SizedBox(height: 4),
            Text(
              changeAmount >= 0
                  ? 'Kembali ${formatCurrency(changeAmount)}'
                  : 'Kurang ${formatCurrency(changeAmount.abs())}',
              style: TextStyle(
                  color: changeAmount >= 0
                      ? AppColors.primaryTeal
                      : AppColors.danger,
                  fontSize: 11,
                  fontWeight: FontWeight.w700),
            ),
          ],
        ]),
      ),
      const SizedBox(height: 8),
      Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [
          ActionChip(label: const Text('Uang Pas'), onPressed: onExact),
          for (final amount in const [10000, 20000, 50000, 100000])
            ActionChip(
              label: Text('+Rp${amount ~/ 1000}rb'),
              onPressed: () => onAddAmount(amount),
            ),
          ActionChip(label: const Text('Reset'), onPressed: onClear),
        ],
      ),
      const SizedBox(height: 8),
      GridView.builder(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 3,
          mainAxisExtent: 32,
          crossAxisSpacing: 8,
          mainAxisSpacing: 6,
        ),
        itemCount: keys.length,
        itemBuilder: (context, index) {
          final value = keys[index];
          final isAction = value == 'C' || value == '⌫';
          return InkWell(
            borderRadius: BorderRadius.circular(8),
            onTap: () {
              if (value == 'C') {
                onClear();
              } else if (value == '⌫') {
                onBackspace();
              } else {
                onDigit(value);
              }
            },
            child: Container(
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: isAction ? AppColors.appBackground : Colors.white,
                border: Border.all(color: AppColors.border),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                value,
                style: TextStyle(
                  color: isAction ? AppColors.mutedBlue : AppColors.darkText,
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          );
        },
      ),
    ]);
  }
}

class _ServiceSelector extends StatelessWidget {
  const _ServiceSelector({required this.value, required this.onChanged});

  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 48,
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppColors.appBackground,
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(children: [
        Expanded(
          child: _ServiceOption(
            label: 'Dine In',
            icon: Icons.check,
            active: value == 'dine_in',
            onTap: () => onChanged('dine_in'),
          ),
        ),
        const SizedBox(width: 4),
        Expanded(
          child: _ServiceOption(
            label: 'Takeaway',
            icon: Icons.shopping_bag_outlined,
            active: value == 'takeaway',
            onTap: () => onChanged('takeaway'),
          ),
        ),
      ]),
    );
  }
}

class _ServiceOption extends StatelessWidget {
  const _ServiceOption({
    required this.label,
    required this.icon,
    required this.active,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final foreground = active ? Colors.white : AppColors.darkText;
    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: onTap,
      child: Container(
        height: double.infinity,
        decoration: BoxDecoration(
          color: active ? AppColors.primaryTeal : Colors.white,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
              color: active ? AppColors.primaryTeal : AppColors.border),
        ),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          Icon(icon, size: 16, color: foreground),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              color: foreground,
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
        ]),
      ),
    );
  }
}
