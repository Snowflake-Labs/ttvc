import {CONFIG} from './util/constants';
import {Logger} from './util/logger';
import {scheduleIframeRetry, getCrossRealmMutationObserver} from './util/iframe';

export type Message = 'IDLE' | 'BUSY';
type Subscriber = (message: Message) => void;

// Cross-realm helpers for iframe documents
type CrossRealmImageLike = Element & {src?: string; complete?: boolean};
type CrossRealmLinkLike = Element & {href?: string; rel?: string};
type CrossRealmScriptLike = Element & {src?: string};
type CrossRealmFrameLike = Element & {src?: string};

// Not all link rels necessarilyresult in a resource download
// so we keep a set of link rels that we ignore
const linkRelIgnoreSet: Set<string> = new Set<string>([
  'alternate',
  'author',
  'canonical',
  'dns-prefetch',
  'help',
  'license',
  'me',
  'next',
  'pingback',
  'preconnect',
  'prefetch',
  'preload',
  'prerender',
  'preload',
  'prev',
  'privacy-policy',
  'tag',
  'terms-of-service',
]);

/**
 * Alerts subscribers to the presence or absence of pending AJAX requests
 *
 * Use `increment` and `decrement` public methods to instrument your AJAX
 * requests.
 */
class AjaxIdleObservable {
  private pendingRequests = 0;
  private subscribers = new Set<Subscriber>();

  public didNetworkTimeOut = false;
  private cleanupTimeout?: number; // time out if ajax request never resolves

  private next = (message: Message) => {
    Logger.debug('AjaxIdleObservable.next()', message);
    this.subscribers.forEach((subscriber) => subscriber(message));
  };

  private startCleanupTimeout = () => {
    if (CONFIG.NETWORK_TIMEOUT === 0) return;

    this.abortCleanupTimeout();
    const cleanup = () => {
      Logger.warn(
        'AjaxIdleObservable',
        '::',
        'Timed out waiting for requests to resolve.',
        'Make sure that incrementAjaxCount() is always matched with decrementAjaxCount().',
        '::',
        'pendingRequests =',
        this.pendingRequests
      );
      this.didNetworkTimeOut = true;
      this.pendingRequests = 0;
      this.next('IDLE');
    };

    this.cleanupTimeout = window.setTimeout(cleanup, CONFIG.NETWORK_TIMEOUT);
  };

  private abortCleanupTimeout = () => {
    window.clearTimeout(this.cleanupTimeout);
    this.cleanupTimeout = undefined;
  };

  /** call this whenever an instrumented AJAX request is triggered */
  increment = () => {
    this.startCleanupTimeout();
    if (this.pendingRequests === 0) {
      this.next('BUSY');
    }
    this.pendingRequests += 1;
  };

  /** call this whenever an instrumented AJAX request is resolved */
  decrement = () => {
    this.abortCleanupTimeout();
    if (this.pendingRequests === 1) {
      this.next('IDLE');
    } else {
      this.startCleanupTimeout();
    }
    this.pendingRequests = Math.max(this.pendingRequests - 1, 0);
    if (this.pendingRequests < 10) {
      Logger.debug(
        'AjaxIdleObservable.decrement()',
        '::',
        'pendingRequests =',
        this.pendingRequests
      );
    }
  };

  subscribe = (subscriber: Subscriber) => {
    this.subscribers.add(subscriber);
    const unsubscribe = () => {
      this.subscribers.delete(subscriber);
    };
    return unsubscribe;
  };
}

/** Alerts subscribers to the presence or absence of pending resources */
class ResourceLoadingIdleObservable {
  private pendingResources = new Set<Element>();
  private subscribers = new Set<Subscriber>();

  public didNetworkTimeOut = false;
  private cleanupTimeout?: number; // time out if resource never resolves

  // Track per-iframe cleanup handlers for inner resource observation
  private iframeResourceCleanups = new Map<HTMLIFrameElement, () => void>();

