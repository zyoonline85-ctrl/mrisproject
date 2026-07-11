import { Fragment, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Edit, KeyRound, Loader2, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useChangeProfilePassword,
  useCreateRole,
  useDeleteRole,
  useSettings,
  useUpdateAppSecuritySettings,
  useUpdatePrintSettings,
  useUpdateProfile,
  useUpdateRole,
  useUpdateRolePermissions
} from "@/hooks/useAdminQueries";
import { actionLabels, permissionCatalog, permissionGroups } from "@/config/permissionCatalog";
import { can } from "@/lib/permissions";
import { recordActivity } from "@/lib/activityAudit";
import { formatDateTime } from "@/lib/utils";
import { useAppStore } from "@/store/appStore";

function PermissionActionCheckbox({ action, canEdit, checked, disabled, onChange }) {
  return (
    <label className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]">
      <input
        type="checkbox"
        className="h-3.5 w-3.5 accent-primary disabled:cursor-not-allowed disabled:opacity-50"
        checked={checked}
        disabled={disabled || !canEdit}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{action}</span>
    </label>
  );
}

function RoleFormDialog({ role = null, canManage = false }) {
  const [open, setOpen] = useState(false);
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();
  const isEdit = Boolean(role);
  const mutation = isEdit ? updateRole : createRole;
  const {
    handleSubmit,
    register,
    reset,
    formState: { errors }
  } = useForm({
    defaultValues: {
      name: role?.name || "",
      description: role?.description || ""
    }
  });

  function changeOpen(nextOpen) {
    setOpen(nextOpen);
    if (nextOpen) {
      reset({ name: role?.name || "", description: role?.description || "" });
    }
  }

  async function submit(values) {
    const payload = {
      name: values.name.trim(),
      description: values.description.trim()
    };
    if (isEdit) await updateRole.mutateAsync({ roleId: role.id, payload });
    else await createRole.mutateAsync(payload);
    changeOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={isEdit ? "outline" : "default"} disabled={!canManage}>
          {isEdit ? <Edit /> : <Plus />}
          {isEdit ? "Edit Role" : "Tambah Role"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Role" : "Tambah Role Custom"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Ubah identitas role tanpa mengubah permission yang sudah dipilih."
              : "Role dibuat tanpa akses. Pilih permission Admin dan APK setelah role tersimpan."}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit(submit)}>
          <div className="space-y-1.5">
            <Label htmlFor={`role-name-${role?.id || "new"}`}>Nama Role</Label>
            <Input
              id={`role-name-${role?.id || "new"}`}
              maxLength={80}
              placeholder="Contoh: Supervisor Outlet"
              {...register("name", {
                required: "Nama role wajib diisi",
                minLength: { value: 2, message: "Nama role minimal 2 karakter" }
              })}
            />
            {errors.name ? <p className="text-[11px] text-destructive">{errors.name.message}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`role-description-${role?.id || "new"}`}>Deskripsi</Label>
            <textarea
              id={`role-description-${role?.id || "new"}`}
              className="min-h-24 w-full resize-y rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              maxLength={500}
              placeholder="Jelaskan tanggung jawab role ini"
              {...register("description")}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={mutation.isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              {mutation.isPending ? "Menyimpan..." : "Simpan Role"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PermissionMatrixPage() {
  const session = useAppStore((state) => state.session);
  const { data, isError, isLoading, error } = useSettings();
  const updateRolePermissions = useUpdateRolePermissions();
  const deleteRole = useDeleteRole();
  const canEdit = can(session, "settings.permissions", "update");
  const canCreate = can(session, "settings.permissions", "create");
  const canDelete = can(session, "settings.permissions", "delete");

  if (isLoading) {
    return <Skeleton className="h-96" />;
  }

  if (isError || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Permission Matrix</CardTitle>
          <p className="text-[12px] text-destructive">{error?.message || "Data permission belum tersedia."}</p>
        </CardHeader>
      </Card>
    );
  }

  const groupedPermissions = permissionGroups
    .map((group) => ({
      ...group,
      permissions: data.permissions.filter((permission) => permission.group === group.key)
    }))
    .filter((group) => group.permissions.length);

  function togglePermission(role, permissionKey, action, checked) {
    const currentActions = role.permissions[permissionKey] || [];
    let nextActions = checked
      ? [...new Set([...currentActions, action])]
      : currentActions.filter((item) => item !== action);

    if (permissionKey.startsWith("apk.")) {
      if (checked && action !== "view") nextActions = [...new Set(["view", ...nextActions])];
      if (!checked && action === "view") nextActions = [];
    }

    updateRolePermissions.mutate({
      roleId: role.id,
      permissions: {
        ...role.permissions,
        [permissionKey]: nextActions
      }
    });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1.35fr_0.75fr]">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Permission Matrix</CardTitle>
              <p className="text-[12px] text-muted-foreground">RBAC Admin Web dan APK Kasir per menu serta action. Owner dikunci full access.</p>
            </div>
            <RoleFormDialog canManage={canCreate} />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Menu</TableHead>
                {data.roles.map((role) => (
                  <TableHead key={role.id}>{role.name}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupedPermissions.map((group) => (
                <Fragment key={group.key}>
                  <TableRow key={`${group.key}-header`} className="bg-muted/35 hover:bg-muted/35">
                    <TableCell colSpan={data.roles.length + 1} className="py-2 text-[11px] font-semibold uppercase text-muted-foreground">
                      {group.label}
                    </TableCell>
                  </TableRow>
                  {group.permissions.map((permission) => (
                    <TableRow key={permission.key}>
                      <TableCell className="min-w-40">
                        <p className="font-medium">{permission.label}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{permission.key}</p>
                      </TableCell>
                      {data.roles.map((role) => {
                        const actions = role.permissions[permission.key] || [];
                        const isOwner = role.id === "role_owner";
                        return (
                          <TableCell key={role.id}>
                            <div className="flex flex-wrap gap-1">
                              {isOwner ? (
                                <>
                                  {permission.actions.map((action) => (
                                    <Badge key={action} variant="outline">
                                      {actionLabels[action] || action}
                                    </Badge>
                                  ))}
                                  <Badge variant="success">locked</Badge>
                                </>
                              ) : (
                                permission.actions.map((action) => (
                                  <PermissionActionCheckbox
                                    key={action}
                                    action={actionLabels[action] || action}
                                    checked={actions.includes(action)}
                                    canEdit={canEdit}
                                    disabled={updateRolePermissions.isPending}
                                    onChange={(checked) => togglePermission(role, permission.key, action, checked)}
                                  />
                                ))
                              )}
                            </div>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Role Guard Aktif</CardTitle>
          <p className="text-[12px] text-muted-foreground">Menu dan action mengikuti permission session saat ini.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.roles.map((role) => (
            <div key={role.id} className="rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{role.name}</p>
                {role.id === "role_owner" ? <Badge variant="success">Full Access</Badge> : <Badge variant="outline">Editable</Badge>}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{role.description}</p>
              {role.id !== "role_owner" &&
              (canEdit ||
                (canDelete && !["role_admin", "role_cashier"].includes(role.id))) ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {canEdit ? <RoleFormDialog role={role} canManage /> : null}
                  {!["role_admin", "role_cashier"].includes(role.id) ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={!canDelete || deleteRole.isPending}
                      onClick={() => {
                        if (window.confirm(`Hapus role ${role.name}? Role yang masih digunakan user tidak dapat dihapus.`)) {
                          deleteRole.mutate(role.id);
                        } else {
                          recordActivity({ module: "permission", action: "delete_role", outcome: "cancelled", entityType: "role", entityId: role.id, description: `Penghapusan role ${role.name} dibatalkan.` });
                        }
                      }}
                    >
                      {deleteRole.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
                      Hapus
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
          {!canEdit ? (
            <div className="rounded-md border border-dashed p-3 text-[12px] text-muted-foreground">
              Role kamu hanya bisa melihat permission matrix.
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function PrintSettingsPage() {
  const session = useAppStore((state) => state.session);
  const { data, isLoading } = useSettings();
  const updatePrintSettings = useUpdatePrintSettings();
  const canEdit = can(session, "settings.printing", "update");

  if (isLoading) return <Skeleton className="h-96" />;

  return (
    <PrintSettingsEditor
      key={JSON.stringify(data.print_settings)}
      canEdit={canEdit}
      initialPrinterName={data.print_settings?.printer_name || "Printer Kasir Utama"}
      initialPrinterStatus={data.print_settings?.printer_status || "active"}
      initialTemplates={data.print_settings?.templates || []}
      updatePrintSettings={updatePrintSettings}
    />
  );
}

function PrintSettingsEditor({ canEdit, initialPrinterName, initialPrinterStatus, initialTemplates, updatePrintSettings }) {
  const [templates, setTemplates] = useState(() => initialTemplates.map(normalizePrintTemplate));

  function updateTemplate(key, enabled) {
    setTemplates((current) => current.map((template) => (template.key === key ? { ...template, enabled } : template)));
  }

  function updateTemplateFooter(key, footerText) {
    setTemplates((current) => current.map((template) => (template.key === key ? { ...template, footer_text: footerText } : template)));
  }

  function save() {
    updatePrintSettings.mutate({
      printer_name: initialPrinterName,
      printer_status: initialPrinterStatus,
      templates
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>Pengaturan Print</CardTitle>
              <p className="mt-1 text-[12px] text-muted-foreground">Atur template cetak yang tersedia untuk aplikasi kasir. Urutan item struk mengikuti urutan Kategori Produk.</p>
            </div>
            <Button onClick={save} disabled={!canEdit || updatePrintSettings.isPending}>
              <Save />
              {updatePrintSettings.isPending ? "Menyimpan..." : "Simpan Print"}
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Template Print</CardTitle>
            <p className="text-[12px] text-muted-foreground">Template aktif akan tersedia sebagai pilihan cetak untuk kasir.</p>
          </CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-3">
            {templates.map((template) => (
              <div key={template.key} className="space-y-3 rounded-md border p-3">
                <label className="flex items-center justify-between gap-3">
                  <span>
                    <span className="block font-medium">{template.label}</span>
                    <span className="text-[11px] text-muted-foreground">{template.key}</span>
                  </span>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={template.enabled !== false}
                    disabled={!canEdit}
                    onChange={(event) => updateTemplate(template.key, event.target.checked)}
                  />
                </label>
                {canEditPrintFooter(template.key) ? (
                  <div className="space-y-1.5">
                    <Label htmlFor={`print-footer-${template.key}`}>Footer Struk</Label>
                    <textarea
                      id={`print-footer-${template.key}`}
                      className="min-h-24 w-full resize-y rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted"
                      maxLength={300}
                      placeholder={template.key === "bill_receipt" ? "Terima kasih" : "Footer customer order"}
                      value={template.footer_text || ""}
                      disabled={!canEdit}
                      onChange={(event) => updateTemplateFooter(template.key, event.target.value)}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Footer tampil di bagian bawah preview dan hasil print thermal APK. {String(template.footer_text || "").length}/300
                    </p>
                  </div>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function normalizePrintTemplate(template) {
  return {
    ...template,
    footer_text:
      typeof template.footer_text === "string"
        ? template.footer_text
        : template.key === "bill_receipt"
          ? "Terima kasih"
          : ""
  };
}

function canEditPrintFooter(key) {
  return key === "customer_order" || key === "bill_receipt";
}

function AppSecurityPage() {
  const session = useAppStore((state) => state.session);
  const { data, isLoading } = useSettings();
  const updateAppSecurity = useUpdateAppSecuritySettings();
  const canEdit = can(session, "settings.app_security", "update");
  const appSecurity = data?.app_security || {};
  const { register, handleSubmit, watch, reset, formState: { errors, isSubmitting } } = useForm({
    values: {
      report_pin_enabled: appSecurity.report_pin_enabled !== false,
      report_pin: "",
      report_pin_confirmation: ""
    }
  });
  const reportPinEnabled = watch("report_pin_enabled");

  if (isLoading) return <Skeleton className="h-96" />;

  async function submit(values) {
    const pin = String(values.report_pin || "").trim();
    await updateAppSecurity.mutateAsync({
      report_pin_enabled: Boolean(values.report_pin_enabled),
      report_pin: pin || undefined
    });
    reset({
      report_pin_enabled: Boolean(values.report_pin_enabled),
      report_pin: "",
      report_pin_confirmation: ""
    });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_0.75fr]">
      <Card>
        <CardHeader>
          <CardTitle>Keamanan APK</CardTitle>
          <p className="text-[12px] text-muted-foreground">Atur PIN khusus untuk membuka menu Laporan di APK kasir.</p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit(submit)}>
            <label className="flex items-center justify-between gap-3 rounded-md border p-3">
              <span>
                <span className="block font-medium">Aktifkan PIN Laporan APK</span>
                <span className="text-[12px] text-muted-foreground">Jika aktif, APK meminta PIN setiap kali kasir membuka menu Laporan.</span>
              </span>
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                disabled={!canEdit}
                {...register("report_pin_enabled")}
              />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="report-pin">PIN Laporan Baru</Label>
                <Input
                  id="report-pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder={appSecurity.has_report_pin ? "Kosongkan jika tidak diganti" : "000000"}
                  disabled={!canEdit}
                  {...register("report_pin", {
                    validate: (value) => {
                      const pin = String(value || "").trim();
                      if (!reportPinEnabled && !pin) return true;
                      if (reportPinEnabled && !appSecurity.has_report_pin && !pin) return "PIN laporan wajib diisi 6 digit.";
                      if (pin && !/^\d{6}$/.test(pin)) return "PIN laporan wajib 6 digit angka.";
                      return true;
                    }
                  })}
                />
                <FieldError errors={errors} name="report_pin" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="report-pin-confirmation">Konfirmasi PIN</Label>
                <Input
                  id="report-pin-confirmation"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Ulangi PIN baru"
                  disabled={!canEdit}
                  {...register("report_pin_confirmation", {
                    validate: (value, values) => {
                      const pin = String(values.report_pin || "").trim();
                      if (!pin) return true;
                      return String(value || "").trim() === pin || "Konfirmasi PIN tidak sama.";
                    }
                  })}
                />
                <FieldError errors={errors} name="report_pin_confirmation" />
              </div>
            </div>

            <div className="rounded-md border border-dashed p-3 text-[12px] text-muted-foreground">
              PIN lama tidak ditampilkan kembali. Demo awal memakai PIN <span className="font-semibold">000000</span>; ganti PIN default sebelum dipakai operasional.
            </div>

            <Button type="submit" disabled={!canEdit || isSubmitting || updateAppSecurity.isPending}>
              <Save />
              {updateAppSecurity.isPending ? "Menyimpan..." : "Simpan Keamanan APK"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Status PIN Laporan</CardTitle>
          <p className="text-[12px] text-muted-foreground">Status ini aman ditampilkan karena tidak memuat nilai PIN.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <span className="text-muted-foreground">Proteksi laporan</span>
            <Badge variant={appSecurity.report_pin_enabled !== false ? "success" : "muted"}>
              {appSecurity.report_pin_enabled !== false ? "Aktif" : "Nonaktif"}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <span className="text-muted-foreground">PIN laporan</span>
            <Badge variant={appSecurity.has_report_pin ? "success" : "warning"}>
              {appSecurity.has_report_pin ? "PIN diset" : "PIN belum diset"}
            </Badge>
          </div>
          {!canEdit ? (
            <div className="rounded-md border border-dashed p-3 text-[12px] text-muted-foreground">
              Role kamu hanya bisa melihat pengaturan keamanan APK.
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function FieldError({ errors, name }) {
  const error = errors[name];
  return error ? <p className="text-[11px] text-destructive">{error.message}</p> : null;
}

function getInitials(name) {
  return String(name || "BA")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function ProfileEditDialog({ onSubmit, session }) {
  const [open, setOpen] = useState(false);
  const { control, handleSubmit, reset, formState: { errors, isDirty, isSubmitting } } = useForm({
    defaultValues: {
      name: session?.name || "",
      username: session?.username || "",
      email: session?.email || ""
    }
  });

  async function submit(values) {
    await onSubmit(values);
    reset(values);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Edit />
          Edit Profil
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Profil Akun</DialogTitle>
          <DialogDescription>Perubahan nama, username, dan email tersimpan ke akun backend.</DialogDescription>
        </DialogHeader>

        <form className="space-y-3" onSubmit={handleSubmit(submit)}>
          <div className="space-y-1.5">
            <Label>Nama</Label>
            <Controller
              name="name"
              control={control}
              rules={{ required: "Nama wajib diisi", minLength: { value: 2, message: "Nama minimal 2 karakter" } }}
              render={({ field }) => <Input placeholder="Nama lengkap" {...field} />}
            />
            <FieldError errors={errors} name="name" />
          </div>

          <div className="space-y-1.5">
            <Label>Username</Label>
            <Controller
              name="username"
              control={control}
              rules={{ required: "Username wajib diisi", minLength: { value: 3, message: "Username minimal 3 karakter" } }}
              render={({ field }) => <Input placeholder="username" {...field} />}
            />
            <FieldError errors={errors} name="username" />
          </div>

          <div className="space-y-1.5">
            <Label>Email</Label>
            <Controller
              name="email"
              control={control}
              rules={{
                required: "Email wajib diisi",
                validate: (value) => String(value || "").includes("@") || "Format email tidak valid"
              }}
              render={({ field }) => <Input placeholder="nama@barokah.local" {...field} />}
            />
            <FieldError errors={errors} name="email" />
          </div>

          {isDirty ? <p className="text-[11px] text-muted-foreground">Perubahan belum disimpan.</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Menyimpan..." : "Simpan Profil"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({ onSubmit }) {
  const [open, setOpen] = useState(false);
  const { control, getValues, handleSubmit, reset, formState: { errors, isDirty, isSubmitting } } = useForm({
    defaultValues: {
      current_password: "",
      new_password: "",
      confirm_password: ""
    }
  });

  async function submit(values) {
    await onSubmit(values);
    reset();
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <KeyRound />
          Ganti Password
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ganti Password</DialogTitle>
          <DialogDescription>Password akun akan diperbarui di backend.</DialogDescription>
        </DialogHeader>

        <form className="space-y-3" onSubmit={handleSubmit(submit)}>
          <div className="space-y-1.5">
            <Label>Password Lama</Label>
            <Controller
              name="current_password"
              control={control}
              rules={{ required: "Password lama wajib diisi" }}
              render={({ field }) => <Input type="password" placeholder="Password saat ini" {...field} />}
            />
            <FieldError errors={errors} name="current_password" />
          </div>

          <div className="space-y-1.5">
            <Label>Password Baru</Label>
            <Controller
              name="new_password"
              control={control}
              rules={{ required: "Password baru wajib diisi", minLength: { value: 6, message: "Password baru minimal 6 karakter" } }}
              render={({ field }) => <Input type="password" placeholder="Minimal 6 karakter" {...field} />}
            />
            <FieldError errors={errors} name="new_password" />
          </div>

          <div className="space-y-1.5">
            <Label>Konfirmasi Password</Label>
            <Controller
              name="confirm_password"
              control={control}
              rules={{
                required: "Konfirmasi password wajib diisi",
                validate: (value) => value === getValues("new_password") || "Konfirmasi password tidak sama"
              }}
              render={({ field }) => <Input type="password" placeholder="Ulangi password baru" {...field} />}
            />
            <FieldError errors={errors} name="confirm_password" />
          </div>

          {isDirty ? <p className="text-[11px] text-muted-foreground">Perubahan belum disimpan.</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Menyimpan..." : "Simpan Password"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProfilePermissionList({ role }) {
  const allowedPermissions = permissionCatalog.filter((permission) => (role?.permissions?.[permission.key] || []).length);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Role & Permission</CardTitle>
        <p className="text-[12px] text-muted-foreground">Akses aktif dari role {role?.name || "-"}.</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {allowedPermissions.map((permission) => (
          <div key={permission.key} className="rounded-md border p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{permission.label}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{permission.key}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                {(role?.permissions?.[permission.key] || []).map((action) => (
                  <Badge key={action} variant="outline">
                    {actionLabels[action] || action}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ProfilAkunPage() {
  const session = useAppStore((state) => state.session);
  const updateProfile = useUpdateProfile();
  const changePassword = useChangeProfilePassword();
  const activeOutlets = session?.outlets || [];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-primary text-[18px] font-semibold text-white">
              {getInitials(session?.name)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-[18px] font-semibold">{session?.name || "-"}</h2>
                <Badge variant={session?.status === "active" ? "success" : "muted"}>{session?.status === "active" ? "Aktif" : "Nonaktif"}</Badge>
              </div>
              <p className="mt-1 text-[12px] text-muted-foreground">
                @{session?.username || "-"} · {session?.role?.name || "-"}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <ProfileEditDialog session={session} onSubmit={(values) => updateProfile.mutateAsync({ id: session.id, payload: values })} />
            <PasswordDialog onSubmit={(values) => changePassword.mutateAsync({ id: session.id, payload: values })} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Informasi Akun</CardTitle>
              <p className="text-[12px] text-muted-foreground">Data profil dari akun yang sedang login.</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                ["Nama", session?.name],
                ["Username", session?.username],
                ["Email", session?.email],
                ["Role", session?.role?.name],
                ["Last Login", session?.last_login_at ? formatDateTime(session.last_login_at) : "-"],
                ["Profil Update", session?.profile_updated_at ? formatDateTime(session.profile_updated_at) : "-"],
                ["Password Update", session?.password_changed_at ? formatDateTime(session.password_changed_at) : "-"]
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="min-w-0 truncate text-right font-medium">{value || "-"}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Outlet Akses</CardTitle>
              <p className="text-[12px] text-muted-foreground">Outlet yang tersedia untuk session saat ini.</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {activeOutlets.map((outlet) => (
                <div key={outlet.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{outlet.name}</p>
                    <Badge variant={outlet.status === "active" ? "success" : "muted"}>{outlet.status === "active" ? "Aktif" : "Nonaktif"}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{outlet.address}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{outlet.phone}</p>
                </div>
              ))}
              {!activeOutlets.length ? <div className="rounded-md border border-dashed p-4 text-[12px] text-muted-foreground">Tidak ada outlet assigned.</div> : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Keamanan Akun</CardTitle>
              <p className="text-[12px] text-muted-foreground">Status keamanan untuk akun ini.</p>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  <p className="font-medium">Session Aktif</p>
                </div>
                <p className="mt-2 text-[12px] text-muted-foreground">Session aktif sampai user logout atau token kedaluwarsa.</p>
              </div>
              <div className="rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-primary" />
                  <p className="font-medium">Password</p>
                </div>
                <p className="mt-2 text-[12px] text-muted-foreground">
                  {session?.password_changed_at ? `Diubah ${formatDateTime(session.password_changed_at)}` : "Belum ada perubahan password yang tercatat."}
                </p>
              </div>
            </CardContent>
          </Card>

          <ProfilePermissionList role={session?.role} />
        </div>
      </div>
    </div>
  );
}

export { AppSecurityPage, PermissionMatrixPage, PrintSettingsPage, ProfilAkunPage };
