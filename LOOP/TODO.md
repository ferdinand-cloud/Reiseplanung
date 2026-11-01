# Loop-To-Do – ÖPNV-Darstellung (U-Bahn, Bus, Fähre)
Gilt für: ÖPNV-Ebene + eigene Route in der Planansicht. Vorbild: Apple Maps.
Legende: [ ] offen · [x] erledigt · [!] blockiert (siehe NOTIZEN.md)

## Grundlage
- [x] 1. Gemeinsame Stil-Definition anlegen (Farben, Stärken, Zoomstufen je Verkehrsmittel), die ÖPNV-Ebene und Planansicht beide verwenden. Optik dabei noch nicht ändern.

## Linien
- [x] 2. Durchgehende Linien: Unterbrechungen beseitigen. Erst die Ursache finden und in NOTIZEN.md festhalten (z. B. Lücken zwischen Shape-Segmenten, fehlende/abgeschnittene Koordinaten, mehrere Teilstücke statt einer zusammenhängenden Linie, Kachelgrenzen, Linien unter Stationsmarkern oder Gebäuden verdeckt). Dann an der Ursache beheben: Teilstücke lückenlos verbinden, sodass jede Linie von Endstation zu Endstation ohne Lücke gezeichnet wird. Gilt für U-Bahn, Bus, Fähre und alle ÖPNV-Abschnitte der Route in der Planansicht.
- [x] 3. Abgerundeter Verlauf: line-join und line-cap "round" für alle ÖPNV-Linien und Routenabschnitte.
- [x] 4. Kantige Geometrien glätten (z. B. Chaikin auf die Linien-Koordinaten), ohne sichtbar von der Strecke abzuweichen und ohne neue Lücken zu erzeugen; Ergebnis cachen statt bei jedem Rendern neu rechnen.
- [x] 5. Zoomabhängige Linienstärke: dünn bei Stadtansicht, kräftiger beim Hineinzoomen; eigene Route in der Planansicht immer klar stärker als die Linien der ÖPNV-Ebene.
- [x] 6. Farben: offizielle Linienfarben für U-Bahn, ruhigere Farbe für Bus, eigene Farbe für Fähre; heller Rand (Casing) für Kontrast auf jedem Untergrund.
- [x] 7. Ebenen-Reihenfolge: Linien über Flächen und Straßen, aber unter Straßen- und Ortsnamen; Verhältnis zu den 3D-Gebäuden sauber (Linien nicht durch Gebäude "abgeschnitten" sichtbar).

## Stationen
- [x] 8. Einheitliche Stationsmarker je Verkehrsmittel (z. B. weißer Punkt mit farbigem Rand), Größe zoomabhängig.
- [x] 9. Verkehrsmittel-Icon am Stationsmarker (U-Bahn, Bus, Fähre), erst ab einer sinnvollen Zoomstufe.
- [x] 10. Linien-Badges an Stationen (farbige Kreise mit Kürzel wie A, C, E); bei Bus erst bei starkem Zoom, damit es nicht überladen wirkt.
- [x] 11. Umstiegsstationen hervorheben (größerer bzw. länglicher Marker, wenn mehrere Linien halten).
- [x] 12. Stationsnamen zoomabhängig einblenden, ohne Überlappung mit anderen Namen und Badges (Kollisionserkennung).

## Abschluss
- [x] 13. Gesamtprüfung: alle Szenen aus KRITERIEN.md neu fotografieren und gegen alle Kriterien bewerten; Abweichungen als neue Aufgaben anlegen.

## Neu gefunden
- [x] 14. Linien verschiedener Farbgruppen auf gemeinsamer Strecke liegen deckungsgleich (z. B. 2 und 5 auf der Nostrand Av: nur Grün sichtbar), weil die Plätze nebeneinander nur je Farbe vergeben werden (`GEO`-Aufbau, `o`).
- [x] 15. New York: Stationen außerhalb des bisherigen Datenkastens (z. B. Rockaway, Coney Island, Flushing-Ende) fehlen, obwohl die Linien jetzt bis zur Endstation reichen.
- [x] 16. Stationsname + Plaketten am rechten Bildrand laufen unter die Kartenknöpfe (Bild hängt immer rechts am Punkt; MapLibre kann Bild-Anker nicht ausweichen lassen), z. B. Fulton St in S3.
- [x] 17. Große Umstiegsknoten (Times Sq-42 St): Plakettenreihe bricht um und liegt über Nachbar-Stationssymbolen; Namen weichen Symbolen bewusst nicht aus (sonst fällt der Name ganz weg). Besser: Plaketten einzeilig bis ca. 10 Linien oder Name an freie Seite (links/rechts) setzen.

## Runde 2 – Linienführung und Haltestellen wie Apple (Ferdinand 01.11.2026, Freigabe automatisch, keine Freigabe je Schritt)
- [x] 18. Ursache im Fehlerprotokoll: warum Linien roh aus den Fahrplandaten gezeichnet werden (lose Enden, schräge Abkürzungen, neben der Straße, beide Richtungen übereinander).
- [x] 19. Busse wie Apple: je Linie ein eigener Strich, Beschriftung wie Apple (Plakette mit Nummer auf der Linie + Name in Linienfarbe, z. B. „20 Madison“) statt gedrehtem Text.
- [x] 20. Jede Fahrtrichtung auf ihrer Seite (rechts der Fahrtrichtung, bei getrennten Fahrbahnen auf der eigenen).
- [x] 21. Linien auf die Straßenachse einrasten (nichts neben der Straße oder über Gehwege).
- [x] 22. An Kreuzungen entlang der Straße abbiegen, keine schrägen Abkürzungen.
- [x] 23. Lose Enden, Haken und kleine Versätze entfernen.
- [x] 24. Kräftigere Linienfarbe mit mehr Kontrast (hell/dunkel).
- [x] 25. Bahnen (U-, S-Bahn, Tram): Bündel mit Linienfarben behalten, gleiche Regeln für saubere Führung.
- [x] 26. Haltestelle als Symbol je Verkehrsmittel (erledigt mit v496, 1b65e00 – prüfen).
- [x] 27. Linien-Plaketten neben dem Symbol, je Richtung an der richtigen Straßenseite.
- [x] 28. Haltestellen direkt auf ihre Linie setzen.
- [x] 29. Bei vielen Haltestellen/Linien je nach Zoom ausdünnen, nichts überlappt.
- [x] 30. Prüfen mit Vorher/Nachher-Bildern: Chicago Columbus Dr, NYC, Berlin Gesundbrunnen, Bremen; Lösung ins Fehlerprotokoll.

## Runde 3 (Ferdinand 01.11., Vergleich Apple Chicago Loop; im Projekt-Chat 14–18)
- [x] 31. (14) Linien auf gemeinsamem Gleis als Bündel (Loop): mit Stadtpaket Chicago; Transitland bleibt ohne Versatz.
- [x] 32. (15) Bahn kräftig, Busse dünn, heller.
- [x] 33. (16) Nummern an der richtigen Linie: Transitland-Beschriftung als Plakette in Linienfarbe.
- [ ] 34. (17) Stationen bei mittlerem Zoom mit Punkt je Linie (Rückfrage an Ferdinand).
- [x] 35. (18) Zoomstufen: Übersicht nur Hauptbusse, ab Zoom 15 alle.
