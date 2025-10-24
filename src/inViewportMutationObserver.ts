import {Logger} from './util/logger';
import {getNetworkIdleObservable} from './networkIdleObservable';
import {getCrossRealmMutationObserver, scheduleIframeRetry} from './util/iframe';

export type InViewportMutationObserverCallback = (mutation: TimestampedMutationRecord) => void;
export type TimestampedMutationRecord = MutationRecord & {timestamp?: number};

/**
 * Instantiate this class to monitor mutation events that occur *within the
 * viewport*.
 *
 * This class is modeled after the standard MutationObserver API, but does not
 * report mutations that did not occur within the viewport.
 *
 * @example
 * const observer = new InViewportMutationObserver((mutation) => {
 *   // do something with the mutation
 * });
 *
 * // begin watching for visible mutations to the body element
 * observer.observe(document.body);
 *
 * // stop watching for mutations
 * observer.disconnect();
 */
export class InViewportMutationObserver {
  private callback: InViewportMutationObserverCallback;
  private intersectionObserver: IntersectionObserver;
  private mutationObserver: MutationObserver;
  private iframeMutationObservers: Map<HTMLIFrameElement, {observer: MutationObserver; doc: Document}> = new Map();
  private iframePendingAjax = new Map<
    HTMLIFrameElement,
    {didDecrement: boolean; timeoutId?: number}
  >();
  private iframeRetryCleanup = new Map<HTMLIFrameElement, () => void>();
  private mutationObserverConfig: MutationObserverInit = {
    attributeFilter: ['hidden', 'style', 'src', 'srcdoc'],
    attributeOldValue: true,
    attributes: true,
    characterData: true,
    characterDataOldValue: true,
    childList: true,
    subtree: true,
  };
  private mutations: Map<Node, TimestampedMutationRecord> = new Map();

  // Schedule unified retry/verification for iframes: listens on 'load' and
  // schedules short timeouts (0ms, 50ms). Cleans up previous retries.
  private scheduleIframeRetry(iframe: HTMLIFrameElement, callback: () => void) {
    scheduleIframeRetry(iframe, this.iframeRetryCleanup, callback);
  }

  // Release the network idle hold for srcdoc iframes on first mutation
  private releaseSrcdocAjaxHold(iframe: HTMLIFrameElement) {
    const pending = this.iframePendingAjax.get(iframe);
    if (pending && !pending.didDecrement) {
      try {
        getNetworkIdleObservable().decrementAjaxCount();
      } catch (e) {
        Logger.debug('InViewportMutationObserver.releaseSrcdocAjaxHold()', '::', 'decrement failed');
      }
      pending.didDecrement = true;
      if (pending.timeoutId) {
        window.clearTimeout(pending.timeoutId);
      }
    }
  }

  constructor(callback: InViewportMutationObserverCallback) {
    this.callback = callback;
    this.mutationObserver = new MutationObserver(this.mutationObserverCallback);
    this.intersectionObserver = new IntersectionObserver(this.intersectionObserverCallback);
  }

  public observe(target: HTMLElement) {
    Logger.info('InViewportMutationObserver.observe()', '::', 'target =', target);
    this.mutationObserver.observe(target, this.mutationObserverConfig);
    // proactively attach to any existing iframes that are already in the DOM
    try {
      target.querySelectorAll('iframe').forEach((iframe) => this.observeIframe(iframe));
    } catch (e) {
      Logger.debug('InViewportMutationObserver.observe()', '::', 'querySelectorAll failed');
    }
  }

  public disconnect() {
    Logger.info('InViewportMutationObserver.disconnect()');
    this.mutationObserver.disconnect();
    this.intersectionObserver.disconnect();
    // cleanup any iframe observers
    this.iframeMutationObservers.forEach(({observer}) => observer.disconnect());
    this.iframeMutationObservers.clear();
    // cleanup any pending retry attempts
    this.iframeRetryCleanup.forEach((cleanup) => cleanup());
    this.iframeRetryCleanup.clear();
    // cleanup any pending ajax counters
    this.iframePendingAjax.forEach((state) => {
      if (!state.didDecrement) {
        try {
          getNetworkIdleObservable().decrementAjaxCount();
        } catch (e) {
          Logger.debug('InViewportMutationObserver.disconnect()', '::', 'decrement failed');
        }
      }
      if (state.timeoutId) window.clearTimeout(state.timeoutId);
    });
    this.iframePendingAjax.clear();
  }

  private mutationObserverCallback: MutationCallback = (mutations) => {
    Logger.debug(
      'InViewportMutationObserver.mutationObserverCallback()',
      '::',
      'mutations =',
      mutations
    );
    mutations.forEach((mutation: TimestampedMutationRecord) => {
      mutation.timestamp = performance.now();

      let target: Element | null = null;
      if (mutation.target instanceof Element) target = mutation.target;
      if (mutation.target instanceof Text) target = mutation.target.parentElement;

      if (!target) {
        return;
      }

      switch (mutation.type) {
        case 'childList':
          mutation.addedNodes.forEach((node) => {
            if (node instanceof HTMLElement) {
              this.intersectionObserver.observe(node);
              this.mutations.set(node, mutation);
            }
            if (node instanceof Text && node.parentElement != null) {
              this.intersectionObserver.observe(node.parentElement);
              this.mutations.set(node.parentElement, mutation);
            }
            // If an iframe is added, attempt to observe its internal document mutations
            if (node instanceof HTMLIFrameElement) {
              this.observeIframe(node);
            }
          });
          break;
        case 'attributes':
        default:
          this.intersectionObserver.observe(target);
          this.mutations.set(target, mutation);
          // If an iframe's attributes change (e.g., src/srcdoc), try attaching again
          if (target instanceof HTMLIFrameElement) {
            this.observeIframe(target);
          }
      }
    });
  };

