/**
 * TSUZUKU — 備え Backup and restore (group A, design 07 §5, 06 §7 #10).
 *
 * Export: `exportSave()` (B) → one JSON file named tsuzuku-backup-YYYY-MM-DD.json
 * (gzip when `CompressionStream` exists and the learner asks) → a download;
 * the store emits `backup:exported` and counts `stats.exports`. Import: a
 * file picker → `previewImportBlob()` → a diff summary (streak max, XP max,
 * collections union, cards newer-wins, ledger union) → Merge, or Replace
 * after a confirm → `applyImport()` → reload hint. An unreadable file shows
 * one calm line and changes nothing. The storage meter mirrors `store.storage`.
 */
import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { href, type Route } from '@/shared/routes';
import { epochDay, isoDate } from '@/shared/time';
import { CEILING_BYTES, WARN_BYTES, applyImport, exportSave, previewImportBlob, store, type ImportPreview } from '@/store';
import { S, fmt, num } from './strings';
import './pages.css';

export interface BackupPageProps {
  route: Route;
  /** Download hook (tests inject a spy); defaults to `downloadBlob`. */
  download?: (blob: Blob, filename: string) => Promise<boolean> | boolean;
  /** Defaults to `location.reload()`. */
  reload?: () => void;
}

type Phase = { kind: 'idle' } | { kind: 'exporting' } | { kind: 'reading' } | { kind: 'preview'; preview: ImportPreview; file: string; bytes: number } | { kind: 'applied' } | { kind: 'applying' };

/* ────────────────────────────────────────────────────────────────────────── */
/* Helpers (exported for tests)                                               */
/* ────────────────────────────────────────────────────────────────────────── */

export function hasCompressionStream(): boolean {
  return typeof CompressionStream !== 'undefined';
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(blob);
  });
}

/**
 * Offers `blob` as a download named `filename`. Uses an object URL where the
 * platform has one and a data URL otherwise (old WebViews, jsdom). `false`
 * when the document is unavailable or the anchor could not be created.
 */
