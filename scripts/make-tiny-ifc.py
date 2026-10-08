#!/usr/bin/env python3
"""Dev utility — write the committed test fixtures: `tests/fixtures/tiny.ifc`, the smoke test's
model, `tests/fixtures/high-first.ifc`, the ground-height check's (2026-10-01), and
`tests/fixtures/georef/`, the map-space federation check's (2026-10-08).

The end-to-end test needs a file that is **committed**, so `samples/` (git-ignored, real
project models) cannot be it. This writes deterministic IFC files with nothing in them but
geometry. No project name, no address, no person or organisation — nothing that identifies
anybody — and the only site coordinates anywhere are the repository's synthetic set
(`CLAUDE.md`, Rules: site 12345.457 / 23456.766 / 5.05 m, rotation −43.4103°).

 · `tiny.ifc` — two storeys, four walls, two slabs, one property set.
 · `high-first.ifc` — a slab on the file's zero, two columns, a footing below zero and a strip of
   roof slab 12 m up, **the roof first**: web-ifc streams the slabs before the other classes
   here, and in file order, so the roof is the first product it streams and the whole-metre
   federation offset the app takes from "the first placement streamed" has Z = 12 — as it has
   on a Tekla steel export whose first part is a member high in the structure.
   `tests/unit/ground-level.test.ts` pins that premise.
 · `georef/a-…` to `georef/h-…` — **one** small building in millimetres (two storeys, five
   elements, a five-axis grid) placed at the synthetic map position in each of the ways an
   exporter writes it: (a) the site placement carries the position and the rotation, beside a
   zero-translation `IfcMapConversion` (Revit "Shared Coordinates" with an EPSG code); (b) a
   site at the file's zero and an `IfcMapConversion` that carries E / N / H and the rotation,
   `Scale` 0.001 (Revit "Project Base Point" with an EPSG code); (c) as (b) with `Scale`
   absent; (d) as (b) with `Scale` 1000; (e) as (b) with `MapUnit` the foot and E / N / H in
   feet; (f) IFC2X3 with the `ePSet_MapConversion` / `ePSet_ProjectedCRS` property sets on
   `IfcProject`; (g) the site placement carries a local offset and the rotation and the
   conversion only the survey point's E / N / H (Revit "Survey Point"), with a decoy
   conversion on a 2D `Plan` context written first; (h) as (g) with the survey point's
   conversion on the `Model` context's `Body` sub-context — legal, and the same frame. Every one
   of them puts every point of the building at the same map coordinates. `georef/ifcopenshell-map.json` is IfcOpenShell's own
   reading of where (a), (b) and (f) put each product's placement origin
   (`ifcopenshell.util.geolocation.auto_xyz2enh`) — the files whose `Scale` it reads the
   IFC4.3 way, which is the way they are written. `tests/unit/georef-federation.fixture.test.ts`
   federates every pair of them, in either boot order.

They are built with IfcOpenShell, the same reference implementation `expected-from-ifcopenshell.py`
uses as ground truth, so the fixtures the app is measured against were not written by the app's
own parser.

Deterministic on purpose: fixed GlobalIds, a fixed header timestamp and no owner history, so
re-running it produces byte-identical files and the commit does not churn.

    python3 scripts/make-tiny-ifc.py
"""
from __future__ import annotations

import json
import math
import pathlib
import sys
import uuid

try:
    import ifcopenshell
    import ifcopenshell.guid
    import ifcopenshell.util.geolocation
    import ifcopenshell.util.placement
except ImportError:  # pragma: no cover - dev utility
    sys.exit("IfcOpenShell is not installed:  pip3 install ifcopenshell")

FIXTURES = pathlib.Path(__file__).resolve().parent.parent / "tests" / "fixtures"
GEOREF = FIXTURES / "georef"
TIMESTAMP = "2026-09-18T00:00:00"

# The repository's synthetic map position (`CLAUDE.md`, Rules) — never a value from `samples/`.
SITE_E, SITE_N, SITE_H = 12345.457, 23456.766, 5.05
SITE_DEG = -43.4103
FOOT = 0.3048

_counter = 0


