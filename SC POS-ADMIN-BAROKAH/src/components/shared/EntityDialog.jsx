import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormattedNumberInput } from "@/components/ui/formatted-number-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function EntityDialog({ title, description, fields = [], submitLabel = "Simpan", onSubmit, triggerLabel = "Tambah" }) {
  const [open, setOpen] = useState(false);
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty }
  } = useForm();

  async function submit(values) {
    await onSubmit(values);
    reset();
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={handleSubmit(submit)}>
          {fields.map((field) => (
            <div key={field.name} className="space-y-1.5">
              <Label htmlFor={field.name}>{field.label}</Label>
              {field.format === "thousand" ? (
                <Controller
                  name={field.name}
                  control={control}
                  rules={{
                    required: field.required ? `${field.label} wajib diisi` : false,
                    min: field.min ? { value: field.min, message: `${field.label} minimal ${field.min}` } : undefined
                  }}
                  render={({ field: controllerField }) => (
                    <FormattedNumberInput
                      id={field.name}
                      placeholder={field.placeholder}
                      allowDecimal={field.allowDecimal}
                      value={controllerField.value}
                      onChange={controllerField.onChange}
                      onBlur={controllerField.onBlur}
                      name={controllerField.name}
                      ref={controllerField.ref}
                    />
                  )}
                />
              ) : field.type === "date" || field.component === "datepicker" ? (
                <Controller
                  name={field.name}
                  control={control}
                  rules={{
                    required: field.required ? `${field.label} wajib diisi` : false
                  }}
                  render={({ field: controllerField }) => (
                    <DatePicker
                      id={field.name}
                      placeholder={field.placeholder}
                      value={controllerField.value}
                      onChange={controllerField.onChange}
                      onBlur={controllerField.onBlur}
                      name={controllerField.name}
                    />
                  )}
                />
              ) : (
                <Input
                  id={field.name}
                  type={field.type || "text"}
                  placeholder={field.placeholder}
                  {...register(field.name, {
                    required: field.required ? `${field.label} wajib diisi` : false,
                    min: field.min ? { value: field.min, message: `${field.label} minimal ${field.min}` } : undefined
                  })}
                />
              )}
              {errors[field.name] ? <p className="text-[11px] text-destructive">{errors[field.name].message}</p> : null}
            </div>
          ))}
          {isDirty ? <p className="text-[11px] text-muted-foreground">Perubahan belum disimpan.</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Menyimpan..." : submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { EntityDialog };
