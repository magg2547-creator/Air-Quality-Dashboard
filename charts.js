// charts.js — Chart.js and gauge initialization


const hasChartLib = !!window.Chart;
if (hasChartLib) {
  Chart.defaults.color       = '#64748b';
  Chart.defaults.borderColor = 'rgba(0,0,0,0.06)';
  Chart.defaults.font.family = "'DM Sans', sans-serif";
}
const charts = {};
// GAUGE_LEN = circumference of the SVG arc (radius = 85px, as defined in index.html)
const GAUGE_LEN = Math.PI * 85;

const _LEGEND_CONFIG = {
  position: 'top',
  labels: {
    boxWidth: 8,
    padding: 16,
    font: { size: 11 },
    usePointStyle: true,
    pointStyle: 'circle',
    generateLabels(chart) {
      const base = Chart.defaults.plugins.legend.labels.generateLabels(chart);
      base.forEach(l => { l.text = '  ' + l.text; });
      return base;
    }
  }
};

const _TOOLTIP_CONFIG = {
  backgroundColor: '#1e293b',
  titleColor: '#94a3b8',
  bodyColor: '#f1f5f9',
  borderColor: 'rgba(255,255,255,0.08)',
  borderWidth: 1,
  padding: 12,
  cornerRadius: 8
};


function makeChart(id, datasets, yLabel) {
    if (!hasChartLib) return null;
    const ctx = document.getElementById(id).getContext('2d');
    return new Chart(ctx, {
      type: 'line',
      data: { labels: [], datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: _LEGEND_CONFIG,
          tooltip: _TOOLTIP_CONFIG
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              maxTicksLimit: 5,
              maxRotation: 0,
              autoSkip: true,
              font: { size: 10 },
              color: '#94a3b8'
            },
            border: { display: false }
          },
          y: {
            grid: { color: 'rgba(0,0,0,0.05)', drawBorder: false },
            title: { display: !!yLabel, text: yLabel, font: { size: 10 }, color: '#94a3b8' },
            ticks: { font: { size: 10 }, color: '#94a3b8', padding: 6 },
            border: { display: false, dash: [4, 4] }
          }
        },
        elements: {
          line:  { tension: 0.4, borderWidth: 2.5 },
          point: { radius: 0, hitRadius: 16, hoverRadius: 4, hoverBorderWidth: 2 }
        }
      }
    });
  }


function initCharts() {
    if (!hasChartLib) {
      ['chartPm25', 'chartPm10', 'chartTempHum'].forEach(id => {
        const canvas = document.getElementById(id);
        if (!canvas || !canvas.parentElement) return;
        canvas.style.display = 'none';
        const fallback = document.createElement('div');
        fallback.className = 'loading-overlay';
        fallback.textContent = 'Charts are unavailable because Chart.js failed to load.';
        canvas.parentElement.appendChild(fallback);
      });
      showToast('Chart.js failed to load. Dashboard data will still work without charts.');
      return;
    }

    charts.pm25 = makeChart('chartPm25', [{
      label: 'PM2.5 (\u00B5g/m\u00B3)',
      borderColor: '#0284c7',
      backgroundColor: (ctx) => {
        const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 200);
        g.addColorStop(0, 'rgba(2,132,199,0.15)');
        g.addColorStop(1, 'rgba(2,132,199,0)');
        return g;
      },
      fill: true,
      data: []
    }], '\u00B5g/m\u00B3');

    charts.pm10 = makeChart('chartPm10', [{
      label: 'PM10 (\u00B5g/m\u00B3)',
      borderColor: '#7c3aed',
      backgroundColor: (ctx) => {
        const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 200);
        g.addColorStop(0, 'rgba(124,58,237,0.15)');
        g.addColorStop(1, 'rgba(124,58,237,0)');
        return g;
      },
      fill: true,
      data: []
    }], '\u00B5g/m\u00B3');

    const ctxTH = document.getElementById('chartTempHum').getContext('2d');
    charts.tempHum = new Chart(ctxTH, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Temperature (\u00B0C)',
            borderColor: '#ea580c',
            backgroundColor: 'transparent',
            fill: false,
            data: [],
            yAxisID: 'yTemp',
            tension: 0.4,
            borderWidth: 2.5,
            pointRadius: 0,
            pointHitRadius: 16,
            pointHoverRadius: 4
          },
          {
            label: 'Humidity (%)',
            borderColor: '#16a34a',
            backgroundColor: 'transparent',
            fill: false,
            data: [],
            yAxisID: 'yHum',
            tension: 0.4,
            borderWidth: 2.5,
            pointRadius: 0,
            pointHitRadius: 16,
            pointHoverRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: _LEGEND_CONFIG,
          tooltip: { ..._TOOLTIP_CONFIG, borderColor: 'rgba(0,0,0,0.1)' }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              maxTicksLimit: 5,
              maxRotation: 0,
              autoSkip: true,
              font: { size: 10 },
              color: '#94a3b8'
            },
            border: { display: false }
          },
          yTemp: {
            type: 'linear',
            position: 'left',
            grid: { color: 'rgba(0,0,0,0.05)', drawBorder: false },
            title: { display: true, text: '\u00B0C', color: '#ea580c', font: { size: 10 } },
            ticks: { color: '#ea580c', font: { size: 10 }, padding: 6 },
            border: { display: false }
          },
          yHum: {
            type: 'linear',
            position: 'right',
            grid: { drawOnChartArea: false },
            title: { display: true, text: '%', color: '#16a34a', font: { size: 10 } },
            ticks: { color: '#16a34a', font: { size: 10 }, padding: 6 },
            border: { display: false },
            min: 0,
            max: 100
          }
        }
      }
    });
  }