def gid() -> str:
    """A stable GlobalId, in the IFC base-64 alphabet, from a counter rather than the clock."""
    global _counter
    _counter += 1
    return ifcopenshell.guid.compress(uuid.UUID(int=_counter).hex)


class Fixture:
    """One file's scaffold: header, units, a body context, and Project → Site → Building.

    Every keyword's default is what `tiny.ifc` and `high-first.ifc` were written with, so those
    two stay byte-identical: IFC4, metres, a site at the file's zero, no `TrueNorth`, one
    context. The georeferencing fixtures (2026-10-08) set them.
    """

    def __init__(
        self,
        file_name: str,
        project_name: str,
        *,
        out_dir: pathlib.Path = FIXTURES,
        schema: str = "IFC4",
        millimetres: bool = False,
        site_at: tuple[float, float, float] = (0.0, 0.0, 0.0),
        site_deg: float | None = None,
        true_north: tuple[float, float] | None = None,
        plan_context: bool = False,
    ) -> None:
        global _counter
        _counter = 0  # every file numbers its own GlobalIds from 1
        self.out = out_dir / file_name
        self.schema = schema
        f = self.f = ifcopenshell.file(schema=schema)
        f.header.file_description.description = ("ViewDefinition [CoordinationView]",)
        f.header.file_name.name = file_name
        f.header.file_name.time_stamp = TIMESTAMP
        f.header.file_name.author = ("SGVue test fixture",)
        f.header.file_name.organization = ("SGVue",)
        f.header.file_name.preprocessor_version = "scripts/make-tiny-ifc.py"
        f.header.file_name.originating_system = "IfcOpenShell"
        f.header.file_name.authorization = "none"

        # ── units: metres, so nothing here exercises a unit conversion by accident — or, for the
        #    georeferencing fixtures, millimetres, which is what a Revit export writes ──
        length = (
            f.create_entity("IfcSIUnit", UnitType="LENGTHUNIT", Prefix="MILLI", Name="METRE")
            if millimetres
            else f.create_entity("IfcSIUnit", UnitType="LENGTHUNIT", Name="METRE")
        )
        units = f.create_entity(
            "IfcUnitAssignment",
            Units=[
                length,
                f.create_entity("IfcSIUnit", UnitType="AREAUNIT", Name="SQUARE_METRE"),
                f.create_entity("IfcSIUnit", UnitType="VOLUMEUNIT", Name="CUBIC_METRE"),
                f.create_entity("IfcSIUnit", UnitType="PLANEANGLEUNIT", Name="RADIAN"),
            ],
        )

        north = (
            {"TrueNorth": f.create_entity("IfcDirection", DirectionRatios=true_north)}
            if true_north
            else {}
        )
        model = self.model = f.create_entity(
            "IfcGeometricRepresentationContext",
            ContextType="Model",
            CoordinateSpaceDimension=3,
            Precision=1e-5,
            WorldCoordinateSystem=self.axis(),
            **north,
        )
        self.body = f.create_entity(
            "IfcGeometricRepresentationSubContext",
            ContextIdentifier="Body",
            ContextType="Model",
            ParentContext=model,
            TargetView="MODEL_VIEW",
        )
        contexts = [model]
        if plan_context:
            # A 2D context of its own — what a decoy map conversion hangs off (fixture g).
            self.plan = f.create_entity(
                "IfcGeometricRepresentationContext",
                ContextType="Plan",
                CoordinateSpaceDimension=2,
                Precision=1e-5,
                WorldCoordinateSystem=f.create_entity(
                    "IfcAxis2Placement2D", Location=self.point2(0.0, 0.0)
                ),
            )
            contexts.append(self.plan)

        self.project = project = f.create_entity(
            "IfcProject",
            GlobalId=gid(),
            Name=project_name,
            UnitsInContext=units,
            RepresentationContexts=contexts,
        )
        site_place = f.create_entity(
            "IfcLocalPlacement", RelativePlacement=self.axis(*site_at, deg=site_deg)
        )
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

    def point2(self, x: float, y: float):
        return self.f.create_entity("IfcCartesianPoint", Coordinates=(float(x), float(y)))

    def axis(self, x: float = 0.0, y: float = 0.0, z: float = 0.0, deg: float | None = None):
        """A placement at (x, y, z), turned `deg` about +Z when given (`Axis` and `RefDirection`)."""
        if deg is None:
            return self.f.create_entity("IfcAxis2Placement3D", Location=self.point(x, y, z))
        a = math.radians(deg)
        return self.f.create_entity(
            "IfcAxis2Placement3D",
            Location=self.point(x, y, z),
            Axis=self.f.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)),
            RefDirection=self.f.create_entity("IfcDirection", DirectionRatios=(math.cos(a), math.sin(a), 0.0)),
        )

    def aggregate(self, parent, children) -> None:
        self.f.create_entity(
            "IfcRelAggregates",
            GlobalId=gid(),
            RelatingObject=parent,
            RelatedObjects=list(children),
        )

    def solid(self, dx: float, dy: float, dz: float):
        f = self.f
        # IFC2X3 makes a parameterised profile's `Position` mandatory; IFC4 leaves it optional,
        # and the IFC4 files keep leaving it out.
        position = (
            {"Position": f.create_entity("IfcAxis2Placement2D", Location=self.point2(0.0, 0.0))}
            if self.schema == "IFC2X3"
            else {}
        )
        profile = f.create_entity(
            "IfcRectangleProfileDef", ProfileType="AREA", XDim=float(dx), YDim=float(dy), **position
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

    def grid(self, place, u_axes, v_axes):
        """An `IfcGrid` at `place` with no representation: each axis is (tag, (x0, y0), (x1, y1))."""
        f = self.f

        def axis(tag, a, b):
            curve = f.create_entity("IfcPolyline", Points=[self.point2(*a), self.point2(*b)])
            return f.create_entity("IfcGridAxis", AxisTag=tag, AxisCurve=curve, SameSense=True)

        u = [axis(*x) for x in u_axes]
        v = [axis(*x) for x in v_axes]
        return f.create_entity(
            "IfcGrid",
            GlobalId=gid(),
            Name="Grid",
            ObjectPlacement=f.create_entity(
                "IfcLocalPlacement", PlacementRelTo=place, RelativePlacement=self.axis()
            ),
            UAxes=u,
            VAxes=v,
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


# ─────────────── 2026-10-08: one building, every way of saying where it is ───────────────

SITE_MM = (12345457.0, 23456766.0, 5050.0)
COS, SIN = math.cos(math.radians(SITE_DEG)), math.sin(math.radians(SITE_DEG))
# What a Revit export writes for "no rotation": the cosine and sine of π/2, swapped.
REVIT_ORDINATE = 6.123233995736766e-17


def georef_building(fx: Fixture) -> None:
    """The one building every georeferencing fixture holds, in millimetres, created in the same
    order in every file — so each element, storey and the grid keep one GlobalId across all of
    them. Asymmetric on purpose (two walls, one column off-centre), so a turn or a mirror shows."""
    ifc4 = fx.schema != "IFC2X3"

    def kind(value: str) -> dict:
        # IFC2X3's IfcWall and IfcColumn have no PredefinedType.
        return {"PredefinedType": value} if ifc4 else {}

    level1, place1 = fx.storey("Level 1", 0.0)
    level2, place2 = fx.storey("Level 2", 4000.0)
    first = [
        fx.element("IfcSlab", "Slab L1", place1, (0.0, 0.0, 0.0), (20000.0, 12000.0, 200.0), PredefinedType="FLOOR"),
        fx.element("IfcWall", "Wall S", place1, (0.0, 0.0, 200.0), (20000.0, 200.0, 3800.0), **kind("SOLIDWALL")),
        fx.element("IfcWall", "Wall W", place1, (0.0, 200.0, 200.0), (200.0, 11800.0, 3800.0), **kind("SOLIDWALL")),
        fx.element("IfcColumn", "Column C2", place1, (14800.0, 7800.0, 200.0), (400.0, 400.0, 3800.0), **kind("COLUMN")),
    ]
    grid = fx.grid(
        place1,
        [(tag, (x, -2000.0), (x, 14000.0)) for tag, x in (("A", 0.0), ("B", 10000.0), ("C", 20000.0))],
        [(tag, (-2000.0, y), (22000.0, y)) for tag, y in (("1", 0.0), ("2", 12000.0))],
    )
    second = [fx.element("IfcSlab", "Slab L2", place2, (0.0, 0.0, 0.0), (20000.0, 12000.0, 200.0), PredefinedType="FLOOR")]
    fx.contain(level1, first + [grid])
    fx.contain(level2, second)
    fx.aggregate(fx.building, [level1, level2])


def projected_crs(fx: Fixture, unit=None):
    """`EPSG:3414`, and a `MapUnit` only when one is given — Revit usually writes none."""
    return fx.f.create_entity(
        "IfcProjectedCRS",
        Name="EPSG:3414",
        Description="SVY21 / Singapore TM",
        GeodeticDatum="SVY21",
        **({"MapUnit": unit} if unit is not None else {}),
    )


def map_conversion(fx: Fixture, source, crs, e, n, h, abscissa, ordinate, scale):
    return fx.f.create_entity(
        "IfcMapConversion",
        SourceCRS=source,
        TargetCRS=crs,
        Eastings=float(e),
        Northings=float(n),
        OrthogonalHeight=float(h),
        XAxisAbscissa=float(abscissa),
        XAxisOrdinate=float(ordinate),
        **({"Scale": float(scale)} if scale is not None else {}),
    )


def georef_conversion(name: str, scale: float | None, foot: bool = False) -> None:
    """(b)–(e): the site at the file's zero, the map position and the turn in `IfcMapConversion`."""
    # Revit derives TrueNorth and the conversion's X axis from one angle; it is stated here too,
    # so a reader that stacked it on the conversion would turn the building twice.
    fx = Fixture(name, "Georef", out_dir=GEOREF, millimetres=True, true_north=(SIN, COS))
    georef_building(fx)
    f = fx.f
    unit = None
    k = 1.0
    if foot:
        metre = f.create_entity("IfcSIUnit", UnitType="LENGTHUNIT", Name="METRE")
        unit = f.create_entity(
            "IfcConversionBasedUnit",
            Dimensions=f.create_entity("IfcDimensionalExponents", 1, 0, 0, 0, 0, 0, 0),
            UnitType="LENGTHUNIT",
            Name="FOOT",
            ConversionFactor=f.create_entity(
                "IfcMeasureWithUnit",
                ValueComponent=f.create_entity("IfcLengthMeasure", FOOT),
                UnitComponent=metre,
            ),
        )
        k = 1.0 / FOOT
    crs = projected_crs(fx, unit)
    map_conversion(fx, fx.model, crs, SITE_E * k, SITE_N * k, SITE_H * k, COS, SIN, scale)
    fx.write(2)


def georef_site() -> None:
    """(a) Revit "Shared Coordinates" with an EPSG code: the site carries everything, in mm."""
    fx = Fixture(
        "a-site-placement.ifc", "Georef", out_dir=GEOREF, millimetres=True,
        site_at=SITE_MM, site_deg=SITE_DEG, true_north=(REVIT_ORDINATE, 1.0),
    )
    georef_building(fx)
    map_conversion(fx, fx.model, projected_crs(fx), 0.0, 0.0, 0.0, 1.0, REVIT_ORDINATE, 0.001)
    fx.write(2)


def georef_epset() -> None:
    """(f) IFC2X3: the bSI guide's two property sets, on `IfcProject`, in its own spelling."""
    fx = Fixture("f-ifc2x3-epset.ifc", "Georef", out_dir=GEOREF, schema="IFC2X3", millimetres=True)
    georef_building(fx)
    f = fx.f

    def pset(name: str, values: list[tuple[str, str, object]]) -> None:
        props = [
            f.create_entity("IfcPropertySingleValue", Name=key, NominalValue=f.create_entity(kind, value))
            for key, kind, value in values
        ]
        f.create_entity(
            "IfcRelDefinesByProperties",
            GlobalId=gid(),
            RelatedObjects=[fx.project],
            RelatingPropertyDefinition=f.create_entity(
                "IfcPropertySet", GlobalId=gid(), Name=name, HasProperties=props
            ),
        )

    pset(
        "ePSet_MapConversion",
        [
            ("Eastings", "IfcLengthMeasure", SITE_E),
            ("Northings", "IfcLengthMeasure", SITE_N),
            ("OrthogonalHeight", "IfcLengthMeasure", SITE_H),
            ("XAxisAbscissa", "IfcReal", COS),
            ("XAxisOrdinate", "IfcReal", SIN),
            ("Scale", "IfcReal", 0.001),
        ],
    )
    # A property set cannot hold an IfcNamedUnit, so the OSArch template writes the map unit's
    # name as an identifier; the bSI guide has no MapUnit at all.
    pset(
        "ePSet_ProjectedCRS",
        [
            ("Name", "IfcLabel", "EPSG:3414"),
            ("Description", "IfcText", "SVY21 / Singapore TM"),
            ("GeodeticDatum", "IfcIdentifier", "SVY21"),
            ("MapUnit", "IfcIdentifier", "METRE"),
        ],
    )
    fx.write(2)


def georef_survey_point(name: str, on_body: bool = False) -> None:
    """(g) Revit "Survey Point": a local site offset that carries the turn, the survey point's
    E / N / H in the conversion, `MapUnit` stated as the metre — and a decoy conversion on a 2D
    `Plan` context, written first, so "the first IfcMapConversion" is the wrong one. (h) the
    same, with the survey point's conversion on the `Model` context's `Body` sub-context."""
    offset = (-8000.0, 3000.0, 0.0)
    fx = Fixture(
        name, "Georef", out_dir=GEOREF, millimetres=True,
        site_at=offset, site_deg=SITE_DEG, plan_context=True,
    )
    georef_building(fx)
    f = fx.f
    map_conversion(fx, fx.plan, projected_crs(fx), 99999.0, 99999.0, 0.0, 0.0, 1.0, 0.001)
    metre = f.create_entity("IfcSIUnit", UnitType="LENGTHUNIT", Name="METRE")
    map_conversion(
        fx, fx.body if on_body else fx.model, projected_crs(fx, metre),
        SITE_E - offset[0] / 1000.0, SITE_N - offset[1] / 1000.0, SITE_H - offset[2] / 1000.0,
        1.0, REVIT_ORDINATE, 0.001,
    )
    fx.write(2)


def ifcopenshell_map(names: list[str]) -> None:
    """IfcOpenShell's own reading: each product's placement origin, through
    `ifcopenshell.util.geolocation.auto_xyz2enh`, in map units (metres here). Only for files
    whose `Scale` it reads correctly — it trusts `Scale`, so (c), (d) and (e) would disagree with
    it by design, and it takes the first conversion, so (g) and (h) would read the decoy. The
    file names no IfcOpenShell version, so a run under another one does not churn it."""
    out: dict[str, dict[str, list[float]]] = {}
    for name in names:
        f = ifcopenshell.open(str(GEOREF / name))
        points: dict[str, list[float]] = {}
        for product in f.by_type("IfcProduct"):
            if not product.ObjectPlacement:
                continue
            m = ifcopenshell.util.placement.get_local_placement(product.ObjectPlacement)
            enh = ifcopenshell.util.geolocation.auto_xyz2enh(f, *[float(v) for v in m[:3, 3]])
            points[product.GlobalId] = [round(float(v), 6) for v in enh]
        out[name] = dict(sorted(points.items()))
    path = GEOREF / "ifcopenshell-map.json"
    doc = {
        "generatedBy": "IfcOpenShell · util.geolocation.auto_xyz2enh",
        "what": "Each product's ObjectPlacement origin in map coordinates (E, N, H, metres), by GlobalId.",
        "files": out,
    }
    path.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {path}")


def georef() -> None:
    georef_site()
    georef_conversion("b-map-conversion.ifc", 0.001)
    georef_conversion("c-scale-absent.ifc", None)
    georef_conversion("d-scale-1000.ifc", 1000.0)
    georef_conversion("e-map-unit-foot.ifc", 0.001, foot=True)
    georef_epset()
    georef_survey_point("g-survey-point.ifc")
    georef_survey_point("h-sub-context.ifc", on_body=True)
    ifcopenshell_map(["a-site-placement.ifc", "b-map-conversion.ifc", "f-ifc2x3-epset.ifc"])


def main() -> None:
    tiny()
    high_first()
    georef()


if __name__ == "__main__":
    main()
