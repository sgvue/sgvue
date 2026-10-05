#!/usr/bin/env python3
"""Dev utility — write the committed test fixtures: `tests/fixtures/tiny.ifc`, the smoke test's
model, and `tests/fixtures/high-first.ifc`, the ground-height check's (2026-10-01).

The end-to-end test needs a file that is **committed**, so `samples/` (git-ignored, real
project models) cannot be it. This writes deterministic IFC4 files with nothing in them but
geometry. No project name, no address, no site coordinates, no person or organisation — nothing
that identifies anybody.

 · `tiny.ifc` — two storeys, four walls, two slabs, one property set.
 · `high-first.ifc` — a slab on the file's zero, two columns, a footing below zero and a strip of
   roof slab 12 m up, **the roof first**: web-ifc streams the slabs before the other classes
   here, and in file order, so the roof is the first product it streams and the whole-metre
   federation offset the app takes from "the first placement streamed" has Z = 12 — as it has
   on a Tekla steel export whose first part is a member high in the structure.
   `tests/unit/ground-level.test.ts` pins that premise.

They are built with IfcOpenShell, the same reference implementation `expected-from-ifcopenshell.py`
uses as ground truth, so the fixtures the app is measured against were not written by the app's
own parser.

Deterministic on purpose: fixed GlobalIds, a fixed header timestamp and no owner history, so
re-running it produces byte-identical files and the commit does not churn.

    python3 scripts/make-tiny-ifc.py
"""
from __future__ import annotations

import pathlib
import sys
import uuid

try:
    import ifcopenshell
    import ifcopenshell.guid
except ImportError:  # pragma: no cover - dev utility
    sys.exit("IfcOpenShell is not installed:  pip3 install ifcopenshell")

FIXTURES = pathlib.Path(__file__).resolve().parent.parent / "tests" / "fixtures"
TIMESTAMP = "2026-09-18T00:00:00"

_counter = 0


def gid() -> str:
    """A stable GlobalId, in the IFC base-64 alphabet, from a counter rather than the clock."""
    global _counter
    _counter += 1
    return ifcopenshell.guid.compress(uuid.UUID(int=_counter).hex)


