export function getCurrentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('GPS is not available in this browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position),
      (error) => reject(new Error(error.message || 'Unable to obtain GPS location.')),
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
        ...options
      }
    );
  });
}

export function metersBetween(lat1, lng1, lat2, lng2) {
  const rad = (v) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function mapsLink(lat, lng) {
  return lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null;
}
