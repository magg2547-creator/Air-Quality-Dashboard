// script.js â€” Main application logic (rendering, loading, filters, export, QR, bootstrap)
// Depends on: data.js, charts.js  (must be loaded first)
(function (global) {


  /* ===================================================
     STATE & AUTO-REFRESH & NOTIFICATION
  =================================================== */
  let currentRefreshSecs = 300;
  let countdown = currentRefreshSecs;
  let isLoading = false;
  let isPaused = false;
  
  // à¸ªà¸–à¸²à¸™à¸° Pagination
  let currentPage = 1;
  const TABLE_ROWS_PER_PAGE = 25;
  let currentViewData = []; // à¹€à¸à¹‡à¸šà¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸—à¸µà¹ˆà¸–à¸¹à¸à¸Ÿà¸´à¸¥à¹€à¸•à¸­à¸£à¹Œà¹à¸¥à¹‰à¸§à¹€à¸žà¸·à¹ˆà¸­à¹€à¸­à¸²à¸¡à¸²à¹à¸šà¹ˆà¸‡à¸«à¸™à¹‰à¸²

  // à¸ªà¸–à¸²à¸™à¸° Notification
  let notificationsEnabled = false;
  let lastAlertTimestamp = null;


  /* ===================================================
     UPDATE CHARTS WITH DATA
  =================================================== */
  /* ===================================================
     GAUGE METER
  =================================================== */
  /* ===================================================
     AIR QUALITY STATUS & DASHBOARD RENDER
  =================================================== */
  function getAQStatus(pm25) {
    if (pm25 <=  50) return { cls: 'status-good',      label: 'Good',      color: '#78be21' };
    if (pm25 <= 100) return { cls: 'status-moderate',  label: 'Moderate',  color: '#f5c400' };
    if (pm25 <= 150) return { cls: 'status-unhealthy', label: 'Unhealthy for Sensitive Groups', color: '#f07d00' };
    return                  { cls: 'status-hazardous', label: 'Unhealthy', color: '#dc2626' };
  }

  function renderDashboard(rows) {
    if (!rows || rows.length === 0) {
      showToast('No data found in the spreadsheet.');
      return;
    }

    allData = rows;
    if (typeof AppState === 'object' && AppState) {
      AppState.allData = rows;
    }
    _dataCacheSource = null;  // invalidate date filter cache
    const n    = rows.length;
    const last = rows[n - 1];
    const prev = n > 1 ? rows[n - 2] : null;

    checkAirQualityAlert(last);

    const pm25 = parseFloat(last['PM2.5'])       || 0;
    const pm10 = parseFloat(last['PM10'])        || 0;
    const temp = parseFloat(last['Temperature']) || 0;
    const hum  = parseFloat(last['Humidity'])    || 0;

    // Current reading cards
    // Remove skeleton
    ['val-pm25','val-pm10','val-temp','val-hum'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('skeleton');
    });
    setText('val-pm25', pm25.toFixed(1), true);
    setText('val-pm10', pm10.toFixed(1), true);
    setText('val-temp', temp.toFixed(1), true);
    setText('val-hum',  hum.toFixed(1), true);

    setDelta('delta-pm25', pm25, prev ? +prev['PM2.5']       : null, '\u00B5g/m\u00B3');
    setDelta('delta-pm10', pm10, prev ? +prev['PM10']        : null, '\u00B5g/m\u00B3');
    setDelta('delta-temp', temp, prev ? +prev['Temperature'] : null, '\u00B0C');
    setDelta('delta-hum',  hum,  prev ? +prev['Humidity']    : null, '%');

    // AQ badge
    const status = getAQStatus(pm25);
    const badge  = document.getElementById('aqBadge');
    badge.className = 'aq-status-badge ' + status.cls;
    document.getElementById('aqDot').style.background = status.color;
    document.getElementById('aqText').textContent =
      status.label + ' - PM2.5 ' + pm25.toFixed(1) + ' \u00B5g/m\u00B3';

    updateGaugePm25(pm25);
    updateGaugePm10(pm10);
    updateCharts(rows);

    // Analytics: single pass (was 2 separate loops before)
    let pm25Sum = 0, pm25Min = Infinity, pm25Max = -Infinity;
    let tempSum = 0, humSum  = 0;

    for (let i = 0; i < n; i++) {
      const r   = rows[i];
      const v25 = parseFloat(r['PM2.5'])       || 0;
      const vT  = parseFloat(r['Temperature']) || 0;
      const vH  = parseFloat(r['Humidity'])    || 0;
      pm25Sum += v25;
      tempSum += vT;
      humSum  += vH;
      if (v25 < pm25Min) pm25Min = v25;
      if (v25 > pm25Max) pm25Max = v25;
    }

    setText('stat-avgPm25', (pm25Sum / n).toFixed(1), true);
    setText('stat-maxPm25', pm25Max.toFixed(1),         true);
    setText('stat-minPm25', pm25Min.toFixed(1),         true);
    setText('stat-avgTemp', (tempSum / n).toFixed(1),   true);
    setText('stat-avgHum',  (humSum  / n).toFixed(1),   true);
    setText('stat-total',   n,                          true);

    // Reverse once, reuse (was [...rows].reverse() which creates a copy)
    renderTable(rows.slice().reverse());

    // Batch DOM writes - system status
    const now = new Date().toLocaleTimeString('th-TH');
    const latestTimestamp = last['Timestamp'] ? fmtTs(last['Timestamp']) : 'Latest reading available';
    setText('sysLastUpdate', now);
    setText('sysConn',       'Connected');
    setText('sysTotalRec',   n + ' rows');
    updateHeaderMeta(now, latestTimestamp, n + ' total rows');
    setHeaderConnection('Live', 'var(--good)');

    document.getElementById('sysDot').className = 'sys-dot live';
    if (!isAiFetched) {
      requestAIUpdate();
      isAiFetched = true;
    }

    resetCountdown();
  }

  /* ===================================================
     TABLE & FILTERING
  =================================================== */
  // Cache: pre-parsed ISO date strings per row (rebuilt when allData changes)
  let _dateCache = null;
  let _dataCacheSource = null;

  function getDateCache() {
    if (_dataCacheSource === allData) return _dateCache;
    _dataCacheSource = allData;
    _dateCache = allData.map(r => {
      const d = parseTimestamp(r['Timestamp'] || '');
      return d ? d.toISOString().slice(0, 10) : '';
    });
    return _dateCache;
  }

  function normalizeFilterDate(val) {
    if (!val) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    const m = val.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? (m[3] + '-' + m[2] + '-' + m[1]) : val;
  }

  function filterByDate() {
    const val = normalizeFilterDate(document.getElementById('dateFilter').value);
    if (!val) {
      renderTable(allData.slice().reverse());
      setText('filterCount', '');
      updateHeaderMeta(undefined, allData.length ? 'Latest reading available' : 'Latest reading ready', undefined);
      return;
    }

    const cache = getDateCache();
    const filtered = allData.filter((_, i) => cache[i] === val);

    renderTable(filtered.slice().reverse());

    const count = filtered.length;
    const label = document.getElementById('filterCount');
    label.textContent = count > 0 ? `${count} records on this date` : 'No records for this date';
    label.style.color = count > 0 ? 'var(--good)' : 'var(--hazardous)';
    updateHeaderMeta(undefined, 'Filtered: ' + document.getElementById('dateFilter').value, count + ' matching rows');
  }

  function clearDateFilter() {
    if (datePicker) datePicker.clear();
    else document.getElementById('dateFilter').value = '';
    renderTable(allData.slice().reverse());
    setText('filterCount', '');
    updateHeaderMeta(undefined, allData.length ? 'Latest reading available' : 'Latest reading ready', allData.length ? allData.length + ' total rows' : 'No data loaded');
  }

  function initDatePicker() {
    if (!global.flatpickr) return;
    datePicker = global.flatpickr('#dateFilter', {
      dateFormat: 'd/m/Y',
      locale: global.flatpickr.l10ns.th || 'default',
      monthSelectorType: 'static',
      disableMobile: true,
      allowInput: false,
      clickOpens: true,
      onChange: filterByDate
    });
    if (typeof AppState === 'object' && AppState) {
      AppState.datePicker = datePicker;
    }
  }
  function renderTable(rows) {
    currentViewData = rows;
    currentPage = 1;
    renderTablePage();
  }

  // script.js â€” Optimized Rendering logic

function renderTablePage() {
  const tbody = document.getElementById('tableBody');
  if (!currentViewData.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="loading-overlay">No records</div></td></tr>';
    updatePaginationUI(1, 1);
    return;
  }

  const totalPages = Math.ceil(currentViewData.length / TABLE_ROWS_PER_PAGE) || 1;
  const start = (currentPage - 1) * TABLE_ROWS_PER_PAGE;
  const end = start + TABLE_ROWS_PER_PAGE;
  const pageRows = currentViewData.slice(start, end);

  // à¹ƒà¸Šà¹‰ DocumentFragment à¹€à¸žà¸·à¹ˆà¸­à¸„à¸§à¸²à¸¡à¹€à¸£à¹‡à¸§à¸ªà¸¹à¸‡à¸ªà¸¸à¸”à¹ƒà¸™à¸à¸²à¸£à¸§à¸²à¸” DOM
  const fragment = document.createDocumentFragment();
  
  pageRows.forEach(r => {
    const tr = document.createElement('tr');
    
    // à¸ªà¸£à¹‰à¸²à¸‡ Cell à¹à¸šà¸šà¹€à¸ˆà¸²à¸°à¸ˆà¸‡à¹€à¸žà¸·à¹ˆà¸­à¸¥à¸”à¸à¸²à¸£à¸—à¸³ HTML Parsing
    tr.innerHTML = `
      <td class="ts">${escapeHTML(fmtTs(r['Timestamp']))}</td>
      <td class="pm25v">${r['PM2.5'].toFixed(1)}</td>
      <td class="pm10v">${r['PM10'].toFixed(1)}</td>
      <td class="tempv">${r['Temperature'].toFixed(1)}</td>
      <td class="humv">${r['Humidity'].toFixed(1)}</td>
    `;
    fragment.appendChild(tr);
  });

  // à¸¥à¹‰à¸²à¸‡à¸„à¹ˆà¸²à¹€à¸à¹ˆà¸²à¹à¸¥à¸°à¹ƒà¸ªà¹ˆ Fragment à¹ƒà¸«à¸¡à¹ˆà¸—à¸µà¹€à¸”à¸µà¸¢à¸§ (à¸¥à¸” Reflow)
  tbody.replaceChildren(fragment);

  updatePaginationUI(currentPage, totalPages);
}

function updatePaginationUI(page, total) {
  document.getElementById('pageInfo').textContent = `à¸«à¸™à¹‰à¸² ${page} / ${total}`;
  document.getElementById('btnPrevPage').disabled = (page === 1);
  document.getElementById('btnNextPage').disabled = (page === total);
}

  function changePage(dir) {
    currentPage += dir;
    renderTablePage();
  }

  function updateSortIndicators() {
    const headers = document.querySelectorAll('#dataTable th[data-sort-col]');
    headers.forEach(th => {
      const isActive = Number(th.dataset.sortCol) === sortCol;
      th.setAttribute('aria-sort', isActive ? (sortAsc ? 'ascending' : 'descending') : 'none');
    });
  }

  function sortTable(col) {
    if (sortCol === col) sortAsc = !sortAsc;
    else { sortCol = col; sortAsc = true; }
    if (typeof AppState === 'object' && AppState) {
      AppState.sortCol = sortCol;
      AppState.sortAsc = sortAsc;
    }

    const keys = ['Timestamp', 'PM2.5', 'PM10', 'Temperature', 'Humidity'];
    const key  = keys[col];
    const sorted = [...allData].sort((a, b) => {
      const av = col === 0 ? (parseTimestamp(a[key])?.getTime() ?? Number.NEGATIVE_INFINITY) : +a[key];
      const bv = col === 0 ? (parseTimestamp(b[key])?.getTime() ?? Number.NEGATIVE_INFINITY) : +b[key];
      return (av > bv ? 1 : av < bv ? -1 : 0) * (sortAsc ? 1 : -1);
    });
    renderTable(sorted);
    updateSortIndicators();
  }

  /* ===================================================
     SPLASH & TOP BAR
  =================================================== */
  function splashProgress(pct, msg) {
    document.getElementById('splashBar').style.width    = pct + '%';
    document.getElementById('splashStatus').textContent = msg;
  }

  function splashHide() {
    splashProgress(100, 'Ready');
    setTimeout(() => {
      document.getElementById('splash').classList.add('hide');
    }, 400);
  }

  function topBarStart() {
    const b = document.getElementById('topBar');
    b.style.transition = 'width .3s ease, opacity .1s ease';
    b.style.opacity    = '1';
    b.style.width      = '70%';
    b.classList.add('running');
  }

  function topBarDone() {
    const b = document.getElementById('topBar');
    b.classList.remove('running');
    b.style.transition = 'width .25s ease, opacity .5s ease .3s';
    b.style.width      = '100%';
    setTimeout(() => { b.style.opacity = '0'; b.style.width = '0%'; }, 500);
  }

  function topBarError() {
    const b = document.getElementById('topBar');
    b.classList.remove('running');
    b.style.background = '#dc2626';
    b.style.width      = '100%';
    setTimeout(() => {
      b.style.opacity    = '0';
      b.style.width      = '0%';
      b.style.background = 'linear-gradient(90deg,#0284c7,#7c3aed,#0284c7)';
      b.style.backgroundSize = '200% 100%';
    }, 600);
  }

  /* ===================================================
     DATA LOADING - fetch + CORS, JSONP fallback
  =================================================== */
  function loadData() {
    const url = document.getElementById('sheetsUrl').value.trim();
    if (!url) { showToast('Please enter an Apps Script URL.'); return; }

    isLoading = true;
    showToast('Loading data...');
    setText('sysConn', 'Loading...');
    updateHeaderMeta('Refreshing now...', 'Checking data source...', allData.length ? allData.length + ' cached rows' : 'Preparing dataset');
    setHeaderConnection('Syncing', 'var(--accent)');
    topBarStart();
    ['val-pm25','val-pm10','val-temp','val-hum'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('skeleton');
    });
    fetchLoad(url);
  }

  function fetchLoad(url) {
    const sep     = url.includes('?') ? '&' : '?';
    const fullUrl = url + sep + '_t=' + Date.now();
    let   done    = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true; isLoading = false;
      topBarError();
      splashProgress(100, 'Timeout');
      setTimeout(() => document.getElementById('splash').classList.add('hide'), 800);
      showToast('Request timed out. Check the URL and deploy permissions.');
      setText('sysConn', 'Timeout');
      updateHeaderMeta('Sync timeout', 'Connection needs attention', allData.length ? allData.length + ' cached rows' : 'No cached data');
      setHeaderConnection('Issue', 'var(--hazardous)');
      document.getElementById('sysDot').className = 'sys-dot err';
    }, 15000);

    fetch(fullUrl)
      .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.text(); })
      .then(text => {
        if (done) return;
        clearTimeout(timer); done = true;
        let json;
        const t = text.trim();
        if (t.startsWith('[') || t.startsWith('{')) {
          json = JSON.parse(t);
        } else {
          const m = t.match(/[^(]+[(](.+)[)]\s*;?\s*$/s);
          if (!m) throw new Error('Unsupported response format');
          json = JSON.parse(m[1]);
        }
        const raw  = Array.isArray(json) ? json : (json.data || json.values || []);
        const rows = normaliseRows(raw);
        console.log('[AQM] fetch OK -', rows.length, 'rows');
        isLoading = false;
        renderDashboard(rows);
        topBarDone(); splashHide();
        showToast('Loaded ' + rows.length + ' rows successfully.');
      })
      .catch(err => {
        if (done) return;
        clearTimeout(timer);
        console.warn('[AQM] fetch failed, JSONP fallback...', err.message);
        jsonpFallback(document.getElementById('sheetsUrl').value.trim());
      });
  }

  function jsonpFallback(url) {
    const old = document.getElementById('__aqmScript');
    if (old) old.remove();
    const cbName  = '__aqmCb';
    const sep     = url.includes('?') ? '&' : '?';
    const fullUrl = url + sep + 'callback=' + cbName + '&_t=' + Date.now();

    const onFail = (msg) => {
      delete global[cbName];
      const s = document.getElementById('__aqmScript');
      if (s) s.remove();
      isLoading = false; topBarError();
      splashProgress(100, 'Connection failed');
      setTimeout(() => document.getElementById('splash').classList.add('hide'), 800);
      showToast(msg);
      setText('sysConn', 'Error');
      updateHeaderMeta('Connection failed', 'Unable to reach source', allData.length ? allData.length + ' cached rows' : 'No cached data');
      setHeaderConnection('Issue', 'var(--hazardous)');
      document.getElementById('sysDot').className = 'sys-dot err';
    };

    const timer = setTimeout(() => onFail('Timeout - check the URL and deploy permissions'), 15000);

    global[cbName] = function(json) {
      clearTimeout(timer);
      delete global[cbName];
      const s = document.getElementById('__aqmScript');
      if (s) s.remove();
      try {
        const raw  = Array.isArray(json) ? json : (json.data || json.values || []);
        const rows = normaliseRows(raw);
        console.log('[AQM] JSONP OK -', rows.length, 'rows');
        isLoading = false;
        renderDashboard(rows); topBarDone(); splashHide();
        showToast('Loaded ' + rows.length + ' rows successfully.');
      } catch(e) { onFail('Parse error: ' + e.message); }
    };

    const script   = document.createElement('script');
    script.id      = '__aqmScript';
    script.src     = fullUrl;
    script.onerror = () => { clearTimeout(timer); onFail('Load failed - check the URL and deploy permissions'); };
    document.head.appendChild(script);
  }

  /* ===================================================
     EXPORT / CSV
  =================================================== */
  function confirmExportPDF() {
    closeExportModal(); // à¸›à¸´à¸”à¸«à¸™à¹‰à¸²à¸•à¹ˆà¸²à¸‡ Popup à¸à¹ˆà¸­à¸™

    if (!allData.length) {
      showToast('No data yet - click Reload Data first.');
      return;
    }

    // 1. à¸”à¸¶à¸‡à¸„à¹ˆà¸²à¸ˆà¸²à¸à¸Šà¹ˆà¸­à¸‡à¸„à¹‰à¸™à¸«à¸²à¸§à¸±à¸™à¸—à¸µà¹ˆà¹ƒà¸™à¸«à¸™à¹‰à¸²à¸•à¹ˆà¸²à¸‡ Popup
    const filterInput = document.getElementById('pdfDateFilter').value;
    const filterVal = normalizeFilterDate(filterInput);
    
    // 2. à¸à¸£à¸­à¸‡à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸—à¸µà¹ˆà¸ˆà¸°à¸™à¸³à¹„à¸› Export
    let rowsToExport = allData;
    if (filterVal) {
      const cache = getDateCache();
      rowsToExport = allData.filter((_, i) => cache[i] === filterVal);
    }

    if (!rowsToExport.length) {
      showToast('No records found for the selected date.');
      return;
    }
    
    showToast('Generating PDF... Please wait.');

    const now = dayjs().format('D MMMM YYYY, HH:mm');
    const rows = [...rowsToExport].reverse(); 

    // 3. à¸›à¸£à¸±à¸šà¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™à¸‚à¹‰à¸­à¸„à¸§à¸²à¸¡à¸«à¸±à¸§à¹€à¸£à¸·à¹ˆà¸­à¸‡à¹ƒà¸«à¹‰à¸ªà¸­à¸”à¸„à¸¥à¹‰à¸­à¸‡à¸à¸±à¸šà¸à¸²à¸£à¸„à¹‰à¸™à¸«à¸²
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
      const chunk = rows.slice(i, i + rowsPerPage);
      
      const rowsHtml = chunk.map((r, index) => `
        <tr style="background: ${(i + index) % 2 === 0 ? '#ffffff' : '#f8fafc'}; page-break-inside: avoid;">
          <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-size: 11px; color: #64748b;">${escapeHTML(fmtTs(r['Timestamp']))}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 600; font-size: 11px;">${(+r['PM2.5'] || 0).toFixed(1)}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 600; font-size: 11px;">${(+r['PM10']  || 0).toFixed(1)}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 600; font-size: 11px;">${(parseFloat(r['Temperature']) || 0).toFixed(1)}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 600; font-size: 11px;">${(parseFloat(r['Humidity'])    || 0).toFixed(1)}</td>
        </tr>`).join('');

      const pageBreak = i > 0 ? '<div style="page-break-before: always; margin-top: 20px;"></div>' : '';

      tablesHtml += `
        ${pageBreak}
        <table style="width: 100%; border-collapse: collapse; text-align: left;">
          <thead>
            <tr style="background: #0284c7; color: #fff;">
              <th style="padding: 10px 12px; font-size: 10px; text-transform: uppercase;">Timestamp</th>
              <th style="padding: 10px 12px; font-size: 10px; text-transform: uppercase; text-align: right;">PM2.5</th>
              <th style="padding: 10px 12px; font-size: 10px; text-transform: uppercase; text-align: right;">PM10</th>
              <th style="padding: 10px 12px; font-size: 10px; text-transform: uppercase; text-align: right;">Temp (&deg;C)</th>
              <th style="padding: 10px 12px; font-size: 10px; text-transform: uppercase; text-align: right;">Humidity (%)</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      `;
    }

    container.innerHTML = reportHeader + tablesHtml;

    const opt = {
      margin:       10,
      filename:     filterInput ? `AirQuality_${filterInput.replace(/\//g, '-')}.pdf` : `AirQuality_All_${dayjs().format('YYYYMMDD_HHmm')}.pdf`,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak:    { mode: ['css', 'legacy'] }
    };

    html2pdf().set(opt).from(container).save().then(() => {
      showToast('PDF downloaded successfully.');
    }).catch(err => {
      showToast('Error generating PDF.');
      console.error(err);
    });
  }

  function downloadCSV() {
    if (!allData.length) {
      showToast('No data yet - click Reload Data first.');
      return;
    }

    const headers = ['Timestamp', 'PM2.5', 'PM10', 'Temperature', 'Humidity'];
    const lines   = [
      headers.join(','),
      ...allData.map(r =>
        headers.map(h => `"${(r[h] !== undefined ? r[h] : '')}"`).join(',')
      )
    ];

    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href     = URL.createObjectURL(blob);
    link.download = 'air_quality_' + new Date().toISOString().slice(0, 10) + '.csv';
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('CSV downloaded (' + allData.length + ' rows).');
  }

  /* ===================================================
     AUTO-REFRESH TICK
  =================================================== */
  function resetCountdown() {
    if (!isPaused) {
      countdown = currentRefreshSecs;
    }
  }

  function changeRefreshInterval(val) {
    const v = parseInt(val, 10);
    if (v === -1) {
      isPaused = true;
      document.getElementById('countdownText').textContent = 'Paused';
      document.getElementById('refreshFill').style.width = '0%';
    } else {
      isPaused = false;
      currentRefreshSecs = v;
      resetCountdown();
    }
  }

  setInterval(() => {
    if (isLoading || isPaused) return;

    countdown = Math.max(0, countdown - 1);

    if (countdown === 0) {
      countdown = currentRefreshSecs;
      if (document.getElementById('sheetsUrl').value.trim()) {
        loadData(); // à¹‚à¸«à¸¥à¸”à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹ƒà¸«à¸¡à¹ˆà¹€à¸¡à¸·à¹ˆà¸­à¸«à¸¡à¸”à¹€à¸§à¸¥à¸²
      }
    }

    const pct  = (countdown / currentRefreshSecs) * 100;
    const mins = Math.floor(countdown / 60);
    const secs = String(countdown % 60).padStart(2, '0');

    document.getElementById('refreshFill').style.width    = pct + '%';
    document.getElementById('countdownText').textContent  = `${mins}:${secs}`;
  }, 1000);

  // ==========================================
  // à¸£à¸°à¸šà¸š Notification à¹à¸ˆà¹‰à¸‡à¹€à¸•à¸·à¸­à¸™à¸à¸¸à¹ˆà¸™
  // ==========================================
  // ==========================================
  // à¸£à¸°à¸šà¸š Notification à¹à¸ˆà¹‰à¸‡à¹€à¸•à¸·à¸­à¸™à¸à¸¸à¹ˆà¸™ (à¸­à¸±à¸›à¹€à¸”à¸•à¹ƒà¸«à¸¡à¹ˆà¹€à¸›à¹‡à¸™ Toggle)
  // ==========================================
  function toggleNotifications() {
    const cb = document.getElementById('notifToggleCb');
    
    // à¸–à¹‰à¸²à¸œà¸¹à¹‰à¹ƒà¸Šà¹‰à¸à¸” "à¹€à¸›à¸´à¸”"
    if (cb.checked) {
      if (!("Notification" in window)) {
        showToast("à¹€à¸šà¸£à¸²à¸§à¹Œà¹€à¸‹à¸­à¸£à¹Œà¸™à¸µà¹‰à¹„à¸¡à¹ˆà¸£à¸­à¸‡à¸£à¸±à¸šà¸à¸²à¸£à¹à¸ˆà¹‰à¸‡à¹€à¸•à¸·à¸­à¸™ (Notifications)");
        cb.checked = false; // à¹€à¸”à¹‰à¸‡à¸ªà¸§à¸´à¸•à¸Šà¹Œà¸à¸¥à¸±à¸šà¹„à¸›à¸ªà¸µà¹à¸”à¸‡
        return;
      }
      
      Notification.requestPermission().then(permission => {
        if (permission === "granted") {
          notificationsEnabled = true;
          showToast("ðŸŸ¢ à¹€à¸›à¸´à¸”à¸£à¸°à¸šà¸šà¹à¸ˆà¹‰à¸‡à¹€à¸•à¸·à¸­à¸™à¸ªà¸³à¹€à¸£à¹‡à¸ˆ!");
        } else {
          showToast("ðŸ”´ à¸„à¸¸à¸“à¸›à¸à¸´à¹€à¸ªà¸˜à¸à¸²à¸£à¹à¸ˆà¹‰à¸‡à¹€à¸•à¸·à¸­à¸™ à¸à¸£à¸¸à¸“à¸²à¸­à¸™à¸¸à¸à¸²à¸•à¹ƒà¸™à¸à¸²à¸£à¸•à¸±à¹‰à¸‡à¸„à¹ˆà¸²à¹€à¸šà¸£à¸²à¸§à¹Œà¹€à¸‹à¸­à¸£à¹Œ");
          cb.checked = false; // à¹€à¸”à¹‰à¸‡à¸ªà¸§à¸´à¸•à¸Šà¹Œà¸à¸¥à¸±à¸šà¸–à¹‰à¸²à¹„à¸¡à¹ˆà¸­à¸™à¸¸à¸à¸²à¸•
        }
      });
    } 
    // à¸–à¹‰à¸²à¸œà¸¹à¹‰à¹ƒà¸Šà¹‰à¸à¸” "à¸›à¸´à¸”"
    else {
      notificationsEnabled = false;
      showToast("ðŸ”´ à¸›à¸´à¸”à¸£à¸°à¸šà¸šà¹à¸ˆà¹‰à¸‡à¹€à¸•à¸·à¸­à¸™à¹à¸¥à¹‰à¸§");
    }
  }

  function checkAirQualityAlert(lastRow) {
    if (!notificationsEnabled || !lastRow) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') {
      return;
    }
    
    const pm25 = parseFloat(lastRow['PM2.5']) || 0;
    const ts = lastRow['Timestamp'];

    // à¹à¸ˆà¹‰à¸‡à¹€à¸•à¸·à¸­à¸™à¹€à¸¡à¸·à¹ˆà¸­à¸à¸¸à¹ˆà¸™à¹€à¸à¸´à¸™ 100 à¹à¸¥à¸°à¸•à¹‰à¸­à¸‡à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¹€à¸„à¸¢à¹€à¸•à¸·à¸­à¸™à¹€à¸§à¸¥à¸²à¸™à¸µà¹‰
    if (pm25 > 100 && ts !== lastAlertTimestamp) {
      lastAlertTimestamp = ts;
      
      // à¸ªà¸£à¹‰à¸²à¸‡à¸à¸¥à¹ˆà¸­à¸‡à¹à¸ˆà¹‰à¸‡à¹€à¸•à¸·à¸­à¸™
      const notification = new Notification("âš ï¸ à¹à¸ˆà¹‰à¸‡à¹€à¸•à¸·à¸­à¸™à¸¡à¸¥à¸žà¸´à¸©à¸—à¸²à¸‡à¸­à¸²à¸à¸²à¸¨!", {
        body: `à¸„à¹ˆà¸² PM2.5 à¸›à¸±à¸ˆà¸ˆà¸¸à¸šà¸±à¸™à¸žà¸¸à¹ˆà¸‡à¸ªà¸¹à¸‡à¸–à¸¶à¸‡ ${pm25.toFixed(1)} Âµg/mÂ³ (à¸£à¸°à¸”à¸±à¸šà¸­à¸±à¸™à¸•à¸£à¸²à¸¢) à¹‚à¸›à¸£à¸”à¸ªà¸§à¸¡à¸«à¸™à¹‰à¸²à¸à¸²à¸à¸­à¸™à¸²à¸¡à¸±à¸¢ N95`,
        icon: 'https://cdn-icons-png.flaticon.com/512/3209/3209935.png'
      });

      // ðŸŒŸ 1. à¸ªà¸±à¹ˆà¸‡à¹ƒà¸«à¹‰à¸à¸¥à¹ˆà¸­à¸‡à¹à¸ˆà¹‰à¸‡à¹€à¸•à¸·à¸­à¸™ "à¸›à¸´à¸”à¸•à¸±à¸§à¹€à¸­à¸‡à¸­à¸±à¸•à¹‚à¸™à¸¡à¸±à¸•à¸´" à¸«à¸¥à¸±à¸‡à¸ˆà¸²à¸à¸œà¹ˆà¸²à¸™à¹„à¸› 7 à¸§à¸´à¸™à¸²à¸—à¸µ
      setTimeout(() => {
        notification.close();
      }, 7000);

      // ðŸŒŸ 2. à¸ªà¸±à¹ˆà¸‡à¹ƒà¸«à¹‰ "à¸›à¸´à¸”à¸—à¸±à¸™à¸—à¸µ" à¸–à¹‰à¸²à¸œà¸¹à¹‰à¹ƒà¸Šà¹‰à¹€à¸­à¸²à¹€à¸¡à¸²à¸ªà¹Œà¹„à¸›à¸„à¸¥à¸´à¸à¸—à¸µà¹ˆà¸à¸¥à¹ˆà¸­à¸‡à¹à¸ˆà¹‰à¸‡à¹€à¸•à¸·à¸­à¸™
      notification.onclick = () => {
        notification.close();
      };
    }
  }

  /* ===================================================
     HELPERS
  =================================================== */

  function setText(id, val, animate = false) {
    const el = document.getElementById(id);
    if (!el) return;
    if (animate && el.textContent !== String(val)) {
      el.classList.remove('updating', 'pop');
      void el.offsetWidth; // force reflow
      el.classList.add(el.classList.contains('card-value') ? 'updating' :
                       el.classList.contains('analytics-value') || el.classList.contains('gauge-number') ? 'pop' : '');
      el.textContent = val;
      el.addEventListener('animationend', () => el.classList.remove('updating','pop'), { once: true });
    } else {
      el.textContent = val;
    }
  }
  function updateHeaderMeta(lastSync, rangeText, recordText) {
    if (lastSync !== undefined) setText('headerLastSync', lastSync);
    if (rangeText !== undefined) setText('headerRange', rangeText);
    if (recordText !== undefined) setText('headerRecordCount', recordText);
  }

  function setHeaderConnection(state, color) {
    setText('headerStatus', state);
    const hd = document.getElementById('headerDot');
    if (!hd) return;
    hd.classList.remove('live-glow');
    hd.style.background = color;
    hd.style.boxShadow = color === 'var(--good)' ? '0 0 7px var(--good)' : color === 'var(--accent)' ? '0 0 7px rgba(2,132,199,0.35)' : '0 0 7px rgba(220,38,38,0.2)';
    if (state === 'Live') hd.classList.add('live-glow');
  }

  function setDelta(id, cur, prev, unit) {
    const el = document.getElementById(id);
    if (!el) return;
    if (prev === null || isNaN(prev)) {
      el.textContent = 'Latest reading';
      el.style.color = '';
      return;
    }
    const diff = cur - prev;
    const sign = diff > 0 ? '+' : '';
    el.textContent = `${sign}${diff.toFixed(1)} ${unit} vs prev`;
    el.style.color = diff > 0 ? 'var(--hazardous)' : diff < 0 ? 'var(--good)' : 'var(--muted)';
  }

  function fmtTs(ts, short = false) {
    if (!ts) return '--';
    const d = parseTimestamp(ts);
    if (!d) return escapeHTML(String(ts));
    
    // à¹ƒà¸Šà¹‰ dayjs à¹ƒà¸™à¸à¸²à¸£à¸ˆà¸±à¸”à¸£à¸¹à¸›à¹à¸šà¸šà¸§à¸±à¸™à¸—à¸µà¹ˆà¹à¸—à¸™ toLocaleString à¹€à¸žà¸·à¹ˆà¸­à¸„à¸§à¸²à¸¡à¸ªà¸¡à¹ˆà¸³à¹€à¸ªà¸¡à¸­
    if (short) {
      return dayjs(d).format('HH:mm'); // à¹à¸ªà¸”à¸‡à¹à¸„à¹ˆà¹€à¸§à¸¥à¸² à¹€à¸Šà¹ˆà¸™ 18:00
    }
    
    // à¹à¸ªà¸”à¸‡à¸§à¸±à¸™à¸—à¸µà¹ˆà¹€à¸•à¹‡à¸¡à¹à¸šà¸š à¸„.à¸¨. (à¹€à¸Šà¹ˆà¸™ 09/03/2026 18:00)
    return dayjs(d).format('DD/MM/YYYY HH:mm'); 
    
    /* à¸«à¸¡à¸²à¸¢à¹€à¸«à¸•à¸¸: à¸–à¹‰à¸²à¸­à¸¢à¸²à¸à¹ƒà¸«à¹‰à¹à¸ªà¸”à¸‡à¸œà¸¥à¹€à¸›à¹‡à¸™à¸›à¸µ à¸ž.à¸¨. à¹à¸šà¸šà¹€à¸•à¹‡à¸¡ (à¹€à¸Šà¹ˆà¸™ 09/03/2569 18:00)
      à¹ƒà¸«à¹‰à¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™à¸šà¸£à¸£à¸—à¸±à¸”à¸šà¸™à¹€à¸›à¹‡à¸™:
      return dayjs(d).add(543, 'year').format('DD/MM/YYYY HH:mm');
    */
  }

  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 3800);
  }

  function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /* ===================================================
     QR CODE
  =================================================== */
  let _qrInstance = null;
  let lastFocusedElement = null;

  const STORAGE_KEY   = 'aqm-script-url';
  const DASHBOARD_URL = global.location.href;

  function openQR() {
    lastFocusedElement = document.activeElement;
    const modal   = document.getElementById('qrModal');
    const wrap    = document.getElementById('qrCanvas');
    const urlText = document.getElementById('qrUrlText');

    urlText.textContent = DASHBOARD_URL;
    wrap.innerHTML = '';
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    
    // à¸¥à¹‡à¸­à¸„à¸«à¸™à¹‰à¸²à¸ˆà¸­à¸žà¸·à¹‰à¸™à¸«à¸¥à¸±à¸‡à¹„à¸¡à¹ˆà¹ƒà¸«à¹‰à¹€à¸¥à¸·à¹ˆà¸­à¸™à¹€à¸§à¸¥à¸²à¹€à¸›à¸´à¸” Popup (à¸–à¹‰à¸²à¸¡à¸µ)
    document.body.style.overflow = 'hidden';

    setTimeout(() => { const closeBtn = modal.querySelector('.qr-close'); if (closeBtn) closeBtn.focus(); }, 0);

    if (!global.QRCode) {
      wrap.innerHTML = '<div style="padding:24px 18px;border:1px dashed #cbd5e1;border-radius:14px;color:#64748b;font-size:0.82rem;text-align:center">QR library unavailable<br>Open this link directly instead.</div>';
      showToast('QR generator is unavailable right now.');
      return;
    }

    try {
      // ðŸŒŸ à¸•à¸±à¹‰à¸‡à¸„à¹ˆà¸²à¹ƒà¸«à¹‰à¸à¸¥à¹ˆà¸­à¸‡ QR à¸£à¸­à¸‡à¸£à¸±à¸šà¸à¸²à¸£à¸§à¸²à¸‡à¹‚à¸¥à¹‚à¸à¹‰à¸—à¸±à¸šà¹à¸šà¸š CSS
      wrap.style.position = 'relative';

      _qrInstance = new QRCode(wrap, {
        text: DASHBOARD_URL,
        width: 220,
        height: 220,
        colorDark: '#0f172a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });

      // ðŸŒŸ à¸ªà¸£à¹‰à¸²à¸‡à¹‚à¸¥à¹‚à¸à¹‰à¹à¸¥à¸°à¹ƒà¸Šà¹‰ CSS à¹à¸›à¸°à¸—à¸±à¸šà¸•à¸£à¸‡à¸à¸¥à¸²à¸‡
      const logoSize = 48;
      const logoDiv = document.createElement('div');
      logoDiv.style.position = 'absolute';
      logoDiv.style.top = '50%';
      logoDiv.style.left = '50%';
      logoDiv.style.transform = 'translate(-50%, -50%)';
      logoDiv.style.width = logoSize + 'px';
      logoDiv.style.height = logoSize + 'px';
      logoDiv.style.backgroundColor = '#ffffff';
      logoDiv.style.borderRadius = '12px';
      logoDiv.style.padding = '4px';
      logoDiv.style.boxShadow = '0 2px 10px rgba(0,0,0,0.15)';
      logoDiv.style.display = 'flex';
      logoDiv.style.alignItems = 'center';
      logoDiv.style.justifyContent = 'center';
      
      // à¸§à¸²à¸”à¹„à¸­à¸„à¸­à¸™à¹ƒà¸šà¹„à¸¡à¹‰à¸”à¹‰à¸²à¸™à¹ƒà¸™
      logoDiv.innerHTML = `
        <div style="width:100%;height:100%;background:linear-gradient(135deg,#0284c7,#7c3aed);border-radius:8px;display:flex;align-items:center;justify-content:center;">
          <svg width="26" height="26" viewBox="0 0 80 80" fill="none">
            <path d="M28 52 C28 52 20 36 36 24 C52 12 60 28 52 38 C46 46 34 44 28 52Z" fill="white" fill-opacity="0.95"/>
            <path d="M28 52 C32 44 40 38 48 30" stroke="#0284c7" stroke-width="2" stroke-linecap="round" fill="none"/>
            <path d="M55 34 C58 34 61 31 61 28" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.85"/>
            <path d="M55 40 C61 40 66 36 66 30" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.6"/>
            <path d="M55 46 C63 46 70 40 70 32" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.35"/>
          </svg>
        </div>
      `;
      wrap.appendChild(logoDiv);

    } catch (err) {
      wrap.innerHTML = '<div style="padding:24px 18px;border:1px dashed #cbd5e1;border-radius:14px;color:#64748b;font-size:0.82rem;text-align:center">Unable to render QR<br>Open this link directly instead.</div>';
      showToast('Unable to render QR code.');
    }
  }

  // à¸­à¸±à¸›à¹€à¸”à¸•à¸Ÿà¸±à¸‡à¸à¹Œà¸Šà¸±à¸™à¸›à¸´à¸” QR à¹ƒà¸«à¹‰à¸„à¸¥à¸²à¸¢à¸à¸²à¸£à¸¥à¹‡à¸­à¸„à¸«à¸™à¹‰à¸²à¸ˆà¸­à¸”à¹‰à¸§à¸¢
  function closeQR() {
    const modal = document.getElementById('qrModal');
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    _qrInstance = null;
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus();
    }
  }


  /* ===================================================
     EXPORT PDF MODAL
  =================================================== */
  let pdfDatePicker = null;

  function openExportModal() {
    const modal = document.getElementById('exportModal');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');

    // ðŸŒŸ à¸¥à¹‡à¸­à¸„à¹„à¸¡à¹ˆà¹ƒà¸«à¹‰à¸«à¸™à¹‰à¸²à¸ˆà¸­à¸žà¸·à¹‰à¸™à¸«à¸¥à¸±à¸‡à¹€à¸¥à¸·à¹ˆà¸­à¸™à¹„à¸”à¹‰
    document.body.style.overflow = 'hidden';

    // à¹€à¸£à¸µà¸¢à¸à¹ƒà¸Šà¹‰ flatpickr à¸ªà¸³à¸«à¸£à¸±à¸šà¸Šà¹ˆà¸­à¸‡à¹€à¸¥à¸·à¸­à¸à¸§à¸±à¸™à¸—à¸µà¹ˆà¹ƒà¸™ Modal
    if (!pdfDatePicker && global.flatpickr) {
      pdfDatePicker = global.flatpickr('#pdfDateFilter', {
        dateFormat: 'd/m/Y',
        locale: global.flatpickr.l10ns.th || 'default',
        disableMobile: true,
        allowInput: false,
        clickOpens: true
      });
    }

    // à¸‹à¸´à¸‡à¸„à¹Œà¸§à¸±à¸™à¸—à¸µà¹ˆà¸ˆà¸²à¸à¸•à¸²à¸£à¸²à¸‡à¸«à¸¥à¸±à¸à¸¡à¸²à¹ƒà¸ªà¹ˆà¹ƒà¸«à¹‰à¹€à¸›à¹‡à¸™à¸„à¹ˆà¸²à¹€à¸£à¸´à¹ˆà¸¡à¸•à¹‰à¸™
    const currentTableFilter = document.getElementById('dateFilter').value;
    if (pdfDatePicker) {
      pdfDatePicker.setDate(currentTableFilter);
    } else {
      document.getElementById('pdfDateFilter').value = currentTableFilter;
    }
  }

  function closeExportModal() {
    const modal = document.getElementById('exportModal');
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');

    // ðŸŒŸ à¸›à¸¥à¸”à¸¥à¹‡à¸­à¸„à¹ƒà¸«à¹‰à¸«à¸™à¹‰à¸²à¸ˆà¸­à¸žà¸·à¹‰à¸™à¸«à¸¥à¸±à¸‡à¸à¸¥à¸±à¸šà¸¡à¸²à¹€à¸¥à¸·à¹ˆà¸­à¸™à¹„à¸”à¹‰à¸•à¸²à¸¡à¸›à¸à¸•à¸´
    document.body.style.overflow = '';
  }

  // à¸›à¸´à¸” Modal à¹€à¸¡à¸·à¹ˆà¸­à¸à¸”à¸›à¸¸à¹ˆà¸¡ Escape (à¹ƒà¸ªà¹ˆà¹€à¸žà¸´à¹ˆà¸¡à¸•à¹ˆà¸­à¸ˆà¸²à¸ EventListener à¸‚à¸­à¸‡ QR Modal à¹„à¸”à¹‰à¹€à¸¥à¸¢)
  document.addEventListener('keydown', e => { 
    if (e.key === 'Escape') { closeQR(); closeExportModal(); } 
  });

  /* ===================================================
     STARTUP & SETTINGS
  =================================================== */
  const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzQVa8DL21CDDQTb4ffwNd8UQSwQXItb23IMkQjTQRzaFr73s_Vd2z28IJrZ5tJeRttCg/exec';

  function bootstrap() {
    initCharts();
    initGauge();
    initDatePicker();

    splashProgress(30, 'Starting dashboard...');
    const savedUrl = global.localStorage.getItem(STORAGE_KEY);
    document.getElementById('sheetsUrl').value = savedUrl || SCRIPT_URL;

    setTimeout(() => splashProgress(60, 'Loading latest data...'), 300);
    loadData();

    let logoClickCount = 0;
    let logoClickTimer = null;
    const logoTrigger = document.getElementById('logoTrigger');

    logoTrigger.addEventListener('click', function() {
      logoClickCount++;
      clearTimeout(logoClickTimer);
      logoClickTimer = setTimeout(() => { logoClickCount = 0; }, 600);

      if (logoClickCount >= 3) {
        logoClickCount = 0;
        const panel = document.getElementById('settingsPanel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      }
    });

    logoTrigger.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        logoTrigger.click();
      }
    });

    document.querySelectorAll('#dataTable th[data-sort-col]').forEach(th => {
      th.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          sortTable(Number(th.dataset.sortCol));
        }
      });
    });

    updateSortIndicators();
  }

  function closeSettings() {
    document.getElementById('settingsPanel').style.display = 'none';
  }

  function saveAndLoad() {
    const url = document.getElementById('sheetsUrl').value.trim();
    if (!url) {
      showToast('Please enter an Apps Script URL.');
      return;
    }
    global.localStorage.setItem(STORAGE_KEY, url);
    closeSettings();
    loadData();
    showToast('Saved URL and started loading data.');
  }

  // ==========================================
  // ðŸ¤– à¸£à¸°à¸šà¸š AI Analyst (Gemini)
  // ==========================================
  let isAiFetched = false; // à¸•à¸±à¸§à¹à¸›à¸£à¹€à¸Šà¹‡à¸„à¸§à¹ˆà¸²à¹€à¸„à¸¢à¹ƒà¸«à¹‰ AI à¸§à¸´à¹€à¸„à¸£à¸²à¸°à¸«à¹Œà¸«à¸£à¸·à¸­à¸¢à¸±à¸‡

  async function requestAIUpdate() {
    const aiTextEl = document.getElementById('aiSummaryText');
    const scriptUrl = document.getElementById('sheetsUrl').value.trim();
    
    if (!aiTextEl || !scriptUrl) return;
    if (!allData || allData.length === 0) {
      aiTextEl.textContent = 'à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¸¡à¸µà¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸ªà¸³à¸«à¸£à¸±à¸šà¹ƒà¸«à¹‰ AI à¸§à¸´à¹€à¸„à¸£à¸²à¸°à¸«à¹Œà¸„à¸£à¸±à¸š';
      return;
    }

    // à¸”à¸¶à¸‡à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹à¸–à¸§à¸¥à¹ˆà¸²à¸ªà¸¸à¸”
    const latest = allData[allData.length - 1];
    const pm25 = parseFloat(latest['PM2.5']) || 0;
    const temp = parseFloat(latest['Temperature']) || 0;
    const hum = parseFloat(latest['Humidity']) || 0;

    aiTextEl.innerHTML = '<span style="color: #0284c7;">à¸à¸³à¸¥à¸±à¸‡à¹ƒà¸Šà¹‰à¸„à¸§à¸²à¸¡à¸„à¸´à¸”... (à¸£à¸­à¸›à¸£à¸°à¸¡à¸²à¸“ 5-8 à¸§à¸´à¸™à¸²à¸—à¸µ) â³</span>';
    
    try {
      // à¹€à¸£à¸µà¸¢à¸à¹„à¸›à¸¢à¸±à¸‡ Apps Script à¸žà¸£à¹‰à¸­à¸¡à¹à¸™à¸šà¸„à¹ˆà¸²à¸žà¸²à¸£à¸²à¸¡à¸´à¹€à¸•à¸­à¸£à¹Œ
      const url = `${scriptUrl}?action=getAI&pm25=${pm25}&temp=${temp}&hum=${hum}`;
      const response = await fetch(url);
      const text = await response.text();
      
      // à¹à¸ªà¸”à¸‡à¸œà¸¥à¸—à¸µà¹ˆà¹„à¸”à¹‰à¸ˆà¸²à¸ AI
      aiTextEl.innerHTML = `<strong>à¸šà¸—à¸§à¸´à¹€à¸„à¸£à¸²à¸°à¸«à¹Œ:</strong> ${escapeHTML(text)}`;
    } catch (err) {
      console.error(err);
      aiTextEl.textContent = 'à¹€à¸à¸´à¸”à¸‚à¹‰à¸­à¸œà¸´à¸”à¸žà¸¥à¸²à¸”à¹ƒà¸™à¸à¸²à¸£à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­à¸à¸±à¸šà¸ªà¸¡à¸­à¸‡ AI à¸„à¸£à¸±à¸š ðŸ˜…';
    }
  }

  // Public API exposed for HTML event handlers
  global.AirQualityDashboard = {
    bootstrap,
    loadData,
    confirmExportPDF,
    downloadCSV,
    filterByDate,
    clearDateFilter,
    saveAndLoad,
    closeSettings,
    openExportModal,
    closeExportModal,
    changePage,
    changeRefreshInterval,
    toggleNotifications,
    requestAIUpdate,
    sortTable,
  };

  // Maintain backward compatibility with existing inline handlers (if any)
  global.loadData         = loadData;
  global.confirmExportPDF = confirmExportPDF;
  global.openExportModal  = openExportModal;  // <--- à¹€à¸žà¸´à¹ˆà¸¡à¸šà¸£à¸£à¸—à¸±à¸”à¸™à¸µà¹‰
  global.closeExportModal = closeExportModal; // <--- à¹€à¸žà¸´à¹ˆà¸¡à¸šà¸£à¸£à¸—à¸±à¸”à¸™à¸µà¹‰
  global.downloadCSV      = downloadCSV;
  global.filterByDate     = filterByDate;
  global.clearDateFilter  = clearDateFilter;
  global.saveAndLoad      = saveAndLoad;
  global.closeSettings    = closeSettings;
  global.sortTable        = sortTable;
  global.openQR           = openQR;
  global.closeQR          = closeQR;
  global.changePage       = changePage;
  global.changeRefreshInterval = changeRefreshInterval;
  global.toggleNotifications = toggleNotifications;
  global.requestAIUpdate = requestAIUpdate;

  // Kick off app once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})(window);



