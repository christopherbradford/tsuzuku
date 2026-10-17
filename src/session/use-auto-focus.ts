/**
 * TSUZUKU — `useAutoFocus(ref, deps)`: imperative focus for a control that
 * appears after page load (design 01 §7 full keyboard).
 *
 * The `autofocus` attribute is honoured only while the document's
 * autofocus-processed flag is unset; Chrome sets it as soon as anything has
 * been focused (the skip link, a Dojo button), so a Begin / Resume / Continue
 * button rendered later leaves keyboard focus on `<body>` and Enter does
 * nothing. This hook focuses the element after mount (and whenever `deps`
 * change) the way `KanaInput` / `TextAnswer` already do for their inputs.
 */
import type { RefObject } from 'preact';
import { useEffect } from 'preact/hooks';

export function useAutoFocus<T extends HTMLElement>(ref: RefObject<T>, deps: readonly unknown[] = []): void {
  useEffect(() => {
    ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
