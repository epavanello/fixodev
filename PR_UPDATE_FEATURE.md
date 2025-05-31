# PR Update Feature

Questa nuova funzionalità permette al bot di gestire aggiornamenti alle Pull Request esistenti quando viene menzionato nei commenti di una PR.

## Come funziona

### Flusso esistente (Issue → PR)

1. Un utente menziona il bot in una issue o in un commento di una issue
2. Il bot analizza la issue, crea un branch e implementa le modifiche
3. Il bot crea una nuova Pull Request con le modifiche

### Nuovo flusso (PR Update)

1. Un utente menziona il bot in un commento di una PR esistente con istruzioni di modifica
2. Il bot analizza il contesto della PR (descrizione, commenti, diff corrente, issue linkata)
3. Il bot fa checkout del branch della PR esistente
4. Il bot implementa le modifiche richieste basandosi sul feedback
5. Il bot aggiorna la PR esistente pushando le modifiche sul branch esistente

## Architettura

### Nuovi file aggiunti

#### `apps/server/prompts/pr-update.md`

- Template Handlebars per il contesto delle PR
- Supporta placeholder per tutti i dati necessari (titolo, commenti, diff, issue linkata)
- Genera automaticamente i tipi TypeScript tramite lo script `generate-prompts.ts`

#### `apps/server/src/types/jobs.ts`

- Aggiunto nuovo tipo `PrUpdateJob` per gestire i job di aggiornamento PR
- Aggiunta guard function `isPrUpdateJob`

#### `apps/server/src/types/guards.ts`

- Aggiunta funzione `isPullRequestComment` per identificare commenti su PR

#### `apps/server/src/github/pr.ts`

- `getPullRequest`: Recupera i dati di una PR
- `getPullRequestComments`: Recupera tutti i commenti di una PR
- `getPullRequestDiff`: Recupera il diff della PR
- `extractLinkedIssueNumber`: Estrae il numero della issue linkata dalla PR
- `buildPullRequestContext`: **Ora usa il template Handlebars** invece di testo hardcodato

#### `apps/server/src/git/operations.ts`

- `checkoutBranch`: Fa checkout di un branch esistente (locale o remoto)

#### `apps/server/src/jobs/prUpdateHandler.ts`

- Handler principale per i job di tipo `pr_update`
- **Refactorizzato per usare le funzioni condivise** da `shared.ts`
- Gestisce l'intero flusso di aggiornamento di una PR esistente

#### `apps/server/src/jobs/shared.ts`

- Funzioni condivise tra `issueToPrHandler` e `prUpdateHandler`
- **Elimina la duplicazione di codice** per:
  - Autenticazione (GitHub App vs PAT)
  - Rate limiting (check e gestione)
  - Gestione commenti (iniziali, finali, errore, cleanup)

### File modificati

#### `apps/server/src/routes/webhook.ts`

- Esteso per riconoscere commenti su PR e creare `PrUpdateJob`
- Mantiene compatibilità con il flusso esistente per le issue

#### `apps/server/src/queue/worker.ts`

- Aggiunto supporto per processare `PrUpdateJob`

#### `apps/server/src/queue/index.ts`

- Aggiunto supporto per serializzare/deserializzare `PrUpdateJob`

#### `apps/server/src/jobs/issueToPrHandler.ts`

- **Refactorizzato per usare le funzioni condivise** da `shared.ts`
- Eliminato codice duplicato per autenticazione, rate limiting e commenti

#### `apps/server/src/llm/prompts/prompts.ts`

- **Rigenerato automaticamente** con il nuovo template `pr-update.md`
- Include i tipi TypeScript `PrUpdateArgs` e la funzione `generatePrUpdatePrompt`

## Sistema di Template

### Template Handlebars

Il progetto ora usa un sistema unificato di template Handlebars:

