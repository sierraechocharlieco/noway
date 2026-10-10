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
  rawError: document.getElementById('raw-error'),
  deleteModal: document.getElementById('delete-modal'),
  deleteHelp: document.getElementById('delete-help'),
  deleteError: document.getElementById('delete-error'),
  deleteCancel: document.getElementById('delete-cancel'),
  deleteConfirm: document.getElementById('delete-confirm'),
};

let exportSelection = new Set();

const KEY_SEPARATOR = '\u001f';

let view = null;
let selectedRules = new Set();
let editingRule = null;
let pendingDeletion = [];

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
els.deleteCancel.addEventListener('click', () => els.deleteModal.close());
els.deleteConfirm.addEventListener('click', confirmDeletion);
els.modal.addEventListener('close', () => { editingRule = null; });
for (const dialog of [els.modal, els.exportModal, els.deleteModal]) {
  dialog.addEventListener('close', () => restoreFocus(dialog.dataset.returnFocus));
}
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'NOWAY_STATE_CHANGED') loadRules();
});

loadRules();

async function loadRules() {
  try {
    view = await chrome.runtime.sendMessage({ type: 'NOWAY_GET_RULES' });
    if (!view?.ok) throw new Error(view?.error || 'Could not load rules');
    render();
  } catch (error) {
    setMessage(error.message || String(error));
  }
}

function render() {
  const focusKey = document.activeElement?.dataset.focusKey;
  pruneSelection();
  renderSelectionState();
  els.origins.replaceChildren();
  const entries = Object.entries(view.origins || {}).sort(([a], [b]) => a.localeCompare(b));

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No rules yet. Turn on Training in No Way! to add rules.';
    els.origins.appendChild(empty);
    return;
  }

  for (const [origin, originState] of entries) {
    els.origins.appendChild(renderOrigin(origin, originState));
  }
  restoreFocus(focusKey);
}

function restoreFocus(key) {
  if (key) [...document.querySelectorAll('[data-focus-key]')].find((el) => el.dataset.focusKey === key)?.focus();
}

function checkboxTarget(input) {
  const target = document.createElement('label');
  target.className = 'checkbox-target';
  target.appendChild(input);
  return target;
}

function openDialog(dialog) {
  dialog.dataset.returnFocus = document.activeElement?.dataset.focusKey || '';
  dialog.showModal();
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
    originState.permissionGranted ? 'Access granted' : 'Access not granted',
    originState.trainingEnabled ? (originState.auto?.strategy === 'auto' ? 'Auto training' : 'Manual training') : 'Training off',
    originState.protectionEnabled ? 'Protection on' : 'Protection off',
    originState.protectionAllowOnce ? 'Allow Once on' : 'Allow Once off',
  ].join(' · ');
  titleWrap.appendChild(title);
  titleWrap.appendChild(meta);

  const count = document.createElement('div');
  count.className = 'origin-meta';
  count.textContent = `${originState.rules.length} rule${originState.rules.length === 1 ? '' : 's'}`;

  header.appendChild(titleWrap);
  header.appendChild(count);
  if (originState.auto?.suppressedEvidenceKeys?.length) {
    const retrain = document.createElement('button');
    retrain.type = 'button';
    retrain.textContent = 'Retrain removed actions';
    retrain.title = 'Allow Auto to learn actions whose rules you previously disabled or deleted.';
    retrain.addEventListener('click', async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'NOWAY_RETRAIN_AUTO', origin });
        if (!response?.ok) throw new Error(response?.error || 'Could not reset removed actions.');
        view = response; render(); setMessage('Auto can create these rules again.');
      } catch (error) { setMessage(error.message); }
    });
    header.appendChild(retrain);
  }
  section.appendChild(header);

  const table = document.createElement('table');
  table.className = 'rules';
  table.appendChild(renderHead(origin, originState));
  const body = document.createElement('tbody');
  for (const rule of originState.rules) {
    body.appendChild(renderRule(origin, rule));
  }
  if (!originState.rules.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 7;
    cell.className = 'empty-rules';
    cell.textContent = 'No rules for this site. Turn on Training to add rules.';
    row.appendChild(cell); body.appendChild(row);
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
  selectAll.dataset.focusKey = `${origin}|select-all`;
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
  selectAllCell.appendChild(checkboxTarget(selectAll));
  row.appendChild(selectAllCell);

  for (const label of ['Enabled', 'Kind', 'Rule', 'Action', 'Hits', 'Actions']) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    row.appendChild(th);
  }
  head.appendChild(row);
  return head;
}

