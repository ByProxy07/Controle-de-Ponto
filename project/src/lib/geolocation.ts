export interface GeoPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export function getCurrentPosition(): Promise<GeoPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocalização não é suportada por este dispositivo."));
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
      (err) => {
        let message = "Não foi possível obter a localização.";
        switch (err.code) {
          case err.PERMISSION_DENIED:
            message =
              "Permissão de localização negada. Habilite para registrar o ponto.";
            break;
          case err.POSITION_UNAVAILABLE:
            message = "Localização indisponível no momento.";
            break;
          case err.TIMEOUT:
            message = "Tempo esgotado ao obter localização.";
            break;
        }
        reject(new Error(message));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

export function getGoogleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}
