/**
 * TSUZUKU — `useAutoFocus(ref, deps)` for the session rooms: the contract-tier
 * hook (`shared/ui/use-auto-focus.ts`, ARCHITECTURE §4 — the one way to focus a
 * control rendered after load; never `autoFocus` on an intrinsic element),
 * re-exported so `SessionView` / `TrainPage` keep their import path. No second
 * implementation lives here.
 */
export { useAutoFocus } from '../shared/ui/use-auto-focus';
