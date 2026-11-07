#!/usr/bin/env python3
"""Dev utility — write `tests/fixtures/reference.ifc`, the synthetic reference model (2026-11-07,
`docs/plans/core-protection.md` item 1).

The two IfcOpenShell conformance tests — `tests/unit/index-builder.fixture.test.ts` and
`tests/unit/geometry-streamer.fixture.test.ts` — need a model and its ground truth. A real model
can never be committed, so until now both always skipped in CI. This writes one that can be: a
ten-storey frame building of about 2 100 elements, made up from nothing, whose ground truth
`scripts/expected-from-ifcopenshell.py` then writes to `tests/fixtures/reference.expected.json`.

What it holds, each for a trap or a rule the parser has to get right:

 · **millimetres**, as a Revit export writes them — storey `Elevation`s and quantities convert;
 · a **far shared origin on the site placement**, as Revit "Shared Coordinates" writes it — the
   repository's synthetic set only (`CLAUDE.md`, Rules: 12345.457 / 23456.766 / 5.05 m, −43.4103°),
   so every element sits ~26 km out and turned, and float32 would lose millimetres;
 · ten storeys, nine occupied and a roof, each with its own `Elevation` and `CompositionType`;
 · a **grid of two families**, `1`–`8` and `A`–`E`, real `IfcGridAxis` polylines, 6 m bays;
 · walls, slabs, beams, columns, footings, doors, windows and `IfcSpace`s;
 · **type objects with their own property sets** and occurrences that carry a set of the same
   name, sharing one property with a different value — **the occurrence must win** — beside
   properties only the type has and only the occurrence has;
 · base quantities (`Qto_…BaseQuantities`), a material layer set usage, plain materials and a
   classification reference;
 · `PredefinedType` stated on the occurrence, on the type only, and `USERDEFINED` with the
   `ObjectType` it points at;
 · doors drawn through their type's `RepresentationMaps` (mapped items) in `IfcOpeningElement`s
   that void the walls, and shared extrusions — so geometry repeats and is instanced;
 · **glass whose transparency is only in its surface style** (`IfcStyledItem`), never in a colour.

No project name, no address, no person or organisation, no latitude or longitude — nothing that
identifies anybody. Deterministic on purpose: GlobalIds from a counter, a fixed header timestamp,
no owner history, so re-running it writes a byte-identical file. The scaffold (header, units,
contexts, Project → Site → Building, storeys, the grid) is `make-tiny-ifc.py`'s own `Fixture`.

    python3 scripts/make-reference-ifc.py
    python3 scripts/expected-from-ifcopenshell.py tests/fixtures/reference.ifc
"""
from __future__ import annotations

import importlib.util
import pathlib
import sys

try:
    import ifcopenshell  # noqa: F401  (the scaffold imports it; fail here with the hint)
except ImportError:  # pragma: no cover - dev utility
    sys.exit("IfcOpenShell is not installed:  pip3 install ifcopenshell")

HERE = pathlib.Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("make_tiny_ifc", HERE / "make-tiny-ifc.py")
tiny = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tiny)  # type: ignore[union-attr]

gid = tiny.gid

# ── the building, millimetres ──
BAY = 6000.0
NUMBERS = [str(k + 1) for k in range(8)]  # grid lines along X: x = 0 … 42 000
LETTERS = ["A", "B", "C", "D", "E"]  # grid lines along Y: y = 0 … 24 000
XS = [k * BAY for k in range(len(NUMBERS))]
YS = [k * BAY for k in range(len(LETTERS))]
STOREY_H = 3500.0
OCCUPIED = 9  # Level 00 … Level 08; the roof storey above them
SLAB = 200.0
CLEAR = STOREY_H - SLAB


