import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../providers/catalog_provider.dart';
import '../providers/outlet_provider.dart';
import '../theme/app_colors.dart';
import '../services/activity_log_service.dart';
import '../utils/logout_flow.dart';
import 'home_shell.dart';

class OutletScreen extends StatelessWidget {
  const OutletScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final catalog = context.watch<CatalogProvider>();
    final outletProvider = context.watch<OutletProvider>();
    final outlets =
        outletProvider.outletsForUser(auth.user, outlets: catalog.outlets);
    return Scaffold(
      appBar: AppBar(title: const Text('Pilih Outlet'), actions: [
        TextButton(
            onPressed: () => performLogout(context),
            child: const Text('Logout'))
      ]),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Wrap(
            spacing: 12,
            runSpacing: 12,
            children: outlets
                .map((outlet) => SizedBox(
                    width: 320,
                    child: Card(
                        child: InkWell(
                            borderRadius: BorderRadius.circular(8),
                            onTap: () async {
                              context
                                  .read<OutletProvider>()
                                  .selectOutlet(outlet);
                              await const ActivityLogService().record(
                                outletId: outlet.id,
                                module: 'navigation',
                                action: 'outlet_switch',
                                entityType: 'outlet',
                                entityId: outlet.id,
                                description: 'Memilih outlet ${outlet.name}.',
                              );
                              if (!context.mounted) return;
                              Navigator.of(context).pushReplacement(
                                  MaterialPageRoute(
                                      builder: (_) => const HomeShell()));
                            },
                            child: Padding(
                                padding: const EdgeInsets.all(16),
                                child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      const Icon(Icons.storefront,
                                          color: AppColors.primaryTeal),
                                      const SizedBox(height: 12),
                                      Text(outlet.name,
                                          style: Theme.of(context)
                                              .textTheme
                                              .titleMedium),
                                      const SizedBox(height: 4),
                                      Text(outlet.address,
                                          style: const TextStyle(
                                              color: AppColors.darkText)),
                                      const SizedBox(height: 8),
                                      Text(outlet.phone,
                                          style: const TextStyle(
                                              color: AppColors.mutedBlue))
                                    ]))))))
                .toList()),
      ),
    );
  }
}
