class AppConfig {
  static const bool showDemoHints =
      bool.fromEnvironment('SHOW_DEMO_HINTS', defaultValue: true);
}
