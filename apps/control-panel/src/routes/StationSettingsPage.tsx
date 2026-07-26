import { type FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StationLinkDTO, StationLinkPlatform, StationSettingsDTO, TimeFormat } from "@spectado/shared-types";
import { StationLinkPlatformSchema } from "@spectado/shared-types";
import { apiClient, apiUrl, ApiError } from "../lib/apiClient";
import { showToast } from "../lib/toastStore";
import { rowActionButton, rowActionButtonDanger } from "../lib/buttonStyles";

// No baked-in width so callers can add their own (w-full, w-40, flex-1, ...)
// without a cascade conflict between two width utilities on the same element.
const fieldClass =
  "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";
const inputClass = `w-full ${fieldClass}`;
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

const PLATFORMS = StationLinkPlatformSchema.options;

const PLATFORM_LABELS: Record<StationLinkPlatform, string> = {
  WEBSITE: "Website",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  TWITTER: "Twitter / X",
  YOUTUBE: "YouTube",
  TIKTOK: "TikTok",
  EMAIL: "Email",
  OTHER: "Other",
};

export function StationSettingsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["settings", "station"],
    queryFn: () => apiClient.get<StationSettingsDTO>("/settings/station"),
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [links, setLinks] = useState<StationLinkDTO[]>([]);
  const [timeFormat, setTimeFormat] = useState<TimeFormat>("12h");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!logoFile) {
      setLogoPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(logoFile);
    setLogoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  // Seed local form state once the current settings load -- a plain effect
  // (not a controlled/uncontrolled mismatch) since this is a singleton
  // settings row fetched once, not a list of independently-editable rows.
  useEffect(() => {
    if (!query.data) return;
    setName(query.data.name);
    setDescription(query.data.description ?? "");
    setLinks(query.data.links);
    setTimeFormat(query.data.timeFormat);
  }, [query.data]);

  const updateMutation = useMutation({
    mutationFn: (formData: FormData) => apiClient.patch<StationSettingsDTO>("/settings/station", formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "station"] });
      queryClient.invalidateQueries({ queryKey: ["public", "station"] });
      showToast("success", "Station settings saved");
      setLogoFile(null);
      setRemoveLogo(false);
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : "Update failed";
      setError(message);
      showToast("error", `Couldn't save station settings: ${message}`);
    },
  });

  function updateLink(index: number, patch: Partial<StationLinkDTO>) {
    setLinks((current) => current.map((link, i) => (i === index ? { ...link, ...patch } : link)));
  }

  function removeLink(index: number) {
    setLinks((current) => current.filter((_, i) => i !== index));
  }

  function addLink() {
    setLinks((current) => [...current, { platform: "WEBSITE", url: "" }]);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("name", name.trim());
    formData.set("description", description.trim());
    formData.set(
      "links",
      JSON.stringify(links.map((link) => ({ ...link, url: link.url.trim() })).filter((link) => link.url !== "")),
    );
    formData.set("timeFormat", timeFormat);
    if (logoFile) {
      formData.set("logo", logoFile);
    } else if (removeLogo) {
      formData.set("removeLogo", "true");
    }
    updateMutation.mutate(formData);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Station Settings</h1>

      {query.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {query.isError && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load station settings: {(query.error as Error).message}
        </div>
      )}

      {query.data && (
        <form onSubmit={handleSubmit} className="flex max-w-2xl flex-col gap-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
              Branding
            </h2>

            <div className="flex flex-col gap-4">
              <label>
                <span className={labelClass}>Station name</span>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
              </label>

              <label>
                <span className={labelClass}>Short description</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className={inputClass}
                />
              </label>

              <div>
                <span className={labelClass}>Logo (square image)</span>
                <div className="flex items-center gap-4">
                  {logoPreviewUrl ? (
                    <img src={logoPreviewUrl} alt="" className="h-16 w-16 rounded-lg object-cover" />
                  ) : query.data.logoUrl && !removeLogo ? (
                    <img src={apiUrl(query.data.logoUrl)} alt="" className="h-16 w-16 rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-slate-100 text-2xl">
                      &#9835;
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        setLogoFile(e.target.files?.[0] ?? null);
                        if (e.target.files?.[0]) setRemoveLogo(false);
                      }}
                      className="block text-sm text-slate-600"
                    />
                    {query.data.logoUrl && !logoFile && (
                      <label className="flex items-center gap-2 text-sm text-slate-600">
                        <input
                          type="checkbox"
                          checked={removeLogo}
                          onChange={(e) => setRemoveLogo(e.target.checked)}
                        />
                        Remove current logo
                      </label>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
              Display
            </h2>

            <span className={labelClass}>Clock time format</span>
            <div className="flex gap-2">
              {(["12h", "24h"] as const).map((format) => (
                <button
                  key={format}
                  type="button"
                  onClick={() => setTimeFormat(format)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    timeFormat === format
                      ? "bg-slate-900 text-white"
                      : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {format === "12h" ? "12-hour (3:45 PM)" : "24-hour (15:45)"}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                Links
              </h2>
              <button type="button" onClick={addLink} className={rowActionButton}>
                Add link
              </button>
            </div>

            {links.length === 0 && <p className="text-sm text-slate-500">No links added yet.</p>}

            <div className="flex flex-col gap-3">
              {links.map((link, index) => (
                <div key={index} className="flex items-center gap-2">
                  <select
                    value={link.platform}
                    onChange={(e) => updateLink(index, { platform: e.target.value as StationLinkPlatform })}
                    className={`${fieldClass} w-40 shrink-0`}
                  >
                    {PLATFORMS.map((platform) => (
                      <option key={platform} value={platform}>
                        {PLATFORM_LABELS[platform]}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={link.url}
                    onChange={(e) => updateLink(index, { url: e.target.value })}
                    placeholder={link.platform === "EMAIL" ? "mailto:hello@station.example" : "https://…"}
                    className={`${fieldClass} min-w-0 flex-1`}
                  />
                  {link.platform === "OTHER" && (
                    <input
                      type="text"
                      value={link.label ?? ""}
                      onChange={(e) => updateLink(index, { label: e.target.value })}
                      placeholder="Label"
                      className={`${fieldClass} w-32 shrink-0`}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => removeLink(index)}
                    className={`shrink-0 ${rowActionButtonDanger}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>

          {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {updateMutation.isPending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
