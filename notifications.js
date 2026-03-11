// notifications.js -- Notification handling module
(function (global) {
  let notificationsEnabled = false;
  let lastAlertTimestamp = null;
  let showToast = null;

  function init(opts) {
    showToast = opts && opts.showToast ? opts.showToast : null;
  }

  function isNotificationSupported() {
    return !!global.Notification && typeof global.Notification.requestPermission === 'function';
  }

  function handlePermissionResult(permission, cb) {
    if (permission === 'granted') {
      notificationsEnabled = true;
      if (showToast) {
        showToast('🟢 เปิดระบบแจ้งเตือนสำเร็จ!');
      }
      return;
    }

    notificationsEnabled = false;
    if (cb) cb.checked = false;

    if (showToast) {
      if (permission === 'denied') {
        showToast('🔴 คุณปฏิเสธการแจ้งเตือน กรุณาอนุญาตในการตั้งค่าเบราว์เซอร์');
      } else {
        showToast('🔴 การแจ้งเตือนยังไม่ได้รับอนุญาต');
      }
    }
  }

  function setEnabled(val) {
    notificationsEnabled = !!val;
  }

  function toggle() {
    const cb = document.getElementById('notifToggleCb');
    if (!cb) return;

    if (!isNotificationSupported()) {
      if (showToast) {
        showToast('เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน (Notifications)');
      }
      cb.checked = false;
      return;
    }

    if (cb.checked) {
      if (Notification.permission === 'granted') {
        notificationsEnabled = true;
        if (showToast) {
          showToast('🟢 เปิดระบบแจ้งเตือนสำเร็จ!');
        }
        return;
      }

      if (Notification.permission === 'denied') {
        handlePermissionResult('denied', cb);
        return;
      }

      try {
        const req = Notification.requestPermission();
        if (req && typeof req.then === 'function') {
          req.then(permission => handlePermissionResult(permission, cb))
            .catch(() => handlePermissionResult('denied', cb));
        } else {
          handlePermissionResult(req, cb);
        }
      } catch (err) {
        handlePermissionResult('denied', cb);
      }
    } else {
      notificationsEnabled = false;
      if (showToast) {
        showToast('🔴 ปิดระบบแจ้งเตือนแล้ว');
      }
    }
  }

  function checkAlert(lastRow) {
    if (!notificationsEnabled || !lastRow) return;
    if (!isNotificationSupported()) return;
    if (Notification.permission !== 'granted') return;

    const pm25 = parseFloat(lastRow['PM2.5']) || 0;
    const ts = lastRow['Timestamp'];

    if (pm25 > 100 && ts !== lastAlertTimestamp) {
      lastAlertTimestamp = ts;

      try {
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
      } catch (err) {
        notificationsEnabled = false;
        if (showToast) {
          showToast('ไม่สามารถแสดงการแจ้งเตือนได้ในขณะนี้');
        }
      }
    }
  }

  global.AQMNotifications = {
    init,
    toggle,
    checkAlert,
    setEnabled
  };
})(window);