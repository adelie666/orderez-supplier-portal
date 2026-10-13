import { onBeforeUnmount, onMounted, ref } from 'vue';

/** Altezza intestazione tabella Ant Design (riga th + bordo). */
const HEADER_HEIGHT = 41;
const MIN_BODY_HEIGHT = 160;

/**
 * Misura l'altezza disponibile per il corpo tabella a partire dalla card e dalla
 * barra filtri, cosi l'intestazione resta fissa e la barra di scorrimento
 * orizzontale rimane sempre raggiungibile.
 */
export function useTableAreaHeight() {
  const cardRef = ref<HTMLElement | null>(null);
  const filterRef = ref<HTMLElement | null>(null);
  const tableY = ref(320);
  let observer: ResizeObserver | null = null;

  function measure() {
    const card = cardRef.value;
    if (!card) return;
    const filters = filterRef.value?.offsetHeight ?? 0;
    tableY.value = Math.max(MIN_BODY_HEIGHT, Math.floor(card.clientHeight - filters - HEADER_HEIGHT));
  }

  onMounted(() => {
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      if (cardRef.value) observer.observe(cardRef.value);
      if (filterRef.value) observer.observe(filterRef.value);
    }
    window.addEventListener('resize', measure);
  });

  onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
    window.removeEventListener('resize', measure);
  });

  return { cardRef, filterRef, tableY, measure };
}
