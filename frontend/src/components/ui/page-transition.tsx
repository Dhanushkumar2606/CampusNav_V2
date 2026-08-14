/**
 * PageTransition — soft fade/slide-in when the route changes. Keyed on the
 * pathname, so every navigation remounts the wrapper and replays the 180 ms
 * entrance. Reduced-motion respected via framer-motion's useReducedMotion.
 */
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useLocation } from "react-router-dom";

export function PageTransition({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const { pathname } = useLocation();
  return (
    <motion.div
      key={pathname}
      initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
      className="flex h-full min-h-0 flex-1 flex-col"
    >
      {children}
    </motion.div>
  );
}