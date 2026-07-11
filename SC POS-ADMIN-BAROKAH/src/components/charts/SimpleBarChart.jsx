import { formatCurrency, formatDate } from "@/lib/utils";

function formatAxisValue(value) {
  if (value >= 1000000) return `Rp ${Math.round(value / 1000000)} jt`;
  if (value >= 1000) return `Rp ${Math.round(value / 1000)} rb`;
  return `Rp ${value}`;
}

function SimpleBarChart({ data = [], valueKey = "total", labelKey = "date", height = 180 }) {
  const rows = data.map((item) => ({
    ...item,
    chartValue: Number(item[valueKey] || 0)
  }));
  const max = Math.max(...rows.map((item) => item.chartValue), 1);
  const barAreaHeight = Math.max(height - 26, 80);
  const tickCount = 4;
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) => Math.round((max * (tickCount - index)) / tickCount));

  if (!rows.length) {
    return (
      <div className="flex w-full items-center justify-center rounded-md bg-muted/45 text-[12px] text-muted-foreground" style={{ height }}>
        Belum ada data chart
      </div>
    );
  }

  return (
    <div className="w-full" style={{ height }}>
      <div className="flex w-full gap-2" style={{ height: barAreaHeight }}>
        <div className="flex w-14 shrink-0 flex-col justify-between text-right text-[10px] leading-none text-muted-foreground">
          {ticks.map((tick) => (
            <span key={tick}>{formatAxisValue(tick)}</span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="absolute inset-0 flex flex-col justify-between">
            {ticks.map((tick) => (
              <div key={tick} className="border-t border-dashed border-border/80 first:border-solid" />
            ))}
          </div>
          <div className="relative z-10 flex h-full w-full items-end gap-1.5">
            {rows.map((item) => {
              const value = item.chartValue;
              const pct = value > 0 ? Math.max((value / max) * 100, 6) : 0;
              return (
                <div key={item[labelKey]} className="flex h-full min-w-0 flex-1 items-end">
                  <div className="flex h-full w-full items-end overflow-hidden rounded-md bg-muted/70">
                    <div
                      className="w-full rounded-t-md bg-primary transition-all duration-300"
                      style={{ height: `${pct}%` }}
                      title={`${formatDate(item[labelKey])}: ${formatCurrency(value)}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-2 flex w-full gap-2">
        <div className="w-14 shrink-0" />
        <div className="flex min-w-0 flex-1 gap-1.5">
          {rows.map((item) => (
            <span key={item[labelKey]} className="min-w-0 flex-1 truncate text-center text-[10px] text-muted-foreground">
              {String(item[labelKey]).slice(8, 10)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export { SimpleBarChart };
