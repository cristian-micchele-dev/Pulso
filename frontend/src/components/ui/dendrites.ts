/**
 * Cómo se ramifica una neurona.
 *
 * Una dendrita no es una línea entre dos puntos: sale del soma gruesa, se curva,
 * se parte en dos o tres, y cada rama repite lo mismo más fina y más corta. Eso
 * es lo que se ve en una foto de tejido nervioso, y lo que una nube de puntos no
 * puede dar por más puntos que se le pongan.
 *
 * Matemática pura, sin three.js: se prueba sin WebGL.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Rama {
  /** Puntos por los que pasa la rama, del origen a la punta. */
  camino: Vec3[];
  /** Grosor en el origen y en la punta: la dendrita se afina hacia afuera. */
  radioInicial: number;
  radioFinal: number;
  /** Cuántas veces se dividió desde el soma. Las de orden alto son las finitas. */
  orden: number;
}

export interface Neurona {
  soma: Vec3;
  radioSoma: number;
  ramas: Rama[];
  /** Dónde ponemos las sinapsis brillantes: las puntas y algunas bifurcaciones. */
  sinapsis: Vec3[];
}

export interface OpcionesDendrita {
  /** Divisiones máximas antes de terminar en punta. */
  profundidad: number;
  /** En cuántas se parte cada rama. */
  hijas: number;
  /** Cuánto se acorta cada generación. */
  acortamiento: number;
  /** Cuánto se afina cada generación. */
  afinamiento: number;
  /** Apertura del ángulo entre hijas, en radianes. */
  apertura: number;
  /** Segmentos por rama: más da curvas más suaves y más geometría. */
  segmentos: number;
  /** Cuánto se arquea una rama de punta a punta, en radianes. */
  curvatura: number;
  /** Temblor por segmento: rompe el arco perfecto para que no parezca dibujado. */
  temblor: number;
  random: () => number;
}

/**
 * Cuánto más gordo es el soma que el tronco que sale de él.
 *
 * Es una PROPORCIÓN, no un tamaño: el soma se deriva del grosor de las ramas, así
 * que adelgazarlas lo achica también. Cuando se afinan las dendritas y se quiere
 * conservar el cuerpo, este número sube para compensar.
 *
 * Tiene que leerse como aquello de donde nacen las dendritas. Muy bajo y el soma
 * desaparece entre las ramas; muy alto y se despega del tejido como una pelota
 * pegada encima, sobre todo porque el bulto hacia los troncos lo agranda aún más.
 */
const SOMA_SOBRE_TRONCO = 6.2;

export const OPCIONES_POR_DEFECTO: OpcionesDendrita = {
  profundidad: 4,
  hijas: 3,
  acortamiento: 0.68,
  afinamiento: 0.62,
  apertura: 0.9,
  segmentos: 7,
  curvatura: 1.1,
  temblor: 0.18,
  random: Math.random,
};

const suma = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const escalar = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const largo = (a: Vec3): number => Math.hypot(a.x, a.y, a.z) || 1;
const normalizar = (a: Vec3): Vec3 => escalar(a, 1 / largo(a));

