# FantaAsta 2.0 — A8.0.0 Gestione asta completa

FantaAsta 2.0 è uno strumento locale per sostituire gli appunti cartacei durante asta iniziale e asta di riparazione.

## Architettura dei dati

- Nessun database sportivo è incluso nell'app.
- Nessuno scraping, aggiornamento automatico o collegamento a fonti sportive esterne.
- Il Listone viene scelto e importato manualmente dall'utente.
- Listone, rose, acquisti, preferenze e note rimangono nel browser del dispositivo.
- L'utente deve importare soltanto file che può legittimamente utilizzare.

## Novità A8.0.0

- `Analizza listone` genera automaticamente anche il piano completo per gli undici slot.
- Ogni slot mantiene TARGET, tre alternative, profili VALUE, priorità, valore minimo e MAX strategico.
- Ogni candidato spiega il consiglio usando soltanto FVM, quotazione, ruoli, compatibilità e vincoli d'asta.
- Nella scheda giocatore si possono salvare localmente: preferito, priorità alta, da evitare e una nota personale.
- Un giocatore `da evitare` non viene proposto automaticamente, ma resta ricercabile manualmente.
- Le preferenze aggiornano Strategia, Asta Live e consigli di riparazione.
- Asta Live include `Annulla ultimo` e ricalcolo di budget e alternative.
- Dialoghi e popup si chiudono con X/pulsante, tocco sullo sfondo o comando Indietro.
- Backup locale versione 12 comprensivo delle preferenze personali.

## Aggiornamento GitHub Pages

1. Nell'app attuale esporta un backup.
2. Estrai il pacchetto A8.0.0.
3. Apri la cartella interna `A8.0.0-gestione-asta-completa`.
4. Carica **il contenuto della cartella**, non la cartella stessa, nella radice del repository GitHub.
5. Sostituisci i file omonimi e conferma il commit.
6. Attendi che il workflow GitHub Pages termini con esito verde.

## Controllo rapido su iPhone

1. Apri l'indirizzo dell'app in Safari e verifica `A8.0.0` nell'intestazione.
2. Se compare ancora una versione precedente, chiudi l'app dalla schermata multitasking e riaprila; se necessario elimina e ricrea l'icona Home.
3. Importa il Listone e configura il regolamento.
4. In Strategia premi `Analizza listone` e controlla che gli undici slot risultino salvati.
5. Apri uno slot, espandi `Perché`, quindi chiudilo con X, pulsante Chiudi, sfondo e Indietro.
6. Apri un giocatore, salva una preferenza e una nota, poi ricalcola la strategia.
7. In Asta Live registra un acquisto e prova `Annulla ultimo`.
8. Esporta un backup e verifica che il file venga creato.

Questo documento descrive il funzionamento tecnico dell'app e non costituisce consulenza legale.
