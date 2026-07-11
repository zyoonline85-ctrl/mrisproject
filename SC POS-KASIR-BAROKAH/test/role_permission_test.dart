import 'package:flutter_test/flutter_test.dart';
import 'package:pos_kasir_barokah/models/app_models.dart';

void main() {
  test('CashierUser mengecek menu dan action APK secara terpisah', () {
    const user = CashierUser(
      id: 'user_1',
      name: 'Supervisor',
      username: 'supervisor',
      password: '',
      outletIds: ['outlet_1'],
      active: true,
      roleId: 'role_supervisor',
      roleName: 'Supervisor Outlet',
      permissions: {
        'dashboard': ['view'],
        'apk.purchases': ['view', 'create'],
        'apk.reports': ['view'],
      },
    );

    expect(user.hasApkAccess, isTrue);
    expect(user.can('apk.purchases'), isTrue);
    expect(user.can('apk.purchases', 'create'), isTrue);
    expect(user.can('apk.purchases', 'update'), isFalse);
    expect(user.can('apk.sales'), isFalse);
  });

  test('role tanpa permission view APK tidak dianggap dapat login APK', () {
    const user = CashierUser(
      id: 'user_2',
      name: 'Admin',
      username: 'admin',
      password: '',
      outletIds: ['outlet_1'],
      active: true,
      permissions: {
        'dashboard': ['view'],
      },
    );

    expect(user.hasApkAccess, isFalse);
  });
}
