const openModalStack: string[] = [];

function syncBodyScrollLock(): void {
  if (typeof document === 'undefined' || !document.body) return;

  if (openModalStack.length > 0) {
    document.body.dataset.clyModalLocks = String(openModalStack.length);
    document.body.style.overflow = 'hidden';
  } else {
    delete document.body.dataset.clyModalLocks;
    document.body.style.overflow = '';
  }
}

/**
 * Registers an open modal on the active stack and applies a ref-counted
 * body scroll lock. Returns the current total lock count.
 */
export function acquireModalLock(id: string): number {
  if (!openModalStack.includes(id)) {
    openModalStack.push(id);
  }
  syncBodyScrollLock();
  return openModalStack.length;
}

/**
 * Removes a modal from the active stack and releases the body scroll lock
 * once no open modals remain. Returns the remaining lock count.
 */
export function releaseModalLock(id: string): number {
  const index = openModalStack.indexOf(id);
  if (index !== -1) {
    openModalStack.splice(index, 1);
  }
  syncBodyScrollLock();
  return openModalStack.length;
}

/**
 * Returns true only when the given modal ID is at the top of the open stack.
 */
export function isTopModal(id: string): boolean {
  return openModalStack.length > 0 && openModalStack[openModalStack.length - 1] === id;
}

/**
 * Returns the number of currently locked modals on the stack.
 */
export function getModalLockCount(): number {
  return openModalStack.length;
}
