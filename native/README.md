# Reiseplan als iPhone- und Android-App (Capacitor-Gerüst)

Dieser Ordner verpackt die PWA aus dem Hauptordner als native App. Die PWA selbst
wird dabei **nicht** verändert: `npm run web` kopiert sie nach `native/www`.

Stand: Gerüst, noch nicht im Store. Getestet: `npm install`, `cap add android`,
`cap sync android` laufen durch (10 Plugins erkannt). iOS braucht Xcode (Mac oder
macOS-Runner bei GitHub Actions).

## Vor dem ersten echten Build festlegen

- `appId` in `capacitor.config.json` (z. B. `app.pierce.travel`). **Nicht mehr änderbar,
  sobald die App in einem Store ist.** Erst nach der Namensentscheidung setzen.
- `appName` (Name unter dem Symbol).

## Befehle

```bash
cd native
npm install
npm run web                 # PWA nach www kopieren
npx cap add ios             # einmalig, erzeugt native/ios (braucht Mac/Xcode)
npx cap add android         # einmalig, erzeugt native/android
npm run icons               # App-Symbole/Startbild aus icons/ erzeugen (assets/ anlegen)
npm run ios                 # kopieren, synchronisieren, Xcode öffnen
npm run android             # kopieren, synchronisieren, Android Studio öffnen
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
