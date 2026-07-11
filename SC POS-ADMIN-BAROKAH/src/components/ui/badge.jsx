import React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold", {
  variants: {
    variant: {
      default: "border-primary/25 bg-primary/10 text-primary",
      success: "border-[#7DA78C]/40 bg-[#7DA78C]/20 text-[#315A3D]",
      warning: "border-[#C2A56D]/40 bg-[#C2A56D]/20 text-[#755414]",
      danger: "border-[#C75353]/40 bg-[#C75353]/15 text-[#A33636]",
      info: "border-[#547A95]/40 bg-[#547A95]/15 text-[#335C78]",
      muted: "border-border bg-muted text-foreground/75",
      outline: "border border-border bg-card text-foreground"
    }
  },
  defaultVariants: {
    variant: "default"
  }
});

function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
