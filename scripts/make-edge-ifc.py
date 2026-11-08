#!/usr/bin/env python3
"""Dev utility — write `tests/fixtures/edge.ifc`, the Schedules oracle's edge-case model (2026-11-08).

`tests/unit/schedule/oracle.test.ts` checks every cell of the Schedules window against what
IfcOpenShell reads from `reference.ifc` and `feet.ifc`. Neither holds the value shapes and names
a real export brings, so the oracle could not see them. This small model holds them, and nothing
else:

 · type names in Revit's **`Family:Type`** form — one colon, two colons (`A:B:C`) and none — and an
   untyped occurrence whose own `ObjectType` carries the colon;
 · property values of every non-single shape: a **list** (labels, and lengths), an **enumerated**
   value (one item and two), a **bounded** value (lower, upper and set point; and an upper only);
 · a **blank** label and the placeholders **`-`** and **`n/a`**;
 · a **mass** quantity in pounds (a conversion-based `MASSUNIT` over the kilogram) and a **count**
   quantity;
 · a thermal transmittance in a **non-SI derived unit**, W / (ft² · K);
 · a **mass per length** and a **rotational mass**, compound measures with no unit assigned, whose
   names contain a length and a mass;
 · a piece of furniture **contained in an `IfcSpace`**, which the storey aggregates, and a wall
   contained in the building with no storey at all.

Millimetres, at the repository's synthetic site (`CLAUDE.md`, Rules: 12345.457 / 23456.766 /
5.05 m, −43.4103°) — nothing here is a real place, project, person or organisation. Deterministic:
GlobalIds from a counter and a fixed header timestamp, so re-running it writes a byte-identical
file. The scaffold is `make-tiny-ifc.py`'s own `Fixture`.

    python3 scripts/make-edge-ifc.py
    python3 scripts/expected-from-ifcopenshell.py --cells-only tests/fixtures/edge.ifc
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
POUND = 0.45359237  # kilograms
FOOT = tiny.FOOT


def build() -> None:
    fx = tiny.Fixture(
        "edge.ifc",
        "Edge",
        millimetres=True,
        site_at=tiny.SITE_MM,
        site_deg=tiny.SITE_DEG,
        true_north=(tiny.REVIT_ORDINATE, 1.0),
    )
    f = fx.f
    f.header.file_name.preprocessor_version = "scripts/make-edge-ifc.py"

    # ── two more units: pounds, and W / (ft² · K) ──
    pound = f.create_entity(
        "IfcConversionBasedUnit",
        Dimensions=f.create_entity("IfcDimensionalExponents", 0, 1, 0, 0, 0, 0, 0),
        UnitType="MASSUNIT",
        Name="POUND",
        ConversionFactor=f.create_entity(
            "IfcMeasureWithUnit",
            ValueComponent=f.create_entity("IfcMassMeasure", POUND),
            UnitComponent=f.create_entity("IfcSIUnit", UnitType="MASSUNIT", Prefix="KILO", Name="GRAM"),
        ),
    )
    foot = fx.conversion("LENGTHUNIT", "FOOT", 1, "IfcLengthMeasure", FOOT, "METRE")
    u_value = f.create_entity(
        "IfcDerivedUnit",
        Elements=[
            f.create_entity(
                "IfcDerivedUnitElement",
                Unit=f.create_entity("IfcSIUnit", UnitType="POWERUNIT", Name="WATT"),
                Exponent=1,
            ),
            f.create_entity("IfcDerivedUnitElement", Unit=foot, Exponent=-2),
            f.create_entity(
                "IfcDerivedUnitElement",
                Unit=f.create_entity("IfcSIUnit", UnitType="THERMODYNAMICTEMPERATUREUNIT", Name="KELVIN"),
                Exponent=-1,
            ),
        ],
        UnitType="THERMALTRANSMITTANCEUNIT",
    )
    assignment = fx.project.UnitsInContext
    assignment.Units = list(assignment.Units) + [pound, u_value]

    # ── spatial structure ──
    level0, place0 = fx.storey("Level 00", 0.0)
    level1, place1 = fx.storey("Level 01", 3500.0)
    fx.aggregate(fx.building, [level0, level1])
    space = fx.element(
        "IfcSpace", "S01", place0, (0.0, 0.0, 0.0), (5000.0, 4000.0, 3000.0),
        LongName="Meeting room", CompositionType="ELEMENT", PredefinedType="INTERNAL",
    )
    fx.aggregate(level0, [space])

    # ── types, in each Family:Type form ──
    def wall_type(name: str):
        return f.create_entity("IfcWallType", GlobalId=gid(), Name=name, PredefinedType="SOLIDWALL")

    one_colon = wall_type("Basic Wall:Generic 200")
    two_colons = wall_type("A:B:C")
    no_colon = wall_type("Plain")

    def wall(name: str, place, x: float, **attributes):
        return fx.element("IfcWall", name, place, (x, 0.0, 0.0), (4000.0, 200.0, 3000.0), **attributes)

    w1 = wall("Wall one colon", place0, 0.0, ObjectType="occurrence text the type name wins over", PredefinedType="SOLIDWALL")
    w2 = wall("Wall two colons", place0, 5000.0, PredefinedType="SOLIDWALL")
    w3 = wall("Wall no colon", place1, 0.0, PredefinedType="SOLIDWALL")
    w4 = wall("Wall untyped", place1, 5000.0, ObjectType="Curtain:Panel 1", PredefinedType="USERDEFINED")
    loose = wall("Wall in no storey", fx.bldg_place, 10000.0, PredefinedType="SOLIDWALL")
    table = fx.element(
        "IfcFurniture", "Table 1", place0, (1000.0, 1000.0, 0.0), (1800.0, 900.0, 750.0), PredefinedType="TABLE"
    )

    for type_object, occurrence in ((one_colon, w1), (two_colons, w2), (no_colon, w3)):
        f.create_entity("IfcRelDefinesByType", GlobalId=gid(), RelatedObjects=[occurrence], RelatingType=type_object)
    fx.contain(level0, [w1, w2])
    fx.contain(level1, [w3, w4])
    fx.contain(fx.building, [loose])
    fx.contain(space, [table])

    # ── every value shape ──
    def v(measure: str, value):
        return f.create_entity(measure, value)

    def single(name: str, measure: str, value):
        return f.create_entity("IfcPropertySingleValue", Name=name, NominalValue=v(measure, value))

    def define(elements, definition) -> None:
        f.create_entity(
            "IfcRelDefinesByProperties", GlobalId=gid(), RelatedObjects=list(elements), RelatingPropertyDefinition=definition
        )

    define(
        [w1, w2],
        f.create_entity(
            "IfcPropertySet",
            GlobalId=gid(),
            Name="SGVue_Edge",
            HasProperties=[
                single("Blank", "IfcLabel", ""),
                single("Dash", "IfcLabel", "-"),
                single("NotApplicable", "IfcLabel", "n/a"),
                single("Flag", "IfcBoolean", False),
                single("UValue", "IfcThermalTransmittanceMeasure", 0.5),
                # Compound measures with no unit assigned: as written, never read as a length
                # or a mass because their names contain one.
                single("LinearMass", "IfcMassPerLengthMeasure", 12.5),
                single("RotationalMass", "IfcRotationalMassMeasure", 3.25),
                f.create_entity(
                    "IfcPropertyListValue", Name="Colours", ListValues=[v("IfcLabel", "Red"), v("IfcLabel", "Green")]
                ),
                f.create_entity(
                    "IfcPropertyListValue",
                    Name="Offsets",
                    ListValues=[v("IfcLengthMeasure", 1000.0), v("IfcLengthMeasure", 2500.0)],
                ),
                f.create_entity(
                    "IfcPropertyEnumeratedValue", Name="Rating", EnumerationValues=[v("IfcLabel", "FIRE")]
                ),
                f.create_entity(
                    "IfcPropertyEnumeratedValue",
                    Name="Finishes",
                    EnumerationValues=[v("IfcLabel", "Paint"), v("IfcLabel", "Tile")],
                ),
                f.create_entity(
                    "IfcPropertyBoundedValue",
                    Name="Range",
                    LowerBoundValue=v("IfcLengthMeasure", 100.0),
                    UpperBoundValue=v("IfcLengthMeasure", 2000.0),
                    SetPointValue=v("IfcLengthMeasure", 900.0),
                ),
                f.create_entity(
                    "IfcPropertyBoundedValue", Name="Limit", UpperBoundValue=v("IfcPositiveLengthMeasure", 50.0)
                ),
            ],
        ),
    )

    def qto(name: str, quantities):
        return f.create_entity(
            "IfcElementQuantity",
            GlobalId=gid(),
            Name=name,
            Quantities=[f.create_entity(kind, Name=key, **{field: value}) for key, kind, field, value in quantities],
        )

    define(
        [w1],
        qto(
            "Qto_WallBaseQuantities",
            [
                ("Length", "IfcQuantityLength", "LengthValue", 4000.0),
                ("NetWeight", "IfcQuantityWeight", "WeightValue", 1250.0),
                ("Panels", "IfcQuantityCount", "CountValue", 3.0),
            ],
        ),
    )
    define([table], qto("Qto_FurnitureBaseQuantities", [("GrossWeight", "IfcQuantityWeight", "WeightValue", 88.5)]))
    define([space], qto("Qto_SpaceBaseQuantities", [("NetFloorArea", "IfcQuantityArea", "AreaValue", 20.0)]))

    fx.write(2)


if __name__ == "__main__":
    build()
