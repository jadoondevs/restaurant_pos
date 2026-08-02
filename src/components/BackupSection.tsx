import { useEffect, useState, useCallback } from 'react';
import {
  HardDrive,
  Cloud,
  CloudOff,
  FolderOpen,
  RotateCcw,
  Upload,
  RefreshCw,
  Link,
  Unlink,
} from 'lucide-react';
import { api } from '@/services/api';
import { useToast } from '@/contexts/ToastContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Misc';
import type { BackupStatus, BackupRecord } from '@/types';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatTs(ts: string | null): string {
  if (!ts) return 'Never';
  return new Date(ts).toLocaleString();
}

export function BackupSection() {
  const { toast } = useToast();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);

  // Restore modal state.
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<BackupRecord | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([api.backupStatus(), api.backupList()]);
      setStatus(s);
      setBackups(b);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load backup status.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleBackupNow = async () => {
    setActionBusy(true);
    try {
      const result = await api.backupNow();
      toast(`Backup created: ${result.filename}`, 'success');
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Backup failed.', 'error');
    } finally {
      setActionBusy(false);
    }
  };

  const handleConnectCloud = async () => {
    setActionBusy(true);
    try {
      const account = await api.backupConnectCloud();
      toast(`Connected as ${(account as { email: string }).email}`, 'success');
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Connection failed.', 'error');
    } finally {
      setActionBusy(false);
    }
  };

  const handleDisconnectCloud = async () => {
    setActionBusy(true);
    try {
      await api.backupDisconnectCloud();
      toast('Google Drive disconnected.', 'success');
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Disconnect failed.', 'error');
    } finally {
      setActionBusy(false);
    }
  };

  const handleRetryUploads = async () => {
    setActionBusy(true);
    try {
      const result = await api.backupRetryUploads();
      toast(`Uploaded ${result.uploaded} of ${result.total} pending backups.`, 'success');
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Retry failed.', 'error');
    } finally {
      setActionBusy(false);
    }
  };

  const handleOpenFolder = async () => {
    try {
      await api.backupOpenFolder();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not open folder.', 'error');
    }
  };

  const handleScheduleChange = async (
    field: 'backupSchedule' | 'backupOnExit' | 'cloudBackupEnabled',
    value: string | boolean
  ) => {
    try {
      await api.backupUpdateSchedule({ [field]: value });
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to update schedule.', 'error');
    }
  };

  // Restore flow.
  const openRestoreModal = async () => {
    setSelectedBackup(null);
    setValidationError(null);
    setRestoreOpen(true);
  };

  const selectBackup = async (backup: BackupRecord) => {
    setSelectedBackup(backup);
    setValidationError(null);
    setValidating(true);
    try {
      const result = await api.backupValidate(backup.filePath);
      if (!result.valid) setValidationError(result.error ?? 'Invalid backup.');
    } catch (e) {
      setValidationError(e instanceof Error ? e.message : 'Validation failed.');
    } finally {
      setValidating(false);
    }
  };

  const confirmRestore = async () => {
    if (!selectedBackup || validationError) return;
    setRestoring(true);
    try {
      await api.backupRestore(selectedBackup.filePath);
      // App will restart — this line is never reached.
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Restore failed.', 'error');
      setRestoring(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <div className="flex items-center gap-2 text-slate-500">
          <Spinner className="h-5 w-5" />
          <span className="text-sm">Loading backup status...</span>
        </div>
      </Card>
    );
  }

  if (!status) return null;

  return (
    <>
      <Card>
        <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
          Backup &amp; Restore
        </h2>

        {/* Status grid */}
        <div className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <StatusItem
            label="Cloud Status"
            value={
              status.cloudConnected ? (
                <span className="flex items-center gap-1 text-emerald-600">
                  <Cloud size={14} /> Connected
                </span>
              ) : (
                <span className="flex items-center gap-1 text-slate-400">
                  <CloudOff size={14} /> Not connected
                </span>
              )
            }
          />
          {status.cloudAccount && (
            <StatusItem label="Cloud Account" value={status.cloudAccount.email} />
          )}
          <StatusItem label="Last Local Backup" value={formatTs(status.lastLocalBackup)} />
          <StatusItem label="Last Cloud Backup" value={formatTs(status.lastCloudBackup)} />
          <StatusItem
            label="Pending Uploads"
            value={
              status.pendingUploads > 0 ? (
                <span className="text-amber-600">{status.pendingUploads}</span>
              ) : (
                '0'
              )
            }
          />
          <StatusItem label="Database Size" value={formatBytes(status.dbSizeBytes)} />
          <StatusItem label="Local Backups" value={String(status.localBackupCount)} />
          <StatusItem
            label="Backup Folder"
            value={
              <span className="truncate text-xs text-slate-500" title={status.backupFolder}>
                {status.backupFolder}
              </span>
            }
          />
        </div>

        {/* Schedule config */}
        <div className="mb-4 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-slate-800 dark:text-slate-200">Backup Schedule</p>
              <p className="text-xs text-slate-500">How often automatic backups run.</p>
            </div>
            <select
              value={status.backupSchedule}
              onChange={(e) => handleScheduleChange('backupSchedule', e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="manual">Manual Only</option>
            </select>
          </div>

          <label className="flex items-center justify-between">
            <div>
              <p className="font-medium text-slate-800 dark:text-slate-200">Backup on Exit</p>
              <p className="text-xs text-slate-500">Create a backup when the app closes.</p>
            </div>
            <input
              type="checkbox"
              checked={status.backupOnExit}
              onChange={(e) => handleScheduleChange('backupOnExit', e.target.checked)}
              className="h-5 w-5 rounded border-slate-300"
            />
          </label>

          <label className="flex items-center justify-between">
            <div>
              <p className="font-medium text-slate-800 dark:text-slate-200">Cloud Backup</p>
              <p className="text-xs text-slate-500">Upload backups to {status.providerName}.</p>
            </div>
            <input
              type="checkbox"
              checked={status.cloudBackupEnabled}
              onChange={(e) => handleScheduleChange('cloudBackupEnabled', e.target.checked)}
              className="h-5 w-5 rounded border-slate-300"
            />
          </label>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
          <Button
            variant="primary"
            size="sm"
            onClick={handleBackupNow}
            disabled={actionBusy || status.isRunning}
          >
            {status.isRunning ? <Spinner className="h-4 w-4" /> : <HardDrive size={16} />}
            Backup Now
          </Button>

          <Button variant="secondary" size="sm" onClick={openRestoreModal} disabled={actionBusy}>
            <RotateCcw size={16} /> Restore Backup
          </Button>

          {status.cloudConnected ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDisconnectCloud}
              disabled={actionBusy}
            >
              <Unlink size={16} /> Disconnect Drive
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleConnectCloud}
              disabled={actionBusy}
            >
              <Link size={16} /> Connect Google Drive
            </Button>
          )}

          {status.pendingUploads > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRetryUploads}
              disabled={actionBusy}
            >
              <Upload size={16} /> Retry Uploads ({status.pendingUploads})
            </Button>
          )}

          <Button variant="ghost" size="sm" onClick={handleOpenFolder}>
            <FolderOpen size={16} /> Open Folder
          </Button>

          <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw size={16} /> Refresh
          </Button>
        </div>
      </Card>

      {/* Restore modal */}
      <Modal
        open={restoreOpen}
        title="Restore Backup"
        onClose={() => setRestoreOpen(false)}
        maxWidth="max-w-xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRestoreOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={confirmRestore}
              disabled={
                !selectedBackup || !!validationError || validating || restoring
              }
            >
              {restoring ? <Spinner className="h-4 w-4" /> : <RotateCcw size={16} />}
              Restore &amp; Restart
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Select a backup to restore. A safety backup of the current database will be
            created automatically before restoring. The application will restart.
          </p>

          {backups.length === 0 ? (
            <p className="text-sm text-slate-400">No local backups found.</p>
          ) : (
            <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
              {backups.map((b) => (
                <li
                  key={b.filePath}
                  onClick={() => selectBackup(b)}
                  className={`cursor-pointer px-4 py-3 text-sm transition hover:bg-slate-50 dark:hover:bg-slate-800 ${
                    selectedBackup?.filePath === b.filePath
                      ? 'bg-brand-50 dark:bg-brand-900/20'
                      : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {b.filename}
                    </span>
                    <span className="text-slate-400">{formatBytes(b.fileSizeBytes)}</span>
                  </div>
                  <div className="text-xs text-slate-400">{formatTs(b.createdAt)}</div>
                </li>
              ))}
            </ul>
          )}

          {validating && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner className="h-4 w-4" /> Validating backup...
            </div>
          )}

          {validationError && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
              {validationError}
            </div>
          )}

          {selectedBackup && !validationError && !validating && (
            <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
              Backup validated successfully. Ready to restore.
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

function StatusItem({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800">
      <p className="text-xs text-slate-400">{label}</p>
      <div className="mt-0.5 font-medium text-slate-800 dark:text-slate-200">{value}</div>
    </div>
  );
}
