import React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef(({ className, type = "text", ...props }, ref) => (
  <input
    type={type}
    className={cn(
      "focus-ring flex h-9 w-full rounded-md border border-input bg-card px-3 py-2 text-[12px] text-foreground shadow-sm placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:bg-[#EDF1F5] disabled:text-[#8A97A3]",
      className
    )}
    ref={ref}
    {...props}
  />
));

Input.displayName = "Input";

export { Input };
