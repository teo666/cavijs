# Cavijs — Guida introduttiva / Avvio

## Prerequisiti

- Node.js — **disponibile** in questo ambiente (`node v24.19.0`, `npm 11.17.0`)
- La dipendenza npm `cavi` (`package.json` → `"cavi": "^0.1.0"`) deve risolversi nella build WASM del progetto Rust gemello [`cavi`](../../../cavi/doc/it/01-overview.md). `cargo`/`wasm-pack` **non sono installati** in questo ambiente, quindi l'output `pkg/` di `cavi` non esiste attualmente — confermare con il proprietario del progetto come questa dipendenza dovrebbe risolversi (pubblicazione su registro npm vs. `npm link` / riferimento `file:` a una `pkg/` costruita localmente) prima di installare.

## Installare le dipendenze

`node_modules/` non esiste attualmente in questo workspace.

```bash
npm install
```

> **Non è stato installato nulla automaticamente.** Chiedere conferma prima di eseguire `npm install` (o qualsiasi altro comando di installazione) — in particolare, confermare come deve essere reperita la dipendenza `cavi`, poiché un semplice `npm install` potrebbe fallire o scaricare una versione inattesa se `cavi` non è pubblicato su un registro raggiungibile da questo progetto.

## Script (`package.json`)

| Script | Comando | Scopo |
|---|---|---|
| `npm run dev` | `vite` | Avvia il dev server di Vite (hot reload) |
| `npm run build` | `tsc && vite build` | Type-check, poi produce una build di produzione |
| `npm run preview` | `vite preview` | Serve localmente la build di produzione |
| `npm run format` | `prettier --write .` | Formatta il codebase |
| `npm run format:check` | `prettier --check .` | Verifica la formattazione senza scrivere |

## Avviare la demo

`index.html` carica `src/main.ts`, che:
1. Inizializza il modulo WASM (`Cavi.initWasm()`)
2. Crea un'istanza `Cavi` e un `Renderer` collegato a `#wireCanvas`
3. Aggiunge tre cavi demo (rosso/giallo/verde, due in bezier + uno a segmenti)
4. Imposta la gravità (`cavi.setAcceleration(0, 10.0)`)
5. Monta un pannello di debug `<cavi-controls>` (`#controls` in `index.html`) se presente

Una volta installate le dipendenze, avviare il dev server con `npm run dev` e aprire l'URL locale stampato in console; il canvas dovrebbe mostrare tre cavi trascinabili soggetti a gravità con un pannello di statistiche/tuning live.

Esiste anche `index2.html` / `src/example2.ts` — un entry point alternativo; ispezionarlo prima dell'uso, poiché potrebbe essere sperimentale o non mantenuto rispetto a `main.ts`.
