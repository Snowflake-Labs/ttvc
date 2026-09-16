// Get a MutationObserver constructor from the iframe realm if available
export const getCrossRealmMutationObserver = (
  iframe: HTMLIFrameElement
): typeof MutationObserver => {
  const win = iframe.contentWindow as (Window & {MutationObserver?: typeof MutationObserver}) | null;
  return win?.MutationObserver ?? MutationObserver;
};

// Unified retry helper for iframe doc-not-ready or reattach flows
export const scheduleIframeRetry = (
  iframe: HTMLIFrameElement,
  cleanupMap: Map<HTMLIFrameElement, () => void>,
  callback: () => void
) => {
  const prev = cleanupMap.get(iframe);
  if (prev) {
    prev();
    cleanupMap.delete(iframe);
  }

  const onLoad = () => callback();
  iframe.addEventListener('load', onLoad);
  const t1 = window.setTimeout(callback, 0);
  const t2 = window.setTimeout(callback, 50);

  cleanupMap.set(iframe, () => {
    iframe.removeEventListener('load', onLoad);
    window.clearTimeout(t1);
    window.clearTimeout(t2);
  });
};


