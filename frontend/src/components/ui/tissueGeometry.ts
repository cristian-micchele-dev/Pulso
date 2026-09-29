import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { construirNeurona, type Neurona, type Rama, type Vec3 } from './dendrites';

/** Caras alrededor del tubo. Nueve: con siete, las dendritas gruesas facetean. */
const RADIALES = 9;

/**
 * Radio del tronco de la neurona más grande, en las mismas unidades que su largo
 * (0,95). Con este valor una dendrita es unas cuarenta y tres veces más larga
 * que ancha. Subirlo la vuelve un caño; bajarlo la vuelve un pelo que la niebla
 * se come antes de que llegue a leerse.
 *
 * Ojo: el soma sale de multiplicar ESTE radio por SOMA_SOBRE_TRONCO, asi que
 * tocar el grosor de las ramas mueve tambien el tamano del cuerpo.
 */
const RADIO_TRONCO = 0.011;

/**
 * Qué proporción de las puntas se enciende.
 *
 * Encenderlas todas se ve como purpurina, no como tejido: en una foto real
 * brillan unas pocas.
 *
 * Se calibra contra las neuronas que entran EN CUADRO —unas siete—, no contra
 * las que hay sembradas: subir `NEURONAS` agranda el cilindro pero no lo que se
 * ve a la vez, así que este número no tiene que moverse con él.
 */
const DENSIDAD_SINAPSIS = 0.14;

/**
 * Cuántas neuronas se siembran alrededor del eje de giro.
 *
 * En cuadro entra más o menos un cuarto de ellas (el campo horizontal es de
 * unos 96° sobre los 360° del cilindro), así que bajarlo abre huecos y subirlo
 * cuesta geometría: cada una aporta entre 50 y 200 tubos.
 */
export const NEURONAS = 28;

/**
 * El tejido se siembra en un CILINDRO alrededor del eje Y, no en una lista de
 * posiciones a dedo.
 *
 * El grupo entero gira sobre ese eje. Cualquier reparto acomodado para verse
 * bien de frente se desarma al minuto de girar y deja zonas peladas; un
 * cilindro, en cambio, es invariante a esa rotación: gire lo que gire, el
 * puñado de neuronas que entra en cuadro es siempre igual de denso.
 */
const RADIO_INTERNO = 0.5;
export const RADIO_EXTERNO = 2.9;
/** Media altura del cilindro: cubre arriba y abajo del encuadre. */
export const ALTURA = 1.9;

/**
 * Dónde está la cámara y cuánto espacio hay que dejarle libre.
 *
 * Una neurona que caiga justo encima de la cámara llena la pantalla de tubos
 * gigantes y desenfocados. Se descartan las posiciones más cercanas que esto.
 * Tiene que seguir a `ZOOM_BASE` de `NeuralTissue`.
 */
export const CAMARA_Z = 0.3;
export const DESPEJE = 1.15;

/** Una neurona ya ubicada, con el detalle que le toca según lo lejos que esté. */
interface Ubicacion {
  soma: Vec3;
  escala: number;
  profundidad: number;
  troncos: number;
  /** Índice en `FAMILIAS`: decide si sale fría o cálida. */
  familia: number;
}

/**
 * En cuántas se parte cada rama.
 *
 * Dos, no tres: una dendrita real se BIFURCA, y con tres el tejido se llena de
 * cruces y se lee como maraña en vez de como árbol. Al perder una rama por
 * división se recupera un nivel de profundidad, así que el alcance no cambia
 * pero quedan menos tubos y la silueta se entiende.
 */
const HIJAS = 2;