class Fixture:
    """One file's scaffold: header, metres, a body context, and Project → Site → Building."""

    def __init__(self, file_name: str, project_name: str) -> None:
        global _counter
        _counter = 0  # every file numbers its own GlobalIds from 1
        self.out = FIXTURES / file_name
        f = self.f = ifcopenshell.file(schema="IFC4")
        f.header.file_description.description = ("ViewDefinition [CoordinationView]",)
        f.header.file_name.name = file_name
        f.header.file_name.time_stamp = TIMESTAMP
        f.header.file_name.author = ("SGVue test fixture",)
        f.header.file_name.organization = ("SGVue",)
        f.header.file_name.preprocessor_version = "scripts/make-tiny-ifc.py"
        f.header.file_name.originating_system = "IfcOpenShell"
        f.header.file_name.authorization = "none"

        # ── units: metres, so nothing here exercises a unit conversion by accident ──
        units = f.create_entity(
            "IfcUnitAssignment",
            Units=[
                f.create_entity("IfcSIUnit", UnitType="LENGTHUNIT", Name="METRE"),
                f.create_entity("IfcSIUnit", UnitType="AREAUNIT", Name="SQUARE_METRE"),
                f.create_entity("IfcSIUnit", UnitType="VOLUMEUNIT", Name="CUBIC_METRE"),
                f.create_entity("IfcSIUnit", UnitType="PLANEANGLEUNIT", Name="RADIAN"),
            ],
        )

        model = f.create_entity(
            "IfcGeometricRepresentationContext",
            ContextType="Model",
            CoordinateSpaceDimension=3,
            Precision=1e-5,
            WorldCoordinateSystem=self.axis(),
        )
        self.body = f.create_entity(
            "IfcGeometricRepresentationSubContext",
            ContextIdentifier="Body",
            ContextType="Model",
            ParentContext=model,
            TargetView="MODEL_VIEW",
        )

        project = f.create_entity(
            "IfcProject",
            GlobalId=gid(),
            Name=project_name,
            UnitsInContext=units,
            RepresentationContexts=[model],
        )
        site_place = f.create_entity("IfcLocalPlacement", RelativePlacement=self.axis())
        site = f.create_entity(
            "IfcSite", GlobalId=gid(), Name="Site", ObjectPlacement=site_place, CompositionType="ELEMENT"
        )
        self.bldg_place = f.create_entity(
            "IfcLocalPlacement", PlacementRelTo=site_place, RelativePlacement=self.axis()
        )
        self.building = f.create_entity(
            "IfcBuilding",
            GlobalId=gid(),
            Name="Building",
            ObjectPlacement=self.bldg_place,
            CompositionType="ELEMENT",
        )
        self.aggregate(project, [site])
        self.aggregate(site, [self.building])

    def point(self, x: float, y: float, z: float):
        return self.f.create_entity("IfcCartesianPoint", Coordinates=(float(x), float(y), float(z)))

    def axis(self, x: float = 0.0, y: float = 0.0, z: float = 0.0):
        return self.f.create_entity("IfcAxis2Placement3D", Location=self.point(x, y, z))

    def aggregate(self, parent, children) -> None:
        self.f.create_entity(
            "IfcRelAggregates",
            GlobalId=gid(),
            RelatingObject=parent,
            RelatedObjects=list(children),
        )

    def solid(self, dx: float, dy: float, dz: float):
        f = self.f
        profile = f.create_entity(
            "IfcRectangleProfileDef", ProfileType="AREA", XDim=float(dx), YDim=float(dy)
        )
        extruded = f.create_entity(
            "IfcExtrudedAreaSolid",
            SweptArea=profile,
            Position=self.axis(dx / 2.0, dy / 2.0, 0.0),
            ExtrudedDirection=f.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)),
            Depth=float(dz),
        )
        shape = f.create_entity(
            "IfcShapeRepresentation",
            ContextOfItems=self.body,
            RepresentationIdentifier="Body",
            RepresentationType="SweptSolid",
            Items=[extruded],
        )
        return f.create_entity("IfcProductDefinitionShape", Representations=[shape])

    def storey(self, name: str, elevation: float):
        """A storey and its placement, `elevation` metres above the building's."""
        place = self.f.create_entity(
            "IfcLocalPlacement",
            PlacementRelTo=self.bldg_place,
            RelativePlacement=self.axis(0.0, 0.0, elevation),
        )
        storey = self.f.create_entity(
            "IfcBuildingStorey",
            GlobalId=gid(),
            Name=name,
            ObjectPlacement=place,
            CompositionType="ELEMENT",
            Elevation=elevation,
        )
        return storey, place

    def element(self, entity: str, name: str, place, at, size, **attributes):
        """One box-shaped element: `size` (dx, dy, dz) with its corner `at` (x, y, z) from `place`."""
        return self.f.create_entity(
            entity,
            GlobalId=gid(),
            Name=name,
            ObjectPlacement=self.f.create_entity(
                "IfcLocalPlacement", PlacementRelTo=place, RelativePlacement=self.axis(*at)
            ),
            Representation=self.solid(*size),
            **attributes,
        )

    def contain(self, storey, elements) -> None:
        self.f.create_entity(
            "IfcRelContainedInSpatialStructure",
            GlobalId=gid(),
            RelatingStructure=storey,
            RelatedElements=list(elements),
        )

    def write(self, storeys: int) -> None:
        self.out.parent.mkdir(parents=True, exist_ok=True)
        self.f.write(str(self.out))
        elements = self.f.by_type("IfcElement")
        print(f"wrote {self.out} — {self.out.stat().st_size} bytes, {len(elements)} elements, {storeys} storeys")