function renderRule(origin, rule) {
  const row = document.createElement('tr');
  const key = selectionKey(origin, rule.id);
  row.classList.toggle('selected', selectedRules.has(key));

  const selectCell = document.createElement('td');
  selectCell.className = 'select-cell';
  const selected = document.createElement('input');
  selected.type = 'checkbox';
  selected.checked = selectedRules.has(key);
  selected.setAttribute('aria-label', `Select ${rule.label || rule.id}`);
  selected.dataset.focusKey = `${key}|select`;
  selected.addEventListener('change', () => {
    if (selected.checked) selectedRules.add(key);
    else selectedRules.delete(key);
    render();
  });
  selectCell.appendChild(checkboxTarget(selected));

  const enabledCell = document.createElement('td');
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = rule.enabled;
  enabled.setAttribute('aria-label', `Enable ${rule.label || 'rule'}`);
  enabled.dataset.focusKey = `${key}|enabled`;
  enabled.addEventListener('change', () => updateRule(origin, rule.id, { enabled: enabled.checked }));
  enabledCell.appendChild(checkboxTarget(enabled));

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
    kind.setAttribute('aria-label', `Rule kind for ${rule.label || 'rule'}`);
    kind.dataset.focusKey = `${key}|kind`;
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
  const sourceBadge = document.createElement('span');
  sourceBadge.className = `rule-source-badge${rule.autoLearned ? ' automatic' : ''}`;
  sourceBadge.textContent = rule.source === 'starter' ? 'Starter'
    : rule.autoLearned ? (rule.autoDetector === 'nano' ? 'Auto · AI' : 'Auto') : 'Manual';
  sourceBadge.title = rule.source === 'starter' ? 'Included with No Way!'
    : rule.autoDetector === 'nano' ? 'Created by Auto using Gemini Nano'
      : rule.autoLearned ? 'Created by Auto using action matching' : 'Created through manual training or imported';
  source.appendChild(sourceBadge);
  const identifier = document.createElement('span');
  identifier.className = 'rule-id';
  identifier.textContent = rule.id;
  source.appendChild(identifier);
  labelCell.appendChild(label);
  labelCell.appendChild(source);

  const actionCell = document.createElement('td');
  actionCell.className = 'action-key';
  actionCell.textContent = rule.actionKey || '-';

  const hitsCell = document.createElement('td');
  hitsCell.textContent = String(rule.hitCount || 0);

  const actionsCell = document.createElement('td');
  const actionWrap = document.createElement('div');
  actionWrap.className = 'rule-actions';

  const raw = document.createElement('button');
  raw.type = 'button';
  raw.textContent = 'Edit JSON';
  raw.setAttribute('aria-label', `Edit JSON for ${rule.label || 'rule'}`);
  raw.dataset.focusKey = `${key}|edit`;
  raw.addEventListener('click', () => showRawEditor(origin, rule));

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'danger';
  remove.textContent = 'Delete';
  remove.setAttribute('aria-label', `Delete ${rule.label || 'rule'}`);
  remove.dataset.focusKey = `${key}|delete`;
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
  els.rawError.textContent = '';
  els.rawJson.removeAttribute('aria-invalid');
  openDialog(els.modal);
  els.rawJson.focus();
}

function hideModal() {
  els.modal.close();
  editingRule = null;
}

async function saveRawRule() {
  if (!editingRule) return;
  let changes;
  try {
    changes = JSON.parse(els.rawJson.value);
  } catch (error) {
    els.rawError.textContent = `Invalid JSON: ${error.message}`;
    els.rawJson.setAttribute('aria-invalid', 'true');
    return;
  }

  try {
    els.rawError.textContent = '';
    els.rawJson.removeAttribute('aria-invalid');
    els.saveRaw.disabled = true;
    if (await updateRule(editingRule.origin, editingRule.ruleId, changes)) hideModal();
    else els.rawError.textContent = els.message.textContent;
  } catch (error) {
    setMessage(error.message || String(error));
  } finally { els.saveRaw.disabled = false; }
}

async function updateRule(origin, ruleId, changes) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'NOWAY_UPDATE_RULE',
      origin,
      ruleId,
      changes,
    });
    if (!response?.ok) throw new Error(response?.error || 'Update failed');
    view = response;
    render();
    setMessage('Rule updated.');
    return true;
  } catch (error) {
    setMessage(error.message || String(error));
    await loadRules();
    return false;
  }
}

async function deleteRule(origin, ruleId) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'NOWAY_DELETE_RULE',
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
  pendingDeletion = items;
  els.deleteHelp.textContent = `${label} will be deleted. This can’t be undone.`;
  els.deleteError.textContent = '';
  openDialog(els.deleteModal);
}

async function confirmDeletion() {
  const items = pendingDeletion;
  if (!items.length) return;
  els.deleteConfirm.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'NOWAY_DELETE_RULES',
      items,
    });
    if (!response?.ok) throw new Error(response?.error || 'Delete failed');
    view = response;
    selectedRules.clear();
    render();
    els.deleteModal.close();
    pendingDeletion = [];
    setMessage(`Deleted ${items.length} rule${items.length === 1 ? '' : 's'}.`);
  } catch (error) {
    els.deleteError.textContent = error.message || String(error);
    setMessage(error.message || String(error));
    await loadRules();
  } finally { els.deleteConfirm.disabled = false; }
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
  openDialog(els.exportModal);
}

function hideExportModal() {
  els.exportModal.close();
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
      type: 'NOWAY_EXPORT_RULES',
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
    const response = await chrome.runtime.sendMessage({ type: 'NOWAY_IMPORT_RULES', payload });
    if (!response?.ok) throw new Error(response?.error || 'Import failed');
    view = response;
    render();
    setMessage('Rules imported. Auto is off for imported sites.');
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
