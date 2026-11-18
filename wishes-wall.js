class WishesWall {
  static floatingPreferenceKey = 'wedding_floating_wishes_visible';
  static sampleWishes = [
    '新婚快乐，白头偕老，事事如意，幸福久久。',
    '以爱之名，余生为期，白头永偕，祝新婚快乐！',
    '陪伴和守护是最长情的告白，愿你们永远幸福快乐！',
    '愿你们三餐四季，温暖有趣，一生相伴。',
    '百年好合，永结同心！祝你们新婚快乐，甜蜜长久！',
    '愿往后的每一天，都有爱、有笑声、有彼此。',
    'Wishing you a lifetime of love, laughter and happiness!',
    'May your next chapter be filled with beautiful adventures and endless love.',
    'Congratulations to you both! Here’s to a lifetime of making happy memories together.',
    'So happy to celebrate your special day. Wishing you love and joy, always.'
  ];

  constructor({ auth, rootRef }) {
    this.auth = auth;
    this.wishesRef = rootRef?.child('wishes');
    this.section = document.getElementById('wishes-wall');
    this.viewport = document.getElementById('wishes-viewport');
    this.lanes = document.getElementById('wishes-lanes');
    this.empty = document.getElementById('wishes-empty');
    this.status = document.getElementById('wishes-status');
    this.addButton = document.getElementById('btn-add-wish');
    this.floating = document.getElementById('wishes-floating');
    this.floatingMessages = document.getElementById('wishes-floating-messages');
    this.floatingAdd = document.getElementById('btn-floating-add-wish');
    this.floatingToggle = document.getElementById('btn-toggle-floating-wishes');
    this.showFloatingMessages = true;
    try {
      this.showFloatingMessages = localStorage.getItem(WishesWall.floatingPreferenceKey) !== 'false';
    } catch { /* The toggle still works if browser storage is unavailable. */ }
    this.detailModal = document.getElementById('wish-detail-modal');
    this.detailName = document.getElementById('wish-detail-name');
    this.detailMessage = document.getElementById('wish-detail-message');
    this.detailClose = document.getElementById('btn-close-wish-detail');
    this.modal = document.getElementById('wish-modal');
    this.form = document.getElementById('wish-form');
    this.nameInput = document.getElementById('wish-name');
    this.messageInput = document.getElementById('wish-message');
    this.samplesToggle = document.getElementById('wish-samples-toggle');
    this.samplesPanel = document.getElementById('wish-samples-panel');
    this.samplesList = document.getElementById('wish-samples-list');
    this.submit = document.getElementById('btn-send-wish');
    this.formStatus = document.getElementById('wish-form-status');
    this.uid = null;
    this.ready = false;
    this.posting = false;
    this.draftRef = null;
    this.items = [];
    this.floatingRows = [];
    this.floatingActive = new Set();
    this.floatingQueue = [];
    this.wallVisible = true;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  }

  init() {
    this.setupSamples();
    this.setupReadingPause();
    [this.addButton, this.floatingAdd].forEach(button => {
      button.addEventListener('click', () => this.openWishForm(button));
    });
    this.floatingToggle.addEventListener('click', () => {
      this.showFloatingMessages = !this.showFloatingMessages;
      this.updateFloatingVisibility();
      try {
        localStorage.setItem(WishesWall.floatingPreferenceKey, String(this.showFloatingMessages));
      } catch { /* Retain the selection for this visit. */ }
    });
    this.floatingMessages.addEventListener('click', event => {
      const bubble = event.target.closest('.wish-floating-bubble');
      if (bubble) this.openWishDetails(bubble.dataset.wishId, bubble);
    });
    this.floatingMessages.addEventListener('focusin', () => this.updateFloatingVisibility());
    this.floatingMessages.addEventListener('focusout', () => queueMicrotask(() => this.updateFloatingVisibility()));
    ['pointerenter', 'pointerleave'].forEach(type => {
      this.floatingMessages.addEventListener(type, event => {
        if (event.pointerType !== 'mouse') return;
        this.floatingHovered = type === 'pointerenter';
        this.updateFloatingVisibility();
      });
    });
    this.detailClose.addEventListener('click', () => window.app.ui.closeModal('wish-detail-modal'));
    this.detailModal.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        window.app.ui.closeModal('wish-detail-modal');
      } else if (event.key === 'Tab') {
        event.preventDefault();
        this.detailClose.focus();
      }
    });
    ['btn-close-wish', 'btn-cancel-wish'].forEach(id => {
      document.getElementById(id).addEventListener('click', () => {
        this.setSamplesOpen(false);
        window.app.ui.closeModal('wish-modal');
      });
    });
    window.addEventListener('popstate', () => {
      if (!this.detailModal.classList.contains('hidden')) {
        this.detailWasOpen = true;
        this.detailClose.focus({ preventScroll: true });
      } else if (this.detailWasOpen) {
        this.detailWasOpen = false;
        this.updateFloatingVisibility();
        if (this.detailKeyboardOpen) {
          const bubble = [...this.floatingMessages.querySelectorAll('.wish-floating-bubble')]
            .find(button => button.dataset.wishId === this.detailWishId);
          const trigger = bubble || (this.floating.hidden ? this.addButton : this.floatingAdd);
          trigger.focus({ preventScroll: true });
        }
      }
      if (this.wasOpen && this.modal.classList.contains('hidden')) {
        this.setSamplesOpen(false);
        this.wasOpen = false;
        this.updateFloatingVisibility();
        if (this.keyboardOpen && this.formTrigger?.getClientRects().length) this.formTrigger.focus({ preventScroll: true });
      }
    });
    this.modal.addEventListener('keydown', event => this.handleDialogKey(event));
    this.form.addEventListener('submit', event => { event.preventDefault(); this.postWish(); });
    this.messageInput.addEventListener('input', () => {
      document.getElementById('wish-character-count').textContent = `${this.messageInput.value.length} / 300`;
    });
    this.resizeObserver = new ResizeObserver(() => this.updateAnimation());
    this.resizeObserver.observe(this.viewport);
    this.resizeObserver.observe(this.floatingMessages);
    this.visibilityObserver = new IntersectionObserver(entries => {
      this.wallVisible = entries[0].isIntersecting;
      if (!this.wallVisible) this.resetReadingPause();
      this.section.classList.toggle('is-offscreen', !this.wallVisible);
      this.updateFloatingVisibility();
    });
    this.visibilityObserver.observe(this.section);
    this.modalObserver = new MutationObserver(() => this.updateFloatingVisibility());
    this.modalObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', () => this.updateFloatingVisibility());
    this.reducedMotion.addEventListener('change', () => {
      this.wallLayoutWidth = 0;
      this.updateAnimation();
      this.updateFloatingVisibility();
    });
    document.fonts?.addEventListener('loadingdone', () => {
      this.wallLayoutWidth = 0;
      this.floatingWidth = 0;
      this.updateAnimation();
    });

    if (!this.auth || !this.wishesRef) {
      this.setStatus('Wishes are temporarily unavailable. Please try again later. / 祝福墙暂时无法连接，请稍后再试。', true);
      this.formStatus.textContent = 'Please reconnect before sending your wish. / 请连接后再送上祝福。';
      return;
    }
    this.connectionTimeout = setTimeout(() => {
      if (!this.ready) this.connectionError();
    }, 15000);
    this.auth.onAuthStateChanged(user => {
      this.uid = user?.uid || null;
      if (!user) {
        this.ready = false;
        this.submit.disabled = true;
        return;
      }
      if (this.subscribed) return;
      this.subscribed = true;
      this.wishesRef.limitToLast(100).on('value', snapshot => {
        clearTimeout(this.connectionTimeout);
        if (!this.ready) {
          this.formStatus.textContent = '';
          this.formStatus.classList.remove('is-error');
        }
        this.ready = true;
        this.submit.disabled = this.posting || !this.uid;
        const wishes = Object.entries(snapshot.val() || {})
          .filter(([, wish]) => typeof wish?.name === 'string' && typeof wish?.message === 'string' && wish.name.trim() && wish.message.trim())
          .map(([id, wish]) => ({ id, name: wish.name.slice(0, 50), message: wish.message.slice(0, 300), createdAt: Number(wish.createdAt) || 0 }))
          .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
        this.render(wishes);
        this.setStatus(wishes.length ? '' : 'Every wish becomes part of our story. / 每一份祝福，都是我们的珍贵回忆。');
      }, error => {
        console.warn('Wishes could not load.', error);
        this.connectionError();
      });
    }, error => {
      console.warn('Wishes sign-in unavailable.', error);
      this.connectionError();
    });
  }

  setupReadingPause() {
    let hovered = false;
    let tapped = false;
    let gesture = null;
    let drag = null;
    let touching = null;
    const update = () => {
      this.section.classList.toggle('is-reading', hovered || tapped || Boolean(gesture) || Boolean(drag));
      this.updateWallPlayback();
    };
    const cancelGesture = () => { gesture = null; update(); };
    const finishDrag = event => {
      if (drag?.id !== event.pointerId) return;
      const id = drag.id;
      drag = null;
      this.viewport.classList.remove('is-dragging');
      if (this.viewport.hasPointerCapture(id)) this.viewport.releasePointerCapture(id);
      update();
    };

    ['pointerenter', 'pointerleave'].forEach(type => {
      this.viewport.addEventListener(type, event => {
        if (event.pointerType !== 'mouse') return;
        hovered = type === 'pointerenter';
        update();
      });
    });
    this.viewport.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button === 0 && this.wallScrollable &&
        event.clientY < this.viewport.getBoundingClientRect().top + this.viewport.clientHeight) {
        event.preventDefault();
        drag = { id: event.pointerId, x: event.clientX };
        this.viewport.setPointerCapture(event.pointerId);
        this.viewport.classList.add('is-dragging');
        this.pauseWallTemporarily();
        update();
        return;
      }
      if (event.pointerType !== 'touch' || !event.isPrimary) return;
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, wasPaused: tapped };
      update();
    });
    this.viewport.addEventListener('pointermove', event => {
      if (drag?.id === event.pointerId) {
        this.viewport.scrollLeft += drag.x - event.clientX;
        drag.x = event.clientX;
        this.normalizeWallScroll();
        this.pauseWallTemporarily();
      }
      if (gesture?.id === event.pointerId && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 10) cancelGesture();
    }, { passive: true });
    this.viewport.addEventListener('pointerup', event => {
      finishDrag(event);
      if (gesture?.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) <= 10) tapped = !gesture.wasPaused;
      cancelGesture();
    }, { passive: true });
    this.viewport.addEventListener('pointercancel', event => {
      finishDrag(event);
      if (gesture?.id === event.pointerId) cancelGesture();
    }, { passive: true });
    this.viewport.addEventListener('lostpointercapture', finishDrag);
    this.viewport.addEventListener('touchstart', event => {
      const point = event.touches[0];
      touching = point ? { x: point.clientX, y: point.clientY, axis: null } : null;
    }, { passive: true });
    this.viewport.addEventListener('touchmove', event => {
      const point = event.touches[0];
      if (!touching || !point) return;
      const dx = point.clientX - touching.x, dy = point.clientY - touching.y;
      if (!touching.axis && Math.hypot(dx, dy) > 10) touching.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (touching.axis === 'x' && this.wallScrollable) {
        tapped = true;
        update();
      }
    }, { passive: true });
    ['touchend', 'touchcancel'].forEach(type => {
      document.addEventListener(type, () => { touching = null; }, { passive: true });
    });
    this.viewport.addEventListener('scroll', () => {
      this.normalizeWallScroll();
      if (touching?.axis === 'x') {
        tapped = true;
        update();
      }
    }, { passive: true });
    this.viewport.addEventListener('wheel', event => {
      if (!event.deltaX && !event.shiftKey) return;
      this.pauseWallTemporarily();
      if (event.shiftKey && !event.deltaX && this.wallScrollable) {
        event.preventDefault();
        this.viewport.scrollLeft += event.deltaY;
        this.normalizeWallScroll();
      }
    }, { passive: false });
    this.viewport.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !this.wallScrollable) return;
      event.preventDefault();
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') this.browseWall(event.key === 'ArrowLeft' ? -1 : 1);
      else {
        this.pauseWallTemporarily();
        this.viewport.scrollLeft = event.key === 'Home' ? this.wallCycleWidth : 2 * this.wallCycleWidth - this.viewport.clientWidth;
      }
    });
    this.section.addEventListener('focusin', () => this.updateWallPlayback());
    this.section.addEventListener('focusout', () => queueMicrotask(() => this.updateWallPlayback()));
    document.addEventListener('pointerdown', event => {
      if (!this.viewport.contains(event.target)) {
        tapped = false;
        cancelGesture();
      }
    }, { passive: true });
    this.resetReadingPause = () => { hovered = false; tapped = false; touching = null; cancelGesture(); };
  }

  openWishDetails(id, trigger) {
    const wish = this.items.find(item => item.id === id);
    if (!wish) return;
    this.detailWishId = id;
    this.detailKeyboardOpen = trigger.matches(':focus-visible');
    this.detailName.textContent = `${wish.name}:`;
    this.detailMessage.textContent = wish.message;
    window.app.ui.openModal('wish-detail-modal');
    this.detailWasOpen = !this.detailModal.classList.contains('hidden');
    if (this.detailWasOpen) this.detailClose.focus({ preventScroll: true });
  }

  openWishForm(trigger) {
    this.setSamplesOpen(false);
    this.formTrigger = trigger;
    this.keyboardOpen = trigger.matches(':focus-visible');
    window.app.ui.openModal('wish-modal');
    this.wasOpen = !this.modal.classList.contains('hidden');
    if (this.wasOpen) this.nameInput.focus({ preventScroll: true });
  }

  renderFloating() {
    const focusedId = this.floatingMessages.contains(document.activeElement) ? document.activeElement.dataset.wishId : null;
    this.stopFloatingAnimation();
    this.floatingMessages.replaceChildren();
    this.floatingRows = [];
    this.floatingWidth = 0;
    const count = Math.min(3, this.items.length);
    for (let index = 0; index < count; index++) {
      const lane = document.createElement('div');
      lane.className = 'wish-floating-lane';
      this.floatingMessages.append(lane);
      this.floatingRows.push({ element: lane, speed: 42 + index * 5, bubbles: [] });
    }
    this.updateFloatingVisibility();
    if (focusedId) {
      const replacement = [...this.floatingMessages.querySelectorAll('button')].find(button => button.dataset.wishId === focusedId);
      (replacement || this.floatingAdd).focus({ preventScroll: true });
    }
  }

  nextFloatingWish() {
    if (!this.floatingQueue.length) {
      this.floatingQueue = [...this.items];
      for (let index = this.floatingQueue.length - 1; index > 0; index--) {
        const other = Math.floor(Math.random() * (index + 1));
        [this.floatingQueue[index], this.floatingQueue[other]] = [this.floatingQueue[other], this.floatingQueue[index]];
      }
    }
    let index = this.floatingQueue.findIndex(wish => !this.floatingActive.has(wish.id));
    if (index < 0) {
      const available = this.items.filter(wish => !this.floatingActive.has(wish.id));
      if (!available.length) return null;
      // Keep the stream moving when the remaining queued wishes are still on screen.
      return available[Math.floor(Math.random() * available.length)];
    }
    return this.floatingQueue.splice(index, 1)[0];
  }

  addFloatingBubble(row, x) {
    const wish = this.nextFloatingWish();
    if (!wish) return null;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wish-floating-bubble';
    button.dataset.wishId = wish.id;
    button.title = 'Read full wish / 查看完整祝福';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', 'wish-detail-modal');
    const name = document.createElement('strong');
    name.textContent = `${wish.name}:`;
    const message = document.createElement('span');
    message.textContent = wish.message;
    button.append(name, message);
    row.element.append(button);
    const bubble = { element: button, x, width: button.getBoundingClientRect().width, gap: 24 + Math.random() * 24 };
    this.floatingActive.add(wish.id);
    row.bubbles.push(bubble);
    this.positionFloatingBubble(bubble);
    return bubble;
  }

  positionFloatingBubble(bubble) {
    bubble.element.style.transform = `translate3d(${bubble.x}px, 0, 0)`;
    const tabIndex = bubble.x < this.floatingWidth && bubble.x + bubble.width > 0 ? 0 : -1;
    if (bubble.element.tabIndex !== tabIndex) bubble.element.tabIndex = tabIndex;
  }

  updateFloatingAnimation() {
    const width = this.floatingMessages.clientWidth;
    if (!width || this.floating.hidden || this.floatingMessages.hidden) return this.stopFloatingAnimation();
    if (width !== this.floatingWidth || this.floatingReduced !== this.reducedMotion.matches) {
      this.stopFloatingAnimation();
      this.floatingWidth = width;
      this.floatingReduced = this.reducedMotion.matches;
      this.floatingActive.clear();
      this.floatingQueue = [];
      this.floatingRows.forEach(row => {
        row.element.replaceChildren();
        row.bubbles = [];
        this.addFloatingBubble(row, this.floatingReduced ? 0 : Math.random() * 36);
      });
      // Seed all three rows before filling the remaining horizontal space.
      if (!this.floatingReduced) {
        let added;
        do {
          added = false;
          this.floatingRows.forEach(row => {
            const tail = row.bubbles.at(-1);
            const x = tail ? tail.x + tail.width + tail.gap : 0;
            if (x < width && this.addFloatingBubble(row, x)) added = true;
          });
        } while (added);
      }
    }
    if (this.floatingMessages.classList.contains('is-reading') || this.floatingReduced) return this.stopFloatingAnimation();
    if (!this.floatingFrame) this.floatingFrame = requestAnimationFrame(time => this.animateFloating(time));
  }

  stopFloatingAnimation() {
    cancelAnimationFrame(this.floatingFrame);
    this.floatingFrame = 0;
    this.floatingLastTime = 0;
  }

  animateFloating(time) {
    this.floatingFrame = 0;
    const elapsed = this.floatingLastTime ? Math.min((time - this.floatingLastTime) / 1000, 0.05) : 0;
    this.floatingLastTime = time;
    this.floatingRows.forEach(row => {
      row.bubbles = row.bubbles.filter(bubble => {
        bubble.x -= row.speed * elapsed;
        if (bubble.x + bubble.width <= 0) {
          this.floatingActive.delete(bubble.element.dataset.wishId);
          bubble.element.remove();
          return false;
        }
        this.positionFloatingBubble(bubble);
        return true;
      });
    });
    this.floatingRows.forEach(row => {
      const tail = row.bubbles.at(-1);
      if (!tail || tail.x + tail.width + tail.gap <= this.floatingWidth) this.addFloatingBubble(row, this.floatingWidth);
    });
    this.updateFloatingAnimation();
  }

  updateFloatingVisibility() {
    const show = !this.wallVisible && !document.hidden && !document.documentElement.classList.contains('modal-open');
    this.floating.hidden = !show;
    this.floatingMessages.hidden = !this.showFloatingMessages || this.items.length === 0;
    this.floatingToggle.setAttribute('aria-expanded', String(this.showFloatingMessages));
    const toggleLabel = this.showFloatingMessages ? 'Hide floating wishes / 隐藏飘动祝福' : 'Show floating wishes / 显示飘动祝福';
    this.floatingToggle.setAttribute('aria-label', toggleLabel);
    this.floatingToggle.title = toggleLabel;
    const reading = Boolean(this.floatingHovered || this.floatingMessages.contains(document.activeElement));
    this.floatingMessages.classList.toggle('is-reading', reading);
    this.floatingMessages.querySelectorAll('.wish-floating-lane').forEach(lane => { lane.scrollLeft = 0; });
    this.updateFloatingAnimation();
    this.updateWallPlayback();
  }

  setupSamples() {
    WishesWall.sampleWishes.forEach(message => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wish-sample-option';
      button.textContent = message;
      button.addEventListener('click', () => {
        if (this.posting) return;
        this.messageInput.value = message;
        this.messageInput.dispatchEvent(new Event('input', { bubbles: true }));
        this.setSamplesOpen(false);
        this.messageInput.focus({ preventScroll: true });
        this.messageInput.setSelectionRange(message.length, message.length);
      });
      item.append(button);
      this.samplesList.append(item);
    });
    this.samplesToggle.addEventListener('click', event => {
      const open = this.samplesPanel.hidden;
      this.setSamplesOpen(open);
      if (open && event.detail === 0) this.samplesList.querySelector('button').focus();
    });
    this.samplesToggle.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.setSamplesOpen(true);
        this.samplesList.querySelector('button').focus();
      }
    });
    document.addEventListener('pointerdown', event => {
      if (!this.samplesPanel.hidden && !this.samplesPanel.contains(event.target) && !this.samplesToggle.contains(event.target)) {
        this.setSamplesOpen(false);
      }
    });
    this.samplesPanel.addEventListener('keydown', event => {
      const buttons = [...this.samplesList.querySelectorAll('button')];
      const current = buttons.indexOf(document.activeElement);
      let next;
      if (event.key === 'ArrowDown') next = (current + 1) % buttons.length;
      else if (event.key === 'ArrowUp') next = (current - 1 + buttons.length) % buttons.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = buttons.length - 1;
      if (next !== undefined) { event.preventDefault(); buttons[next].focus(); }
    });
  }

  setSamplesOpen(open) {
    this.samplesPanel.hidden = !open;
    this.samplesToggle.setAttribute('aria-expanded', String(open));
  }

  connectionError() {
    clearTimeout(this.connectionTimeout);
    this.ready = false;
    this.submit.disabled = true;
    this.setStatus('Couldn’t connect to the wishes wall. Please refresh to try again. / 暂时无法连接祝福墙，请刷新重试。', true);
    this.formStatus.textContent = this.status.textContent;
    this.formStatus.classList.add('is-error');
  }

  setStatus(message, isError = false) {
    this.status.textContent = message;
    this.status.classList.toggle('is-error', isError);
  }

  render(wishes) {
    this.wallAnchor = this.captureWallPosition();
    this.stopWallAnimation();
    this.items = wishes;
    this.renderFloating();
    this.empty.hidden = wishes.length > 0;
    this.lanes.replaceChildren();
    this.wallGroup = null;
    this.wallTrack = null;
    const shuffled = [...wishes];
    for (let index = shuffled.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
    }
    this.wallCards = shuffled.map(wish => this.createCard(wish));
    this.wallScrollable = false;
    this.wallLayoutWidth = 0;
    if (wishes.length) {
      const lane = document.createElement('div');
      lane.className = 'wishes-lane';
      this.wallTrack = document.createElement('div');
      this.wallTrack.className = 'wishes-track';
      this.wallGroup = document.createElement('div');
      this.wallGroup.className = 'wishes-group';
      this.wallGroup.append(...this.wallCards);
      this.wallTrack.append(this.wallGroup);
      lane.append(this.wallTrack);
      this.lanes.append(lane);
    }
    requestAnimationFrame(() => this.updateAnimation());
  }

  createCard(wish) {
    const card = document.createElement('article');
    card.className = 'wish-card';
    card.dataset.wishId = wish.id;
    const message = document.createElement('p');
    message.className = 'wish-message';
    message.textContent = wish.message;
    const author = document.createElement('p');
    author.className = 'wish-author';
    author.textContent = `— ${wish.name}`;
    card.append(message, author);
    return card;
  }

  layoutWall() {
    this.stopWallAnimation();
    const anchor = this.wallAnchor || this.wallReadingAnchor || this.captureWallPosition();
    this.wallAnchor = null;
    this.wallTrack.replaceChildren(this.wallGroup);
    this.wallGroup.replaceChildren(...this.wallCards);
    const gap = parseFloat(getComputedStyle(this.wallGroup).gap) || 18;
    const cards = this.wallCards.map((card, index) => ({ card, index, height: card.getBoundingClientRect().height }));
    const tallest = Math.max(...cards.map(card => card.height));
    const targetHeight = Math.max(tallest, Math.min(420, tallest * 2 + gap));
    this.wallColumnWidth = cards[0].card.getBoundingClientRect().width + gap;
    const visibleColumns = Math.ceil((this.viewport.clientWidth + gap) / this.wallColumnWidth);
    const count = Math.min(cards.length, Math.max(visibleColumns, Math.ceil(cards.reduce((sum, card) => sum + card.height + gap, 0) / (targetHeight + gap))));
    const columns = Array.from({ length: count }, () => ({ cards: [], height: 0 }));
    // Balance tall cards first, retaining each card's shuffled position within its column.
    [...cards].sort((a, b) => b.height - a.height || a.index - b.index).forEach(card => {
      const column = columns.reduce((shortest, candidate) => candidate.height < shortest.height ? candidate : shortest);
      column.cards.push(card);
      column.height += card.height + (column.cards.length > 1 ? gap : 0);
    });
    // Exchange cards between columns to reduce remaining height differences.
    for (let pass = 0; pass < 20; pass++) {
      let best = null;
      columns.forEach((a, aIndex) => columns.slice(aIndex + 1).forEach(b => {
        const oldCost = a.height ** 2 + b.height ** 2;
        a.cards.forEach((cardA, indexA) => b.cards.forEach((cardB, indexB) => {
          const change = cardB.height - cardA.height;
          const improvement = oldCost - (a.height + change) ** 2 - (b.height - change) ** 2;
          if (improvement > (best?.improvement || 1)) best = { a, b, indexA, indexB, change, improvement };
        }));
      }));
      if (!best) break;
      const { a, b, indexA, indexB, change } = best;
      [a.cards[indexA], b.cards[indexB]] = [b.cards[indexB], a.cards[indexA]];
      a.height += change;
      b.height -= change;
    }
    columns.forEach(column => column.cards.sort((a, b) => a.index - b.index));
    columns.sort((a, b) => a.cards[0].index - b.cards[0].index);
    this.wallGroup.replaceChildren(...columns.map(column => {
      const element = document.createElement('div');
      element.className = 'wish-column';
      element.append(...column.cards.map(card => card.card));
      return element;
    }));
    const groupBounds = this.wallGroup.getBoundingClientRect();
    this.wallPositions = [...this.wallGroup.children].map(column => {
      const bounds = column.getBoundingClientRect();
      return { id: column.firstElementChild.dataset.wishId, x: bounds.left - groupBounds.left, width: bounds.width };
    });
    this.wallCycleWidth = groupBounds.width;
    this.wallScrollable = this.wallCycleWidth > this.viewport.clientWidth + 1;
    if (this.wallScrollable) {
      const previous = this.wallGroup.cloneNode(true);
      const next = this.wallGroup.cloneNode(true);
      previous.setAttribute('aria-hidden', 'true');
      next.setAttribute('aria-hidden', 'true');
      this.wallTrack.replaceChildren(previous, this.wallGroup, next);
    }
    let position = this.wallScrollable ? this.wallCycleWidth : 0;
    const card = anchor && this.wallCards.find(card => card.dataset.wishId === anchor.id);
    if (card && this.wallScrollable) position += card.getBoundingClientRect().left - this.wallGroup.getBoundingClientRect().left - anchor.offset;
    this.viewport.scrollLeft = position;
    this.normalizeWallScroll();
  }

  updateAnimation() {
    const width = this.viewport.clientWidth;
    this.viewport.style.setProperty('--wishes-width', `${width}px`);
    if (this.wallGroup && width) {
      if (this.wallLayoutWidth !== width) {
        this.wallLayoutWidth = width;
        this.layoutWall();
      }
    }
    this.updateWallPlayback();
    this.updateFloatingAnimation();
  }

  captureWallPosition() {
    if (!this.wallTrack || !this.wallPositions?.length) return null;
    const left = this.wallScrollable ? ((this.viewport.scrollLeft % this.wallCycleWidth) + this.wallCycleWidth) % this.wallCycleWidth : 0;
    const column = this.wallPositions.find(column => column.x + column.width > left + 20);
    if (column) return { id: column.id, offset: column.x - left };
    return { id: this.wallPositions[0].id, offset: this.wallCycleWidth - left };
  }

  normalizeWallScroll() {
    if (this.wallScrollable) {
      const left = this.viewport.scrollLeft;
      // Native scroll positions round to pixels; allow that rounding at the loop boundary.
      if (left < this.wallCycleWidth - 1) this.viewport.scrollLeft = left + this.wallCycleWidth;
      else if (left >= this.wallCycleWidth * 2) this.viewport.scrollLeft = left - this.wallCycleWidth;
    }
    if (this.wallLayoutWidth === this.viewport.clientWidth) this.wallReadingAnchor = this.captureWallPosition();
  }

  browseWall(direction) {
    if (!this.wallScrollable) return;
    this.pauseWallTemporarily();
    this.viewport.scrollLeft += direction * this.wallColumnWidth;
    this.normalizeWallScroll();
  }

  pauseWallTemporarily() {
    this.wallResumeAt = performance.now() + 5000;
    this.updateWallPlayback();
  }

  stopWallAnimation() {
    cancelAnimationFrame(this.wallFrame);
    this.wallFrame = 0;
    this.wallLastTime = 0;
    this.wallRemainder = 0;
  }

  updateWallPlayback() {
    clearTimeout(this.wallResumeTimer);
    const keyboardReading = this.section.contains(document.activeElement) && document.activeElement.matches(':focus-visible');
    if (!this.wallTrack || !this.wallScrollable || !this.wallVisible || document.hidden ||
      document.documentElement.classList.contains('modal-open') || this.reducedMotion.matches ||
      this.section.classList.contains('is-reading') || keyboardReading) return this.stopWallAnimation();
    const delay = (this.wallResumeAt || 0) - performance.now();
    if (delay > 0) {
      this.stopWallAnimation();
      this.wallResumeTimer = setTimeout(() => this.updateWallPlayback(), delay);
      return;
    }
    if (!this.wallFrame) this.wallFrame = requestAnimationFrame(time => this.animateWall(time));
  }

  animateWall(time) {
    this.wallFrame = 0;
    const elapsed = this.wallLastTime ? Math.min((time - this.wallLastTime) / 1000, 0.05) : 0;
    this.wallLastTime = time;
    this.wallRemainder = (this.wallRemainder || 0) + elapsed * 31;
    const distance = Math.floor(this.wallRemainder);
    if (distance) {
      this.wallRemainder -= distance;
      this.viewport.scrollLeft += distance;
      this.normalizeWallScroll();
    }
    this.updateWallPlayback();
  }

  async postWish() {
    if (this.posting || !this.ready || !this.uid) return;
    const name = this.nameInput.value.trim();
    const message = this.messageInput.value.trim();
    if (!name || !message) {
      this.formStatus.textContent = 'Please enter your name and a wish. / 请填写名字和祝福。';
      this.formStatus.classList.add('is-error');
      (!name ? this.nameInput : this.messageInput).focus();
      return;
    }
    this.posting = true;
    this.setFormBusy(true);
    this.formStatus.classList.remove('is-error');
    this.formStatus.textContent = 'Sending your wish… / 正在送上祝福…';
    // Keep the same ID on a retry, including when a slow connection times out.
    this.draftRef ||= this.wishesRef.push();
    try {
      await this.withTimeout(this.draftRef.set({
        name: name.slice(0, 50), message: message.slice(0, 300),
        userId: this.uid, createdAt: firebase.database.ServerValue.TIMESTAMP
      }));
      this.draftRef = null;
      this.form.reset();
      document.getElementById('wish-character-count').textContent = '0 / 300';
      this.formStatus.textContent = '';
      this.setStatus('Your wish is on the wall. Thank you for the love! / 祝福已送达，感谢您的心意！');
      if (!this.modal.classList.contains('hidden')) window.app.ui.closeModal('wish-modal');
    } catch (error) {
      console.warn('Wish could not be confirmed.', error);
      this.formStatus.classList.add('is-error');
      this.formStatus.textContent = 'Couldn’t confirm your wish. Please try again. Your message is kept here. / 祝福暂未确认，请重试，内容已保留。';
    } finally {
      this.posting = false;
      this.setFormBusy(false);
    }
  }

  setFormBusy(busy) {
    if (busy) this.setSamplesOpen(false);
    this.samplesToggle.disabled = busy;
    this.submit.disabled = busy || !this.ready || !this.uid;
    this.submit.textContent = busy ? 'Sending… / 发送中…' : 'Send wish / 送上祝福';
    this.nameInput.disabled = busy;
    this.messageInput.disabled = busy;
    document.getElementById('btn-cancel-wish').disabled = busy;
    this.form.setAttribute('aria-busy', String(busy));
  }

  withTimeout(promise) {
    let timeout;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Connection timed out')), 15000); })
    ]).finally(() => clearTimeout(timeout));
  }

  handleDialogKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!this.samplesPanel.hidden) {
        this.setSamplesOpen(false);
        this.samplesToggle.focus({ preventScroll: true });
        return;
      }
      window.app.ui.closeModal('wish-modal');
    } else if (event.key === 'Tab') {
      const controls = [...this.modal.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')]
        .filter(control => control.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }
}
