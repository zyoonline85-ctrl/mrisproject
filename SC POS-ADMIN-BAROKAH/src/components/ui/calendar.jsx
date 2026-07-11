import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { id } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

function Calendar({ className, classNames, showOutsideDays = true, ...props }) {
  return (
    <DayPicker
      locale={id}
      showOutsideDays={showOutsideDays}
      className={cn("w-full p-0 text-[12px]", className)}
      classNames={{
        months: "flex flex-col",
        month: "space-y-3",
        caption: "pointer-events-none relative flex h-11 items-center justify-center px-12",
        month_caption: "pointer-events-none relative flex h-11 items-center justify-center px-12",
        caption_label: "pointer-events-none text-[14px] font-semibold",
        nav: "pointer-events-none absolute inset-x-1 top-1 z-20 flex items-center justify-between",
        button_previous: cn(buttonVariants({ variant: "outline", size: "icon" }), "pointer-events-auto h-9 w-9 rounded-lg bg-card p-0 opacity-85 hover:opacity-100"),
        button_next: cn(buttonVariants({ variant: "outline", size: "icon" }), "pointer-events-auto h-9 w-9 rounded-lg bg-card p-0 opacity-85 hover:opacity-100"),
        month_grid: "w-full border-collapse space-y-1",
        weekdays: "flex w-full gap-1",
        weekday: "flex-1 rounded-md text-center text-[11px] font-medium leading-8 text-muted-foreground",
        week: "mt-1 flex w-full gap-1",
        day: "relative flex h-9 flex-1 items-center justify-center p-0 text-center text-[12px]",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 rounded-md p-0 font-normal aria-selected:opacity-100"
        ),
        selected: "rounded-md bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        today: "rounded-md bg-[#C2D099]/45 text-foreground",
        outside: "text-muted-foreground opacity-40",
        disabled: "text-muted-foreground opacity-40",
        range_middle: "aria-selected:bg-muted aria-selected:text-foreground",
        hidden: "invisible",
        ...classNames
      }}
      components={{
        Chevron: ({ orientation }) => (orientation === "left" ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />)
      }}
      {...props}
    />
  );
}

Calendar.displayName = "Calendar";

export { Calendar };
