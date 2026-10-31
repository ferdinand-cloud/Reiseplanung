# Loop-To-Do – ÖPNV-Darstellung (U-Bahn, Bus, Fähre)
Gilt für: ÖPNV-Ebene + eigene Route in der Planansicht. Vorbild: Apple Maps.
Legende: [ ] offen · [x] erledigt · [!] blockiert (siehe NOTIZEN.md)

## Grundlage
- [x] 1. Gemeinsame Stil-Definition anlegen (Farben, Stärken, Zoomstufen je Verkehrsmittel), die ÖPNV-Ebene und Planansicht beide verwenden. Optik dabei noch nicht ändern.

## Linien
- [ ] 2. Durchgehende Linien: Unterbrechungen beseitigen. Erst die Ursache finden und in NOTIZEN.md festhalten (z. B. Lücken zwischen Shape-Segmenten, fehlende/abgeschnittene Koordinaten, mehrere Teilstücke statt einer zusammenhängenden Linie, Kachelgrenzen, Linien unter Stationsmarkern oder Gebäuden verdeckt). Dann an der Ursache beheben: Teilstücke lückenlos verbinden, sodass jede Linie von Endstation zu Endstation ohne Lücke gezeichnet wird. Gilt für U-Bahn, Bus, Fähre und alle ÖPNV-Abschnitte der Route in der Planansicht.
- [ ] 3. Abgerundeter Verlauf: line-join und line-cap "round" für alle ÖPNV-Linien und Routenabschnitte.
- [ ] 4. Kantige Geometrien glätten (z. B. Chaikin auf die Linien-Koordinaten), ohne sichtbar von der Strecke abzuweichen und ohne neue Lücken zu erzeugen; Ergebnis cachen statt bei jedem Rendern neu rechnen.
- [ ] 5. Zoomabhängige Linienstärke: dünn bei Stadtansicht, kräftiger beim Hineinzoomen; eigene Route in der Planansicht immer klar stärker als die Linien der ÖPNV-Ebene.
- [ ] 6. Farben: offizielle Linienfarben für U-Bahn, ruhigere Farbe für Bus, eigene Farbe für Fähre; heller Rand (Casing) für Kontrast auf jedem Untergrund.
- [ ] 7. Ebenen-Reihenfolge: Linien über Flächen und Straßen, aber unter Straßen- und Ortsnamen; Verhältnis zu den 3D-Gebäuden sauber (Linien nicht durch Gebäude "abgeschnitten" sichtbar).

## Stationen
- [ ] 8. Einheitliche Stationsmarker je Verkehrsmittel (z. B. weißer Punkt mit farbigem Rand), Größe zoomabhängig.
- [ ] 9. Verkehrsmittel-Icon am Stationsmarker (U-Bahn, Bus, Fähre), erst ab einer sinnvollen Zoomstufe.
- [ ] 10. Linien-Badges an Stationen (farbige Kreise mit Kürzel wie A, C, E); bei Bus erst bei starkem Zoom, damit es nicht überladen wirkt.
- [ ] 11. Umstiegsstationen hervorheben (größerer bzw. länglicher Marker, wenn mehrere Linien halten).
- [ ] 12. Stationsnamen zoomabhängig einblenden, ohne Überlappung mit anderen Namen und Badges (Kollisionserkennung).

## Abschluss
- [ ] 13. Gesamtprüfung: alle Szenen aus KRITERIEN.md neu fotografieren und gegen alle Kriterien bewerten; Abweichungen als neue Aufgaben anlegen.
