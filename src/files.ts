import { computed, effect, signal } from '@preact/signals';
import { currentName, restore, showToast, snapshot } from './state';
import type { Snapshot } from './state';

/**
 * Saving the canvas to a file on disk and opening it again. Where the browser allows writing
 * files (Chrome, Edge), the file stays connected: Ctrl+S writes into it again and it can be kept
 * up to date automatically. Elsewhere the file is downloaded.
 */

const EXT = '.nanotrees';

interface FileFormat {
  app: 'NanoTrees';
  version: 1;
  savedAt: string;
  canvas: Snapshot;
}

// File System Access API (not in TypeScript's DOM types yet)
interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}
type Picker = {
  showSaveFilePicker?: (o: { suggestedName?: string; types?: PickerType[] }) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (o: { types?: PickerType[]; multiple?: boolean }) => Promise<FileSystemFileHandle[]>;
};
const picker = (): Picker => (typeof window === 'undefined' ? {} : (window as unknown as Picker));
const TYPES: PickerType[] = [{ description: 'NanoTrees canvas', accept: { 'application/json': [EXT, '.json'] } }];

export const canWriteFiles = () => typeof picker().showSaveFilePicker === 'function';

/** the file the canvas is connected to */
export const fileHandle = signal<FileSystemFileHandle | null>(null);
/** name of the file last saved or opened */
export const fileName = signal<string | null>(null);
/** the canvas as it is in that file */
const savedJson = signal<string | null>(null);
/** keep writing changes into the connected file */
export const autoSaveFile = signal(false);

const current = () => JSON.stringify(snapshot(true));
export const unsaved = computed(() => fileName.value !== null && savedJson.value !== current());

function fileText(): string {
  const data: FileFormat = { app: 'NanoTrees', version: 1, savedAt: new Date().toISOString(), canvas: snapshot(true) };
  return JSON.stringify(data, null, 2) + '\n';
}

function suggestedName(): string {
  const base = (fileName.value ?? currentName.value ?? 'trees').replace(/\.nanotrees$|\.json$/i, '');
  return (base.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'trees') + EXT;
}

const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError';

async function write(handle: FileSystemFileHandle, text: string) {
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}

/** Save to disk: into the connected file, or a new one (saveAs, or nothing connected yet). */
export async function saveToDisk(saveAs = false) {
  const text = fileText();
  const json = current();
  try {
    const p = picker();
    if (p.showSaveFilePicker) {
      let h = fileHandle.value;
      if (!h || saveAs) h = await p.showSaveFilePicker({ suggestedName: suggestedName(), types: TYPES });
      await write(h, text);
      fileHandle.value = h;
      fileName.value = h.name;
    } else {
      const name = suggestedName();
      download(text, name);
      fileName.value = name;
    }
    savedJson.value = json;
    showToast(`Saved to ${fileName.value}`);
  } catch (e) {
    if (!isAbort(e)) showToast(`Could not save the file: ${(e as Error).message ?? e}`);
  }
}

/** Open a file from disk (a saved canvas, or plain bracket code). */
export async function openFromDisk() {
  if (unsaved.value && !confirm(`${fileName.value} has unsaved changes. Open another file anyway?`)) return;
  try {
    const p = picker();
    if (p.showOpenFilePicker) {
      const [h] = await p.showOpenFilePicker({ types: [...TYPES, { description: 'Bracket code', accept: { 'text/plain': ['.txt', '.tree'] } }], multiple: false });
      if (!h) return;
      const ok = await loadFile(await h.getFile());
      // only a saved canvas is written back into its file
      fileHandle.value = ok === 'canvas' && h.name.endsWith(EXT) ? h : null;
      return;
    }
    const file = await chooseFile();
    if (file) await loadFile(file);
  } catch (e) {
    if (!isAbort(e)) showToast(`Could not open the file: ${(e as Error).message ?? e}`);
  }
}

function chooseFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${EXT},.json,.txt,.tree,application/json,text/plain`;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Read a file into the canvas. Returns what it was. */
export async function loadFile(file: File): Promise<'canvas' | 'code' | null> {
  const text = await file.text();
  const kind = loadText(text);
  if (!kind) {
    showToast(`${file.name} is not a NanoTrees file or bracket code.`);
    return null;
  }
  fileHandle.value = null;
  fileName.value = file.name;
  currentName.value = file.name.replace(/\.nanotrees$|\.json$|\.txt$|\.tree$/i, '');
  savedJson.value = kind === 'canvas' ? current() : null;
  showToast(`Opened ${file.name}`);
  return kind;
}

/** A saved canvas (JSON), or bracket code as a single tree. */
export function loadText(text: string): 'canvas' | 'code' | null {
  const t = text.trim();
  if (t.startsWith('{')) {
    try {
      const data = JSON.parse(t) as Partial<FileFormat> & Partial<Snapshot>;
      const snap = data.canvas ?? (typeof data.s === 'string' ? (data as Snapshot) : null);
      if (!snap || typeof snap.s !== 'string') return null;
      restore(snap);
      return 'canvas';
    } catch {
      return null;
    }
  }
  if (!t.startsWith('[') && !t.startsWith('%')) return null;
  restore({ s: text });
  return 'code';
}

export function download(data: string, filename: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// keep the connected file up to date
let timer: ReturnType<typeof setTimeout> | undefined;
effect(() => {
  const go = autoSaveFile.value && fileHandle.value && unsaved.value;
  clearTimeout(timer);
  if (!go) return;
  timer = setTimeout(async () => {
    const h = fileHandle.peek();
    if (!h) return;
    try {
      const json = current();
      await write(h, fileText());
      savedJson.value = json;
    } catch (e) {
      autoSaveFile.value = false;
      showToast(`Automatic saving stopped: ${(e as Error).message ?? e}`);
    }
  }, 800);
});
