const els = {
  origins: document.getElementById('origins'),
  message: document.getElementById('message'),
  deleteSelected: document.getElementById('delete-selected'),
  selectedCount: document.getElementById('selected-count'),
  exportRules: document.getElementById('export-rules'),
  importRules: document.getElementById('import-rules'),
  importFile: document.getElementById('import-file'),
  modal: document.getElementById('raw-editor-modal'),
  closeModal: document.getElementById('close-modal'),
  rawJson: document.getElementById('raw-json'),
  saveRaw: document.getElementById('save-raw'),
  cancelRaw: document.getElementById('cancel-raw'),
  exportModal: document.getElementById('export-modal'),
  closeExport: document.getElementById('close-export'),
  exportSelectAll: document.getElementById('export-select-all'),
  exportClearAll: document.getElementById('export-clear-all'),
  exportCount: document.getElementById('export-count'),
  exportOrigins: document.getElementById('export-origins'),
  exportConfirm: document.getElementById('export-confirm'),
  exportCancel: document.getElementById('export-cancel'),
};

let exportSelection = new Set();

const KEY_SEPARATOR = '\u001f';
const FLASH_MESSAGE_KEY = 'osintGuardRulesFlashMessage';

let view = null;
let selectedRules = new Set();
let editingRule = null;

els.deleteSelected.addEventListener('click', deleteSelectedRules);
els.exportRules.addEventListener('click', openExportModal);
els.importRules.addEventListener('click', () => els.importFile.click());
els.importFile.addEventListener('change', importRules);

els.closeModal.addEventListener('click', hideModal);
els.cancelRaw.addEventListener('click', hideModal);
els.saveRaw.addEventListener('click', saveRawRule);

els.closeExport.addEventListener('click', hideExportModal);
els.exportCancel.addEventListener('click', hideExportModal);
els.exportConfirm.addEventListener('click', performExport);
els.exportSelectAll.addEventListener('click', () => {
  for (const origin of Object.keys(view?.origins || {})) exportSelection.add(origin);
  renderExportModal();
});
els.exportClearAll.addEventListener('click', () => {
  exportSelection.clear();
  renderExportModal();
});

loadRules();

async function loadRules() {
  try {
    view = await chrome.runtime.sendMessage({ type: 'OSINT_GET_RULES' });
    if (!view?.ok) throw new Error(view?.error || 'Could not load rules');
    render();
    const flashMessage = sessionStorage.getItem(FLASH_MESSAGE_KEY);
    if (flashMessage) {
      sessionStorage.removeItem(FLASH_MESSAGE_KEY);
      setMessage(flashMessage);
    }
  } catch (error) {
    setMessage(error.message || String(error));
  }
}

function render() {
  pruneSelection();
  renderSelectionState();
  els.origins.replaceChildren();
  const entries = Object.entries(view.origins || {}).sort(([a], [b]) => a.localeCompare(b));

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No site rules yet. Enable training mode from the extension popup to start learning.';
    els.origins.appendChild(empty);
    return;
  }

  for (const [origin, originState] of entries) {
    els.origins.appendChild(renderOrigin(origin, originState));
  }
}

function renderOrigin(origin, originState) {
  const section = document.createElement('section');
  section.className = 'origin';

  const header = document.createElement('div');
  header.className = 'origin-header';

  const titleWrap = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'origin-title';
  title.textContent = origin;
  const meta = document.createElement('div');
  meta.className = 'origin-meta';
  meta.textContent = [
    originState.permissionGranted ? 'access granted' : 'access not granted',
    originState.trainingEnabled ? 'training on' : 'training off',
    originState.protectionEnabled ? 'protection on' : 'protection off',
    originState.protectionAllowOnce ? 'allow-once on' : 'allow-once off',
  ].join(' | ');
  titleWrap.appendChild(title);
  titleWrap.appendChild(meta);

  const count = document.createElement('div');
  count.className = 'origin-meta';
  count.textContent = `${originState.rules.length} rules`;

  header.appendChild(titleWrap);
  header.appendChild(count);
  section.appendChild(header);

  const table = document.createElement('table');
  table.className = 'rules';
  table.appendChild(renderHead(origin, originState));
  const body = document.createElement('tbody');
  for (const rule of originState.rules) {
    body.appendChild(renderRule(origin, rule));
  }
  table.appendChild(body);
  section.appendChild(table);

  return section;
}

function renderHead(origin, originState) {
  const head = document.createElement('thead');
  const row = document.createElement('tr');

  const selectAllCell = document.createElement('th');
  selectAllCell.className = 'select-cell';
  const selectAll = document.createElement('input');
  selectAll.type = 'checkbox';
  selectAll.setAttribute('aria-label', `Select all rules for ${origin}`);
  const keys = originState.rules.map((rule) => selectionKey(origin, rule.id));
  const selectedCount = keys.filter((key) => selectedRules.has(key)).length;
  selectAll.checked = keys.length > 0 && selectedCount === keys.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < keys.length;
  selectAll.disabled = keys.length === 0;
  selectAll.addEventListener('change', () => {
    for (const key of keys) {
      if (selectAll.checked) selectedRules.add(key);
      else selectedRules.delete(key);
    }
    render();
  });
  selectAllCell.appendChild(selectAll);
  row.appendChild(selectAllCell);

  for (const label of ['Enabled', 'Kind', 'Rule', 'Action', 'Hits', 'Actions']) {
    const th = document.createElement('th');
    th.textContent = label;
    row.appendChild(th);
  }
  head.appendChild(row);
  return head;
}