/**
 * Las dos familias de neuronas: unas frías y otras cálidas.
 *
 * En una preparación teñida las células no salen todas del mismo color, y esa
 * mezcla es la mitad de lo que hace que se lea como tejido y no como un modelo.
 *
 * Los cuerpos van SATURADOS y oscuros, no claros. Un azul o un naranja pálido,
 * con la luz que hay en la escena, se lava hasta el blanco y la familia deja de
 * distinguirse: el color tiene que vivir en el pigmento, no en la iluminación.
 *
 * El núcleo apenas se separa del cuerpo. Un núcleo muy encendido convierte al
 * soma en una lamparita y se roba la atención del tejido, que es el que tiene
 * que llevar la vista.
 *
 * Los tres tonos de una familia comparten MATIZ y sólo cambian en claridad. Es
 * la diferencia entre una célula y tres piezas pegadas: apenas el soma se corre
 * unos grados —de naranja a rojo, por ejemplo— deja de leerse como el cuerpo de
 * esa dendrita y pasa a ser otra cosa apoyada encima.
 */
const FAMILIAS = [
  { dendrita: 0x3f9fd0, soma: 0x1a5c96, nucleo: 0x0e6f96 },
  { dendrita: 0xc4682a, soma: 0xab5a26, nucleo: 0xc4682a },
] as const;

/** Motas desenfocadas flotando en el medio: es lo que da el aire de microscopio. */
const MOTAS = 260;
const MOTAS_GRANDES = 34;

/**
 * Cuánto se estira el soma hacia cada tronco y qué tan en punta lo hace.
 *
 * Un soma no es una bolita: es estrellado, y lo es PORQUE las dendritas tiran
 * del cuerpo al salir. Modelarlo así —y no con ruido al azar— hace que las
 * puntas caigan exactamente donde nacen las ramas, y el cuerpo se funde con
 * ellas en vez de quedar una esfera con caños clavados.
 */
const BULTO = 0.6;
/** Exponente del estirado: más alto, puntas más finas y menos panza. */
const AGUDEZA = 3;
/** Irregularidad encima del estirado, para que no sea una estrella geométrica. */
const RUGOSIDAD = 0.1;

export interface Soma {
  posicion: Vec3;
  /** Geometría propia: cada soma sale deformado según sus propios troncos. */
  geometria: BufferGeometry;
  /** Color del cuerpo y del núcleo encendido de adentro. */
  color: number;
  nucleo: number;
}

export interface Tejido {
  /** Todas las dendritas en UNA geometría: 1 draw call en vez de cientos. */
  dendritas: BufferGeometry;
  /** Dónde va cada soma, de qué tamaño y de qué familia. */
  somas: Soma[];
  /** Sinapsis quietas: los puntos encendidos repartidos por el tejido. */
  sinapsis: Float32Array;
  /** Los caminos de las ramas, para mandar señales viajando por ellos. */
  caminos: Vec3[][];
  /** Motas chicas y nítidas, repartidas por todo el volumen. */
  motas: Float32Array;
  /** Las pocas que caen cerca de la cámara y se ven como manchones. */
  motasGrandes: Float32Array;
}

/**
 * Un tubo que nace grueso y muere fino.
 *
 * `TubeGeometry` de three sirve para un radio constante, y una dendrita de radio
 * constante se ve como un caño. El afinado es justamente lo que la hace parecer
 * tejido, así que el tubo se arma a mano: se recorre el camino, se calcula un
 * marco perpendicular en cada punto y se pone un anillo de vértices con el radio
 * interpolado.
 *
 * El marco se arrastra de un punto al siguiente (en vez de recalcularlo desde
 * cero) para que los anillos no giren entre sí y el tubo no salga retorcido.
 */
