import { createPythonAdapter } from './python-adapter';
import { createTreeSitterAdapter } from './treesitter-adapter';
import { createTypeScriptAdapter } from './typescript-adapter';
import type { LanguageAdapter } from './types';

export * from './types';
export * from './languages';
export { createTypeScriptAdapter } from './typescript-adapter';
export { createPythonAdapter, findPython } from './python-adapter';
export { createTreeSitterAdapter } from './treesitter-adapter';

/** All built-in adapters. New languages are added by registering another adapter here. */
export function createAdapters(): LanguageAdapter[] {
  return [createTypeScriptAdapter(), createPythonAdapter(), createTreeSitterAdapter()];
}

export function adapterForLanguage(adapters: LanguageAdapter[], language: string): LanguageAdapter | null {
  return adapters.find((a) => a.languages.some((l) => l.id === language)) ?? null;
}
