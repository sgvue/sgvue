// Drag-to-reorder for the column list and the sort levels.
//
// The hover cue is written straight onto DOM classes and NEVER into AppState. That is the
// whole trick: state changes repaint the pane with innerHTML, and a repaint in the middle
// of a drag destroys the node being dragged. Only the drop mutates state.

const CUES = ['lifting', 'over-up', 'over-down'];

/** Draggable rows carry data-drag="<kind>" and data-i="<position>". */
function rowAt(target: EventTarget | null): HTMLElement | null {
  return (target as HTMLElement | null)?.closest<HTMLElement>('[data-drag][data-i]') ?? null;
}

const indexOf = (el: HTMLElement) => Number(el.dataset.i ?? -1);

function clearCues(root: HTMLElement) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-drag]')) el.classList.remove(...CUES);
}

export function wireReorder(root: HTMLElement, move: (kind: string, from: number, to: number) => void) {
  let held: { kind: string; from: number } | null = null;

  root.addEventListener('dragstart', (e) => {
    const el = rowAt(e.target);
    if (!el) return;
    held = { kind: el.dataset.drag ?? '', from: indexOf(el) };
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      // Safari refuses the drag without payload; the index is carried in `held` anyway.
      try { e.dataTransfer.setData('text/plain', String(held.from)); } catch { /* ignore */ }
    }
    el.classList.add('lifting');
  });

  root.addEventListener('dragover', (e) => {
    if (!held) return;
    const el = rowAt(e.target);
    if (!el || el.dataset.drag !== held.kind) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const to = indexOf(el);
    for (const other of root.querySelectorAll<HTMLElement>('[data-drag]')) {
      other.classList.remove('over-up', 'over-down');
    }
    // The line sits on the side the row is travelling from, so it reads as an insertion point.
    if (to !== held.from) el.classList.add(held.from > to ? 'over-up' : 'over-down');
  });

  root.addEventListener('drop', (e) => {
    const el = rowAt(e.target);
    if (!held || !el || el.dataset.drag !== held.kind) return;
    e.preventDefault();
    const to = indexOf(el);
    const { kind, from } = held;
    held = null;
    clearCues(root);
    if (to >= 0 && from >= 0 && to !== from) move(kind, from, to);
  });

  root.addEventListener('dragend', () => { held = null; clearCues(root); });

  // Keyboard equivalent: focus a grab handle and use the arrow keys.
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const handle = (e.target as HTMLElement | null)?.closest<HTMLElement>('.handle');
    const row = handle && rowAt(handle);
    if (!handle || !row) return;
    e.preventDefault();
    const kind = row.dataset.drag ?? '';
    const from = indexOf(row);
    const to = from + (e.key === 'ArrowUp' ? -1 : 1);
    move(kind, from, to);
    // move() repaints synchronously, so the old handle is gone. Focus must follow the ITEM
    // to its new index — the generic focus restore follows the old INDEX, which is now the
    // neighbour that slid into it, and a second arrow press would move the wrong row back.
    root.querySelector<HTMLElement>(`[data-drag="${kind}"][data-i="${to}"] .handle`)?.focus();
  });
}

/** Move one item, leaving the array unchanged when the target is out of range. */
export function moveItem<T>(list: T[], from: number, to: number): boolean {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return false;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return true;
}
