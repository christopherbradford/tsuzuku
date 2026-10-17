/**
 * TSUZUKU — `useDialogFocus` moved to the contract tier
 * (`shared/ui/use-dialog-focus.ts`) so every group's dialogs share it; this
 * path stays for group A's imports.
 */
export { focusableIn, trapTab, useDialogFocus, type DialogFocusOptions } from '@/shared/ui/use-dialog-focus';
