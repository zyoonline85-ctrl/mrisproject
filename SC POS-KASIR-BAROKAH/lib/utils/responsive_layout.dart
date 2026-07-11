import 'package:flutter/widgets.dart';

class ResponsiveLayout {
  const ResponsiveLayout._();

  static bool isLandscapeTablet(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    return size.width >= 1024 && size.width > size.height;
  }

  static bool isCompactLandscapeTablet(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    return isLandscapeTablet(context) && size.width < 1280;
  }

  static double pagePadding(BuildContext context) =>
      isLandscapeTablet(context) ? 6 : 12;

  static double panelGap(BuildContext context) =>
      isLandscapeTablet(context) ? 6 : 12;

  static double sideNavWidth(BuildContext context) =>
      isLandscapeTablet(context) ? 72 : 88;

  static double sideNavItemHeight(BuildContext context) =>
      isLandscapeTablet(context) ? 52 : 58;

  static double formPanelWidth(
    BuildContext context, {
    double compact = 560,
    double normal = 620,
    double max = 620,
  }) {
    if (!isLandscapeTablet(context)) return max;
    final size = MediaQuery.sizeOf(context);
    if (size.width < 1200) return compact;
    return normal;
  }
}
