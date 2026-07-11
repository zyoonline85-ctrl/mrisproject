import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:provider/provider.dart';
import 'providers/auth_provider.dart';
import 'providers/cart_provider.dart';
import 'providers/catalog_provider.dart';
import 'providers/expense_provider.dart';
import 'providers/favorite_product_provider.dart';
import 'providers/open_bill_provider.dart';
import 'providers/outlet_provider.dart';
import 'providers/pos_report_provider.dart';
import 'providers/purchase_provider.dart';
import 'providers/sync_provider.dart';
import 'providers/stock_opname_provider.dart';
import 'providers/transaction_provider.dart';
import 'providers/transfer_provider.dart';
import 'screens/login_screen.dart';
import 'theme/app_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ]);
  await initializeDateFormatting('id_ID', null);
  runApp(const BarokahPosApp());
}

class BarokahPosApp extends StatelessWidget {
  const BarokahPosApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()..restoreSession()),
        ChangeNotifierProvider(create: (_) => OutletProvider()),
        ChangeNotifierProvider(create: (_) => CatalogProvider()),
        ChangeNotifierProvider(create: (_) => FavoriteProductProvider()),
        ChangeNotifierProvider(create: (_) => CartProvider()),
        ChangeNotifierProvider(create: (_) => TransactionProvider()..load()),
        ChangeNotifierProvider(create: (_) => ExpenseProvider()..load()),
        ChangeNotifierProvider(create: (_) => PurchaseProvider()..load()),
        ChangeNotifierProvider(create: (_) => TransferProvider()..load()),
        ChangeNotifierProvider(create: (_) => StockOpnameProvider()),
        ChangeNotifierProvider(create: (_) => OpenBillProvider()..load()),
        ChangeNotifierProvider(create: (_) => PosReportProvider()),
        ChangeNotifierProvider(create: (_) => SyncProvider()),
      ],
      child: MaterialApp(
          debugShowCheckedModeBanner: false,
          title: 'MRIS Barokah Grup',
          theme: AppTheme.light(),
          home: const LoginScreen()),
    );
  }
}
