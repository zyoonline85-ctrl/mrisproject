import 'dart:io';

import 'package:permission_handler/permission_handler.dart';
import 'package:print_bluetooth_thermal/print_bluetooth_thermal.dart';

import '../models/app_models.dart';

class ThermalPrinterException implements Exception {
  const ThermalPrinterException(this.message);

  final String message;

  @override
  String toString() => message;
}

class ThermalPrinterService {
  Future<bool> get bluetoothEnabled => PrintBluetoothThermal.bluetoothEnabled;
  Future<bool> get connectionStatus => PrintBluetoothThermal.connectionStatus;

  Future<bool> ensureBluetoothPermission() async {
    if (!Platform.isAndroid) return true;
    final statuses = await [
      Permission.bluetoothConnect,
      Permission.bluetoothScan,
    ].request();
    final grantedByPermissionHandler = statuses.values.every(
      (status) => status.isGranted || status.isLimited,
    );
    final grantedByPlugin =
        await PrintBluetoothThermal.isPermissionBluetoothGranted;
    return grantedByPermissionHandler || grantedByPlugin;
  }

  Future<List<ThermalPrinterDevice>> pairedPrinters() async {
    final hasPermission = await ensureBluetoothPermission();
    if (!hasPermission) {
      throw const ThermalPrinterException(
          'Permission Bluetooth belum aktif. Izinkan akses Nearby devices.');
    }

    final enabled = await bluetoothEnabled;
    if (!enabled) {
      throw const ThermalPrinterException(
          'Bluetooth mati. Aktifkan Bluetooth Android dulu.');
    }

    final printers = await PrintBluetoothThermal.pairedBluetooths;
    return printers
        .map((printer) => ThermalPrinterDevice(
              name: printer.name,
              address: printer.macAdress,
            ))
        .where((printer) => printer.address.isNotEmpty)
        .toList();
  }

  Future<bool> connect(String macAddress) async {
    if (macAddress.trim().isEmpty) {
      throw const ThermalPrinterException('Pilih printer Bluetooth dulu.');
    }

    final hasPermission = await ensureBluetoothPermission();
    if (!hasPermission) {
      throw const ThermalPrinterException(
          'Permission Bluetooth belum aktif. Izinkan akses Nearby devices.');
    }

    final enabled = await bluetoothEnabled;
    if (!enabled) {
      throw const ThermalPrinterException(
          'Bluetooth mati. Aktifkan Bluetooth Android dulu.');
    }

    final alreadyConnected = await connectionStatus;
    if (alreadyConnected) return true;
    final connected =
        await PrintBluetoothThermal.connect(macPrinterAddress: macAddress);
    if (!connected) {
      throw const ThermalPrinterException(
          'Gagal konek printer. Pastikan printer menyala dan sudah paired.');
    }
    return connected;
  }

  Future<bool> disconnect() => PrintBluetoothThermal.disconnect;

  Future<void> printBytes({
    required PrintSettings settings,
    required List<int> bytes,
  }) async {
    if (!settings.hasSelectedPrinter) {
      throw const ThermalPrinterException('Pilih printer Bluetooth dulu.');
    }

    await connect(settings.printerAddress);
    final result = await PrintBluetoothThermal.writeBytes(bytes);
    if (!result) {
      throw const ThermalPrinterException(
          'Gagal mengirim data ke printer thermal.');
    }
  }
}
