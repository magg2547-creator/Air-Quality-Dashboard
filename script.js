// script.js — Main application logic (rendering, loading, filters, export, QR, bootstrap)
// Depends on: data.js, charts.js  (must be loaded first)
/* global AppState, updateCharts, parseTimestamp, normaliseRows, updateGaugePm25, updateGaugePm10, initCharts, initGauge */
(function (global) {



  function debugLog() {
    if (!AppState || !AppState.debug) return;
    if (global.console && typeof global.console.log === 'function') {
      global.console.log.apply(global.console, arguments);
    }
  }

  function setLoadingState(active) {
    const analytics = document.querySelectorAll('.analytics-value, .gauge-number');
    analytics.forEach(el => el.classList.toggle('skeleton', active));
    const charts = document.querySelectorAll('.chart-container');
    charts.forEach(el => el.classList.toggle('loading', active));
  }

  function getChartRows(rows) {
    if (!rows) return [];
    if (chartRange === 'all') return rows;
    return rows.slice(-chartRange);
  }

  function updateChartsWithRange(rows) {
    updateCharts(getChartRows(rows || AppState.allData));
  }

  function updateChartRangeUI() {
    document.querySelectorAll('.chart-range-btn').forEach(btn => {
      const active = String(chartRange) === btn.dataset.range;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function setChartRange(val) {
    if (val === 'all') {
      chartRange = 'all';
    } else {
      const parsed = parseInt(val, 10);
      chartRange = Number.isFinite(parsed) ? parsed : 30;
    }
    updateChartRangeUI();
    updateChartsWithRange(AppState.allData);
  }

  function bindChartRangeControls() {
    const buttons = document.querySelectorAll('.chart-range-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => setChartRange(btn.dataset.range));
    });
    updateChartRangeUI();
  }
  /* ===================================================
     STATE & AUTO-REFRESH & NOTIFICATION
  =================================================== */
  let currentRefreshSecs = 300;
  let countdown = currentRefreshSecs;
  let isLoading = false;
  let isPaused = false;
  let chartRange = 30;
  
  // สถานะ Pagination
  let currentPage = 1;
  const TABLE_ROWS_PER_PAGE = 25;
  let currentViewData = []; // เก็บข้อมูลที่ถูกฟิลเตอร์แล้วเพื่อเอามาแบ่งหน้า


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
      setLoadingState(false);
      return;
    }

    AppState.allData = rows;
    _dataCacheSource = null;  // invalidate date filter cache
    const n    = rows.length;
    const last = rows[n - 1];
    const prev = n > 1 ? rows[n - 2] : null;

    if (global.AQMNotifications && typeof global.AQMNotifications.checkAlert === 'function') {
      global.AQMNotifications.checkAlert(last);
    }

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
    updateChartsWithRange(rows);

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

    setLoadingState(false);
    resetCountdown();
  }

  /* ===================================================
     TABLE & FILTERING
  =================================================== */
  // Cache: pre-parsed ISO date strings per row (rebuilt when AppState.allData changes)
  let _dateCache = null;
  let _dataCacheSource = null;

  function getDateCache() {
    if (_dataCacheSource === AppState.allData) return _dateCache;
    _dataCacheSource = AppState.allData;
    _dateCache = AppState.allData.map(r => {
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
      renderTable(AppState.allData.slice().reverse());
      setText('filterCount', '');
      updateHeaderMeta(undefined, AppState.allData.length ? 'Latest reading available' : 'Latest reading ready', undefined);
      return;
    }

    const cache = getDateCache();
    const filtered = AppState.allData.filter((_, i) => cache[i] === val);

    renderTable(filtered.slice().reverse());

    const count = filtered.length;
    const label = document.getElementById('filterCount');
    label.textContent = count > 0 ? `${count} records on this date` : 'No records for this date';
    label.style.color = count > 0 ? 'var(--good)' : 'var(--hazardous)';
    updateHeaderMeta(undefined, 'Filtered: ' + document.getElementById('dateFilter').value, count + ' matching rows');
  }

  function clearDateFilter() {
    if (AppState.datePicker) AppState.datePicker.clear();
    else document.getElementById('dateFilter').value = '';
    renderTable(AppState.allData.slice().reverse());
    setText('filterCount', '');
    updateHeaderMeta(undefined, AppState.allData.length ? 'Latest reading available' : 'Latest reading ready', AppState.allData.length ? AppState.allData.length + ' total rows' : 'No data loaded');
  }

  function initDatePicker() {
    if (!global.flatpickr) return;
    AppState.datePicker = global.flatpickr('#dateFilter', {
      dateFormat: 'd/m/Y',
      locale: global.flatpickr.l10ns.th || 'default',
      monthSelectorType: 'static',
      disableMobile: true,
      allowInput: false,
      clickOpens: true,
      onChange: filterByDate
    });
  }
  function renderTable(rows) {
    currentViewData = rows;
    currentPage = 1;
    renderTablePage();
  }

  // script.js — Optimized Rendering logic

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

  // ใช้ DocumentFragment เพื่อความเร็วสูงสุดในการวาด DOM
  const fragment = document.createDocumentFragment();
  
  pageRows.forEach(r => {
    const tr = document.createElement('tr');
    
    // สร้าง Cell แบบเจาะจงเพื่อลดการทำ HTML Parsing
    tr.innerHTML = `
      <td class="ts">${escapeHTML(fmtTs(r['Timestamp']))}</td>
      <td class="pm25v">${r['PM2.5'].toFixed(1)}</td>
      <td class="pm10v">${r['PM10'].toFixed(1)}</td>
      <td class="tempv">${r['Temperature'].toFixed(1)}</td>
      <td class="humv">${r['Humidity'].toFixed(1)}</td>
    `;
    fragment.appendChild(tr);
  });

  // ล้างค่าเก่าและใส่ Fragment ใหม่ทีเดียว (ลด Reflow)
  tbody.replaceChildren(fragment);

  updatePaginationUI(currentPage, totalPages);
}

function updatePaginationUI(page, total) {
  document.getElementById('pageInfo').textContent = `หน้า ${page} / ${total}`;
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
      const isActive = Number(th.dataset.sortCol) === AppState.sortCol;
      th.setAttribute('aria-sort', isActive ? (AppState.sortAsc ? 'ascending' : 'descending') : 'none');
    });
  }

  function sortTable(col) {
    if (AppState.sortCol === col) AppState.sortAsc = !AppState.sortAsc;
    else { AppState.sortCol = col; AppState.sortAsc = true; }

    const keys = ['Timestamp', 'PM2.5', 'PM10', 'Temperature', 'Humidity'];
    const key  = keys[col];
    const sorted = [...AppState.allData].sort((a, b) => {
      const av = col === 0 ? (parseTimestamp(a[key])?.getTime() ?? Number.NEGATIVE_INFINITY) : +a[key];
      const bv = col === 0 ? (parseTimestamp(b[key])?.getTime() ?? Number.NEGATIVE_INFINITY) : +b[key];
      return (av > bv ? 1 : av < bv ? -1 : 0) * (AppState.sortAsc ? 1 : -1);
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
      const s = document.getElementById('splash');
      if (s) s.classList.add('hide');
    }, 400);
  }

  function forceHideSplash(msg) {
    try {
      splashProgress(100, msg || 'Ready');
    } catch (e) {
      // ignore
    }
    const s = document.getElementById('splash');
    if (s) s.classList.add('hide');
  }

  window.addEventListener('error', () => {
    forceHideSplash('Error');
    try { topBarError(); } catch (e) { /* ignore */ }
    showToast('Unexpected error occurred. Please reload the page.');
  });

  window.addEventListener('unhandledrejection', () => {
    forceHideSplash('Error');
    try { topBarError(); } catch (e) { /* ignore */ }
    showToast('Unexpected error occurred. Please reload the page.');
  });

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
    if (!url) { showToast('Please enter an Apps Script URL.'); setLoadingState(false); return; }

    isLoading = true;
    setLoadingState(true);
    showToast('Loading data...');
    setText('sysConn', 'Loading...');
    updateHeaderMeta('Refreshing now...', 'Checking data source...', AppState.allData.length ? AppState.allData.length + ' cached rows' : 'Preparing dataset');
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
      done = true; isLoading = false; setLoadingState(false);
      topBarError();
      splashProgress(100, 'Timeout');
      setTimeout(() => document.getElementById('splash').classList.add('hide'), 800);
      showToast('Request timed out. Check the URL and deploy permissions.');
      setText('sysConn', 'Timeout');
      updateHeaderMeta('Sync timeout', 'Connection needs attention', AppState.allData.length ? AppState.allData.length + ' cached rows' : 'No cached data');
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
        debugLog('[AQM] fetch OK -', rows.length, 'rows');
        isLoading = false;
        renderDashboard(rows);
        topBarDone(); splashHide();
        showToast('Loaded ' + rows.length + ' rows successfully.');
      })
      .catch(err => {
        if (done) return;
        clearTimeout(timer);
        debugLog('[AQM] fetch failed, JSONP fallback...', err.message);
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
      isLoading = false; setLoadingState(false); topBarError();
      splashProgress(100, 'Connection failed');
      setTimeout(() => document.getElementById('splash').classList.add('hide'), 800);
      showToast(msg);
      setText('sysConn', 'Error');
      updateHeaderMeta('Connection failed', 'Unable to reach source', AppState.allData.length ? AppState.allData.length + ' cached rows' : 'No cached data');
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
        debugLog('[AQM] JSONP OK -', rows.length, 'rows');
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
    if (global.AQMExport && typeof global.AQMExport.confirmExportPDF === 'function') {
      global.AQMExport.confirmExportPDF();
    }
  }

  function clearExportDateFilter() {
    if (global.AQMExport && typeof global.AQMExport.clearDateFilter === 'function') {
      global.AQMExport.clearDateFilter();
    }
  }

  function downloadCSV() {
    if (!AppState.allData.length) {
      showToast('No data yet - click Reload Data first.');
      return;
    }

    const headers = ['Timestamp', 'PM2.5', 'PM10', 'Temperature', 'Humidity'];
    const lines   = [
      headers.join(','),
      ...AppState.allData.map(r =>
        headers.map(h => `"${(r[h] !== undefined ? r[h] : '')}"`).join(',')
      )
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href     = URL.createObjectURL(blob);
    link.download = 'air_quality_' + new Date().toISOString().slice(0, 10) + '.csv';
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('CSV downloaded (' + AppState.allData.length + ' rows).');
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
      setLoadingState(false);
    resetCountdown();
    }
  }

  setInterval(() => {
    if (isLoading || isPaused) return;

    countdown = Math.max(0, countdown - 1);

    if (countdown === 0) {
      countdown = currentRefreshSecs;
      if (document.getElementById('sheetsUrl').value.trim()) {
        loadData(); // โหลดข้อมูลใหม่เมื่อหมดเวลา
      }
    }

    const pct  = (countdown / currentRefreshSecs) * 100;
    const mins = Math.floor(countdown / 60);
    const secs = String(countdown % 60).padStart(2, '0');

    document.getElementById('refreshFill').style.width    = pct + '%';
    document.getElementById('countdownText').textContent  = `${mins}:${secs}`;
  }, 1000);

  // ==========================================
  // ระบบ Notification แจ้งเตือนฝุ่น
  // ==========================================
  // ==========================================
  // ระบบ Notification แจ้งเตือนฝุ่น (อัปเดตใหม่เป็น Toggle)
  // ==========================================
  function toggleNotifications() {
    if (global.AQMNotifications && typeof global.AQMNotifications.toggle === 'function') {
      global.AQMNotifications.toggle();
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
    
    // ใช้ dayjs ในการจัดรูปแบบวันที่แทน toLocaleString เพื่อความสม่ำเสมอ
    if (short) {
      return dayjs(d).format('HH:mm'); // แสดงแค่เวลา เช่น 18:00
    }
    
    // แสดงวันที่เต็มแบบ ค.ศ. (เช่น 09/03/2026 18:00)
    return dayjs(d).format('DD/MM/YYYY HH:mm'); 
    
    /* หมายเหตุ: ถ้าอยากให้แสดงผลเป็นปี พ.ศ. แบบเต็ม (เช่น 09/03/2569 18:00)
      ให้เปลี่ยนบรรทัดบนเป็น:
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
  let lastFocusedElement = null;
  let qrTrapHandler = null;
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
    qrTrapHandler = (e) => trapFocus(modal, e);
    modal.addEventListener('keydown', qrTrapHandler);
    
    // ล็อคหน้าจอพื้นหลังไม่ให้เลื่อนเวลาเปิด Popup (ถ้ามี)
    document.body.style.overflow = 'hidden';

    setTimeout(() => { const closeBtn = modal.querySelector('.qr-close'); if (closeBtn) closeBtn.focus(); }, 0);

    if (!global.QRCode) {
      wrap.innerHTML = '<div style="padding:24px 18px;border:1px dashed #cbd5e1;border-radius:14px;color:#64748b;font-size:0.82rem;text-align:center">QR library unavailable<br>Open this link directly instead.</div>';
      showToast('QR generator is unavailable right now.');
      return;
    }

    try {
      // 🌟 ตั้งค่าให้กล่อง QR รองรับการวางโลโก้ทับแบบ CSS
      wrap.style.position = 'relative';
    new QRCode(wrap, {
        text: DASHBOARD_URL,
        width: 220,
        height: 220,
        colorDark: '#0f172a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });

      // 🌟 สร้างโลโก้และใช้ CSS แปะทับตรงกลาง
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
      
      // วาดไอคอนใบไม้ด้านใน
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

  // อัปเดตฟังก์ชันปิด QR ให้คลายการล็อคหน้าจอด้วย
  function closeQR() {
    const modal = document.getElementById('qrModal');
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    if (qrTrapHandler) {
      modal.removeEventListener('keydown', qrTrapHandler);
      qrTrapHandler = null;
    }
    document.body.style.overflow = '';
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus();
    }
  }

  /* ===================================================
     EXPORT PDF MODAL
  =================================================== */

  function openExportModal() {
    if (global.AQMExport && typeof global.AQMExport.openModal === 'function') {
      global.AQMExport.openModal();
    }
  }

  function closeExportModal() {
    if (global.AQMExport && typeof global.AQMExport.closeModal === 'function') {
      global.AQMExport.closeModal();
    }
  }

  // ปิด Modal เมื่อกดปุ่ม Escape (ใส่เพิ่มต่อจาก EventListener ของ QR Modal ได้เลย)
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
    bindChartRangeControls();
    if (global.AQMNotifications && typeof global.AQMNotifications.init === 'function') {
      global.AQMNotifications.init({ showToast });
    }
    if (global.AQMExport && typeof global.AQMExport.init === 'function') {
      global.AQMExport.init({
        showToast,
        normalizeFilterDate,
        getDateCache,
        getRows: () => AppState.allData
      });
    }

    splashProgress(30, 'Starting dashboard...');
    const savedUrl = global.localStorage.getItem(STORAGE_KEY);
    document.getElementById('sheetsUrl').value = savedUrl || SCRIPT_URL;

    setTimeout(() => splashProgress(60, 'Loading latest data...'), 300);
    loadData();
    setTimeout(() => {
      const s = document.getElementById('splash');
      if (s && !s.classList.contains('hide')) {
        forceHideSplash('Ready');
      }
    }, 12000);

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
  // 🤖 ระบบ AI Analyst (Gemini)
  // ==========================================
  let isAiFetched = false; // ตัวแปรเช็คว่าเคยให้ AI วิเคราะห์หรือยัง

  async function requestAIUpdate() {
    const aiTextEl = document.getElementById('aiSummaryText');
    const scriptUrl = document.getElementById('sheetsUrl').value.trim();
    
    if (!aiTextEl || !scriptUrl) return;
    if (!AppState.allData || AppState.allData.length === 0) {
      aiTextEl.textContent = 'ยังไม่มีข้อมูลสำหรับให้ AI วิเคราะห์ครับ';
      return;
    }

    // ดึงข้อมูลแถวล่าสุด
    const latest = AppState.allData[AppState.allData.length - 1];
    const pm25 = parseFloat(latest['PM2.5']) || 0;
    const temp = parseFloat(latest['Temperature']) || 0;
    const hum = parseFloat(latest['Humidity']) || 0;

    aiTextEl.innerHTML = '<span style="color: #0284c7;">กำลังใช้ความคิด... (รอประมาณ 5-8 วินาที) ⏳</span>';
    
    try {
      // เรียกไปยัง Apps Script พร้อมแนบค่าพารามิเตอร์
      const url = `${scriptUrl}?action=getAI&pm25=${pm25}&temp=${temp}&hum=${hum}`;
      const response = await fetch(url);
      const text = await response.text();
      
      // แสดงผลที่ได้จาก AI
      aiTextEl.innerHTML = `<strong>บทวิเคราะห์:</strong> ${escapeHTML(text)}`;
    } catch (err) {
      debugLog(err);
      aiTextEl.textContent = 'เกิดข้อผิดพลาดในการเชื่อมต่อกับสมอง AI ครับ 😅';
    }
  }

  // Public API exposed for HTML event handlers
  global.AirQualityDashboard = {
    bootstrap,
    loadData,
    confirmExportPDF,
    clearExportDateFilter,
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
  global.clearExportDateFilter = clearExportDateFilter;
  global.openExportModal  = openExportModal;  // <--- เพิ่มบรรทัดนี้
  global.closeExportModal = closeExportModal; // <--- เพิ่มบรรทัดนี้
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
























