// notifications.js -- Notification handling module
(function (global) {
  let notificationsEnabled = false;
  let lastAlertTimestamp = null;
  let showToast = null;

  function init(opts) {
    showToast = opts && opts.showToast ? opts.showToast : null;
  }

  function setEnabled(val) {
    notificationsEnabled = !!val;
  }

  function toggle() {
    const cb = document.getElementById('notifToggleCb');
    if (!cb) return;

    if (cb.checked) {
      if (!('Notification' in global)) {
        if (showToast) {
          showToast('เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน (Notifications)');
        }
        cb.checked = false;
        return;
      }

      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          notificationsEnabled = true;
          if (showToast) {
            showToast('🟢 เปิดระบบแจ้งเตือนสำเร็จ!');
          }
        } else {
          if (showToast) {
            showToast('🔴 คุณปฏิเสธการแจ้งเตือน กรุณาอนุญาตในการตั้งค่าเบราว์เซอร์');
          }
          cb.checked = false;
        }
      });
    } else {
      notificationsEnabled = false;
      if (showToast) {
        showToast('🔴 ปิดระบบแจ้งเตือนแล้ว');
      }
    }
  }

  function checkAlert(lastRow) {
    if (!notificationsEnabled || !lastRow) return;
    if (!('Notification' in global)) return;
    if (Notification.permission !== 'granted') return;

    const pm25 = parseFloat(lastRow['PM2.5']) || 0;
    const ts = lastRow['Timestamp'];

    if (pm25 > 100 && ts !== lastAlertTimestamp) {
      lastAlertTimestamp = ts;

      const notification = new Notification('⚠️ แจ้งเตือนมลพิษทางอากาศ!', {
        body: `ค่า PM2.5 ปัจจุบันพุ่งสูงถึง ${pm25.toFixed(1)} µg/m³ (ระดับอันตราย) โปรดสวมหน้ากากอนามัย N95`,
        icon: 'https://cdn-icons-png.flaticon.com/512/3209/3209935.png'
      });

      setTimeout(() => {
        notification.close();
      }, 7000);

      notification.onclick = () => {
        notification.close();
      };
    }
  }

  global.AQMNotifications = {
    init,
    toggle,
    checkAlert,
    setEnabled
  };
})(window);
