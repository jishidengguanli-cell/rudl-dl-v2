'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n/provider';

type MemberSummary = {
  id: string;
  email: string | null;
  role: string | null;
  balance: number | null;
  createdAt: number;
};

type Feedback = { type: 'success' | 'error'; message: string };

const parseNumberInput = (value: string): number | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

export default function MemberActionsCell({ member }: { member: MemberSummary }) {
  const { t } = useI18n();
  const router = useRouter();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [role, setRole] = useState<'user' | 'admin'>(
    (member.role ?? '').toLowerCase() === 'admin' ? 'admin' : 'user'
  );
  const [setBalanceInput, setSetBalanceInput] = useState('');
  const [adjustBalanceInput, setAdjustBalanceInput] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(timer);
  }, [feedback]);

  const openEditModal = () => {
    setRole((member.role ?? '').toLowerCase() === 'admin' ? 'admin' : 'user');
    setSetBalanceInput(
      typeof member.balance === 'number' && Number.isFinite(member.balance)
        ? String(member.balance)
        : ''
    );
    setAdjustBalanceInput('');
    setEditError(null);
    setEditOpen(true);
  };

  const closeEditModal = () => {
    if (editLoading) return;
    setEditOpen(false);
  };

  const closeDeleteModal = () => {
    if (deleteLoading) return;
    setDeleteOpen(false);
  };

  const submitEdit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEditLoading(true);
    setEditError(null);
    try {
      const setValue = parseNumberInput(setBalanceInput);
      const adjustValue = parseNumberInput(adjustBalanceInput);

      const payload: Record<string, unknown> = { role };
      if (setValue !== null) payload.setBalance = setValue;
      if (adjustValue !== null && adjustValue !== 0) payload.adjustBalance = adjustValue;

      const response = await fetch(`/api/admin/members/${encodeURIComponent(member.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!response.ok || !data?.ok) {
        const errorMessage =
          typeof data?.error === 'string'
            ? data.error
            : t('members.feedback.updateError') ?? 'Failed to update.';
        setEditError(errorMessage);
        return;
      }
      setEditOpen(false);
      setFeedback({
        type: 'success',
        message: t('members.feedback.updateSuccess') ?? 'Member updated.',
      });
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? 'UPDATE_FAILED');
      setEditError(message);
    } finally {
      setEditLoading(false);
    }
  };

  const confirmDelete = async () => {
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/admin/members/${encodeURIComponent(member.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!response.ok || !data?.ok) {
        const errorMessage =
          typeof data?.error === 'string'
            ? data.error
            : t('members.feedback.deleteError') ?? 'Failed to delete.';
        setDeleteError(errorMessage);
        return;
      }
      setDeleteOpen(false);
      setFeedback({
        type: 'success',
        message: t('members.feedback.deleteSuccess') ?? 'Member deleted.',
      });
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? 'DELETE_FAILED');
      setDeleteError(message);
    } finally {
      setDeleteLoading(false);
    }
  };

  const formattedEmail = useMemo(() => member.email ?? '-', [member.email]);

  return (
    <div className="flex flex-col gap-2">
      {feedback ? (
        <p
          className={`text-xs ${
            feedback.type === 'success' ? 'text-green-600' : 'text-red-600'
          }`}
        >
          {feedback.message}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
          onClick={openEditModal}
        >
          {t('members.action.edit') ?? 'Edit'}
        </button>
        <button
          type="button"
          className="rounded border border-red-400 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
          onClick={() => {
            setDeleteError(null);
            setDeleteOpen(true);
          }}
        >
          {t('members.action.delete') ?? 'Delete'}
        </button>
      </div>

      {editOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
            <h2 className="text-lg font-semibold text-gray-900">
              {t('members.edit.title') ?? 'Edit member'}
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              {formattedEmail}
            </p>
            <form className="mt-4 space-y-4" onSubmit={submitEdit}>
              <label className="block text-sm font-medium text-gray-700">
                {t('members.edit.roleLabel') ?? 'Role'}
                <select
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={role}
                  onChange={(event) =>
                    setRole(event.target.value === 'admin' ? 'admin' : 'user')
                  }
                  disabled={editLoading}
                >
                  <option value="user">{t('members.edit.role.user') ?? 'User'}</option>
                  <option value="admin">
                    {t('members.edit.role.admin') ?? 'Administrator'}
                  </option>
                </select>
              </label>
              <label className="block text-sm font-medium text-gray-700">
                {t('members.edit.balanceSet') ?? 'Set balance to'}
                <input
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  type="number"
                  step="any"
                  value={setBalanceInput}
                  onChange={(event) => setSetBalanceInput(event.target.value)}
                  disabled={editLoading}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                {t('members.edit.balanceAdjust') ?? 'Adjust balance by'}
                <input
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  type="number"
                  step="any"
                  value={adjustBalanceInput}
                  onChange={(event) => setAdjustBalanceInput(event.target.value)}
                  disabled={editLoading}
                />
              </label>
              {editError ? (
                <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {editError}
                </p>
              ) : null}
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  className="text-sm text-gray-500 hover:text-gray-700"
                  onClick={closeEditModal}
                  disabled={editLoading}
                >
                  {t('members.edit.cancel') ?? 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                  disabled={editLoading}
                >
                  {editLoading
                    ? '...'
                    : t('members.edit.submit') ?? 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {deleteOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
            <h2 className="text-lg font-semibold text-gray-900">
              {t('members.delete.confirmTitle') ?? 'Delete member'}
            </h2>
            <p className="mt-3 text-sm text-gray-700">
              {t('members.delete.confirmMessage') ??
                'This will permanently remove the member and all related data. Continue?'}
            </p>
            {deleteError ? (
              <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {deleteError}
              </p>
            ) : null}
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                className="text-sm text-gray-500 hover:text-gray-700"
                onClick={closeDeleteModal}
                disabled={deleteLoading}
              >
                {t('members.delete.cancel') ?? 'Cancel'}
              </button>
              <button
                type="button"
                className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                onClick={confirmDelete}
                disabled={deleteLoading}
              >
                {deleteLoading ? '...' : t('members.delete.confirmAction') ?? 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
