import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
  type WheelEvent,
} from 'react';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  MathUtils,
  Vector3,
  type DirectionalLight,
  type Fog,
  type Group,
} from 'three';
import { azarConSemilla, construirTejido, crearHalo, sobreElCamino } from './tissueGeometry';
import styles from './NeuralTissue.module.css';

/** Vueltas por segundo del tejido. Casi nada: tiene que respirar, no girar. */
const GIRO = 0.008;

/**
 * Las luces orbitan el tejido en vez de quedarse clavadas.
 *
 * Mover la luz da vida mucho más barato que mover la geometría: el brillo
 * recorre las dendritas y lo que estaba en sombra se enciende, sin tocar un solo
 * vértice ni marear al que está tratando de escribir su contraseña.
 *
 * Las dos velocidades son distintas y no múltiplos entre sí, así que la escena
 * tarda muchísimo en repetirse. Con velocidades parejas se nota el ciclo.
 */
const ORBITA_CLAVE = 0.19;
const ORBITA_CONTRA = 0.11;
/** Distancia de las luces al centro, y cuánto suben y bajan mientras giran. */
const RADIO_LUZ = 5;
const VAIVEN_LUZ = 2.2;
/** Cuánto cabecea, para que no parezca girar sobre un eje de juguete. */
const CABECEO = 0.03;

/**
 * Señales viajando por las dendritas a la vez.
 *
 * Se reparten entre TODAS las ramas del cilindro, y sólo un cuarto de ellas está
 * en cuadro. Si sube `NEURONAS` en `tissueGeometry`, este número tiene que subir
 * con él o el tejido se apaga.
 */
const SENALES = 150;
const VELOCIDAD_MIN = 0.25;
const VELOCIDAD_MAX = 0.75;

/** Al hacer clic, cuántas ramas cercanas se encienden. */
const RAMAS_POR_CLIC = 14;

/** Radianes de giro por píxel arrastrado. */
const SENSIBILIDAD = 0.005;
/** Qué tan rápido se apaga la inercia al soltar. Más alto, frena antes. */
const FRENADO = 2.2;
/**
 * Tope de inclinación vertical, en radianes.
 *
 * Es chico a propósito. El tejido está sembrado en un cilindro alrededor del eje
 * Y: girar en horizontal es gratis porque la forma es invariante a eso, pero
 * inclinar de más asoma la TAPA del cilindro, que está pelada.
 */
const TOPE_VERTICAL = 0.32;
/** Una pulsación que se movió menos que esto en píxeles cuenta como clic. */
const TOLERANCIA_CLIC = 6;

/**
 * El color de las dendritas ya no vive acá: viene por vértice desde
 * `tissueGeometry`, porque hay dos familias de neuronas —frías y cálidas— y
 * todas comparten una sola malla. El material sólo aporta el brillo interno.
 */
const BRILLO_INTERNO = 0x1b2a3a;
/** Las sinapsis quietas: ambar, para que no se confundan con las motas azules. */
const CHISPA = new Color(0xffb04a);
/** Las motas flotando: el azul frío del desenfoque de microscopio. */
const MOTA = 0x6fc9ff;

/**
 * La niebla es lo que da profundidad: las neuronas del fondo se disuelven en el
 * color de la página en vez de quedar nítidas y chiquitas, que es lo que delata
 * a un render plano.
 *
 * Los dos valores NO son distancias a la cámara: son distancias medidas desde el
 * centro del tejido, y cada cuadro se le suma dónde está la cámara.
 *
 * Eso resuelve un problema que una niebla fija no puede: con la rueda la cámara
 * va de 0,3 a 3,2, y un alcance fijo o borra el fondo cuando te alejás o lo deja
 * crudo cuando te acercás. Atada al centro, el desvanecido en el borde del
 * cilindro da siempre lo mismo, estés donde estés. Además desaparece el
 * acoplamiento con `ZOOM_BASE`, que antes había que mover a mano.
 */
const NIEBLA_DESDE = 0.6;
const NIEBLA_HASTA = 4.6;

