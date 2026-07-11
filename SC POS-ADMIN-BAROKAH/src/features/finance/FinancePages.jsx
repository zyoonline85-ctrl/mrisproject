import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { BookOpen, Edit, History, Loader2, Plus, Power, PowerOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormattedNumberInput } from "@/components/ui/formatted-number-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/shared/DataTable";
import { InlineRowActions, RowActionButton } from "@/components/shared/RowActions";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DatePicker } from "@/components/ui/date-picker";
import {
  useCreateFinancialAccount,
  useCreateFinanceEntry,
  useCreateFinanceEntryGroup,
  useMasterData,
  useToggleFinancialAccountStatus,
  useToggleFinanceEntryGroupStatus,
  useToggleFinanceEntryStatus,
  useUpdateFinancialAccount,
  useUpdateFinanceEntry,
  useUpdateFinanceEntryGroup
} from "@/hooks/useAdminQueries";
import { useAppStore } from "@/store/appStore";
import { can } from "@/lib/permissions";
import { formatCurrency, formatDate, toDateString } from "@/lib/utils";

const accountGroups = [
  { value: "cash_bank", label: "Cash and Bank" },
  { value: "inventory", label: "Inventory" },
  { value: "other_current_asset", label: "Other Current Asset" },
  { value: "fixed_asset", label: "Aset Tetap" },
  { value: "moving_asset", label: "Aset Bergerak" },
  { value: "liability", label: "Liability" },
  { value: "equity", label: "Equity" },
  { value: "income", label: "Income" },
  { value: "cogs", label: "COGS / HPP" },
  { value: "expense", label: "Expense" },
  { value: "other_income", label: "Other Income" },
  { value: "other_expense", label: "Other Expense" }
];

const entryGroups = [
  { value: "other_income", label: "Other Income" },
  { value: "other_expense", label: "Other Expense" },
  { value: "other_current_asset", label: "Other Current Asset" },
  { value: "fixed_asset", label: "Aset Tetap" },
  { value: "moving_asset", label: "Aset Bergerak" },
  { value: "liability", label: "Hutang / Kewajiban" },
  { value: "equity", label: "Equity / Modal" }
];

const normalBalances = [
  { value: "debit", label: "Debit" },
  { value: "credit", label: "Credit" }
];

const movementTypes = [
  { value: "in", label: "Bertambah" },
  { value: "out", label: "Berkurang" }
];

const accountGuideRanges = [
  ["1xxx", "Aset", "Kas, bank, persediaan, dana cadangan, dan aset usaha."],
  ["2xxx", "Hutang / Kewajiban", "Bon pembelian dan kewajiban yang harus dibayar."],
  ["3xxx", "Modal / Equity", "Modal pemilik, laba ditahan, dan saldo equity."],
  ["4xxx", "Pendapatan", "Penjualan usaha dan pengurang pendapatan seperti diskon."],
  ["5xxx", "HPP / COGS", "Harga pokok penjualan atau produksi."],
  ["6xxx", "Biaya / Expense", "Biaya operasional dan biaya produksi."],
  ["7xxx", "Pendapatan Lain-Lain", "Pendapatan di luar penjualan utama."],
  ["8xxx", "Pengeluaran Lain-Lain", "Pengeluaran di luar biaya operasional utama."]
];

const accountGuideExamples = [
  ["[1001] Kas", "Payment cash / laci kasir."],
  ["[1044] QRIS / E-Wallet", "Payment QRIS atau e-wallet."],
  ["[5002] Harga Pokok Penjualan", "Pembelian HPP yang masuk Cost of Goods Sold."],
  ["[6005] Biaya Listrik dan Gas", "Pengeluaran listrik dan gas."],
  ["[3001] Modal Pemilik", "Setoran modal owner."],
  ["[4000] Prive Owner", "Pengambilan owner yang mengurangi equity."]
];

const entryGroupValues = new Set(entryGroups.map((group) => group.value));

function labelFromOptions(options, value) {
  return options.find((item) => item.value === value)?.label || value || "-";
}

