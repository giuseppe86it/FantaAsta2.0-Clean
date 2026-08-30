# FantaAsta2.0 — gestione locale dei dati

La versione A6.0.3 non contiene listoni, statistiche, probabili formazioni,
indisponibili o altri database di terzi. Non esegue scraping e non aggiorna
automaticamente dati sportivi.

## Archivio giocatori

L'archivio viene fornito direttamente dall'utente tramite CSV o JSON. Il file
è elaborato nel browser e salvato nel `localStorage` del dispositivo. Durante
l'importazione l'app conserva soltanto:

- identificativo locale generato dall'app;
- identificativo numerico del giocatore presente nel file dell'utente,
  conservato soltanto come chiave tecnica per collegare listone e rose;
- nome del giocatore;
- codice o nome del club;
- ruolo Mantra e macro-ruolo;
- ruolo Classic facoltativo;
- quotazione e FVM facoltativi;
- solo anno di nascita facoltativo, senza data completa;
- stato attivo/non attivo.

URL, immagini, testi editoriali, descrizioni e note della fonte vengono esclusi
dall'archivio normalizzato. L'identificativo numerico non viene interrogato in
rete e non viene trasmesso: resta nel browser insieme agli altri dati importati.

## Responsabilità dell'utente

Prima dell'importazione l'utente deve confermare di essere autorizzato a usare
il file e che la sua acquisizione rispetta licenza e condizioni della fonte.
L'app non attribuisce automaticamente diritti di riutilizzo sui dati importati.

## Rete e condivisione

Il listone non viene trasmesso a GitHub o ad altri server. L'esportazione crea
una copia locale scaricata direttamente dal browser.

Queste misure sono scelte tecniche prudenziali e non costituiscono un parere
legale professionale.