/**
 * Distancia de la cámara al tejido, que es lo que mueve la rueda.
 *
 * Se arranca con el zoom AL MÁXIMO, metido entre las dendritas, y desde ahí sólo
 * se puede alejar: `ZOOM_BASE` es a la vez el punto de partida y el tope
 * cercano. No existe un `ZOOM_MIN` separado porque sería otra constante que
 * habría que acordarse de mantener igual a ésta.
 *
 * `ZOOM_MAX` está atado a cuánto tejido hay sembrado: más lejos que esto y se
 * empieza a ver el borde del cilindro. Si alguna vez suben `RADIO_EXTERNO` o
 * `ALTURA` en `tissueGeometry`, este tope puede subir con ellos; antes no.
 */
const ZOOM_BASE = 0.3;
const ZOOM_MAX = 3.2;
/** Distancia que recorre por unidad de rueda. */
const ZOOM_PASO = 0.0022;
/** Qué tan rápido alcanza el zoom pedido. Más alto, más seco. */
const ZOOM_SUAVIDAD = 5;

interface Senal {
  camino: number;
  /** 0 en el nacimiento de la rama, 1 en la punta. */
  t: number;
  velocidad: number;
}

/**
 * Lo que el `div` de afuera le cuenta a la escena de adentro.
 *
 * Va todo en un solo objeto mutable y no en estado de React: son datos que
 * cambian con cada movimiento del puntero y que sólo lee el bucle de animación.
 * Pasarlos por estado dispararía un render por cuadro para nada.
 */
interface Gesto {
  arrastrando: boolean;
  /** Píxeles movidos desde el cuadro anterior; `useFrame` los consume y los pone en cero. */
  dx: number;
  dy: number;
  /** Última posición del puntero, para calcular el delta sin depender de `movementX`. */
  x: number;
  y: number;
  /** Píxeles recorridos en esta pulsación: es lo que distingue un clic de un arrastre. */
  recorrido: number;
  /** Distancia de cámara deseada, que mueve la rueda. */
  zoom: number;
  /** Punto del tejido bajo el puntero al apretar, esperando saber si fue clic. */
  candidato: Vector3 | null;
  /** Ya se resolvió que fue clic: `useFrame` dispara la cascada y lo limpia. */
  disparo: Vector3 | null;
}

/**
 * Color al que se desvanece el tejido con la distancia.
 *
 * Es el que se usa hasta que se puede leer `--tissue-fog` del contenedor, que
 * necesita el nodo ya montado. Vale para el primer cuadro nomás.
 */
const NIEBLA_POR_DEFECTO = 0x04070f;