export async function downloadBlob(blob: Blob, filename: string, doc: Document | null = typeof document !== 'undefined' ? document : null): Promise<boolean> {
  if (!doc || !doc.body) return false;
  try {
    const objectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
    const url = objectUrl ? URL.createObjectURL(blob) : await readDataUrl(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    doc.body.appendChild(a);
    a.click();
    a.remove();
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

export function kbOf(bytes: number): number {
  return Math.round(bytes / 1024);
}

export function storageLevelText(level: 'ok' | 'warn' | 'ceiling'): string {
  return level === 'ceiling' ? S.setStorageLevelCeiling : level === 'warn' ? S.setStorageLevelWarn : S.setStorageLevelOk;
}

function defaultReload(): void {
  if (typeof location !== 'undefined') location.reload();
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Sub-views                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

function StorageMeter(): JSX.Element {
  const st = store.storage.value;
  const ratio = Math.min(1, st.bytes / CEILING_BYTES);
  return (
    <section class="panel page__section set__meter" data-level={st.level} data-storage aria-labelledby="bak-storage">
      <h2 id="bak-storage">{S.bakStorageTitle}</h2>
      <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-label={S.setStorage}>
        <div class="progress__fill" style={{ width: `${Math.max(1, ratio * 100)}%` }} />
      </div>
      <span data-storage-text>
        {fmt(S.setStorageOf, { kb: num(kbOf(st.bytes)), mb: (CEILING_BYTES / (1024 * 1024)).toFixed(1) })}
        {S.separator}
        {storageLevelText(st.level)}
      </span>
      <span class="field__hint">
        {fmt(S.setStorageOf, { kb: num(kbOf(WARN_BYTES)), mb: (CEILING_BYTES / (1024 * 1024)).toFixed(1) })}
        {S.separator}
        {S.bakAdvice}
      </span>
    </section>
  );
}

function PreviewTable(p: { preview: ImportPreview }): JSX.Element {
  const s = p.preview.summary;
  const rows: [string, [number, number]][] = [
    [S.bakPreviewStreak, s.streak],
    [S.bakPreviewXp, s.xp],
    [S.bakPreviewCards, s.cards],
    [S.bakPreviewBadges, s.badges],
    [S.bakPreviewDays, s.days],
  ];
  return (
    <table class="bak__table" data-preview-table>
      <thead>
        <tr>
          <th scope="col">{S.bakPreviewTitle}</th>
          <th scope="col">{S.bakPreviewCurrent}</th>
          <th scope="col">{S.bakPreviewFile}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, [here, file]]) => (
          <tr key={label} data-row={label}>
            <th scope="row">{label}</th>
            <td>{num(here)}</td>
            <td>{num(file)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Page                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export default function BackupPage(p: BackupPageProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [gzip, setGzip] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [errors, setErrors] = useState<string[]>([]);
  const [replaceAsk, setReplaceAsk] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const download = p.download ?? downloadBlob;
  const reload = p.reload ?? defaultReload;
  const busy = phase.kind === 'exporting' || phase.kind === 'reading' || phase.kind === 'applying';

  const doExport = async (): Promise<void> => {
    if (busy) return;
    setErrors([]);
    setStatus('');
    setPhase({ kind: 'exporting' });
    try {
      const { blob, filename } = await exportSave({ gzip: gzip && hasCompressionStream() });
      const ok = await download(blob, filename);
      setStatus(ok ? S.bakExported : S.bakDownloadFailed);
    } catch (err) {
      console.warn('[backup] export failed', err);
      setStatus(S.bakDownloadFailed);
    }
    setPhase({ kind: 'idle' });
  };

  const onFile = async (e: JSX.TargetedEvent<HTMLInputElement, Event>): Promise<void> => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    setErrors([]);
    setStatus('');
    setReplaceAsk(false);
    setPhase({ kind: 'reading' });
    try {
      const preview = await previewImportBlob(file);
      if (!preview.valid) {
        setErrors(preview.errors.length > 0 ? preview.errors : [S.bakInvalid]);
        setPhase({ kind: 'idle' });
        return;
      }
      setPhase({ kind: 'preview', preview, file: file.name, bytes: file.size });
    } catch (err) {
      console.warn('[backup] read failed', err);
      setErrors([S.bakReadError]);
      setPhase({ kind: 'idle' });
    }
  };

  const apply = (mode: 'merge' | 'replace'): void => {
    if (phase.kind !== 'preview') return;
    setReplaceAsk(false);
    setPhase({ kind: 'applying' });
    const ok = applyImport(phase.preview, mode);
    if (ok) {
      setStatus(S.bakApplied);
      setPhase({ kind: 'applied' });
    } else {
      setErrors([S.bakInvalid]);
      setPhase({ kind: 'idle' });
    }
  };

  const cancelPreview = (): void => {
    setReplaceAsk(false);
    setPhase({ kind: 'idle' });
  };

  return (
    <div class="page backup">
      <h1 class="page__title">
        <span class="page__title-ja brush" lang="ja">
          {S.bakTitleJa}
        </span>
        <span>{S.bakTitle}</span>
      </h1>
      <p class="page__lead">{S.bakIntro}</p>

      {/* ── Export ────────────────────────────────────────────────────── */}
      <section class="panel page__section" aria-labelledby="bak-export">
        <h2 id="bak-export">{S.bakExport}</h2>
        <p class="muted">{S.bakExportHint}</p>
        {hasCompressionStream() ? (
          <label class="switch">
            <input type="checkbox" checked={gzip} onChange={(e) => setGzip(e.currentTarget.checked)} data-gzip />
            <span>{S.bakExportGzip}</span>
          </label>
        ) : null}
        <div class="page__actions">
          <button type="button" class="hanko" onClick={() => void doExport()} disabled={busy} data-export>
            {phase.kind === 'exporting' ? S.bakExporting : S.bakExport}
          </button>
          <span class="page__status" role="status" data-export-status>
            {phase.kind === 'applied' || phase.kind === 'preview' ? '' : status}
          </span>
        </div>
      </section>

      {/* ── Import ────────────────────────────────────────────────────── */}
      <section class="panel page__section" aria-labelledby="bak-import">
        <h2 id="bak-import">{S.bakImport}</h2>
        <p class="muted">{S.bakImportHint}</p>
        <div class="bak__file">
          <div class="page__actions">
            <button type="button" class="btn" onClick={() => fileRef.current?.click()} disabled={busy} data-choose-file>
              {S.bakChooseFile}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.gz,application/json,application/gzip"
              aria-label={S.bakChooseFile}
              onChange={(e) => void onFile(e)}
              data-file-input
            />
            {phase.kind === 'reading' ? (
              <span class="page__status" role="status">
                {S.bakReading}
              </span>
            ) : null}
          </div>
          {errors.length > 0 ? (
            <div class="notice notice--warn" role="alert" data-import-error>
              {errors.map((e) => (
                <p key={e} class="page__modal-text">
                  {e}
                </p>
              ))}
            </div>
          ) : null}
        </div>

        {phase.kind === 'preview' ? (
          <div class="status-window page__section" data-import-preview>
            <p class="muted">
              {fmt(S.bakFileLine, { name: phase.file, kb: num(kbOf(phase.bytes)) })}
              {phase.preview.exportedAt !== undefined ? `${S.separator}${fmt(S.bakExportedAt, { date: isoDate(epochDay(phase.preview.exportedAt, 'UTC')) })}` : ''}
            </p>
            <PreviewTable preview={phase.preview} />
            <p class="muted">
              {fmt(S.bakCardsGained, { n: num(phase.preview.summary.cardsGained) })}
              {S.separator}
              {fmt(S.bakCardsLost, { n: num(phase.preview.summary.cardsLost) })}
            </p>
            {phase.preview.warnings.length > 0 ? (
              <div>
                <span class="field__label">{S.bakWarnings}</span>
                <ul class="bak__notes">
                  {phase.preview.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div class="page__actions">
              <button type="button" class="hanko" onClick={() => apply('merge')} data-merge>
                {S.bakMerge}
              </button>
              <button type="button" class="btn btn--danger" onClick={() => setReplaceAsk(true)} data-replace>
                {S.bakReplace}
              </button>
              <button type="button" class="btn btn--ghost" onClick={cancelPreview} data-cancel-import>
                {S.bakCancel}
              </button>
            </div>
            <p class="field__hint">{S.bakMergeHint}</p>
            <p class="field__hint">{S.bakReplaceHint}</p>
          </div>
        ) : null}

        {replaceAsk && phase.kind === 'preview' ? (
          <div class="modal" role="dialog" aria-modal="true" aria-label={S.bakReplaceConfirm} data-confirm="replace">
            <div class="modal__card">
              <p class="page__modal-text">{S.bakReplaceConfirm}</p>
              <p class="field__hint">{S.bakReplaceHint}</p>
              <div class="modal__actions page__actions">
                <button type="button" class="btn btn--danger" onClick={() => apply('replace')} data-confirm-yes>
                  {S.bakReplace}
                </button>
                <button type="button" class="btn btn--ghost" onClick={() => setReplaceAsk(false)} data-confirm-no>
                  {S.bakCancel}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {phase.kind === 'applied' ? (
          <div class="notice page__section" role="status" data-import-applied>
            <p class="page__modal-text">
              <strong>{S.bakApplied}</strong> {S.reloadHint}
            </p>
            <div class="page__actions">
              <button type="button" class="hanko" onClick={reload} data-reload>
                {S.reloadNow}
              </button>
              <a class="btn btn--ghost" href={href({ name: 'dojo' })}>
                {S.backToDojo}
              </a>
            </div>
          </div>
        ) : null}
      </section>

      <StorageMeter />
    </div>
  );
}
