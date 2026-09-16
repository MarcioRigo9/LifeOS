"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

function SheetOverlay({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-[var(--animate-in)] data-[state=closed]:opacity-0",
        className
      )}
      {...props}
    />
  );
}

/**
 * Bottom Sheet everywhere — the explicit mobile-first modal format this app requires. On wider
 * screens it becomes a floating panel anchored near the bottom-center rather than a full-width
 * edge sheet, but never a classic centered dialog: the interaction pattern (slide up, drag
 * handle, close by swipe-down affordance) stays consistent across breakpoints.
 */
export function SheetContent({
  className,
  children,
  showHandle = true,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { showHandle?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <SheetOverlay />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col gap-4 rounded-t-2xl border-t border-border bg-card p-5 shadow-2xl",
          "sm:inset-x-auto sm:left-1/2 sm:bottom-6 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl sm:border",
          "data-[state=open]:animate-[var(--animate-in)]",
          "safe-bottom overflow-y-auto",
          className
        )}
        {...props}
      >
        {showHandle && <div className="mx-auto -mt-1 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/25 sm:hidden" />}
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="size-4" />
          <span className="sr-only">Fechar</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 text-left", className)} {...props} />;
}

export function SheetTitle({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-lg font-semibold", className)} {...props} />;
}

export function SheetDescription({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-2 pt-1 sm:flex-row sm:justify-end", className)} {...props} />;
}
