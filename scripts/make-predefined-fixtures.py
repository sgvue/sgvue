#!/usr/bin/env python3
"""Dev utility — write the PredefinedType fixtures (2026-11-07): `tests/fixtures/predefined/
ifc4.ifc`, `ifc2x3.ifc` and `golden.json`, `tests/unit/predefined-type.pipeline.test.ts`'s.

The owner: *"investigate why my ifcObjectType sometimes shown in Predefinetype on the properties
panel. The database and how it shown on the app is critical important thing to our app."* The
index used to replace a `USERDEFINED` code with the `ObjectType` text in the one field the
PredefinedType tile shows. Now an element carries two values (`IfcElement`): the code as written
and the effective type, IfcOpenShell's `get_predefined_type`. Each file holds **one element per
way an exporter states a predefined type**, named by its case — on the occurrence, on its type
object, `USERDEFINED` with and without the text it points at, `NOTDEFINED`, `$` — and, in IFC2X3,
an `IfcWall` / `IfcBeam` that has no PredefinedType attribute at all beside an `IfcSlab` /
`IfcCovering` that has one.

`golden.json` is IfcOpenShell's reading of the files **as written** (they are re-opened), per
element by GlobalId: the raw attributes, `ifcopenshell.util.element.get_predefined_type`, and
the code-as-written rule computed here in Python from those raw attributes.

Synthetic: no geometry, no project data, no coordinates — every element sits at its storey's
origin. Deterministic: GlobalIds from a counter, a fixed header timestamp, no owner history, so
re-running it writes byte-identical files. The scaffold (header, units, Project → Site →
Building) is `make-tiny-ifc.py`'s own `Fixture`.

    python3 scripts/make-predefined-fixtures.py
"""
from __future__ import annotations

import importlib.util
import json
import pathlib
import sys

try:
    import ifcopenshell
    import ifcopenshell.util.element
except ImportError:  # pragma: no cover - dev utility
    sys.exit("IfcOpenShell is not installed:  pip3 install ifcopenshell")

HERE = pathlib.Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("make_tiny_ifc", HERE / "make-tiny-ifc.py")
tiny = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tiny)  # type: ignore[union-attr]

OUT = tiny.FIXTURES / "predefined"

# One element per case: (case, occurrence class, occurrence attributes, type or None), where a
# type is (type class, attributes). The case is the element's Name. `$` is an attribute left out.
IFC4_CASES = [
    ("enum on occurrence", "IfcWall", {"PredefinedType": "SOLIDWALL"}, None),
    ("USERDEFINED with ObjectType", "IfcWall", {"PredefinedType": "USERDEFINED", "ObjectType": "Acoustic baffle"}, None),
    ("USERDEFINED without ObjectType", "IfcWall", {"PredefinedType": "USERDEFINED"}, None),
    ("NOTDEFINED", "IfcWall", {"PredefinedType": "NOTDEFINED"}, None),
    ("absent", "IfcWall", {}, None),
    ("ObjectType without PredefinedType", "IfcWall", {"ObjectType": "Feature wall"}, None),
    ("occurrence NOTDEFINED, type SHEAR", "IfcWall", {"PredefinedType": "NOTDEFINED"},
     ("IfcWallType", {"Name": "Shear wall 300", "PredefinedType": "SHEAR"})),
    ("occurrence absent, type JOIST", "IfcBeam", {},
     ("IfcBeamType", {"Name": "Joist 200", "PredefinedType": "JOIST"})),
    ("type USERDEFINED with ElementType", "IfcSlab", {"PredefinedType": "NOTDEFINED"},
     ("IfcSlabType", {"Name": "Raft 600", "PredefinedType": "USERDEFINED", "ElementType": "Raft slab"})),
    ("type USERDEFINED without ElementType", "IfcSlab", {"PredefinedType": "USERDEFINED", "ObjectType": "Ramp slab"},
     ("IfcSlabType", {"Name": "Ramp 250", "PredefinedType": "USERDEFINED"})),
    ("occurrence USERDEFINED, type PARTITIONING", "IfcWall", {"PredefinedType": "USERDEFINED", "ObjectType": "Curved wall"},
     ("IfcWallType", {"Name": "Partition 100", "PredefinedType": "PARTITIONING"})),
    ("occurrence BEAM, type NOTDEFINED", "IfcBeam", {"PredefinedType": "BEAM"},
     ("IfcBeamType", {"Name": "Beam 400", "PredefinedType": "NOTDEFINED"})),
    ("type Name differs from ObjectType", "IfcColumn", {"PredefinedType": "COLUMN", "ObjectType": "Occurrence label"},
     ("IfcColumnType", {"Name": "Type label", "PredefinedType": "COLUMN"})),
]

