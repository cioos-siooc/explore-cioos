import * as React from "react";
import { useTranslation } from "react-i18next";
import Select, { components } from "react-select";
import {
  CaretDownFill,
  GripVertical,
  SlashCircle,
} from "react-bootstrap-icons";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import MatchHighlight from "../../ui/MatchHighlight.jsx";
import {
  hasData,
  labelFor,
  shortLabelFor,
} from "../DatasetPreview/previewVariables.js";

const columnNameOf = (variable) => variable.columnName;

// The menu portals to document.body (the pane scrolls and the modal clips), so
// it needs the dropdown layer to show above the dialog. It may grow past the
// control so long variable names stay readable, but never off-screen.
const STYLES = {
  menuPortal: (base) => ({
    ...base,
    zIndex: "var(--cioos-z-dropdown, 1060)",
    width: "max-content",
    minWidth: base.width,
    maxWidth: `min(480px, calc(100vw - ${base.left}px - 16px))`,
  }),
};

// The cap note and Select all / Clear all ride along the option list, reading
// what they need from the extra props react-select hands through selectProps.
function MenuList(props) {
  const { capNote, bulkAction } = props.selectProps;
  return (
    <components.MenuList {...props}>
      {capNote && <span className="dropdownEmptyNote">{capNote}</span>}
      {props.children}
      {bulkAction && (
        <button
          type="button"
          className="dropdown-item variableSelectBulk"
          // Before the input blurs and closes the menu.
          onMouseDown={(event) => event.preventDefault()}
          onClick={bulkAction.run}
        >
          {bulkAction.label}
        </button>
      )}
    </components.MenuList>
  );
}

// Tags a column the preview's rows leave empty, in every list that offers it.
export function NoDataMarker() {
  const { t } = useTranslation();
  return (
    <span className="noDataMarker">
      <SlashCircle size={10} aria-hidden="true" />
      {t("datasetPreviewPlotNoDataMarker")}
    </span>
  );
}

// The small filled caret the pane's other dropdowns and SelectPill draw, in
// place of react-select's 20px chevron and its separator rule.
function DropdownIndicator(props) {
  return (
    <components.DropdownIndicator {...props}>
      <CaretDownFill size={9} aria-hidden="true" />
    </components.DropdownIndicator>
  );
}

// A picked variable, reordered by the grip at its start. The grip's
// mouse-down stops short of react-select so grabbing it does not open the menu.
function SortableMultiValue(props) {
  const { t } = useTranslation();
  const { columnName } = props.data;
  const { reorderable } = props.selectProps;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: columnName, disabled: !reorderable });
  if (!reorderable) return <components.MultiValue {...props} />;
  return (
    <components.MultiValue
      {...props}
      innerProps={{
        ...props.innerProps,
        ref: setNodeRef,
        style: { transform: CSS.Translate.toString(transform), transition },
        "data-dragging": isDragging || undefined,
      }}
      // react-select names the remove button from `children`, which now holds
      // the grip too.
      removeProps={{
        ...props.removeProps,
        "aria-label": `Remove ${props.children}`,
      }}
    >
      <span
        className="variableSelectDragHandle"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={t("datasetPreviewPlotReorder", {
          name: shortLabelFor(props.data),
        })}
        title={t("datasetPreviewPlotReorderTitle")}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <GripVertical size={11} aria-hidden="true" />
      </span>
      {props.children}
    </components.MultiValue>
  );
}

/**
 * Variables for one axis, typed to filter: one pill each, or a single pick
 * when `isMulti` is off. Unless `required`, the last pick can be removed, and a
 * single pick then falls back to `placeholder`.
 */