  private registerResourceLoadListener = () => {
    // watch for added or updated script tags
    const o = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            this.trackAddElement(node as Element);
          } else if (node.hasChildNodes() && node instanceof HTMLElement) {
            // images may be mounted within large subtrees, this is less
            // common with link/script elements
            node.querySelectorAll('img').forEach(this.trackAddElement);
          }
        });
      });
    });

    // watch for new tags added anywhere in the document
    o.observe(window.document.documentElement, {childList: true, subtree: true});

    // as resources load, remove them from pendingResources
    ['load', 'error'].forEach((eventType) => {
      window.document.addEventListener(
        eventType,
        (event) => {
          const target = event.target as Element | null;
          if (target && target.nodeType === Node.ELEMENT_NODE) this.trackRemoveElement(target);
        },
        {capture: true}
      );
    });
  };

  constructor() {
    // watch out for SSR
    if (typeof window !== 'undefined' && window?.MutationObserver) {
      if (document.readyState === 'loading') {
        window.addEventListener('load', this.registerResourceLoadListener, {once: true});
      } else {
        this.registerResourceLoadListener();
      }
    }
  }

  /** Attach resource tracking inside an accessible iframe document */
  observeIframeResources = (iframe: HTMLIFrameElement) => {
    // cleanup any previous observation for this iframe
    const prev = this.iframeResourceCleanups.get(iframe);
    if (prev) {
      prev();
      this.iframeResourceCleanups.delete(iframe);
    }

    const tryAttach = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc || !doc.documentElement) return false;

        // Initial scan for existing resources
        doc.querySelectorAll('img,link,script').forEach(this.trackAddElement);

        // Observe mutations inside iframe (use cross-realm observer when available)
        const ObserverCtor = getCrossRealmMutationObserver(iframe);
        const mo = new ObserverCtor((mutations: MutationRecord[]) => {
          mutations.forEach((mutation: MutationRecord) => {
            mutation.addedNodes.forEach((node: Node) => {
              const view = doc.defaultView as Window | null;
              const isElementNode = node.nodeType === Node.ELEMENT_NODE;
              const isSameRealmEl = !!(view && (node as unknown) instanceof (view as unknown as {HTMLElement: typeof HTMLElement}).HTMLElement);
              if (isElementNode || isSameRealmEl) {
                const el = node as Element;
                this.trackAddElement(el);
                // Also scan subtree for resources
                if (typeof el.querySelectorAll === 'function') {
                  el.querySelectorAll('img,link,script').forEach((n) =>
                    this.trackAddElement(n)
                  );
                }
              }
            });
          });
        });
        mo.observe(doc.documentElement, {childList: true, subtree: true});

        // Load/error inside iframe
        const onEvent = (event: Event) => {
          const target = event.target as Element | null;
          if (!target || !('tagName' in target)) return;
          const tag = (target.tagName || '').toUpperCase();
          if (['IMG', 'LINK', 'SCRIPT', 'IFRAME'].includes(tag)) {
            this.trackRemoveElement(target);
          }
        };
        doc.addEventListener('load', onEvent, true);
        doc.addEventListener('error', onEvent, true);

        // Reattach on iframe navigation (load)
        const onFrameLoad = () => this.observeIframeResources(iframe);
        iframe.addEventListener('load', onFrameLoad, {once: true});

        // Save cleanup
        this.iframeResourceCleanups.set(iframe, () => {
          try { mo.disconnect(); } catch (e) { /* noop */ }
          try {
            doc.removeEventListener('load', onEvent, true);
            doc.removeEventListener('error', onEvent, true);
          } catch (e) { /* noop */ }
          try { iframe.removeEventListener('load', onFrameLoad); } catch (e) { /* noop */ }
        });

        return true;
      } catch {
        return false;
      }
    };

    // Attempt immediately and also retry shortly if not yet ready
    if (!tryAttach()) {
      scheduleIframeRetry(iframe, this.iframeResourceCleanups, tryAttach);
    }
  };

  private next = (message: Message) => {
    Logger.debug('ResourceLoadingIdleObservable.next()', message);
    this.subscribers.forEach((subscriber) => subscriber(message));
  };

  private startCleanupTimeout = () => {
    if (CONFIG.NETWORK_TIMEOUT === 0) return;

    this.abortCleanupTimeout();
    const cleanup = () => {
      Logger.warn(
        'ResourceLoadingIdleObservable',
        '::',
        'Timed out waiting for resources to resolve.',
        'Consider filing a bug report if this continues to occur.',
        '::',
        'pendingResources =',
        this.pendingResources
      );
      this.didNetworkTimeOut = true;
      this.pendingResources = new Set();
      this.next('IDLE');
    };

    this.cleanupTimeout = window.setTimeout(cleanup, CONFIG.NETWORK_TIMEOUT);
  };

  private abortCleanupTimeout = () => {
    window.clearTimeout(this.cleanupTimeout);
    this.cleanupTimeout = undefined;
  };

  private shouldTrackElement = (el: Element): boolean => {
    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'IMG') {
      const img = el as CrossRealmImageLike;
      return !!img.src && !img.complete;
    }
    if (tag === 'LINK') {
      const link = el as CrossRealmLinkLike;
      return !!link.href && !linkRelIgnoreSet.has((link.rel || '').toLowerCase());
    }
    if (tag === 'SCRIPT') {
      const script = el as CrossRealmScriptLike;
      return !!script.src;
    }
    if (tag === 'IFRAME') {
      const frame = el as CrossRealmFrameLike;
      return !!frame.src && frame.src !== 'about:blank';
    }
    return false;
  };

  private trackAddElement = (el: Element) => {
    if (!this.shouldTrackElement(el)) return;
    this.startCleanupTimeout();
    if (this.pendingResources.size === 0) this.next('BUSY');
    this.pendingResources.add(el);
  };

  private trackRemoveElement = (el: Element) => {
    this.abortCleanupTimeout();
    this.pendingResources.delete(el);
    if (this.pendingResources.size === 0) {
      this.next('IDLE');
    } else {
      this.startCleanupTimeout();
    }
    if (this.pendingResources.size < 10) {
      Logger.debug(
        'ResourceLoadingIdleObservable.remove()',
        '::',
        'pendingResources =',
        this.pendingResources
      );
    }
  };

  subscribe = (subscriber: Subscriber) => {
    this.subscribers.add(subscriber);
    const unsubscribe = () => {
      this.subscribers.delete(subscriber);
    };
    return unsubscribe;
  };
}

