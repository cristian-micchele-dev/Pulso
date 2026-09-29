import { describe, expect, it } from 'vitest';
import { construirNeurona, type Rama, type Vec3 } from './dendrites';

/** Random determinista: los tests no pueden depender de la suerte. */
function randomFijo(semilla = 1): () => number {
  let s = semilla;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const ORIGEN: Vec3 = { x: 0, y: 0, z: 0 };
const opciones = (extra = {}) => ({ profundidad: 2, hijas: 2, random: randomFijo(), ...extra });

const distancia = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('construirNeurona', () => {
  it('genera el arbol completo: cada rama se parte en `hijas` hasta la profundidad', () => {
    const { ramas } = construirNeurona(ORIGEN, 1, 1, 0.02, opciones());

    // Profundidad 2 con 2 hijas: 1 tronco + 2 + 4 = 7 ramas.
    expect(ramas).toHaveLength(7);
  });

  it('afina las ramas: cada generacion es mas fina que la anterior', () => {
    const { ramas } = construirNeurona(ORIGEN, 1, 1, 0.02, opciones());

    const porOrden = (n: number) => ramas.filter((r) => r.orden === n);
    const maximo = (rs: Rama[]) => Math.max(...rs.map((r) => r.radioInicial));

    expect(maximo(porOrden(1))).toBeLessThan(maximo(porOrden(0)));
    expect(maximo(porOrden(2))).toBeLessThan(maximo(porOrden(1)));
  });

  it('acorta las ramas: las puntas son mas cortas que los troncos', () => {
    const { ramas } = construirNeurona(ORIGEN, 1, 1, 0.02, opciones());

    const recorrido = (r: Rama) =>
      r.camino.slice(1).reduce((suma, p, i) => suma + distancia(p, r.camino[i]), 0);

    const tronco = recorrido(ramas.find((r) => r.orden === 0)!);
    const punta = recorrido(ramas.find((r) => r.orden === 2)!);

    expect(punta).toBeLessThan(tronco);
  });

  it('encadena las ramas: cada hija arranca donde termino la madre', () => {
    const { ramas } = construirNeurona(ORIGEN, 1, 1, 0.02, opciones());

    const puntas = ramas.map((r) => r.camino[r.camino.length - 1]);

    // Toda rama que no sea tronco nace de la punta de alguna otra: si esto se
    // rompe, el tejido queda con dendritas flotando sueltas en el aire.
    for (const rama of ramas.filter((r) => r.orden > 0)) {
      const nace = rama.camino[0];
      expect(puntas.some((p) => distancia(p, nace) < 1e-9)).toBe(true);
    }
  });

  it('arranca todos los troncos en el soma', () => {
    const soma: Vec3 = { x: 0.5, y: -0.2, z: 0.1 };
    const { ramas } = construirNeurona(soma, 4, 1, 0.02, opciones());

    const troncos = ramas.filter((r) => r.orden === 0);
    expect(troncos).toHaveLength(4);
    for (const t of troncos) expect(distancia(t.camino[0], soma)).toBeLessThan(1e-9);
  });

  it('reparte los troncos en direcciones distintas', () => {
    const { ramas } = construirNeurona(ORIGEN, 6, 1, 0.02, opciones());

    const primeros = ramas.filter((r) => r.orden === 0).map((r) => r.camino[1]);

    // Si dos troncos salieran para el mismo lado, la neurona se veria chata.
    for (let i = 0; i < primeros.length; i++) {
      for (let j = i + 1; j < primeros.length; j++) {
        expect(distancia(primeros[i], primeros[j])).toBeGreaterThan(1e-6);
      }
    }
  });

  it('pone una sinapsis en cada punta', () => {
    const { ramas, sinapsis } = construirNeurona(ORIGEN, 1, 1, 0.02, opciones());

    const puntas = ramas.filter((r) => r.orden === 2);
    // Las puntas siempre llevan sinapsis; las bifurcaciones a veces, asi que el
    // total es al menos la cantidad de puntas.
    expect(sinapsis.length).toBeGreaterThanOrEqual(puntas.length);
  });

  it('curva las ramas en vez de trazarlas rectas', () => {
    const { ramas } = construirNeurona(ORIGEN, 1, 1, 0.02, opciones({ segmentos: 8 }));

    const tronco = ramas.find((r) => r.orden === 0)!;
    const recto = distancia(tronco.camino[0], tronco.camino[tronco.camino.length - 1]);
    const recorrido = tronco.camino
      .slice(1)
      .reduce((suma, p, i) => suma + distancia(p, tronco.camino[i]), 0);

    // El camino recorrido supera a la linea directa: eso es el arco. Este test
    // ya cazo una version donde el margen era del 0,4% y las dendritas salian
    // practicamente rectas, que es justo lo que hace parecer un diagrama.
    expect(recorrido).toBeGreaterThan(recto * 1.03);
  });

  it('es reproducible con el mismo random', () => {
    const a = construirNeurona(ORIGEN, 2, 1, 0.02, { random: randomFijo(7) });
    const b = construirNeurona(ORIGEN, 2, 1, 0.02, { random: randomFijo(7) });

    expect(a.ramas).toEqual(b.ramas);
  });
});
