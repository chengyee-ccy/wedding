class WishesManager {
  constructor({ adminAuth, cloudAuth, wishesRef }) {
    this.adminAuth = adminAuth;
    this.cloudAuth = cloudAuth;
    this.ref = wishesRef;
    this.body = document.getElementById('wish-admin-table-body');
    this.status = document.getElementById('wish-admin-status');
    this.retry = document.getElementById('btn-retry-wishes-management');
    this.importButton = document.getElementById('btn-import-wishes');
    this.clearButton = document.getElementById('btn-clear-wishes');
    this.fileInput = document.getElementById('wish-excel-input');
    this.preview = document.getElementById('wish-import-preview');
    this.importSummary = document.getElementById('wish-import-summary');
    this.importErrors = document.getElementById('wish-import-errors');
    this.importTable = document.getElementById('wish-import-table-wrap');
    this.importBody = document.getElementById('wish-import-table-body');
    this.confirmImport = document.getElementById('btn-confirm-wish-import');
    this.cancelImport = document.getElementById('btn-cancel-wish-import');
    this.importBatch = null;
    this.readVersion = 0;
    this.busy = false;
    this.dataLoaded = false;
    this.uid = null;
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
    this.importButton.addEventListener('click', () => {
      if (this.canChangeData()) this.fileInput.click();
    });
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files[0];
      this.fileInput.value = '';
      if (file) this.prepareImport(file);
    });
    this.confirmImport.addEventListener('click', () => this.importWishes());
    this.cancelImport.addEventListener('click', () => {
      if (this.busy) return;
      this.discardImport();
      this.importButton.focus();
    });
    this.clearButton.addEventListener('click', () => this.confirmClearAll());
    document.getElementById('btn-wish-import-template').addEventListener('click', () => this.downloadTemplate());
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
    this.updateControls();
    this.setStatus('Loading wishes… / 正在加载祝福…');
    this.showEmpty('Loading wishes… / 正在加载祝福…');
    if (!this.ref || !this.cloudAuth) return this.showLoadError();
    this.loadTimeout = setTimeout(() => this.showLoadError(), 15000);
    this.unsubscribeAuth = this.cloudAuth.onAuthStateChanged(user => {
      if (!this.isOpen) return;
      this.uid = user?.uid || null;
      if (!user) {
        this.dataLoaded = false;
        this.discardImport();
        this.updateControls();
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
        this.dataLoaded = true;
        if (!this.busy) this.setStatus('');
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
    this.dataLoaded = false;
    this.uid = null;
    this.discardImport();
    this.updateControls();
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
    this.dataLoaded = false;
    this.updateControls();
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
    this.updateControls();
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
      submitted.textContent = this.formatTime(wish.createdAt);
      const action = document.createElement('td');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wish-admin-delete text-red-500 hover:text-red-700 p-1 text-sm transition';
      button.dataset.wishId = wish.id;
      button.disabled = Boolean(this.busy) || this.pending.has(wish.id);
      button.title = this.pending.has(wish.id) ? 'Deleting… / 删除中…' : 'Delete wish / 删除祝福';
      button.setAttribute('aria-busy', String(this.pending.has(wish.id)));
      button.setAttribute('aria-label', `Delete wish from ${wish.name} / 删除祝福`);
      const icon = document.createElement('i');
      icon.className = this.pending.has(wish.id) ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-trash-can';
      icon.setAttribute('aria-hidden', 'true');
      button.append(icon);
      action.append(button);
      row.append(name, message, submitted, action);
      return row;
    });
    this.body.replaceChildren(...rows);
  }

  confirmDelete(id) {
    if (!this.canChangeData()) return;
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
    if (!this.canChangeData()) return;
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

  canChangeData() {
    return this.isOpen && this.adminAuth.isAuthenticated && this.dataLoaded && Boolean(this.uid) && !this.busy && !this.pending.size;
  }

  updateControls() {
    const enabled = this.canChangeData();
    this.importButton.disabled = !enabled;
    this.clearButton.disabled = !enabled || !this.entries.length;
    this.confirmImport.disabled = !enabled || !this.importBatch;
    this.cancelImport.disabled = Boolean(this.busy);
    this.preview.setAttribute('aria-busy', String(Boolean(this.busy)));
  }

  formatTime(timestamp) {
    if (!timestamp || !Number.isFinite(timestamp)) return '—';
    const parts = Object.fromEntries(this.timeFormat.formatToParts(timestamp).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  }

  discardImport() {
    this.readVersion++;
    this.importBatch = null;
    this.preview.hidden = true;
    this.importBody.replaceChildren();
    this.updateControls();
  }

  parseImportDate(value, date1904) {
    if (value == null || String(value).trim() === '') return null;
    let parts;
    if (typeof value === 'number') {
      const date = XLSX.SSF.parse_date_code(value, { date1904 });
      if (date) parts = [date.y, date.m, date.d, date.H, date.M, date.S];
    } else {
      const match = String(value).trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
      if (match) parts = match.slice(1).map(part => Number(part || 0));
    }
    if (!parts) throw new Error('Submitted must be an Excel date or YYYY-MM-DD HH:mm:ss (MYT). / 提交时间须为Excel日期或 YYYY-MM-DD HH:mm:ss（马来西亚时间）。');
    const [year, month, day, hour, minute, second] = parts;
    const local = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (year < 1900 || local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day || local.getUTCHours() !== hour || local.getUTCMinutes() !== minute || local.getUTCSeconds() !== second) {
      throw new Error('Invalid submitted date. / 提交日期无效。');
    }
    return local.getTime() - 8 * 60 * 60 * 1000;
  }

  parseWorkbook(workbook) {
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error('The workbook has no worksheet. / 文件中没有工作表。');
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true });
    const filled = row => row.some(value => String(value ?? '').trim());
    const headerRow = rows.findIndex(filled);
    if (headerRow < 0) throw new Error('The worksheet is empty. / 工作表为空。');
    const headers = rows[headerRow].map(value => String(value).toLowerCase().split(/[\/|]/).map(part => part.replace(/[\s_-]/g, '')));
    const column = aliases => headers.findIndex(parts => parts.some(part => aliases.includes(part)));
    const nameColumn = column(['name', 'guestname', '姓名', '名字']);
    const messageColumn = column(['wish', 'wishes', 'message', 'wishmessage', '祝福', '祝福内容', '留言', '内容', '弹幕内容']);
    const timeColumn = column(['submitted', 'submittedat', 'createdat', 'time', '提交时间', '提交時間', '时间', '時間']);
    if (nameColumn < 0 || messageColumn < 0) throw new Error('Add Name and Wish column headings. Chinese headings 姓名 and 祝福内容 are also accepted. / 请添加姓名与祝福内容列标题。');
    const entries = [], errors = [];
    for (let index = headerRow + 1; index < rows.length; index++) {
      const row = rows[index];
      if (!filled(row)) continue;
      const name = String(row[nameColumn] ?? '').trim();
      const message = String(row[messageColumn] ?? '').trim();
      try {
        if (!name || !message) throw new Error('Name and Wish are required. / 姓名与祝福内容不能为空。');
        if (name.length > 50 || message.length > 300) throw new Error('Name: maximum 50 characters; Wish: maximum 300. / 姓名最多50字，祝福最多300字。');
        const createdAt = this.parseImportDate(timeColumn < 0 ? null : row[timeColumn], Boolean(workbook.Workbook?.WBProps?.date1904));
        entries.push({ name, message, createdAt });
      } catch (error) {
        errors.push(`Row ${index + 1} / 第${index + 1}行: ${error.message}`);
      }
    }
    if (errors.length) throw new Error(errors.slice(0, 6).join('\n') + (errors.length > 6 ? `\n… ${errors.length} rows need correction. / 共${errors.length}行需要修改。` : ''));
    if (!entries.length) throw new Error('No wishes to import. / 没有可导入的祝福。');
    return entries;
  }

  async prepareImport(file) {
    if (!this.canChangeData()) return;
    this.discardImport();
    const version = this.readVersion;
    this.busy = 'reading';
    this.render();
    this.setStatus('Reading Excel… / 正在读取Excel…');
    try {
      if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error('Choose an .xlsx or .xls file. / 请选择.xlsx或.xls文件。');
      if (typeof XLSX === 'undefined') throw new Error('Excel tools couldn’t load. Refresh and try again. / Excel工具加载失败，请刷新重试。');
      const data = await file.arrayBuffer();
      if (version !== this.readVersion || !this.isOpen || !this.adminAuth.isAuthenticated) return;
      const workbook = XLSX.read(data, { type: 'array' });
      const entries = this.parseWorkbook(workbook);
      this.importBatch = { entries, updates: null };
      this.importSummary.textContent = `${file.name} — ${entries.length} wishes to add / 将新增${entries.length}条祝福。 Preview: first ${Math.min(5, entries.length)} / 预览前${Math.min(5, entries.length)}条。 Blank dates use import time / 空白日期使用导入时间。`;
      this.importErrors.hidden = true;
      this.importBody.replaceChildren(...entries.slice(0, 5).map(wish => {
        const row = document.createElement('tr');
        [wish.name, wish.message, wish.createdAt == null ? 'Import time / 导入时间' : this.formatTime(wish.createdAt)].forEach(text => {
          const cell = document.createElement('td');
          cell.textContent = text;
          row.append(cell);
        });
        return row;
      }));
      this.importTable.hidden = false;
      this.confirmImport.textContent = `Import ${entries.length} wishes / 导入${entries.length}条祝福`;
    } catch (error) {
      if (version !== this.readVersion || !this.isOpen) return;
      this.importSummary.textContent = file.name;
      this.importErrors.textContent = error.message || 'Couldn’t read this Excel file. / 无法读取此Excel文件。';
      this.importErrors.hidden = false;
      this.importTable.hidden = true;
    } finally {
      this.busy = false;
      if (this.isOpen && this.adminAuth.isAuthenticated) {
        this.setStatus('');
        this.render();
        if (version === this.readVersion) {
          this.preview.hidden = false;
          this.preview.focus();
        }
      }
    }
  }

  async importWishes() {
    if (!this.canChangeData() || !this.importBatch) return;
    const batch = this.importBatch;
    // Reuse IDs on retry so an unconfirmed import cannot add a second copy.
    batch.updates ||= Object.fromEntries(batch.entries.map(wish => [this.ref.push().key, {
      ...wish, userId: this.uid, createdAt: wish.createdAt ?? firebase.database.ServerValue.TIMESTAMP
    }]));
    this.busy = 'importing';
    this.render();
    this.setStatus('Importing wishes… / 正在导入祝福…');
    let imported = false;
    try {
      await this.writeBatch(batch.updates);
      if (this.isOpen && this.adminAuth.isAuthenticated) {
        this.discardImport();
        this.setStatus(`${batch.entries.length} wishes imported. / 已导入${batch.entries.length}条祝福。`);
        imported = true;
      }
    } catch (error) {
      console.warn('Wish import could not be confirmed.', error);
      if (this.isOpen) this.setStatus('Couldn’t confirm import. Try importing the preview again. / 导入暂未确认，请再次导入预览内容。', true);
    } finally {
      this.busy = false;
      if (this.isOpen && this.adminAuth.isAuthenticated) {
        this.render();
        if (imported) this.importButton.focus();
      }
    }
  }

  confirmClearAll() {
    if (!this.canChangeData() || !this.entries.length) return;
    window.app.ui.showConfirmation(
      'Clear all wishes? / 删除全部祝福？',
      `Permanently delete all <strong>${this.entries.length}</strong> wishes from the table and Wishes Wall? This cannot be undone.<br>确定删除表格与祝福墙的全部留言吗？删除后无法恢复。`,
      () => this.clearAll(), 'Clear all / 确定删除全部'
    );
  }

  async clearAll() {
    if (!this.canChangeData() || !this.entries.length) return;
    // One atomic update, restricted to the wishes present when Clear all is confirmed.
    const updates = Object.fromEntries(this.entries.map(wish => [wish.id, null]));
    this.busy = 'clearing';
    this.render();
    this.setStatus('Clearing wishes… / 正在删除全部祝福…');
    try {
      await this.writeBatch(updates);
      if (this.isOpen) this.setStatus('All wishes cleared. / 全部祝福已删除。');
    } catch (error) {
      console.warn('Clearing wishes could not be confirmed.', error);
      if (this.isOpen) this.setStatus('Couldn’t confirm clearing. Please refresh and try again. / 删除暂未确认，请刷新后重试。', true);
    } finally {
      this.busy = false;
      if (this.isOpen && this.adminAuth.isAuthenticated) this.render();
    }
  }

  async writeBatch(updates) {
    let timeout;
    try {
      await Promise.race([
        this.ref.update(updates),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Save confirmation timed out')), 15000); })
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  downloadTemplate() {
    if (!this.adminAuth.isAuthenticated || !this.isOpen) return;
    if (typeof XLSX === 'undefined') return this.setStatus('Excel tools couldn’t load. Refresh and try again. / Excel工具加载失败，请刷新重试。', true);
    const sheet = XLSX.utils.aoa_to_sheet([['Name', 'Wish', 'Submitted']]);
    sheet['!cols'] = [{ wch: 20 }, { wch: 60 }, { wch: 24 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Wishes');
    XLSX.writeFile(workbook, 'wishes-import-template.xlsx');
  }
}
