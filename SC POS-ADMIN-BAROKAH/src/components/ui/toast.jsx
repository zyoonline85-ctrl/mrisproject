import React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { create } from "zustand";
import { cn } from "@/lib/utils";

const useToastStore = create((set) => ({
  toasts: [],
  toast: (toast) =>
    set((state) => ({
      toasts: [
        ...state.toasts,
        {
          id: crypto.randomUUID(),
          variant: "default",
          ...toast
        }
      ]
    })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
}));

function useToast() {
  return useToastStore((state) => state.toast);
}

function Toaster() {
  const { toasts, dismiss } = useToastStore();

  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {toasts.map((toast) => (
        <ToastPrimitive.Root
          key={toast.id}
          open
          duration={toast.duration || 3200}
          onOpenChange={(open) => {
            if (!open) dismiss(toast.id);
          }}
          className={cn(
            "grid grid-cols-[1fr_auto] gap-2 rounded-lg border bg-card p-3 text-card-foreground shadow-soft",
            toast.variant === "success" && "border-[#7DA78C]/40",
            toast.variant === "destructive" && "border-[#C75353]/40"
          )}
        >
          <div className="space-y-1">
            <ToastPrimitive.Title className="text-[12px] font-semibold">{toast.title}</ToastPrimitive.Title>
            {toast.description ? (
              <ToastPrimitive.Description className="text-[11px] text-muted-foreground">{toast.description}</ToastPrimitive.Description>
            ) : null}
          </div>
          <ToastPrimitive.Close className="focus-ring rounded-md p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[100] flex w-[320px] max-w-[calc(100vw-2rem)] flex-col gap-2" />
    </ToastPrimitive.Provider>
  );
}

export { Toaster, useToast };