- **Template**: `apps/server/prompts/pr-update.md`
- **Generazione automatica**: Lo script `scripts/generate-prompts.ts` genera automaticamente:
  - Tipi TypeScript (`PrUpdateArgs`)
  - Funzioni di generazione (`generatePrUpdatePrompt`)
- **Vantaggi**:
  - Type safety per i placeholder
  - Consistenza nel formato
  - Facile manutenzione

### Placeholder supportati

```handlebars
{{owner}}
{{repo}}
{{prNumber}}
{{title}}
{{author}}
{{state}}
{{createdAt}}
{{updatedAt}}
{{labels}}
{{headBranch}}
{{baseBranch}}
{{body}}
{{instructionComment}}
{{diff}}
{{linkedIssueContext}}
{{#each comments}}{{user}} {{createdAt}} {{body}}{{/each}}
```

## Refactoring delle funzioni condivise

### Funzioni estratte in `shared.ts`

1. **`handleAuthentication`**: Gestisce GitHub App vs PAT
2. **`checkRateLimits`**: Verifica i limiti per utente e repo
3. **`handleRateLimitExceeded`**: Gestisce il messaggio di rate limit
4. **`postInitialComment`**: Posta il commento iniziale
5. **`cleanupInitialComment`**: Rimuove il commento iniziale
6. **`postFinalComment`**: Posta il commento finale
7. **`postErrorComment`**: Posta il messaggio di errore

### Benefici del refactoring

- **Eliminazione duplicazione**: ~200 righe di codice duplicate rimosse
- **Manutenibilità**: Modifiche in un solo posto
- **Type safety**: Interfacce comuni per risultati
- **Testabilità**: Funzioni isolate più facili da testare

## Contesto fornito all'agente AI

Quando viene processato un `PrUpdateJob`, l'agente riceve tramite template:

1. **Informazioni della PR**:

   - Titolo, descrizione, autore, stato
   - Branch head e base
   - Labels e assignees

2. **Istruzione corrente**: Il commento che ha triggerato l'aggiornamento

3. **Conversazione della PR**: Tutti i commenti precedenti

4. **Diff corrente**: Il diff completo della PR nello stato attuale

5. **Contesto della issue linkata** (se presente):
   - Titolo, descrizione e commenti della issue originale
   - Estratto automaticamente dal body/title della PR

## Esempi di utilizzo

### Scenario 1: Feedback su implementazione

```
# In una PR esistente
@fixodev puoi aggiungere la validazione degli input mancante?
```

### Scenario 2: Richiesta di refactoring

```
# In una PR esistente
@fixodev il codice nella funzione `processData` è troppo complesso,
puoi spezzarlo in funzioni più piccole?
```

### Scenario 3: Correzione di bug

```
# In una PR esistente
@fixodev c'è un bug nel handling degli errori alla riga 45,
non gestisce il caso null
```

## Vantaggi

1. **Iterazione rapida**: Non serve creare nuove PR per ogni modifica
2. **Contesto preservato**: L'agente ha accesso a tutta la conversazione e al diff
3. **Workflow naturale**: Segue il normale flusso di review delle PR
4. **Backward compatibility**: Non rompe il flusso esistente per le issue
5. **Template system**: Type safety e consistenza nei prompt
6. **Codice DRY**: Eliminata duplicazione tra i due handler

## Limitazioni

1. Il bot può aggiornare solo PR che ha creato o su cui ha accesso di scrittura
2. Richiede che il branch della PR sia accessibile (non da fork esterni senza permessi)
3. Le modifiche vengono sempre committate, anche se minori

## Rate Limiting

Il sistema di rate limiting esistente si applica anche ai `PrUpdateJob`, usando gli stessi limiti per utente e repository.

## Prossimi passi

1. **Test completi**: Test end-to-end del nuovo flusso
2. **Monitoring**: Metriche specifiche per PR updates
3. **Ottimizzazioni**: Miglioramenti per PR molto grandi
4. **Documentazione utente**: Guide per gli utenti finali
