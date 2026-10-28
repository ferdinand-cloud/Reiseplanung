import type { CapacitorConfig } from "@capacitor/cli";

// Zwei Betriebsarten:
// - live (Standard für TestFlight): Die App lädt die Website von GitHub Pages.
//   Jeder Push auf main ist sofort in der App, Anmeldung läuft wie in Safari.
// - lokal (RP_LOKAL=1): Die Dateien aus native/www stecken in der App (für den App Store später).
const lokal = process.env.RP_LOKAL === "1";

const config: CapacitorConfig = {
  // Bundle-ID: sieht niemand, bleibt auch bei neuem App-Namen. Nach dem Anlegen in App Store Connect nicht mehr ändern.
  appId: "com.ferdinandcloud.reiseplan",
  appName: "Reiseplan",
  webDir: "www",
  backgroundColor: "#17212c",
  ios: {
    contentInset: "never",
    // Website-Inhalte dürfen nicht von Safari-Datendetektoren umgebaut werden
    allowsLinkPreview: false
  },
  android: { allowMixedContent: false },
  plugins: {
    SplashScreen: { launchAutoHide: true, launchShowDuration: 600, backgroundColor: "#17212c", showSpinner: false },
    Keyboard: { resize: "none" }
  }
};

if (!lokal) {
  config.server = { url: "https://ferdinand-cloud.github.io/Reiseplanung/", cleartext: false };
}

export default config;
