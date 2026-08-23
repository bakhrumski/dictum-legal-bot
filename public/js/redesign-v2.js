(function () {
  'use strict';

  var serial = 0;
  var observed = new WeakSet();

  function closeAll(except) {
    document.querySelectorAll('.jai-select.is-open').forEach(function (wrapper) {
      if (wrapper === except) return;
      wrapper.classList.remove('is-open', 'drop-up');
      var trigger = wrapper.querySelector('.jai-select__trigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
  }

  function updatePosition(wrapper) {
    var trigger = wrapper.querySelector('.jai-select__trigger');
    var menu = wrapper.querySelector('.jai-select__menu');
    if (!trigger || !menu || window.innerWidth <= 760) {
      wrapper.classList.remove('drop-up');
      return;
    }
    var triggerRect = trigger.getBoundingClientRect();
    var roomBelow = window.innerHeight - triggerRect.bottom;
    var expected = Math.min(menu.scrollHeight || 260, 330) + 16;
    wrapper.classList.toggle('drop-up', roomBelow < expected && triggerRect.top > roomBelow);
  }

  function renderOptions(wrapper) {
    var select = wrapper.querySelector('select');
    var menu = wrapper.querySelector('.jai-select__menu');
    if (!select || !menu) return;
    menu.innerHTML = '';
    Array.from(select.options).forEach(function (option, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'jai-select__option';
      button.setAttribute('role', 'option');
      button.dataset.index = String(index);
      button.dataset.value = option.value;
      button.textContent = option.textContent;
      button.disabled = option.disabled;
      menu.appendChild(button);
    });
    sync(wrapper);
  }

  function sync(wrapper) {
    var select = wrapper.querySelector('select');
    var trigger = wrapper.querySelector('.jai-select__trigger');
    if (!select || !trigger) return;
    var selected = select.options[select.selectedIndex];
    var value = trigger.querySelector('.jai-select__value');
    if (value) value.textContent = selected ? selected.textContent : '';
    trigger.disabled = select.disabled;
    trigger.setAttribute('aria-disabled', String(select.disabled));
    wrapper.querySelectorAll('.jai-select__option').forEach(function (button) {
      var active = Number(button.dataset.index) === select.selectedIndex;
      button.classList.toggle('is-selected', active);
      button.setAttribute('aria-selected', String(active));
    });
  }

  function choose(wrapper, button) {
    var select = wrapper.querySelector('select');
    if (!select || !button || button.disabled) return;
    var index = Number(button.dataset.index);
    if (!Number.isInteger(index) || !select.options[index]) return;
    select.selectedIndex = index;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    sync(wrapper);
    closeAll();
    wrapper.querySelector('.jai-select__trigger').focus();
  }

  function enhance(select) {
    if (!select || select.dataset.jaiSelect || select.multiple || select.size > 1) return;
    if (select.closest('.workspace-app') || select.classList.contains('ws-select') || select.classList.contains('no-jai-select')) return;
    select.dataset.jaiSelect = '1';

    var wrapper = document.createElement('span');
    wrapper.className = 'jai-select';
    ['width', 'minWidth', 'maxWidth', 'flex', 'alignSelf'].forEach(function (property) {
      if (select.style[property]) wrapper.style[property] = select.style[property];
    });
    var menuId = 'jaiSelectMenu' + (++serial);
    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'jai-select__trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', menuId);
    trigger.setAttribute('aria-label', select.getAttribute('aria-label') || select.name || 'Tanlash');
    trigger.innerHTML = '<span class="jai-select__value"></span><svg class="jai-select__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    var menu = document.createElement('span');
    menu.id = menuId;
    menu.className = 'jai-select__menu';
    menu.setAttribute('role', 'listbox');

    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);
    wrapper.appendChild(trigger);
    wrapper.appendChild(menu);
    renderOptions(wrapper);

    trigger.addEventListener('click', function () {
      if (trigger.disabled) return;
      var willOpen = !wrapper.classList.contains('is-open');
      closeAll(wrapper);
      wrapper.classList.toggle('is-open', willOpen);
      trigger.setAttribute('aria-expanded', String(willOpen));
      if (willOpen) {
        sync(wrapper);
        updatePosition(wrapper);
        var chosen = wrapper.querySelector('.jai-select__option.is-selected');
        if (chosen) requestAnimationFrame(function () { chosen.scrollIntoView({ block: 'nearest' }); });
      }
    });

    menu.addEventListener('click', function (event) {
      var button = event.target.closest('.jai-select__option');
      if (button) choose(wrapper, button);
    });

    trigger.addEventListener('keydown', function (event) {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) return;
      if (event.key === 'Escape') { closeAll(); return; }
      event.preventDefault();
      if (!wrapper.classList.contains('is-open')) {
        wrapper.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
        updatePosition(wrapper);
      }
      var options = Array.from(wrapper.querySelectorAll('.jai-select__option:not(:disabled)'));
      if (!options.length) return;
      var active = document.activeElement && document.activeElement.classList.contains('jai-select__option') ? document.activeElement : wrapper.querySelector('.jai-select__option.is-selected');
      var index = Math.max(0, options.indexOf(active));
      if (event.key === 'ArrowDown') index = Math.min(options.length - 1, index + 1);
      if (event.key === 'ArrowUp') index = Math.max(0, index - 1);
      if (event.key === 'Home') index = 0;
      if (event.key === 'End') index = options.length - 1;
      if (event.key === 'Enter' || event.key === ' ') { choose(wrapper, options[index]); return; }
      options[index].focus();
    });

    menu.addEventListener('keydown', function (event) {
      var options = Array.from(wrapper.querySelectorAll('.jai-select__option:not(:disabled)'));
      var current = options.indexOf(document.activeElement);
      if (event.key === 'Escape') { event.preventDefault(); closeAll(); trigger.focus(); return; }
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(wrapper, document.activeElement); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'ArrowDown') current = Math.min(options.length - 1, current + 1);
      if (event.key === 'ArrowUp') current = Math.max(0, current - 1);
      if (event.key === 'Home') current = 0;
      if (event.key === 'End') current = options.length - 1;
      if (options[current]) options[current].focus();
    });

    select.addEventListener('change', function () { sync(wrapper); });
    var observer = new MutationObserver(function () { renderOptions(wrapper); });
    observer.observe(select, { childList: true, subtree: true, attributes: true });
    observed.add(select);
  }

  function enhanceAll(root) {
    (root || document).querySelectorAll('select:not([multiple])').forEach(enhance);
  }

  function makePricingCardsClickable() {
    document.querySelectorAll('.plan-card[data-plan]').forEach(function (card) {
      if (card.dataset.cardClickReady) return;
      card.dataset.cardClickReady = '1';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      var plan = card.dataset.plan;
      function activate(event) {
        if (event.target.closest('button, a')) return;
        if (typeof window.selectPlan === 'function') window.selectPlan(plan);
      }
      card.addEventListener('click', activate);
      card.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (typeof window.selectPlan === 'function') window.selectPlan(plan);
      });
    });
    document.querySelectorAll('.plans .plan').forEach(function (card) {
      if (card.dataset.cardClickReady) return;
      var link = card.querySelector('a.btn[href]');
      if (!link) return;
      card.dataset.cardClickReady = '1';
      card.tabIndex = 0;
      card.setAttribute('role', 'link');
      card.setAttribute('aria-label', (card.querySelector('.plan-name') || link).textContent.trim() + ' tarifini ko\'rish');
      function activate(event) {
        if (event.target.closest('button, a')) return;
        link.click();
      }
      card.addEventListener('click', activate);
      card.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        link.click();
      });
    });
    var trial = document.querySelector('.trial-strip');
    if (trial && !trial.dataset.cardClickReady) {
      trial.dataset.cardClickReady = '1';
      trial.tabIndex = 0;
      trial.setAttribute('role', 'button');
      trial.addEventListener('click', function (event) {
        if (!event.target.closest('button, a') && typeof window.selectPlan === 'function') window.selectPlan('bepul');
      });
      trial.addEventListener('keydown', function (event) {
        if ((event.key === 'Enter' || event.key === ' ') && typeof window.selectPlan === 'function') {
          event.preventDefault(); window.selectPlan('bepul');
        }
      });
    }
  }

  function observeDynamicUi() {
    var observer = new MutationObserver(function (records) {
      records.forEach(function (record) {
        record.addedNodes.forEach(function (node) {
          if (!(node instanceof Element)) return;
          if (node.matches('select')) enhance(node);
          enhanceAll(node);
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('click', function (event) {
    if (!event.target.closest('.jai-select')) closeAll();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeAll();
  });
  window.addEventListener('resize', closeAll);
  window.addEventListener('scroll', function (event) {
    /* The option list is intentionally scrollable. Only movement outside it
       dismisses the popover, so long regional/legal lists remain usable. */
    if (event.target instanceof Element && event.target.closest('.jai-select__menu')) return;
    closeAll();
  }, true);

  function init() {
    enhanceAll(document);
    makePricingCardsClickable();
    observeDynamicUi();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
