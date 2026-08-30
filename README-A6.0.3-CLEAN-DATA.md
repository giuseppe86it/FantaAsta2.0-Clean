# FantaAsta2.0 A6.0.3 — Import automatico rose

La A6.0.3 corregge il collegamento tra il listone locale e il CSV esportato
da Leghe Fantacalcio.

## Flusso di importazione

1. L'app riconosce automaticamente numero e nomi delle squadre.
2. Collega i giocatori tramite l'identificativo numerico presente nei due file.
3. Chiede all'utente soltanto quale squadra gli appartiene.
4. Mostra un'anteprima con giocatori, spesa e crediti residui.
5. Con una sola conferma aggiorna lega, partecipanti, rose, prezzi,
   assegnazioni, budget, disponibilità del mercato e motori strategici.

Prima dell'applicazione viene creato uno snapshot recuperabile. Nessuna
modifica viene effettuata se i controlli falliscono.

Se il CSV delle rose contiene un giocatore non più presente nel listone
corrente, l'app richiede esclusivamente nome, club e ruolo Mantra. Il giocatore
viene conservato come fuori listone e non viene associato per somiglianza.

## Dati locali

L'identificativo numerico è conservato soltanto nel browser come chiave tecnica
di collegamento. Non viene usato per interrogare siti, non viene trasmesso e
non introduce aggiornamenti automatici o scraping.