function Tejido({ gesto, niebla }: { gesto: RefObject<Gesto>; niebla: number }) {
  const grupo = useRef<Group>(null);
  const luzClave = useRef<DirectionalLight>(null);
  const luzContra = useRef<DirectionalLight>(null);
  /** Velocidad que queda al soltar, para que el tejido no se clave en seco. */
  const inercia = useRef(0);
  /** Inclinación acumulada por arrastre vertical, aparte del cabeceo automático. */
  const inclinacion = useRef(0);

  const tejido = useMemo(() => construirTejido(), []);
  const halo = useMemo(() => crearHalo(), []);

  // Cada sinapsis late a su propio ritmo. Sin desfasaje respiran todas juntas y
  // se ve como un parpadeo de cartel, no como tejido vivo.
  const fases = useMemo(() => {
    const azar = azarConSemilla(7);
    return Float32Array.from({ length: tejido.sinapsis.length / 3 }, () => azar() * Math.PI * 2);
  }, [tejido]);

  const geometriaSinapsis = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(tejido.sinapsis, 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(fases.length * 3), 3));
    return g;
  }, [tejido, fases]);

  const geometriaSenales = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(SENALES * 3), 3));
    return g;
  }, []);

  const geometriaMotas = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(tejido.motas, 3));
    return g;
  }, [tejido]);

  const geometriaMotasGrandes = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(tejido.motasGrandes, 3));
    return g;
  }, [tejido]);

  /**
   * Pool fijo de señales: una que llega a la punta renace en otra rama en vez de
   * destruirse. Nada se asigna dentro del bucle de animación.
   *
   * Va en un `ref` y no en `useMemo` porque se MUTA sesenta veces por segundo.
   * Un valor memoizado se supone inmutable; un ref es justamente el lugar que
   * React reserva para estado mutable que no dispara re-render.
   */
  const senales = useRef<Senal[]>([]);
  if (senales.current.length === 0) {
    const azar = azarConSemilla(13);
    senales.current = Array.from({ length: SENALES }, () => ({
      camino: Math.floor(azar() * tejido.caminos.length),
      t: azar(),
      velocidad: VELOCIDAD_MIN + azar() * (VELOCIDAD_MAX - VELOCIDAD_MIN),
    }));
  }

  useEffect(() => () => {
    halo.dispose();
    geometriaSinapsis.dispose();
    geometriaSenales.dispose();
    geometriaMotas.dispose();
    geometriaMotasGrandes.dispose();
    tejido.dendritas.dispose();
    for (const soma of tejido.somas) soma.geometria.dispose();
  }, [halo, geometriaSinapsis, geometriaSenales, geometriaMotas, geometriaMotasGrandes, tejido]);

  /**
   * Manda un chispazo por las ramas que hay alrededor de un punto del tejido.
   *
   * No hace falta crear señales: se reciclan las del pool, mandándolas al
   * arranque de las ramas más cercanas. El costo es un barrido por los caminos,
   * y eso pasa una vez por clic, no por cuadro.
   */
  function encender(local: Vector3) {
    const cerca = new Vector3();

    const distancias = tejido.caminos.map((camino, indice) => {
      const raiz = camino[0];
      cerca.set(raiz.x, raiz.y, raiz.z);
      return { indice, d: cerca.distanceTo(local) };
    });
    distancias.sort((a, b) => a.d - b.d);

    for (let i = 0; i < Math.min(RAMAS_POR_CLIC, senales.current.length); i++) {
      senales.current[i].camino = distancias[i].indice;
      senales.current[i].t = 0;
      senales.current[i].velocidad = VELOCIDAD_MAX;
    }
  }

  useFrame((estado, delta) => {
    const paso = Math.min(delta, 0.1);
    const g = gesto.current;

    // El puntero y la rueda sólo escriben intenciones; el movimiento real pasa
    // acá. Mover la cámara o el grupo directo desde el evento da tirones, porque
    // los eventos llegan a su ritmo y no al de los cuadros.
    estado.camera.position.z = MathUtils.damp(
      estado.camera.position.z,
      g.zoom,
      ZOOM_SUAVIDAD,
      paso,
    );

    // La niebla viaja con la cámara: sus dos distancias se miden desde el centro
    // del tejido, así que se le suma dónde está parada. Sin esto, alejarse borra
    // el fondo y acercarse lo deja crudo.
    const bruma = estado.scene.fog as Fog | null;
    if (bruma) {
      bruma.near = estado.camera.position.z + NIEBLA_DESDE;
      bruma.far = estado.camera.position.z + NIEBLA_HASTA;
    }

    // Las luces orbitan en sentidos opuestos: así el borde encendido y la cara
    // iluminada se cruzan en vez de acompañarse, y el relieve cambia todo el rato.
    const t = estado.clock.elapsedTime;
    if (luzClave.current) {
      luzClave.current.position.set(
        Math.cos(t * ORBITA_CLAVE) * RADIO_LUZ,
        Math.sin(t * ORBITA_CLAVE * 0.7) * VAIVEN_LUZ + 1.5,
        Math.sin(t * ORBITA_CLAVE) * RADIO_LUZ,
      );
    }
    if (luzContra.current) {
      luzContra.current.position.set(
        Math.cos(-t * ORBITA_CONTRA + Math.PI) * RADIO_LUZ,
        Math.sin(-t * ORBITA_CONTRA * 1.3) * VAIVEN_LUZ - 1,
        Math.sin(-t * ORBITA_CONTRA + Math.PI) * RADIO_LUZ,
      );
    }

    if (grupo.current) {
      grupo.current.rotation.y += g.dx * SENSIBILIDAD;
      inclinacion.current = MathUtils.clamp(
        inclinacion.current + g.dy * SENSIBILIDAD,
        -TOPE_VERTICAL,
        TOPE_VERTICAL,
      );

      if (g.arrastrando) {
        // Lo movido en este cuadro es la velocidad que se hereda al soltar.
        inercia.current = g.dx * SENSIBILIDAD;
      } else {
        grupo.current.rotation.y += GIRO * paso + inercia.current;
        inercia.current = MathUtils.damp(inercia.current, 0, FRENADO, paso);
      }

      g.dx = 0;
      g.dy = 0;
      grupo.current.rotation.x =
        inclinacion.current + Math.sin(estado.clock.elapsedTime * 0.12) * CABECEO;
    }

    if (g.disparo) {
      encender(g.disparo);
      g.disparo = null;
    }

    // Sinapsis: sólo cambia el color, nunca la posición.
    const colores = geometriaSinapsis.getAttribute('color') as BufferAttribute;
    for (let i = 0; i < fases.length; i++) {
      const brillo = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(estado.clock.elapsedTime * 1.6 + fases[i]));
      colores.setXYZ(i, CHISPA.r * brillo, CHISPA.g * brillo, CHISPA.b * brillo);
    }
    colores.needsUpdate = true;

    // Señales: avanzan por su rama y renacen en otra al llegar a la punta.
    const posiciones = geometriaSenales.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < senales.current.length; i++) {
      const senal = senales.current[i];
      senal.t += senal.velocidad * paso;
      if (senal.t > 1) {
        senal.t = 0;
        senal.camino = Math.floor(Math.random() * tejido.caminos.length);
        senal.velocidad = VELOCIDAD_MIN + Math.random() * (VELOCIDAD_MAX - VELOCIDAD_MIN);
      }
      const p = sobreElCamino(tejido.caminos[senal.camino], senal.t);
      posiciones.setXYZ(i, p.x, p.y, p.z);
    }
    posiciones.needsUpdate = true;
  });

  /**
   * Al apretar sólo se ANOTA dónde: todavía no se sabe si es un clic o el
   * arranque de un arrastre. Lo decide el `div` de afuera al soltar, comparando
   * cuántos píxeles se recorrió. Sin esto, cada vez que agarrás el tejido para
   * girarlo se dispararía un chispazo de regalo.
   */
  const alApuntar = (evento: ThreeEvent<PointerEvent>) => {
    gesto.current.candidato = evento.object.worldToLocal(evento.point.clone());
  };

  return (
    <>
      <fog attach="fog" args={[niebla, NIEBLA_DESDE, NIEBLA_HASTA]} />
      <ambientLight intensity={0.38} color={0x8fb8e8} />
      {/*
        Sólo dos direccionales, y las dos se mueven.
        - La clave orbita el tejido: al girar, el brillo recorre las dendritas y
          lo que estaba en sombra se enciende. Es lo que da la sensación de que
          algo pasa, sin mover un solo vértice.
        - La contraluz viene desde atrás y dibuja el borde encendido de cada
          dendrita, que es lo que las hace leer como translúcidas y húmedas en vez
          de caños pintados. Un material translúcido de verdad costaría mucho más
          y se notaría mucho menos.
      */}
      <directionalLight ref={luzClave} intensity={1.6} color={0xbfe4ff} />
      <directionalLight ref={luzContra} intensity={1.7} color={0xffa858} />

      <group ref={grupo}>
        <mesh geometry={tejido.dendritas} onPointerDown={alApuntar}>
          {/* `vertexColors` es lo que deja convivir las dos familias en una malla. */}
          <meshStandardMaterial
            vertexColors
            emissive={BRILLO_INTERNO}
            emissiveIntensity={1.2}
            roughness={0.34}
            metalness={0}
            transparent
            opacity={0.95}
          />
        </mesh>

        {tejido.somas.map((soma, i) => (
          <mesh
            key={i}
            geometry={soma.geometria}
            position={[soma.posicion.x, soma.posicion.y, soma.posicion.z]}
          >
            {/*
              El cuerpo lleva el color de su familia y el núcleo va encendido
              aparte: eso es lo que hace que el soma se lea como una célula viva
              y no como una bolita del color del cable.
            */}
            <meshStandardMaterial
              color={soma.color}
              emissive={soma.nucleo}
              emissiveIntensity={0.24}
              roughness={0.3}
              metalness={0}
            />
          </mesh>
        ))}

        <points geometry={geometriaSinapsis}>
          <pointsMaterial
            vertexColors
            size={0.16}
            map={halo}
            transparent
            blending={AdditiveBlending}
            depthWrite={false}
            sizeAttenuation
          />
        </points>

        <points geometry={geometriaSenales}>
          <pointsMaterial
            color={0xffd28a}
            size={0.09}
            map={halo}
            transparent
            opacity={0.9}
            blending={AdditiveBlending}
            depthWrite={false}
            sizeAttenuation
          />
        </points>

        {/*
          Las motas van FUERA de la niebla conceptualmente: son partículas
          sueltas en el medio, no tejido. Las grandes llevan poca opacidad
          porque simulan estar fuera de foco, no cerca de una fuente de luz.
        */}
        <points geometry={geometriaMotas}>
          <pointsMaterial
            color={MOTA}
            size={0.05}
            map={halo}
            transparent
            opacity={0.75}
            blending={AdditiveBlending}
            depthWrite={false}
            sizeAttenuation
          />
        </points>

        <points geometry={geometriaMotasGrandes}>
          <pointsMaterial
            color={MOTA}
            size={0.42}
            map={halo}
            transparent
            opacity={0.16}
            blending={AdditiveBlending}
            depthWrite={false}
            sizeAttenuation
          />
        </points>
      </group>

    </>
  );
}

