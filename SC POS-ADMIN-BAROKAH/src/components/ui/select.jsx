import React, { useMemo, useState } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

const Select = SelectPrimitive.Root;
const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "focus-ring flex h-9 w-full items-center justify-between rounded-md border border-input bg-card px-3 py-2 text-[12px] shadow-sm disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-60" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

function getSelectItemText(child) {
  if (child === null || child === undefined || typeof child === "boolean") return "";
  if (typeof child === "string" || typeof child === "number") return String(child);
  if (Array.isArray(child)) return child.map(getSelectItemText).join(" ");
  if (React.isValidElement(child)) {
    return `${child.props?.value || ""} ${getSelectItemText(child.props?.children)}`;
  }
  return "";
}

function flattenSelectChildren(children) {
  return React.Children.toArray(children).flatMap((child) => {
    if (React.isValidElement(child) && child.type === React.Fragment) {
      return flattenSelectChildren(child.props.children);
    }
    return child;
  });
}

const SelectContent = React.forwardRef(
  (
    {
      className,
      children,
      position = "popper",
      searchable,
      searchPlaceholder = "Cari pilihan",
      searchThreshold = 3,
      ...props
    },
    ref
  ) => {
    const [search, setSearch] = useState("");
    const items = useMemo(() => flattenSelectChildren(children).filter(Boolean), [children]);
    const shouldShowSearch = searchable ?? items.length >= searchThreshold;
    const normalizedSearch = search.trim().toLowerCase();
    const visibleItems = useMemo(() => {
      if (!shouldShowSearch || !normalizedSearch) return items;
      return items.filter((item) => getSelectItemText(item).toLowerCase().includes(normalizedSearch));
    }, [items, normalizedSearch, shouldShowSearch]);

    return (
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          ref={ref}
          className={cn(
            "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-card text-card-foreground shadow-lg",
            position === "popper" && "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
            className
          )}
          position={position}
          {...props}
        >
          {shouldShowSearch ? (
            <div className="border-b p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                  placeholder={searchPlaceholder}
                  className="focus-ring h-8 w-full rounded-md border border-input bg-card py-1 pl-8 pr-2 text-[12px] outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>
          ) : null}
          <SelectPrimitive.Viewport className={cn("max-h-72 overflow-y-auto p-1", position === "popper" && "w-full min-w-[var(--radix-select-trigger-width)]")}>
            {visibleItems.length ? visibleItems : <div className="px-3 py-4 text-center text-[12px] text-muted-foreground">Tidak ditemukan.</div>}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    );
  }
);
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectItem = React.forwardRef(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-[12px] outline-none focus:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
