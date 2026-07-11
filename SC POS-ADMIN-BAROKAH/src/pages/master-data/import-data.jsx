import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Download, FileCheck2, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { adminApi } from "@/lib/adminApi";
import { cn } from "@/lib/utils";

const statusLabels = {
  create: "Create",
  update: "Update",
  skip: "Skip",
  error: "Error"
};

const statusVariants = {
  create: "success",
  update: "info",
  skip: "muted",
  error: "danger"
};

const maxImportFileSize = 6 * 1024 * 1024;

function downloadBlob(blob, filename) {
  const url = globalThis.URL.createObjectURL(blob);
  const link = globalThis.document.createElement("a");
  link.href = url;
  link.download = filename;
  globalThis.document.body.appendChild(link);
  link.click();
  link.remove();
  globalThis.URL.revokeObjectURL(url);
}

function SummaryCard({ label, value, tone = "default" }) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-soft">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-2 text-[24px] font-semibold",
          tone === "danger" && "text-destructive",
          tone === "success" && "text-[#52775F]",
          tone === "info" && "text-primary"
        )}
      >
        {value || 0}
      </p>
    </div>
  );
}

function ImportRowsTable({ rows = [] }) {
  if (!rows.length) {
    return <div className="rounded-lg border bg-muted/30 p-6 text-center text-[12px] text-muted-foreground">Sheet ini belum punya row import.</div>;
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="max-h-[460px] overflow-auto">
        <table className="w-full min-w-[920px] border-collapse text-[12px]">
          <thead className="sticky top-0 bg-muted text-left text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="border-b px-3 py-2">Row</th>
              <th className="border-b px-3 py-2">Status</th>
              <th className="border-b px-3 py-2">Pesan</th>
              <th className="border-b px-3 py-2">Data</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b last:border-b-0">
                <td className="w-20 px-3 py-2 font-medium">{row.row_number}</td>
                <td className="w-28 px-3 py-2">
                  <Badge variant={statusVariants[row.status] || "outline"}>{statusLabels[row.status] || row.status}</Badge>
                </td>
                <td className={cn("px-3 py-2", row.status === "error" && "font-medium text-destructive")}>{row.message}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {Object.entries(row.values || {})
                    .filter(([, value]) => value !== undefined && value !== null && value !== "")
                    .map(([key, value]) => `${key}: ${value}`)
                    .join(" | ") || "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ImportDataPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [preview, setPreview] = useState(null);

  const rowsBySheet = useMemo(() => {
    return (preview?.rows || []).reduce((result, row) => {
      result[row.sheet_key] = result[row.sheet_key] || [];
      result[row.sheet_key].push(row);
      return result;
    }, {});
  }, [preview?.rows]);

  const downloadTemplate = useMutation({
    mutationFn: adminApi.downloadMasterImportTemplate,
    onSuccess: (blob) => {
      downloadBlob(blob, "template-import-master-data-barokah.xlsx");
      toast({ title: "Template didownload", description: "Isi file XLSX sesuai sheet yang tersedia.", variant: "success" });
    },
    onError: (error) => {
      toast({ title: "Gagal download template", description: error.message, variant: "destructive" });
    }
  });

  const previewImport = useMutation({
    mutationFn: adminApi.previewMasterImport,
    onSuccess: (result) => {
      setPreview(result);
      toast({
        title: result.can_commit ? "Preview siap" : "Preview perlu diperbaiki",
        description: result.can_commit ? "Tidak ada error. File bisa di-commit." : `${result.summary?.error || 0} row masih error.`,
        variant: result.can_commit ? "success" : "destructive"
      });
    },
    onError: (error) => {
      toast({ title: "Gagal preview import", description: error.message, variant: "destructive" });
    }
  });

  const commitImport = useMutation({
    mutationFn: adminApi.commitMasterImport,
    onSuccess: (result) => {
      setPreview(result);
      queryClient.invalidateQueries({ queryKey: ["master-data"] });
      queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["mobile-catalog"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
      toast({ title: "Import berhasil", description: "Data master sudah diproses dan disimpan.", variant: "success" });
    },
    onError: (error) => {
      toast({ title: "Gagal commit import", description: error.message, variant: "destructive" });
    }
  });

  function selectFile(nextFile) {
    if (!nextFile) return;

    if (!nextFile.name.toLowerCase().endsWith(".xlsx")) {
      toast({ title: "Format file tidak sesuai", description: "Gunakan file XLSX dari template import.", variant: "destructive" });
      return;
    }

    if (nextFile.size > maxImportFileSize) {
      toast({ title: "File terlalu besar", description: "Maksimal ukuran file import adalah 6MB.", variant: "destructive" });
      return;
    }

    setFile(nextFile);
    setPreview(null);
  }

  function handleFileChange(event) {
    selectFile(event.target.files?.[0] || null);
    event.target.value = "";
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragActive(false);
    selectFile(event.dataTransfer.files?.[0] || null);
  }

  function handleDragOver(event) {
    event.preventDefault();
    setIsDragActive(true);
  }

  function handleDragLeave(event) {
    event.preventDefault();
    setIsDragActive(false);
  }

  function handleDropzoneKeyDown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInputRef.current?.click();
    }
  }

  function clearFile(event) {
    event.stopPropagation();
    setFile(null);
    setPreview(null);
  }

  const fileSizeLabel = file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "";
  function handlePreview() {
    if (!file) {
      toast({ title: "File belum dipilih", description: "Pilih file XLSX import terlebih dahulu.", variant: "destructive" });
      return;
    }
    previewImport.mutate(file);
  }

  function handleCommit() {
    if (!file || !preview?.can_commit) return;
    commitImport.mutate(file);
  }

  const firstSheetKey = preview?.sheets?.find((sheet) => sheet.row_count > 0)?.key || preview?.sheets?.[0]?.key;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border bg-card p-4 shadow-soft">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[13px] text-muted-foreground">Admin Panel / Import Data</p>
            <h1 className="mt-1 text-[20px] font-semibold">Import Data Master</h1>
            <p className="mt-2 max-w-3xl text-[12px] text-muted-foreground">
              Template ini untuk import Produk dan Harga Pokok Produksi. Kategori, satuan, dan referensi lain diambil dari sheet REF. Copy ID dari
              sheet REF ke sheet input. Produk baru boleh kosong SKU karena backend membuat otomatis.
            </p>
          </div>
          <Button variant="outline" onClick={() => downloadTemplate.mutate()} disabled={downloadTemplate.isPending}>
            {downloadTemplate.isPending ? <Loader2 className="animate-spin" /> : <Download />}
            Download Template XLSX
          </Button>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4 shadow-soft">
        <div className="grid gap-4 xl:grid-cols-[1fr_auto] xl:items-end">
          <div>
            <label className="text-[12px] font-medium">File Import XLSX</label>
            <Input ref={fileInputRef} className="hidden" type="file" accept=".xlsx" onChange={handleFileChange} />
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={handleDropzoneKeyDown}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={cn(
                "mt-2 flex w-full items-center gap-4 rounded-lg border border-dashed bg-muted/20 p-4 text-left transition",
                "hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isDragActive && "border-primary bg-primary/10",
                file && "border-primary/40 bg-card"
              )}
            >
              <span
                className={cn(
                  "flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground",
                  file && "border-primary/30 bg-primary/10 text-primary"
                )}
              >
                {file ? <FileCheck2 className="h-7 w-7" /> : <FileSpreadsheet className="h-7 w-7" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold">{file ? file.name : "Tarik file XLSX ke sini"}</span>
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  {file ? `${fileSizeLabel} · Siap dipreview sebelum disimpan` : "Atau klik area ini untuk memilih file dari komputer."}
                </span>
                <span className="mt-2 block text-[11px] text-muted-foreground">
                  Gunakan sheet Produk atau Harga Pokok Produksi. Ambil category_id dari sheet REF Kategori Produk/REF Kategori HPP. Maksimal 6MB.
                </span>
              </span>
              {file ? (
                <Button variant="ghost" size="icon" className="shrink-0" onClick={clearFile} aria-label="Hapus file import">
                  <X />
                </Button>
              ) : (
                <span className="hidden rounded-md border bg-background px-3 py-2 text-[12px] font-medium text-foreground shadow-sm sm:inline-flex">
                  Pilih File
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" disabled={!file || previewImport.isPending || commitImport.isPending} onClick={handlePreview}>
              {previewImport.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
              Preview Import
            </Button>
            <Button disabled={!file || !preview?.can_commit || commitImport.isPending} onClick={handleCommit}>
              {commitImport.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
              Commit Import
            </Button>
          </div>
        </div>
      </section>

      {preview ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryCard label="Total Row" value={preview.summary?.total} />
            <SummaryCard label="Create" value={preview.summary?.create} tone="success" />
            <SummaryCard label="Update" value={preview.summary?.update} tone="info" />
            <SummaryCard label="Skip" value={preview.summary?.skip} />
            <SummaryCard label="Error" value={preview.summary?.error} tone="danger" />
          </div>

          <section className="rounded-lg border bg-card shadow-soft">
            <div className="flex flex-col gap-2 border-b p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-[15px] font-semibold">Preview Import</h2>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  {preview.can_commit ? "Tidak ada error. Commit akan menjalankan upsert aman." : "Perbaiki row error sebelum commit import."}
                </p>
              </div>
              <Badge variant={preview.can_commit ? "success" : "danger"} className="w-fit">
                {preview.can_commit ? "Siap Commit" : "Masih Ada Error"}
              </Badge>
            </div>

            {preview.summary?.error ? (
              <div className="m-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-[12px] text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>Ada {preview.summary.error} row error. Import tidak akan disimpan sampai file diperbaiki dan preview ulang.</p>
              </div>
            ) : null}

            <Tabs defaultValue={firstSheetKey} className="p-4">
              <TabsList className="h-auto max-w-full flex-wrap justify-start">
                {preview.sheets
                  ?.filter((sheet) => sheet.row_count > 0)
                  .map((sheet) => (
                    <TabsTrigger key={sheet.key} value={sheet.key}>
                      {sheet.name} ({sheet.row_count})
                    </TabsTrigger>
                  ))}
              </TabsList>
              {preview.sheets
                ?.filter((sheet) => sheet.row_count > 0)
                .map((sheet) => (
                  <TabsContent key={sheet.key} value={sheet.key}>
                    <ImportRowsTable rows={rowsBySheet[sheet.key] || []} />
                  </TabsContent>
                ))}
              {!preview.sheets?.some((sheet) => sheet.row_count > 0) ? (
                <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border bg-muted/30 p-6 text-center text-[12px] text-muted-foreground">
                  <FileSpreadsheet className="mb-2 h-8 w-8" />
                  File belum memiliki row import pada sheet yang dikenali.
                </div>
              ) : null}
            </Tabs>
          </section>
        </>
      ) : null}
    </div>
  );
}
