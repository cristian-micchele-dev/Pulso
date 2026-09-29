import { beforeAll, describe, expect, it } from 'vitest';
import type { BufferAttribute } from 'three';
import {
  ALTURA,
  CAMARA_Z,
  DESPEJE,
  NEURONAS,
  RADIO_EXTERNO,
  azarConSemilla,
  construirTejido,
  sobreElCamino,
  tuboAfinado,
  type Tejido,
  type Vec3,
} from './tissueGeometry';

/**
 * Todo se prueba por la puerta de entrada del módulo.
 *
 * `somaDeformado`, `ubicaciones` y `sembrarMotas` quedan privadas a propósito:
 * exportarlas sólo para probarlas convertiría detalles internos en contrato
 * público, y después nadie se anima a cambiarlos. Se verifican por lo que dejan
 * en el tejido, que es lo que de verdad le importa a quien lo usa.
 */

const distancia = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Centro y radio medio del anillo de vértices número `i` de un tubo. */
function anillo(posiciones: BufferAttribute, i: number, radiales: number) {
  const puntos: Vec3[] = [];
  for (let r = 0; r < radiales; r++) {
    const j = i * radiales + r;
    puntos.push({ x: posiciones.getX(j), y: posiciones.getY(j), z: posiciones.getZ(j) });
  }
  const centro = puntos.reduce(
    (acc, p) => ({ x: acc.x + p.x / radiales, y: acc.y + p.y / radiales, z: acc.z + p.z / radiales }),
    { x: 0, y: 0, z: 0 },
  );
  const radio = puntos.reduce((acc, p) => acc + distancia(p, centro) / radiales, 0);
  return { centro, radio };
}

const camino: Vec3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 0, y: 0.3, z: 0.05 },
  { x: 0.1, y: 0.6, z: 0.1 },
  { x: 0.25, y: 0.85, z: 0.1 },
];

describe('tuboAfinado', () => {
  it('pone un anillo de vértices por cada punto del camino', () => {
    const geo = tuboAfinado(camino, 0.05, 0.02);
    const total = geo.getAttribute('position').count;

    expect(total % camino.length).toBe(0);
    expect(total / camino.length).toBeGreaterThanOrEqual(3);
  });

  it('afina el tubo: el último anillo es más fino que el primero', () => {
    const geo = tuboAfinado(camino, 0.05, 0.02);
    const posiciones = geo.getAttribute('position') as BufferAttribute;
    const radiales = posiciones.count / camino.length;

    // Esto es lo que separa una dendrita de un caño, y `TubeGeometry` de three
    // no lo hace: por eso el tubo se arma a mano.
    expect(anillo(posiciones, 0, radiales).radio).toBeCloseTo(0.05, 3);
    expect(anillo(posiciones, camino.length - 1, radiales).radio).toBeCloseTo(0.02, 3);
  });

  it('los anillos quedan centrados sobre el camino', () => {
    const geo = tuboAfinado(camino, 0.04, 0.04);
    const posiciones = geo.getAttribute('position') as BufferAttribute;
    const radiales = posiciones.count / camino.length;

    // Si el marco perpendicular estuviera mal, los anillos se irían de la curva
    // y el tubo saldría retorcido o desplazado.
    camino.forEach((punto, i) => {
      expect(distancia(anillo(posiciones, i, radiales).centro, punto)).toBeLessThan(1e-6);
    });
  });

  it('da normales unitarias, que es lo que usa el material para sombrear', () => {
    const geo = tuboAfinado(camino, 0.04, 0.02);
    const normales = geo.getAttribute('normal') as BufferAttribute;

    for (let i = 0; i < normales.count; i++) {
      const largo = Math.hypot(normales.getX(i), normales.getY(i), normales.getZ(i));
      expect(largo).toBeCloseTo(1, 5);
    }
  });

  it('cierra la superficie con dos triángulos por cara y por tramo', () => {
    const geo = tuboAfinado(camino, 0.04, 0.02);
    const radiales = geo.getAttribute('position').count / camino.length;

    expect(geo.getIndex()?.count).toBe((camino.length - 1) * radiales * 6);
  });
});

