import '../src/component/worldwc'; // registers cavi-world, and transitively cavi-jack/cavi-wire/cavi-plug/cavi-interaction

/**
 * The same patch panel twice: once in the page, once inside a shadow root.
 * Jack ids repeat across the two — every <cavi-plug jack="id"> finds the jack
 * of its own world (see CaviWireElement._findJack), and each world's
 * interaction controller only handles its own jacks and plugs.
 */
const STYLE = `
  cavi-world {
    width: 420px;
    height: 300px;
    background: #262626;
    border: 1px solid #333;
    border-radius: 8px;
    overflow: hidden;
  }
  cavi-jack {
    width: 26px;
    height: 26px;
  }
  cavi-jack::part(base) {
    background: #3a3a3a;
  }
  cavi-jack.cavi-magnet-target,
  cavi-plug.cavi-magnet-active {
    box-shadow: 0 0 0 6px rgba(255, 235, 59, 0.5);
  }
`;

function panel(id: string, color: string): string {
  return `
    <cavi-world id="${id}" gravity-y="5">
      <cavi-jack id="in" type="audio" x="70" y="70" cable-color="${color}"></cavi-jack>
      <cavi-jack id="out" type="audio" x="350" y="70" cable-color="${color}"></cavi-jack>
      <cavi-jack id="aux" type="audio" x="210" y="200" cable-color="${color}"></cavi-jack>
      <cavi-wire length="16" tension="20" size="5" color="${color}" type="audio">
        <cavi-plug node="0" jack="in"></cavi-plug>
        <cavi-plug node="15" jack="out"></cavi-plug>
      </cavi-wire>
    </cavi-world>`;
}

// World A, in the page.
const pageStyle = document.createElement('style');
pageStyle.textContent = STYLE;
document.head.appendChild(pageStyle);
document.getElementById('world-a-slot')!.innerHTML = panel('world-a', '#3fc6d8');

// World B, inside a shadow root: same markup, same ids.
const shadow = document.getElementById('shadow-host')!.attachShadow({ mode: 'open' });
shadow.innerHTML = `<style>${STYLE}</style>${panel('world-b', '#e8834a')}`;
