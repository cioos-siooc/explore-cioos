import * as React from "react";
import { useTranslation } from "react-i18next";
import Select, { components } from "react-select";
import {
  CaretDownFill,
  GripVertical,
  PlusLg,
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

// The columns the preview leaves empty sink below a rule, as a second group
// headed by why, so the drawable ones are what the list leads with.
function withDataFirst(choices, emptyLabel) {
  const withData = choices.filter(hasData);
  const empty = choices.filter((variable) => !hasData(variable));
  return {
    ordered: [...withData, ...empty],
    options:
      withData.length && empty.length
        ? [{ options: withData }, { label: emptyLabel, options: empty }]
        : choices,
  };
}

// The menu portals to document.body (the pane scrolls and the modal clips), so
// it needs the dropdown layer to show above the dialog. It may grow past the
// control so long variable names stay readable, but never off-screen.
const STYLES = {
  menuPortal: (base) => ({
    ...base,
    zIndex: "var(--cioos-z-dropdown, 1060)",
    width: "max-content",
    minWidth: `max(${base.width}px, min(320px, calc(100vw - ${base.left}px - 16px)))`,
    maxWidth: `min(640px, calc(100vw - ${base.left}px - 16px))`,
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

// A menu entry reads `column (unit) long name`: the ERDDAP name leads, since
// it is what tells near-identical long names apart.
const longNameOf = (variable) =>
  variable.longName && variable.longName !== variable.columnName
    ? variable.longName
    : null;

function VariableOption({ variable, query }) {
  const longName = longNameOf(variable);
  return (
    <span className="variableOption">
      <span className="variableOptionColumn">
        <MatchHighlight text={variable.columnName} query={query} />
      </span>
      {(longName || variable.unit) && (
        <span className="variableOptionDetail">
          {variable.unit && ` (${variable.unit})`}
          {longName && (
            <>
              {" "}
              <MatchHighlight text={longName} query={query} />
            </>
          )}
        </span>
      )}
      {!hasData(variable) && <NoDataMarker />}
    </span>
  );
}

// The visible text as one string, the no-data tag set off from it.
function Option(props) {
  const { t } = useTranslation();
  const { columnName, unit } = props.data;
  const longName = longNameOf(props.data);
  const label = [columnName, unit && `(${unit})`, longName]
    .filter(Boolean)
    .join(" ");
  return (
    <components.Option
      {...props}
      innerProps={{
        ...props.innerProps,
        "aria-label": hasData(props.data)
          ? label
          : `${label}, ${t("datasetPreviewPlotNoDataMarker")}`,
      }}
    />
  );
}

// The small filled caret the pane's other dropdowns and SelectPill draw, in
// place of react-select's 20px chevron and its separator rule. A picker that
// can still add shows its add pill (ValueContainer) instead.
function DropdownIndicator(props) {
  if (props.selectProps.canAdd) return null;
  return (
    <components.DropdownIndicator {...props}>
      <CaretDownFill size={9} aria-hidden="true" />
    </components.DropdownIndicator>
  );
}

// Decorative: a click anywhere on the control already opens the menu. It
// goes before the search input, which react-select renders last.
function ValueContainer({ children, ...props }) {
  const { t } = useTranslation();
  const { canAdd, inputValue } = props.selectProps;
  const parts = React.Children.toArray(children);
  const input = parts.pop();
  return (
    <components.ValueContainer {...props}>
      {parts}
      {canAdd && !inputValue && (
        <span className="variableSelectAdd" aria-hidden="true">
          <PlusLg size={11} />
          {t("datasetPreviewPlotAddVariable")}
        </span>
      )}
      {input}
    </components.ValueContainer>
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
 * Variables for one axis, typed to filter: one pill each. With `isMulti` off
 * the axis holds one pill, and picking another swaps it. Unless `required`,
 * the last pick can be removed, falling back to `placeholder`.
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
  const { ordered, options: grouped } = withDataFirst(
    choices,
    t("datasetPreviewPlotEmptyGroup"),
  );
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
        {/* Always react-select's multi mode, so a lone pick is a pill too. */}
        <Select
          isMulti
          canAdd={isMulti && !atCap}
          className="variableSelect"
          classNamePrefix="variableSelect"
          options={grouped}
          value={options}
          onChange={(picked) =>
            onChange(
              (isMulti || picked.length <= selected.length
                ? picked
                : picked.slice(-1)
              ).map(columnNameOf),
            )
          }
          getOptionValue={columnNameOf}
          getOptionLabel={labelFor}
          formatOptionLabel={(variable, { context, inputValue }) =>
            context === "menu" ? (
              <VariableOption variable={variable} query={inputValue} />
            ) : (
              shortLabelFor(variable)
            )
          }
          isOptionDisabled={() => atCap}
          closeMenuOnSelect={!isMulti}
          backspaceRemovesValue={!locked}
          isClearable={isMulti}
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
            Option,
            DropdownIndicator,
            ValueContainer,
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
                    : ordered.slice(0, selectable).map(columnNameOf),
                ),
            }
          }
        />
      </SortableContext>
    </DndContext>
  );
}