/** Un vector cualquiera perpendicular al dado: sirve de eje para abrir las hijas. */
function perpendicular(v: Vec3): Vec3 {
  const auxiliar: Vec3 = Math.abs(v.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  return normalizar({
    x: v.y * auxiliar.z - v.z * auxiliar.y,
    y: v.z * auxiliar.x - v.x * auxiliar.z,
    z: v.x * auxiliar.y - v.y * auxiliar.x,
  });
}

/** Gira `v` alrededor de `eje` un ángulo dado (Rodrigues). */
function rotar(v: Vec3, eje: Vec3, angulo: number): Vec3 {
  const cos = Math.cos(angulo), sin = Math.sin(angulo);
  const cruz: Vec3 = {
    x: eje.y * v.z - eje.z * v.y,
    y: eje.z * v.x - eje.x * v.z,
    z: eje.x * v.y - eje.y * v.x,
  };
  const punto = eje.x * v.x + eje.y * v.y + eje.z * v.z;
  return {
    x: v.x * cos + cruz.x * sin + eje.x * punto * (1 - cos),
    y: v.y * cos + cruz.y * sin + eje.y * punto * (1 - cos),
    z: v.z * cos + cruz.z * sin + eje.z * punto * (1 - cos),
  };
}

/**
 * Traza UNA rama y, recursivamente, las que salen de su punta.
 *
 * La rama se arquea: se elige un eje de curvatura al azar y la dirección gira
 * alrededor de ese eje un poco en cada segmento, siempre para el mismo lado. Eso
 * es lo que da el arco.
 *
 * Con puro temblor aleatorio no alcanza —lo midió un test: las ramas quedaban a
 * menos del 1% de ser rectas y el conjunto parecía un diagrama de nodos—. El
 * temblor queda igual, pero encima del arco, para que no se note dibujado.
 */
function ramificar(
  origen: Vec3,
  direccion: Vec3,
  longitud: number,
  radio: number,
  orden: number,
  opciones: OpcionesDendrita,
  ramas: Rama[],
  sinapsis: Vec3[],
): void {
  const { segmentos, curvatura, temblor, random } = opciones;
  const camino: Vec3[] = [origen];
  let actual = origen;
  let dir = normalizar(direccion);

  // Eje del arco: perpendicular a la rama, girado al azar. Fijo para toda la
  // rama, porque un eje distinto por segmento vuelve a dar temblor, no arco.
  const ejeDelArco = rotar(perpendicular(dir), dir, random() * Math.PI * 2);
  const paso = curvatura / segmentos;

  for (let i = 0; i < segmentos; i++) {
    dir = rotar(dir, ejeDelArco, paso);
    dir = normalizar(suma(dir, {
      x: (random() - 0.5) * temblor,
      y: (random() - 0.5) * temblor,
      z: (random() - 0.5) * temblor,
    }));
    actual = suma(actual, escalar(dir, longitud / segmentos));
    camino.push(actual);
  }

  ramas.push({
    camino,
    radioInicial: radio,
    radioFinal: radio * opciones.afinamiento,
    orden,
  });

  if (orden >= opciones.profundidad) {
    // Punta: acá va una sinapsis, que es lo que se ve encendido en el tejido.
    sinapsis.push(actual);
    return;
  }

  // Algunas bifurcaciones también llevan sinapsis: quedan repartidas y no sólo
  // en el borde del dibujo.
  if (random() < 0.35) sinapsis.push(actual);

  const eje = perpendicular(dir);
  for (let h = 0; h < opciones.hijas; h++) {
    const giro = (h / opciones.hijas) * Math.PI * 2 + random() * 0.6;
    const abierta = rotar(dir, eje, opciones.apertura * (0.6 + random() * 0.7));
    ramificar(
      actual,
      rotar(abierta, dir, giro),
      longitud * opciones.acortamiento,
      radio * opciones.afinamiento,
      orden + 1,
      opciones,
      ramas,
      sinapsis,
    );
  }
}

/** Arma una neurona completa: soma, dendritas y dónde brillan las sinapsis. */
export function construirNeurona(
  soma: Vec3,
  troncos: number,
  longitud: number,
  radio: number,
  opciones: Partial<OpcionesDendrita> = {},
): Neurona {
  const config = { ...OPCIONES_POR_DEFECTO, ...opciones };
  const ramas: Rama[] = [];
  const sinapsis: Vec3[] = [];

  for (let t = 0; t < troncos; t++) {
    // Troncos repartidos en todas las direcciones, con algo de desorden.
    const phi = Math.acos(1 - 2 * (t + 0.5) / troncos);
    const theta = Math.PI * (1 + Math.sqrt(5)) * t;
    const direccion: Vec3 = {
      x: Math.sin(phi) * Math.cos(theta),
      y: Math.sin(phi) * Math.sin(theta),
      z: Math.cos(phi),
    };
    ramificar(soma, direccion, longitud, radio, 0, config, ramas, sinapsis);
  }

  return { soma, radioSoma: radio * SOMA_SOBRE_TRONCO, ramas, sinapsis };
}