class Reference:
    def __init__(self) -> None:
        self.fx = fx = tiny.Fixture(
            "reference.ifc",
            "Reference",
            millimetres=True,
            site_at=tiny.SITE_MM,
            site_deg=tiny.SITE_DEG,
            true_north=(tiny.REVIT_ORDINATE, 1.0),
        )
        fx.f.header.file_name.preprocessor_version = "scripts/make-reference-ifc.py"
        self.f = fx.f
        self.items: dict[tuple, object] = {}
        self.marks = 0

    # ── geometry ──

    def extrusion(self, dx: float, dy: float, dz: float):
        """One extruded box with its corner at the origin, shared by every element of that size."""
        key = (dx, dy, dz)
        if key not in self.items:
            f, fx = self.f, self.fx
            profile = f.create_entity("IfcRectangleProfileDef", ProfileType="AREA", XDim=dx, YDim=dy)
            self.items[key] = f.create_entity(
                "IfcExtrudedAreaSolid",
                SweptArea=profile,
                Position=fx.axis(dx / 2.0, dy / 2.0, 0.0),
                ExtrudedDirection=f.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)),
                Depth=dz,
            )
        return self.items[key]

    def body(self, items, kind: str = "SweptSolid"):
        f = self.f
        shape = f.create_entity(
            "IfcShapeRepresentation",
            ContextOfItems=self.fx.body,
            RepresentationIdentifier="Body",
            RepresentationType=kind,
            Items=list(items),
        )
        return f.create_entity("IfcProductDefinitionShape", Representations=[shape])

    def place(self, rel_to, at):
        return self.f.create_entity(
            "IfcLocalPlacement", PlacementRelTo=rel_to, RelativePlacement=self.fx.axis(*at)
        )

    def box(self, entity: str, name: str, rel_to, at, size, item=None, **attributes):
        """An element whose body is one box `size` with its corner at `at` from `rel_to`."""
        return self.f.create_entity(
            entity,
            GlobalId=gid(),
            Name=name,
            ObjectPlacement=self.place(rel_to, at),
            Representation=self.body([item or self.extrusion(*size)]),
            **attributes,
        )

    # ── properties ──

    def value(self, measure: str, v):
        return self.f.create_entity(measure, v)

    def pset(self, name: str, props: list[tuple[str, str, object]]):
        f = self.f
        return f.create_entity(
            "IfcPropertySet",
            GlobalId=gid(),
            Name=name,
            HasProperties=[
                f.create_entity("IfcPropertySingleValue", Name=k, NominalValue=self.value(m, v))
                for k, m, v in props
            ],
        )

    def qto(self, name: str, quantities: list[tuple[str, str, float]]):
        f = self.f
        attribute = {
            "IfcQuantityLength": "LengthValue",
            "IfcQuantityArea": "AreaValue",
            "IfcQuantityVolume": "VolumeValue",
        }
        return f.create_entity(
            "IfcElementQuantity",
            GlobalId=gid(),
            Name=name,
            Quantities=[
                f.create_entity(kind, Name=k, **{attribute[kind]: float(v)}) for k, kind, v in quantities
            ],
        )

    def define(self, objects, definition) -> None:
        self.f.create_entity(
            "IfcRelDefinesByProperties",
            GlobalId=gid(),
            RelatedObjects=list(objects),
            RelatingPropertyDefinition=definition,
        )

    def typed(self, type_object, objects) -> None:
        self.f.create_entity(
            "IfcRelDefinesByType", GlobalId=gid(), RelatedObjects=list(objects), RelatingType=type_object
        )

    def mark(self, element, prefix: str) -> None:
        """A set of its own on one element: the per-element data an exporter writes."""
        self.marks += 1
        self.define(
            [element],
            self.pset("SGVue_Identity", [("Mark", "IfcLabel", f"{prefix}-{self.marks:04d}")]),
        )

    def material(self, objects, material) -> None:
        self.f.create_entity(
            "IfcRelAssociatesMaterial",
            GlobalId=gid(),
            RelatedObjects=list(objects),
            RelatingMaterial=material,
        )


