import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

class BackendLoadingOverlay extends StatelessWidget {
  const BackendLoadingOverlay({
    super.key,
    required this.loading,
    required this.child,
  });

  final bool loading;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Stack(children: [
      child,
      if (loading)
        Positioned.fill(
          child: IgnorePointer(
            child: Container(
              alignment: Alignment.topCenter,
              padding: const EdgeInsets.only(top: 8),
              color: Colors.white.withOpacity(0.45),
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: Colors.white,
                  border: Border.all(color: AppColors.border),
                  borderRadius: BorderRadius.circular(8),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.08),
                      blurRadius: 12,
                      offset: const Offset(0, 6),
                    ),
                  ],
                ),
                child: const Row(mainAxisSize: MainAxisSize.min, children: [
                  SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  SizedBox(width: 8),
                  Text(
                    'Memuat ulang...',
                    style: TextStyle(
                      color: AppColors.darkText,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ]),
              ),
            ),
          ),
        ),
    ]);
  }
}

class BackendSkeleton extends StatelessWidget {
  const BackendSkeleton({super.key, this.rows = 5});

  final int rows;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.all(12),
      itemCount: rows,
      separatorBuilder: (_, __) => const SizedBox(height: 10),
      itemBuilder: (_, index) => Container(
        height: index == 0 ? 64 : 48,
        decoration: BoxDecoration(
          color: AppColors.appBackground,
          border: Border.all(color: AppColors.border),
          borderRadius: BorderRadius.circular(8),
        ),
      ),
    );
  }
}
