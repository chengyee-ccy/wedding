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
    this.floatingMessages.addEventListener('animationend', event => {
      if (event.animationName !== 'wish-floating-travel' || !event.target.matches('.wish-floating-bubble') || !this.items.length) return;
      const bubble = event.target;
      // Rows finish at different times, so reserve wishes still assigned to other rows.
      const occupied = new Set([...this.floatingMessages.querySelectorAll('.wish-floating-bubble')]
        .filter(other => other !== bubble).map(other => other.dataset.wishId));
      const current = Number(bubble.dataset.sequence);
      let next = current;
      for (let offset = 1; offset <= this.items.length; offset++) {
        const candidate = (current + offset) % this.items.length;
        if (!occupied.has(this.items[candidate].id)) {
          next = candidate;
          break;
        }
      }
      this.setFloatingWish(bubble, next);
      bubble.dataset.initialPhase = '0';
      bubble.style.animationName = 'none';
      this.updateFloatingAnimation();
      void bubble.offsetWidth;
      bubble.style.removeProperty('animation-name');
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
    this.reducedMotion.addEventListener('change', () => this.updateFloatingVisibility());

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
    const update = () => this.section.classList.toggle('is-reading', hovered || tapped || Boolean(gesture));
    const cancelGesture = () => { gesture = null; update(); };

    ['pointerenter', 'pointerleave'].forEach(type => {
      this.viewport.addEventListener(type, event => {
        if (event.pointerType !== 'mouse') return;
        hovered = type === 'pointerenter';
        update();
      });
    });
    this.viewport.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'touch' || !event.isPrimary) return;
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, wasPaused: tapped };
      update();
    }, { passive: true });
    this.viewport.addEventListener('pointermove', event => {
      if (gesture?.id === event.pointerId && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 10) cancelGesture();
    }, { passive: true });
    this.viewport.addEventListener('pointerup', event => {
      if (gesture?.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) <= 10) tapped = !gesture.wasPaused;
      cancelGesture();
    }, { passive: true });
    this.viewport.addEventListener('pointercancel', event => {
      if (gesture?.id === event.pointerId) cancelGesture();
    }, { passive: true });
    document.addEventListener('pointerdown', event => {
      if (!this.viewport.contains(event.target)) {
        tapped = false;
        cancelGesture();
      }
    }, { passive: true });
    this.resetReadingPause = () => { hovered = false; tapped = false; cancelGesture(); };
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
    this.floatingMessages.replaceChildren();
    const count = Math.min(3, this.items.length);
    for (let index = 0; index < count; index++) {
      const lane = document.createElement('div');
      lane.className = 'wish-floating-lane';
      const bubble = document.createElement('button');
      bubble.type = 'button';
      bubble.className = 'wish-floating-bubble';
      bubble.dataset.initialPhase = String((index + 1) / 4);
      bubble.title = 'Read full wish / 查看完整祝福';
      bubble.setAttribute('aria-haspopup', 'dialog');
      bubble.setAttribute('aria-controls', 'wish-detail-modal');
      const name = document.createElement('strong');
      const message = document.createElement('span');
      bubble.append(name, message);
      this.setFloatingWish(bubble, index);
      lane.append(bubble);
      this.floatingMessages.append(lane);
    }
    if (focusedId) {
      const replacement = [...this.floatingMessages.querySelectorAll('button')].find(button => button.dataset.wishId === focusedId);
      (replacement || this.floatingAdd).focus({ preventScroll: true });
    }
    this.updateFloatingVisibility();
  }

  setFloatingWish(bubble, index) {
    const wish = this.items[index];
    bubble.dataset.sequence = String(index);
    bubble.dataset.wishId = wish.id;
    bubble.querySelector('strong').textContent = `${wish.name}:`;
    bubble.querySelector('span').textContent = wish.message;
  }

  updateFloatingAnimation() {
    const width = this.floatingMessages.clientWidth;
    if (!width) return;
    this.floatingMessages.style.setProperty('--floating-width', `${width}px`);
    this.floatingMessages.querySelectorAll('.wish-floating-bubble').forEach((bubble, index) => {
      const duration = Math.max(9, (width + bubble.getBoundingClientRect().width) / (36 + index * 4));
      bubble.style.setProperty('--floating-duration', `${duration}s`);
      bubble.style.setProperty('--floating-delay', `${-duration * Number(bubble.dataset.initialPhase)}s`);
    });
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
    if (!reading) {
      this.floatingMessages.querySelectorAll('.wish-floating-lane').forEach(lane => { lane.scrollLeft = 0; });
    }
    if (show && this.showFloatingMessages) this.updateFloatingAnimation();
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
    this.items = wishes;
    this.renderFloating();
    this.empty.hidden = wishes.length > 0;
    this.lanes.replaceChildren();
    for (let row = 0; row < Math.min(2, wishes.length); row++) {
      const lane = document.createElement('div');
      lane.className = 'wishes-lane';
      const track = document.createElement('div');
      track.className = 'wishes-track';
      const group = document.createElement('div');
      group.className = 'wishes-group';
      wishes.filter((_, index) => index % 2 === row).forEach(wish => group.append(this.createCard(wish)));
      const duplicate = group.cloneNode(true);
      duplicate.setAttribute('aria-hidden', 'true');
      track.append(group, duplicate);
      lane.append(track);
      this.lanes.append(lane);
    }
    requestAnimationFrame(() => this.updateAnimation());
  }

  createCard(wish) {
    const card = document.createElement('article');
    card.className = 'wish-card';
    const message = document.createElement('p');
    message.className = 'wish-message';
    message.textContent = wish.message;
    const author = document.createElement('p');
    author.className = 'wish-author';
    author.textContent = `— ${wish.name}`;
    card.append(message, author);
    return card;
  }

  updateAnimation() {
    this.viewport.style.setProperty('--wishes-width', `${Math.ceil(this.viewport.clientWidth)}px`);
    this.lanes.querySelectorAll('.wishes-track').forEach((track, index) => {
      const width = track.firstElementChild.getBoundingClientRect().width;
      track.style.setProperty('--wish-duration', `${Math.max(18, width / (index ? 25 : 31))}s`);
    });
    this.updateFloatingAnimation();
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
