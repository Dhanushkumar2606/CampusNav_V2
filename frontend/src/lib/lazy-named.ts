import { lazy } from "react";
import type { ComponentType } from "react";

/**
 * Lazy-import a module that uses a named export (all pages here use
 * `export function X()`), adapting it to the `{ default }` shape React.lazy
 * expects.
 */
export function lazyNamed<T extends ComponentType<unknown>>(
  importer: () => Promise<Record<string, T>>,
  name: string,
) {
  return lazy(async () => ({ default: (await importer())[name] }));
}