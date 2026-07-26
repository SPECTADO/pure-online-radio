import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CategoryDTO, MediaKind, SelectionStrategy } from "@spectado/shared-types";
import { rowActionButton, rowActionButtonDanger } from "../lib/buttonStyles";

/** Client-side only -- `key` is a stable id for dnd-kit/list rendering, never sent to the
 * API (the wire order is derived from array position, same convention as
 * ScheduleItemPicker's items). */
export interface EditableStep {
  key: string;
  mediaKind: MediaKind;
  selectionStrategy: SelectionStrategy;
  categoryId: string | null;
  tag: string;
}

const selectClass =
  "rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

export function ClockWheelStepPicker({
  steps,
  categories,
  onChange,
}: {
  steps: EditableStep[];
  categories: CategoryDTO[];
  onChange: (steps: EditableStep[]) => void;
}) {
  function addStep() {
    onChange([
      ...steps,
      { key: crypto.randomUUID(), mediaKind: "SONG", selectionStrategy: "RANDOM", categoryId: null, tag: "" },
    ]);
  }

  function updateStep(key: string, patch: Partial<EditableStep>) {
    onChange(steps.map((step) => (step.key === key ? { ...step, ...patch } : step)));
  }

  function removeStep(key: string) {
    onChange(steps.filter((step) => step.key !== key));
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = steps.findIndex((step) => step.key === active.id);
    const newIndex = steps.findIndex((step) => step.key === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onChange(arrayMove(steps, oldIndex, newIndex));
  }

  return (
    <div className="flex flex-col gap-3">
      {steps.length === 0 ? (
        <p className="text-sm text-slate-500">No rotation steps yet -- add one below.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={steps.map((step) => step.key)} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col gap-2">
              {steps.map((step, index) => (
                <StepRow
                  key={step.key}
                  index={index}
                  step={step}
                  categories={categories}
                  onChange={(patch) => updateStep(step.key, patch)}
                  onRemove={() => removeStep(step.key)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <button type="button" onClick={addStep} className={`self-start ${rowActionButton}`}>
        + Add step
      </button>
    </div>
  );
}

function StepRow({
  index,
  step,
  categories,
  onChange,
  onRemove,
}: {
  index: number;
  step: EditableStep;
  categories: CategoryDTO[];
  onChange: (patch: Partial<EditableStep>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.key });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white p-2 ${
        isDragging ? "relative z-10 opacity-50" : ""
      }`}
    >
      {/* Drag handle is the only part with the sortable listeners, so every form control
          below stays independently clickable. */}
      <span
        {...attributes}
        {...listeners}
        aria-hidden="true"
        className="flex shrink-0 cursor-grab touch-none select-none items-center gap-1 text-slate-300 active:cursor-grabbing"
      >
        ⠿<span className="text-xs text-slate-400">{index + 1}.</span>
      </span>

      <select
        value={step.mediaKind}
        onChange={(e) => onChange({ mediaKind: e.target.value as MediaKind })}
        className={selectClass}
      >
        <option value="SONG">Song</option>
        <option value="JINGLE">Jingle</option>
        <option value="AD">Ad</option>
      </select>

      <select
        value={step.categoryId ?? ""}
        onChange={(e) => onChange({ categoryId: e.target.value || null })}
        className={selectClass}
      >
        <option value="">All categories</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>

      <input
        type="text"
        value={step.tag}
        onChange={(e) => onChange({ tag: e.target.value })}
        placeholder="tag (optional)"
        className={`w-28 ${selectClass}`}
      />

      <select
        value={step.selectionStrategy}
        onChange={(e) => onChange({ selectionStrategy: e.target.value as EditableStep["selectionStrategy"] })}
        className={selectClass}
      >
        <option value="RANDOM">Random</option>
        <option value="LEAST_RECENTLY_PLAYED">Least recently played</option>
        <option value="WEIGHTED_RECENCY">Weighted (favor stale tracks)</option>
      </select>

      <button type="button" onClick={onRemove} className={`ml-auto ${rowActionButtonDanger}`}>
        Remove
      </button>
    </li>
  );
}
