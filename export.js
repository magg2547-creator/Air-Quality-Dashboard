// export.js -- PDF export module
(function (global) {
  let pdfDatePicker = null;
  let lastFocusedElement = null;
  let showToast = null;
  let normalizeFilterDate = null;
  let getDateCache = null;
  let getRows = null;

  function init(opts) {
    showToast = opts && opts.showToast ? opts.showToast : null;
    normalizeFilterDate = opts && opts.normalizeFilterDate ? opts.normalizeFilterDate : null;
    getDateCache = opts && opts.getDateCache ? opts.getDateCache : null;
    getRows = opts && opts.getRows ? opts.getRows : null;
  }

  function getFocusable(modal) {
    return modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  }

  function trapFocus(modal, event) {
    if (event.key !== 'Tab') return;
    const focusables = getFocusable(modal);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openModal() {
    const modal = document.getElementById('exportModal');
    if (!modal) return;
    lastFocusedElement = document.activeElement;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    if (!pdfDatePicker && global.flatpickr) {
      pdfDatePicker = global.flatpickr('#pdfDateFilter', {
        dateFormat: 'd/m/Y',
        locale: global.flatpickr.l10ns.th || 'default',
        disableMobile: true,
        allowInput: false,
        clickOpens: true
      });
    }

    const currentTableFilter = document.getElementById('dateFilter').value;
    if (pdfDatePicker) {
      pdfDatePicker.setDate(currentTableFilter);
    } else {
      document.getElementById('pdfDateFilter').value = currentTableFilter;
    }

    const focusables = getFocusable(modal);
    if (focusables.length) {
      focusables[0].focus();
    }

    modal._trapHandler = (e) => trapFocus(modal, e);
    modal.addEventListener('keydown', modal._trapHandler);
  }

  function closeModal() {
    const modal = document.getElementById('exportModal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';

    if (modal._trapHandler) {
      modal.removeEventListener('keydown', modal._trapHandler);
      modal._trapHandler = null;
    }

    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus();
    }
  }

  function confirmExport() {
    closeModal();

    const allData = getRows ? getRows() : [];
    if (!allData || !allData.length) {
      if (showToast) {
        showToast('No data yet - click Reload Data first.');
      }
      return;
    }

    const filterInput = document.getElementById('pdfDateFilter').value;
    const filterVal = normalizeFilterDate ? normalizeFilterDate(filterInput) : filterInput;

    let rowsToExport = allData;
    if (filterVal && getDateCache) {
      const cache = getDateCache();
      rowsToExport = allData.filter((_, i) => cache[i] === filterVal);
    }

    if (!rowsToExport.length) {
      if (showToast) {
        showToast('No records found for the selected date.');
      }
      return;
    }

    if (showToast) {
      showToast('Generating PDF... Please wait.');
    }

    const now = dayjs().format('D MMMM YYYY, HH:mm');
    const rows = [...rowsToExport].reverse();
    const reportTitleText = filterInput ? `Daily Data Report: ${filterInput}` : 'Historical Data Report';

    const container = document.createElement('div');
    container.style.padding = '20px';
    container.style.fontFamily = "'DM Sans', sans-serif";
    container.style.color = '#0f172a';

    const reportHeader = `
      <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #0284c7;">
        <div>
          <h1 style="font-size: 18px; font-weight: 700; margin: 0;">${reportTitleText}</h1>
          <p style="font-size: 12px; color: #64748b; margin: 4px 0 0 0;">Air Quality Monitoring System</p>
        </div>
      </div>
      <div style="display: flex; gap: 24px; margin-bottom: 18px; font-size: 11px; color: #64748b;">
        <span>Export: ${now}</span>
        <span>Total: ${rows.length} records</span>
      </div>
    `;

    const rowsPerPage = 25;
    let tablesHtml = '';

    for (let i = 0; i < rows.length; i += rowsPerPage) {
      const slice = rows.slice(i, i + rowsPerPage);
      const tableRows = slice.map(r => `
        <tr>
          <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${r['Timestamp'] || ''}</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${r['PM2.5'].toFixed(1)}</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${r['PM10'].toFixed(1)}</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${r['Temperature'].toFixed(1)}</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${r['Humidity'].toFixed(1)}</td>
        </tr>
      `).join('');

      tablesHtml += `
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
          <thead>
            <tr>
              <th style="text-align: left; font-size: 11px; color: #64748b; padding: 6px 8px; border-bottom: 2px solid #e2e8f0;">Timestamp</th>
              <th style="text-align: left; font-size: 11px; color: #64748b; padding: 6px 8px; border-bottom: 2px solid #e2e8f0;">PM2.5</th>
              <th style="text-align: left; font-size: 11px; color: #64748b; padding: 6px 8px; border-bottom: 2px solid #e2e8f0;">PM10</th>
              <th style="text-align: left; font-size: 11px; color: #64748b; padding: 6px 8px; border-bottom: 2px solid #e2e8f0;">Temp</th>
              <th style="text-align: left; font-size: 11px; color: #64748b; padding: 6px 8px; border-bottom: 2px solid #e2e8f0;">Hum</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      `;
    }

    container.innerHTML = reportHeader + tablesHtml;

    const opt = {
      margin: [0.4, 0.3, 0.4, 0.3],
      filename: `air_quality_report_${dayjs().format('YYYY-MM-DD')}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().from(container).set(opt).save();
  }

  global.AQMExport = {
    init,
    openModal,
    closeModal,
    confirmExport
  };
})(window);
