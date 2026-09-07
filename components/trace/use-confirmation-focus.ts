"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Keeps keyboard and assistive-technology focus attached to a form that swaps
 * between an editor and a confirmation screen.
 */
export function useConfirmationFocus(active: boolean) {
  const reviewElementRef = useRef<HTMLElement>(null);
  const returnFocusElementRef = useRef<HTMLButtonElement>(null);
  const restoreWhenEditorReturnsRef = useRef(false);

  const setReviewElement = useCallback((element: HTMLElement | null) => {
    reviewElementRef.current = element;
  }, []);
  const setReturnFocusElement = useCallback(
    (element: HTMLButtonElement | null) => {
      returnFocusElementRef.current = element;
    },
    [],
  );

  useEffect(() => {
    if (active) {
      reviewElementRef.current?.focus();
      return;
    }
    if (!restoreWhenEditorReturnsRef.current) return;
    restoreWhenEditorReturnsRef.current = false;
    returnFocusElementRef.current?.focus();
  }, [active]);

  const returnToEditor = useCallback((closeReview: () => void) => {
    restoreWhenEditorReturnsRef.current = true;
    closeReview();
  }, []);

  return { setReviewElement, setReturnFocusElement, returnToEditor };
}
