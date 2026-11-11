#!/usr/bin/env python3
"""Dev utility — write the ObjectType fixtures (2026-11-11): `tests/fixtures/objecttype/ifc4.ifc`
and `ifc2x3.ifc`, `tests/unit/object-type.pipeline.test.ts`'s.

The index showed the **type object's Name** (`IfcWallType.Name` …, through `IfcRelDefinesByType`)
as an element's ObjectType whenever the element had a named type, and the occurrence's own
`ObjectType` attribute only as a fallback — where IfcOpenShell and other viewers read the
occurrence's own attribute. On a Revit export the occurrence carries an ALL-CAPS sub-type code
and the type the "Family:Type" name, so about one element in five showed the wrong text. Each
file holds **one element per way an ObjectType and a type Name can stand beside each other**,
named by its case: a code beside a different "Family:Type" name, no ObjectType beside a named
type, the two equal, no type at all, a type with no Name, one type shared by two different
ObjectTypes and one ObjectType shared by two types, the characters a file escapes or a reader
might trim (non-ASCII, an apostrophe, a backslash, colons, leading and trailing spaces, `''`
as distinct from `$`), `USERDEFINED` with an ObjectType beside a type's ElementType and Name, and
`IfcSpace` (indexed too) — in IFC2X3 also an `IfcDoorStyle` and an `IfcBuildingElementProxy`.

The ground truth is not written here: `scripts/expected-from-ifcopenshell.py --identities` reads
these files back with IfcOpenShell into `tests/fixtures/identities.json`, raw attributes only.

Synthetic: no geometry, no project data, no coordinates — every element sits at its storey's
origin, every string is made up (`SUBTYPE_CODE_A`, `Family A:Type 1`). Deterministic: GlobalIds
from a counter, a fixed header timestamp, no owner history, so re-running it writes
byte-identical files. The scaffold (header, units, Project → Site → Building) is
`make-tiny-ifc.py`'s own `Fixture`.

    python3 scripts/make-objecttype-fixtures.py
"""
from __future__ import annotations

import hashlib
import importlib.util
import pathlib
import sys

try:
    import ifcopenshell  # noqa: F401
except ImportError:  # pragma: no cover - dev utility
    sys.exit("IfcOpenShell is not installed:  pip3 install ifcopenshell")

HERE = pathlib.Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("make_tiny_ifc", HERE / "make-tiny-ifc.py")
tiny = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tiny)  # type: ignore[union-attr]

OUT = tiny.FIXTURES / "objecttype"

# Types, by key: (type class, attributes). A key used by two cases is ONE type object, assigned
# to both through one IfcRelDefinesByType. An attribute left out is `$`.
IFC4_TYPES = {
    "A": ("IfcWallType", {"Name": "Family A:Type 1", "PredefinedType": "NOTDEFINED"}),
    "A2": ("IfcColumnType", {"Name": "Family B:Type 1", "PredefinedType": "COLUMN"}),
    "B": ("IfcWallType", {"Name": "Family C:Type 1", "PredefinedType": "NOTDEFINED"}),
    "C": ("IfcBeamType", {"Name": "Family D:Type 1", "PredefinedType": "BEAM"}),
    "F": ("IfcWallType", {"PredefinedType": "NOTDEFINED"}),
    "G1": ("IfcWallType", {"Name": "Family G:Type 1", "PredefinedType": "NOTDEFINED"}),
    "G2": ("IfcWallType", {"Name": "Family G:Type 2", "PredefinedType": "NOTDEFINED"}),
    "G3": ("IfcWallType", {"Name": "Family G:Type 3", "PredefinedType": "NOTDEFINED"}),
    "H1": ("IfcWallType", {"Name": "Familie É:Typ Ø 中", "PredefinedType": "NOTDEFINED"}),
    "H2": ("IfcWallType", {"Name": "Family H's:Type 1", "PredefinedType": "NOTDEFINED"}),
    "H3": ("IfcWallType", {"Name": "Family\\H:Type 2", "PredefinedType": "NOTDEFINED"}),
    "H4": ("IfcWallType", {"Name": "Family H:Type:3", "PredefinedType": "NOTDEFINED"}),
    "H5": ("IfcWallType", {"Name": "  Family H:Type 4  ", "PredefinedType": "NOTDEFINED"}),
    "H6": ("IfcWallType", {"Name": "", "PredefinedType": "NOTDEFINED"}),
    "I": ("IfcWallType", {"Name": "Family I:Type 1", "PredefinedType": "USERDEFINED", "ElementType": "TYPE_CODE_I"}),
    "J": ("IfcSpaceType", {"Name": "Space Family:Type J", "PredefinedType": "INTERNAL"}),
}

