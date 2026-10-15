# TODO

Stato al 15 ottobre 2026. Branch: `d3-interaction` (cavijs) e `render-interpolation` (`../cavi`).

## Già fatto

- **cavijs:** pannello `<cavi-debug>` ed eventi di dominio, pulizia dei cavi orfani, mouse fantasma,
  fisica a passo fisso, un ciclo di frame per mondo, jack che seguono il layout, jack rimosso che rilascia i
  plug, interpolazione tra i passi fisici, cavo tenuto durante il trascinamento, sospensione dei cavi
  fermi, handle dei nodi stabili, `Cavi.destroy()` e smontaggio dei mondi rimossi, cavi creati trascinando
  che sopravvivono a un reinserimento, colori di default fissati alla creazione, plug che si aprono su un
  jack già aperto, tipo vuoto come jolly, `World` che rifiuta modifiche fatte direttamente sul WASM,
  `Wire.delete()`, mondi multipli isolati (anche negli shadow root), suite end-to-end Playwright,
  `SvgRenderer` che scrive nel DOM solo ciò che cambia (da 420–620 modifiche al secondo a zero con i cavi
  fermi), `World.getWiresView()` senza copia per i renderer, attributi live di `<cavi-wire>` e
  `<cavi-world>` (documentati in `03-api`), tastiera ed Escape, codice duplicato e morto rimosso, modello
  della trasformazione di coordinate documentato, log del debug che distingue i plug, tastiera come
  controller separato (`KeyboardInteractionController`, più controller per `<cavi-interaction>`) che sposta
  anche i plug già collegati, con Tab che si ferma solo sui jack compatibili, un cavo mai con i due capi
  nello stesso jack, `<cavi-controls>` spostato negli esempi, documentazione allineata al codice, file
  inutili rimossi, `tsconfig` più severo, test su path SVG, `sizeCanvasToHost`, errore di caricamento del
  WASM (`cavierror`) e touch, plug già collegati spostabili col touch (pressione lunga sul jack che apre il
  ventaglio), finti oggetti dei test controllati sulle classi vere, workflow di CI.
- **`cavi`:** `step()` separato da `build_render_data(alpha)`, parametri del passo configurabili, cavi che
  partono dritti, cavo tenuto (`pointer_radius`), sospensione, lancio al rilascio, distanza tra i nodi
  separata dal raggio, `intersect` vero, README, panic leggibili in console (`set_panic_hook` usato).

## Ordine consigliato

1. Le due verifiche a occhio qui sotto, poi il rilascio di `cavi`: sblocca il merge su `main`.
2. Far girare la CI una prima volta (vedi "Manutenzione").
3. "Packaging", solo se vuoi pubblicare cavijs su npm.
4. Il resto quando capita.

## Da verificare a mano

Quasi tutto è ora coperto dai test end-to-end (`pnpm test:e2e`): 60 passi al secondo e un disegno nuovo a
ogni frame su un display a 120 Hz emulato, cavo tenuto non stirato (23 contro 34 con riposo 20), lancio pari
all'ultimo movimento, cavi addormentati nella forma finale (scarto massimo 0,016 px), mondo rimosso e
reinserito. Restano i giudizi a occhio:

- [ ] Su uno schermo a 120 Hz vero il movimento sembra fluido? (I numeri tornano, la percezione no.) Se i
      cavi sembrano più lenti di prima, era lo step rate: provare `<cavi-world step-rate="120">`.
- [ ] La forza del lancio di un cavo rilasciato nel vuoto, e quanto `pointer_radius` (20) sposta gli altri
      cavi durante un trascinamento, ti sembrano giusti?

## Rilascio di `cavi` (bloccante per `main`)

- [ ] Finire le modifiche sul branch `render-interpolation` di `../cavi`, portare la versione a 0.2.0 in
      `Cargo.toml` (oggi dice 0.1.1, ma su npm c'è già 0.1.2), `wasm-pack build --target web` e
      `wasm-pack publish`.
- [ ] In cavijs rimettere la dipendenza `cavi` sulla versione pubblicata al posto di `link:../cavi/pkg`
      (`package.json`, `pnpm-lock.yaml`). Valutare se fissarla a una versione esatta o renderla peer
      dependency, dato che cavijs dipende dal layout di memoria del buffer. L'aggiunta di `../../cavi` a
      `server.fs.allow` in `vite.config.ts` può restare: serve solo in sviluppo.
- [ ] Fare il merge di `render-interpolation` su `main` in `cavi`, e di `d3-interaction` su `main` in
      cavijs.

## Correttezza

Tutto fatto.

## Più mondi nella stessa pagina

Tutto fatto.

## Prestazioni

Tutto fatto.

## Packaging e distribuzione

- [ ] La libreria non è pubblicabile: `private: true` in `package.json`, nessuno script
      `prepublishOnly`/`prepare` che costruisca `dist-lib`.
- [ ] Inizializzazione del WASM non configurabile: non si può passare l'URL del `.wasm` (CDN, CSP,
      bundler diversi da Vite). Documentare il setup per i bundler. (Un caricamento fallito ora dà un
      errore e l'evento `cavierror`, e il `<cavi-world>` successivo riprova.)
- [ ] Importare la libreria registra tutti i custom element, compreso `<cavi-debug>`.
      Proteggere ogni `customElements.define` con `customElements.get`, aggiungere `sideEffects` in
      `package.json` e separare i punti d'ingresso (`cavijs`, `cavijs/elements`, `cavijs/debug`).

## API e usabilità

- [ ] Il controller d3 dell'esempio (`examples/d3-interaction.ts`) non ha ancora Escape. La tastiera ce l'ha
      già: l'esempio gli affianca `KeyboardInteractionController`.

## Manutenzione

- [ ] La CI (`.github/workflows/ci.yml`: lint, formato, test unitari, build, `build:lib`, end-to-end, su
      push a `main` e sulle PR) è scritta ma non ha ancora girato. Finché `package.json` punta a
      `link:../cavi/pkg` compila anche `teo666/cavi`: impostare la variabile di repository `CAVI_REF`
      (oggi `render-interpolation`) e, se `cavi` è privato, il segreto `CAVI_TOKEN`. Il workflow delle
      Pages (`deploy-pages.yml`) invece fallisce finché la dipendenza non torna su npm.
- [ ] Alcuni test unitari leggono o scrivono membri privati (`_spread`, `_applySpreadPositions`, ...):
      funzionano, ma si rompono a ogni rinomina interna.