function updateCharts(rows) {
    if (!hasChartLib || !charts.pm25 || !charts.pm10 || !charts.tempHum) return;
    const slice = rows.slice(-30);

    const labels   = [];
    const pm25Data = [];
    const pm10Data = [];
    const tempData = [];
    const humData  = [];

    for (let i = 0; i < slice.length; i++) {
      const r = slice[i];
      const d = parseTimestamp(r.Timestamp);

      if (d) {
        const day   = d.getDate();
        const month = d.getMonth() + 1;
        const hour  = String(d.getHours()).padStart(2, '0');
        const mins  = String(d.getMinutes()).padStart(2, '0');
        labels.push(`${day}/${month} ${hour}:${mins}`);
      } else {
        labels.push(r.Timestamp || '');
      }

      pm25Data.push(+r['PM2.5']             || 0);
      pm10Data.push(+r['PM10']              || 0);
      tempData.push(parseFloat(r['Temperature']) || 0);
      humData.push(parseFloat(r['Humidity'])    || 0);
    }

    charts.pm25.data.labels              = labels;
    charts.pm25.data.datasets[0].data    = pm25Data;
    charts.pm25.update('none');

    charts.pm10.data.labels              = labels;
    charts.pm10.data.datasets[0].data    = pm10Data;
    charts.pm10.update('none');

    charts.tempHum.data.labels           = labels;
    charts.tempHum.data.datasets[0].data = tempData;
    charts.tempHum.data.datasets[1].data = humData;
    charts.tempHum.update('none');
  }


function initGauge() {
    const fill = document.getElementById('gaugeFill');
    fill.style.strokeDasharray  = GAUGE_LEN;
    fill.style.strokeDashoffset = GAUGE_LEN;

    const fill10 = document.getElementById('gaugeFill10');
    fill10.style.strokeDasharray  = GAUGE_LEN;
    fill10.style.strokeDashoffset = GAUGE_LEN;
  }


/**
 * updateGauge(gaugeId, numId, value, maxVal)
 * Generic gauge updater — eliminates duplicated code between PM2.5 and PM10 gauges.
 *   gaugeId : id of the <path> fill element   (e.g. 'gaugeFill', 'gaugeFill10')
 *   numId   : id of the numeric label element  (e.g. 'gaugeNum',  'gaugeNum10')
 *   value   : current reading
 *   maxVal  : value that maps to 100% of the arc
 */
function updateGauge(gaugeId, numId, value, maxVal) {
    const pct  = Math.min(Math.max(value, 0) / maxVal, 1);
    const fill = document.getElementById(gaugeId);
    fill.style.strokeDashoffset = GAUGE_LEN * (1 - pct);
    const gn = document.getElementById(numId);
    gn.classList.remove('pop'); void gn.offsetWidth;
    gn.classList.add('pop');
    gn.textContent = value.toFixed(1);
  }

// Convenience wrappers used by script.js (keep original call-sites unchanged)
function updateGaugePm25(value)  { updateGauge('gaugeFill',   'gaugeNum',   value, 150); }
function updateGaugePm10(value)  { updateGauge('gaugeFill10', 'gaugeNum10', value, 300); }