# One element per case: (case, occurrence class, occurrence attributes, type key or None). The
# case is the element's Name unless the attributes set one.
IFC4_CASES = [
    ("a: code beside a Family:Type name", "IfcWall",
     {"PredefinedType": "USERDEFINED", "ObjectType": "SUBTYPE_CODE_A"}, "A"),
    ("a: column code beside a Family:Type name", "IfcColumn", {"ObjectType": "SUBTYPE_CODE_B"}, "A2"),
    ("b: no ObjectType, named type", "IfcWall", {}, "B"),
    ("c: ObjectType equals the type's Name", "IfcBeam", {"ObjectType": "Family D:Type 1"}, "C"),
    ("d: no type, ObjectType set", "IfcSlab", {"ObjectType": "SUBTYPE_CODE_D"}, None),
    ("e: no type, no ObjectType", "IfcSlab", {}, None),
    ("f: type with no Name, ObjectType set", "IfcWall", {"ObjectType": "SUBTYPE_CODE_F"}, "F"),
    ("g: one type, first ObjectType", "IfcWall", {"ObjectType": "SUBTYPE_G1"}, "G1"),
    ("g: one type, second ObjectType", "IfcWall", {"ObjectType": "SUBTYPE_G2"}, "G1"),
    ("g: shared ObjectType, first type", "IfcWall", {"ObjectType": "SUBTYPE_G_SHARED"}, "G2"),
    ("g: shared ObjectType, second type", "IfcWall", {"ObjectType": "SUBTYPE_G_SHARED"}, "G3"),
    ("h: non-ASCII", "IfcWall", {"ObjectType": "Synthetic Ü Ω 中"}, "H1"),
    ("h: apostrophe", "IfcWall", {"ObjectType": "Code's value"}, "H2"),
    ("h: backslash", "IfcWall", {"ObjectType": "SUB\\CODE"}, "H3"),
    ("h: colons", "IfcWall", {"ObjectType": "CODE:WITH:COLONS"}, "H4"),
    ("h: leading and trailing spaces", "IfcWall", {"ObjectType": "  PADDED_CODE  "}, "H5"),
    ("h: empty strings", "IfcWall", {"ObjectType": ""}, "H6"),
    ("h: empty ObjectType, no type", "IfcSlab", {"ObjectType": ""}, None),
    ("i: USERDEFINED, ObjectType, type ElementType and Name", "IfcWall",
     {"PredefinedType": "USERDEFINED", "ObjectType": "SUBTYPE_CODE_I"}, "I"),
    ("j: space with ObjectType and a type", "IfcSpace",
     {"ObjectType": "SPACE_CODE_J", "PredefinedType": "INTERNAL"}, "J"),
    ("j: space with no Name", "IfcSpace", {"Name": None, "LongName": "Synthetic long name J", "ObjectType": "SPACE_CODE_J2"}, None),
]