export default function VariablePicker({
  label,
  choices,
  value: selected,
  variablesByName,
  onChange,
  isMulti = true,
  required = false,
  placeholder,
  maxSelected = Infinity,
}) {
  const { t } = useTranslation();
  const menuOpen = React.useRef(false);
  const selectable = Math.min(choices.length, maxSelected);
  const atCap = isMulti && selected.length >= maxSelected;
  const allSelected = selected.length === selectable;
  const options = selected
    .map((name) => variablesByName.get(name))
    .filter(Boolean);
  const locked = required && selected.length <= 1;
  const reorderable = isMulti && selected.length > 1;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const nameOf = (columnName) =>
    shortLabelFor(variablesByName.get(String(columnName)));
  const positionOf = (columnName) => selected.indexOf(String(columnName)) + 1;
  const announcements = {
    onDragStart: ({ active }) =>
      t("datasetPreviewPlotDragStart", { name: nameOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over &&
      t("datasetPreviewPlotDragOver", {
        name: nameOf(active.id),
        position: positionOf(over.id),
        total: selected.length,
      }),
    onDragEnd: ({ active, over }) =>
      t("datasetPreviewPlotDragEnd", {
        name: nameOf(active.id),
        position: positionOf((over || active).id),
        total: selected.length,
      }),
    onDragCancel: ({ active }) =>
      t("datasetPreviewPlotDragCancel", { name: nameOf(active.id) }),
  };
  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    onChange(
      arrayMove(
        selected,
        selected.indexOf(active.id),
        selected.indexOf(over.id),
      ),
    );
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: t("datasetPreviewPlotDragInstructions"),
        },
      }}
    >
      <SortableContext items={selected} strategy={rectSortingStrategy}>
        <Select
          isMulti={isMulti}
          className="variableSelect"
          classNamePrefix="variableSelect"
          options={choices}
          value={isMulti ? options : (options[0] ?? null)}
          onChange={(picked) =>
            onChange(
              isMulti
                ? picked.map(columnNameOf)
                : picked
                  ? [picked.columnName]
                  : [],
            )
          }
          getOptionValue={columnNameOf}
          getOptionLabel={labelFor}
          formatOptionLabel={(variable, { context, inputValue }) =>
            context === "menu" ? (
              <>
                <MatchHighlight text={labelFor(variable)} query={inputValue} />
                {!hasData(variable) && <NoDataMarker />}
              </>
            ) : (
              shortLabelFor(variable)
            )
          }
          isOptionDisabled={() => atCap}
          closeMenuOnSelect={!isMulti}
          backspaceRemovesValue={!locked}
          isClearable={!isMulti && !required}
          placeholder={placeholder ?? t("datasetPreviewPlotSearchVariables")}
          aria-label={label}
          noOptionsMessage={({ inputValue }) =>
            t(
              inputValue
                ? "datasetPreviewPlotNoMatchingVariables"
                : choices.length === 0
                  ? "datasetPreviewPlotNoVariables"
                  : "datasetPreviewPlotAllVariablesSelected",
            )
          }
          menuPortalTarget={document.body}
          menuPosition="fixed"
          styles={STYLES}
          // react-select skips its own handling of a key it sees prevented, which
          // leaves a focused grip's arrows, space and escape to the drag. Tab is
          // spared so focus can still leave the grip.
          onMenuOpen={() => (menuOpen.current = true)}
          onMenuClose={() => (menuOpen.current = false)}
          onKeyDown={(event) => {
            if (
              event.key !== "Tab" &&
              event.target.closest?.(".variableSelectDragHandle")
            ) {
              event.preventDefault();
            }
            // Escape closes the open menu only, not the dialog around it.
            if (event.key === "Escape" && menuOpen.current) {
              event.stopPropagation();
            }
          }}
          reorderable={reorderable}
          components={{
            MenuList,
            DropdownIndicator,
            MultiValue: SortableMultiValue,
            IndicatorSeparator: null,
            ...(locked && { MultiValueRemove: () => null }),
          }}
          capNote={
            choices.length > maxSelected &&
            t("datasetPreviewPlotMaxVariables", { count: maxSelected })
          }
          bulkAction={
            isMulti &&
            !required &&
            choices.length > 1 && {
              label: t(
                allSelected
                  ? "datasetPreviewPlotSelectNone"
                  : "datasetPreviewPlotSelectAll",
              ),
              run: () =>
                onChange(
                  allSelected
                    ? []
                    : choices.slice(0, selectable).map(columnNameOf),
                ),
            }
          }
        />
      </SortableContext>
    </DndContext>
  );
}
