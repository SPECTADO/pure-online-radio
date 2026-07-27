import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { VoiceTrackDTO } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { showToast } from "../lib/toastStore";
import { useAudioInputDevices } from "../lib/useAudioInputDevices";
import { useUploadQueueStore } from "../lib/uploadQueueStore";
import { useAudioPreviewStore } from "../lib/audioPreviewStore";
import { encodeWav } from "../lib/wavEncoder";
import { DEFAULT_TRIGGER_FORM_STATE } from "../lib/scheduleTrigger";
import { formatDateTime, formatDuration } from "../lib/format";
import { useTimeFormat } from "../lib/useTimeFormat";
import { rowActionButton, rowActionButtonDanger } from "../lib/buttonStyles";
import { ComingSoon } from "../components/ComingSoon";
import { Modal } from "../components/Modal";
import { PreviewButton } from "../components/PreviewButton";
import { VoiceTrackEditor } from "../components/VoiceTrackEditor";
import { ScheduleRuleModal } from "../components/ScheduleRuleModal";
import type { PickedScheduleItem } from "../components/ScheduleItemPicker";

const VOICE_TRACKS_KEY = ["library", "voice-tracks"];

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

function useElapsedTimer(active: boolean): number {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!active) {
      setElapsedMs(0);
      return;
    }
    const startedAt = Date.now();
    const interval = setInterval(() => setElapsedMs(Date.now() - startedAt), 200);
    return () => clearInterval(interval);
  }, [active]);
  return elapsedMs;
}

function RecorderSection({ onRecorded }: { onRecorded: (buffer: AudioBuffer) => void }) {
  const { devices, error: deviceError } = useAudioInputDevices();
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const elapsedMs = useElapsedTimer(recording);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

  async function startRecording(): Promise<void> {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        try {
          const AudioContextCtor =
            window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!AudioContextCtor) throw new Error("Web Audio API not supported in this browser");
          const context = new AudioContextCtor();
          const arrayBuffer = await blob.arrayBuffer();
          const audioBuffer = await context.decodeAudioData(arrayBuffer);
          void context.close();
          onRecorded(audioBuffer);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't decode the recording");
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't access the microphone");
    }
  }

  function stopRecording(): void {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">Record</h2>

      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-3 text-sm text-slate-600">
          <span className="w-28 shrink-0 font-medium text-slate-500">Microphone</span>
          <select
            value={deviceId ?? ""}
            onChange={(e) => setDeviceId(e.target.value)}
            disabled={recording}
            className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:opacity-60"
          >
            <option value="">System default</option>
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={recording ? stopRecording : () => void startRecording()}
            className={`flex items-center gap-2 rounded-lg px-6 py-3 text-lg font-bold tracking-wide transition-opacity hover:opacity-90 ${
              recording ? "bg-red-700 text-white" : "bg-slate-900 text-white"
            }`}
          >
            <span aria-hidden="true">{recording ? "⏹" : "⏺"}</span>
            {recording ? "Stop" : "Record"}
          </button>
          {recording && <span className="tabular-nums text-slate-500">{formatDuration(elapsedMs)}</span>}
        </div>

        {(error || deviceError) && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error ?? deviceError}</div>
        )}
      </div>
    </section>
  );
}

function EditSection({
  buffer,
  onDiscard,
}: {
  buffer: AudioBuffer;
  onDiscard: () => void;
}) {
  const enqueue = useUploadQueueStore((s) => s.enqueue);
  const [title, setTitle] = useState("");
  const [editedBuffer, setEditedBuffer] = useState(buffer);
  const [saving, setSaving] = useState(false);

  function handleSave(): void {
    if (!title.trim()) return;
    setSaving(true);
    const wavBlob = encodeWav(editedBuffer);
    const formData = new FormData();
    formData.set("file", wavBlob, `${title.trim()}.wav`);
    formData.set("title", title.trim());
    enqueue({
      path: "/library/voice-tracks",
      formData,
      filename: `${title.trim()}.wav`,
      label: "voice track",
      invalidateKey: VOICE_TRACKS_KEY,
    });
    onDiscard();
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">Edit recording</h2>

      <VoiceTrackEditor initialBuffer={buffer} onChange={setEditedBuffer} />

      <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-end">
        <label className="flex-1">
          <span className="mb-1 block text-sm font-medium text-slate-700">Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Morning show intro"
            className={inputClass}
          />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Discard
          </button>
          <button
            type="button"
            disabled={!title.trim() || saving}
            onClick={handleSave}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Save voice track
          </button>
        </div>
      </div>
    </section>
  );
}

