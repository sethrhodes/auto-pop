// Single source of truth for the backend address.
// - Vite dev server (port 5173): backend runs separately on :3000
// - Production build (served BY the backend): same origin as the page,
//   which works on localhost:3000, LAN IPs, and public tunnel/host URLs.
export const BACKEND_URL = window.location.port === "5173"
    ? `http://${window.location.hostname}:3000`
    : "";
