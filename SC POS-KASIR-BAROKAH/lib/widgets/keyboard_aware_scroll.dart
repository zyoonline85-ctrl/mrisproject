import 'package:flutter/material.dart';

class KeyboardAwareScroll extends StatelessWidget {
  const KeyboardAwareScroll({
    super.key,
    required this.child,
    this.padding = EdgeInsets.zero,
    this.centerContent = false,
    this.minHeight,
  });

  final Widget child;
  final EdgeInsets padding;
  final bool centerContent;
  final double? minHeight;

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;

    return LayoutBuilder(builder: (context, constraints) {
      final effectiveMinHeight = minHeight ?? constraints.maxHeight;
      final content = ConstrainedBox(
        constraints: BoxConstraints(minHeight: effectiveMinHeight),
        child: centerContent ? Center(child: child) : child,
      );

      return SingleChildScrollView(
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: padding.copyWith(bottom: padding.bottom + bottomInset),
        child: content,
      );
    });
  }
}
