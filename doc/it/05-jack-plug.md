# Cavijs — Componenti Jack & Plug

`Jack` (`<cavi-jack>`) e `Plug` (`<cavi-plug>`) modellano punti di connessione e terminali di cavo — ad esempio per diagrammi dove i cavi ("wires", vedi `<cavi-wire>`) si collegano a prese fisse, con una regola di compatibilità basata su un singolo tipo stringa (es. `"audio"`, `"midi"`, `"scsi"`).

> Questa funzionalità è più recente rispetto all'API principale `Cavi`/`World`/`Wire` ed è in evoluzione — considerare i dettagli qui come un'istantanea di `src/jack.ts` / `src/plug.ts` / `src/wirewc.ts` / `src/interaction.ts` / `src/interactionwc.ts` così come attualmente implementati.

## Concetto

- **`Plug`** modella il nodo terminale di un cavo (l'estremità trascinabile di un `<cavi-wire>`). Per ora un plug rappresenta sempre uno dei **due nodi terminali** del cavo (indice `0` o `nodeCount - 1`); i nodi intermedi non sono ancora supportati.
- **`Jack`** modella una presa fissa a cui un plug può collegarsi, con un proprio `type` stringa.
- **`<cavi-wire>`** (il "Cable") possiede il proprio `type`, che viene propagato automaticamente a tutti i suoi `<cavi-plug>` figli — un plug non ha un tipo indipendente impostabile via markup.
- Una connessione plug→jack è permessa se e solo se `plug.type === jack.type` (uguaglianza semplice; un jack senza `type` configurato non accetta nessuna connessione).
- Trascinare un `Plug` sopra un `Jack` compatibile lo aggancia in posizione (effetto "calamita"); durante l'avvicinamento, sia il jack candidato sia il plug ricevono una classe CSS configurabile per l'anteprima visiva (es. blur/glow), non solo al momento del rilascio. Rilasciare altrove lascia il nodo del cavo sottostante non fissato di default: il cavo rimane penzoloni liberamente e può essere riagganciato successivamente — a meno che il plug non abbia l'attributo `freeze-on-drop`, nel qual caso resta fissato esattamente dove è stato rilasciato, sempre riafferrabile con un click/tap normale invece di dover inseguire un bersaglio in movimento.
- Entrambi sono Web Component che accettano contenuto template opzionale fornito dall'utente (con struttura/classi attese).
- Ordine Z: `Plug` deve sempre essere renderizzato sopra `Jack`, che a sua volta è sopra il canvas — così il plug non è mai occluso durante il trascinamento.

## Architettura: dominio puro + controller di interazione esterno

`Jack` e `Plug` sono elementi **di dominio/dato puri**: espongono API pubbliche per leggerne/modificarne stato e posizione e per pilotare i gesti (creazione cavo, trascinamento di un plug esistente), ma **non installano alcun listener di eventi pointer/tastiera proprio** e non decidono da soli *come* un utente ci interagisce. Quella responsabilità è isolata in un `IInteractionController` esterno, sostituibile — vedi [la sezione dedicata più sotto](#interazione-standardinteractioncontroller-e-cavi-interaction).

Questo significa che un `<cavi-jack>`/`<cavi-plug>` inseriti in pagina senza alcun controller di interazione collegato **non reagiscono affatto** al mouse/touch — restano perfettamente manipolabili via codice (le API descritte in questo documento), ma "mordono" solo quando qualcosa collega un controller. `<cavi-world>` lo fa automaticamente (vedi sotto), quindi nell'uso comune questo dettaglio è invisibile.

## `Jack` (`src/jack.ts`)

Un custom element (`cavi-jack`) con Shadow DOM.

**Attributi osservati**
| Attributo | Effetto |
|---|---|
| `color` | Colore di riempimento del punto visivo del jack |
| `x`, `y` | Posizione assoluta (`style.left`/`style.top`, traslata -50%/-50% per centrare sulla coordinata) |
| `type` | Stringa di tipo (es. `"audio"`) — un plug può agganciarsi solo se il proprio `type` è identico |
| `max-plugs` | Numero massimo di plug agganciabili contemporaneamente (default illimitato) |
| `magnet-class` | Nome della classe CSS applicata all'host quando un plug compatibile è in prossimità durante il trascinamento (default `cavi-magnet-target`) |
| `full-class` | Nome della classe CSS applicata all'host quando il jack ha raggiunto `max-plugs` **e** il cursore è vicino **e** è in corso un drag che potrebbe tentare di collegarcisi (default `cavi-jack-full`) — vedi sotto |
| `at-capacity-class` | Nome della classe CSS applicata all'host in modo incondizionato per tutto il tempo in cui il jack ha raggiunto `max-plugs` (default `cavi-jack-at-capacity`) — a differenza di `full-class`, non dipende da hover o stato di drag; vedi sotto |
| `cable-tension`, `cable-size`, `cable-color` | Valori opzionali di tensione/raggio/colore applicati al cavo creato tramite `createCable()` da questo jack (vedi sotto); se omessi, il cavo usa i default fissi di `<cavi-wire>` |
| `cable-node-spawn` | `"interpolate"` (default) o `"stack"` — dove compaiono i nodi via via inseriti mentre il cavo si allunga durante `updateCableSession()` (vedi sotto) |

**API di manipolazione**
| Metodo | Descrizione |
|---|---|
| `canAccept(type: string) -> boolean` | Ritorna true se `type` è uguale al `type` del jack (e il jack ne ha uno configurato) |
| `canAcceptMore() -> boolean` | Ritorna true se il jack non ha raggiunto `max-plugs` |
| `attach(plug: Plug)` / `detach(plug: Plug)` | Registra/rimuove un plug collegato (aggiorna `plugCount`) |
| `plugCount` | Numero di plug attualmente collegati |
| `getCenter() -> { x, y }` | Punto centrale in coordinate viewport (`getBoundingClientRect`) |
| `type` (getter) | Il `type` corrente del jack |
| `setMagnetActive(active: boolean)` | Attiva/disattiva la classe `magnet-class` sull'host, usata per l'anteprima calamita durante il drag |
| `Jack.registry` (statico) | Insieme di sola lettura di tutti i `<cavi-jack>` attualmente connessi al documento |
| `Jack.findSnapTarget(plug, type, exclude?) -> Jack \| null` (statico) | Trova lo jack compatibile più vicino entro la soglia di aggancio (`20px`), opzionalmente escludendone uno |

**API per pilotare la creazione di un nuovo cavo** (usata da `StandardInteractionController`, ma richiamabile da qualunque controller custom)
| Metodo | Descrizione |
|---|---|
| `createCable(clientX, clientY) -> CableSession \| null` | Crea un `<cavi-wire>` con due `<cavi-plug>` (uno agganciato a questo jack, l'altro libero alla posizione data) e ritorna una `CableSession` che descrive il gesto in corso. Ritorna `null` se `Cavi` non è ancora pronto o se questo jack non ha capacità residua (`canAcceptMore()`) — il dominio applica da sé questo vincolo |
| `growCable(wire, desired) -> Node` | Fa crescere `wire` fino a `desired` nodi, inserendo solo quelli mancanti (vedi sotto) |
| `Jack.updateCableSession(session, clientX, clientY)` (statico) | Aggiorna una sessione in corso: sposta il terminale libero, lo fa eventualmente crescere, aggiorna l'anteprima calamita |
| `Jack.finishCableSession(session)` (statico) | Conclude la sessione agganciando il terminale libero al jack compatibile più vicino in prossimità, se presente, altrimenti lasciandolo pendente |
| `Jack.cancelCableSession(session)` (statico) | Annulla la sessione: il terminale libero resta pendente (mai agganciato) |
| `Jack.setPointerHoverPosition(x, y)` (statico) | Alimenta l'ultima posizione nota del puntatore, che pilota sia l'anteprima "jack pieno" sia il meccanismo di hover-spread (vedi sotto) — normalmente chiamato dal controller di interazione ad ogni `pointermove`, non da codice applicativo |
| `Jack.setDragActive(active)` (statico) | Segnala che un drag che potrebbe tentare di collegarsi a un jack è iniziato/terminato (vedi sotto); tiene anche il meccanismo di hover-spread fuori dai piedi mentre un drag è in corso |
| `isSpread() -> boolean` | Se i plug agganciati a questo jack sono attualmente aperti a ventaglio dal meccanismo di hover-spread (vedi sotto) |

Una `CableSession` (`{ wireEl, wire, jack, originPlug, followPlug, followNode, magnetJack }`) è un semplice oggetto dati, non posseduto da alcuna istanza `Jack` — così lo stato del gesto può vivere interamente in chi lo pilota (di norma il controller di interazione) invece che dentro il dominio.

Di default renderizza un piccolo cerchio scuro (`.inner`); se l'elemento ha contenuto figlio, renderizza quello al suo posto (tramite `<slot>`), permettendo di personalizzare l'aspetto mantenendo la stessa semantica di drop-target.

L'host ha una dimensione esplicita `24×24px`. L'hit-testing per l'aggancio di un `Plug` **esistente** su un jack è interamente basato sulla distanza (`Jack.findSnapTarget()` tramite `Jack.registry`), non su eventi nativi del jack.

## Creare un cavo trascinando da un Jack — `createCable`/`updateCableSession`/`finishCableSession`

Oltre ad essere un drop target, `Jack` espone un'API per avviare, far avanzare e concludere la creazione di un nuovo cavo — nel comportamento standard (`StandardInteractionController`): ogni gesto è un semplice click sinistro (o un tap su touch) — non esiste alcun ramo per click destro o tasti modificatori. Un click sinistro su un jack vuoto/esposto con capacità residua crea immediatamente un nuovo `<cavi-wire>` — un `<cavi-plug>` viene subito agganciato a quel jack, l'altro segue il cursore. Vedi [Interazione](#interazione-standardinteractioncontroller-e-cavi-interaction) più sotto per come viene disambiguato un click su un jack che ha già dei plug agganciati, tramite il meccanismo di hover-spread.

- **`createCable(clientX, clientY)`**: crea un `<cavi-wire type="{jack.type}" length="4">` con due `<cavi-plug>` figli (`node="0"` / `node="3"`), inserito come sibling del jack (così condivide lo stesso `offsetParent`/spazio di coordinate già usato da Plug). Il nodo `0` viene subito posizionato al centro del jack, fissato e agganciato (`plugged`); il nodo `3` viene posizionato alla posizione data. Tensione (`tension`), raggio (`size`) e colore (`color`) del nuovo `<cavi-wire>` vengono copiati dagli attributi `cable-tension`/`cable-size`/`cable-color` del jack di origine, se presenti; per ogni attributo omesso resta il default fisso a cui `<cavi-wire>` ricade normalmente (tipo di render escluso: sempre bezier di default, salvo `renderType="segments"` sul cavo — non c'è un equivalente `cable-render-type`). Ritorna `null` (no-op) se il jack non ha capacità residua o `Cavi` non è ancora pronto.
- **Crescita durante `updateCableSession`**: la posizione del nodo libero segue la posizione data e il numero di nodi cresce con la distanza dal jack di origine — `4 + floor(distanza / 30)`, con un tetto di `60`. **Il cavo cresce soltanto, non si accorcia mai** quando la posizione si riavvicina — come tirare un cavo fuori dallo schermo: una volta uscito, resta fuori fino alla fine della sessione. Un passo di crescita inserisce solo i nodi mancanti uno alla volta con `Wire.addNodeAt()` (vedi [`Wire` nel riferimento API](./03-api.md#wire)) — a differenza di un approccio basato su `Wire.setNodeCount()`, che ricostruirebbe l'intero cavo, questo lascia intatto lo stato fisico (posizione, velocità) di ogni nodo già esistente e assestato dalla simulazione. Ogni nodo appena inserito viene posizionato in base a `cable-node-spawn`: `"interpolate"` (default) lo piazza subito in linea retta tra l'ultimo nodo assestato e la posizione data; `"stack"` lo fa nascere impilato sull'ultimo nodo assestato, lasciando alla fisica di vincolo il compito di separarlo nei frame successivi. In entrambi i casi il `Plug` libero viene ri-agganciato al nuovo ultimo nodo (e il suo attributo `node="N"` aggiornato di conseguenza — vedi la sezione su `<cavi-wire>` sotto), dato che la crescita sposta l'indice del terminale. Ogni chiamata a `updateCableSession` chiama anche `node.setMousePosition(x, y)` sul nodo libero, per mantenere alimentata l'interazione fisica "mouse del mondo" (repulsione delle altre reti) indipendentemente da eventuali `preventDefault()` che chi pilota il gesto applichi ai `mousemove` nativi.
- **Anteprima calamita**: stessa identica meccanica del drag di `Plug` — stessa soglia di aggancio di `20`px, stesso toggling continuo dell'evidenziazione (`setMagnetActive`) sia sul jack candidato sia sul plug libero mentre è in prossimità, tramite `Jack.findSnapTarget()` (escludendo il jack di origine stesso, così un cavo non può riagganciarsi alla propria sorgente).
- **`finishCableSession`**: se un jack compatibile è in prossimità, il plug libero si aggancia esattamente come un normale rilascio di `Plug` (`fixed = true`, `attach()`, `plugged`). Altrimenti ricade sul `cableDropBehavior` configurato in `Cavi` (vedi [Interazione](#interazione-standardinteractioncontroller-e-cavi-interaction) più sotto) — `'detach'` (default), `'dangle'`, oppure `'cancel'`. `cancelCableSession` lascia sempre il capo libero pendente (`node.fixed = false`), indipendentemente da `cableDropBehavior`, senza mai tentare uno snap.
- **Un jack pieno mostra un cursore "vietato"**: se la posizione nota tramite `Jack.setPointerHoverPosition()` si trova entro `20`px dal centro di un jack che ha raggiunto `max-plugs` (`!canAcceptMore()`) **mentre è in corso un drag segnalato con `Jack.setDragActive(true)`**, l'host riceve `cursor: not-allowed` (stile inline, vince sempre sulla regola `:host { cursor: crosshair }`) e la classe `full-class`. Il rilevamento hover è basato sulla distanza dall'ultima posizione nota (uno stato statico condiviso da tutti i jack, alimentato dall'esterno), **non** su `pointerenter`/`pointerleave` nativi sul jack: un jack con almeno un plug agganciato ha quel `<cavi-plug>` posizionato esattamente al suo centro con `z-index` più alto, quindi lo occlude e impedirebbe agli eventi di hover nativi di raggiungerlo mai.

  Lo stato si aggiorna anche senza una nuova posizione quando il jack si riempie/libera (`attach`/`detach`) o quando il drag inizia/termina, mentre il jack è già sotto osservazione.
- **Un jack pieno ha sempre `at-capacity-class`**: a differenza di `full-class`, questa classe è incondizionata — riflette semplicemente `!canAcceptMore()`, indipendentemente da hover o stato di drag, quindi resta utilizzabile per uno stile "pieno" persistente (es. un bordo o un'icona) visibile anche senza interagire col jack.

## Hover-spread: scegliere il centro di un jack o uno dei suoi plug esistenti

Un jack con uno o più plug già agganciati li ha posizionati esattamente al proprio centro, occludendolo — cliccarci sopra è ambiguo: spostare un cavo esistente, o avviarne uno nuovo dal jack sottostante? `Jack` risolve l'ambiguità da sé, tramite lo stesso hover sintetico basato sulla distanza già usato per l'anteprima "jack pieno" sopra (alimentato da `Jack.setPointerHoverPosition()`), quindi funziona indipendentemente da *come* un controller decide di far scattare un click:

- **In hover** (puntatore entro la metà della dimensione renderizzata del jack dal suo centro, oppure entro il raggio di hover di uno qualsiasi dei suoi plug già aperti a ventaglio — così muoversi tra il jack e un plug già aperto conta come restare dentro l'area), ogni `<cavi-plug>` agganciato si allontana dal centro del jack di `Cavi.getPlugSpreadRadiusMultiplier()` (default `1.8`) × metà della dimensione renderizzata del jack — spostando il nodo fisico sottostante (non solo un offset CSS), così il cavo si vede visibilmente piegarsi verso la posizione aperta. La direzione è controllata da `Cavi.getPlugSpreadMode()`:
  - `'towardOther'` (default): ogni plug si apre in direzione del terminale opposto del proprio cavo (`Plug.getOtherEndCenter()`), con un passaggio di separazione angolare a coppie così cavi quasi paralleli non finiscono mai per sovrapporsi visivamente una volta aperti.
  - `'radial'`: i plug vengono distribuiti uniformemente intorno al jack, ignorando la direzione dei cavi.
- Una volta aperti, `Jack.isSpread()` (e `Plug.isSpread()`, che si limita a delegare a questo) ritorna `true` — `StandardInteractionController` lo usa per instradare un click su quel particolare plug verso lo spostamento del cavo (`beginDrag`), invece di inoltrarlo al jack come click per un nuovo cavo.
- **Uscendo dall'area espansa**, un jack attende `Cavi.getPlugSpreadRecompactDelayMs()` (default `500`) prima di far tornare ogni plug al proprio centro (`Plug.snapToJack()`) — il timeout si azzera, invece di continuare il conto alla rovescia, se il puntatore rientra nell'area prima che scatti.
- Il meccanismo viene saltato del tutto per un jack senza plug, e mentre è in corso un drag qualsiasi (`Jack.setDragActive(true)`), così non entra mai in conflitto con un gesto attivo.

## `Plug` (`src/plug.ts`)

Un custom element (`cavi-plug`) con Shadow DOM.

**Attributi osservati**
| Attributo | Effetto |
|---|---|
| `plugged` | Attiva/disattiva lo stile visivo "connesso" (impostato/rimosso all'aggancio/sgancio) |
| `magnet-class` | Nome della classe CSS applicata all'host quando il plug è in prossimità di un jack compatibile durante il trascinamento (default `cavi-magnet-active`) |
| `freeze-on-drop` | Attributo booleano basato su presenza (come `plugged`). Se presente, `endDrag()`/`cancelDrag()` lontano da ogni jack compatibile lasciano il nodo fisico **fissato** (`node.fixed = true`) invece che libero — il plug resta fermo sul punto di rilascio anziché oscillare sotto gravità/tensione, restando sempre riafferrabile con un click/tap. Default assente (comportamento invariato: nodo libero) |

`type` **non** è un attributo del plug: viene ricevuto esclusivamente tramite `setType(type)`, chiamato dal `<cavi-wire>` genitore in base al proprio attributo `type`.

**API**
| Metodo | Descrizione |
|---|---|
| `setNode(node: Node)` | Collega visivamente il plug a un nodo fisico del cavo |
| `setType(type: string)` | Imposta il tipo di connessione del plug (propagato dal Cable, non impostabile da markup) |
| `attach(jack: Jack)` / `detach()` | Collega/scollega il plug da un jack, passando dallo stesso registro `attach`/`detach` del jack (usato sia dal drag sia dal binding dichiarativo di `<cavi-wire>`) |
| `setMagnetActive(active: boolean)` | Attiva/disattiva la classe `magnet-class` sull'host |
| `jack` (getter) | Il `Jack` a cui questo plug è attualmente agganciato, o `null` |
| `beginDrag()` | Avvia un trascinamento: sgancia dall'eventuale jack corrente, fissa il nodo (`node.fixed = true`), alza lo `z-index` |
| `updateDragPosition(clientX, clientY)` | Sposta il plug (e il suo nodo) alla posizione data e ricalcola l'anteprima calamita rispetto allo jack compatibile più vicino in prossimità |
| `endDrag()` | Conclude il trascinamento agganciandosi al jack compatibile più vicino in prossimità se presente, altrimenti applicando la semantica di `freeze-on-drop` |
| `cancelDrag()` | Conclude un trascinamento interrotto: non aggancia mai, anche se un jack compatibile è in prossimità — stessa semantica di `freeze-on-drop` di `endDrag()` per il resto |
| `isSpread() -> boolean` | Se questo plug è attualmente aperto a ventaglio dal centro del proprio jack tramite il meccanismo di hover-spread — delega a `this.jack?.isSpread()` (vedi [Hover-spread](#hover-spread-scegliere-il-centro-di-un-jack-o-uno-dei-suoi-plug-esistenti) sopra) |
| `getOtherEndCenter() -> { x, y } \| null` | Il centro a schermo del terminale *opposto* del cavo di questo plug (il `<cavi-plug>` sibling nello stesso `<cavi-wire>`), o `null` se non trovabile — usato dalla geometria di hover-spread di `Jack` |
| `setSpreadPosition(localX, localY)` | Sposta il nodo di questo plug a una posizione locale al pannello senza avviare/influenzare un trascinamento — usato dal meccanismo di hover-spread di `Jack`; no-op durante un trascinamento |

**Comportamento**
1. `setNode(node: Node)` collega visivamente il plug a un'istanza `Node` (proveniente da un `Wire`); `update()`/`updatePosition()` lo mantiene sincronizzato con `x`/`y` del nodo a meno che non sia in corso un trascinamento (`beginDrag()` chiamato senza un `endDrag()`/`cancelDrag()` successivo).
2. `updateDragPosition(clientX, clientY)`, ripetuta durante il trascinamento: calcola la posizione relativa a `offsetParent`, chiama `node.setPosition(x, y)` **e** `node.setMousePosition(x, y)` (quest'ultimo inoltra a `WasmWorld.set_mouse`, mantenendo la repulsione fisica sincronizzata col plug trascinato), aggiorna la propria posizione a schermo, e ricalcola il jack calamita candidato (`Jack.findSnapTarget()`), attivando/disattivando le classi `magnet-class` su jack e plug di conseguenza.
3. `endDrag()`: ricalcola il jack più vicino compatibile (tipo uguale e capacità disponibile) entro `20`px — non si fida dell'ultimo calcolo fatto da `updateDragPosition`, dato che un rilascio può avvenire senza alcun movimento intermedio; se trovato, aggancia il nodo al centro del jack, chiama `attach(jack)` e imposta `plugged`; altrimenti chiama `detach()` e imposta `node.fixed` in base a `freeze-on-drop`, rimuovendo `plugged`.
4. `cancelDrag()`: stesso comportamento di `endDrag()` per l'esito "a vuoto", senza però mai tentare alcuno snap.

**Note implementative**
- La ricerca dei jack avviene tramite `Jack.findSnapTarget()` (che internamente scorre il registro statico `Jack.registry`), non tramite query DOM.
- `z-index`: plug usa `20`, jack usa `10`, coerentemente col requisito "jack sotto plug" della spec — rilevante per l'occlusione descritta sotto.
- `touch-action: none` è impostato nello shadow DOM del plug per evitare che il browser intercetti lo scroll durante il trascinamento touch, quando pilotato da un controller basato su Pointer Events.

## Interazione: `StandardInteractionController` e `<cavi-interaction>`

Jack/Plug, come visto sopra, non ascoltano da soli alcun evento — l'interazione reale (mouse, touch, penna, tastiera) è responsabilità di un `IInteractionController` esterno (`src/types.ts`):

```typescript
interface IInteractionController {
    attach: (cavi: Cavi) => void;
    detach: () => void;
}
```

**`StandardInteractionController`** (`src/interaction.ts`) è l'implementazione standard, e riproduce esattamente il comportamento di trascinamento descritto in questo documento: un'unica istanza installa due listener a livello di `document` (`pointerdown`, `pointermove`) e, per ogni gesto riconosciuto, pilota Jack/Plug esclusivamente tramite le loro API pubbliche descritte sopra — mai toccando stato interno. Ogni gesto è un semplice click sinistro (o un tap su touch) — non esiste alcun ramo per click destro o tasti modificatori, e mouse/pen usano sempre click-to-carry (il touch mantiene premi-e-trascina).

**`<cavi-interaction>`** (`src/interactionwc.ts`) è il web component che la collega dichiarativamente: alla connessione (dopo l'evento `caviready`, come `<cavi-wire>`) chiama `controller.attach(cavi)`; alla disconnessione chiama `controller.detach()`. La sua proprietà pubblica `controller` (di default un nuovo `StandardInteractionController`) può essere sostituita **prima** che l'elemento venga connesso al documento:

```typescript
const el = document.createElement('cavi-interaction');
el.controller = new MyCustomController(); // deve implementare IInteractionController
container.appendChild(el);
```

**`<cavi-world>`** (vedi [Panoramica](./01-overview.md)) ne crea automaticamente uno se l'autore non ne inserisce esplicitamente uno tra i propri figli — così le pagine che usano `<cavi-world>` restano interattive "di serie", esattamente come per il canvas. Per disattivare completamente l'interazione standard basta inserire manualmente un `<cavi-interaction>` vuoto con un controller no-op, o un controller che implementa solo la UX desiderata.

### Gesti riconosciuti da `StandardInteractionController`

- **Click-to-carry, sempre, per mouse/pen**: un click (senza tenerlo premuto) avvia un gesto (trascinamento di un plug, o un nuovo cavo da un jack) — un listener `pointermove` a livello di `document` segue la posizione **senza che nessun pulsante resti premuto**, così lo scroll nativo funziona per tutta la durata come se non si stesse trascinando nulla. Un secondo click col pulsante primario (ovunque avvenga) conclude il gesto; un click con pulsante non primario viene ignorato.
  - **Eccezione touch**: il touch (`pointerType === 'touch'`) usa invece sempre premi-e-trascina — il `pointerdown` chiama `setPointerCapture` sull'elemento target e `pointerup`/`pointercancel` lo concludono — dato che il trascinamento naturale col dito non ha il conflitto con lo scroll che click-to-carry aggira (già disabilitato durante il drag da `touch-action: none`), ed è il gesto touch più naturale.
- **Trigger della creazione cavo**: un `pointerdown` con click sinistro semplice (`button === 0`, nessun modificatore) su un `<cavi-jack>` con capacità residua — chiama `jack.createCable()`. Il click destro non fa parte dell'interazione; il menu contestuale nativo è lasciato inalterato ovunque.
- **Occlusione jack↔plug, risolta dall'hover-spread**: un plug agganciato a un jack e non attualmente aperto a ventaglio (vedi [Hover-spread](#hover-spread-scegliere-il-centro-di-un-jack-o-uno-dei-suoi-plug-esistenti) sopra) è fissato esattamente al centro del jack con `z-index` più alto — in un browser reale un click su quel punto risolve sempre sul plug, mai sul jack sottostante. Il controller riconosce l'evento tramite `event.composedPath()` (che attraversa correttamente lo Shadow DOM) e, se il target risolto è un `<cavi-plug>` agganciato e **non aperto a ventaglio** (`plug.isSpread() === false`), tratta il click come se fosse avvenuto sul suo `.jack`, avviando la creazione di un nuovo cavo da lì invece di trascinare il plug.
- **Trascinamento di un `Plug` esistente**: un `pointerdown` col tasto primario su un plug non agganciato oppure attualmente aperto a ventaglio (`plug.isSpread() === true`) chiama `plug.beginDrag()` — un plug diventa clickabile individualmente solo una volta che il meccanismo di hover-spread del proprio jack lo ha allontanato dal centro.
- **Tracciamento hover**: ogni `pointermove` a livello di `document` alimenta `Jack.setPointerHoverPosition()`, che pilota sia l'anteprima "jack pieno" sia il meccanismo di hover-spread di ogni jack.
- **`detach()`**: rimuove entrambi i listener e azzera la posizione del puntatore tracciata (`Jack.setPointerHoverPosition(null, null)`), così nessun jack resta bloccato in un'anteprima "vietato" residua o a metà apertura.

## `<cavi-wire>` — propagazione del `type` e nodi terminali (`src/wirewc.ts`)

- L'attributo `type` su `<cavi-wire>` viene letto una volta in fase di setup e propagato a ogni `<cavi-plug>` figlio tramite `plug.setType(type)`.
- Solo i `<cavi-plug node="...">` con indice `0` o `nodeCount - 1` (i due nodi terminali) vengono collegati; un indice intermedio produce un `console.warn` e il plug viene ignorato — i nodi intermedi non sono ancora supportati.
- Se un `<cavi-plug>` ha un attributo `jack="id"`, viene collegato dichiarativamente al jack corrispondente in fase di setup, passando dallo stesso `plug.attach(jack)` usato dal drag (così `jack.plugCount`/`max-plugs` restano corretti anche per le connessioni dichiarative). Se il `type` del jack non coincide con quello del cavo, viene emesso un `console.warn` ma la connessione viene comunque stabilita (il markup ha precedenza).
- L'attributo `node="N"` di ogni `<cavi-plug>` è la fonte di verità sull'indice a cui è legato, riletta ogni volta che serve (non solo una volta al setup): se il numero di nodi del cavo cambia dopo la connessione iniziale (unico caso oggi: la crescita durante `updateCableSession`, vedi sopra), chi sposta il plug libero su un nuovo indice **deve** aggiornare anche questo attributo, altrimenti un successivo `_rebindAfterIndexShift` (quando l'indice WASM di questo cavo si sposta per l'eliminazione di un cavo "fratello" — vedi sotto) rileggerebbe l'indice ormai stantio e riaggancerebbe il plug a un nodo intermedio invece che al vero terminale.

### Eliminazione automatica quando il cavo esce dal container (`auto-cleanup`)

Attributo booleano basato su presenza (come `plugged`/`freeze-on-drop`), **assente di default** — comportamento invariato finché non lo si imposta esplicitamente, dato che è un'azione irreversibile (libera anche la memoria WASM del cavo).

Quando presente, ad ogni frame del loop `requestAnimationFrame` già usato da `CaviWireElement` per sincronizzare i plug, viene eseguito un controllo sincrono (`_cleanupIfOutsideContainer()`, facilmente rintracciabile via grep) che verifica, tramite `getBoundingClientRect()`, se **tutti** i plug del cavo non si sovrappongono più al container passato a `new Renderer(container, world)` (esposto come `Cavi.getContainer()`/`Renderer.getContainer()` — vedi [riferimento API](./03-api.md#renderer)). Se sì, il cavo viene distrutto (`_destroy()`): il suo `Wire` viene cancellato (`cavi.deleteWire(index)`, liberando la memoria WASM) e l'elemento viene rimosso dal DOM — la rimozione fa scattare automaticamente `disconnectedCallback` su ogni `<cavi-plug>` figlio, che a sua volta chiama `detach()` (sganciandolo dal proprio Jack, se presente).

Deliberatamente basato su un controllo sincrono per-frame anziché su `IntersectionObserver`: dato che il loop RAF esiste già per sincronizzare la posizione dei plug, un controllo bounding-box nello stesso tick è preciso al frame esatto e non rischia il ritardo/coalescing tipico di `IntersectionObserver` (specialmente con tab in background).

**Nota importante**: cancellare un cavo che non è l'ultimo creato sposta gli indici WASM di tutti i cavi successivi (`World.deleteWire`, vedi [riferimento API](./03-api.md#world)). `CaviWireElement` mantiene un proprio registro statico di tutti i `<cavi-wire>` connessi e, subito dopo ogni cancellazione, ri-aggancia (`_rebindAfterIndexShift`) ogni cavo sopravvissuto il cui indice si è spostato al `Wire` fresco corretto — senza questo passaggio, gli altri cavi continuerebbero silenziosamente a leggere/scrivere il cavo sbagliato. Non copre invece un `Jack` che sta attivamente creando un nuovo cavo (una `CableSession` non ancora conclusa) nello stesso istante in cui un *altro* cavo esce ed è auto-cleanup: un caso limite molto raro, non ancora gestito.

## Relazione col motore fisico

Né `Jack` né `Plug` comunicano direttamente con `WasmWorld` — passano sempre attraverso un'istanza `Node`, che inoltra i cambiamenti di posizione/stato-fisso al nodo WASM sottostante (vedi [`Node` nel riferimento API](./03-api.md#node)). Questo mantiene la UI dei connettori coerente col resto dell'architettura di `cavijs` (la fisica resta in WASM, il DOM/interazione resta in TS).
