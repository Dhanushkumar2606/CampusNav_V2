/**
 * BottomSheet — draggable mobile bottom sheet built on framer-motion.
 * Drag the handle to dismiss; backdrop tap closes. Reduced-motion aware
 * (framer-motion respects it via `useReducedMotion`).
 */
import * as React from "react";
import { motion, useReducedMotion, useMotionValue, useTransform, animate } from "framer-motion";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Height class for the sheet body (default: 60vh). */
  className?: string;
  /** Render inside the app container instead of a portal (e.g. map overlays). */
  portal?: boolean;
}

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  className,
  portal = true,
}: BottomSheetProps) {
  // When closed this portal used to render a transparent `absolute inset-0`
  // layer over the whole app — an invisible wall that swallowed every
  // button click. Unmount fully instead (the `exit` animation had no
  // AnimatePresence to run under anyway).
  const reduceMotion = useReducedMotion();
  const dragY = useMotionValue(0);
  const opacity = useTransform(dragY, [0, 200], [1, 0]);
  const sheetRef = React.useRef<HTMLDivElement | null>(null);

  // Escape closes the sheet; while open, Tab is trapped inside so keyboard
  // users can't reach the page behind the modal. Focus lands on the first
  // interactive element when it opens.
  React.useEffect(() => {
    if (!open) return;
    const sheet = sheetRef.current;
    const focusables = () => {
      if (!sheet) return [];
      return Array.from(
        sheet.querySelectorAll<HTMLElement>(
          "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
        ),
      ).filter((el) => !el.hasAttribute("disabled"));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      // A dropdown portaled to <body> (z-60, above this sheet) owns the
      // keyboard while it's open — trapping Tab back into the sheet would
      // make its search input unusable.
      const openDropdown = document.querySelector('[data-dropdown-open="true"]');
      if (openDropdown?.contains(document.activeElement)) return;
      const els = focusables();
      if (els.length === 0) {
        e.preventDefault();
        sheet?.focus();
        return;
      }
      const first = els[0];
      const last = els[els.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !sheet?.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !sheet?.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => {
      const el = sheetRef.current?.querySelector<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]",
      );
      el?.focus();
    }, 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [open, onClose]);

  const onDragEnd = (_: unknown, info: { offset: { y: number }; velocity: { y: number } }) => {
    if (info.offset.y > 120 || info.velocity.y > 600) {
      onClose();
    } else {
      animate(dragY, 0, { type: "spring", stiffness: 320, damping: 30 });
    }
  };

  if (!open) return null;

  const sheet = (
    <div className="absolute inset-0 z-50">
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: open ? 1 : 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />
      {/* Sheet */}
      <motion.div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        initial={{ y: "100%" }}
        animate={{ y: open ? "0%" : "100%" }}
        exit={{ y: "100%" }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { type: "spring", stiffness: 340, damping: 34 }
        }
        className={cn(
          "absolute inset-x-0 bottom-0 flex flex-col rounded-t-2xl border border-b-0 border-brand-muted bg-brand-deep shadow-float",
          className ?? "h-[60vh]",
        )}
      >
      {/* Drag handle — the grab area is the drag surface */}
      <motion.div
        style={{ x: 0 }}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.6 }}
        onDragEnd={onDragEnd}
        className="flex shrink-0 cursor-grab touch-none items-center justify-center py-2.5 active:cursor-grabbing"
      >
        <div className="h-1 w-10 rounded-full bg-brand-muted" />
      </motion.div>
        {title ? (
          <h2 className="shrink-0 px-5 pb-2 text-sm font-semibold text-brand-text">{title}</h2>
        ) : null}
        <motion.div style={{ opacity }} className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
          {children}
        </motion.div>
      </motion.div>
    </div>
  );

  // Keep the drag + backdrop inside the map container when portal=false so
  // absolute positioning anchors to it; otherwise full-screen portal.
  if (!portal) return sheet;
  if (typeof document === "undefined") return null;
  return createPortal(sheet, document.body);
}
