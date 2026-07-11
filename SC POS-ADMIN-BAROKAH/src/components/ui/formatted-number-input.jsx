import React from "react";
import { Input } from "@/components/ui/input";
import { formatThousands, parseThousands } from "@/lib/utils";

const FormattedNumberInput = React.forwardRef(
  ({ value, onChange, onBlur, onFocus, allowDecimal = false, placeholder, ...props }, ref) => {
    const [focused, setFocused] = React.useState(false);
    const [draftValue, setDraftValue] = React.useState("");
    const displayValue = formatThousands(value, { allowDecimal });

    function handleChange(event) {
      const nextValue = event.target.value;
      const parsed = parseThousands(nextValue, { allowDecimal });
      setDraftValue(allowDecimal ? nextValue : formatThousands(parsed));
      onChange?.(parsed);
    }

    function handleFocus(event) {
      setFocused(true);
      setDraftValue(event.target.value);
      onFocus?.(event);
    }

    function handleBlur(event) {
      setFocused(false);
      setDraftValue("");
      onBlur?.(event);
    }

    return (
      <Input
        ref={ref}
        type="text"
        inputMode={allowDecimal ? "decimal" : "numeric"}
        value={focused ? draftValue : displayValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        {...props}
      />
    );
  }
);

FormattedNumberInput.displayName = "FormattedNumberInput";

export { FormattedNumberInput };
