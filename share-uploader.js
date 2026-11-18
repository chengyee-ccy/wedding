(() => {
  const iframe = document.getElementById('share-iframe');
  const container = document.getElementById('share-frame-container');
  const error = document.getElementById('share-iframe-error');
  const retry = document.getElementById('btn-retry-share');
  const uploaderUrl = new URL(iframe.src, location.href);
  let ready = false;
  let failed = false;
  let isOpen = false;
  let refreshRequestId = 0;
  let refreshPending = false;
  let timeout;
  let poll;

  function refreshGallery() {
    if (!isOpen || !refreshPending) return;
    try {
      // The hosted wedding page and uploader share an origin. This also supports older uploader versions.
      if (typeof iframe.contentWindow?.fetchLiveCloudGallery === 'function') {
        iframe.contentWindow.fetchLiveCloudGallery();
        refreshPending = false;
        return;
      }
    } catch {
      // Local previews embed the hosted uploader across origins; use its message listener.
    }
    iframe.contentWindow?.postMessage({
      type: 'wedding-uploader:refresh-gallery', requestId: refreshRequestId
    }, uploaderUrl.origin);
  }

  function stopWaiting() {
    clearTimeout(timeout);
    clearInterval(poll);
    container.setAttribute('aria-busy', 'false');
  }

  function showError() {
    stopWaiting();
    ready = false;
    failed = true;
    if (!isOpen) return;
    error.hidden = false;
    retry.focus({ preventScroll: true });
  }

  function markReady() {
    const focusWasOnRetry = document.activeElement === retry;
    ready = true;
    failed = false;
    stopWaiting();
    error.hidden = true;
    refreshGallery();
    if (isOpen && focusWasOnRetry) iframe.focus({ preventScroll: true });
  }

  function inspectDocument() {
    try {
      const doc = iframe.contentDocument;
      if (!doc || doc.URL === 'about:blank') return false;
      if (doc.querySelector('#uploadForm')) {
        markReady();
        return true;
      }
      if (doc.readyState === 'complete') {
        showError();
        return true;
      }
    } catch {
      // A different origin can still display normally; use its load event.
    }
    return false;
  }

  function handleLoad() {
    if (inspectDocument()) return;
    // The hosted uploader need not implement a separate readiness protocol.
    markReady();
  }

  function watchLoading() {
    stopWaiting();
    container.setAttribute('aria-busy', 'true');
    // Detect the form before slower gallery, Firebase, or image requests finish.
    poll = setInterval(inspectDocument, 200);
    timeout = setTimeout(showError, 20000);
  }

  iframe.addEventListener('load', handleLoad);
  iframe.addEventListener('error', showError);
  retry.addEventListener('click', () => {
    ready = false;
    failed = false;
    error.hidden = true;
    iframe.dataset.loaded = 'false';
    iframe.src = uploaderUrl.href;
    watchLoading();
  });

  window.shareUploader = {
    open() {
      if (isOpen) return;
      isOpen = true;
      refreshRequestId++;
      refreshPending = true;
      if (ready) return refreshGallery();
      if (failed) return showError();
      if (inspectDocument()) return;
      if (iframe.dataset.loaded === 'true') return handleLoad();
      watchLoading();
    },
    close() {
      isOpen = false;
      refreshPending = false;
      stopWaiting();
    }
  };

  if (iframe.dataset.loaded === 'true') handleLoad();
})();
