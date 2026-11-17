class WishesManager {
  constructor({ adminAuth, cloudAuth, wishesRef }) {
    this.adminAuth = adminAuth;
    this.cloudAuth = cloudAuth;
    this.ref = wishesRef;
    this.body = document.getElementById('wish-admin-table-body');
    this.status = document.getElementById('wish-admin-status');
    this.retry = document.getElementById('btn-retry-wishes-management');
    this.sortHeaders = [...document.querySelectorAll('.wish-admin-table th[data-wish-sort]')];
    this.sortState = { column: 'createdAt', direction: 'asc' };
    this.entries = [];
    this.pending = new Set();
    this.isOpen = false;
    this.timeFormat = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
  }

  init() {
    this.sortHeaders.forEach(header => {
      header.addEventListener('click', () => this.sortBy(header.dataset.wishSort));
    });
    this.updateSortIndicators();
    this.retry.addEventListener('click', () => this.open());
    this.body.addEventListener('click', event => {
      const button = event.target.closest('.wish-admin-delete');
      if (button && !button.disabled) this.confirmDelete(button.dataset.wishId);
    });
    this.adminAuth.registerCallback(authenticated => {
      if (!authenticated) {
        this.close();
        this.showEmpty('Unlock management to view wishes. / 请先解锁管理功能。');
      }
    });
  }

  open() {
    this.close();
    if (!this.adminAuth.isAuthenticated) return;
    this.isOpen = true;
    this.setStatus('Loading wishes… / 正在加载祝福…');
    this.showEmpty('Loading wishes… / 正在加载祝福…');
    if (!this.ref || !this.cloudAuth) return this.showLoadError();
    this.loadTimeout = setTimeout(() => this.showLoadError(), 15000);
    this.unsubscribeAuth = this.cloudAuth.onAuthStateChanged(user => {
      if (!this.isOpen) return;
      if (!user) {
        this.detachData();
        this.setStatus('Connecting… / 正在连接…');
        this.showEmpty('Connecting… / 正在连接…');
        clearTimeout(this.loadTimeout);
        this.loadTimeout = setTimeout(() => this.showLoadError(), 15000);
        return;
      }
      if (this.valueListener) return;
      this.valueListener = snapshot => {
        if (!this.isOpen || !this.adminAuth.isAuthenticated) return;
        clearTimeout(this.loadTimeout);
        // Read every wish for management, including entries outside the public wall's limit.
        this.entries = Object.entries(snapshot.val() || {}).map(([id, wish]) => ({
          id,
          name: typeof wish?.name === 'string' ? wish.name : '—',
          message: typeof wish?.message === 'string' ? wish.message : (typeof wish === 'string' ? wish : '—'),
          createdAt: Number(wish?.createdAt) || 0
        }));
        this.setStatus('');
        this.render();
      };
      this.ref.on('value', this.valueListener, error => {
        console.warn('Wish management could not load.', error);
        if (this.isOpen) this.showLoadError();
      });
    });
  }

  close() {
    this.isOpen = false;
    clearTimeout(this.loadTimeout);
    this.unsubscribeAuth?.();
    this.unsubscribeAuth = null;
    this.detachData();
  }

  detachData() {
    if (this.valueListener) this.ref.off('value', this.valueListener);
    this.valueListener = null;
  }

  setStatus(message, isError = false) {
    this.status.textContent = message;
    this.status.classList.toggle('is-error', isError);
    this.retry.hidden = !isError;
  }

  showLoadError() {
    clearTimeout(this.loadTimeout);
    this.setStatus('Couldn’t load wishes. Please try again. / 祝福加载失败，请重试。', true);
    if (this.entries.length) this.render();
    else this.showEmpty('Wishes are temporarily unavailable. / 暂时无法加载祝福。');
  }

  showEmpty(message) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.className = 'wish-admin-empty';
    cell.textContent = message;
    row.append(cell);
    this.body.replaceChildren(row);
  }

  sortBy(column) {
    if (!this.isOpen || !this.adminAuth.isAuthenticated || !['name', 'message', 'createdAt'].includes(column)) return;
    if (this.sortState.column === column) {
      this.sortState.direction = this.sortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortState.column = column;
      this.sortState.direction = 'asc';
    }
    this.render();
  }

  getSortedEntries() {
    const { column, direction } = this.sortState;
    return [...this.entries].sort((a, b) => {
      const aValue = column === 'createdAt' ? a.createdAt : a[column].toLowerCase();
      const bValue = column === 'createdAt' ? b.createdAt : b[column].toLowerCase();
      const comparison = aValue < bValue ? -1 : (aValue > bValue ? 1 : 0);
      if (comparison) return direction === 'asc' ? comparison : -comparison;
      return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
    });
  }

  updateSortIndicators() {
    const { column, direction } = this.sortState;
    this.sortHeaders.forEach(header => {
      const active = header.dataset.wishSort === column;
      header.querySelector('.wish-admin-sort-indicator').textContent = active ? (direction === 'asc' ? '▲' : '▼') : '';
      if (active) header.setAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending');
      else header.removeAttribute('aria-sort');
      header.querySelector('button').title = active && direction === 'asc' ? 'Sort descending / 降序排列' : 'Sort ascending / 升序排列';
    });
  }

  render() {
    this.updateSortIndicators();
    if (!this.entries.length) return this.showEmpty('No wishes yet. / 暂无祝福留言。');
    const rows = this.getSortedEntries().map(wish => {
      const row = document.createElement('tr');
      row.dataset.wishId = wish.id;
      const name = document.createElement('td');
      name.textContent = wish.name;
      const message = document.createElement('td');
      message.className = 'wish-admin-message';
      message.textContent = wish.message;
      const submitted = document.createElement('td');
      submitted.className = 'wish-admin-time';
      if (wish.createdAt > 0 && Number.isFinite(wish.createdAt)) {
        const parts = Object.fromEntries(this.timeFormat.formatToParts(wish.createdAt).map(part => [part.type, part.value]));
        submitted.textContent = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
      } else submitted.textContent = '—';
      const action = document.createElement('td');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wish-admin-delete text-red-500 hover:text-red-700 p-1 text-sm transition';
      button.dataset.wishId = wish.id;
      button.disabled = this.pending.has(wish.id);
      button.title = button.disabled ? 'Deleting… / 删除中…' : 'Delete wish / 删除祝福';
      button.setAttribute('aria-busy', String(button.disabled));
      button.setAttribute('aria-label', `Delete wish from ${wish.name} / 删除祝福`);
      const icon = document.createElement('i');
      icon.className = button.disabled ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-trash-can';
      icon.setAttribute('aria-hidden', 'true');
      button.append(icon);
      action.append(button);
      row.append(name, message, submitted, action);
      return row;
    });
    this.body.replaceChildren(...rows);
  }

  confirmDelete(id) {
    if (!this.adminAuth.isAuthenticated || !this.isOpen || this.pending.has(id)) return;
    const wish = this.entries.find(entry => entry.id === id);
    if (!wish) return;
    const escapedName = document.createElement('span');
    escapedName.textContent = wish.name;
    window.app.ui.showConfirmation(
      'Delete wish? / 删除祝福？',
      `Delete the wish from <strong>${escapedName.innerHTML}</strong>? This cannot be undone.<br>确定删除这条祝福吗？删除后无法恢复。`,
      () => this.deleteWish(id), 'Delete / 确定删除'
    );
  }

  async deleteWish(id) {
    if (!this.adminAuth.isAuthenticated || this.pending.has(id)) return;
    this.pending.add(id);
    this.render();
    let timeout;
    try {
      await Promise.race([
        this.ref.child(id).remove(),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Delete confirmation timed out')), 15000); })
      ]);
      if (this.isOpen) this.setStatus('Wish deleted. / 祝福已删除。');
    } catch (error) {
      console.warn('Wish deletion could not be confirmed.', error);
      if (this.isOpen) this.setStatus('Couldn’t confirm deletion. Please refresh and try again. / 删除暂未确认，请刷新后重试。', true);
    } finally {
      clearTimeout(timeout);
      this.pending.delete(id);
      if (this.isOpen && this.adminAuth.isAuthenticated) this.render();
    }
  }
}