IFC2X3_CASES = [
    # IFC2X3's IfcWall and IfcBeam have no PredefinedType attribute; their types do.
    ("wall, type STANDARD", "IfcWall", {}, ("IfcWallType", {"Name": "Generic 200", "PredefinedType": "STANDARD"})),
    ("wall, ObjectType only", "IfcWall", {"ObjectType": "Feature wall"}, None),
    ("wall, type USERDEFINED with ElementType", "IfcWall", {},
     ("IfcWallType", {"Name": "Retaining 400", "PredefinedType": "USERDEFINED", "ElementType": "Retaining wall"})),
    ("wall, nothing", "IfcWall", {}, None),
    ("beam, type NOTDEFINED", "IfcBeam", {}, ("IfcBeamType", {"Name": "Beam 300", "PredefinedType": "NOTDEFINED"})),
    ("slab FLOOR", "IfcSlab", {"PredefinedType": "FLOOR"}, None),
    ("slab USERDEFINED with ObjectType", "IfcSlab", {"PredefinedType": "USERDEFINED", "ObjectType": "Ramp"}, None),
    ("slab NOTDEFINED, type ROOF", "IfcSlab", {"PredefinedType": "NOTDEFINED"},
     ("IfcSlabType", {"Name": "Roof 250", "PredefinedType": "ROOF"})),
    ("covering CEILING", "IfcCovering", {"PredefinedType": "CEILING"}, None),
    ("covering USERDEFINED without ObjectType", "IfcCovering", {"PredefinedType": "USERDEFINED"}, None),
]


def build(file_name: str, schema: str, cases) -> pathlib.Path:
    fx = tiny.Fixture(file_name, "PredefinedType", out_dir=OUT, schema=schema)
    f = fx.f
    f.header.file_name.preprocessor_version = "scripts/make-predefined-fixtures.py"
    storey, place = fx.storey("Level 1", 0.0)
    fx.aggregate(fx.building, [storey])
    elements = []
    for case, cls, attributes, type_spec in cases:
        element = f.create_entity(
            cls,
            GlobalId=tiny.gid(),
            Name=case,
            ObjectPlacement=f.create_entity(
                "IfcLocalPlacement", PlacementRelTo=place, RelativePlacement=fx.axis()
            ),
            **attributes,
        )
        elements.append(element)
        if type_spec is not None:
            type_cls, type_attributes = type_spec
            type_object = f.create_entity(type_cls, GlobalId=tiny.gid(), **type_attributes)
            f.create_entity(
                "IfcRelDefinesByType",
                GlobalId=tiny.gid(),
                RelatedObjects=[element],
                RelatingType=type_object,
            )
    fx.contain(storey, elements)
    fx.write(1)
    return fx.out


def raw(entity, name: str):
    """An attribute as written — `None` for `$` and for an attribute the schema does not have."""
    return getattr(entity, name, None)


def code_as_written(element, type_object) -> str:
    """`IfcElement.predefinedType`: the occurrence's code unless it is empty or NOTDEFINED, else
    the type's unless it is empty or NOTDEFINED, else the NOTDEFINED either wrote, else ""."""
    occurrence = raw(element, "PredefinedType") or ""
    of_type = (raw(type_object, "PredefinedType") or "") if type_object is not None else ""
    stated = lambda v: v not in ("", "NOTDEFINED")  # noqa: E731
    return occurrence if stated(occurrence) else of_type if stated(of_type) else occurrence or of_type


def golden(path: pathlib.Path) -> dict:
    model = ifcopenshell.open(str(path))
    out = {}
    for element in model.by_type("IfcElement"):
        type_object = ifcopenshell.util.element.get_type(element)
        out[element.GlobalId] = {
            "case": element.Name,
            "class": element.is_a(),
            "occurrence": {
                "PredefinedType": raw(element, "PredefinedType"),
                "ObjectType": raw(element, "ObjectType"),
            },
            "type": None
            if type_object is None
            else {
                "class": type_object.is_a(),
                "Name": raw(type_object, "Name"),
                "PredefinedType": raw(type_object, "PredefinedType"),
                "ElementType": raw(type_object, "ElementType"),
            },
            "get_predefined_type": ifcopenshell.util.element.get_predefined_type(element),
            "expected": {
                "predefinedType": code_as_written(element, type_object),
                "effectivePredefinedType": ifcopenshell.util.element.get_predefined_type(element) or "",
                "objectType": (raw(type_object, "Name") if type_object is not None else None)
                or raw(element, "ObjectType")
                or "",
            },
        }
    return {"schema": model.schema, "elements": out}


def main() -> None:
    files = {
        "ifc4.ifc": build("ifc4.ifc", "IFC4", IFC4_CASES),
        "ifc2x3.ifc": build("ifc2x3.ifc", "IFC2X3", IFC2X3_CASES),
    }
    data = {
        "generatedBy": f"IfcOpenShell {ifcopenshell.version}",
        "files": {name: golden(path) for name, path in files.items()},
    }
    target = OUT / "golden.json"
    target.write_text(json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n")
    print(f"wrote {target} — {sum(len(v['elements']) for v in data['files'].values())} elements")


if __name__ == "__main__":
    main()
