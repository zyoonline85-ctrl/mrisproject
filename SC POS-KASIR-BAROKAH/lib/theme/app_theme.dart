import 'package:flutter/material.dart';
import 'app_colors.dart';

class AppTheme {
  static ThemeData light() {
    final colorScheme = ColorScheme.fromSeed(
      seedColor: AppColors.primaryTeal,
      primary: AppColors.primaryTeal,
      secondary: AppColors.secondaryGreen,
      surface: AppColors.card,
      error: AppColors.danger,
    ).copyWith(
      onPrimary: Colors.white,
      onSecondary: Colors.white,
      onSurface: AppColors.darkText,
      onError: Colors.white,
    );
    final base = ThemeData(useMaterial3: true, colorScheme: colorScheme);
    final textTheme = base.textTheme
        .apply(
          fontFamily: 'Inter',
          bodyColor: AppColors.darkText,
          displayColor: AppColors.darkText,
        )
        .copyWith(
          bodySmall: const TextStyle(color: AppColors.darkText, fontSize: 12),
          bodyMedium: const TextStyle(color: AppColors.darkText, fontSize: 13),
          titleSmall: const TextStyle(
              color: AppColors.darkText,
              fontSize: 14,
              fontWeight: FontWeight.w600),
          titleMedium: const TextStyle(
              color: AppColors.darkText,
              fontSize: 16,
              fontWeight: FontWeight.w700),
          titleLarge: const TextStyle(
              color: AppColors.darkText,
              fontSize: 20,
              fontWeight: FontWeight.w700),
          labelLarge: const TextStyle(
              color: AppColors.darkText,
              fontSize: 12,
              fontWeight: FontWeight.w700),
        );

    return base.copyWith(
      colorScheme: colorScheme,
      scaffoldBackgroundColor: AppColors.appBackground,
      textTheme: textTheme,
      primaryTextTheme: textTheme,
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.card,
        foregroundColor: AppColors.darkText,
        surfaceTintColor: AppColors.card,
        titleTextStyle: TextStyle(
          color: AppColors.darkText,
          fontSize: 18,
          fontWeight: FontWeight.w800,
        ),
      ),
      cardTheme: CardTheme(
        color: AppColors.card,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: const BorderSide(color: AppColors.border),
        ),
      ),
      dialogTheme: DialogTheme(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
      listTileTheme: const ListTileThemeData(
        textColor: AppColors.darkText,
        iconColor: AppColors.darkText,
        titleTextStyle: TextStyle(
          color: AppColors.darkText,
          fontSize: 13,
          fontWeight: FontWeight.w700,
        ),
        subtitleTextStyle: TextStyle(
          color: AppColors.mutedBlue,
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        isDense: true,
        filled: true,
        fillColor: AppColors.card,
        labelStyle: const TextStyle(color: AppColors.darkText),
        hintStyle: const TextStyle(color: AppColors.mutedBlue),
        prefixIconColor: AppColors.darkText,
        suffixIconColor: AppColors.darkText,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: AppColors.border),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          minimumSize: const Size(88, 40),
          backgroundColor: AppColors.primaryTeal,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.primaryTeal,
          textStyle: const TextStyle(fontWeight: FontWeight.w800),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(88, 40),
          foregroundColor: AppColors.darkText,
          side: const BorderSide(color: AppColors.border),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
      ),
      snackBarTheme: const SnackBarThemeData(
        backgroundColor: AppColors.darkText,
        contentTextStyle: TextStyle(
          color: Colors.white,
          fontSize: 12,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}
