# FantaAsta2.0 A7 — dati e copyright

FantaAsta2.0 è uno strumento locale di gestione dell'asta. Non include e non
scarica database sportivi, statistiche, probabili formazioni, infortuni,
squalifiche, immagini o testi editoriali di terzi.

## Unica fonte sportiva

Il Listone viene scelto e importato manualmente dall'utente. L'app usa soltanto
i campi necessari alla gestione dell'asta: identificativo tecnico, nome, club,
ruoli, quotazione, FVM, anno di nascita facoltativo e stato nel Listone.

Il file viene elaborato nel browser e non viene inviato a GitHub o ad altri
server. Prima dell'importazione l'utente deve confermare di avere il diritto di
usarlo e di rispettare le condizioni della fonte.

## Calcoli interni

Strategia, Asta Live e Asta di Riparazione usano esclusivamente:

- Listone importato dall'utente;
- regolamento e numero di partecipanti inseriti nell'app;
- rose, prezzi, crediti e operazioni registrati dall'utente.

L'app non formula valutazioni su forma, titolarità, rendimento, infortuni o
disciplina. Queste informazioni, se conosciute dall'utente, restano una sua
valutazione esterna prima della conferma di un'operazione.

## Rete

Non sono presenti scraping, API sportive o aggiornamenti automatici. Il service
worker scarica soltanto i file tecnici dell'app dallo stesso sito per consentire
l'uso offline.

Il PIN è un blocco visivo e non cifra il contenuto del browser. I backup non
sono cifrati. Questa informativa descrive scelte tecniche prudenziali e non è
un parere legale professionale.
