const history = hist.map(pt => ({
  ...pt,
  timestamp: pt.timestamp * 1000
}));

const maxDataTs = history.length ? Math.max(...history.map(pt => pt.timestamp)) : Date.now();
const now = Math.max(Date.now(), maxDataTs);

// Floor helper
function floorToHour(ms) {
  const d = new Date(ms);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

// Tick steps (ms) to aim for points
const steps = {
  '12h': 5 * 60 * 1000,     // 5 minutes
  '24h': 3600e3,            // 1 hour
  '7d': 8 * 3600e3,         // 8 hours
  '24d': 24 * 3600e3,       // 1 day
  'all': 3 * 24 * 3600e3    // 3 days
};

// Define time spans
const spans = {
  '12h': () => {
    const bucketSize = steps['12h'];
    const end = now;               // real-time cursor
    const start = end - 12 * 3600e3;
    return [start, end];
  },
  '24h': () => {
    const bucketSize = steps['24h'];
    const end = floorToHour(now) + bucketSize;
    const start = end - 24 * bucketSize;
    return [start, end];
  },
  '7d': () => {
    const bucketSize = steps['7d'];
    const end = floorToHour(now) + bucketSize;
    const start = end - 7 * 24 * 3600e3;
    return [start, end];
  },
  '24d': () => {
    const bucketSize = steps['24d'];
    const end = floorToHour(now) + bucketSize;
    const start = end - 24 * 24 * 3600e3;
    return [start, end];
  },
  'all': () => {
    const tsList = history.map(pt => pt.timestamp);
    return [Math.min(...tsList), floorToHour(now) + steps['all']];
  }
};

// Formatting for labels
const formats = {
  '12h': ts => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  },
  '24h': ts => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], {hour: '2-digit'}) + 'h';
  },
  '7d': ts => {
    const d = new Date(ts);
    return d.toLocaleDateString([], {weekday: 'short'}) + ' ' + d.getHours() + 'h';
  },
  '24d': ts => {
    const d = new Date(ts);
    return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2);
  },
  'all': ts => {
    const d = new Date(ts);
    return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear().toString().slice(-2);
  }
};

let chart;

const zoomConfig = {
  pan: {enabled: true, mode: 'x'},
  zoom: {wheel: {enabled: true}, mode: 'x'}
};

function updateChart(span) {
  const bucketSize = steps[span];
  const [start, end] = spans[span]();
  const totalBuckets = Math.ceil((end - start) / bucketSize);

  // Init buckets
  const buckets = Array.from({length: totalBuckets}, () => []);

  // Distribute data
  history.forEach(pt => {
    if (pt.timestamp >= start && pt.timestamp < end) {
      const idx = Math.floor((pt.timestamp - start) / bucketSize);
      if (buckets[idx]) buckets[idx].push(pt.vr);
    }
  });

  // Build series
  const labels = [];
  const dataPts = [];
  for (let i = 0; i < totalBuckets; i++) {
    const ts = start + i * bucketSize;
    labels.push(formats[span](ts));
    if (buckets[i].length) {
      dataPts.push(Math.max(...buckets[i]));
    } else {
      dataPts.push(null);
    }
  }

  const firstIdx = dataPts.findIndex(v => v !== null);
  const lastIdx = dataPts.length - 1 - [...dataPts].reverse().findIndex(v => v !== null);

  // all null by default
  const extStart = Array(dataPts.length).fill(null);
  const extEnd = Array(dataPts.length).fill(null);

  // flat line at the first real value, from bucket 0 → firstIdx
  if (firstIdx > 0) {
    for (let i = 0; i <= firstIdx; i++) {
      extStart[i] = dataPts[firstIdx];
    }
  }

  // flat line at the last real value, from lastIdx → end
  if (lastIdx < dataPts.length - 1) {
    for (let i = lastIdx; i < dataPts.length; i++) {
      extEnd[i] = dataPts[lastIdx];
    }
  }


  if (chart) chart.destroy();

  const desiredPoints = 24;
  const initialMin = Math.max(0, totalBuckets - desiredPoints);
  const initialMax = totalBuckets - 1;

  const xScale = {
    ticks: {
      autoSkip: false,
      maxRotation: 45
    }
  };

  if (span === '12h' || span === 'all') {
    xScale.min = initialMin;
    xScale.max = initialMax;
  }

  const ctx = document.getElementById('vrChart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'VR',
        data: dataPts,
        spanGaps: true,
        fill: true,
        tension: 0.1,
        segment: {
          borderColor: ctx => {
            const {p0, p1} = ctx;
            // if either point is “null” (gap) fall back to blue
            if (p0.parsed.y == null || p1.parsed.y == null) {
              return 'rgb(75, 192, 192)';
            }
            // rising → green
            if (p1.parsed.y > p0.parsed.y) {
              return 'green';
            }
            // falling → red
            if (p1.parsed.y < p0.parsed.y) {
              return 'red';
            }
            // equal → blue
            return 'rgb(75, 192, 192)';
          }
        },
        pointBackgroundColor: ctx => {
          const i = ctx.dataIndex;
          const cur = ctx.dataset.data[i];
          const prev = i > 0 ? ctx.dataset.data[i - 1] : null;
          if (prev == null || cur === prev) {
            return 'rgb(75, 192, 192)';
          }
          return cur > prev ? 'green' : 'red';
        }
      },
        {
          // leading extension
          label: 'start‑gap',
          data: extStart,
          fill: false,
          borderColor: 'rgb(75, 192, 192)',
          borderDash: [5, 5],
          pointRadius: 0,
          tension: 0
        },
        {
          // trailing extension
          label: 'end‑gap',
          data: extEnd,
          fill: false,
          borderColor: 'rgb(75, 192, 192)',
          borderDash: [5, 5],
          pointRadius: 0,
          tension: 0
        }]
    },
    options: {
      plugins: {
        legend: {
          display: false
        },
        zoom: (span === 'all' || span === '12h') ? {
          pan: {enabled: true, mode: 'xy'},
          zoom: {wheel: {enabled: true}, pinch: {enabled: true}, mode: 'x'},
        } : false
      },
      scales: {
        x: xScale,
        y: {title: {display: true, text: 'VR Value'}}
      }
    }
  });
}

