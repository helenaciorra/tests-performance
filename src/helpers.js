// Shared locations and URL builder used across all test scenarios

export const BASE_URL = "https://api.open-meteo.com/v1";

// Five locations spread across different climate zones and timezones
export const LOCATIONS = [
  { name: "Sao Paulo", lat: -23.55, lon: -46.63 },
  { name: "London",    lat: 51.51,  lon: -0.13  },
  { name: "Tokyo",     lat: 35.68,  lon: 139.69 },
  { name: "New York",  lat: 40.71,  lon: -74.01 },
  { name: "Sydney",    lat: -33.87, lon: 151.21 },
];

// Returns a random location from the list to distribute load across endpoints
export function randomLocation() {
  return LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];
}

// Builds a realistic forecast URL requesting current, hourly and daily data
export function forecastUrl(lat, lon) {
  return (
    `${BASE_URL}/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,wind_speed_10m,precipitation,weather_code` +
    `&hourly=temperature_2m,precipitation_probability` +
    `&daily=precipitation_sum,temperature_2m_max,temperature_2m_min` +
    `&timezone=auto`
  );
}
