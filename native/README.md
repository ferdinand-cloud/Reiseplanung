# Reiseplan als iPhone- und Android-App (Capacitor-Gerüst)

Dieser Ordner verpackt die PWA aus dem Hauptordner als native App. Die PWA selbst
wird dabei **nicht** verändert: `npm run web` kopiert sie nach `native/www`.

Stand 28.10.2026: iOS-Projekt liegt in `native/ios` (Swift Package Manager, kein CocoaPods nötig),
mit App-Symbol, Startbild und deutschen Berechtigungstexten. Bundle-ID `com.ferdinandcloud.reiseplan`.
Anleitung für den Mac: Seite „TestFlight-Anleitung“ im Projekt.

## Betriebsarten

- **live** (Standard, `npm run ios`): Die App lädt https://ferdinand-cloud.github.io/Reiseplanung/.
  Jeder Push auf main ist ohne neuen Build in der App. Anmeldung wie in Safari. Ohne Netz startet sie nicht.
- **lokal** (`npm run ios:lokal`): Die Web-Dateien stecken in der App. Für die spätere Store-Version.

## Befehle

```bash
cd native
npm install
npm run ios          # PWA kopieren, iOS-Projekt synchronisieren, Xcode öffnen
npm run ios:lokal    # dasselbe, aber Web-Dateien in der App statt live
npm run android      # Android Studio (Projekt vorher einmal: npx cap add android)
npm run bilder       # Symbole/Startbilder neu aus assets/icon.svg erzeugen
```

## Was in der App angepasst werden muss (index.html, später)

Weiche über `window.Capacitor && Capacitor.isNativePlatform()`; im Browser bleibt alles wie bisher.

| Bereich | Heute (PWA) | Nativ |
|---|---|---|
| Standort | `navigator.geolocation` | `@capacitor/geolocation` (Berechtigungstexte in Info.plist) |
| Foto-Ort | EXIF aus Datei, iOS entfernt GPS oft | Foto-Auswahl mit Ortsdaten (eigenes Plugin oder PhotoKit) |
| Push | – | `@capacitor/push-notifications` + Firebase Cloud Messaging + Cloud Function |
| Offline/Hintergrund | Service Worker, nur bei offener App | Service Worker fällt in iOS-WebView weg → Offline-Kacheln über Filesystem, Hintergrund-Upload |
| Teilen | `navigator.share` | `@capacitor/share` |
| Vibration | `navigator.vibrate` (iOS: nein) | `@capacitor/haptics` |
| Tastatur | visualViewport-Tricks | `@capacitor/keyboard` (`resize: none`) |

Details und Reihenfolge: Übersichtsseite „App-Store-Weg“ im Projekt.