document.querySelectorAll('.controls button').forEach(btn => {
  btn.addEventListener('click', () => updateChart(btn.dataset.span));
});

// Show initial span
updateChart('24h');

(() => {
  const histori = data["history"].slice()  // copy
      .sort((a, b) => b.timestamp - a.timestamp); // most recent first

  const PAGE_SIZE = 100;
  let renderedCount = 0;

  // format timestamp
  function fmt(ts) {
    const d = new Date(ts * 1000);
    // Use local date parts so key and label match the same day.
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const dateKey = `${yyyy}-${mm}-${dd}`;
    const dateLabel = d.toLocaleDateString(undefined, {
      weekday: 'short', day: 'numeric', month: 'long', year: 'numeric'
    });
    const timeLabel = d.toLocaleTimeString(undefined, {
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    return {dateKey, dateLabel, timeLabel};
  }

  function renderRows() {
    const tbody = document.querySelector('#vr-log-table tbody');
    let currentDate = null;

    const end = Math.min(renderedCount + PAGE_SIZE, histori.length);
    for (let i = renderedCount; i < end; i++) {
      const entry = histori[i];
      const {dateKey, dateLabel, timeLabel} = fmt(entry.timestamp);

      // insert date divider when day changes
      if (dateKey !== currentDate) {
        const trDate = document.createElement('tr');
        trDate.className = 'date-divider';
        trDate.innerHTML = `<td colspan="3">${dateLabel}</td>`;
        tbody.appendChild(trDate);
        currentDate = dateKey;
      }

      // change vs next entry
      let change = '';
      let diff = 0;
      if (i < histori.length - 1) {
        diff = entry.vr - histori[i + 1].vr;
        change = (diff > 0 ? '+' : '') + diff;
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="time-cell">${timeLabel}</td>
        <td class="vr-cell">${entry.vr}</td>
        <td class="chg-cell" style="color: ${diff > 0 ? '#44EE22' : (diff < 0 ? '#EE3322' : 'inherit')}">${change}</td>
      `;
      tbody.appendChild(tr);
    }

    renderedCount = end;
    if (renderedCount >= histori.length) {
      document.getElementById('load-more-btn').style.display = 'none';
    }
  }

  document.getElementById('load-more-btn')
      .addEventListener('click', renderRows);

  // initial render
  renderRows();
})();