IFC2X3_TYPES = {
    "K1": ("IfcWallType", {"Name": "Family K:Type 1", "PredefinedType": "STANDARD"}),
    "K2": ("IfcWallType", {"Name": "Family K:Type 2", "PredefinedType": "STANDARD"}),
    "KD": ("IfcDoorStyle", {
        "Name": "Door Family:Type K", "OperationType": "SINGLE_SWING_LEFT", "ConstructionType": "WOOD",
        "ParameterTakesPrecedence": False, "Sizeable": False,
    }),
    "KG": ("IfcWallType", {"Name": "Family K:Type 3", "PredefinedType": "STANDARD"}),
    "KH": ("IfcWallType", {"Name": "Familie É:Typ K", "PredefinedType": "STANDARD"}),
}

IFC2X3_CASES = [
    ("a: wall code beside a Family:Type name", "IfcWall", {"ObjectType": "SUBTYPE_CODE_K"}, "K1"),
    ("b: wall, no ObjectType, named type", "IfcWall", {}, "K2"),
    ("k: door with a door style", "IfcDoor", {"ObjectType": "DOOR_CODE_K"}, "KD"),
    ("k: proxy, ObjectType only", "IfcBuildingElementProxy", {"ObjectType": "PROXY_CODE_K"}, None),
    ("g: one type, first ObjectType", "IfcWall", {"ObjectType": "SUBTYPE_K_G1"}, "KG"),
    ("g: one type, second ObjectType", "IfcWall", {"ObjectType": "SUBTYPE_K_G2"}, "KG"),
    ("h: non-ASCII", "IfcWall", {"ObjectType": "Synthetic Ü K"}, "KH"),
    ("e: no type, no ObjectType", "IfcWall", {}, None),
    ("j: space with ObjectType", "IfcSpace", {
        "ObjectType": "SPACE_CODE_K", "CompositionType": "ELEMENT", "InteriorOrExteriorSpace": "INTERNAL",
    }, None),
    ("j: space with no Name", "IfcSpace", {
        "Name": None, "LongName": "Synthetic long name K", "ObjectType": "SPACE_CODE_K2",
        "CompositionType": "ELEMENT", "InteriorOrExteriorSpace": "INTERNAL",
    }, None),
]


def build(file_name: str, schema: str, types: dict, cases) -> pathlib.Path:
    fx = tiny.Fixture(file_name, "ObjectType", out_dir=OUT, schema=schema)
    f = fx.f
    f.header.file_name.preprocessor_version = "scripts/make-objecttype-fixtures.py"
    storey, place = fx.storey("Level 1", 0.0)
    fx.aggregate(fx.building, [storey])
    elements, spaces = [], []
    assigned: dict[str, list] = {}
    for case, cls, attributes, type_key in cases:
        attrs = {"Name": case, **attributes}
        attrs = {k: v for k, v in attrs.items() if v is not None}
        element = f.create_entity(
            cls,
            GlobalId=tiny.gid(),
            ObjectPlacement=f.create_entity(
                "IfcLocalPlacement", PlacementRelTo=place, RelativePlacement=fx.axis()
            ),
            **attrs,
        )
        (spaces if cls == "IfcSpace" else elements).append(element)
        if type_key is not None:
            assigned.setdefault(type_key, []).append(element)
    # One type object per key, in the order the keys are declared, then one relation for all of
    # its occurrences — so a shared type is one line, as an exporter writes it.
    for key, (type_cls, type_attributes) in types.items():
        if key not in assigned:
            continue
        type_object = f.create_entity(type_cls, GlobalId=tiny.gid(), **type_attributes)
        f.create_entity(
            "IfcRelDefinesByType",
            GlobalId=tiny.gid(),
            RelatedObjects=assigned[key],
            RelatingType=type_object,
        )
    fx.contain(storey, elements)
    if spaces:
        fx.aggregate(storey, spaces)
    fx.write(1)
    return fx.out


def main() -> None:
    for name, schema, types, cases in (
        ("ifc4.ifc", "IFC4", IFC4_TYPES, IFC4_CASES),
        ("ifc2x3.ifc", "IFC2X3", IFC2X3_TYPES, IFC2X3_CASES),
    ):
        path = build(name, schema, types, cases)
        print(f"  sha256 {hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}")


if __name__ == "__main__":
    main()
