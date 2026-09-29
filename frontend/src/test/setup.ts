import '@testing-library/jest-dom/vitest';

// jsdom no implementa scrollIntoView: sin esto, cualquier componente que lleve
// la vista al final de una lista revienta en los tests y el DOM queda vacío.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom tampoco trae ResizeObserver, y el <Canvas> de react-three-fiber lo pide
// para medirse. Sin este relleno, cualquier pantalla con un fondo 3D revienta al
// montarse y el test falla por el entorno, no por el componente.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Y tampoco trae matchMedia, que es como consultamos prefers-reduced-motion para
// frenar las animaciones decorativas. Devuelve siempre `false` para que en los
// tests corra el camino normal, que es el que queremos ejercitar.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