export function tuboAfinado(camino: Vec3[], radioInicial: number, radioFinal: number): BufferGeometry {
  const puntos = camino.map((p) => new Vector3(p.x, p.y, p.z));
  const anillos = puntos.length;

  const posiciones = new Float32Array(anillos * RADIALES * 3);
  const normales = new Float32Array(anillos * RADIALES * 3);

  // Marco inicial: cualquier par perpendicular a la primera tangente.
  const tangente = new Vector3().subVectors(puntos[1], puntos[0]).normalize();
  let normal = new Vector3(0, 1, 0);
  if (Math.abs(tangente.dot(normal)) > 0.9) normal.set(1, 0, 0);
  normal.crossVectors(tangente, normal).normalize();
  let binormal = new Vector3().crossVectors(tangente, normal);

  const siguiente = new Vector3();
  const vertice = new Vector3();

  for (let i = 0; i < anillos; i++) {
    // Tangente por diferencias: hacia adelante en el primero, hacia atrás en el
    // último, centrada en el medio.
    const antes = puntos[Math.max(0, i - 1)];
    const despues = puntos[Math.min(anillos - 1, i + 1)];
    siguiente.subVectors(despues, antes).normalize();

    // Se arrastra el marco: se saca de la normal previa lo que caiga sobre la
    // tangente nueva. Así el anillo gira lo mínimo indispensable.
    normal = normal.clone().addScaledVector(siguiente, -normal.dot(siguiente)).normalize();
    binormal = new Vector3().crossVectors(siguiente, normal).normalize();

    const t = i / (anillos - 1);
    const radio = radioInicial + (radioFinal - radioInicial) * t;

    for (let r = 0; r < RADIALES; r++) {
      const angulo = (r / RADIALES) * Math.PI * 2;
      const cos = Math.cos(angulo), sin = Math.sin(angulo);
      vertice.set(
        normal.x * cos + binormal.x * sin,
        normal.y * cos + binormal.y * sin,
        normal.z * cos + binormal.z * sin,
      );
      const base = (i * RADIALES + r) * 3;
      normales.set([vertice.x, vertice.y, vertice.z], base);
      posiciones.set([
        puntos[i].x + vertice.x * radio,
        puntos[i].y + vertice.y * radio,
        puntos[i].z + vertice.z * radio,
      ], base);
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < anillos - 1; i++) {
    for (let r = 0; r < RADIALES; r++) {
      const a = i * RADIALES + r;
      const b = i * RADIALES + (r + 1) % RADIALES;
      const c = (i + 1) * RADIALES + r;
      const d = (i + 1) * RADIALES + (r + 1) % RADIALES;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometria = new BufferGeometry();
  geometria.setAttribute('position', new BufferAttribute(posiciones, 3));
  geometria.setAttribute('normal', new BufferAttribute(normales, 3));
  geometria.setIndex(indices);
  return geometria;
}

/**
 * Deforma una esfera en un soma estrellado.
 *
 * Por cada vértice se mira cuánto se alinea su normal con la dirección de algún
 * tronco: donde coincide, el vértice se empuja hacia afuera. Se toma el MÁXIMO y
 * no la suma, porque sumando, un soma con muchos troncos se infla entero y
 * vuelve a ser una bola.
 */
function somaDeformado(radio: number, direcciones: Vec3[], random: () => number): BufferGeometry {
  const geometria = new SphereGeometry(radio, 32, 20);
  const posiciones = geometria.getAttribute('position') as BufferAttribute;
  const v = new Vector3();

  for (let i = 0; i < posiciones.count; i++) {
    v.fromBufferAttribute(posiciones, i).normalize();

    let tiron = 0;
    for (const d of direcciones) {
      const alineacion = v.x * d.x + v.y * d.y + v.z * d.z;
      if (alineacion > 0) tiron = Math.max(tiron, Math.pow(alineacion, AGUDEZA));
    }

    const factor = 1 + BULTO * tiron + (random() - 0.5) * RUGOSIDAD;
    posiciones.setXYZ(i, v.x * radio * factor, v.y * radio * factor, v.z * radio * factor);
  }

  // Sin esto la luz sigue rebotando como si fuera una esfera y el relieve no se
  // ve: las normales son lo que el material usa para sombrear, no las posiciones.
  geometria.computeVertexNormals();
  return geometria;
}

/** Hacia dónde sale cada tronco, leído del primer tramo de las ramas de orden 0. */
function direccionesDeTroncos(neurona: Neurona): Vec3[] {
  return neurona.ramas
    .filter((r) => r.orden === 0)
    .map((r) => {
      const a = r.camino[0], b = r.camino[1];
      const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
      const largo = Math.hypot(d.x, d.y, d.z) || 1;
      return { x: d.x / largo, y: d.y / largo, z: d.z / largo };
    });
}

/** Le pone a cada vértice de una geometría el mismo color, para poder fusionarla. */
function pintar(geometria: BufferGeometry, color: Color): void {
  const vertices = geometria.getAttribute('position').count;
  const colores = new Float32Array(vertices * 3);
  for (let i = 0; i < vertices; i++) colores.set([color.r, color.g, color.b], i * 3);
  geometria.setAttribute('color', new BufferAttribute(colores, 3));
}

/**
 * Azar reproducible.
 *
 * El tejido se arma durante el render, y `Math.random` ahí es impuro: React
 * puede volver a renderizar y salir otro cerebro distinto. Con semilla el
 * resultado es siempre el mismo, que además es lo que uno quiere en un login:
 * que la pantalla se vea igual en cada visita.
 */
export function azarConSemilla(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Siembra las neuronas en el cilindro, salteando las que caerían encima de la
 * cámara.
 *
 * El ángulo usa el paso áureo en vez de azar puro: un reparto al azar deja
 * grumos y claros, que es justo lo que hay que evitar. El radio y la altura sí
 * llevan azar, para que no se note la regularidad.
 *
 * Las lejanas se ramifican menos (`profundidad` 2 en vez de 3): la niebla las
 * difumina igual, así que el detalle no se vería y sólo costaría geometría.
 */
function ubicaciones(random: () => number): Ubicacion[] {
  const PASO_AUREO = Math.PI * (3 - Math.sqrt(5));
  const sembradas: Ubicacion[] = [];

  for (let i = 0; sembradas.length < NEURONAS && i < NEURONAS * 4; i++) {
    const angulo = i * PASO_AUREO;
    const radio = RADIO_INTERNO + (RADIO_EXTERNO - RADIO_INTERNO) * random();
    const soma: Vec3 = {
      x: Math.cos(angulo) * radio,
      y: (random() * 2 - 1) * ALTURA,
      z: Math.sin(angulo) * radio,
    };

    const aLaCamara = Math.hypot(soma.x, soma.y, soma.z - CAMARA_Z);
    if (aLaCamara < DESPEJE) continue;

    // Las cercanas se ven grandes y con detalle; las de atrás, chicas y simples.
    const cerca = aLaCamara < 1.9;
    sembradas.push({
      soma,
      escala: Math.min(1, Math.max(0.42, 1.08 - 0.14 * aLaCamara)),
      profundidad: cerca ? 4 : 3,
      troncos: cerca ? 4 : 3,
      // Alternar y no sortear: con azar salen rachas de un mismo color y se
      // pierde la mezcla, que es justamente lo que se quiere ver.
      familia: sembradas.length % FAMILIAS.length,
    });
  }

  return sembradas;
}

/**
 * Motas flotando en el volumen, el desenfoque de una preparación al microscopio.
 *
 * Van en dos tandas porque un `PointsMaterial` tiene UN tamaño para todos sus
 * puntos: las chicas se reparten por todo el cilindro y las grandes se siembran
 * cerca de la cámara, donde una partícula real quedaría fuera de foco y enorme.
 */
function sembrarMotas(cantidad: number, radio: number, alto: number, random: () => number): Float32Array {
  const puntos = new Float32Array(cantidad * 3);
  for (let i = 0; i < cantidad; i++) {
    const angulo = random() * Math.PI * 2;
    // Raíz cuadrada del azar: sin eso se amontonan contra el eje, porque un
    // anillo lejano tiene más superficie que uno cercano.
    const r = radio * Math.sqrt(random());
    puntos.set([Math.cos(angulo) * r, (random() * 2 - 1) * alto, Math.sin(angulo) * r], i * 3);
  }
  return puntos;
}

/**
 * Arma el tejido entero, una sola vez.
 *
 * Todo lo caro —ramificar, tubular, fusionar— pasa acá y nunca en el bucle de
 * animación. Por cuadro sólo se mueven las señales y gira el grupo.
 */
export function construirTejido(random: () => number = azarConSemilla(20260928)): Tejido {
  const sitios = ubicaciones(random);

  /*
   * Cada neurona se ramifica con parámetros propios.
   *
   * Con los mismos valores para todas, el tejido delata que son copias del mismo
   * árbol: el ojo detecta la repetición aunque las posiciones y los ángulos
   * cambien. La variación es chica a propósito —siguen siendo neuronas, no
   * plantas distintas— pero alcanza para romper el patrón.
   */
  const neuronas: Neurona[] = sitios.map(({ soma, escala, profundidad, troncos }) =>
    construirNeurona(soma, troncos, (0.85 + random() * 0.25) * escala, RADIO_TRONCO * escala, {
      profundidad,
      hijas: HIJAS,
      curvatura: 0.8 + random() * 0.7,
      apertura: 0.7 + random() * 0.5,
      acortamiento: 0.62 + random() * 0.12,
      random,
    }),
  );

  const partes: BufferGeometry[] = [];
  const caminos: Vec3[][] = [];
  const sinapsis: number[] = [];
  const tinta = new Color();

  neuronas.forEach((neurona, i) => {
    const familia = FAMILIAS[sitios[i].familia];
    tinta.setHex(familia.dendrita);

    for (const rama of neurona.ramas) {
      const tubo = tuboAfinado(rama.camino, rama.radioInicial, rama.radioFinal);
      // El color viaja EN la geometría porque después se fusiona todo en una
      // sola malla: con un color por material habría que volver a partirla en
      // una malla por familia y perder el draw call único.
      pintar(tubo, tinta);
      partes.push(tubo);
      caminos.push(rama.camino);
    }
    for (const s of neurona.sinapsis) {
      if (random() > DENSIDAD_SINAPSIS) continue;
      sinapsis.push(s.x, s.y, s.z);
    }
  });

  return {
    dendritas: mergeGeometries(partes, false) ?? new BufferGeometry(),
    somas: neuronas.map((n, i) => ({
      posicion: n.soma,
      // Las direcciones de los troncos salen de las propias ramas de orden 0:
      // así el bulto cae siempre donde nace una dendrita, sin guardar el dato
      // por duplicado.
      geometria: somaDeformado(n.radioSoma, direccionesDeTroncos(n), random),
      color: FAMILIAS[sitios[i].familia].soma,
      nucleo: FAMILIAS[sitios[i].familia].nucleo,
    })),
    sinapsis: new Float32Array(sinapsis),
    motas: sembrarMotas(MOTAS, RADIO_EXTERNO + 0.4, ALTURA + 0.5, random),
    motasGrandes: sembrarMotas(MOTAS_GRANDES, 1.3, 1.0, random),
    caminos,
  };
}

/** Posición sobre un camino, con `t` de 0 (origen) a 1 (punta). */
export function sobreElCamino(camino: Vec3[], t: number): Vec3 {
  const escala = Math.min(Math.max(t, 0), 1) * (camino.length - 1);
  const i = Math.min(Math.floor(escala), camino.length - 2);
  const f = escala - i;
  const a = camino[i], b = camino[i + 1];
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
}

/**
 * El halo luminoso, dibujado una vez y reusado por la GPU en cada sinapsis.
 *
 * Se genera con un gradiente en vez de cargar un PNG: no suma un archivo al
 * bundle y se ve nítido en cualquier densidad de pantalla. El núcleo brillante
 * con caída larga es lo que da la sensación de resplandor sin post-procesado.
 *
 * Va en blanco a propósito: la textura define la FORMA del halo y el color lo
 * pone quien la usa, con el color por vértice. Teñirla acá aplicaría el tono dos
 * veces, y cambiar la paleta obligaría a tocar también este archivo.
 */
export function crearHalo(size = 128): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const r = size / 2;
    const g = ctx.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.12, 'rgba(255,255,255,0.92)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.34)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new CanvasTexture(canvas);
}

export type { Rama, Vec3 };