function formatEntryAccount(row) {
  if (row?.account) return `[${row.account.code}] ${row.account.name}`;
  return row?.account_code ? `[${row.account_code}] Akun belum terdaftar` : "-";
}

function formatEntryEffectAmount(row) {
  const amount = Number(row?.amount || 0);
  const prefix = row?.movement_type === "out" ? "-" : "+";
  return `${prefix}${formatCurrency(amount)}`;
}

function getEntryMovementHelp(account, movementType) {
  if (!account) {
    return "Pilih akun dulu supaya sistem bisa menjelaskan apakah nilai ini masuk Neraca atau Laba Rugi.";
  }

  const isDecrease = movementType === "out";
  const group = account.report_group;
  const accountLabel = `[${account.code}] ${account.name}`;

  if (group === "other_income") {
    return isDecrease
      ? `${accountLabel} akan mengurangi Pendapatan Lain-Lain di Laba Rugi pada tanggal entry.`
      : `${accountLabel} akan menambah Pendapatan Lain-Lain di Laba Rugi pada tanggal entry.`;
  }

  if (group === "other_expense") {
    return isDecrease
      ? `${accountLabel} akan mengurangi Pengeluaran Lain-Lain di Laba Rugi pada tanggal entry.`
      : `${accountLabel} akan menambah Pengeluaran Lain-Lain di Laba Rugi pada tanggal entry.`;
  }

  if (["other_current_asset", "fixed_asset", "moving_asset"].includes(group)) {
    return isDecrease
      ? `${accountLabel} akan mengurangi saldo aset di Neraca sampai tanggal laporan.`
      : `${accountLabel} akan menambah saldo aset di Neraca sampai tanggal laporan.`;
  }

  if (group === "liability") {
    return isDecrease
      ? `${accountLabel} akan mengurangi hutang/kewajiban di Neraca.`
      : `${accountLabel} akan menambah hutang/kewajiban di Neraca.`;
  }

  if (group === "equity") {
    return isDecrease
      ? `${accountLabel} akan mengurangi Equity/Modal di Neraca. Contoh: Prive Owner.`
      : `${accountLabel} akan menambah Equity/Modal di Neraca. Contoh: setoran modal.`;
  }

  return `${accountLabel} akan mengikuti group laporan ${labelFromOptions(entryGroups, group)}.`;
}

function useFinancePageData() {
  const selectedOutletId = useAppStore((state) => state.selectedOutletId);
  const session = useAppStore((state) => state.session);
  const query = useMasterData({ outletId: selectedOutletId });
  const data = query.data || {};

  return {
    ...query,
    session,
    outlets: data.outlets || [],
    financialAccounts: data.financial_accounts || [],
    financeEntryGroups: data.finance_entry_groups || [],
    financeEntries: data.finance_entries || []
  };
}

function getAccountDefaults(account) {
  return {
    code: account?.code || "",
    name: account?.name || "",
    report_group: account?.report_group || "expense",
    normal_balance: account?.normal_balance || "debit",
    sort_order: account?.sort_order || "",
    status: account?.status || "active"
  };
}

