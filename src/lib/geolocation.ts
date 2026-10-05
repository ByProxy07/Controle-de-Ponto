export interface GeoPosition {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
}

export function getCurrentPosition(): Promise<GeoPosition> {
  return new Promise((resolve) => {
    // Se o navegador não suportar geolocalização ou estiver em HTTP, não lança erro
    if (!navigator.geolocation) {
      resolve({ latitude: null, longitude: null, accuracy: null });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      () => {
        // Se der erro de permissão/HTTP/timeout, resolve pacificamente com valores nulos
        resolve({ latitude: null, longitude: null, accuracy: null });
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 0 }
    );
  });
}

export function getGoogleMapsUrl(lat: number | null, lng: number | null): string {
  if (!lat || !lng) return "#";
  return `https://www.google.com/maps?q=${lat},${lng}`;
}