  private intersectionObserverCallback: IntersectionObserverCallback = (entries) => {
    Logger.debug(
      'InViewportMutationObserver.intersectionObserverCallback()',
      '::',
      'entries =',
      entries
    );
    entries.forEach((entry) => {
      const mutation = this.mutations.get(entry.target);
      if (entry.isIntersecting && mutation != null) {
        Logger.info('InViewportMutationObserver.callback()', '::', 'mutation =', mutation);
        this.callback(mutation);
      }
      this.mutations.delete(entry.target);
      this.intersectionObserver.unobserve(entry.target);
    });
  };

  /**
   * Attempt to attach a MutationObserver to an accessible iframe's document.
   * This allows tracking mutations inside same-origin iframes.
   *
   * Key challenges addressed:
   * 1. Cross-origin iframes: Cannot access contentDocument (handled via try-catch)
   * 2. Timing issues: contentDocument may not be ready immediately after iframe creation
   * 3. Document swapping: Some browsers (especially with srcdoc) swap the contentDocument
   *    shortly after iframe creation, requiring retry logic to attach to the correct document
   *
   * Retry strategy:
   * - Listen for 'load' event (in case it hasn't fired yet)
   * - Schedule immediate retry (setTimeout 0) to handle post-creation document swaps
   * - Schedule delayed retry (50ms) as final fallback for slower document initialization
   *
   * Network idle handling:
   * - srcdoc iframes: Manually increment/decrement ajax counter since they don't trigger
   *   network requests tracked by ResourceLoadingIdleObservable
   * - Regular iframes: Already handled by ResourceLoadingIdleObservable
   *
   * @param iframe - The iframe element to observe
   */
  private observeIframe = (iframe: HTMLIFrameElement) => {
    const existing = this.iframeMutationObservers.get(iframe);
    try {
      const doc = iframe.contentDocument;
      if (!doc || !doc.documentElement) {
        // Document not ready - schedule unified retry attempts
        this.scheduleIframeRetry(iframe, () => this.observeIframe(iframe));
        return;
      }

      // Document is ready - we can attach the observer now

      // If we already have an observer for this iframe/document, nothing to do
      if (existing && existing.doc === doc) {
        return;
      }

      // If the iframe navigated to a new document, disconnect the old observer
      if (existing) {
        existing.observer.disconnect();
        this.iframeMutationObservers.delete(iframe);
      }

      const networkIdleObservable = getNetworkIdleObservable();

      const forwardInnerMutation: MutationCallback = (mutations) => {
        mutations.forEach((mutation: MutationRecord) => {
          const timestamped = mutation as TimestampedMutationRecord;
          timestamped.timestamp = performance.now();

          // Defer to IntersectionObserver to determine visibility
          this.mutations.set(iframe, timestamped);
          this.intersectionObserver.observe(iframe);

          // Release the network idle hold on first mutation (for srcdoc iframes)
          this.releaseSrcdocAjaxHold(iframe);
        });
      };

      // Use the iframe's own MutationObserver constructor when available
      // to ensure callbacks execute in the correct realm
      const ObserverCtor = getCrossRealmMutationObserver(iframe);
      const observer: MutationObserver = new ObserverCtor(forwardInnerMutation);
      observer.observe(doc.documentElement, this.mutationObserverConfig);
      this.iframeMutationObservers.set(iframe, {observer, doc});

      // If the iframe swaps its document (common with srcdoc), re-attach to the latest one
      this.scheduleIframeRetry(iframe, () => {
        const currentDoc = iframe.contentDocument;
        const record = this.iframeMutationObservers.get(iframe);
        if (!currentDoc || !record) return;
        if (currentDoc !== record.doc) {
          record.observer.disconnect();
          this.iframeMutationObservers.delete(iframe);
          // Re-observe with the latest document
          this.observeIframe(iframe);
        } else {
          // Ensure we are still observing the current document root
          record.observer.observe(currentDoc.documentElement ?? currentDoc, this.mutationObserverConfig);
        }
      });

      // Always track resources within the iframe document (images, links, scripts)
      try {
        networkIdleObservable.observeIframeResources(iframe);
      } catch (e) {
        Logger.debug('InViewportMutationObserver.observeIframe()', '::', 'observeIframeResources failed');
      }

      // For srcdoc iframes, hold network busy until we get a mutation.
      // This accounts for resource downloads that may start before we attach our observer.
      // Release the hold on first mutation or after a 2-second timeout.
      const alreadyTracking = this.iframePendingAjax.has(iframe);
      if (!alreadyTracking && iframe.srcdoc && iframe.srcdoc.length > 0) {
        try {
          networkIdleObservable.incrementAjaxCount();

          const timeoutId = window.setTimeout(() => this.releaseSrcdocAjaxHold(iframe), 2000);
          this.iframePendingAjax.set(iframe, {didDecrement: false, timeoutId});
        } catch (e) {
          Logger.debug('InViewportMutationObserver.observeIframe()', '::', 'increment failed');
        }
      }
    } catch (e) {
      // Accessing iframe.contentDocument throws for cross-origin iframes - this is expected
      Logger.debug('InViewportMutationObserver.observeIframe()', '::', 'inaccessible iframe');
      return;
    }
  };

}
