import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../providers/outlet_provider.dart';
import '../services/activity_log_service.dart';
import '../screens/login_screen.dart';

Future<void> performLogout(BuildContext context) async {
  final navigator = Navigator.of(context);
  final cart = context.read<CartProvider>();
  final outlet = context.read<OutletProvider>();
  final auth = context.read<AuthProvider>();

  if (auth.user != null) {
    await const ActivityLogService().record(
      outletId: outlet.selectedOutlet?.id ??
          (auth.user!.outletIds.isNotEmpty ? auth.user!.outletIds.first : ''),
      module: 'auth',
      action: 'logout',
      entityType: 'user',
      entityId: auth.user!.id,
      description: '${auth.user!.name} logout dari APK Kasir.',
    );
  }

  cart.clear();
  outlet.clear();
  await auth.logout();

  if (!navigator.mounted) return;
  navigator.pushAndRemoveUntil(
    MaterialPageRoute(builder: (_) => const LoginScreen()),
    (_) => false,
  );
}