/**
 * DO NOT INTIALIZE THIS CLASS DIRECTLY. Use getNetworkIdleObservable instead.
 *
 * Alerts subscribers to the presence or absence of _any_ observable network
 * activity. Combines the functionalities of AjaxIdleObservable and
 * ScriptLoadingIdleObservable.
 */
export class NetworkIdleObservable {
  private ajaxIdleObservable = new AjaxIdleObservable();
  private resourceLoadingIdleObservable = new ResourceLoadingIdleObservable();
  private subscribers = new Set<Subscriber>();

  // idle state
  private ajaxIdle = true;
  private scriptLoadingIdle = true;

  constructor() {
    this.ajaxIdleObservable.subscribe(this.handleUpdate('AJAX'));
    this.resourceLoadingIdleObservable.subscribe(this.handleUpdate('RESOURCE_LOADING'));
  }

  private handleUpdate = (source: 'AJAX' | 'RESOURCE_LOADING') => (message: Message) => {
    const wasIdle = this.ajaxIdle && this.scriptLoadingIdle;

    // update state
    if (source === 'AJAX') {
      this.ajaxIdle = message === 'IDLE';
    }
    if (source === 'RESOURCE_LOADING') {
      this.scriptLoadingIdle = message === 'IDLE';
    }

    // if this is a change, notify subscribers
    const isIdle = this.ajaxIdle && this.scriptLoadingIdle;
    if (wasIdle !== isIdle) {
      this.next(isIdle ? 'IDLE' : 'BUSY');
    }
  };

  private next = (message: Message) => {
    Logger.debug('NetworkIdleObservable.next()', message);
    this.subscribers.forEach((subscriber) => subscriber(message));
  };

  incrementAjaxCount = () => this.ajaxIdleObservable.increment();

  decrementAjaxCount = () => this.ajaxIdleObservable.decrement();

  isIdle = () => {
    return this.ajaxIdle && this.scriptLoadingIdle;
  };

  didNetworkTimeOut = () => {
    return (
      this.ajaxIdleObservable.didNetworkTimeOut ||
      this.resourceLoadingIdleObservable.didNetworkTimeOut
    );
  };

  resetDidNetworkTimeOut = () => {
    this.ajaxIdleObservable.didNetworkTimeOut = false;
    this.resourceLoadingIdleObservable.didNetworkTimeOut = false;
  };

  // Expose inner-iframe resource observation for same-origin frames
  observeIframeResources = (iframe: HTMLIFrameElement) =>
    this.resourceLoadingIdleObservable.observeIframeResources(iframe);

  subscribe = (subscriber: Subscriber) => {
    this.subscribers.add(subscriber);
    const unsubscribe = () => {
      this.subscribers.delete(subscriber);
    };
    return unsubscribe;
  };
}

// expose observable as a singleton
let networkIdleObservable: NetworkIdleObservable;
export const getNetworkIdleObservable = () => {
  if (!networkIdleObservable) {
    networkIdleObservable = new NetworkIdleObservable();
  }
  return networkIdleObservable;
};
