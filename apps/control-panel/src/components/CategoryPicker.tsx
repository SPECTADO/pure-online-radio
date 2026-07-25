import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ALL_CATEGORY_NAME, type CategoryDTO } from "@spectado/shared-types";
import { apiClient } from "../lib/apiClient";
import { showToast } from "../lib/toastStore";

interface CategoryPickerProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

/** Checkbox list of user-defined categories, plus inline "create category".
 * The "ALL" category is deliberately hidden here -- every song/jingle is
 * always attached to it automatically server-side, so it's never a user
 * choice (see ads.routes.ts / songs.routes.ts resolveCategoryIds). */
export function CategoryPicker({ selectedIds, onChange }: CategoryPickerProps) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["library", "categories"],
    queryFn: () => apiClient.get<CategoryDTO[]>("/library/categories"),
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => apiClient.post<CategoryDTO>("/library/categories", { name }),
    onSuccess: (category) => {
      queryClient.invalidateQueries({ queryKey: ["library", "categories"] });
      onChange([...selectedIds, category.id]);
      setNewName("");
      setError(null);
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Couldn't create category";
      setError(message);
      showToast("error", message);
    },
  });

  const categories = (query.data ?? []).filter((c) => c.name !== ALL_CATEGORY_NAME);

  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((i) => i !== id) : [...selectedIds, id]);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {query.isError && <p className="text-sm text-red-600">Couldn't load categories.</p>}
        {categories.length === 0 && !query.isLoading && !query.isError && (
          <p className="text-sm text-slate-400">No categories yet -- add one below.</p>
        )}
        {categories.map((category) => (
          <label
            key={category.id}
            className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${
              selectedIds.includes(category.id)
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
          >
            <input
              type="checkbox"
              className="hidden"
              checked={selectedIds.includes(category.id)}
              onChange={() => toggle(category.id)}
            />
            {category.name}
          </label>
        ))}
      </div>

      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New category name"
          className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
        <button
          type="button"
          disabled={!newName.trim() || createMutation.isPending}
          onClick={() => createMutation.mutate(newName.trim())}
          className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          + Add
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <p className="mt-1 text-xs text-slate-400">Always also added to "{ALL_CATEGORY_NAME}".</p>
    </div>
  );
}
