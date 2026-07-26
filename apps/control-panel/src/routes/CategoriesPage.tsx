import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ALL_CATEGORY_NAME, type CategoryDTO } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { showToast } from "../lib/toastStore";
import { ComingSoon } from "../components/ComingSoon";
import { Modal } from "../components/Modal";
import { rowActionButton, rowActionButtonDanger } from "../lib/buttonStyles";

const CATEGORIES_KEY = ["library", "categories"];

const inputClass =
  "w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

export function CategoriesPage() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CategoryDTO | null>(null);

  const query = useQuery({
    queryKey: CATEGORIES_KEY,
    queryFn: () => apiClient.get<CategoryDTO[]>("/library/categories"),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => apiClient.post<CategoryDTO>("/library/categories", { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY });
      setNewName("");
      setCreateError(null);
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : "Couldn't create category";
      setCreateError(message);
      showToast("error", message);
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiClient.patch<CategoryDTO>(`/library/categories/${id}`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY });
      showToast("success", "Category renamed");
      setEditingId(null);
      setEditError(null);
    },
    onError: (err) => {
      setEditError(err instanceof ApiError ? err.message : "Couldn't rename category");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (category: CategoryDTO) => apiClient.delete(`/library/categories/${category.id}`),
    onSuccess: (_data, category) => {
      queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY });
      showToast("success", `Deleted "${category.name}"`);
      setPendingDelete(null);
    },
    onError: (err) => {
      showToast(
        "error",
        `Couldn't delete category: ${err instanceof ApiError ? err.message : "request failed"}`,
      );
    },
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    createMutation.mutate(newName.trim());
  }

  function startEditing(category: CategoryDTO) {
    setEditingId(category.id);
    setEditingName(category.name);
    setEditError(null);
  }

  function saveEditing(category: CategoryDTO) {
    const name = editingName.trim();
    if (!name || name === category.name) {
      setEditingId(null);
      return;
    }
    renameMutation.mutate({ id: category.id, name });
  }

  const categories = query.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Categories</h1>
      </div>

      <form onSubmit={handleCreate} className="flex max-w-md gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New category name"
          className={inputClass}
        />
        <button
          type="submit"
          disabled={!newName.trim() || createMutation.isPending}
          className="shrink-0 rounded-md bg-slate-900 px-4 py-1 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          + Add
        </button>
      </form>
      {createError && <p className="text-sm text-red-600">{createError}</p>}

      {query.isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {query.isError && !(query.error instanceof ApiError && query.error.isNotImplemented) && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load categories: {(query.error as Error).message}
        </div>
      )}

      {!query.isLoading && !query.isError && categories.length === 0 && (
        <ComingSoon title="No categories yet" detail="Create one above to start organizing songs, jingles, and ads." />
      )}

      {categories.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {categories.map((category) => {
                const isAll = category.name === ALL_CATEGORY_NAME;
                const isEditing = editingId === category.id;

                return (
                  <tr key={category.id}>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {isEditing ? (
                        <div className="flex max-w-xs flex-col gap-1">
                          <input
                            type="text"
                            autoFocus
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEditing(category);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            className={inputClass}
                          />
                          {editError && <p className="text-xs text-red-600">{editError}</p>}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          {category.name}
                          {isAll && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-500">
                              System
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => saveEditing(category)}
                              disabled={renameMutation.isPending}
                              className={rowActionButton}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className={rowActionButton}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          !isAll && (
                            <>
                              <button
                                type="button"
                                onClick={() => startEditing(category)}
                                className={rowActionButton}
                              >
                                Rename
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingDelete(category)}
                                className={rowActionButtonDanger}
                              >
                                Delete
                              </button>
                            </>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pendingDelete && (
        <Modal title="Delete category" onClose={() => setPendingDelete(null)}>
          <p className="text-sm text-slate-600">
            Delete "{pendingDelete.name}"? Songs, jingles, and ads currently in this category will simply lose it
            (they aren't deleted), and any clock-wheel step filtered to it will fall back to "all categories".
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => deleteMutation.mutate(pendingDelete)}
              disabled={deleteMutation.isPending}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete category"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
