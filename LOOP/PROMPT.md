# Start
In einer Claude-Code-Session mit diesem Repo reicht die Nachricht:

    Lies LOOP/PROMPT.md und arbeite den Loop ab.

Die Session arbeitet eine Aufgabe nach der anderen ab und hält nach jeder
Aufgabe an, bis Ferdinand die Screenshots freigegeben oder kommentiert hat.
Es gelten zusätzlich die Regeln aus CLAUDE.md.

---

# Ziel
Die ÖPNV-Darstellung auf der Karte der Reiseplan-App (index.html, MapLibre GL)
soll so ruhig und klar wirken wie in Apple Maps:
- Linien (U-Bahn, Bus, Fähre): durchgehend ohne Unterbrechungen,
  zoomabhängige Stärke, stimmige Farben, weich abgerundeter Verlauf,
  richtige Ebenen-Reihenfolge.
- Stationen: Verkehrsmittel-Icon, Linien-Badges, hervorgehobene
  Umstiegsstationen, zoomabhängige Namen ohne Überlappung.
- Gilt für die ÖPNV-Ebene (alle Linien) und für die eigene Route in der
  Planansicht. Die Navigation und die Grundkarte werden NICHT verändert.

# Branch
Gearbeitet wird auf dem Branch `loop/oepnv`. Zu Beginn jeder Session:
- Existiert er auf origin: auschecken und mit origin/main aktualisieren.
- Sonst: von origin/main neu anlegen.
Erst nach Ferdinands Freigabe kommt eine Aufgabe nach main.

# Ablauf pro Aufgabe
1. Lies LOOP/TODO.md, LOOP/KRITERIEN.md und LOOP/NOTIZEN.md.
2. Nimm GENAU EINE offene Aufgabe (die oberste mit [ ]). Nichts anderes ändern.
3. Mach VORHER-Screenshots der Szenen aus KRITERIEN.md, die diese Aufgabe
   betreffen, unter LOOP/screens/<aufgaben-nr>/vorher/. Dafür die App mit
   `?rptest` laden und über `window.__rp(code)` Karte, Zoom und Ebenen setzen
   (Vorbild: bestehende Screenshot-Tests in tests/smoke.mjs mit `shot()`).
4. Such im Code die Stelle, an der die Darstellung entsteht. Ändere den Stil
   dort, nicht über nachträgliche Workarounds. Stilwerte (Farben, Stärken,
   Zoomstufen) gehören in die gemeinsame Stil-Definition aus Aufgabe 1.
5. Setze die Änderung um.
6. Schreib einen Test in tests/smoke.mjs, der die Änderung technisch absichert
   (z. B. Layer-Reihenfolge, line-join, Zoom-Ausdruck, Layer existiert).
   Für durchgehende Linien: prüfen, dass bei jeder Linie Ende und Anfang
   aufeinanderfolgender Teilstücke zusammenfallen (Abstand nahe 0 m).
7. Betroffene Tests laufen lassen: cd tests && npm install && node smoke.mjs "Stichwort"
   Nur bei 0 Fehlern weiter, sonst nachbessern.
8. Mach NACHHER-Screenshots derselben Szenen unter
   LOOP/screens/<aufgaben-nr>/nachher/.
9. Vorprüfung: Bewerte die Nachher-Screenshots selbst gegen die passenden
   Kriterien aus KRITERIEN.md. Kriterium L0 (durchgehende Linien) wird bei
   jeder Aufgabe geprüft, die Linien betrifft. Fällt etwas klar durch:
   nachbessern, bevor du Ferdinand fragst (max. 3 Versuche, dann trotzdem
   vorlegen und das Problem offen benennen).
10. Zwischenstand sichern: committen und auf `loop/oepnv` pushen
    (Commit-Titel beginnt mit „Loop <Nr>:“). So geht beim Warten nichts verloren.
11. Freigabe durch Ferdinand (siehe unten). NICHT nach main, bevor er
    freigegeben hat.

# Freigabe durch Ferdinand
- Erzeuge pro Szene EIN Vergleichsbild: Vorher links, Nachher rechts,
  beschriftet mit Szene und „Vorher“/„Nachher“, unter
  LOOP/screens/<aufgaben-nr>/vergleich/. Höchstens 3 Bilder pro Freigabe,
  damit es auf dem Handy übersichtlich bleibt.
- Schick die Vergleichsbilder mit SendUserFile (status: proactive, display:
  render), damit sie als Meldung aufs Handy kommen. Ist ein Push-Tool
  verfügbar, schick zusätzlich eine kurze Push-Benachrichtigung.
- Schick dazu eine kurze Nachricht (SendUserMessage), max. 5 Zeilen:
    Aufgabe <Nr>: <Titel>
    Geändert: <1–2 Sätze>
    Vorprüfung: <Kriterien bestanden / offene Punkte>
    Antworte mit: ok · Kommentar · überspringen · stopp
- Danach den Zug BEENDEN und auf Ferdinands Antwort warten. Nicht weiterarbeiten.

# Ferdinands Antwort
- „ok“ / „passt“ / „freigeben“:
  1. Aufgabe in TODO.md abhaken ([x]), NOTIZEN.md ergänzen.
  2. VERSION in sw.js hochzählen.
  3. Branch mit origin/main abgleichen, nach main mergen und pushen.
  4. Volllauf prüfen: GitHub Action „Klicktests“ (oder `node smoke.mjs` im
     Hintergrund). Fehler mit einem Folge-Commit beheben.
  5. Direkt mit der nächsten Aufgabe weitermachen.
- Kommentar (alles andere): Kommentar in NOTIZEN.md festhalten, umsetzen,
  Schritte 6–10 wiederholen und erneut zur Freigabe vorlegen.
- „überspringen“: Änderungen der Aufgabe auf dem Branch zurücknehmen
  (git revert der „Loop <Nr>“-Commits), Aufgabe mit [!] markieren, Grund in
  NOTIZEN.md, pushen, nächste Aufgabe.
- „stopp“: Nichts nach main bringen, Stand in NOTIZEN.md festhalten, auf den
  Branch pushen, aufhören.

# Regeln
- Nicht ändern: Grundkarte, Navigation (inkl. 3D), Menüs, Firebase-Regeln.
- Gefundene neue Probleme als neue Aufgabe ans Ende von TODO.md, nicht sofort
  beheben.
- Platz sparen: keine neuen großen UI-Elemente. Mehrfachauswahlen nur als
  Dropdown mit Checkboxen.
- Wird der Kontext der Session zu lang, verlass dich auf NOTIZEN.md, TODO.md
  und den Branch als Stand, nicht auf frühere Chatnachrichten.

# Abbruch
Sind alle Aufgaben [x] oder [!], schick Ferdinand eine kurze Abschluss-
nachricht mit den erledigten und übersprungenen Aufgaben.