function renderRule(origin, rule) {
  const row = document.createElement('tr');
  const key = selectionKey(origin, rule.id);

  const selectCell = document.createElement('td');
  selectCell.className = 'select-cell';
  const selected = document.createElement('input');
  selected.type = 'checkbox';
  selected.checked = selectedRules.has(key);
  selected.setAttribute('aria-label', `Select ${rule.label || rule.id}`);
  selected.addEventListener('change', () => {
    if (selected.checked) selectedRules.add(key);
    else selectedRules.delete(key);
    render();
  });
  selectCell.appendChild(selected);

  const enabledCell = document.createElement('td');
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = rule.enabled;
  enabled.addEventListener('change', () => updateRule(origin, rule.id, { enabled: enabled.checked }));
  enabledCell.appendChild(enabled);

  const kindCell = document.createElement('td');
  const currentKind = rule.kind === 'allow' ? 'allow' : 'block';
  if (rule.source === 'starter') {
    const kindLabel = document.createElement('span');
    kindLabel.className = `rule-kind rule-kind-${currentKind}`;
    kindLabel.textContent = 'Block';
    kindLabel.title = 'Starter rules can only Block. Delete it or add a learned Allow rule to override.';
    kindCell.appendChild(kindLabel);
  } else {
    const kind = document.createElement('select');
    kind.className = `rule-kind rule-kind-${currentKind}`;
    for (const [value, text] of [['block', 'Block'], ['allow', 'Allow']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      if (value === currentKind) option.selected = true;
      kind.appendChild(option);
    }
    kind.addEventListener('change', () => updateRule(origin, rule.id, { kind: kind.value }));
    kindCell.appendChild(kind);
  }

  const labelCell = document.createElement('td');
  const label = document.createElement('div');
  label.className = 'rule-label';
  label.textContent = rule.label || 'Rule';
  const source = document.createElement('div');
  source.className = 'rule-source';
  source.textContent = `${rule.source || 'learned'} · ${rule.id}`;
  labelCell.appendChild(label);
  labelCell.appendChild(source);

  const actionCell = document.createElement('td');
  actionCell.textContent = rule.actionKey || '-';

  const hitsCell = document.createElement('td');
  hitsCell.textContent = String(rule.hitCount || 0);

  const actionsCell = document.createElement('td');
  const actionWrap = document.createElement('div');
  actionWrap.style.display = 'flex';
  actionWrap.style.gap = '6px';

  const raw = document.createElement('button');
  raw.type = 'button';
  raw.textContent = 'Raw';
  raw.addEventListener('click', () => showRawEditor(origin, rule));

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'danger';
  remove.textContent = 'Delete';
  remove.addEventListener('click', () => deleteRule(origin, rule.id));

  actionWrap.appendChild(raw);
  actionWrap.appendChild(remove);
  actionsCell.appendChild(actionWrap);

  row.appendChild(selectCell);
  row.appendChild(enabledCell);
  row.appendChild(kindCell);
  row.appendChild(labelCell);
  row.appendChild(actionCell);
  row.appendChild(hitsCell);
  row.appendChild(actionsCell);
  return row;
}

function showRawEditor(origin, rule) {
  editingRule = { origin, ruleId: rule.id };
  els.rawJson.value = JSON.stringify(rule, null, 2);
  els.modal.removeAttribute('hidden');
  els.rawJson.focus();
}

function hideModal() {
  els.modal.setAttribute('hidden', '');
  editingRule = null;
}

async function saveRawRule() {
  if (!editingRule) return;
  let changes;
  try {
    changes = JSON.parse(els.rawJson.value);
  } catch (error) {
    alert(`Invalid JSON: ${error.message}`);
    return;
  }

  try {
    await updateRule(editingRule.origin, editingRule.ruleId, changes);
    hideModal();
  } catch (error) {
    setMessage(error.message || String(error));
  }
}

async function updateRule(origin, ruleId, changes) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'OSINT_UPDATE_RULE',
      origin,
      ruleId,
      changes,
    });
    if (!response?.ok) throw new Error(response?.error || 'Update failed');
    view = response;
    render();
    setMessage('Rule updated.');
  } catch (error) {
    setMessage(error.message || String(error));
    await loadRules();
  }
}

async function deleteRule(origin, ruleId) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'OSINT_DELETE_RULE',
      origin,
      ruleId,
    });
    if (!response?.ok) throw new Error(response?.error || 'Delete failed');
    view = response;
    selectedRules.delete(selectionKey(origin, ruleId));
    render();
    setMessage('Rule deleted.');
  } catch (error) {
    setMessage(error.message || String(error));
  }
}

