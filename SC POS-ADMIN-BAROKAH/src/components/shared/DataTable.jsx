import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, includesText } from "@/lib/utils";

function getSearchValue(row, key) {
  return key.split(".").reduce((value, part) => {
    if (Array.isArray(value)) {
      return value.map((item) => item?.[part]).filter((item) => item !== undefined && item !== null).join(" ");
    }
    return value?.[part];
  }, row);
}

function DataTable({
  title,
  description,
  data = [],
  columns = [],
  searchKeys = [],
  isFetching,
  isLoading,
  actions,
  emptyText = "Belum ada data.",
  pageSize = 8
}) {
  const [keyword, setKeyword] = useState("");
  const [sortKey, setSortKey] = useState(columns[0]?.key);
  const [sortDirection, setSortDirection] = useState("asc");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const rows = data.filter((row) => {
      if (!keyword) return true;
      const haystack = searchKeys.length
        ? searchKeys.map((key) => getSearchValue(row, key)).join(" ")
        : JSON.stringify(row);
      return includesText(haystack, keyword);
    });

    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const column = columns.find((item) => item.key === sortKey);
      const getValue = column?.sortValue || ((row) => row[sortKey]);
      const av = getValue(a);
      const bv = getValue(b);
      const result = String(av ?? "").localeCompare(String(bv ?? ""), "id-ID", { numeric: true });
      return sortDirection === "asc" ? result : -result;
    });
  }, [columns, data, keyword, searchKeys, sortDirection, sortKey]);

  const totalPages = Math.max(Math.ceil(filtered.length / pageSize), 1);
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  }

  return (
    <section className="relative rounded-lg border bg-card shadow-soft">
      {!isLoading && isFetching ? (
        <div className="absolute right-4 top-4 z-10 inline-flex items-center gap-2 rounded-md border bg-card/95 px-3 py-1.5 text-[12px] font-medium text-muted-foreground shadow-soft">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          Memuat ulang...
        </div>
      ) : null}
      <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold">{title}</h2>
          {description ? <p className="mt-1 text-[12px] text-muted-foreground">{description}</p> : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value);
                setPage(1);
              }}
              className="w-full pl-8 sm:w-56"
              placeholder="Cari data"
            />
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex min-h-40 items-center justify-center p-6 text-[12px] text-muted-foreground">{emptyText}</div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column.key} className={cn(column.headerClassName)}>
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort(column.key)}>
                      {column.label}
                      <ChevronsUpDown className="h-3 w-3 opacity-50" />
                    </button>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((row) => (
                <TableRow key={row.id}>
                  {columns.map((column) => (
                    <TableCell key={column.key} className={cn(column.className)}>
                      {column.render ? column.render(row) : row[column.key]}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-col gap-2 border-t px-4 py-3 text-[12px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              Menampilkan {paged.length} dari {filtered.length} data
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" disabled={safePage === 1} onClick={() => setPage((value) => Math.max(value - 1, 1))}>
                <ChevronLeft />
                <span className="sr-only">Halaman sebelumnya</span>
              </Button>
              <span>
                {safePage} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                disabled={safePage === totalPages}
                onClick={() => setPage((value) => Math.min(value + 1, totalPages))}
              >
                <ChevronRight />
                <span className="sr-only">Halaman berikutnya</span>
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export { DataTable };