/**
 * Tejido neuronal de fondo para el login.
 *
 * El tejido gira solo y no se arrastra. Lo que sí responde es la rueda, para
 * acercarse y alejarse, y el clic, que dispara un chispazo por las dendritas de
 * alrededor.
 *
 * La rueda se escucha acá afuera y no adentro de la escena: el `div` cubre toda
 * la pantalla, así que agarra el gesto aunque el puntero esté sobre un hueco
 * entre dendritas, donde un `onWheel` en la malla no se enteraría.
 */
export function NeuralTissue() {
  const gesto = useRef<Gesto>({
    arrastrando: false,
    dx: 0,
    dy: 0,
    x: 0,
    y: 0,
    recorrido: 0,
    zoom: ZOOM_BASE,
    candidato: null,
    disparo: null,
  });

  const contenedor = useRef<HTMLDivElement>(null);
  const [niebla, setNiebla] = useState(NIEBLA_POR_DEFECTO);

  // El color lo decide el CSS, no este archivo: acá sólo se lo lee. Va en un
  // efecto porque la variable se hereda del contenedor, y el nodo no existe
  // hasta después del primer render.
  useEffect(() => {
    const nodo = contenedor.current;
    if (!nodo) return;
    const valor = getComputedStyle(nodo).getPropertyValue('--tissue-fog').trim();
    if (valor) setNiebla(new Color(valor).getHex());
  }, []);

  const reducido =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const alApretar = (evento: PointerEvent<HTMLDivElement>) => {
    // La captura hace que el arrastre siga funcionando aunque el puntero salga
    // de la ventana, que es lo que uno espera al girar algo con el mouse.
    evento.currentTarget.setPointerCapture(evento.pointerId);
    const g = gesto.current;
    g.arrastrando = true;
    g.recorrido = 0;
    g.dx = 0;
    g.dy = 0;
    g.x = evento.clientX;
    g.y = evento.clientY;
  };

  const alMover = (evento: PointerEvent<HTMLDivElement>) => {
    const g = gesto.current;
    if (!g.arrastrando) return;
    // El delta se calcula a mano y no con `movementX`, que en algunos
    // navegadores llega en cero en el primer movimiento tras capturar.
    const dx = evento.clientX - g.x;
    const dy = evento.clientY - g.y;
    g.x = evento.clientX;
    g.y = evento.clientY;
    g.dx += dx;
    g.dy += dy;
    g.recorrido += Math.abs(dx) + Math.abs(dy);
  };

  const alSoltar = (evento: PointerEvent<HTMLDivElement>) => {
    const g = gesto.current;
    g.arrastrando = false;
    if (g.recorrido < TOLERANCIA_CLIC && g.candidato) g.disparo = g.candidato;
    g.candidato = null;
    if (evento.currentTarget.hasPointerCapture(evento.pointerId)) {
      evento.currentTarget.releasePointerCapture(evento.pointerId);
    }
  };

  const alRodar = (evento: WheelEvent<HTMLDivElement>) => {
    const g = gesto.current;
    g.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_BASE, g.zoom + evento.deltaY * ZOOM_PASO));
  };

  return (
    <div
      ref={contenedor}
      className={styles.fondo}
      aria-hidden="true"
      onPointerDown={alApretar}
      onPointerMove={alMover}
      onPointerUp={alSoltar}
      onPointerCancel={alSoltar}
      onWheel={alRodar}
    >
      <Canvas
        camera={{ position: [0, 0, ZOOM_BASE], fov: 58, near: 0.05, far: 14 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        frameloop={reducido ? 'demand' : 'always'}
      >
        <Tejido gesto={gesto} niebla={niebla} />
      </Canvas>
    </div>
  );
}
