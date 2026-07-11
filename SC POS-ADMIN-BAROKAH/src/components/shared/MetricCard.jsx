import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function MetricCard({ title, value, description, icon: Icon, tone = "primary" }) {
  const tones = {
    primary: "bg-primary/10 text-primary",
    green: "bg-[#7DA78C]/15 text-[#52775F]",
    gold: "bg-[#C2A56D]/20 text-[#8B6E2E]",
    blue: "bg-[#547A95]/15 text-[#547A95]",
    danger: "bg-[#C75353]/15 text-[#B94949]"
  };

  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium uppercase text-muted-foreground">{title}</p>
          <p className="mt-2 truncate text-[20px] font-semibold">{value}</p>
          {description ? <p className="mt-1 truncate text-[11px] text-muted-foreground">{description}</p> : null}
        </div>
        {Icon ? (
          <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-md", tones[tone])}>
            <Icon className="h-4 w-4" />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export { MetricCard };