def tiny() -> None:
    fx = Fixture("tiny.ifc", "Tiny")
    f = fx.f

    storeys = []
    contained: list[list] = []
    for i, elevation in enumerate((0.0, 3.2)):
        storey, place = fx.storey(f"Level {i + 1}", elevation)
        storeys.append(storey)

        here: list = []
        # One slab, 6 × 4 × 0.2 m, at the storey's own level.
        here.append(
            fx.element("IfcSlab", f"Slab L{i + 1}", place, (0.0, 0.0, 0.0), (6.0, 4.0, 0.2), PredefinedType="FLOOR")
        )
        # Two walls, 6 × 0.2 × 3 m, along the long sides.
        for j, y in enumerate((0.0, 3.8)):
            here.append(
                fx.element(
                    "IfcWall", f"Wall L{i + 1}-{j + 1}", place, (0.0, y, 0.2), (6.0, 0.2, 3.0),
                    PredefinedType="SOLIDWALL",
                )
            )
        contained.append(here)
        fx.contain(storey, here)

    fx.aggregate(fx.building, storeys)

    # One property set, so the smoke test proves the property path as well as the geometry.
    pset = f.create_entity(
        "IfcPropertySet",
        GlobalId=gid(),
        Name="Pset_WallCommon",
        HasProperties=[
            f.create_entity(
                "IfcPropertySingleValue",
                Name="IsExternal",
                NominalValue=f.create_entity("IfcBoolean", True),
            ),
            f.create_entity(
                "IfcPropertySingleValue",
                Name="LoadBearing",
                NominalValue=f.create_entity("IfcBoolean", False),
            ),
        ],
    )
    f.create_entity(
        "IfcRelDefinesByProperties",
        GlobalId=gid(),
        RelatedObjects=[contained[0][1], contained[0][2]],
        RelatingPropertyDefinition=pset,
    )

    fx.write(len(storeys))


def high_first() -> None:
    """The first product streamed is the highest: a roof 12 m above a slab on the file's zero."""
    fx = Fixture("high-first.ifc", "High first")

    level, level_place = fx.storey("Level 1", 0.0)
    roof, roof_place = fx.storey("Roof", 12.0)

    # Written first, and a slab — the class web-ifc streams first here — so it is the first
    # product streamed. A strip along one long side, 6 × 0.8 × 0.2 m, 12 m up: seen in plan it
    # leaves the middle of the floor slab uncovered, which is where the smoke test looks.
    above = fx.element("IfcSlab", "Roof slab", roof_place, (0.0, 0.0, 0.0), (6.0, 0.8, 0.2), PredefinedType="ROOF")
    below = [
        # A slab on the file's zero, 6 × 4 × 0.2 m: what the ground has to be under.
        fx.element("IfcSlab", "Slab L1", level_place, (0.0, 0.0, 0.0), (6.0, 4.0, 0.2), PredefinedType="FLOOR"),
        # Two columns under the roof's ends, from the slab's top to the roof.
        fx.element("IfcColumn", "Column 1", level_place, (0.0, 0.0, 0.2), (0.2, 0.2, 11.8), PredefinedType="COLUMN"),
        fx.element("IfcColumn", "Column 2", level_place, (5.8, 0.0, 0.2), (0.2, 0.2, 11.8), PredefinedType="COLUMN"),
        # One footing below zero, so the model's box spans the file's zero rather than ending on it.
        fx.element("IfcFooting", "Footing", level_place, (0.0, 0.0, -1.0), (1.0, 1.0, 1.0), PredefinedType="PAD_FOOTING"),
    ]
    fx.contain(roof, [above])
    fx.contain(level, below)
    fx.aggregate(fx.building, [level, roof])

    fx.write(2)


def main() -> None:
    tiny()
    high_first()


if __name__ == "__main__":
    main()
