import {
  createContext,
  useCallback,
  useMemo,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import styles from './Toast.module.css';

type ToastVariant = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  variant: ToastVariant;
  message: string;
  exiting: boolean;
}

interface ToastContextValue {
  toast: {
    success: (message: string) => void;
    error: (message: string) => void;
    info: (message: string) => void;
  };
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastVariant, string> = {
  success: '✓',
  error: '✕',
  info: 'i',
};

const AUTO_DISMISS_MS = 4000;
const EXIT_ANIMATION_MS = 300;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
    );
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, EXIT_ANIMATION_MS);
  }, []);

  const addToast = useCallback(
    (variant: ToastVariant, message: string) => {
      const id = ++counterRef.current;
      setToasts((prev) => [...prev, { id, variant, message, exiting: false }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  /*
   * `toast` y el valor del contexto se memorizan, y no es cosmetico.
   *
   * Creados en cada render, cada aviso que aparece o desaparece le entrega un
   * objeto nuevo a TODOS los consumidores: se re-renderizan aunque no tengan
   * nada que ver, y cualquier efecto que dependa de `toast` vuelve a correr.
   *
   * Por eso media docena de pantallas omitian `toast` de sus dependencias para
   * no entrar en bucle. Omitirlo callaba al linter y dejaba al efecto mintiendo
   * sobre de que depende.
   */
  const toast = useMemo(
    () => ({
      success: (message: string) => addToast('success', message),
      error: (message: string) => addToast('error', message),
      info: (message: string) => addToast('info', message),
    }),
    [addToast],
  );

  const valor = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={valor}>
      {children}
      {createPortal(
        <div className={styles.container} aria-live="polite" aria-atomic="false">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={[
                styles.toast,
                styles[t.variant],
                t.exiting ? styles.exiting : '',
              ]
                .filter(Boolean)
                .join(' ')}
              role="alert"
            >
              <span className={styles.icon}>{ICONS[t.variant]}</span>
              <p className={styles.message}>{t.message}</p>
              <button
                className={styles.close}
                onClick={() => dismiss(t.id)}
                aria-label="Cerrar notificación"
              >
                ✕
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return ctx;
}
