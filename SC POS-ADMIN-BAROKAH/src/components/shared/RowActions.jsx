import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { recordActivity } from "@/lib/activityAudit";

function RowActionButton({ children, className = "", disabled = false, label, onClick, variant = "ghost" }) {
  function handleClick(event) {
    const isReadAction = /^(detail|lihat|buka|histori)/i.test(label || "");
    if (isReadAction) {
      recordActivity({ module: "navigation", action: "detail_open", description: label, metadata: { label } });
    }
    return onClick?.(event);
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className={`h-8 w-8 shrink-0 ${className}`}
          disabled={disabled}
          onClick={handleClick}
          size="icon"
          type="button"
          variant={variant}
        >
          {children}
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function InlineRowActions({ children }) {
  return (
    <div className="flex items-center justify-end gap-1 whitespace-nowrap">
      {children}
    </div>
  );
}

export { InlineRowActions, RowActionButton };