describe('sobreElCamino', () => {
  const recta: Vec3[] = [
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
  ];

  it('en 0 da el origen y en 1 la punta', () => {
    expect(sobreElCamino(recta, 0)).toEqual({ x: 0, y: 0, z: 0 });
    expect(sobreElCamino(recta, 1)).toEqual({ x: 2, y: 0, z: 0 });
  });

  it('interpola en el medio', () => {
    expect(sobreElCamino(recta, 0.5).x).toBeCloseTo(1, 6);
  });

  it('recorta fuera de cero a uno', () => {
    // Las señales viajan sumando delta y pueden pasarse de 1 antes de que el
    // bucle las reinicie: sin recorte, ese cuadro saldría fuera de la rama.
    expect(sobreElCamino(recta, 1.4)).toEqual({ x: 2, y: 0, z: 0 });
    expect(sobreElCamino(recta, -0.3)).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('azarConSemilla', () => {
  it('con la misma semilla da la misma secuencia', () => {
    const a = azarConSemilla(99);
    const b = azarConSemilla(99);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('con semillas distintas da secuencias distintas', () => {
    expect(azarConSemilla(1)()).not.toBe(azarConSemilla(2)());
  });

  it('devuelve valores entre cero y uno', () => {
    const azar = azarConSemilla(5);
    for (let i = 0; i < 200; i++) {
      const v = azar();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('construirTejido', () => {
  let tejido: Tejido;

  // Armar el tejido es lo caro del módulo: se hace una vez y se comparte.
  beforeAll(() => {
    tejido = construirTejido();
  });

  it('siembra la cantidad de neuronas pedida', () => {
    expect(tejido.somas).toHaveLength(NEURONAS);
  });

  it('deja libre el espacio alrededor de la cámara', () => {
    /*
     * El invariante que sostiene todo el encuadre: una neurona encima de la
     * cámara llena la pantalla de tubos gigantes y desenfocados. Cada vez que se
     * movió `CAMARA_Z` hubo que revisar esto a mano; ahora lo revisa el test.
     *
     * El umbral se verifica APARTE, y no es un detalle. Comparar sólo contra
     * `DESPEJE` deja el test vacío: bajándolo a cero la aserción pasa a ser
     * «distancia mayor o igual que cero», cierta siempre. Lo cazó una mutación.
     *
     * Este mínimo no es la perilla: es el requisito. Las dendritas miden 0,95, así
     * que por debajo de 0,8 el cuerpo de la neurona envuelve a la cámara.
     */
    expect(DESPEJE).toBeGreaterThanOrEqual(0.8);

    for (const soma of tejido.somas) {
      const aLaCamara = Math.hypot(soma.posicion.x, soma.posicion.y, soma.posicion.z - CAMARA_Z);
      expect(aLaCamara).toBeGreaterThanOrEqual(DESPEJE);
    }
  });

  it('mantiene las neuronas dentro del cilindro', () => {
    /*
     * El cilindro tiene que ser lo bastante ancho para que al alejarse con la
     * rueda no se vea su borde flotando en el vacío. `ZOOM_MAX` vale 3,2 en
     * `NeuralTissue`, así que achicar esto por debajo de 2,5 rompe el encuadre.
     *
     * Va como cota MÍNIMA y no comparando contra sí mismo: una mutación mostró
     * que subir `RADIO_EXTERNO` dejaba pasar el test igual, porque una cota que
     * se afloja sola no cuida nada.
     */
    expect(RADIO_EXTERNO).toBeGreaterThanOrEqual(2.5);

    for (const { posicion } of tejido.somas) {
      expect(Math.hypot(posicion.x, posicion.z)).toBeLessThanOrEqual(RADIO_EXTERNO);
      expect(Math.abs(posicion.y)).toBeLessThanOrEqual(ALTURA);
    }
  });

  it('es reproducible: el login se ve igual en cada visita', () => {
    const otro = construirTejido();
    expect(otro.somas.map((s) => s.posicion)).toEqual(tejido.somas.map((s) => s.posicion));
  });

  it('reparte las neuronas entre las dos familias, alternando', () => {
    const colores = tejido.somas.map((s) => s.color);
    expect(new Set(colores).size).toBe(2);

    // Alternadas y no sorteadas: con azar salen rachas de un mismo color y se
    // pierde la mezcla, que es lo que hace que se lea como tejido teñido.
    for (let i = 1; i < colores.length; i++) {
      expect(colores[i]).not.toBe(colores[i - 1]);
    }
  });

  it('pinta las dendritas por vértice con exactamente dos tonos', () => {
    // El color viaja EN la geometría para que las ~1900 dendritas puedan
    // fusionarse en una sola malla y salir en un solo draw call. Si alguien lo
    // moviera al material, habría que partirla por familia.
    const colores = tejido.dendritas.getAttribute('color') as BufferAttribute;
    expect(colores).toBeDefined();

    const tonos = new Set<string>();
    for (let i = 0; i < colores.count; i += 97) {
      tonos.add(
        `${colores.getX(i).toFixed(4)},${colores.getY(i).toFixed(4)},${colores.getZ(i).toFixed(4)}`,
      );
    }
    expect(tonos.size).toBe(2);
  });

  it('los somas no son esferas: se estiran donde salen los troncos', () => {
    // Una esfera con ruido variaría lo que dice RUGOSIDAD, un diez por ciento.
    // El estirado hacia los troncos la lleva mucho más lejos, y esa diferencia
    // es justamente lo que hace que el cuerpo se funda con sus dendritas en vez
    // de quedar una bolita con caños clavados.
    for (const soma of tejido.somas) {
      const p = soma.geometria.getAttribute('position') as BufferAttribute;
      let min = Infinity, max = 0;
      for (let i = 0; i < p.count; i++) {
        const r = Math.hypot(p.getX(i), p.getY(i), p.getZ(i));
        min = Math.min(min, r);
        max = Math.max(max, r);
      }
      expect(max / min).toBeGreaterThan(1.3);
    }
  });

  it('recalcula las normales del soma después de deformarlo', () => {
    /*
     * En una esfera la normal de cada vértice apunta igual que su posición. Al
     * estirar el cuerpo hacia los troncos la superficie se inclina, así que las
     * normales tienen que dejar de ser radiales; si no se recalculan, la luz
     * sigue rebotando como si fuera una esfera y el relieve NO SE VE.
     *
     * Es el error clásico al deformar geometría, y hasta que una mutación borró
     * `computeVertexNormals()` sin que fallara nada, acá no lo cuidaba nadie.
     */
    const p = tejido.somas[0].geometria.getAttribute('position') as BufferAttribute;
    const n = tejido.somas[0].geometria.getAttribute('normal') as BufferAttribute;

    let inclinadas = 0;
    for (let i = 0; i < p.count; i++) {
      const largo = Math.hypot(p.getX(i), p.getY(i), p.getZ(i)) || 1;
      const radial =
        (p.getX(i) * n.getX(i) + p.getY(i) * n.getY(i) + p.getZ(i) * n.getZ(i)) / largo;
      if (radial < 0.99) inclinadas++;
    }

    expect(inclinadas / p.count).toBeGreaterThan(0.5);
  });

  it('da caminos y sinapsis para que las señales tengan por dónde viajar', () => {
    expect(tejido.caminos.length).toBeGreaterThan(0);
    expect(tejido.sinapsis.length % 3).toBe(0);
    expect(tejido.sinapsis.length / 3).toBeGreaterThan(0);

    for (const camino of tejido.caminos) expect(camino.length).toBeGreaterThanOrEqual(2);
  });

  it('siembra las motas dentro del volumen del tejido', () => {
    const dentro = (puntos: Float32Array, radio: number, alto: number) => {
      for (let i = 0; i < puntos.length; i += 3) {
        expect(Math.hypot(puntos[i], puntos[i + 2])).toBeLessThanOrEqual(radio);
        expect(Math.abs(puntos[i + 1])).toBeLessThanOrEqual(alto);
      }
    };

    dentro(tejido.motas, RADIO_EXTERNO + 0.4, ALTURA + 0.5);
    dentro(tejido.motasGrandes, 1.3, 1.0);
  });
});
