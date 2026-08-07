/* global document, navigator */

document.documentElement.classList.add('js');

for (const tabList of document.querySelectorAll('[role="tablist"]')) {
  const tabs = Array.from(tabList.querySelectorAll('[role="tab"]'));

  const activateTab = (nextTab, moveFocus) => {
    for (const tab of tabs) {
      const selected = tab === nextTab;
      const panelId = tab.getAttribute('aria-controls');
      const panel = panelId ? document.getElementById(panelId) : null;

      tab.setAttribute('aria-selected', String(selected));
      tab.setAttribute('tabindex', selected ? '0' : '-1');
      if (panel) panel.hidden = !selected;
    }

    if (moveFocus) nextTab.focus();
  };

  const selectedTab = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') ?? tabs[0];
  if (selectedTab) activateTab(selectedTab, false);

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab, false));
    tab.addEventListener('keydown', (event) => {
      let nextIndex;

      switch (event.key) {
        case 'ArrowLeft':
          nextIndex = (index - 1 + tabs.length) % tabs.length;
          break;
        case 'ArrowRight':
          nextIndex = (index + 1) % tabs.length;
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = tabs.length - 1;
          break;
        default:
          return;
      }

      event.preventDefault();
      const nextTab = tabs[nextIndex];
      if (nextTab) activateTab(nextTab, true);
    });
  });
}

const copyStatus = document.querySelector('.copy-status');

for (const button of document.querySelectorAll('.copy-button')) {
  button.addEventListener('click', async () => {
    if (button.dataset['busy'] === 'true') return;

    const targetId = button.dataset['copyTarget'];
    const target = targetId ? document.getElementById(targetId) : null;
    const label = button.querySelector('.copy-label');
    const copyName = button.dataset['copyName'] ?? 'Code';

    if (!target || !label) return;

    button.dataset['busy'] = 'true';
    button.dataset['state'] = 'progress';
    button.setAttribute('aria-disabled', 'true');
    label.textContent = 'Copying…';

    try {
      await copyText(target.textContent ?? '');
      button.dataset['state'] = 'success';
      label.textContent = 'Copied';
      if (copyStatus) {
        copyStatus.dataset['state'] = 'success';
        copyStatus.textContent = `${copyName} copied.`;
      }

      globalThis.setTimeout(() => {
        if (button.dataset['state'] === 'success') {
          delete button.dataset['state'];
          label.textContent = 'Copy';
        }
      }, 2000);
    } catch {
      button.dataset['state'] = 'error';
      label.textContent = 'Copy failed';
      if (copyStatus) {
        copyStatus.dataset['state'] = 'error';
        copyStatus.textContent = `${copyName} could not be copied. Select the code block and copy it manually.`;
      }
    } finally {
      delete button.dataset['busy'];
      button.removeAttribute('aria-disabled');
    }
  });
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();

  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard is unavailable');
}