async function deleteSelectedRules() {
  const items = [...selectedRules].map(parseSelectionKey).filter((item) => item.origin && item.ruleId);
  if (!items.length) return;

  const label = `${items.length} selected rule${items.length === 1 ? '' : 's'}`;
  if (!confirm(`Delete ${label}? Starter rules will stay removed for this site.`)) return;

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'OSINT_DELETE_RULES',
      items,
    });
    if (!response?.ok) throw new Error(response?.error || 'Delete failed');
    view = response;
    selectedRules.clear();
    render();
    sessionStorage.setItem(FLASH_MESSAGE_KEY, `Deleted ${label}.`);
    window.location.reload();
  } catch (error) {
    setMessage(error.message || String(error));
    await loadRules();
  }
}

function openExportModal() {
  const origins = Object.keys(view?.origins || {});
  if (!origins.length) {
    setMessage('No rules to export yet.');
    return;
  }
  // Default to all selected so the common "export everything" case is one click.
  exportSelection = new Set(origins);
  renderExportModal();
  els.exportModal.removeAttribute('hidden');
}

function hideExportModal() {
  els.exportModal.setAttribute('hidden', '');
}

function renderExportModal() {
  els.exportOrigins.replaceChildren();
  const origins = Object.entries(view?.origins || {}).sort(([a], [b]) => a.localeCompare(b));
  for (const [origin, originState] of origins) {
    const row = document.createElement('label');
    row.className = 'export-origin-row';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = exportSelection.has(origin);
    input.addEventListener('change', () => {
      if (input.checked) exportSelection.add(origin);
      else exportSelection.delete(origin);
      updateExportFooter();
    });

    const info = document.createElement('div');
    info.className = 'export-origin-info';
    const name = document.createElement('div');
    name.className = 'export-origin-name';
    name.textContent = origin;
    const count = document.createElement('div');
    count.className = 'export-origin-count';
    const ruleCount = originState.rules?.length || 0;
    count.textContent = `${ruleCount} rule${ruleCount === 1 ? '' : 's'}`;
    info.appendChild(name);
    info.appendChild(count);

    row.appendChild(input);
    row.appendChild(info);
    els.exportOrigins.appendChild(row);
  }
  updateExportFooter();
}

function updateExportFooter() {
  const count = exportSelection.size;
  els.exportCount.textContent = `${count} selected`;
  els.exportConfirm.disabled = count === 0;
}

async function performExport() {
  const origins = [...exportSelection];
  if (!origins.length) return;

  const all = origins.length === Object.keys(view?.origins || {}).length;
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'OSINT_EXPORT_RULES',
      origins: all ? undefined : origins,
    });
    if (!response?.ok) throw new Error(response?.error || 'Export failed');

    const blob = new Blob([JSON.stringify(response.payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = exportFilename(origins, all);
    link.click();
    URL.revokeObjectURL(url);
    hideExportModal();
    setMessage(`Exported ${origins.length} site${origins.length === 1 ? '' : 's'}.`);
  } catch (error) {
    setMessage(error.message || String(error));
  }
}

function exportFilename(origins, all) {
  if (all) return 'no-way-rules.json';
  if (origins.length === 1) {
    const host = (() => {
      try { return new URL(origins[0]).hostname; } catch (_) { return 'site'; }
    })();
    return `no-way-rules-${host}.json`;
  }
  return `no-way-rules-${origins.length}-sites.json`;
}

async function importRules() {
  const file = els.importFile.files?.[0];
  els.importFile.value = '';
  if (!file) return;

  try {
    const payload = JSON.parse(await file.text());
    const response = await chrome.runtime.sendMessage({ type: 'OSINT_IMPORT_RULES', payload });
    if (!response?.ok) throw new Error(response?.error || 'Import failed');
    view = response;
    render();
    setMessage('Rules imported.');
  } catch (error) {
    setMessage(error.message || String(error));
  }
}

function setMessage(text) {
  els.message.textContent = text || '';
}

function renderSelectionState() {
  const count = selectedRules.size;
  els.selectedCount.textContent = count
    ? `${count} selected`
    : 'No rules selected';
  els.deleteSelected.disabled = count === 0;
}

function pruneSelection() {
  const available = new Set();
  for (const [origin, originState] of Object.entries(view?.origins || {})) {
    for (const rule of originState.rules || []) {
      available.add(selectionKey(origin, rule.id));
    }
  }

  for (const key of selectedRules) {
    if (!available.has(key)) selectedRules.delete(key);
  }
}

function selectionKey(origin, ruleId) {
  return `${origin}${KEY_SEPARATOR}${ruleId}`;
}

function parseSelectionKey(key) {
  const index = key.lastIndexOf(KEY_SEPARATOR);
  if (index < 0) return { origin: '', ruleId: '' };
  return {
    origin: key.slice(0, index),
    ruleId: key.slice(index + KEY_SEPARATOR.length),
  };
}