export function VoiceTrackPage() {
  const queryClient = useQueryClient();
  const timeFormat = useTimeFormat();
  const stopPreview = useAudioPreviewStore((s) => s.stop);
  const [recordedBuffer, setRecordedBuffer] = useState<AudioBuffer | null>(null);
  const [scheduling, setScheduling] = useState<VoiceTrackDTO | null>(null);
  const [pendingDelete, setPendingDelete] = useState<VoiceTrackDTO | null>(null);

  useEffect(() => stopPreview, [stopPreview]);

  const query = useQuery({
    queryKey: VOICE_TRACKS_KEY,
    queryFn: () => apiClient.get<VoiceTrackDTO[]>("/library/voice-tracks"),
    retry: false,
  });

  const deleteMutation = useMutation({
    mutationFn: (voiceTrack: VoiceTrackDTO) => apiClient.delete(`/library/voice-tracks/${voiceTrack.id}`),
    onSuccess: (_data, voiceTrack) => {
      queryClient.invalidateQueries({ queryKey: VOICE_TRACKS_KEY });
      showToast("success", `Deleted "${voiceTrack.title}"`);
      setPendingDelete(null);
    },
    onError: (err, voiceTrack) => {
      showToast(
        "error",
        `Couldn't delete "${voiceTrack.title}": ${err instanceof ApiError ? err.message : "Delete failed"}`,
      );
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Voice Track</h1>

      {recordedBuffer ? (
        <EditSection buffer={recordedBuffer} onDiscard={() => setRecordedBuffer(null)} />
      ) : (
        <RecorderSection onRecorded={setRecordedBuffer} />
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">Recordings</h2>

        {query.isLoading && <p className="text-sm text-slate-500">Loading…</p>}

        {query.isError && !(query.error instanceof ApiError && query.error.isNotImplemented) && (
          <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
            Couldn't load voice tracks: {(query.error as Error).message}
          </div>
        )}

        {query.data && query.data.length === 0 && (
          <ComingSoon title="No voice tracks yet" detail="Record one above to see it listed here." />
        )}

        {query.data && query.data.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3" />
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Recorded</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {query.data.map((voiceTrack) => (
                  <tr key={voiceTrack.id}>
                    <td className="px-4 py-3">
                      <PreviewButton id={voiceTrack.id} path={`/library/voice-tracks/${voiceTrack.id}/audio`} />
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">{voiceTrack.title}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDuration(voiceTrack.durationMs)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(voiceTrack.createdAt, timeFormat)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setScheduling(voiceTrack)} className={rowActionButton}>
                          Schedule
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDelete(voiceTrack)}
                          className={rowActionButtonDanger}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {scheduling && (
        <ScheduleRuleModal
          initialName={scheduling.title}
          initialTrigger={DEFAULT_TRIGGER_FORM_STATE}
          initialItems={
            [
              {
                key: crypto.randomUUID(),
                mediaKind: "VOICE_TRACK",
                mediaId: scheduling.id,
                title: scheduling.title,
                artist: null,
                durationMs: scheduling.durationMs,
              },
            ] satisfies PickedScheduleItem[]
          }
          onClose={() => setScheduling(null)}
        />
      )}

      {pendingDelete && (
        <Modal title="Delete voice track" onClose={() => setPendingDelete(null)}>
          <p className="text-sm text-slate-600">
            Delete "{pendingDelete.title}"? This removes the audio file permanently.
          </p>
          {deleteMutation.isError && (
            <p className="mt-2 text-sm text-red-600">
              {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Delete failed"}
            </p>
          )}
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
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