def build() -> None:
    r = Reference()
    f, fx = r.f, r.fx

    # ── materials and the classification ──
    concrete = f.create_entity("IfcMaterial", Name="Concrete")
    steel = f.create_entity("IfcMaterial", Name="Steel")
    glass = f.create_entity("IfcMaterial", Name="Glass")
    timber = f.create_entity("IfcMaterial", Name="Timber")
    gypsum = f.create_entity("IfcMaterial", Name="Gypsum board")

    def layer_usage(set_name: str, layers: list[tuple[object, float]]):
        layer_set = f.create_entity(
            "IfcMaterialLayerSet",
            LayerSetName=set_name,
            MaterialLayers=[f.create_entity("IfcMaterialLayer", Material=m, LayerThickness=t) for m, t in layers],
        )
        return f.create_entity(
            "IfcMaterialLayerSetUsage",
            ForLayerSet=layer_set,
            LayerSetDirection="AXIS2",
            DirectionSense="POSITIVE",
            OffsetFromReferenceLine=0.0,
        )

    external_usage = layer_usage("Concrete wall 200", [(concrete, 200.0)])
    partition_usage = layer_usage("Partition 100", [(gypsum, 12.5), (steel, 75.0), (gypsum, 12.5)])
    classification = f.create_entity("IfcClassification", Name="SGVue test classification")
    wall_class = f.create_entity(
        "IfcClassificationReference",
        Identification="W-10",
        Name="External walls",
        ReferencedSource=classification,
    )

    # ── type objects, each with its own set ──
    wall_type = f.create_entity("IfcWallType", GlobalId=gid(), Name="Concrete wall 200", PredefinedType="SOLIDWALL")
    wall_type.HasPropertySets = [
        r.pset(
            "Pset_WallCommon",
            [
                ("Reference", "IfcIdentifier", "WT-200"),
                ("IsExternal", "IfcBoolean", True),
                ("LoadBearing", "IfcBoolean", True),
                ("FireRating", "IfcLabel", "REI 120"),  # the occurrence's REI 90 wins
            ],
        ),
        r.pset("SGVue_TypeOnly", [("Supplier", "IfcLabel", "Type supplier"), ("Cost", "IfcReal", 410.5)]),
    ]
    partition_type = f.create_entity(
        "IfcWallType", GlobalId=gid(), Name="Partition 100", PredefinedType="USERDEFINED", ElementType="Partition"
    )
    partition_type.HasPropertySets = [
        r.pset("Pset_WallCommon", [("IsExternal", "IfcBoolean", False), ("AcousticRating", "IfcLabel", "Rw 45")])
    ]
    column_type = f.create_entity("IfcColumnType", GlobalId=gid(), Name="Column 400x400", PredefinedType="COLUMN")
    column_type.HasPropertySets = [
        r.pset("Pset_ColumnCommon", [("Reference", "IfcIdentifier", "C-400"), ("LoadBearing", "IfcBoolean", True)])
    ]
    beam_type = f.create_entity("IfcBeamType", GlobalId=gid(), Name="Beam 300x600", PredefinedType="BEAM")
    beam_type.HasPropertySets = [r.pset("Pset_BeamCommon", [("Span", "IfcPositiveLengthMeasure", BAY)])]
    slab_type = f.create_entity("IfcSlabType", GlobalId=gid(), Name="Floor 200", PredefinedType="FLOOR")
    slab_type.HasPropertySets = [
        r.pset(
            "Pset_SlabCommon",
            [("Reference", "IfcIdentifier", "S-200"), ("IsExternal", "IfcBoolean", False), ("PitchAngle", "IfcPlaneAngleMeasure", 0.0)],
        )
    ]
    window_type = f.create_entity("IfcWindowType", GlobalId=gid(), Name="Glazing 6000", PredefinedType="WINDOW", PartitioningType="SINGLE_PANEL")
    window_type.HasPropertySets = [r.pset("Pset_WindowCommon", [("ThermalTransmittance", "IfcThermalTransmittanceMeasure", 1.4)])]

    # A door is drawn through its type's representation map, so every door instances one shape.
    door_map = f.create_entity(
        "IfcRepresentationMap",
        MappingOrigin=fx.axis(),
        MappedRepresentation=f.create_entity(
            "IfcShapeRepresentation",
            ContextOfItems=fx.body,
            RepresentationIdentifier="Body",
            RepresentationType="SweptSolid",
            Items=[r.extrusion(1000.0, 100.0, 2100.0)],
        ),
    )
    door_type = f.create_entity(
        "IfcDoorType",
        GlobalId=gid(),
        Name="Single leaf 1000",
        PredefinedType="DOOR",
        OperationType="SINGLE_SWING_LEFT",
        RepresentationMaps=[door_map],
    )
    door_type.HasPropertySets = [
        r.pset("Pset_DoorCommon", [("FireRating", "IfcLabel", "FD30"), ("IsExternal", "IfcBoolean", False)])
    ]
    door_item = f.create_entity(
        "IfcMappedItem",
        MappingSource=door_map,
        MappingTarget=f.create_entity("IfcCartesianTransformationOperator3D", LocalOrigin=fx.point(0.0, 0.0, 0.0)),
    )

    # Glass: its transparency lives only in the surface style on its item — never in a colour.
    glass_item = f.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=f.create_entity("IfcRectangleProfileDef", ProfileType="AREA", XDim=BAY, YDim=50.0),
        Position=fx.axis(BAY / 2.0, 25.0, 0.0),
        ExtrudedDirection=f.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)),
        Depth=CLEAR,
    )
    f.create_entity(
        "IfcStyledItem",
        Item=glass_item,
        Styles=[
            f.create_entity(
                "IfcSurfaceStyle",
                Name="Glass",
                Side="BOTH",
                Styles=[
                    f.create_entity(
                        "IfcSurfaceStyleRendering",
                        SurfaceColour=f.create_entity("IfcColourRgb", Red=0.6, Green=0.75, Blue=0.8),
                        Transparency=0.7,
                        ReflectanceMethod="NOTDEFINED",
                    )
                ],
            )
        ],
    )

    # Shared base quantities, one set per size; a set of its own on the first of each class.
    ext_wall_qto_x = r.qto("Qto_WallBaseQuantities", [("Length", "IfcQuantityLength", BAY), ("Height", "IfcQuantityLength", CLEAR), ("Width", "IfcQuantityLength", 200.0), ("NetVolume", "IfcQuantityVolume", BAY * CLEAR * 200.0 / 1e9)])
    slab_qto = r.qto("Qto_SlabBaseQuantities", [("Width", "IfcQuantityLength", SLAB), ("GrossArea", "IfcQuantityArea", 36.0), ("GrossVolume", "IfcQuantityVolume", 7.2)])
    space_qto = r.qto("Qto_SpaceBaseQuantities", [("NetFloorArea", "IfcQuantityArea", 33.64), ("Height", "IfcQuantityLength", 3100.0)])
    # The occurrence's set of the type's name: FireRating differs from the type's and must win.
    wall_occurrence = r.pset("Pset_WallCommon", [("FireRating", "IfcLabel", "REI 90"), ("ThermalTransmittance", "IfcThermalTransmittanceMeasure", 0.35)])
    door_occurrence = r.pset("Pset_DoorCommon", [("FireRating", "IfcLabel", "FD60"), ("HandicapAccessible", "IfcBoolean", True)])

    groups: dict[str, list] = {k: [] for k in (
        "ext_walls", "ext_walls_x", "partitions_c", "partitions_x", "columns", "beams", "slabs",
        "windows", "doors", "spaces", "footings", "parapets",
    )}

    storeys = []
    places = []
    for level in range(OCCUPIED + 1):
        roof = level == OCCUPIED
        storey, place = fx.storey("Roof" if roof else f"Level {level:02d}", level * STOREY_H)
        storeys.append(storey)
        places.append(place)
    fx.aggregate(fx.building, storeys)

    # The grid, on the ground floor, two families running past the building by 2 m.
    grid = fx.grid(
        places[0],
        [(tag, (x, -2000.0), (x, YS[-1] + 2000.0)) for tag, x in zip(NUMBERS, XS)],
        [(tag, (-2000.0, y), (XS[-1] + 2000.0, y)) for tag, y in zip(LETTERS, YS)],
    )

    for level, (storey, place) in enumerate(zip(storeys, places)):
        roof = level == OCCUPIED
        here: list = []
        tag = "RF" if roof else f"L{level:02d}"

        if not roof:
            # External walls first, so the file's first IfcWall is one: south … north along X,
            # west and east along Y. The south facade is glass.
            for i in range(len(XS) - 1):
                north = r.box("IfcWall", f"External wall {tag}-N{i + 1}", place, (XS[i], YS[-1] - 200.0, SLAB), (BAY, 200.0, CLEAR), PredefinedType="SOLIDWALL")
                groups["ext_walls"].append(north)
                groups["ext_walls_x"].append(north)
                here.append(north)
            for x_edge, side in ((0.0, "W"), (XS[-1] - 200.0, "E")):
                for j in range(len(YS) - 1):
                    wall = r.box("IfcWall", f"External wall {tag}-{side}{j + 1}", place, (x_edge, YS[j], SLAB), (200.0, BAY, CLEAR), PredefinedType="SOLIDWALL")
                    groups["ext_walls"].append(wall)
                    here.append(wall)
            for i in range(len(XS) - 1):
                window = r.box("IfcWindow", f"Glazing {tag}-S{i + 1}", place, (XS[i], 0.0, SLAB), None, item=glass_item, PredefinedType="WINDOW", OverallHeight=CLEAR, OverallWidth=BAY)
                groups["windows"].append(window)
                here.append(window)

            # The corridor wall along grid C, a door in each bay.
            for i in range(len(XS) - 1):
                wall = r.box("IfcWall", f"Corridor wall {tag}-{i + 1}", place, (XS[i], YS[2] - 50.0, SLAB), (BAY, 100.0, CLEAR), PredefinedType="USERDEFINED", ObjectType="Corridor partition")
                groups["partitions_c"].append(wall)
                here.append(wall)
                opening = r.box("IfcOpeningElement", f"Opening {tag}-{i + 1}", wall.ObjectPlacement, (2500.0, -50.0, 0.0), (1000.0, 200.0, 2100.0), PredefinedType="OPENING")
                f.create_entity("IfcRelVoidsElement", GlobalId=gid(), RelatingBuildingElement=wall, RelatedOpeningElement=opening)
                door = f.create_entity(
                    "IfcDoor",
                    GlobalId=gid(),
                    Name=f"Door {tag}-{i + 1}",
                    ObjectPlacement=r.place(place, (XS[i] + 2500.0, YS[2] - 50.0, SLAB)),
                    Representation=r.body([door_item], "MappedRepresentation"),
                    OverallHeight=2100.0,
                    OverallWidth=1000.0,
                    # No PredefinedType on the occurrence: the type's DOOR is the effective one.
                )
                f.create_entity("IfcRelFillsElement", GlobalId=gid(), RelatingOpeningElement=opening, RelatedBuildingElement=door)
                groups["doors"].append(door)
                here.append(door)

            # Partitions along the inner number lines, one a bay, USERDEFINED with their ObjectType.
            for x in XS[1:-1]:
                for j in range(len(YS) - 1):
                    wall = r.box("IfcWall", f"Partition {tag}-{x / 1000:.0f}-{j + 1}", place, (x - 50.0, YS[j], SLAB), (100.0, BAY, CLEAR), PredefinedType="USERDEFINED", ObjectType="Acoustic partition")
                    groups["partitions_x"].append(wall)
                    here.append(wall)

            for i, x in enumerate(XS):
                for j, y in enumerate(YS):
                    column = r.box("IfcColumn", f"Column {tag}-{LETTERS[j]}{NUMBERS[i]}", place, (x - 200.0, y - 200.0, SLAB), (400.0, 400.0, CLEAR))
                    groups["columns"].append(column)
                    here.append(column)
        else:
            # A parapet round the roof, 1.1 m.
            for i in range(len(XS) - 1):
                for y_edge, side in ((0.0, "S"), (YS[-1] - 200.0, "N")):
                    wall = r.box("IfcWall", f"Parapet {tag}-{side}{i + 1}", place, (XS[i], y_edge, SLAB), (BAY, 200.0, 1100.0), PredefinedType="PARAPET")
                    groups["parapets"].append(wall)
                    here.append(wall)
            for x_edge, side in ((0.0, "W"), (XS[-1] - 200.0, "E")):
                for j in range(len(YS) - 1):
                    wall = r.box("IfcWall", f"Parapet {tag}-{side}{j + 1}", place, (x_edge, YS[j], SLAB), (200.0, BAY, 1100.0), PredefinedType="PARAPET")
                    groups["parapets"].append(wall)
                    here.append(wall)

        # One slab a bay.
        for i in range(len(XS) - 1):
            for j in range(len(YS) - 1):
                slab = r.box("IfcSlab", f"Slab {tag}-{LETTERS[j]}{NUMBERS[i]}", place, (XS[i], YS[j], 0.0), (BAY, BAY, SLAB), PredefinedType="ROOF" if roof else "FLOOR")
                groups["slabs"].append(slab)
                here.append(slab)

        # Beams under every floor but the ground's, on every grid line.
        if level > 0:
            for x in XS:
                for j in range(len(YS) - 1):
                    beam = r.box("IfcBeam", f"Beam {tag}-{x / 1000:.0f}-{j + 1}", place, (x - 150.0, YS[j], -600.0), (300.0, BAY, 600.0))
                    groups["beams"].append(beam)
                    here.append(beam)
            for y in YS:
                for i in range(len(XS) - 1):
                    beam = r.box("IfcBeam", f"Beam {tag}-{y / 1000:.0f}-{i + 1}x", place, (XS[i], y - 150.0, -600.0), (BAY, 300.0, 600.0))
                    groups["beams"].append(beam)
                    here.append(beam)

        # Pad footings under the ground-floor columns.
        if level == 0:
            for x in XS:
                for y in YS:
                    footing = r.box("IfcFooting", "Pad footing", place, (x - 750.0, y - 750.0, -1000.0), (1500.0, 1500.0, 1000.0), PredefinedType="PAD_FOOTING")
                    groups["footings"].append(footing)
                    here.append(footing)

        if level == 0:
            here.append(grid)
        fx.contain(storey, here)

        # A space a bay, aggregated by the storey.
        if not roof:
            spaces = []
            for i in range(len(XS) - 1):
                for j in range(len(YS) - 1):
                    space = r.box("IfcSpace", f"{level:02d}{i + 1}{j + 1}", place, (XS[i] + 100.0, YS[j] + 100.0, SLAB), (BAY - 200.0, BAY - 200.0, 3100.0), PredefinedType="INTERNAL", LongName="Office", CompositionType="ELEMENT")
                    spaces.append(space)
            groups["spaces"].extend(spaces)
            fx.aggregate(storey, spaces)

    # ── types, sets, quantities, materials, classification ──
    r.typed(wall_type, groups["ext_walls"])
    r.typed(partition_type, groups["partitions_c"] + groups["partitions_x"])
    r.typed(column_type, groups["columns"])
    r.typed(beam_type, groups["beams"])
    r.typed(slab_type, groups["slabs"])
    r.typed(window_type, groups["windows"])
    r.typed(door_type, groups["doors"])

    r.define(groups["ext_walls"], wall_occurrence)
    r.define(groups["doors"], door_occurrence)
    first_wall = groups["ext_walls"][0]
    r.define([first_wall], r.qto("Qto_WallBaseQuantities", [("Length", "IfcQuantityLength", BAY), ("Height", "IfcQuantityLength", CLEAR), ("Width", "IfcQuantityLength", 200.0), ("GrossSideArea", "IfcQuantityArea", BAY * CLEAR / 1e6), ("NetVolume", "IfcQuantityVolume", BAY * CLEAR * 200.0 / 1e9)]))
    r.define(groups["ext_walls_x"][1:], ext_wall_qto_x)
    r.define(groups["slabs"], slab_qto)
    r.define(groups["spaces"], space_qto)
    r.define(groups["spaces"], r.pset("Pset_SpaceCommon", [("Reference", "IfcIdentifier", "Office"), ("IsExternal", "IfcBoolean", False)]))
    for element in groups["ext_walls"] + groups["partitions_c"] + groups["doors"] + groups["windows"]:
        r.mark(element, element.is_a()[3:].upper())

    r.material(groups["ext_walls"] + groups["parapets"], external_usage)
    r.material(groups["partitions_c"] + groups["partitions_x"], partition_usage)
    r.material(groups["slabs"] + groups["footings"], concrete)
    r.material(groups["columns"] + groups["beams"], steel)
    r.material(groups["windows"], glass)
    r.material(groups["doors"], timber)
    f.create_entity(
        "IfcRelAssociatesClassification",
        GlobalId=gid(),
        RelatedObjects=groups["ext_walls"],
        RelatingClassification=wall_class,
    )

    fx.write(len(storeys))


if __name__ == "__main__":
    build()