function AccountFormDialog({ account, isPending, mode = "create", onSubmit, open, onOpenChange, trigger }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const { control, formState, handleSubmit, register, reset } = useForm({ defaultValues: getAccountDefaults(account) });

  useEffect(() => {
    if (isOpen) reset(getAccountDefaults(account));
  }, [account, isOpen, reset]);

  async function submit(values) {
    await onSubmit({
      ...values,
      sort_order: Number(values.sort_order || 0)
    });
    setOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Edit Master Akun" : "Tambah Master Akun"}</DialogTitle>
          <DialogDescription>Master Akun adalah daftar pos laporan. Modul lain memilih akun dari sini agar laporan otomatis masuk ke bagian yang benar.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={handleSubmit(submit)}>
          <div className="grid gap-2">
            <Label htmlFor="code">Kode Akun</Label>
            <Input id="code" {...register("code", { required: "Kode akun wajib diisi" })} placeholder="4001" />
            {formState.errors.code ? <p className="text-[11px] text-destructive">{formState.errors.code.message}</p> : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="name">Nama Akun</Label>
            <Input id="name" {...register("name", { required: "Nama akun wajib diisi" })} placeholder="Pendapatan Usaha" />
            {formState.errors.name ? <p className="text-[11px] text-destructive">{formState.errors.name.message}</p> : null}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>Group Laporan</Label>
              <Controller
                name="report_group"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {accountGroups.map((group) => (
                        <SelectItem key={group.value} value={group.value}>
                          {group.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="grid gap-2">
              <Label>Normal Balance</Label>
              <Controller
                name="normal_balance"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {normalBalances.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="sort_order">Urutan</Label>
              <Input id="sort_order" type="number" min="1" {...register("sort_order", { required: "Urutan wajib diisi" })} />
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Controller
                name="status"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Aktif</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" /> : null}
              {isPending ? "Menyimpan..." : "Simpan"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AccountGuideDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <BookOpen />
          Panduan Akun
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Panduan Master Akun</DialogTitle>
          <DialogDescription>Referensi cepat untuk membaca nomor akun, group laporan, dan debit/credit.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <section className="rounded-md border bg-muted/20 p-4">
            <h3 className="text-[14px] font-semibold">Mapping Nomor Akun</h3>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {accountGuideRanges.map(([range, label, description]) => (
                <div key={range} className="rounded-md border bg-background p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{range}</Badge>
                    <span className="text-[13px] font-semibold">{label}</span>
                  </div>
                  <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{description}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-md border bg-muted/20 p-4">
            <h3 className="text-[14px] font-semibold">Contoh Pemakaian di Barokah</h3>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {accountGuideExamples.map(([account, description]) => (
                <div key={account} className="flex items-start justify-between gap-3 rounded-md border bg-background p-3">
                  <span className="text-[13px] font-semibold">{account}</span>
                  <span className="text-right text-[12px] leading-relaxed text-muted-foreground">{description}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-md border bg-muted/20 p-4">
            <h3 className="text-[14px] font-semibold">Catatan Debit dan Credit</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="rounded-md border bg-background p-3">
                <p className="text-[13px] font-semibold">Debit</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Biasanya dipakai untuk aset dan biaya. Contoh: kas, persediaan, HPP, dan pengeluaran.</p>
              </div>
              <div className="rounded-md border bg-background p-3">
                <p className="text-[13px] font-semibold">Credit</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Biasanya dipakai untuk hutang, modal, dan pendapatan. Contoh: bon pembelian, modal pemilik, dan penjualan.</p>
              </div>
              <div className="rounded-md border bg-background p-3">
                <p className="text-[13px] font-semibold">Fokus Saat Input</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Pilih group akun yang benar dulu. Nomor akun hanya membantu laporan masuk ke bagian yang tepat.</p>
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AccountRowActions({ account, canToggleStatus, canUpdate }) {
  const [editOpen, setEditOpen] = useState(false);
  const updateAccount = useUpdateFinancialAccount();
  const toggleAccount = useToggleFinancialAccountStatus();
  const isInactive = account.status === "inactive";

  return (
    <>
      <InlineRowActions>
        {canUpdate ? (
          <RowActionButton label={`Edit ${account.name}`} onClick={() => setEditOpen(true)}>
            <Edit />
          </RowActionButton>
        ) : null}
        {canToggleStatus ? (
          <RowActionButton
            disabled={toggleAccount.isPending}
            label={toggleAccount.isPending ? "Memproses..." : isInactive ? `Aktifkan ${account.name}` : `Nonaktifkan ${account.name}`}
            onClick={() => toggleAccount.mutate(account.id)}
          >
            {toggleAccount.isPending ? <Loader2 className="animate-spin" /> : isInactive ? <Power /> : <PowerOff />}
          </RowActionButton>
        ) : null}
      </InlineRowActions>

      <AccountFormDialog
        mode="edit"
        account={account}
        open={editOpen}
        onOpenChange={setEditOpen}
        isPending={updateAccount.isPending}
        onSubmit={(values) => updateAccount.mutateAsync({ id: account.id, payload: values })}
      />
    </>
  );
}

function FinancialAccountsPage() {
  const { financialAccounts, isFetching, isLoading, session } = useFinancePageData();
  const createAccount = useCreateFinancialAccount();
  const canCreate = can(session, "finance.accounts", "create");
  const canUpdate = can(session, "finance.accounts", "update");
  const canToggle = can(session, "finance.accounts", "toggle_status");

  return (
    <DataTable
      title="Master Akun / Chart of Accounts"
      description="Master Akun adalah daftar pos laporan. Modul lain memilih akun dari sini agar Laba Rugi dan Neraca otomatis masuk ke bagian yang benar."
      data={financialAccounts}
      isFetching={isFetching}
      isLoading={isLoading}
      searchKeys={["code", "name", "report_group", "normal_balance", "status"]}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <AccountGuideDialog />
          {canCreate ? (
            <AccountFormDialog
              isPending={createAccount.isPending}
              onSubmit={(values) => createAccount.mutateAsync(values)}
              trigger={
                <Button disabled={createAccount.isPending}>
                  {createAccount.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                  {createAccount.isPending ? "Menyimpan..." : "Tambah Akun"}
                </Button>
              }
            />
          ) : null}
        </div>
      }
      columns={[
        { key: "sort_order", label: "Urutan", sortValue: (row) => Number(row.sort_order || 0) },
        { key: "code", label: "Kode", render: (row) => <Badge variant="outline">{row.code}</Badge> },
        { key: "name", label: "Nama Akun", className: "font-medium" },
        { key: "report_group", label: "Group", render: (row) => labelFromOptions(accountGroups, row.report_group) },
        { key: "normal_balance", label: "Normal", render: (row) => labelFromOptions(normalBalances, row.normal_balance) },
        { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
        {
          key: "actions",
          label: "Aksi",
          render: (row) => <AccountRowActions account={row} canUpdate={canUpdate} canToggleStatus={canToggle} />,
          className: "text-right whitespace-nowrap",
          headerClassName: "text-right"
        }
      ]}
    />
  );
}

function getFinanceGroupDefaults(group) {
  return {
    name: group?.name || "",
    account_code: group?.account_code || "",
    group: group?.group || "other_current_asset",
    outlet_id: group?.outlet_id || "all",
    note: group?.note || "",
    status: group?.status || "active"
  };
}

function getTransactionDefaults(entry) {
  return {
    amount: entry?.amount || "",
    entry_date: entry?.entry_date || toDateString(new Date()),
    movement_type: entry?.movement_type || "in",
    note: entry?.note || "",
    status: entry?.status || "active"
  };
}

function FinanceGroupFormDialog({ financeGroup, financialAccounts, isPending, mode = "create", onSubmit, open, onOpenChange, outlets, trigger }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const activeAccounts = useMemo(
    () =>
      financialAccounts.filter(
        (account) =>
          account.code === financeGroup?.account_code ||
          ((account.status === "active" || account.code === financeGroup?.account_code) && entryGroupValues.has(account.report_group))
      ),
    [financeGroup?.account_code, financialAccounts]
  );
  const { control, formState, handleSubmit, register, reset, setValue } = useForm({ defaultValues: getFinanceGroupDefaults(financeGroup) });
  const selectedAccountCode = useWatch({ control, name: "account_code" });
  const selectedGroup = useWatch({ control, name: "group" });
  const selectedAccount = activeAccounts.find((account) => account.code === selectedAccountCode);

  useEffect(() => {
    if (isOpen) reset(getFinanceGroupDefaults(financeGroup));
  }, [financeGroup, isOpen, reset]);

  useEffect(() => {
    if (selectedAccount?.report_group && selectedAccount.report_group !== selectedGroup) {
      setValue("group", selectedAccount.report_group, { shouldDirty: true, shouldValidate: true });
    }
  }, [selectedAccount, selectedGroup, setValue]);

  async function submit(values) {
    await onSubmit({
      ...values,
      group: selectedAccount?.report_group || values.group,
      outlet_id: values.outlet_id === "all" ? null : values.outlet_id
    });
    setOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Koreksi Pos Keuangan" : "Tambah Pos Keuangan"}</DialogTitle>
          <DialogDescription>Buat pos seperti Dana Gaji Karyawan, lalu catat transaksi masuk/keluar dari pos tersebut.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={handleSubmit(submit)}>
          <div className="grid gap-2">
            <Label htmlFor="finance_group_name">Nama Pos</Label>
            <Input id="finance_group_name" {...register("name", { required: "Nama pos wajib diisi" })} placeholder="Dana Gaji Karyawan" />
            {formState.errors.name ? <p className="text-[11px] text-destructive">{formState.errors.name.message}</p> : null}
          </div>
          <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
            <div className="grid gap-2">
              <Label>Akun Laporan</Label>
              <input type="hidden" {...register("group")} />
              <Controller
                name="account_code"
                control={control}
                rules={{ required: "Akun wajib dipilih" }}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih akun laporan" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeAccounts.map((account) => (
                        <SelectItem key={account.id} value={account.code}>
                          [{account.code}] {account.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <p className="text-[11px] text-muted-foreground">Akun ini menentukan posisi pos di Neraca atau Laba Rugi.</p>
              {formState.errors.account_code ? <p className="text-[11px] text-destructive">{formState.errors.account_code.message}</p> : null}
            </div>
            <div className="grid gap-2">
              <Label>Masuk ke Laporan</Label>
              <Input value={labelFromOptions(entryGroups, selectedAccount?.report_group || selectedGroup)} readOnly disabled />
              <p className="text-[11px] text-muted-foreground">Otomatis mengikuti Master Akun.</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>Outlet</Label>
              <Controller
                name="outlet_id"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua Outlet / Global</SelectItem>
                      {outlets.map((outlet) => (
                        <SelectItem key={outlet.id} value={outlet.id}>
                          {outlet.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Controller
                name="status"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Aktif</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="finance_group_note">Catatan Pos</Label>
            <Input id="finance_group_note" {...register("note")} placeholder="Opsional" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" /> : null}
              {isPending ? "Menyimpan..." : mode === "edit" ? "Simpan Koreksi" : "Simpan Pos"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FinanceTransactionFormDialog({ entry, financeGroup, isPending, mode = "create", onSubmit, open, onOpenChange, trigger }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const { control, formState, handleSubmit, register, reset } = useForm({ defaultValues: getTransactionDefaults(entry) });
  const selectedMovementType = useWatch({ control, name: "movement_type" });
  const movementHelp = getEntryMovementHelp(financeGroup?.account, selectedMovementType);

  useEffect(() => {
    if (isOpen) reset(getTransactionDefaults(entry));
  }, [entry, isOpen, reset]);

  async function submit(values) {
    await onSubmit({
      finance_group_id: financeGroup.id,
      amount: Number(values.amount || 0),
      entry_date: values.entry_date,
      movement_type: values.movement_type,
      note: values.note,
      status: values.status
    });
    setOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Koreksi Transaksi Keuangan" : "Tambah Transaksi Keuangan"}</DialogTitle>
          <DialogDescription>Transaksi baru dicatat dari Pos Keuangan ini. Koreksi hanya dipakai kalau salah input.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-5" onSubmit={handleSubmit(submit)}>
          <div className="grid gap-3 rounded-lg border bg-muted/15 p-4 text-sm">
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">Pos Keuangan</p>
                <p className="font-medium">{financeGroup?.name || "-"}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">Akun</p>
                <p className="font-medium">{formatEntryAccount(financeGroup)}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">Group Laporan</p>
                <p className="font-medium">{labelFromOptions(entryGroups, financeGroup?.group)}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">Outlet</p>
                <p className="font-medium">{financeGroup?.outlet?.name || "Global"}</p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="grid gap-2">
              <Label>Nominal</Label>
              <Controller
                name="amount"
                control={control}
                rules={{ validate: (value) => Number(value || 0) > 0 || "Nominal wajib lebih dari 0" }}
                render={({ field }) => <FormattedNumberInput value={field.value} onChange={field.onChange} placeholder="0" />}
              />
              {formState.errors.amount ? <p className="text-[11px] text-destructive">{formState.errors.amount.message}</p> : null}
            </div>
            <div className="grid gap-2">
              <Label>Arah Saldo</Label>
              <Controller
                name="movement_type"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {movementTypes.map((movement) => (
                        <SelectItem key={movement.value} value={movement.value}>
                          {movement.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="entry_date">Tanggal</Label>
              <Controller
                name="entry_date"
                control={control}
                rules={{ required: "Tanggal wajib diisi" }}
                render={({ field }) => <DatePicker id="entry_date" value={field.value} onChange={field.onChange} onBlur={field.onBlur} />}
              />
              {formState.errors.entry_date ? <p className="text-[11px] text-destructive">{formState.errors.entry_date.message}</p> : null}
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Controller
                name="status"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Aktif</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">Efek transaksi</p>
            <p className="mt-1">{movementHelp}</p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="note">Catatan</Label>
            <Input id="note" {...register("note")} placeholder="Opsional" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" /> : null}
              {isPending ? "Menyimpan..." : mode === "edit" ? "Simpan Koreksi" : "Simpan Transaksi"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FinanceTransactionRowActions({ canToggleStatus, canUpdate, entry, financeGroup }) {
  const [editOpen, setEditOpen] = useState(false);
  const updateEntry = useUpdateFinanceEntry();
  const toggleEntry = useToggleFinanceEntryStatus();
  const isInactive = entry.status === "inactive";

  return (
    <>
      <InlineRowActions>
        {canUpdate ? (
          <RowActionButton label={`Koreksi transaksi ${entry.name}`} onClick={() => setEditOpen(true)}>
            <Edit />
          </RowActionButton>
        ) : null}
        {canToggleStatus ? (
          <RowActionButton
            disabled={toggleEntry.isPending}
            label={toggleEntry.isPending ? "Memproses..." : isInactive ? `Aktifkan transaksi ${entry.name}` : `Nonaktifkan transaksi ${entry.name}`}
            onClick={() => toggleEntry.mutate(entry.id)}
          >
            {toggleEntry.isPending ? <Loader2 className="animate-spin" /> : isInactive ? <Power /> : <PowerOff />}
          </RowActionButton>
        ) : null}
      </InlineRowActions>

      <FinanceTransactionFormDialog
        mode="edit"
        entry={entry}
        financeGroup={financeGroup}
        open={editOpen}
        onOpenChange={setEditOpen}
        isPending={updateEntry.isPending}
        onSubmit={(values) => updateEntry.mutateAsync({ id: entry.id, payload: values })}
      />
    </>
  );
}

function FinanceGroupHistoryDialog({ canToggleStatus, canUpdate, financeGroup, open, onOpenChange }) {
  const transactions = [...(financeGroup?.transactions || [])].sort(
    (a, b) => String(b.entry_date || "").localeCompare(String(a.entry_date || "")) || String(b.id || "").localeCompare(String(a.id || ""))
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Histori Transaksi Pos Keuangan</DialogTitle>
          <DialogDescription>
            {financeGroup?.name || "-"} · {formatEntryAccount(financeGroup)} · {financeGroup?.outlet?.name || "Global"}
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/50 text-left text-[12px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Tanggal</th>
                <th className="px-3 py-2">Arah</th>
                <th className="px-3 py-2 text-right">Nominal</th>
                <th className="px-3 py-2">Catatan</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length ? (
                transactions.map((entry) => (
                  <tr key={entry.id} className="border-t">
                    <td className="px-3 py-2">{formatDate(entry.entry_date)}</td>
                    <td className="px-3 py-2">
                      <Badge variant={entry.movement_type === "out" ? "danger" : "success"}>{labelFromOptions(movementTypes, entry.movement_type || "in")}</Badge>
                    </td>
                    <td className={`px-3 py-2 text-right font-medium tabular-nums ${entry.movement_type === "out" ? "text-destructive" : "text-emerald-700"}`}>
                      {formatEntryEffectAmount(entry)}
                    </td>
                    <td className="px-3 py-2">{entry.note || "-"}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={entry.status} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <FinanceTransactionRowActions canUpdate={canUpdate} canToggleStatus={canToggleStatus} entry={entry} financeGroup={financeGroup} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    Belum ada transaksi untuk pos ini.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FinanceGroupRowActions({ canCreate, canToggleStatus, canUpdate, financeGroup, financialAccounts, outlets }) {
  const [transactionOpen, setTransactionOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const createEntry = useCreateFinanceEntry();
  const updateGroup = useUpdateFinanceEntryGroup();
  const toggleGroup = useToggleFinanceEntryGroupStatus();
  const isInactive = financeGroup.status === "inactive";

  return (
    <>
      <InlineRowActions>
        {canCreate ? (
          <RowActionButton disabled={isInactive} label={`Tambah transaksi ${financeGroup.name}`} onClick={() => setTransactionOpen(true)}>
            <Plus />
          </RowActionButton>
        ) : null}
        <RowActionButton label={`Lihat histori ${financeGroup.name}`} onClick={() => setHistoryOpen(true)}>
          <History />
        </RowActionButton>
        {canUpdate ? (
          <RowActionButton label={`Koreksi pos ${financeGroup.name}`} onClick={() => setEditOpen(true)}>
            <Edit />
          </RowActionButton>
        ) : null}
        {canToggleStatus ? (
          <RowActionButton
            disabled={toggleGroup.isPending}
            label={toggleGroup.isPending ? "Memproses..." : isInactive ? `Aktifkan pos ${financeGroup.name}` : `Nonaktifkan pos ${financeGroup.name}`}
            onClick={() => toggleGroup.mutate(financeGroup.id)}
          >
            {toggleGroup.isPending ? <Loader2 className="animate-spin" /> : isInactive ? <Power /> : <PowerOff />}
          </RowActionButton>
        ) : null}
      </InlineRowActions>

      <FinanceTransactionFormDialog
        financeGroup={financeGroup}
        open={transactionOpen}
        onOpenChange={setTransactionOpen}
        isPending={createEntry.isPending}
        onSubmit={(values) => createEntry.mutateAsync(values)}
      />
      <FinanceGroupHistoryDialog
        canUpdate={canUpdate}
        canToggleStatus={canToggleStatus}
        financeGroup={financeGroup}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
      <FinanceGroupFormDialog
        mode="edit"
        financeGroup={financeGroup}
        outlets={outlets}
        financialAccounts={financialAccounts}
        open={editOpen}
        onOpenChange={setEditOpen}
        isPending={updateGroup.isPending}
        onSubmit={(values) => updateGroup.mutateAsync({ id: financeGroup.id, payload: values })}
      />
    </>
  );
}

function FinanceGroupGuide() {
  const guides = [
    ["Other Income", "Pendapatan di luar penjualan utama. Contoh: bonus supplier, bunga bank, pendapatan lain-lain."],
    ["Other Expense", "Biaya di luar operasional utama. Contoh: perbaikan besar, denda, biaya tak terduga."],
    ["Other Current Asset", "Aset lancar selain kas dan stok. Contoh: deposit, piutang sementara, titipan dana."],
    ["Aset Tetap", "Aset jangka panjang. Contoh: kompor, freezer, renovasi, peralatan dapur."],
    ["Aset Bergerak", "Aset yang bisa dipindah. Contoh: motor operasional, kendaraan, perangkat kasir."],
    ["Hutang / Kewajiban", "Kewajiban yang belum dibayar. Contoh: hutang supplier di luar pembelian bon."],
    ["Equity / Modal", "Modal pemilik atau laba ditahan yang dipakai di bagian Equity Neraca."],
    ["Dana Cadangan", "Pilih akun [1431] Dana Cadangan di Entry Keuangan. Bertambah menambah saldo Neraca, Berkurang mengurangi saldo."]
  ];

  return (
    <section className="rounded-lg border bg-card p-4 shadow-soft">
      <div className="mb-3">
        <h2 className="text-[15px] font-semibold">Panduan Group Finance</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">Pilih group berdasarkan dampaknya ke laporan. Halaman ini untuk transaksi tambahan di luar POS, pembelian, dan pengeluaran rutin.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {guides.map(([title, description]) => (
          <div key={title} className="rounded-md border bg-muted/20 p-3 text-[12px]">
            <p className="font-semibold">{title}</p>
            <p className="mt-1 leading-relaxed text-muted-foreground">{description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function FinanceEntriesPage() {
  const { financeEntryGroups, financialAccounts, isFetching, isLoading, outlets, session } = useFinancePageData();
  const createGroup = useCreateFinanceEntryGroup();
  const canCreate = can(session, "finance.entries", "create");
  const canUpdate = can(session, "finance.entries", "update");
  const canToggle = can(session, "finance.entries", "toggle_status");
  const rows = financeEntryGroups;

  return (
    <div className="space-y-4">
      <FinanceGroupGuide />
      <section className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm shadow-soft">
        <p className="font-semibold text-foreground">Entry Keuangan memakai Pos Keuangan.</p>
        <p className="mt-1 text-muted-foreground">
          Buat Pos Keuangan dulu, lalu tambah transaksi masuk/keluar dari pos tersebut. Contoh: Dana Gaji Karyawan punya transaksi bertambah dan berkurang sendiri.
        </p>
        <p className="mt-2 text-muted-foreground">Koreksi transaksi hanya untuk salah input, bukan untuk transaksi baru.</p>
      </section>
      <DataTable
        title="Pos Keuangan"
        description="Row utama berisi pos dana/keuangan. Transaksi masuk/keluar ditambahkan dari aksi tiap row."
        data={rows}
        isFetching={isFetching}
        isLoading={isLoading}
        searchKeys={["name", "group", "account_code", "account.name", "outlet.name", "note", "status"]}
        actions={
          canCreate ? (
            <FinanceGroupFormDialog
              outlets={outlets}
              financialAccounts={financialAccounts}
              isPending={createGroup.isPending}
              onSubmit={(values) => createGroup.mutateAsync(values)}
              trigger={
                <Button disabled={createGroup.isPending || !financialAccounts.length}>
                  {createGroup.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                  {createGroup.isPending ? "Menyimpan..." : "Tambah Pos Keuangan"}
                </Button>
              }
            />
          ) : null
        }
        columns={[
          { key: "name", label: "Nama Pos", className: "font-medium" },
          { key: "account_code", label: "Akun", render: (row) => formatEntryAccount(row) },
          { key: "group", label: "Group Laporan", render: (row) => labelFromOptions(entryGroups, row.group) },
          { key: "outlet", label: "Outlet", render: (row) => row.outlet?.name || "Global" },
          { key: "total_in", label: "Total Masuk", render: (row) => formatCurrency(row.total_in || 0), className: "text-right tabular-nums" },
          { key: "total_out", label: "Total Keluar", render: (row) => formatCurrency(row.total_out || 0), className: "text-right tabular-nums" },
          {
            key: "balance",
            label: "Saldo",
            render: (row) => <span className={Number(row.balance || 0) < 0 ? "font-semibold text-destructive" : "font-semibold"}>{formatCurrency(row.balance || 0)}</span>,
            className: "text-right tabular-nums"
          },
          { key: "transaction_count", label: "Transaksi", render: (row) => <Badge variant="outline">{row.transaction_count || 0}</Badge> },
          { key: "last_transaction", label: "Terakhir", render: (row) => (row.last_transaction ? formatDate(row.last_transaction.entry_date) : "-") },
          { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
          {
            key: "actions",
            label: "Aksi",
            render: (row) => (
              <FinanceGroupRowActions
                financeGroup={row}
                outlets={outlets}
                financialAccounts={financialAccounts}
                canCreate={canCreate}
                canUpdate={canUpdate}
                canToggleStatus={canToggle}
              />
            ),
            className: "text-right whitespace-nowrap",
            headerClassName: "text-right"
          }
        ]}
      />
    </div>
  );
}

export { FinancialAccountsPage, FinanceEntriesPage };
