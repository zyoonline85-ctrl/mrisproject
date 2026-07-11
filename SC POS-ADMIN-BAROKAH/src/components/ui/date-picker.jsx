import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn, formatDate, parseDateString, toDateString } from "@/lib/utils";

function DatePicker({ value, onChange, placeholder = "Pilih tanggal", disabled, className, id, name, onBlur }) {
  const [open, setOpen] = useState(false);
  const selectedDate = parseDateString(value);

  function handleSelect(date) {
    onChange?.(toDateString(date));
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          name={name}
          type="button"
          variant="outline"
          disabled={disabled}
          onBlur={onBlur}
          className={cn("h-9 w-full justify-start gap-2 text-left font-normal", !selectedDate && "text-muted-foreground", className)}
        >
          <CalendarIcon className="h-4 w-4" />
          <span className="truncate">{selectedDate ? formatDate(toDateString(selectedDate)) : placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-3" align="start">
        <Calendar mode="single" selected={selectedDate} onSelect={handleSelect} initialFocus />
      </PopoverContent>
    </Popover>
  );
}

export { DatePicker };
